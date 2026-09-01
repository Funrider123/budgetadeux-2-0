// Synchronisation entre les appareils d'une même personne (téléphone, ordinateur).
// Une régression ici se traduit par une perte de données silencieuse : rien ne
// plante, mais une dépense saisie disparaît. C'est le pire cas pour la confiance.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

/** Construit un état distant plausible (ce qu'un autre appareil aurait déjà poussé). */
async function seedRemote(page, overrides) {
  await page.evaluate((ov) => {
    const remote = {};
    SYNC_KEYS.forEach(k => { remote[k] = JSON.parse(JSON.stringify(S[k])); });
    Object.assign(remote, ov);
    window.__mock.tables.user_state = [{
      user_id: S.auth.userId, data: remote,
      updated_at: '2026-01-01T00:00:00.000Z', updated_by: 'autre-appareil',
    }];
  }, overrides);
}

test.describe('Fusion des ajouts concurrents', () => {
  test('deux dépenses ajoutées en même temps : aucune des deux n\'est perdue', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      categories: [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 300, cls: 'besoin' }],
      expenses: [{ id: 'local1', type: 'depense', amount: 20, cat: 'courses', desc: 'Chez moi', date: '2026-08-18', prevision: false }],
    });
    // L'autre appareil a poussé SA dépense avant nous, on ne l'a pas encore reçue.
    await seedRemote(page, {
      expenses: [{ id: 'remote1', type: 'depense', amount: 35, cat: 'courses', desc: 'Chez lui', date: '2026-08-18', prevision: false }],
    });

    await page.evaluate(() => pushState());

    const ids = await page.evaluate(() => S.expenses.map(e => e.id).sort());
    expect(ids).toEqual(['local1', 'remote1']);

    // …et ce qui part vers Supabase contient bien les deux, sinon on aurait
    // juste retardé l'écrasement d'un cran.
    const pushed = await page.evaluate(() => {
      const ups = window.__mock.calls.upsert.filter(u => u.table === 'user_state');
      return ups[ups.length - 1].row.data.expenses.map(e => e.id).sort();
    });
    expect(pushed).toEqual(['local1', 'remote1']);
  });

  test('la fusion couvre aussi charges, catégories, commerces et projets', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      charges: [{ id: 'ch_local', name: 'Loyer', amount: 900, cls: 'besoin', scope: 'essentiel' }],
      categories: [{ id: 'cat_local', emoji: '🛒', name: 'Courses', budget: 300, cls: 'besoin' }],
      merchants: [{ id: 'm_local', emoji: '🛒', name: 'Carrefour', cat: 'cat_local' }],
      projects: [{ id: 'pr_local', name: 'Voyage', emoji: '🌴', target: 3000, saved: 0, months: 10, mensuel: 300, day: 5, cls: 'envie', status: 'actif', history: [] }],
    });
    await seedRemote(page, {
      charges: [{ id: 'ch_remote', name: 'Assurance', amount: 40, cls: 'protection', scope: 'essentiel' }],
      categories: [{ id: 'cat_remote', emoji: '🎉', name: 'Loisirs', budget: 100, cls: 'envie' }],
      merchants: [{ id: 'm_remote', emoji: '🛍️', name: 'Biocoop', cat: 'cat_remote' }],
      projects: [{ id: 'pr_remote', name: 'Cuisine', emoji: '🍳', target: 5000, saved: 0, months: 20, mensuel: 250, day: 5, cls: 'envie', status: 'actif', history: [] }],
    });

    await page.evaluate(() => pushState());

    const after = await page.evaluate(() => ({
      charges: S.charges.map(x => x.id).sort(),
      categories: S.categories.map(x => x.id).sort(),
      merchants: S.merchants.map(x => x.id).sort(),
      projects: S.projects.map(x => x.id).sort(),
    }));
    expect(after.charges).toEqual(['ch_local', 'ch_remote']);
    expect(after.categories).toEqual(['cat_local', 'cat_remote']);
    expect(after.merchants).toEqual(['m_local', 'm_remote']);
    expect(after.projects).toEqual(['pr_local', 'pr_remote']);
  });

  test('un élément déjà connu des deux côtés n\'est pas dupliqué', async ({ page }) => {
    await openApp(page);
    const shared = { id: 'e1', type: 'depense', amount: 20, cat: 'courses', desc: 'Commune', date: '2026-08-18', prevision: false };
    await loginAs(page, { expenses: [shared] });
    await seedRemote(page, { expenses: [shared] });

    await page.evaluate(() => pushState());

    expect(await page.evaluate(() => S.expenses.length)).toBe(1);
  });

  test('premier envoi (aucune donnée distante) : rien ne casse', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      expenses: [{ id: 'e1', type: 'depense', amount: 20, cat: 'courses', desc: 'Première', date: '2026-08-18', prevision: false }],
    });
    // Table vide : c'est le tout premier push du compte.
    await page.evaluate(() => { window.__mock.tables.user_state = []; });

    await page.evaluate(() => pushState());

    const pushed = await page.evaluate(() => {
      const ups = window.__mock.calls.upsert.filter(u => u.table === 'user_state');
      return ups.length ? ups[ups.length - 1].row.data.expenses.map(e => e.id) : null;
    });
    expect(pushed).toEqual(['e1']);
  });
});

