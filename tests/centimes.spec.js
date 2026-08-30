// Les centimes, et le bug qui les détruisait silencieusement.
//
// Avant : « Ajouter une charge » acceptait bien 29,99 et l'enregistrait, mais la ligne
// l'affichait « 30 » — et la moindre retouche de cette ligne écrivait réellement 30 en base.
// Quelqu'un qui saisissait soigneusement ses prélèvements se retrouvait avec un total faux.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

const PRELEVEMENTS = [
  { id: 'c1', emoji: '📄', name: 'Assurance maison', amount: 50.73, scope: 'commune', cls: 'besoin' },
  { id: 'c2', emoji: '📄', name: 'Total Énergie', amount: 170, scope: 'commune', cls: 'besoin' },
  { id: 'c3', emoji: '📄', name: 'Orange', amount: 29.99, scope: 'commune', cls: 'besoin' },
];

async function pilotage(page) {
  await openApp(page);
  await loginAs(page, { charges: PRELEVEMENTS, pilotFrozen: false });
  await page.evaluate(() => go('pilotage'));
}

test.describe('Affichage : les centimes seulement s\'ils existent', () => {
  test('un montant rond reste sans décimales, un montant précis les garde', async ({ page }) => {
    await openApp(page);
    const vus = await page.evaluate(() => ({
      rond: fmt(170), cents: fmt(29.99), zero: fmt(0),
      // 50,73 + 170 + 29,99 : le total doit être exact, pas arrondi à 251 €
      total: fmt(50.73 + 170 + 29.99),
      negatif: fmt(-150.82),
    }));
    expect(vus.rond).toBe('170 €');
    expect(vus.cents).toBe('29,99 €');
    expect(vus.zero).toBe('0 €');
    expect(vus.total).toBe('250,72 €');
    expect(vus.negatif).toBe('-150,82 €');
  });

  test('les estimations restent arrondies : pas de fausse précision', async ({ page }) => {
    await openApp(page);
    // Projections « à ce rythme », moyennes mensuelles, budget hebdomadaire : ce sont des
    // extrapolations, pas des montants constatés.
    const vus = await page.evaluate(() => ({ projection: fmtEst(1234.5678), moyenne: fmtEst(29.99) }));
    // \s : le séparateur de milliers français est une espace insécable fine, pas une espace ordinaire.
    expect(vus.projection).toMatch(/^1\s235\s€$/);
    expect(vus.moyenne).toBe('30 €');
  });
});

test.describe('Saisie : les centimes survivent', () => {
  test('retoucher une ligne ne détruit plus les centimes', async ({ page }) => {
    await pilotage(page);
    // Le geste exact qui perdait les 0,99 : retaper la même valeur dans la ligne.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.pamt-input')][2];
      el.value = '29,99';
      onChargeInput(el);
    });
    expect(await page.evaluate(() => S.charges[2].amount)).toBe(29.99);
  });

  test('la virgule du clavier français est acceptée', async ({ page }) => {
    await pilotage(page);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.pamt-input')][0];
      el.value = '12,45';
      onChargeInput(el);
    });
    expect(await page.evaluate(() => S.charges[0].amount)).toBe(12.45);
  });

  test('les champs montants ne sont jamais en type=number (il rejette la virgule)', async ({ page }) => {
    await pilotage(page);
    const types = await page.evaluate(() =>
      [...document.querySelectorAll('.pamt-input')].map(i => i.getAttribute('type')));
    expect(types.length).toBeGreaterThan(0);
    types.forEach(t => expect(t).toBe('text'));
  });

  test('le champ affiche la virgule française, pas le point', async ({ page }) => {
    await pilotage(page);
    const vals = await page.evaluate(() =>
      [...document.querySelectorAll('.pamt-input')].map(i => i.value));
    expect(vals[0]).toBe('50,73');
    expect(vals[1]).toBe('170'); // rond : pas de ",00" inutile
  });

  test('un total de charges garde ses centimes', async ({ page }) => {
    await pilotage(page);
    expect(await page.evaluate(() => round2(chargesCommunes()))).toBe(250.72);
  });
});

test.describe('Arithmétique des mois (bug des 29/30/31)', () => {
  // setMonth() sans remettre le jour à 1 déborde quand le mois visé est plus court :
  // le 30 août, « il y a 6 mois » donnait le 2 mars au lieu de février — l'app lisait
  // alors les dépenses du mauvais mois pendant les derniers jours de chaque mois.
  test('une dépense de février est comptée en février, même un 30 du mois', async ({ page }) => {
    await openApp(page);
    const ok = await page.evaluate(() => {
      const cible = new Date(); cible.setDate(1); cible.setMonth(cible.getMonth() - 6);
      const jour = `${cible.getFullYear()}-${String(cible.getMonth() + 1).padStart(2, '0')}-15`;
      return { dansLeBonMois: inMonth(jour, -6), pasDansLeSuivant: inMonth(jour, -5) };
    });
    expect(ok.dansLeBonMois).toBe(true);
    expect(ok.pasDansLeSuivant).toBe(false);
  });

  test('chaque mois de l\'année est atteignable, sans doublon ni trou', async ({ page }) => {
    await openApp(page);
    const mois = await page.evaluate(() => {
      const vus = [];
      for (let o = 0; o > -12; o--) {
        const n = new Date(); n.setDate(1); n.setMonth(n.getMonth() + o);
        vus.push(`${n.getFullYear()}-${n.getMonth()}`);
      }
      return vus;
    });
    expect(new Set(mois).size).toBe(12); // 12 mois distincts : aucun compté deux fois
  });

  test('« dans un mois » ne saute pas un mois entier depuis un 31', async ({ page }) => {
    await openApp(page);
    // 31 janvier + 1 mois doit donner le 28 février, pas le 3 mars.
    const r = await page.evaluate(() => {
      const d = addMonths(new Date(2026, 0, 31), 1);
      return { mois: d.getMonth(), jour: d.getDate() };
    });
    expect(r.mois).toBe(1); // février
    expect(r.jour).toBe(28);
  });
});
