// Authentification et cycle de vie du compte.
// C'est le seul endroit où une erreur peut faire fuiter les données d'un couple
// vers un autre — d'où les tests sur l'isolation à la création de compte.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs, presetRpc } = require('./helpers');

const utilisateur = (over = {}) => Object.assign({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'nouveau@test.fr',
  user_metadata: { name: 'Camille', gender: 'elle', couple_code: 'NEUF01', intent: 'create' },
}, over);

test.describe('Création de compte', () => {
  test('un compte neuf ne récupère pas les données restées sur l\'appareil', async ({ page }) => {
    await openApp(page);

    // Un compte précédent (testé puis supprimé) a laissé ses données en local.
    await page.evaluate(() => {
      S.auth = { loggedIn: false, email: 'ancien@test.fr', name: 'Gérard', profile: 'lui',
                 coupleCode: 'VIEUX1', partnerLinked: true, pendingDeletionAt: null, pendingDeletionMode: null };
      S.categories = [{ id: 'vieux', emoji: '👻', name: 'Catégorie fantôme', budget: 777, cls: 'besoin' }];
      S.expenses = [{ id: 'vieux1', type: 'depense', amount: 999, cat: 'vieux', who: 'lui', desc: 'Dépense fantôme', date: '2026-01-01', prevision: false }];
      save();
    });

    await page.evaluate(async (u) => { await ensureProfile(u); }, utilisateur());

    const etat = await page.evaluate(() => ({
      nom: S.auth.name,
      code: S.auth.coupleCode,
      categories: S.categories.map(c => c.name),
      depenses: S.expenses.length,
    }));
    expect(etat.nom).toBe('Camille');
    expect(etat.code).toBe('NEUF01');
    expect(etat.categories).not.toContain('Catégorie fantôme');
    expect(etat.depenses).toBe(0);
  });

  test('une reconnexion conserve le budget existant', async ({ page }) => {
    await openApp(page);
    const u = utilisateur({ email: 'connu@test.fr' });

    // Le profil existe déjà en base : ce n'est pas une création, c'est un retour.
    await page.evaluate((user) => {
      window.__mock.tables.profiles = [{
        user_id: user.id, email: user.email, gender: 'elle', name: 'Camille', couple_code: 'NEUF01',
      }];
      S.categories = [{ id: 'courses', emoji: '🛒', name: 'Courses', budget: 350, cls: 'besoin' }];
      S.expenses = [{ id: 'e1', type: 'depense', amount: 42, cat: 'courses', who: 'elle', desc: 'À garder', date: '2026-08-18', prevision: false }];
      save();
    }, u);

    await page.evaluate(async (user) => { await ensureProfile(user); }, u);

    const etat = await page.evaluate(() => ({
      budget: (S.categories.find(c => c.id === 'courses') || {}).budget,
      depenses: S.expenses.length,
      connecte: S.auth.loggedIn,
    }));
    expect(etat.budget).toBe(350);
    expect(etat.depenses).toBe(1);
    expect(etat.connecte).toBe(true);
  });

  test('rejoindre un couple déjà complet est refusé', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { window.__mock.rpc.couple_member_count = 2; });

    const erreur = await page.evaluate(async (u) => {
      try { await ensureProfile(u); return null; }
      catch (e) { return e.message; }
    }, utilisateur({ user_metadata: { name: 'Tiers', gender: 'lui', couple_code: 'PLEIN1', intent: 'join' } }));

    expect(erreur).toBe('couple-full');
  });

  test('rejoindre un couple qui n\'a qu\'un membre fonctionne', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { window.__mock.rpc.couple_member_count = 1; });

    const erreur = await page.evaluate(async (u) => {
      try { await ensureProfile(u); return null; }
      catch (e) { return e.message; }
    }, utilisateur({ user_metadata: { name: 'Thomas', gender: 'lui', couple_code: 'DUO001', intent: 'join' } }));

    expect(erreur).toBeNull();
    expect(await page.evaluate(() => S.auth.coupleCode)).toBe('DUO001');
  });
});

