// Authentification et cycle de vie du compte.
// C'est le seul endroit où une erreur peut faire fuiter les données d'un compte
// vers un autre — d'où les tests sur l'isolation à la création de compte.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

const NOUVEAU = '11111111-1111-4111-8111-111111111111';
const ANCIEN = '22222222-2222-4222-8222-222222222222';

const utilisateur = (over = {}) => Object.assign({
  id: NOUVEAU,
  email: 'nouveau@test.fr',
  user_metadata: { name: 'Camille' },
}, over);

test.describe('Création de compte', () => {
  test('un compte neuf ne récupère pas les données restées sur l\'appareil', async ({ page }) => {
    await openApp(page);

    // Un compte précédent (testé puis supprimé) a laissé ses données en local.
    await page.evaluate((ancien) => {
      S.auth = { loggedIn: false, email: 'ancien@test.fr', name: 'Gérard', userId: ancien,
                 pendingDeletionAt: null, pendingDeletionMode: null };
      S.categories = [{ id: 'vieux', emoji: '👻', name: 'Catégorie fantôme', budget: 777, cls: 'besoin' }];
      S.expenses = [{ id: 'vieux1', type: 'depense', amount: 999, cat: 'vieux', desc: 'Dépense fantôme', date: '2026-01-01', prevision: false }];
      save();
    }, ANCIEN);

    await page.evaluate(async (u) => { await loadUserIntoState(u); }, utilisateur());

    const etat = await page.evaluate(() => ({
      nom: S.auth.name,
      compte: S.auth.userId,
      categories: S.categories.map(c => c.name),
      depenses: S.expenses.length,
    }));
    expect(etat.nom).toBe('Camille');
    expect(etat.compte).toBe(NOUVEAU);
    expect(etat.categories).not.toContain('Catégorie fantôme');
    expect(etat.depenses).toBe(0);
  });

  test('un tout premier compte sur un appareil vierge démarre à zéro', async ({ page }) => {
    await openApp(page);
    await page.evaluate(async (u) => { await loadUserIntoState(u); }, utilisateur());

    const etat = await page.evaluate(() => ({
      connecte: S.auth.loggedIn, compte: S.auth.userId, depenses: S.expenses.length,
    }));
    expect(etat).toEqual({ connecte: true, compte: NOUVEAU, depenses: 0 });
  });

  test('une reconnexion conserve le budget existant', async ({ page }) => {
    await openApp(page);
    const u = utilisateur({ email: 'connu@test.fr' });

    // L'état existe déjà dans le cloud pour ce compte : ce n'est pas une création, c'est un retour.
    await page.evaluate((user) => {
      window.__mock.tables.user_state = [{ user_id: user.id, data: {}, updated_at: '2026-01-01T00:00:00.000Z' }];
      S.auth.userId = user.id;
      S.categories = [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 350, cls: 'besoin' }];
      S.expenses = [{ id: 'e1', type: 'depense', amount: 42, cat: 'courses', desc: 'À garder', date: '2026-08-18', prevision: false }];
      save();
    }, u);

    await page.evaluate(async (user) => { await loadUserIntoState(user); }, u);

    const etat = await page.evaluate(() => ({
      budget: (S.categories.find(c => c.id === 'courses') || {}).budget,
      depenses: S.expenses.length,
      connecte: S.auth.loggedIn,
    }));
    expect(etat.budget).toBe(350);
    expect(etat.depenses).toBe(1);
    expect(etat.connecte).toBe(true);
  });

  test('un budget saisi hors ligne, jamais synchronisé, survit à la reconnexion', async ({ page }) => {
    await openApp(page);
    const u = utilisateur();

    // Le compte est déjà entré une fois sur cet appareil (auth.userId posé), mais rien
    // n'a jamais atteint le cloud : la table distante est vide. Effacer serait une perte sèche.
    await page.evaluate((user) => {
      window.__mock.tables.user_state = [];
      S.auth.userId = user.id;
      S.expenses = [{ id: 'horsligne', type: 'depense', amount: 18, cat: 'courses', desc: 'Saisie hors ligne', date: '2026-08-18', prevision: false }];
      save();
    }, u);

    await page.evaluate(async (user) => { await loadUserIntoState(user); }, u);

    expect(await page.evaluate(() => S.expenses.map(e => e.id))).toEqual(['horsligne']);
  });
});

