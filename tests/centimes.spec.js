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

test.describe('Un espace dans un montant est refusé, jamais rogné', () => {
  // Signalé par un utilisateur : « 13, 13 » enregistrait 13 €. parseFloat s'arrête au premier
  // espace, donc « 1 250,50 » enregistrait 1 € — une perte de 1 249,50 € sans le moindre signal.
  // La règle retenue : un espace à l'intérieur d'un montant bloque l'enregistrement.
  async function ajouter(page, montant) {
    await openApp(page);
    await loginAs(page, { expenses: [], pilotFrozen: false });
    await page.evaluate(m => {
      draft = { amount: m, date: iso(0), desc: 'Test', cat: S.categories[0].id,
                merchant: '', prevision: false, cagnotte: false, who: '' };
      go('ajouter');
    }, montant);
    await page.click('#dSave');
    return page.evaluate(() => ({ nb: S.expenses.length, montant: (S.expenses[0] || {}).amount }));
  }

  test('« 13, 13 » est refusé au lieu d\'enregistrer 13 €', async ({ page }) => {
    expect((await ajouter(page, '13, 13')).nb).toBe(0);
  });

  test('« 1 250,50 » est refusé au lieu d\'enregistrer 1 €', async ({ page }) => {
    expect((await ajouter(page, '1 250,50')).nb).toBe(0);
  });

  test('le message dit quoi corriger, avant même de cliquer', async ({ page }) => {
    await openApp(page);
    await loginAs(page, { expenses: [], pilotFrozen: false });
    await page.evaluate(() => {
      draft = { amount: '13, 13', date: iso(0), desc: 'Test', cat: S.categories[0].id,
                merchant: '', prevision: false, cagnotte: false, who: '' };
      go('ajouter');
    });
    await expect(page.locator('#dMissingHint')).toBeVisible();
    expect(await page.textContent('#dMissingHint')).toContain("Retirez l'espace");
  });

  test('les saisies correctes passent toujours, centimes compris', async ({ page }) => {
    expect((await ajouter(page, '13,13')).montant).toBe(13.13);
    expect((await ajouter(page, '1250,50')).montant).toBe(1250.5);
    expect((await ajouter(page, '13.13')).montant).toBe(13.13);
  });

  test('« 13 € » reste accepté : le symbole final n\'est pas un espace de trop', async ({ page }) => {
    expect((await ajouter(page, '13 €')).montant).toBe(13);
  });

  test('les espaces autour du montant ne gênent pas', async ({ page }) => {
    expect((await ajouter(page, '  13,13  ')).montant).toBe(13.13);
  });

  // Deuxième faute de la même famille : .replace(',','.') ne convertissait que la PREMIÈRE
  // virgule, donc « 1,300,50 » — un séparateur de milliers, réflexe courant — s'enregistrait
  // à 1,30 € sans le moindre signal.
  test('deux virgules sont refusées au lieu d\'enregistrer 1,30 €', async ({ page }) => {
    expect((await ajouter(page, '1,300,50')).nb).toBe(0);
  });

  test('une virgule mélangée à un point est refusée', async ({ page }) => {
    expect((await ajouter(page, '1.300,50')).nb).toBe(0);
    expect((await ajouter(page, '1.300.50')).nb).toBe(0);
  });

  test('un seul séparateur reste accepté, virgule comme point', async ({ page }) => {
    expect((await ajouter(page, '1250,50')).montant).toBe(1250.5);
    expect((await ajouter(page, '1250.50')).montant).toBe(1250.5);
  });

  test('le message distingue les deux fautes', async ({ page }) => {
    await openApp(page);
    const msgs = await page.evaluate(() => ({
      espace: amtError('13, 13'),
      separateur: amtError('1,300,50'),
      bon: amtError('1250,50'),
    }));
    expect(msgs.espace).toContain("Retirez l'espace");
    expect(msgs.separateur).toContain('Un seul séparateur');
    expect(msgs.bon).toBe('');
  });

  // Le Pilotage enregistre à chaque frappe : il n'y a pas de bouton où bloquer, donc un
  // loyer tapé « 1 250 » s'y écrivait à 1 € encore plus discrètement qu'ailleurs.
  test.describe('Pilotage : la saisie fautive n\'écrase pas la valeur en place', () => {
    async function pilotage(page) {
      await openApp(page);
      await loginAs(page, {
        charges: [{ id: 'c1', name: 'Loyer', amount: 950, cls: 'besoin', scope: 'commune' }],
        pilotFrozen: false,
      });
      await page.evaluate(() => go('pilotage'));
      await page.waitForSelector('.pamt-input', { state: 'attached' });
    }
    const taper = (page, v) => page.evaluate(val => {
      const el = document.querySelector('[data-charge].pamt-input');
      el.value = val; onChargeInput(el);
      return { montant: S.charges[0].amount, signale: !!el.dataset.amtBad };
    }, v);

    test('« 1 250 » laisse le loyer à 950 € au lieu de l\'écraser à 1 €', async ({ page }) => {
      await pilotage(page);
      const r = await taper(page, '1 250');
      expect(r.montant).toBe(950);
      expect(r.signale).toBe(true);
    });

    test('corriger la saisie débloque et enregistre', async ({ page }) => {
      await pilotage(page);
      await taper(page, '1 250');
      const r = await taper(page, '1250');
      expect(r.montant).toBe(1250);
      expect(r.signale).toBe(false);
    });

    test('« 1,300,50 » n\'écrase pas non plus le loyer en place', async ({ page }) => {
      await pilotage(page);
      const r = await taper(page, '1,300,50');
      expect(r.montant).toBe(950);
      expect(r.signale).toBe(true);
    });

    test('le curseur reste utilisable : sa valeur n\'a jamais d\'espace', async ({ page }) => {
      await pilotage(page);
      const montant = await page.evaluate(() => {
        const sl = document.querySelector('.mini-slider');
        sl.value = '700'; onChargeInput(sl);
        return S.charges[0].amount;
      });
      expect(montant).toBe(700);
    });

    test('une contribution fixe fautive ne s\'enregistre pas non plus', async ({ page }) => {
      await openApp(page);
      await loginAs(page, { pilotFrozen: false,
        settings: { salaries: { lui: 0, elle: 0 }, mode: 'fixe', custom: { lui: 50, elle: 50 },
                    fixed: { lui: 1000, elle: 1000 },
                    idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } } });
      await page.evaluate(() => go('pilotage'));
      const r = await page.evaluate(() => {
        const el = document.querySelector('#fixLui');
        el.value = '1 500'; el.oninput();
        const avecEspace = S.settings.fixed.lui;
        el.value = '1500'; el.oninput();
        return { avecEspace, corrige: S.settings.fixed.lui };
      });
      expect(r.avecEspace).toBe(1000);
      expect(r.corrige).toBe(1500);
    });
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

  test('le calendrier reste juste sur 5 ans, jour par jour', async ({ page }) => {
    await openApp(page);
    // On simule CHAQUE jour de 2026 à 2030 (bissextile 2028 comprise) et on vérifie que les
    // 12 derniers mois restent 12 mois distincts, que le nombre de jours colle au vrai
    // calendrier, et que les semaines couvrent le mois sans trou ni chevauchement.
    const rapport = await page.evaluate(() => {
      const Real = Date;
      const mock = (y, m, d) => {
        const f = new Real(y, m, d, 12);
        class M extends Real {
          constructor(...a) { a.length === 0 ? super(f.getTime()) : super(...a); }
          static now() { return f.getTime(); }
        }
        window.Date = M;
      };
      const JOURS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      const bissextile = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      const erreurs = []; let jours = 0;
      for (let y = 2026; y <= 2030 && erreurs.length < 5; y++) {
        for (let m = 0; m < 12 && erreurs.length < 5; m++) {
          const dim = m === 1 && bissextile(y) ? 29 : JOURS[m];
          for (let d = 1; d <= dim && erreurs.length < 5; d++) {
            mock(y, m, d); jours++;
            const cles = []; for (let o = 0; o > -12; o--) cles.push(annualMonthKey(o));
            if (new Set(cles).size !== 12) erreurs.push(`${y}-${m + 1}-${d}: mois non distincts`);
            const w = weekOfMonthInfo();
            if (w.daysInMonth !== dim) erreurs.push(`${y}-${m + 1}: ${w.daysInMonth} jours ≠ ${dim}`);
            let somme = 0;
            for (let i = 1; i <= w.totalWeeks; i++) somme += weekDaysInMonthAt(i, w.dow1, w.daysInMonth);
            if (somme !== dim) erreurs.push(`${y}-${m + 1}: semaines ${somme} ≠ ${dim}`);
            if (!monthLabel(0).endsWith(String(y))) erreurs.push(`${y}-${m + 1}-${d}: ${monthLabel(0)}`);
          }
        }
      }
      window.Date = Real;
      return { jours, erreurs };
    });
    expect(rapport.erreurs).toEqual([]);
    expect(rapport.jours).toBe(1826); // 5 ans dont une bissextile
  });

  test('l\'axe des 12 mois indique l\'année quand elle change', async ({ page }) => {
    await openApp(page);
    const axes = await page.evaluate(() => {
      const Real = Date;
      const mock = (y, m, d) => {
        const f = new Real(y, m, d, 12);
        class M extends Real {
          constructor(...a) { a.length === 0 ? super(f.getTime()) : super(...a); }
          static now() { return f.getTime(); }
        }
        window.Date = M;
      };
      const lire = () => annualAxisMonths().map(m => m.ini + (m.yearMark ? "'" + m.yearMark : '')).join(' ');
      const out = {};
      mock(2026, 7, 30); out.aout2026 = lire();   // à cheval : sept. 2025 → août 2026
      mock(2027, 0, 15); out.janv2027 = lire();   // à cheval : fév. 2026 → janv. 2027
      mock(2026, 11, 15); out.dec2026 = lire();   // une seule année civile
      window.Date = Real;
      return out;
    });
    expect(axes.aout2026).toBe("S'25 O N D J'26 F M A M J J A");
    expect(axes.janv2027).toBe("F'26 M A M J J A S O N D J'27");
    expect(axes.dec2026).toBe("J'26 F M A M J J A S O N D");
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