test.describe('Suppression de compte (délai de grâce)', () => {
  test('supprimer programme la suppression au lieu de l\'exécuter tout de suite', async ({ page }) => {
    await openApp(page);
    await loginAs(page, { auth: { partnerLinked: false } });

    await page.evaluate(() => openDeleteAccount());
    await page.click('#daAll');
    await page.click('#cfYes');

    await expect.poll(() => page.evaluate(() =>
      window.__mock.calls.rpc.filter(c => c.name === 'schedule_account_deletion').length
    )).toBe(1);

    const args = await page.evaluate(() =>
      window.__mock.calls.rpc.find(c => c.name === 'schedule_account_deletion').args);
    expect(args).toEqual({ p_mode: 'account' });
  });

  test('un bandeau prioritaire annonce la suppression et permet de l\'annuler', async ({ page }) => {
    await openApp(page);
    const dans10jours = new Date(Date.now() + 10 * 86400000).toISOString();
    await loginAs(page, {
      auth: { pendingDeletionAt: dans10jours, pendingDeletionMode: 'all' },
      settings: { salaries: { lui: 0, elle: 0 }, mode: 'fixe', custom: { lui: 50, elle: 50 },
                  fixed: { lui: 1500, elle: 1500 }, idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
    });

    const banniere = page.locator('#setupBanner .setup-banner');
    await expect(banniere).toContainText('Suppression programmée');

    // Le bandeau passe avant tous les autres rappels, y compris sur Pilotage
    // (où les autres bandeaux sont masqués) : c'est le plus urgent à voir.
    await page.evaluate(() => go('pilotage'));
    await expect(banniere).toContainText('Suppression programmée');

    await page.evaluate(() => document.querySelector('#cancelDeletionBtn').click());

    await expect.poll(() => page.evaluate(() =>
      window.__mock.calls.rpc.some(c => c.name === 'cancel_account_deletion'))).toBe(true);
    expect(await page.evaluate(() => S.auth.pendingDeletionAt)).toBeNull();
    // Plus aucune trace du bandeau : sur Pilotage il disparaît complètement.
    await expect.poll(() => page.evaluate(() =>
      (document.querySelector('#setupBanner') || {}).innerHTML || '')).not.toContain('Suppression programmée');
  });

  test('une échéance déjà passée n\'affiche plus le bandeau', async ({ page }) => {
    await openApp(page);
    const hier = new Date(Date.now() - 86400000).toISOString();
    await loginAs(page, {
      auth: { pendingDeletionAt: hier, pendingDeletionMode: 'all' },
      settings: { salaries: { lui: 0, elle: 0 }, mode: 'fixe', custom: { lui: 50, elle: 50 },
                  fixed: { lui: 1500, elle: 1500 }, idealSplit: { besoin: 50, envie: 30, protection: 0, invest: 20 } },
    });
    await expect(page.locator('#setupBanner .setup-banner')).not.toContainText('Suppression programmée');
  });
});

test.describe('Invitation par lien (?code=...)', () => {
  const remplirSignup = async (page) => {
    await page.fill('#aEmail', 'partenaire@test.fr');
    await page.fill('#aPass', 'Test1234');
    await page.click('#doSignup');
    await page.waitForSelector('#aName');
    await page.fill('#aName', 'Dominique');
    await page.click('#doName');
  };

  test('un code valide dans le lien saute le choix et la saisie manuelle', async ({ page }) => {
    await presetRpc(page, { couple_code_exists: true, couple_member_count: 1 });
    await openApp(page, '/index.html?code=abcdef');

    expect(await page.evaluate(() => inviteCode)).toBe('ABCDEF'); // normalisé en majuscules
    await remplirSignup(page);

    // Écran de confirmation direct, aucune case de code à remplir.
    await expect(page.locator('#doJoinInvite')).toBeVisible();
    expect(await page.locator('.ci').count()).toBe(0);

    await page.click('#doJoinInvite');

    const t = await page.evaluate(() => tmp);
    expect(t.intent).toBe('join');
    expect(t.coupleCode).toBe('ABCDEF');
    // signUp() du bouchon ne renvoie pas de session : on atterrit sur l'écran de confirmation email.
    await expect(page.locator('#goLogin')).toBeVisible();
  });

  test('un code déjà complet dans le lien retombe sur le choix habituel', async ({ page }) => {
    await presetRpc(page, { couple_code_exists: true, couple_member_count: 2 });
    await openApp(page, '/index.html?code=PLEIN1');

    expect(await page.evaluate(() => inviteCode)).toBeNull();
    await remplirSignup(page);

    await expect(page.locator('#goCreate')).toBeVisible();
    await expect(page.locator('#goJoin')).toBeVisible();
  });

  test('un lien devenu invalide entre-temps est rattrapé avant la création du compte', async ({ page }) => {
    await presetRpc(page, { couple_code_exists: true, couple_member_count: 1 });
    await openApp(page, '/index.html?code=RACE01');
    await remplirSignup(page);
    await expect(page.locator('#doJoinInvite')).toBeVisible();

    // Le code a été rejoint par quelqu'un d'autre (ou supprimé) juste avant le clic final.
    await page.evaluate(() => { window.__mock.rpc.couple_code_exists = false; });
    await page.click('#doJoinInvite');

    await expect(page.locator('#goCreate')).toBeVisible(); // repli sur l'écran de choix
    expect(await page.evaluate(() => inviteCode)).toBeNull();
  });
});
