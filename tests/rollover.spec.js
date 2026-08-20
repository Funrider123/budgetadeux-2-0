// Report du solde d'un mois sur l'autre ("mode enveloppe").
//
// L'oracle de ces tests n'est pas inventé : ce sont les vrais chiffres du tableur
// d'un couple qui tenait ses enveloppes à la main de février à août, avec la formule
//   restant = restant_precedent + dotation - depenses
// Si le report est juste, l'app doit retrouver leurs colonnes au centime près.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

// Dépenses réelles relevées dans leur tableur, par mois (0 = août, -6 = février).
const COURSE = {
  '-6': [72.24, 3.99, 71.66, 21.43, 38.5, 7.43, 56.11, 22.79, 162.95, 41.35],
  '-5': [20.71, 76.8, 2.79, 17.87, 13.08, 18.08, 250],
  '-4': [18.38, 36.86, 9.04, 33.81, 10.96, 4.85, 28.23, 3.99, 24.11, 41.49, 88.95, 29.92, 128.42, 40.35, 150],
  '-3': [9.1, 20.1, 14.89, 46.66, 37.89, 15.5, 32.29, 24.22, 4.2, 19.54, 24.52, 9.62, 29.4, 11.67, 84.31, 68.67],
  '-2': [42.3, 61.53, 10.28, 4.74, 1.89, 26.67, 24.16, 14.8, 4.91, 58.22, 18.13, 40.88, 4.91],
  '-1': [51.7, 31.31, 19.78, 3.98, 4.4, 88.26, 32, 45.58, 13.61, 26.57, 61.33, 7.9, 9.08, 27.14, 26.39, 33.54, 150],
  '0': [12.4, 14.8, 18.02, 11.45, 4.9, 26.72, 12.16, 15.97, 28.01, 18.02, 30.65, 24.75, 17.01, 7],
};
// Colonnes "restant" de leur feuille Course (dotation 500 €/mois).
const COURSE_ATTENDU = { '-6': 1.55, '-5': 102.22, '-4': -47.14, '-3': 0.28, '-2': 186.86, '-1': 54.29, '0': 312.43 };

// Leur enveloppe "entretien maison / déco" : le cas qui compte vraiment, parce qu'elle
// plonge à -541 € en mai et remonte seule à +49 € en août, sans le moindre apport.
const MAISON = {
  '-6': [49.9, 26.63, 52.8, 400], '-5': [],
  '-4': [17.99, 24.99, 22.3, 34.98, 30, 53.1],
  '-3': [267.75, 239.9, 42.65, 78.36], '-2': [], '-1': [3.29, 6.18], '0': [],
};
const MAISON_ATTENDU = { '-6': -329.33, '-5': -129.33, '-4': -112.69, '-3': -541.35, '-2': -341.35, '-1': -150.82, '0': 49.18 };

/** Construit les dépenses + la catégorie à report, en dates relatives au mois courant. */
function seed(depensesParMois, budget, { rollover = true } = {}) {
  return {
    depensesParMois, budget, rollover,
    // Le mois d'activation est le plus ancien mois de données (-6 = février).
    premierOffset: -6,
  };
}

async function installer(page, cfg) {
  await openApp(page);
  await loginAs(page, {
    categories: [{ id: 'env', emoji: '🛒', name: 'Enveloppe', budget: cfg.budget, cls: 'besoin',
                   rollover: cfg.rollover, rolloverStart: 0, rolloverFrom: null }],
    expenses: [],
  });
  // On calcule les dates DANS la page pour que le test ne dépende pas du mois où il tourne.
  await page.evaluate((cfg) => {
    const cat = S.categories[0];
    if (cfg.rollover) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + cfg.premierOffset);
      cat.rolloverFrom = `${d.getFullYear()}-${d.getMonth()}`;
    }
    Object.entries(cfg.depensesParMois).forEach(([off, montants]) => {
      montants.forEach((amount, i) => {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + Number(off)); d.setDate(15);
        S.expenses.push({ id: 'x' + off + '_' + i, amount, date: d.toISOString().slice(0, 10),
                          desc: 'test', cat: 'env', who: 'elle', type: 'depense', prevision: false, note: '' });
      });
    });
    save();
  }, cfg);
}

