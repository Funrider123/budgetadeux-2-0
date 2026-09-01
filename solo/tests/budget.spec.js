// Calculs de budget : la partie où une régression est la plus coûteuse (des
// chiffres faux sont pris pour argent comptant) et la moins visible à l'œil nu.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

test.describe('Revenus', () => {
  test('le total additionne salaire et autres revenus', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      settings: { income: { salary: 2350, other: 150 }, idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
    });
    expect(await page.evaluate(() => totalRevenu())).toBe(2500);
  });

  test('sans revenu déclaré, le total vaut 0 (et pas NaN)', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      settings: { income: { salary: 0, other: 0 }, idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
    });
    expect(await page.evaluate(() => totalRevenu())).toBe(0);
    expect(await page.evaluate(() => needsSetup())).toBe(true);
  });
});

test.describe('Charges fixes en deux groupes', () => {
  test('chaque groupe a son total, et le total général les additionne', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      charges: [
        { id: 'c1', name: 'Loyer', amount: 780, cls: 'besoin', scope: 'essentiel' },
        { id: 'c2', name: 'Eau', amount: 20, cls: 'besoin', scope: 'essentiel' },
        { id: 'c3', name: 'Internet', amount: 30, cls: 'besoin', scope: 'abonnement' },
        { id: 'c4', name: 'Streaming', amount: 12, cls: 'envie', scope: 'abonnement' },
      ],
    });
    expect(await page.evaluate(() => chargesByScope('essentiel'))).toBe(800);
    expect(await page.evaluate(() => chargesByScope('abonnement'))).toBe(42);
    expect(await page.evaluate(() => chargesFixes())).toBe(842);
  });
});

test.describe('Disponible pour les projets', () => {
  test('= revenus − charges fixes − budgets de catégories', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      settings: { income: { salary: 3000, other: 0 }, idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
      charges: [
        { id: 'c1', name: 'Loyer', amount: 900, cls: 'besoin', scope: 'essentiel' },
        { id: 'c2', name: 'Internet', amount: 30, cls: 'besoin', scope: 'abonnement' },
      ],
      categories: [
        { id: 'courses', emoji: '🛒', name: 'Courses', budget: 400, cls: 'besoin' },
        { id: 'loisirs', emoji: '🎉', name: 'Loisirs', budget: 200, cls: 'envie' },
      ],
    });
    // 3000 − 930 (les deux groupes de charges) − 600 = 1470
    expect(await page.evaluate(() => disponiblePourProjets())).toBe(1470);
  });

  test('les mensualités de projets actifs sont comptées, pas celles des projets en pause', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      projects: [
        { id: 'p1', name: 'Voyage', emoji: '🌴', target: 3000, saved: 0, months: 10, mensuel: 300, day: 5, cls: 'envie', status: 'actif', history: [] },
        { id: 'p2', name: 'Cuisine', emoji: '🍳', target: 5000, saved: 0, months: 20, mensuel: 250, day: 5, cls: 'envie', status: 'pause', history: [] },
        { id: 'p3', name: 'Vieux', emoji: '📦', target: 100, saved: 0, months: 1, mensuel: 100, day: 5, cls: 'envie', status: 'abandonne', history: [] },
      ],
    });
    expect(await page.evaluate(() => epargneProjetsMensuelle())).toBe(300);
  });
});

test.describe('Répartition par nature (Besoin / Envie / Investissement / Protection)', () => {
  test('les 4 pourcentages totalisent toujours exactement 100, sans négatif', async ({ page }) => {
    await openApp(page);
    await loginAs(page);
    // Combinaisons volontairement "sales" : ce sont les arrondis en cascade qui
    // faisaient auparavant passer la 4e valeur sous zéro.
    const cases = [
      { besoin: 1, envie: 1, invest: 1, protection: 0 },
      { besoin: 333, envie: 333, invest: 333, protection: 1 },
      { besoin: 1, envie: 1, invest: 1, protection: 1 },
      { besoin: 7, envie: 11, invest: 13, protection: 17 },
      { besoin: 1000, envie: 1, invest: 1, protection: 1 },
    ];
    for (const vals of cases) {
      const out = await page.evaluate(v => roundPctTo100(v), vals);
      const sum = out.besoin + out.envie + out.invest + out.protection;
      expect(sum, `somme pour ${JSON.stringify(vals)}`).toBe(100);
      for (const [k, v] of Object.entries(out)) {
        expect(v, `${k} pour ${JSON.stringify(vals)}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('rien d\'alloué → tout à 0 (et pas NaN)', async ({ page }) => {
    await openApp(page);
    await loginAs(page);
    const out = await page.evaluate(() => roundPctTo100({ besoin: 0, envie: 0, invest: 0, protection: 0 }));
    expect(out).toEqual({ besoin: 0, envie: 0, invest: 0, protection: 0 });
  });

  test('la réalité agrège charges, catégories et mensualités de projets', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      charges: [{ id: 'c1', name: 'Loyer', amount: 600, cls: 'besoin', scope: 'essentiel' }],
      categories: [
        { id: 'courses', emoji: '🛒', name: 'Courses', budget: 200, cls: 'besoin' },
        { id: 'loisirs', emoji: '🎉', name: 'Loisirs', budget: 100, cls: 'envie' },
      ],
      projects: [
        { id: 'p1', name: 'Apport', emoji: '🏡', target: 10000, saved: 0, months: 50, mensuel: 100, day: 5, cls: 'invest', status: 'actif', history: [] },
      ],
    });
    // besoin 800, envie 100, invest 100, protection 0 → total 1000
    expect(await page.evaluate(() => realityEur())).toEqual({ besoin: 800, envie: 100, invest: 100, protection: 0 });
    expect(await page.evaluate(() => realitySplit())).toEqual({ besoin: 80, envie: 10, invest: 10, protection: 0 });
  });
});

test.describe('Suivi des dépenses par catégorie', () => {
  test('ajouter une dépense réduit le budget restant de sa catégorie', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      categories: [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 300, cls: 'besoin' }],
      expenses: [],
    });

    expect(await page.evaluate(() => spentByCat('courses'))).toBe(0);

    await page.evaluate(() => go('ajouter'));
    await page.fill('#dAmount', '42');
    await page.fill('#dDesc', 'Marché du dimanche');
    await page.click('[data-catpick="courses"]');
    await page.click('#dSave');

    await expect.poll(() => page.evaluate(() => spentByCat('courses'))).toBe(42);
    const restant = await page.evaluate(() => {
      const c = S.categories.find(x => x.id === 'courses');
      return c.budget - spentByCat('courses');
    });
    expect(restant).toBe(258);
  });

  test('une prévision n\'est pas comptée comme une dépense réelle', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      categories: [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 300, cls: 'besoin' }],
      expenses: [
        { id: 'e1', type: 'depense', amount: 50, cat: 'courses', desc: 'Réelle', date: new Date().toISOString().slice(0, 10), prevision: false },
        { id: 'e2', type: 'depense', amount: 80, cat: 'courses', desc: 'Prévue', date: new Date().toISOString().slice(0, 10), prevision: true },
      ],
    });
    expect(await page.evaluate(() => spentByCat('courses'))).toBe(50);
  });
});
