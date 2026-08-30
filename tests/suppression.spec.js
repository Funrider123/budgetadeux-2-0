// Une suppression doit tenir — y compris face à la synchro.
//
// Le bug : pushState relit l'état distant avant d'écrire (pour ne pas écraser un ajout du
// partenaire non encore reçu), y retrouvait la ligne qu'on venait d'effacer, et la
// réintroduisait. La dépense supprimée réapparaissait donc toute seule quelques secondes après.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

const DEUX_DEPENSES = {
  categories: [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 300, cls: 'besoin' }],
  expenses: [
    { id: 'garder', type: 'depense', amount: 20, cat: 'courses', who: 'elle', desc: 'À garder', date: '2026-08-18', prevision: false },
    { id: 'aSupprimer', type: 'depense', amount: 42, cat: 'courses', who: 'elle', desc: 'Erreur de saisie', date: '2026-08-18', prevision: false },
  ],
};

/** Le cloud contient l'état courant : c'est le cas normal avant toute suppression. */
async function cloudRefleteLetat(page) {
  await page.evaluate(() => {
    const remote = {}; SYNC_KEYS.forEach(k => remote[k] = JSON.parse(JSON.stringify(S[k])));
    window.__mock.tables.couple_state = [{
      couple_code: S.auth.coupleCode, data: remote,
      updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'telephone-du-partenaire',
    }];
  });
}

test.describe('Suppression et synchro', () => {
  test('une dépense supprimée ne revient pas après la synchro', async ({ page }) => {
    await openApp(page);
    await loginAs(page, DEUX_DEPENSES);
    await cloudRefleteLetat(page);

    await page.evaluate(() => openExpenseSheet('aSupprimer'));
    await page.click('#exDel');
    await page.evaluate(() => pushState());

    expect(await page.evaluate(() => S.expenses.map(e => e.id))).toEqual(['garder']);
  });

  test('elle ne revient pas non plus quand le partenaire repousse un état qui la contient encore', async ({ page }) => {
    await openApp(page);
    await loginAs(page, DEUX_DEPENSES);
    await cloudRefleteLetat(page);

    await page.evaluate(() => openExpenseSheet('aSupprimer'));
    await page.click('#exDel');

    // Le partenaire, qui n'a pas encore reçu la suppression, renvoie son propre état.
    await page.evaluate(() => pullState());

    expect(await page.evaluate(() => S.expenses.map(e => e.id))).toEqual(['garder']);
  });

  test('la suppression est transmise au partenaire, pas seulement locale', async ({ page }) => {
    await openApp(page);
    await loginAs(page, DEUX_DEPENSES);
    await cloudRefleteLetat(page);

    await page.evaluate(() => openExpenseSheet('aSupprimer'));
    await page.click('#exDel');
    await page.evaluate(() => pushState());

    const envoye = await page.evaluate(() => {
      const ups = window.__mock.calls.upsert.filter(u => u.table === 'couple_state');
      return ups[ups.length - 1].row.data;
    });
    expect(envoye.expenses.map(e => e.id)).toEqual(['garder']);
    expect(Object.keys(envoye.deleted)).toContain('aSupprimer'); // l'ardoise voyage aussi
  });

  test('un ajout du partenaire est toujours récupéré : la correction ne casse pas la fusion', async ({ page }) => {
    await openApp(page);
    await loginAs(page, DEUX_DEPENSES);
    // Le partenaire a ajouté SA dépense, qu'on n'a pas encore reçue.
    await page.evaluate(() => {
      const remote = {}; SYNC_KEYS.forEach(k => remote[k] = JSON.parse(JSON.stringify(S[k])));
      remote.expenses = remote.expenses.concat([{ id: 'duPartenaire', type: 'depense', amount: 15,
        cat: 'courses', who: 'lui', desc: 'Chez lui', date: '2026-08-18', prevision: false }]);
      window.__mock.tables.couple_state = [{ couple_code: S.auth.coupleCode, data: remote,
        updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'telephone-du-partenaire' }];
    });

    await page.evaluate(() => openExpenseSheet('aSupprimer'));
    await page.click('#exDel');
    await page.evaluate(() => pushState());

    const ids = await page.evaluate(() => S.expenses.map(e => e.id).sort());
    expect(ids).toEqual(['duPartenaire', 'garder']); // l'ajout arrive, la suppression tient
  });

  test('supprimer une catégorie, une charge ou un projet tient aussi', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      categories: [{ id: 'cat1', emoji: '🛒', name: 'Courses', budget: 300, cls: 'besoin' }],
      charges: [{ id: 'ch1', name: 'Internet', amount: 30, cls: 'besoin', scope: 'commune' }],
      projects: [{ id: 'pr1', name: 'Voyage', emoji: '🌟', target: 1000, saved: 0, months: 10,
                   mensuel: 100, day: 5, split: { lui: 50, elle: 50 }, cls: 'envie', status: 'actif', history: [] }],
    });
    await cloudRefleteLetat(page);

    await page.evaluate(() => { markDeleted('cat1', 'ch1', 'pr1');
      S.categories = []; S.charges = []; S.projects = []; save(); });
    await page.evaluate(() => pushState());

    const restant = await page.evaluate(() => ({
      categories: S.categories.length, charges: S.charges.length, projects: S.projects.length,
    }));
    expect(restant).toEqual({ categories: 0, charges: 0, projects: 0 });
  });

  test('les ardoises trop anciennes sont purgées, pour ne pas gonfler indéfiniment', async ({ page }) => {
    await openApp(page);
    await loginAs(page, DEUX_DEPENSES);
    await page.evaluate(() => {
      const vieux = new Date(Date.now() - 200 * 86400000).toISOString(); // > 180 jours
      S.deleted = { recent: new Date().toISOString(), ancien: vieux };
      pruneTombstones();
    });
    const restantes = await page.evaluate(() => Object.keys(S.deleted));
    expect(restantes).toEqual(['recent']);
  });
});
