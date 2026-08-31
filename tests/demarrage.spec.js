// Date de démarrage du budget : rien ne compte avant.
//
// Le problème d'origine : un couple installe son budget le 30 du mois. L'enveloppe se voit
// créditer une dotation mensuelle ENTIÈRE pour ce mois presque fini, et reporte cet argent
// fantôme au 1er du mois suivant. Le sélecteur « Immédiat / Mois prochain » existait déjà mais
// ne pilotait qu'un instantané : il ne changeait rien au report.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

/** Une enveloppe à report de 900 €/mois, activée ce mois-ci, sans aucune dépense. */
const ENVELOPPE = {
  categories: [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 900, cls: 'besoin',
                 rollover: true, rolloverStart: 0, rolloverFrom: null }],
  expenses: [],
  pilotFrozen: false,
};

async function installer(page, over = {}) {
  await openApp(page);
  await loginAs(page, Object.assign({}, ENVELOPPE, over));
  await page.evaluate(() => { S.categories[0].rolloverFrom = annualMonthKey(0); save(); });
}

test.describe('Le mois de démarrage commande le report', () => {
  test('sans date de démarrage, le comportement d\'avant est conservé', async ({ page }) => {
    await installer(page);
    // Comptes existants : budgetStart null, donc aucune restriction — et le report historique.
    const r = await page.evaluate(() => ({ start: S.budgetStart, report: catCarryIn('courses', 1), demarre: budgetStarted(0) }));
    expect(r.start).toBeNull();
    expect(r.report).toBe(900);
    expect(r.demarre).toBe(true);
  });

  test('démarrer le mois prochain annule le report fantôme', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => { S.budgetStart = annualMonthKey(1); save(); });
    expect(await page.evaluate(() => catCarryIn('courses', 1))).toBe(0);
  });

  test('le couple qui s\'est trompé répare en déplaçant la date', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => { S.budgetStart = annualMonthKey(0); save(); });
    expect(await page.evaluate(() => catCarryIn('courses', 1))).toBe(900); // l'erreur
    await page.evaluate(() => { S.budgetStart = annualMonthKey(1); save(); });
    expect(await page.evaluate(() => catCarryIn('courses', 1))).toBe(0);   // réparé
  });

  test('la date globale est un plancher : une enveloppe ne compte jamais avant', async ({ page }) => {
    await installer(page);
    // L'enveloppe prétend démarrer il y a 6 mois, mais le budget démarre ce mois-ci.
    await page.evaluate(() => {
      S.categories[0].rolloverFrom = annualMonthKey(-6);
      S.budgetStart = annualMonthKey(0); save();
    });
    // Un seul mois compté (le mois courant), pas sept.
    expect(await page.evaluate(() => catRolloverBalance('courses', 0))).toBe(900);
  });

  test('une enveloppe créée plus tard garde bien son propre mois de départ', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => {
      S.budgetStart = annualMonthKey(-3);        // budget démarré il y a 3 mois
      S.categories[0].rolloverFrom = annualMonthKey(-1); // enveloppe créée le mois dernier
      save();
    });
    // Deux mois seulement (le mois dernier + celui-ci), pas quatre.
    expect(await page.evaluate(() => catRolloverBalance('courses', 0))).toBe(1800);
  });
});

