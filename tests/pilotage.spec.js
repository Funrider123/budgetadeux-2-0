// Verrouillage et validation du budget (« Simulation et validation budgétaire »).
// Le couple doit pouvoir simuler sans que ce soit officiel, puis valider ou tout
// annuler : si « Annuler » ne restaure pas exactement l'état validé, des chiffres
// deviennent officiels sans que personne ne l'ait décidé.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

/** Couple avec un budget déjà validé (verrous posés + instantanés enregistrés). */
async function budgetValide(page) {
  await loginAs(page, {
    settings: { salaries: { lui: 0, elle: 0 }, mode: 'fixe', custom: { lui: 50, elle: 50 },
                fixed: { lui: 1500, elle: 1500 }, idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
    charges: [{ id: 'c1', name: 'Loyer', amount: 900, cls: 'besoin', scope: 'commune' }],
    categories: [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 400, cls: 'besoin' }],
    projects: [{ id: 'p1', name: 'Voyage', emoji: '🌴', target: 3000, saved: 500, months: 8, mensuel: 300, day: 5, split: { lui: 50, elle: 50 }, cls: 'envie', status: 'actif', history: [] }],
  });
  await page.evaluate(() => {
    S.pilotFrozen = true; S.projectsFrozen = true;
    S.budgetStart = annualMonthKey(0); // un budget déjà validé a forcément un mois de démarrage
    S.pilotSnapshot = {
      salaries: { ...S.settings.salaries }, mode: S.settings.mode,
      custom: { ...S.settings.custom }, fixed: { ...S.settings.fixed },
      charges: S.charges.map(c => ({ id: c.id, amount: c.amount })),
      categories: S.categories.map(c => ({ id: c.id, budget: c.budget })),
    };
    S.projectsSnapshot = {};
    S.projects.forEach(p => { S.projectsSnapshot[p.id] = { mensuel: p.mensuel, months: p.months }; });
    save(); go('pilotage');
  });
}

test.describe('Un seul verrou pour tout l\'écran', () => {
  test('« Modifier » déverrouille le budget ET les mensualités de projets', async ({ page }) => {
    await openApp(page);
    await budgetValide(page);

    await page.click('#unfreezeBudget');

    expect(await page.evaluate(() => ({ budget: S.pilotFrozen, projets: S.projectsFrozen })))
      .toEqual({ budget: false, projets: false });
  });

  test('« Valider » reverrouille les deux et enregistre les deux instantanés', async ({ page }) => {
    await openApp(page);
    await budgetValide(page);
    await page.click('#unfreezeBudget');

    await page.evaluate(() => {
      S.categories.find(c => c.id === 'courses').budget = 480;
      S.projects[0].mensuel = 350;
    });
    await page.click('#validBudgetNow');

    const apres = await page.evaluate(() => ({
      budget: S.pilotFrozen, projets: S.projectsFrozen,
      snapCategorie: S.pilotSnapshot.categories.find(c => c.id === 'courses').budget,
      snapProjet: S.projectsSnapshot.p1.mensuel,
    }));
    expect(apres).toEqual({ budget: true, projets: true, snapCategorie: 480, snapProjet: 350 });
  });
});

test.describe('Détection des changements non validés', () => {
  test('aucun changement juste après une validation', async ({ page }) => {
    await openApp(page);
    await budgetValide(page);
    expect(await page.evaluate(() => pilotHasChanges())).toBe(false);
  });

  test('modifier un budget de catégorie est détecté', async ({ page }) => {
    await openApp(page);
    await budgetValide(page);
    await page.evaluate(() => { S.categories.find(c => c.id === 'courses').budget = 480; });
    expect(await page.evaluate(() => pilotHasChanges())).toBe(true);
  });

  test('modifier une mensualité de projet est détecté', async ({ page }) => {
    await openApp(page);
    await budgetValide(page);
    // Historiquement ignoré : les mensualités de projets ne comptaient pas comme
    // un changement de budget, donc « Annuler » n'était jamais proposé.
    await page.evaluate(() => { S.projects[0].mensuel = 350; });
    expect(await page.evaluate(() => pilotHasChanges())).toBe(true);
  });

  test('modifier une charge fixe est détecté', async ({ page }) => {
    await openApp(page);
    await budgetValide(page);
    await page.evaluate(() => { S.charges[0].amount = 950; });
    expect(await page.evaluate(() => pilotHasChanges())).toBe(true);
  });
});

test.describe('Annuler nos changements', () => {
  test('restaure budgets, charges ET mensualités, puis reverrouille', async ({ page }) => {
    await openApp(page);
    await budgetValide(page);
    await page.click('#unfreezeBudget');

    await page.evaluate(() => {
      S.categories.find(c => c.id === 'courses').budget = 999;
      S.charges[0].amount = 1200;
      S.projects[0].mensuel = 800;
      S.projects[0].months = 3;
      S.settings.fixed = { lui: 100, elle: 100 };
    });

    await page.evaluate(() => cancelBudgetChanges());

    const apres = await page.evaluate(() => ({
      categorie: S.categories.find(c => c.id === 'courses').budget,
      charge: S.charges[0].amount,
      mensuel: S.projects[0].mensuel,
      mois: S.projects[0].months,
      fixe: S.settings.fixed,
      budgetVerrouille: S.pilotFrozen,
      projetsVerrouilles: S.projectsFrozen,
    }));
    expect(apres).toEqual({
      categorie: 400, charge: 900, mensuel: 300, mois: 8,
      fixe: { lui: 1500, elle: 1500 },
      budgetVerrouille: true, projetsVerrouilles: true,
    });
  });

  test('le bandeau d\'alerte propose « Annuler » dès qu\'un chiffre a bougé', async ({ page }) => {
    await openApp(page);
    await budgetValide(page);
    await page.click('#unfreezeBudget');
    await page.evaluate(() => { S.projects[0].mensuel = 350; });

    // On quitte l'écran sans valider : c'est là que le rappel doit apparaître.
    await page.evaluate(() => go('historique'));

    const banniere = page.locator('#setupBanner .setup-banner');
    await expect(banniere).toContainText('Budget non validé');
    await expect(page.locator('#bannerCancelBudget')).toBeVisible();

    await page.evaluate(() => document.querySelector('#bannerCancelBudget').click());

    await expect.poll(() => page.evaluate(() => S.projects[0].mensuel)).toBe(300);
    expect(await page.evaluate(() => S.pilotFrozen)).toBe(true);
  });

  test('sans changement, le bandeau ne propose pas « Annuler »', async ({ page }) => {
    await openApp(page);
    await budgetValide(page);
    await page.evaluate(() => { S.pilotFrozen = false; save(); go('historique'); });

    await expect(page.locator('#setupBanner .setup-banner')).toContainText('Budget non validé');
    await expect(page.locator('#bannerCancelBudget')).toHaveCount(0);
  });
});