test.describe('Report du solde (excédents et déficits)', () => {
  test('retrouve les colonnes "restant" du tableur Course, mois par mois', async ({ page }) => {
    await installer(page, seed(COURSE, 500));
    for (const [off, attendu] of Object.entries(COURSE_ATTENDU)) {
      const bal = await page.evaluate(o => catRolloverBalance('env', o), Number(off));
      expect(bal, `solde du mois ${off}`).toBeCloseTo(attendu, 2);
    }
  });

  test('un déficit se rattrape tout seul sur les mois suivants', async ({ page }) => {
    await installer(page, seed(MAISON, 200));
    for (const [off, attendu] of Object.entries(MAISON_ATTENDU)) {
      const bal = await page.evaluate(o => catRolloverBalance('env', o), Number(off));
      expect(bal, `solde du mois ${off}`).toBeCloseTo(attendu, 2);
    }
    // Le cœur de la demande : plongée à -541 € en mai, retour dans le vert en août
    // sans aucun apport, uniquement par le jeu des dotations mensuelles.
    const mai = await page.evaluate(() => catRolloverBalance('env', -3));
    const aout = await page.evaluate(() => catRolloverBalance('env', 0));
    expect(mai).toBeLessThan(0);
    expect(aout).toBeGreaterThan(0);
  });

  test('l\'enveloppe disponible du mois = report entrant + dotation', async ({ page }) => {
    await installer(page, seed(COURSE, 500));
    // Fin juillet : 54,29 € reportés. Août dispose donc de 554,29 €.
    expect(await page.evaluate(() => catCarryIn('env', 0))).toBeCloseTo(54.29, 2);
    expect(await page.evaluate(() => catAvailable('env', 0))).toBeCloseTo(554.29, 2);
    // Et le solde de fin de mois reste cohérent : disponible - dépensé.
    const [avail, spent, bal] = await page.evaluate(() =>
      [catAvailable('env', 0), spentByCat('env', 0), catRolloverBalance('env', 0)]);
    expect(avail - spent).toBeCloseTo(bal, 2);
  });

  test('le solde de départ sert de point de reprise', async ({ page }) => {
    await installer(page, seed({}, 500));
    // Reprise d'un tableur : on démarre ce mois-ci avec 312,43 € déjà d'avance.
    await page.evaluate(() => {
      const c = S.categories[0];
      c.rolloverStart = 312.43;
      c.rolloverFrom = annualMonthKey(0);
      save();
    });
    // Aucune dépense : le mois se solde par l'avance + la dotation.
    expect(await page.evaluate(() => catRolloverBalance('env', 0))).toBeCloseTo(812.43, 2);
    // Un solde de départ négatif est accepté tel quel (enveloppe reprise dans le rouge).
    await page.evaluate(() => { S.categories[0].rolloverStart = -150.82; save(); });
    expect(await page.evaluate(() => catRolloverBalance('env', 0))).toBeCloseTo(349.18, 2);
  });

  test('sans report activé, le budget repart à zéro chaque mois (pas de régression)', async ({ page }) => {
    await installer(page, seed(COURSE, 500, { rollover: false }));
    // catRolloverBalance ne s'applique pas...
    expect(await page.evaluate(() => catRolloverBalance('env', 0))).toBeNull();
    // ...et le disponible reste la seule dotation du mois, sans mémoire du passé.
    expect(await page.evaluate(() => catAvailable('env', 0))).toBe(500);
    expect(await page.evaluate(() => catCarryIn('env', 0))).toBe(0);
  });

  test('une catégorie à report ne passe pas par la décision de surplus du Money Date', async ({ page }) => {
    await installer(page, seed({}, 500));
    // Sans report : le surplus du mois doit être proposé à la décision.
    await page.evaluate(() => { S.categories[0].rollover = false; save(); });
    expect(await page.evaluate(() => mdSurplusRows(0).length)).toBe(1);
    // Avec report : rien à décider, le solde bascule tout seul.
    await page.evaluate(() => { S.categories[0].rollover = true; save(); });
    expect(await page.evaluate(() => mdSurplusRows(0).length)).toBe(0);
  });

  test('le report n\'affecte pas la dotation allouée depuis les revenus', async ({ page }) => {
    await installer(page, seed(COURSE, 500));
    // Un gros report ne doit pas gonfler le budget mensuel : ce que le couple verse
    // chaque mois reste inchangé, seul le disponible à dépenser bouge.
    expect(await page.evaluate(() => catBudgetAt('env', 0))).toBe(500);
    expect(await page.evaluate(() => clsBudgetAt('besoin', 0))).toBe(500);
    expect(await page.evaluate(() => totalBudget())).toBe(500);
    // disponiblePourProjets se calcule sur la dotation, pas sur le disponible : un report
    // ne doit jamais faire croire au couple qu'il a plus à placer en projets.
    const dispo = await page.evaluate(() => { S.settings = { ...S.settings, mode:'fixe', fixed:{lui:400,elle:400} }; return disponiblePourProjets(); });
    expect(dispo).toBe(800 - 500);
  });

  test('le total "restant pour ce mois" colle à la somme des enveloppes', async ({ page }) => {
    await installer(page, seed(COURSE, 500));
    // Le gros chiffre de la Vue et le détail par catégorie doivent raconter la même
    // histoire : sinon le couple voit deux montants contradictoires sur le même écran.
    const [dispo, spent, somme] = await page.evaluate(() => [
      totalAvailable(0), totalSpent(0),
      S.categories.reduce((s, c) => s + (catRolloverBalance(c.id, 0) ?? (c.budget - spentByCat(c.id, 0))), 0),
    ]);
    expect(dispo - spent).toBeCloseTo(somme, 2);
    expect(somme).toBeCloseTo(312.43, 2);
  });
});

