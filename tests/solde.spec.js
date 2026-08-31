// Le solde du budget, et le « -0 € » qui criait au déficit.
//
// Un budget PILE à l'équilibre ne tombe presque jamais sur un zéro exact en virgule flottante :
// 1541 − 339,90 − 901,10 − 300 vaut −1,1e-13. L'app le classait donc en déficit (avec alerte
// clignotante) et l'affichait « -0 € », alors que c'est le meilleur résultat possible.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

test.describe('Classement du solde', () => {
  test('un budget pile à l\'équilibre est annoncé comme équilibré, pas en déficit', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const solde = 1541 - 339.90 - 901.10 - 300; // cas réel remonté par un couple
      const i = budgetSoldeInfo(solde);
      return { affiche: `${i.sign}${fmt(solde)}`, libelle: i.label, clignote: i.blink };
    });
    expect(r.affiche).toBe('0 €');          // et surtout pas « -0 € »
    expect(r.libelle).toContain('équilibré');
    expect(r.clignote).toBe(false);          // aucune alerte
  });

  test('un résidu de calcul, dans un sens comme dans l\'autre, reste un équilibre', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => [1e-13, -1e-13, 0.004, -0.004].map(v => budgetSoldeInfo(v).label));
    r.forEach(l => expect(l).toContain('équilibré'));
  });

  test('un vrai déficit est toujours signalé, même d\'un centime', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const i = budgetSoldeInfo(-0.01);
      return { libelle: i.label, clignote: i.blink, affiche: `${i.sign}${fmt(-0.01)}` };
    });
    expect(r.libelle).toContain('déficit');
    expect(r.clignote).toBe(true);
    expect(r.affiche).toBe('-0,01 €');
  });

  test('un vrai excédent garde son signe +', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const i = budgetSoldeInfo(120.5);
      return { libelle: i.label, affiche: `${i.sign}${fmt(120.5)}` };
    });
    expect(r.libelle).toContain('excédent');
    expect(r.affiche).toBe('+120,50 €');
  });
});

test.describe('Aucun « -0 » nulle part', () => {
  test('les formateurs ne produisent jamais de zéro négatif', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      montantResidu: fmt(-1e-13),
      montantZero: fmt(-0),
      estimation: fmtEst(-0.4),
      arrondi: Object.is(round2(-1e-13), -0),
    }));
    expect(r.montantResidu).toBe('0 €');
    expect(r.montantZero).toBe('0 €');
    expect(r.estimation).toBe('0 €');
    expect(r.arrondi).toBe(false); // round2 neutralise le -0
  });

  test('la carte affichée à l\'écran annonce bien l\'équilibre', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      settings: { salaries: { lui: 0, elle: 0 }, mode: 'fixe', custom: { lui: 50, elle: 50 },
                  fixed: { lui: 708.45, elle: 832.55 },
                  idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
      charges: [{ id: 'c1', name: 'Prélèvements', amount: 339.90, cls: 'besoin', scope: 'commune' }],
      categories: [{ id: 'c', emoji: '🛒', name: 'Courses', budget: 901.10, cls: 'besoin' }],
      projects: [{ id: 'p1', name: 'Projet', emoji: '🌟', target: 3000, saved: 0, months: 10,
                   mensuel: 300, day: 5, split: { lui: 50, elle: 50 }, cls: 'envie', status: 'actif', history: [] }],
      pilotFrozen: false,
    });
    await page.evaluate(() => go('pilotage'));
    const carte = await page.innerText('#budgetRecap');
    expect(carte).toContain('Budget équilibré');
    expect(carte).not.toContain('-0');
    expect(carte).not.toContain('déficit');
  });
});
