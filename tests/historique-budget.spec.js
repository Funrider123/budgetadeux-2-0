// L'historique des budgets doit dire ce qui a CHANGÉ, pas qu'on a cliqué.
//
// Avant : chaque validation ajoutait une ligne « Budget validé pour Août 2026 », sans rien
// d'autre. En phase de réglage, où l'on revalide sans cesse, la liste se remplissait de
// doublons strictement identiques et n'apprenait rien.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

async function pilotage(page) {
  await openApp(page);
  await loginAs(page, {
    settings: { salaries: { lui: 0, elle: 0 }, mode: 'fixe', custom: { lui: 50, elle: 50 },
                fixed: { lui: 700, elle: 800 },
                idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
    charges: [{ id: 'c1', name: 'Loyer', amount: 900, cls: 'besoin', scope: 'commune' }],
    categories: [{ id: 'cat1', emoji: '🛒', name: 'Courses', budget: 400, cls: 'besoin' }],
    projects: [],
    budgetHistory: [], pilotSnapshot: null, budgetStart: null, pilotFrozen: false,
  });
}
const hist = page => page.evaluate(() => S.budgetHistory.map(h => ({ mois: h.label, nb: h.count, ch: h.changes })));

test.describe('Pas de ligne quand rien ne change', () => {
  test('revalider sans rien toucher n\'ajoute pas de ligne', async ({ page }) => {
    await pilotage(page);
    await page.evaluate(() => applyBudgetValidation(0));
    await page.evaluate(() => applyBudgetValidation(0));
    await page.evaluate(() => applyBudgetValidation(0));
    expect((await hist(page)).length).toBe(1);
  });

  test('mais la date d\'origine est préservée, pas rajeunie sans raison', async ({ page }) => {
    await pilotage(page);
    await page.evaluate(() => { applyBudgetValidation(0); S.budgetHistory[0].date = '2026-01-15'; save(); });
    await page.evaluate(() => applyBudgetValidation(0));
    expect(await page.evaluate(() => S.budgetHistory[0].date)).toBe('2026-01-15');
  });
});

test.describe('Une seule ligne par mois visé', () => {
  test('trois validations pour le même mois tiennent en une ligne, avec leur compte', async ({ page }) => {
    await pilotage(page);
    await page.evaluate(() => applyBudgetValidation(0));
    await page.evaluate(() => { S.categories[0].budget = 480; save(); applyBudgetValidation(0); });
    await page.evaluate(() => { S.categories[0].budget = 520; save(); applyBudgetValidation(0); });
    const h = await hist(page);
    expect(h.length).toBe(1);
    expect(h[0].nb).toBe(3);
  });

  test('un mois différent obtient bien sa propre ligne', async ({ page }) => {
    await pilotage(page);
    await page.evaluate(() => applyBudgetValidation(0));
    await page.evaluate(() => applyBudgetValidation(1));
    const h = await hist(page);
    expect(h.length).toBe(2);
    expect(h[0].mois).toContain(await page.evaluate(() => monthLabel(1)));
  });
});

test.describe('Ce qui a changé est consigné', () => {
  test('un budget de catégorie modifié est écrit noir sur blanc', async ({ page }) => {
    await pilotage(page);
    await page.evaluate(() => applyBudgetValidation(0));
    await page.evaluate(() => { S.categories[0].budget = 480; save(); applyBudgetValidation(0); });
    expect((await hist(page))[0].ch).toContain('Courses : 400 € → 480 €');
  });

  test('plusieurs changements simultanés sont tous listés', async ({ page }) => {
    await pilotage(page);
    await page.evaluate(() => applyBudgetValidation(0));
    await page.evaluate(() => { S.charges[0].amount = 850; S.categories[0].budget = 480; save(); applyBudgetValidation(0); });
    const ch = (await hist(page))[0].ch;
    expect(ch).toContain('Loyer : 900 € → 850 €');
    expect(ch).toContain('Courses : 400 € → 480 €');
  });

  test('un ajout et une suppression sont nommés', async ({ page }) => {
    await pilotage(page);
    await page.evaluate(() => applyBudgetValidation(0));
    await page.evaluate(() => {
      S.categories.push({ id: 'cat2', emoji: '🎉', name: 'Loisirs', budget: 200, cls: 'envie' });
      S.charges = []; save(); applyBudgetValidation(0);
    });
    const ch = (await hist(page))[0].ch;
    expect(ch).toContain('Loisirs ajoutée (200 €)');
    expect(ch).toContain('Loyer supprimée'); // nommé grâce au nom mémorisé dans l'instantané
  });

  test('les contributions modifiées apparaissent', async ({ page }) => {
    await pilotage(page);
    await page.evaluate(() => applyBudgetValidation(0));
    await page.evaluate(() => { S.settings.fixed.lui = 720; save(); applyBudgetValidation(0); });
    expect((await hist(page))[0].ch.join(' ')).toContain('700 € → 720 €');
  });

  test('les réglages inutiles au mode choisi ne sont pas signalés comme des changements', async ({ page }) => {
    // En mode « contribution fixe », les salaires et les % personnalisés sont des brouillons
    // que la validation remet à zéro : les compter serait trompeur.
    await pilotage(page);
    await page.evaluate(() => applyBudgetValidation(0));
    await page.evaluate(() => { S.settings.salaries = { lui: 2500, elle: 2200 }; S.settings.custom = { lui: 70, elle: 30 }; save(); applyBudgetValidation(0); });
    const h = await hist(page);
    expect(h.length).toBe(1);      // aucune nouvelle ligne
    expect(h[0].ch).toEqual([]);   // et rien de consigné
  });

  test('l\'écran affiche le détail des changements', async ({ page }) => {
    await pilotage(page);
    await page.evaluate(() => applyBudgetValidation(0));
    await page.evaluate(() => { S.categories[0].budget = 480; save(); applyBudgetValidation(0); go('reglages'); });
    const txt = await page.innerText('#screen');
    expect(txt).toContain('Courses : 400 € → 480 €');
    expect(txt).toContain('2 validations');
  });
});