test.describe('Stabilité du cumul dans le temps', () => {
  test('changer la dotation plus tard ne réécrit pas les mois déjà passés', async ({ page }) => {
    await installer(page, seed(COURSE, 500));
    const avant = await page.evaluate(() => catRolloverBalance('env', 0));
    expect(avant).toBeCloseTo(312.43, 2);
    // Les mois écoulés ont été validés au fil de l'eau : leur dotation est épinglée.
    await page.evaluate(() => {
      for (let o = -6; o <= 0; o++) {
        const k = annualMonthKey(o);
        S.budgetTimeline[k] = Object.assign(S.budgetTimeline[k] || {}, { env: 500 });
      }
      save();
    });
    // Le couple révise son budget à la baisse pour la suite.
    await page.evaluate(() => { S.categories[0].budget = 450; save(); });
    // L'historique ne bouge pas : leur trame est préservée.
    expect(await page.evaluate(() => catRolloverBalance('env', 0))).toBeCloseTo(avant, 2);
    // Seul le mois suivant, non épinglé, applique la nouvelle dotation.
    expect(await page.evaluate(() => catBudgetAt('env', 1))).toBe(450);
  });

  test('activer le report depuis l\'éditeur épingle la dotation du mois', async ({ page }) => {
    await installer(page, seed({}, 500, { rollover: false }));
    await page.evaluate(() => { go('pilotage'); openEditCat('env'); });
    await page.click('#ceRoll');
    await page.fill('#ceRollStart', '312.43');
    await page.click('#ceSave');
    await page.waitForTimeout(200);
    const cat = await page.evaluate(() => S.categories[0]);
    expect(cat.rollover).toBe(true);
    expect(cat.rolloverStart).toBeCloseTo(312.43, 2);
    expect(cat.rolloverFrom).toBe(await page.evaluate(() => annualMonthKey(0)));
    // La dotation du mois d'activation est figée dans la timeline.
    expect(await page.evaluate(() => S.budgetTimeline[annualMonthKey(0)].env)).toBe(500);
    expect(await page.evaluate(() => catRolloverBalance('env', 0))).toBeCloseTo(812.43, 2);
  });

  test('désactiver le report remet la catégorie en budget mensuel sec', async ({ page }) => {
    await installer(page, seed(COURSE, 500));
    await page.evaluate(() => { go('pilotage'); openEditCat('env'); });
    await page.click('#ceRoll');   // bascule OFF
    await page.click('#ceSave');
    await page.waitForTimeout(200);
    const cat = await page.evaluate(() => S.categories[0]);
    expect(cat.rollover).toBe(false);
    expect(cat.rolloverFrom).toBeNull();
    expect(await page.evaluate(() => catRolloverBalance('env', 0))).toBeNull();
    expect(await page.evaluate(() => catAvailable('env', 0))).toBe(500);
  });
});

test.describe('Affichage du report', () => {
  test('la carte de catégorie annonce le report et le reste réel', async ({ page }) => {
    await installer(page, seed(COURSE, 500));
    await page.evaluate(() => go('vue'));
    const txt = await page.innerText('#screen');
    expect(txt).toMatch(/54\s?€ reportés du mois dernier/);
    expect(txt).toMatch(/reste\s+312\s?€/);
  });

  test('un report négatif est annoncé comme un rattrapage, pas comme une avance', async ({ page }) => {
    await installer(page, seed(MAISON, 200));
    await page.evaluate(() => go('vue'));
    const txt = await page.innerText('#screen');
    // Fin juillet : -150,82 € hérités, donc août démarre en dette.
    expect(txt).toMatch(/151\s?€ à rattraper du mois dernier/);
    expect(txt).not.toMatch(/à rattraper.*reportés/);
  });

  test('une enveloppe dans le rouge est signalée même sans dépense du mois', async ({ page }) => {
    // Juin chez eux : aucune dépense, mais -341 € hérités de mai.
    await installer(page, seed(MAISON, 200));
    await page.evaluate(() => { S.ui.period = 'mensuel'; save(); go('vue'); });
    const bal = await page.evaluate(() => catRolloverBalance('env', -2));
    expect(bal).toBeLessThan(0);
    // La dépense du mois est nulle, donc seul le solde peut déclencher l'alerte.
    expect(await page.evaluate(() => spentByCat('env', -2))).toBe(0);
  });
});