test.describe('Suppression de compte (délai de grâce)', () => {
  test('supprimer programme la suppression au lieu de l\'exécuter tout de suite', async ({ page }) => {
    await openApp(page);
    await loginAs(page);

    await page.evaluate(() => openDeleteAccount());
    await page.click('#daAll');
    await page.click('#cfYes');

    await expect.poll(() => page.evaluate(() =>
      window.__mock.calls.rpc.filter(c => c.name === 'solo_schedule_deletion').length
    )).toBe(1);

    const args = await page.evaluate(() =>
      window.__mock.calls.rpc.find(c => c.name === 'solo_schedule_deletion').args);
    expect(args).toEqual({ p_mode: 'account' });
  });

  test('réinitialiser les données ne supprime pas le compte', async ({ page }) => {
    await openApp(page);
    await loginAs(page);

    await page.evaluate(() => openDeleteAccount());
    await page.click('#daData');
    await page.click('#cfYes');

    const args = await page.evaluate(() =>
      (window.__mock.calls.rpc.find(c => c.name === 'solo_schedule_deletion') || {}).args);
    expect(args).toEqual({ p_mode: 'data' });
  });

  test('un bandeau prioritaire annonce la suppression et permet de l\'annuler', async ({ page }) => {
    await openApp(page);
    const dans10jours = new Date(Date.now() + 10 * 86400000).toISOString();
    await loginAs(page, {
      auth: { pendingDeletionAt: dans10jours, pendingDeletionMode: 'account' },
      settings: { income: { salary: 3000, other: 0 }, idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
    });

    const banniere = page.locator('#setupBanner .setup-banner');
    await expect(banniere).toContainText('Suppression programmée');

    // Le bandeau passe avant tous les autres rappels, y compris sur Pilotage
    // (où les autres bandeaux sont masqués) : c'est le plus urgent à voir.
    await page.evaluate(() => go('pilotage'));
    await expect(banniere).toContainText('Suppression programmée');

    await page.evaluate(() => document.querySelector('#cancelDeletionBtn').click());

    await expect.poll(() => page.evaluate(() =>
      window.__mock.calls.rpc.some(c => c.name === 'solo_cancel_deletion'))).toBe(true);
    expect(await page.evaluate(() => S.auth.pendingDeletionAt)).toBeNull();
    // Plus aucune trace du bandeau : sur Pilotage il disparaît complètement.
    await expect.poll(() => page.evaluate(() =>
      (document.querySelector('#setupBanner') || {}).innerHTML || '')).not.toContain('Suppression programmée');
  });

  test('une échéance déjà passée n\'affiche plus le bandeau', async ({ page }) => {
    await openApp(page);
    const hier = new Date(Date.now() - 86400000).toISOString();
    await loginAs(page, {
      auth: { pendingDeletionAt: hier, pendingDeletionMode: 'account' },
      settings: { income: { salary: 3000, other: 0 }, idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
    });
    await expect(page.locator('#setupBanner .setup-banner')).not.toContainText('Suppression programmée');
  });
});

test.describe('Inscription : plus rien à relier', () => {
  test('le prénom suffit à créer le compte, sans code ni choix de profil', async ({ page }) => {
    await openApp(page);
    await page.fill('#aEmail', 'nouveau@test.fr');
    await page.fill('#aPass', 'Test1234');
    await page.click('#doSignup');

    await page.waitForSelector('#aName');
    await page.fill('#aName', 'Dominique');
    await page.click('#doName');

    // signUp() du bouchon ne renvoie pas de session : on atterrit sur l'écran de confirmation email.
    await expect(page.locator('#goLogin')).toBeVisible();
    expect(await page.evaluate(() => tmp.name)).toBe('Dominique');
    // Aucune case de code couple nulle part.
    expect(await page.locator('.ci').count()).toBe(0);
  });
});
