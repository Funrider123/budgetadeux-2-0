const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

// Versements automatiques des projets : chaque mois, à la date de versement, la mensualité
// prévue est créditée toute seule. Sans cela l'écran affichait éternellement « 0 € sur 3 000 € »
// alors que le couple mettait bien l'argent de côté — c'est le signalement qui a motivé l'ajout.
//
// Toute cette logique manipule de l'argent sans que personne ne la déclenche : le risque n'est
// pas qu'elle oublie un versement, c'est qu'elle en invente. D'où l'insistance sur l'idempotence
// et sur l'absence de rattrapage rétroactif.

// L'horloge est figée : sans cela, « le jour de versement est-il passé ? » donnerait un
// résultat différent selon la date à laquelle on lance les tests.
const LE_21_SEPTEMBRE = new Date('2026-09-21T10:00:00');

const projet = (over = {}) => Object.assign({
  id: 'p1', name: 'Vacance', emoji: '🌴', target: 3000, saved: 0,
  months: 10, mensuel: 300, day: 5, split: { lui: 50, elle: 50 },
  cls: 'envie', status: 'actif', history: [],
}, over);

async function ouvrirAvecProjet(page, p, dateFigee = LE_21_SEPTEMBRE) {
  await page.clock.install({ time: dateFigee });
  await openApp(page);
  await loginAs(page, { projects: [p] });
  return page;
}

const lireProjet = page => page.evaluate(() => ({
  saved: S.projects[0].saved,
  lignes: S.projects[0].history.length,
  auto: S.projects[0].history.filter(h => h.id && h.id.startsWith('auto_')).map(h => ({ id: h.id, date: h.date, amount: h.amount })),
}));

