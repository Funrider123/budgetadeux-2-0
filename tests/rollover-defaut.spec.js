// Le report du solde devient le comportement par défaut, et un dépassement se règle au Money Date.
//
// Le signalement d'origine : un couple dépasse son enveloppe Courses en septembre et repart
// à zéro en octobre, comme si les euros n'étaient jamais sortis. L'app n'était pas neutre —
// elle faisait décider quoi faire d'un surplus, mais oubliait purement et simplement un
// dépassement. Ces tests verrouillent la symétrie retrouvée.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

/** Un couple avec une enveloppe à report, une cagnotte garnie, et des dépenses datées. */
async function installer(page, { budget = 500, cagnotte = 0, depensesParMois = {} } = {}) {
  await openApp(page);
  await loginAs(page, {
    categories: [{ id: 'env', emoji: '🛒', name: 'Courses', budget, cls: 'besoin',
                   rollover: true, rolloverStart: 0, rolloverFrom: null, rolloverMigre: true }],
    expenses: [],
    cagnotte: { balance: cagnotte, history: cagnotte ? [{ id: 'cag0', date: '2026-01-01', label: 'Mise de départ', amount: cagnotte }] : [] },
  });
  // Les dates sont calculées DANS la page : le test ne doit pas dépendre du mois où il tourne.
  await page.evaluate(({ depensesParMois }) => {
    const offsets = Object.keys(depensesParMois).map(Number);
    const plusAncien = offsets.length ? Math.min(...offsets) : 0;
    const d0 = new Date(); d0.setDate(1); d0.setMonth(d0.getMonth() + plusAncien);
    S.categories[0].rolloverFrom = `${d0.getFullYear()}-${d0.getMonth()}`;
    Object.entries(depensesParMois).forEach(([off, montants]) => {
      montants.forEach((amount, i) => {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + Number(off)); d.setDate(15);
        S.expenses.push({ id: `x${off}_${i}`, amount, date: d.toISOString().slice(0, 10),
                          desc: 'course', cat: 'env', who: 'elle', type: 'depense', prevision: false, note: '' });
      });
    });
    save();
  }, { depensesParMois });
}

const solde = (page, offset) => page.evaluate(o => catRolloverBalance('env', o), offset);

test.describe('Le report est le comportement par défaut', () => {
  // Le cœur de la bascule : les comptes existants en héritent, mais sans que l'app aille
  // inventer un passé. Un couple ne doit pas découvrir au réveil une dette de six mois.
  test('une enveloppe existante sans report bascule, en démarrant au mois courant', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const legacy = JSON.parse(JSON.stringify(S));
      legacy.categories = [{ id: 'env', emoji: '🛒', name: 'Courses', budget: 400, cls: 'besoin',
                             rollover: false, rolloverStart: 0, rolloverFrom: null }];
      const out = migrate(legacy);
      return { rollover: out.categories[0].rollover, from: out.categories[0].rolloverFrom,
               start: out.categories[0].rolloverStart, moisCourant: annualMonthKey(0) };
    });
    expect(r.rollover).toBe(true);
    expect(r.from).toBe(r.moisCourant); // aucun cumul antérieur
    expect(r.start).toBe(0);
  });

  // Sans ce garde-fou, une enveloppe que le couple a délibérément remise sans report serait
  // réactivée à chaque ouverture de l'app : on leur imposerait un choix au lieu d'en proposer un.
  test('une enveloppe volontairement sans report n\'est pas rebasculée', async ({ page }) => {
    await openApp(page);
    const rollover = await page.evaluate(() => {
      const legacy = JSON.parse(JSON.stringify(S));
      legacy.categories = [{ id: 'env', name: 'Courses', budget: 400, cls: 'besoin',
                             rollover: false, rolloverStart: 0, rolloverFrom: null, rolloverMigre: true }];
      return migrate(legacy).categories[0].rollover;
    });
    expect(rollover).toBe(false);
  });

  test('une enveloppe déjà en report garde son mois de départ et son solde d\'ouverture', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const legacy = JSON.parse(JSON.stringify(S));
      legacy.categories = [{ id: 'env', name: 'Courses', budget: 400, cls: 'besoin',
                             rollover: true, rolloverStart: 120, rolloverFrom: '2026-2' }];
      const c = migrate(legacy).categories[0];
      return { from: c.rolloverFrom, start: c.rolloverStart };
    });
    expect(r).toEqual({ from: '2026-2', start: 120 });
  });

  test('une catégorie neuve est créée avec le report activé', async ({ page }) => {
    await openApp(page);
    await loginAs(page, { categories: [] });
    await page.evaluate(() => { openEditCat(null); });
    await page.fill('#ceN', 'Essence');
    await page.fill('#ceB', '150');
    await page.click('.clsPick[data-cls="besoin"]');
    await page.click('#ceSave');

    const c = await page.evaluate(() => S.categories[S.categories.length - 1]);
    expect(c.rollover).toBe(true);
    expect(c.rolloverMigre).toBe(true); // sinon la migration la rebasculerait si on la désactive
  });
});

