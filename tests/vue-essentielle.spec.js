// Le mode d'affichage : vue essentielle / vue détaillée.
//
// Le point de départ, remonté par plusieurs couples : une seule personne gère l'argent,
// l'autre fait confiance. Elle ne renonce pas à savoir où on en est, elle renonce aux
// corvées. La vue essentielle lui retire la configuration du budget — et rien d'autre.
//
// Ces tests tiennent les trois promesses qui font la fonctionnalité : on n'y est jamais mis
// sans l'avoir demandé, on peut toujours saisir une dépense, et le réglage reste chez soi.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

async function installer(page) {
  await openApp(page);
  await loginAs(page, {
    auth: { loggedIn: true, email: 'jb@test.fr', name: 'JB', profile: 'lui',
            coupleCode: 'TEST01', partnerLinked: true },
    partner: { name: 'Val', profile: 'elle' },
    categories: [
      { id: 'courses', emoji: '🛒', name: 'Courses', budget: 500, cls: 'besoin', rollover: true, rolloverStart: 0, rolloverFrom: null, rolloverMigre: true },
      { id: 'loisirs', emoji: '🎉', name: 'Loisirs', budget: 200, cls: 'envie', rollover: true, rolloverStart: 0, rolloverFrom: null, rolloverMigre: true },
    ],
    expenses: [{ id: 'e1', type: 'depense', date: new Date().toISOString().slice(0, 10),
                 amount: 42, cat: 'courses', desc: 'Carrefour', who: 'lui' }],
    cagnotte: { balance: 300, history: [] },
  });
  await page.evaluate(() => go('vue'));
}

const basculer = (page, mode) => page.click(`[data-vuemode="${mode}"]`);

test.describe('Le réglage', () => {
  // Une préférence d'affichage qui changerait toute seule serait vécue comme une panne.
  test('personne n\'est mis en vue essentielle sans l\'avoir demandé', async ({ page }) => {
    await installer(page);
    expect(await page.evaluate(() => S.ui.vue)).toBe('detaillee');
    await expect(page.locator('[data-vuemode="detaillee"]')).toHaveClass(/on/);
  });

  test('une valeur inconnue retombe sur la vue détaillée', async ({ page }) => {
    await installer(page);
    const apres = await page.evaluate(() => {
      const s = JSON.parse(JSON.stringify(S));
      s.ui.vue = 'nimportequoi';
      migrate(s);
      return s.ui.vue;
    });
    expect(apres).toBe('detaillee');
  });

  // Le cœur du sujet : c'est MON affichage, pas celui du couple. S.settings est synchronisé,
  // S.ui ne l'est pas ; y ranger le mode garantit qu'on n'impose rien à son partenaire.
  test('le mode reste sur l\'appareil et ne part pas chez le partenaire', async ({ page }) => {
    await installer(page);
    expect(await page.evaluate(() => SYNC_KEYS.includes('ui'))).toBe(false);
    expect(await page.evaluate(() => Object.keys(S.settings).includes('vue'))).toBe(false);
  });

  test('le bloc est présent dans les deux modes, au même endroit', async ({ page }) => {
    await installer(page);
    await expect(page.locator('[data-vuemode="essentielle"]')).toHaveCount(1);
    await basculer(page, 'essentielle');
    await expect(page.locator('[data-vuemode="essentielle"]')).toHaveClass(/on/);
    await expect(page.locator('[data-vuemode="detaillee"]')).toHaveCount(1);
  });

  test('on revient en arrière d\'un seul geste', async ({ page }) => {
    await installer(page);
    await basculer(page, 'essentielle');
    await basculer(page, 'detaillee');
    expect(await page.evaluate(() => S.ui.vue)).toBe('detaillee');
    await expect(page.locator('[data-period]')).toHaveCount(2);
  });
});

test.describe('Ce que la vue essentielle retire', () => {
  test('les écrans de pilotage quittent la barre et le menu', async ({ page }) => {
    await installer(page);
    await basculer(page, 'essentielle');

    await expect(page.locator('.tabbar [data-go="historique"]')).toHaveCount(0);
    await expect(page.locator('.tabbar [data-go="analyse"]')).toHaveCount(0);
    await page.evaluate(() => openMenu());
    await expect(page.locator('[data-menu="pilotage"]')).toHaveCount(0);
    await expect(page.locator('[data-menu="moneydate"]')).toHaveCount(1);
  });

  test('le rythme et le sélecteur Mois / Semaine disparaissent', async ({ page }) => {
    await installer(page);
    await basculer(page, 'essentielle');

    await expect(page.locator('[data-period]')).toHaveCount(0);
    await expect(page.locator('#screen')).not.toContainText('Rythme du');
    await expect(page.locator('#screen .link', { hasText: 'Détail →' })).toHaveCount(0);
  });
});

test.describe('Ce que la vue essentielle garde', () => {
  test('les trois blocs qui disent où on en est', async ({ page }) => {
    await installer(page);
    await basculer(page, 'essentielle');

    await expect(page.locator('#screen')).toContainText('Restant pour ce mois');
    await expect(page.locator('#screen')).toContainText('Budgets par catégorie');
    await expect(page.locator('#screen')).toContainText('Derniers mouvements');
  });

  // Des jauges sans chiffres ne disent pas où on se situe : le montant dépensé et la dotation
  // restent affichés, ainsi que le reste de l'enveloppe.
  test('les catégories gardent leurs montants', async ({ page }) => {
    await installer(page);
    await basculer(page, 'essentielle');

    const bloc = page.locator('#screen .card').filter({ hasText: 'Courses' }).first();
    await expect(bloc).toContainText('42');
    await expect(bloc).toContainText('500');
    await expect(bloc).toContainText('reste');
  });

  // La promesse centrale : on retire du travail, jamais un droit. Celui qui ne gère pas
  // dépense quand même, et c'est la seule chose que l'autre ne peut pas faire à sa place.
  test('on peut toujours ajouter une dépense', async ({ page }) => {
    await installer(page);
    await basculer(page, 'essentielle');

    await expect(page.locator('.tabbar [data-go="ajouter"]')).toHaveCount(1);
    await page.click('.tabbar [data-go="ajouter"]');
    await expect(page.locator('#dAmount')).toHaveCount(1);
    await expect(page.locator('#dSave')).toHaveCount(1);
  });

  test('les projets et la cagnotte restent accessibles', async ({ page }) => {
    await installer(page);
    await basculer(page, 'essentielle');

    await expect(page.locator('.tabbar [data-go="projets"]')).toHaveCount(1);
    await page.click('.tabbar [data-go="projets"]');
    await expect(page.locator('#screen')).toContainText('Cagnotte commune');
  });
});

// Le bouton le plus utilisé de l'app ne doit pas changer de place selon le mode : on le vise
// au pouce sans regarder. C'est ce qui a écarté l'idée d'un onglet « Détail » dans la barre,
// qui aurait fait quatre entrées et décalé le + de 48 px.
test('le + reste au centre dans les deux modes', async ({ page }) => {
  await installer(page);
  const centre = () => page.evaluate(() => {
    const p = document.querySelector('.tabbar .tab-add').getBoundingClientRect();
    return Math.round(p.left + p.width / 2 - window.innerWidth / 2);
  });

  expect(Math.abs(await centre())).toBeLessThanOrEqual(1);
  await basculer(page, 'essentielle');
  expect(Math.abs(await centre())).toBeLessThanOrEqual(1);
});
