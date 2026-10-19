// Partage de l'application aux proches, depuis le menu.
//
// Le risque de cette fonctionnalité tient en une ligne : l'app possède déjà un lien de
// partage, « ?code=XXXXXX », qui fait entrer celui qui l'ouvre DANS le couple et occupe la
// place restante. Envoyer celui-là à une sœur ou à un ami lui ouvrirait le budget du couple.
// Ces tests gardent les deux liens séparés.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

async function installer(page) {
  await openApp(page);
  await loginAs(page, {
    auth: { loggedIn: true, email: 'jb@test.fr', name: 'JB', profile: 'lui',
            coupleCode: 'TEST01', partnerLinked: true },
    partner: { name: 'Val', profile: 'elle' },
  });
}

// Espionne le partage natif et le presse-papier, puis ouvre le menu et clique l'entrée.
async function partagerDepuisLeMenu(page, { natif }) {
  await page.evaluate((avecPartageNatif) => {
    window.__partage = {};
    if (avecPartageNatif) {
      navigator.share = async (data) => { window.__partage.natif = data; };
    } else {
      try { delete navigator.share; } catch (_) {}
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    }
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t) => { window.__partage.presse = t; } }, configurable: true,
    });
  }, natif);

  await page.evaluate(() => openMenu());
  await page.click('#menuPartage');
  await page.waitForTimeout(100);
  return page.evaluate(() => window.__partage);
}

test.describe('Faire découvrir l\'application', () => {
  test('l\'entrée est dans le menu', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => openMenu());

    await expect(page.locator('#menuPartage')).toContainText('Faire découvrir Budget à Deux');
  });

  test('le partage natif reçoit le lien nu, jamais le code couple', async ({ page }) => {
    await installer(page);
    const { natif } = await partagerDepuisLeMenu(page, { natif: true });

    expect(natif).toBeTruthy();
    expect(natif.url).toBe(await page.evaluate(() => location.origin + '/'));
    // Le cœur du test : ni paramètre de code, ni code couple nulle part dans le message.
    expect(natif.url).not.toContain('code=');
    expect(JSON.stringify(natif)).not.toContain('TEST01');
  });

  test('sans partage natif, le lien part dans le presse-papier', async ({ page }) => {
    await installer(page);
    const { presse } = await partagerDepuisLeMenu(page, { natif: false });

    expect(presse).toContain('Budget à Deux');
    expect(presse).toContain(await page.evaluate(() => location.origin + '/'));
    expect(presse).not.toContain('code=');
    expect(presse).not.toContain('TEST01');
  });

  test('le menu se referme, pour laisser place à la feuille de partage', async ({ page }) => {
    await installer(page);
    await partagerDepuisLeMenu(page, { natif: true });

    await expect(page.locator('#modalRoot .modal')).toHaveCount(0);
  });
});