test.describe('Un dépassement se rattrape le mois suivant', () => {
  // Le signalement tel qu'il est arrivé : 500 € d'enveloppe, 580 € dépensés, et le mois
  // suivant qui repartait tranquillement à 500 €.
  test('80 € de trop en septembre, c\'est 80 € de moins en octobre', async ({ page }) => {
    await installer(page, { budget: 500, depensesParMois: { '-1': [580], '0': [] } });

    expect(await solde(page, -1)).toBeCloseTo(-80, 2);
    expect(await page.evaluate(() => catCarryIn('env', 0))).toBeCloseTo(-80, 2);
    expect(await page.evaluate(() => catAvailable('env', 0))).toBeCloseTo(420, 2);
  });

  test('et le libellé le dit dans les deux sens', async ({ page }) => {
    await installer(page, { budget: 500, depensesParMois: { '-1': [580] } });
    expect(await page.evaluate(() => carryLabel(catCarryIn('env', 0)))).toContain('à rattraper');
    expect(await page.evaluate(() => carryLabel(120))).toContain('reportés');
  });
});

test.describe('Couvrir un retard depuis la cagnotte', () => {
  // On ne peut pas « éponger » un dépassement : l'argent est sorti pour de vrai. La seule
  // source honnête est l'épargne commune — l'app interdit les transferts entre enveloppes.
  test('couvrir remonte l\'enveloppe et débite la cagnotte d\'autant', async ({ page }) => {
    await installer(page, { budget: 500, cagnotte: 300, depensesParMois: { '-1': [580] } });

    await page.evaluate(() => { S.ui.mdMonth = -1; openCoverDeficit('env', 80); });
    await page.click('#cdSave');

    expect(await solde(page, -1)).toBeCloseTo(0, 2);
    expect(await page.evaluate(() => S.cagnotte.balance)).toBeCloseTo(220, 2);
    expect(await page.evaluate(() => catCarryIn('env', 0))).toBeCloseTo(0, 2);
  });

  test('on ne peut pas prendre plus que ce que la cagnotte contient', async ({ page }) => {
    await installer(page, { budget: 500, cagnotte: 50, depensesParMois: { '-1': [580] } });

    await page.evaluate(() => { S.ui.mdMonth = -1; openCoverDeficit('env', 80); });
    await page.fill('#cdAmt', '500'); // on tente bien au-delà
    await page.click('#cdSave');

    expect(await page.evaluate(() => S.cagnotte.balance)).toBeCloseTo(0, 2);
    expect(await solde(page, -1)).toBeCloseTo(-30, 2); // le reste continue de se rattraper
  });

  test('annuler la couverture rend l\'argent à la cagnotte et remet le retard', async ({ page }) => {
    await installer(page, { budget: 500, cagnotte: 300, depensesParMois: { '-1': [580] } });
    await page.evaluate(() => { S.ui.mdMonth = -1; openCoverDeficit('env', 80); });
    await page.click('#cdSave');

    const r = await page.evaluate(() => {
      undoSurplusDecision(-1, 'env', 0);
      return { solde: catRolloverBalance('env', -1), cagnotte: S.cagnotte.balance,
               lignes: S.cagnotte.history.length };
    });
    expect(r.solde).toBeCloseTo(-80, 2);
    expect(r.cagnotte).toBeCloseTo(300, 2);
    expect(r.lignes).toBe(1); // la ligne de couverture a bien disparu
  });

  // Sans ardoise, le second téléphone — qui connaît encore la ligne — la repousserait au
  // prochain envoi et la cagnotte serait débitée deux fois d'une couverture annulée.
  test('la ligne de couverture annulée ne peut pas revenir par la synchro', async ({ page }) => {
    await installer(page, { budget: 500, cagnotte: 300, depensesParMois: { '-1': [580] } });
    await page.evaluate(() => { S.ui.mdMonth = -1; openCoverDeficit('env', 80); });
    await page.click('#cdSave');

    const efface = await page.evaluate(() => {
      const ligne = S.cagnotte.history.find(h => h.label.startsWith('Couverture'));
      undoSurplusDecision(-1, 'env', 0);
      return isDeleted(ligne.id);
    });
    expect(efface).toBe(true);
  });
});

// Le piège qui rendait les deux fonctionnalités incompatibles : realExpenses() ignore
// volontairement le type 'transfert' (ce n'est pas une dépense du couple). Sans correctif,
// l'argent envoyé à la cagnotte serait AUSSI reporté sur le mois suivant.
test.describe('Un surplus transféré ne sort pas deux fois', () => {
  test('ce qui part à la cagnotte quitte aussi l\'enveloppe', async ({ page }) => {
    await installer(page, { budget: 500, depensesParMois: { '0': [100] } });
    expect(await solde(page, 0)).toBeCloseTo(400, 2);

    await page.evaluate(() => { S.ui.mdMonth = 0; openSurplusTransfer('env', 400); });
    await page.fill('#stAmt', '250');
    await page.click('#stSave');

    expect(await solde(page, 0)).toBeCloseTo(150, 2);   // et non 400
    expect(await page.evaluate(() => S.cagnotte.balance)).toBeCloseTo(250, 2);
  });
});