test.describe('Versements automatiques des projets', () => {
  test('la mensualité du mois en cours est créditée une fois la date de versement passée', async ({ page }) => {
    await ouvrirAvecProjet(page, projet()); // versement le 5, on est le 21
    await page.evaluate(() => versementsAutomatiques());

    const r = await lireProjet(page);
    expect(r.saved).toBe(300);
    expect(r.auto).toHaveLength(1);
    expect(r.auto[0].date).toBe('2026-09-05'); // daté du jour de versement, pas du jour d'ouverture
    expect(r.auto[0].amount).toBe(300);
  });

  // Le cœur du sujet. La fonction tourne à chaque ouverture de l'app et après chaque lecture
  // distante : si elle n'était pas rejouable sans effet, elle créditerait en boucle.
  test('la rejouer ne crédite jamais deux fois le même mois', async ({ page }) => {
    await ouvrirAvecProjet(page, projet());
    await page.evaluate(() => { versementsAutomatiques(); versementsAutomatiques(); versementsAutomatiques(); });

    const r = await lireProjet(page);
    expect(r.saved).toBe(300);
    expect(r.auto).toHaveLength(1);
  });

  // Même garantie, mais entre les deux téléphones du couple : l'id étant déduit du projet et du
  // mois, celui calculé en face est déjà connu ici. C'est exactement ce qui manquait à la
  // cagnotte, où un id tiré au hasard avait multiplié une ligne par trois.
  test('le versement calculé sur l\'autre téléphone porte le même identifiant, donc ne s\'ajoute pas', async ({ page }) => {
    await ouvrirAvecProjet(page, projet());
    await page.evaluate(() => versementsAutomatiques());
    const id = (await lireProjet(page)).auto[0].id;

    const apres = await page.evaluate((idDistant) => {
      // Ce que l'autre appareil aurait calculé de son côté pour le même mois.
      const dejaConnu = S.projects[0].history.some(h => h.id === idDistant);
      versementsAutomatiques();
      return { dejaConnu, saved: S.projects[0].saved, lignes: S.projects[0].history.length };
    }, id);

    expect(apres.dejaConnu).toBe(true);
    expect(apres.saved).toBe(300);
    expect(apres.lignes).toBe(1);
  });

  test('rien n\'est crédité tant que la date de versement du mois n\'est pas arrivée', async ({ page }) => {
    await ouvrirAvecProjet(page, projet({ day: 28 })); // on est le 21
    await page.evaluate(() => versementsAutomatiques());

    const r = await lireProjet(page);
    expect(r.saved).toBe(0);
    expect(r.auto).toHaveLength(0);
  });

  // Un projet créé hier ne doit pas se retrouver crédité de plusieurs mois d'un coup : on ne
  // remonte jamais avant le premier passage de la fonction.
  test('aucun rattrapage des mois antérieurs à la découverte du projet', async ({ page }) => {
    await ouvrirAvecProjet(page, projet());
    const r = await page.evaluate(() => {
      versementsAutomatiques();
      return { autoFrom: S.projects[0].autoFrom, saved: S.projects[0].saved };
    });

    expect(r.autoFrom).toBe('2026-8'); // getMonth() est indexé à zéro : 8 = septembre
    expect(r.saved).toBe(300);         // septembre seul, ni juillet ni août
  });

  // Un couple qui n'ouvre pas l'app pendant deux mois doit quand même retrouver son épargne :
  // sinon les chiffres ne correspondraient plus au plan, et le projet paraîtrait en retard.
  test('les mois écoulés depuis le dernier passage sont rattrapés, une fois chacun', async ({ page }) => {
    await ouvrirAvecProjet(page, projet({ autoFrom: '2026-6' })); // juillet
    await page.evaluate(() => versementsAutomatiques());

    const r = await lireProjet(page);
    expect(r.auto).toHaveLength(3); // juillet, août, septembre
    expect(r.saved).toBe(900);
    expect(r.auto.map(a => a.date).sort()).toEqual(['2026-07-05', '2026-08-05', '2026-09-05']);
  });

  // Choix assumé : un versement amputé (2 800 € au lieu de 3 100 €) donne l'impression de
  // piétiner au moment précis où le couple touche au but. Le dépassement est préférable.
  test('le dernier versement n\'est pas rogné : dépasser l\'objectif est permis', async ({ page }) => {
    await ouvrirAvecProjet(page, projet({ target: 3000, saved: 2900 }));
    await page.evaluate(() => versementsAutomatiques());

    const r = await lireProjet(page);
    expect(r.saved).toBe(3200);
    expect(r.auto[0].amount).toBe(300);
  });

  // La contrepartie : un projet terminé ne doit pas continuer à se créditer tous les mois.
  test('un objectif déjà atteint ne génère plus rien', async ({ page }) => {
    await ouvrirAvecProjet(page, projet({ target: 3000, saved: 3000 }));
    await page.evaluate(() => versementsAutomatiques());

    const r = await lireProjet(page);
    expect(r.saved).toBe(3000);
    expect(r.auto).toHaveLength(0);
  });

  test('un projet en pause ou abandonné n\'est pas crédité', async ({ page }) => {
    await ouvrirAvecProjet(page, projet({ status: 'pause' }));
    await page.evaluate(() => versementsAutomatiques());
    expect((await lireProjet(page)).saved).toBe(0);

    await page.evaluate(() => { S.projects[0].status = 'abandonne'; versementsAutomatiques(); });
    expect((await lireProjet(page)).saved).toBe(0);
  });

  test('une mensualité à zéro ne crée pas de ligne vide', async ({ page }) => {
    await ouvrirAvecProjet(page, projet({ mensuel: 0 }));
    await page.evaluate(() => versementsAutomatiques());

    const r = await lireProjet(page);
    expect(r.saved).toBe(0);
    expect(r.lignes).toBe(0);
  });

  // Un prélèvement au 31 ne doit pas sauter février : il tombe au dernier jour du mois.
  test('un versement daté du 31 tombe au dernier jour des mois plus courts', async ({ page }) => {
    await ouvrirAvecProjet(page, projet({ day: 31, autoFrom: '2026-1' }), new Date('2026-03-15T10:00:00'));
    await page.evaluate(() => versementsAutomatiques());

    const r = await lireProjet(page);
    expect(r.auto.map(a => a.date).sort()).toEqual(['2026-02-28']); // février crédité, mars pas encore (le 31 > 15)
  });

  // Le mode démonstration ne doit jamais rien écrire : il sert à montrer l'app, pas à
  // fabriquer des mouvements d'argent dans un budget d'exemple.
  test('la démonstration ne crédite rien', async ({ page }) => {
    await page.clock.install({ time: LE_21_SEPTEMBRE });
    await openApp(page);
    await page.evaluate(() => {
      demoMode = true;
      S.projects = [{ id: 'p1', name: 'Démo', target: 3000, saved: 0, mensuel: 300, day: 5, status: 'actif', history: [] }];
    });
    const change = await page.evaluate(() => versementsAutomatiques());

    expect(change).toBe(false);
    expect(await page.evaluate(() => S.projects[0].saved)).toBe(0);
  });

  // Supprimer une ligne créée automatiquement doit tenir : sans l'ardoise, elle reviendrait
  // au prochain passage, ce qui rendrait la suppression impossible.
  test('un versement automatique supprimé ne revient pas', async ({ page }) => {
    await ouvrirAvecProjet(page, projet());
    await page.evaluate(() => versementsAutomatiques());
    const id = (await lireProjet(page)).auto[0].id;

    await page.evaluate((idSupprime) => {
      markDeleted([idSupprime]);
      S.projects[0].history = S.projects[0].history.filter(h => h.id !== idSupprime);
      S.projects[0].saved = 0;
      versementsAutomatiques();
    }, id);

    const r = await lireProjet(page);
    expect(r.saved).toBe(0);
    expect(r.auto).toHaveLength(0);
  });
});