test.describe('La première validation fixe le démarrage', () => {
  /** Valide via la double confirmation. offset 0 = ce mois-ci, sinon on choisit le mois. */
  async function valider(page, offset) {
    await page.evaluate(() => go('pilotage'));
    await page.click('#validBudget');
    if (offset === 0) { await page.click('#vbNow'); return; }
    await page.click('#vbLater');
    await page.selectOption('#vbMonth', String(offset));
    await page.click('#vbSave');
  }

  test('valider pour un mois futur démarre le budget à ce mois-là', async ({ page }) => {
    await installer(page);
    await valider(page, 1);
    const r = await page.evaluate(() => ({ start: S.budgetStart, attendu: annualMonthKey(1), report: catCarryIn('courses', 1) }));
    expect(r.start).toBe(r.attendu);
    expect(r.report).toBe(0);
  });

  test('valider pour ce mois-ci démarre le budget ce mois-ci', async ({ page }) => {
    await installer(page);
    await valider(page, 0);
    const r = await page.evaluate(() => ({ start: S.budgetStart, attendu: annualMonthKey(0) }));
    expect(r.start).toBe(r.attendu);
  });

  test('on peut viser n\'importe quel mois, pas seulement le suivant', async ({ page }) => {
    await installer(page);
    await valider(page, 4);
    const r = await page.evaluate(() => ({ start: S.budgetStart, attendu: annualMonthKey(4) }));
    expect(r.start).toBe(r.attendu);
  });

  test('une validation suivante ne repousse plus le démarrage', async ({ page }) => {
    await installer(page);
    await valider(page, 0);
    const premier = await page.evaluate(() => S.budgetStart);

    // On rouvre, on ajuste, et on revalide pour un mois futur.
    await page.evaluate(() => { S.pilotFrozen = false; save(); });
    await valider(page, 2);

    expect(await page.evaluate(() => S.budgetStart)).toBe(premier);
  });

  test('la confirmation annonce le mois en cours et prévient que c\'est le démarrage', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => go('pilotage'));
    await page.click('#validBudget');
    const txt = await page.innerText('#mb');
    expect(txt).toContain(await page.evaluate(() => monthLabel(0)));
    expect(txt).toContain('première validation');
  });

  test('annuler la confirmation ne valide rien', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => go('pilotage'));
    await page.click('#validBudget');
    await page.click('#vbCancel');
    const r = await page.evaluate(() => ({ start: S.budgetStart, gele: S.pilotFrozen }));
    expect(r.start).toBeNull();
    expect(r.gele).toBe(false);
  });
});

test.describe('Avant le démarrage', () => {
  test('une dépense antérieure au démarrage est refusée', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => { S.budgetStart = annualMonthKey(1); save(); });
    const r = await page.evaluate(() => {
      const hier = new Date(); hier.setDate(hier.getDate() - 1);
      const apres = new Date(); apres.setDate(1); apres.setMonth(apres.getMonth() + 1); apres.setDate(5);
      return { avant: dateBeforeBudgetStart(hier.toISOString().slice(0, 10)),
               apres: dateBeforeBudgetStart(apres.toISOString().slice(0, 10)) };
    });
    expect(r.avant).toBe(true);
    expect(r.apres).toBe(false);
  });

  test('la Vue annonce la date au lieu d\'afficher des zéros trompeurs', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => { S.budgetStart = annualMonthKey(1); save(); go('vue'); });
    const txt = await page.innerText('#screen');
    expect(txt).toContain('Votre budget démarre le');
    expect(txt).not.toContain('RESTANT POUR CE MOIS');
  });

  test('un bandeau le rappelle sur les autres écrans', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => { S.budgetStart = annualMonthKey(1); save(); go('historique'); });
    await expect(page.locator('#setupBanner .setup-banner')).toContainText('Budget à partir du');
  });

  test('mais pas sur Pilotage, où l\'on prépare justement le budget', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => { S.budgetStart = annualMonthKey(1); save(); go('pilotage'); });
    await expect(page.locator('#setupBanner .setup-banner')).toHaveCount(0);
  });

  test('la date est modifiable depuis les Réglages', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => { S.budgetStart = annualMonthKey(0); save(); go('reglages'); });
    await page.click('#editBudgetStart');
    await page.selectOption('#bsMonth', '1');
    await page.click('#bsSave');
    const r = await page.evaluate(() => ({ start: S.budgetStart, attendu: annualMonthKey(1), report: catCarryIn('courses', 1) }));
    expect(r.start).toBe(r.attendu);
    expect(r.report).toBe(0);
  });
});
