// Qui tient le Money Date.
//
// Une fois la trame posée, beaucoup de couples n'ont qu'une personne qui tient le point
// mensuel. L'app peut alors ne convoquer qu'elle. C'est un réglage d'une autre nature que le
// mode d'affichage : il engage le couple, puisqu'il décide à qui partent les rappels — donc
// il est synchronisé, et il se décide à deux, à la fin d'un Money Date.
//
// Le risque de cette fonctionnalité tient en une phrase : quelqu'un ne doit pas se retrouver
// privé de ses rappels sans que le couple l'ait voulu.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

async function installer(page, { partenaire = true } = {}) {
  await openApp(page);
  await loginAs(page, {
    auth: { loggedIn: true, email: 'jb@test.fr', name: 'JB', profile: 'lui',
            coupleCode: 'TEST01', partnerLinked: partenaire },
    partner: { name: 'Val', profile: 'elle' },
  });
}

// Termine un Money Date comme le ferait quelqu'un : dernier écran, bouton de sortie.
async function terminerMoneyDate(page) {
  // L'écran « Money Date terminé ! » vient après la dernière étape, pas sur elle.
  await page.evaluate(() => { mdStep = MD_STEPS.length; go('moneydate'); });
  await page.click('#mdHome');
  await page.waitForTimeout(1100); // la question arrive après le toast, jamais empilée avec lui
}

test.describe('Le réglage par défaut', () => {
  test('on reste à deux tant que personne n\'a choisi', async ({ page }) => {
    await installer(page);
    expect(await page.evaluate(() => S.moneyDate.mode)).toBe('ensemble');
    expect(await page.evaluate(() => S.moneyDate.pilote)).toBe(null);
  });

  // Sans pilote identifié, on ne saurait à qui écrire : plutôt que de priver tout le monde
  // de rappel, le réglage retombe sur « ensemble ».
  test('un mode solo sans pilote retombe sur ensemble', async ({ page }) => {
    await installer(page);
    const apres = await page.evaluate(() => {
      const s = JSON.parse(JSON.stringify(S));
      s.moneyDate.mode = 'solo'; s.moneyDate.pilote = null;
      migrate(s);
      return { mode: s.moneyDate.mode, pilote: s.moneyDate.pilote };
    });
    expect(apres).toEqual({ mode: 'ensemble', pilote: null });
  });

  test('un pilote fantaisiste est ignoré', async ({ page }) => {
    await installer(page);
    const apres = await page.evaluate(() => {
      const s = JSON.parse(JSON.stringify(S));
      s.moneyDate.mode = 'solo'; s.moneyDate.pilote = 'quelquun';
      migrate(s);
      return s.moneyDate.mode;
    });
    expect(apres).toBe('ensemble');
  });

  // Contrairement au mode d'affichage, celui-ci concerne les deux : il doit voyager.
  test('le réglage est partagé avec le partenaire', async ({ page }) => {
    await installer(page);
    expect(await page.evaluate(() => SYNC_KEYS.includes('moneyDate'))).toBe(true);
  });
});

test.describe('La question de fin de Money Date', () => {
  test('elle est posée après le premier, une fois le rendez-vous fait', async ({ page }) => {
    await installer(page);
    await terminerMoneyDate(page);

    await expect(page.locator('#modalRoot')).toContainText('Vos prochains Money Dates');
    await expect(page.locator('[data-mdarr="ensemble"]')).toHaveCount(1);
    await expect(page.locator('[data-mdarr="lui"]')).toHaveCount(1);
    await expect(page.locator('[data-mdarr="elle"]')).toHaveCount(1);
  });

  test('elle ne revient pas une fois répondue', async ({ page }) => {
    await installer(page);
    await terminerMoneyDate(page);
    await page.click('[data-mdarr="ensemble"]');
    await terminerMoneyDate(page);

    await expect(page.locator('#modalRoot')).not.toContainText('Vos prochains Money Dates');
  });

  // Désigner quelqu'un suppose qu'il existe : seul un partenaire relié peut tenir les
  // rendez-vous suivants.
  test('elle n\'est pas posée à qui est encore seul', async ({ page }) => {
    await installer(page, { partenaire: false });
    await terminerMoneyDate(page);

    await expect(page.locator('#modalRoot')).not.toContainText('Vos prochains Money Dates');
  });

  test('désigner quelqu\'un enregistre qui', async ({ page }) => {
    await installer(page);
    await terminerMoneyDate(page);
    await page.click('[data-mdarr="elle"]');

    expect(await page.evaluate(() => S.moneyDate.mode)).toBe('solo');
    expect(await page.evaluate(() => S.moneyDate.pilote)).toBe('elle');
  });

  test('on peut revenir à deux', async ({ page }) => {
    await installer(page);
    await terminerMoneyDate(page);
    await page.click('[data-mdarr="lui"]');
    await page.evaluate(() => openMdArrangement());
    await page.click('[data-mdarr="ensemble"]');

    expect(await page.evaluate(() => S.moneyDate.mode)).toBe('ensemble');
    expect(await page.evaluate(() => S.moneyDate.pilote)).toBe(null);
  });
});

test.describe('Dans les réglages', () => {
  test('l\'arrangement courant est affiché et modifiable', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => go('reglages'));
    await expect(page.locator('#screen')).toContainText('Vous le faites ensemble');

    await page.click('#mdArrangement');
    await page.click('[data-mdarr="elle"]');
    await page.evaluate(() => go('reglages'));
    await expect(page.locator('#screen')).toContainText("Val s'en occupe");
  });
});
