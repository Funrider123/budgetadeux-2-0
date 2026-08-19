// Calculs de budget : la partie où une régression est la plus coûteuse (des
// chiffres faux sont pris pour argent comptant par le couple) et la moins
// visible à l'œil nu.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

test.describe('Répartition entre les deux partenaires', () => {
  test('mode "fixe" : la part de chacun suit les contributions déclarées', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      settings: { salaries: { lui: 3000, elle: 1000 }, mode: 'fixe',
                  custom: { lui: 50, elle: 50 }, fixed: { lui: 750, elle: 250 },
                  idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
    });
    // Les salaires ne doivent PAS entrer en jeu en mode fixe.
    expect(await page.evaluate(() => repartition())).toEqual({ lui: 75, elle: 25 });
    expect(await page.evaluate(() => totalRevenuFoyer())).toBe(1000);
  });

  test('mode "revenus" : la part suit les salaires', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      settings: { salaries: { lui: 2000, elle: 3000 }, mode: 'revenus',
                  custom: { lui: 50, elle: 50 }, fixed: { lui: 0, elle: 0 },
                  idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
    });
    expect(await page.evaluate(() => repartition())).toEqual({ lui: 40, elle: 60 });
    expect(await page.evaluate(() => totalRevenuFoyer())).toBe(5000);
  });

  test('mode "net" : les charges perso sont déduites avant de calculer la part', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      settings: { salaries: { lui: 2000, elle: 2000 }, mode: 'net',
                  custom: { lui: 50, elle: 50 }, fixed: { lui: 0, elle: 0 },
                  idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
      charges: [
        { id: 'p1', name: 'Crédit voiture', amount: 500, cls: 'besoin', scope: 'lui' },
        { id: 'p2', name: 'Salle de sport', amount: 0, cls: 'envie', scope: 'elle' },
      ],
    });
    // Lui : 2000-500 = 1500, Elle : 2000 → 1500/3500 = 43%
    expect(await page.evaluate(() => repartition())).toEqual({ lui: 43, elle: 57 });
    expect(await page.evaluate(() => totalRevenuFoyer())).toBe(3500);
  });

  test('sans revenu déclaré, on retombe sur 50/50 plutôt que sur une division par zéro', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      settings: { salaries: { lui: 0, elle: 0 }, mode: 'fixe', custom: { lui: 50, elle: 50 },
                  fixed: { lui: 0, elle: 0 }, idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
    });
    expect(await page.evaluate(() => repartition())).toEqual({ lui: 50, elle: 50 });
  });
});

test.describe('Disponible pour les projets', () => {
  test('= revenus du foyer − charges communes − budgets de catégories', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      settings: { salaries: { lui: 0, elle: 0 }, mode: 'fixe', custom: { lui: 50, elle: 50 },
                  fixed: { lui: 1500, elle: 1500 }, idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
      charges: [
        { id: 'c1', name: 'Loyer', amount: 900, cls: 'besoin', scope: 'commune' },
        { id: 'c2', name: 'Crédit perso', amount: 200, cls: 'besoin', scope: 'lui' }, // perso : ne compte pas
      ],
      categories: [
        { id: 'courses', emoji: '🛒', name: 'Courses', budget: 400, cls: 'besoin' },
        { id: 'loisirs', emoji: '🎉', name: 'Loisirs', budget: 200, cls: 'envie' },
      ],
    });
    // 3000 − 900 (commune seulement) − 600 = 1500
    expect(await page.evaluate(() => disponiblePourProjets())).toBe(1500);
  });

  test('les mensualités de projets actifs sont comptées, pas celles des projets en pause', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      projects: [
        { id: 'p1', name: 'Voyage', emoji: '🌴', target: 3000, saved: 0, months: 10, mensuel: 300, day: 5, split: { lui: 50, elle: 50 }, cls: 'envie', status: 'actif', history: [] },
        { id: 'p2', name: 'Cuisine', emoji: '🍳', target: 5000, saved: 0, months: 20, mensuel: 250, day: 5, split: { lui: 50, elle: 50 }, cls: 'envie', status: 'pause', history: [] },
        { id: 'p3', name: 'Vieux', emoji: '📦', target: 100, saved: 0, months: 1, mensuel: 100, day: 5, split: { lui: 50, elle: 50 }, cls: 'envie', status: 'abandonne', history: [] },
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
      charges: [{ id: 'c1', name: 'Loyer', amount: 600, cls: 'besoin', scope: 'commune' }],
      categories: [
        { id: 'courses', emoji: '🛒', name: 'Courses', budget: 200, cls: 'besoin' },
        { id: 'loisirs', emoji: '🎉', name: 'Loisirs', budget: 100, cls: 'envie' },
      ],
      projects: [
        { id: 'p1', name: 'Apport', emoji: '🏡', target: 10000, saved: 0, months: 50, mensuel: 100, day: 5, split: { lui: 50, elle: 50 }, cls: 'invest', status: 'actif', history: [] },
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
        { id: 'e1', type: 'depense', amount: 50, cat: 'courses', who: 'elle', desc: 'Réelle', date: new Date().toISOString().slice(0, 10), prevision: false },
        { id: 'e2', type: 'depense', amount: 80, cat: 'courses', who: 'elle', desc: 'Prévue', date: new Date().toISOString().slice(0, 10), prevision: true },
      ],
    });
    expect(await page.evaluate(() => spentByCat('courses'))).toBe(50);
  });
});