test.describe('Réception des changements d\'un autre appareil', () => {
  test('les données distantes sont appliquées localement', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      categories: [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 100, cls: 'besoin' }],
    });
    await seedRemote(page, {
      categories: [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 450, cls: 'besoin' }],
    });

    await page.evaluate(() => pullState());

    await expect.poll(() => page.evaluate(() => S.categories.find(c => c.id === 'courses').budget)).toBe(450);
  });

  test('on ne se réapplique pas sa propre écriture', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      categories: [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 100, cls: 'besoin' }],
    });
    // Ligne distante marquée comme venant de CE téléphone.
    await page.evaluate(() => {
      const remote = {};
      SYNC_KEYS.forEach(k => { remote[k] = JSON.parse(JSON.stringify(S[k])); });
      remote.categories = [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 999, cls: 'besoin' }];
      window.__mock.tables.user_state = [{
        user_id: S.auth.userId, data: remote,
        updated_at: '2026-01-01T00:00:00.000Z', updated_by: deviceId,
      }];
    });

    await page.evaluate(() => pullState());

    expect(await page.evaluate(() => S.categories.find(c => c.id === 'courses').budget)).toBe(100);
  });
});

test.describe('Pas d\'envoi ni de notification pour un changement purement local', () => {
  test('changer de thème ne pousse rien et ne déclenche pas "Budget mis à jour"', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      categories: [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 300, cls: 'besoin' }],
    });
    await page.evaluate(() => pushState()); // établit la référence, comme le ferait la synchro initiale

    await page.evaluate(() => { window.__mock.calls.upsert = []; });
    await page.evaluate(() => { S.ui.colorTheme = 'sauge'; S.ui.dark = !S.ui.dark; save(); });
    await page.evaluate(() => pushState());

    const upserts = await page.evaluate(() => window.__mock.calls.upsert.filter(u => u.table === 'user_state').length);
    expect(upserts).toBe(0);
  });

  test('une vraie modification partagée (budget) continue bien de pousser', async ({ page }) => {
    await openApp(page);
    await loginAs(page, {
      categories: [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 300, cls: 'besoin' }],
    });
    await page.evaluate(() => pushState());

    await page.evaluate(() => { window.__mock.calls.upsert = []; });
    await page.evaluate(() => { S.categories[0].budget = 400; save(); });
    await page.evaluate(() => pushState());

    const upserts = await page.evaluate(() => window.__mock.calls.upsert.filter(u => u.table === 'user_state').length);
    expect(upserts).toBe(1);
  });
});

test.describe('Mode démonstration', () => {
  test('n\'écrit jamais rien dans le cloud', async ({ page }) => {
    await openApp(page);
    await page.click('#tryDemo');
    await page.waitForSelector('#main:not(.hidden)');

    // On force plusieurs actions qui, sur un vrai compte, déclencheraient un envoi.
    await page.evaluate(async () => {
      window.__mock.calls.upsert = [];
      window.__mock.calls.insert = [];
      S.categories[0].budget = 12345;
      save();
      await pushState();
      await pullState();
    });
    await page.waitForTimeout(1200); // laisse passer le debounce de schedulePush

    const calls = await page.evaluate(() => ({
      upsert: window.__mock.calls.upsert.length,
      insert: window.__mock.calls.insert.length,
    }));
    expect(calls).toEqual({ upsert: 0, insert: 0 });
  });

  test('ne laisse rien derrière lui dans le stockage local', async ({ page }) => {
    await openApp(page);
    await page.click('#tryDemo');
    await page.waitForSelector('#main:not(.hidden)');
    await page.evaluate(() => { S.categories[0].budget = 4321; save(); });

    const stored = await page.evaluate(() => localStorage.getItem('bas1'));
    expect(stored === null || !stored.includes('4321')).toBe(true);
  });
});
