// Règle de mot de passe (Supabase Auth : longueur mini + "Letters and digits").
//
// Le bug signalé : le contrôle côté app était resté sur l'ancienne règle (6 caractères,
// sans exigence de composition), donc un mot de passe insuffisant passait l'écran du
// mot de passe, puis nom, intention, code couple — et n'était refusé par Supabase qu'au
// tout dernier clic, avec un message générique qui ne disait même pas ce qui manquait.
// Ces tests vérifient que le blocage se fait maintenant AU bon endroit, pas après.
const { test, expect } = require('@playwright/test');
const { openApp } = require('./helpers');

test.describe('Règle de composition (validatePassword)', () => {
  test('refuse ce que Supabase refuserait, accepte ce qu\'il accepterait', async ({ page }) => {
    await openApp(page);
    const cas = await page.evaluate(() => ([
      { pw: 'abcdefg', attendu: false },   // 7 caractères : trop court
      { pw: 'abcdefgh', attendu: false },  // 8 lettres, aucun chiffre
      { pw: '12345678', attendu: false },  // 8 chiffres, aucune lettre
      { pw: 'abcdefg1', attendu: true },   // 8 caractères, lettre + chiffre
      { pw: 'MotDePasse2026', attendu: true },
      { pw: '', attendu: false },
    ].map(c => ({ ...c, obtenu: validatePassword(c.pw) }))));
    cas.forEach(c => expect(c.obtenu, `validatePassword("${c.pw}")`).toBe(c.attendu));
  });
});

test.describe('Inscription : blocage au bon endroit', () => {
  test('un mot de passe trop court ne fait pas avancer vers l\'écran du prénom', async ({ page }) => {
    await openApp(page);
    await page.fill('#aEmail', 'nouveau@test.fr');
    await page.fill('#aPass', 'abc123');
    await page.click('#doSignup');
    await page.waitForTimeout(200);
    // On doit être resté sur l'écran mot de passe, pas être passé à "Comment veux-tu t'appeler ?"
    expect(await page.evaluate(() => authStep)).toBe('signup');
    expect(await page.locator('#aName').count()).toBe(0);
  });

  test('un mot de passe assez long mais sans chiffre est refusé', async ({ page }) => {
    await openApp(page);
    await page.fill('#aEmail', 'nouveau@test.fr');
    await page.fill('#aPass', 'abcdefgh');
    await page.click('#doSignup');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => authStep)).toBe('signup');
  });

  test('un mot de passe conforme fait avancer vers l\'écran du prénom', async ({ page }) => {
    await openApp(page);
    await page.fill('#aEmail', 'nouveau@test.fr');
    await page.fill('#aPass', 'abcdefg1');
    await page.click('#doSignup');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => authStep)).toBe('name');
    expect(await page.locator('#aName').count()).toBe(1);
  });

  test('l\'exigence est annoncée sous le champ, avant toute tentative', async ({ page }) => {
    await openApp(page);
    const txt = await page.innerText('#auth');
    expect(txt).toMatch(/8 caractères minimum/);
    expect(txt).toMatch(/au moins une lettre et un chiffre/);
  });
});

test.describe('Réinitialisation : même règle', () => {
  async function surRecovery(page) {
    await openApp(page);
    await page.evaluate(() => { recovering = true; authStep = 'recovery';
      document.querySelector('#main').classList.add('hidden');
      document.querySelector('#auth').classList.remove('hidden');
      renderAuth();
    });
  }

  test('refuse un mot de passe qui ne respecte pas la règle', async ({ page }) => {
    await surRecovery(page);
    await page.fill('#aPass', 'abcdefgh'); // pas de chiffre
    await page.click('#doRecovery');
    await page.waitForTimeout(200);
    // Aucun appel réseau ne doit avoir été tenté : refusé avant même signOut/updateUser.
    expect(await page.evaluate(() => authStep)).toBe('recovery');
  });

  test('la même exigence est affichée sur l\'écran de réinitialisation', async ({ page }) => {
    await surRecovery(page);
    const txt = await page.innerText('#auth');
    expect(txt).toMatch(/8 caractères minimum/);
  });
});

test.describe('Message d\'erreur cohérent avec la vraie règle', () => {
  test('authError ne prétend plus que 6 caractères suffisent', async ({ page }) => {
    await openApp(page);
    const msg = await page.evaluate(() =>
      authError({ message: 'Password should contain at least one digit' }));
    expect(msg).toMatch(/8 caractères/);
    expect(msg).not.toMatch(/6 caractères/);
  });
});

// L'œil montrer/masquer. Taper un mot de passe à l'aveugle sur un clavier de téléphone est la
// première cause d'échec de connexion : on se trompe, on recommence, on abandonne.
test.describe('Afficher le mot de passe', () => {
  async function surEcran(page, etape) {
    await openApp(page);
    await page.evaluate((e) => {
      if (e === 'recovery') recovering = true;
      authStep = e;
      document.querySelector('#main').classList.add('hidden');
      document.querySelector('#auth').classList.remove('hidden');
      renderAuth();
    }, etape);
  }

  for (const etape of ['login', 'signup', 'recovery']) {
    test(`l'œil est présent sur l'écran « ${etape} »`, async ({ page }) => {
      await surEcran(page, etape);
      await expect(page.locator('[data-passtoggle="aPass"]')).toHaveCount(1);
      await expect(page.locator('#aPass')).toHaveAttribute('type', 'password');
    });
  }

  test('un clic révèle le mot de passe, un second le remasque', async ({ page }) => {
    await surEcran(page, 'login');
    await page.fill('#aPass', 'MotDePasse2026');
    const oeil = page.locator('[data-passtoggle="aPass"]');

    await oeil.click();
    await expect(page.locator('#aPass')).toHaveAttribute('type', 'text');
    await expect(oeil).toHaveAttribute('aria-label', 'Masquer le mot de passe');

    await oeil.click();
    await expect(page.locator('#aPass')).toHaveAttribute('type', 'password');
    await expect(oeil).toHaveAttribute('aria-label', 'Afficher le mot de passe');
  });

  test('la saisie n\'est pas perdue en basculant', async ({ page }) => {
    await surEcran(page, 'signup');
    await page.fill('#aPass', 'MotDePasse2026');
    await page.click('[data-passtoggle="aPass"]');
    await expect(page.locator('#aPass')).toHaveValue('MotDePasse2026');
  });

  // Sans ça, on revient au début du champ à chaque coup d'œil et il faut retraverser tout le
  // mot de passe pour reprendre la saisie.
  test('le curseur reste là où il était', async ({ page }) => {
    await surEcran(page, 'signup');
    await page.fill('#aPass', 'MotDePasse2026');
    await page.evaluate(() => document.querySelector('#aPass').setSelectionRange(5, 5));
    await page.click('[data-passtoggle="aPass"]');
    expect(await page.evaluate(() => document.querySelector('#aPass').selectionStart)).toBe(5);
  });

  // Le bouton ne doit jamais soumettre le formulaire en passant.
  test('l\'œil ne déclenche aucune validation', async ({ page }) => {
    await surEcran(page, 'signup');
    await page.fill('#aEmail', 'nouveau@test.fr');
    await page.fill('#aPass', 'abc');
    await page.click('[data-passtoggle="aPass"]');
    expect(await page.evaluate(() => authStep)).toBe('signup');
  });
});

// Ce que le trousseau du téléphone a besoin de savoir. Sans ces attributs il voit des champs
// anonymes : il ne propose ni d'enregistrer à l'inscription, ni de remplir à la connexion. Or
// ce mot de passe n'est tapé que deux fois dans une vie — à l'inscription, et le jour où la
// session saute. Ce jour-là, sans rien dans le trousseau, il ne reste que « mot de passe oublié ».
test.describe('Reconnu par les gestionnaires de mots de passe', () => {
  async function surEcran(page, etape) {
    await openApp(page);
    await page.evaluate((e) => {
      if (e === 'recovery') recovering = true;
      authStep = e;
      document.querySelector('#main').classList.add('hidden');
      document.querySelector('#auth').classList.remove('hidden');
      renderAuth();
    }, etape);
  }

  test('connexion : identifiant et mot de passe existant', async ({ page }) => {
    await surEcran(page, 'login');
    await expect(page.locator('#aEmail')).toHaveAttribute('autocomplete', 'username');
    await expect(page.locator('#aPass')).toHaveAttribute('autocomplete', 'current-password');
  });

  // 'new-password' est ce qui déclenche la proposition d'un mot de passe fort, enregistré
  // d'office : c'est tout l'intérêt, et 'current-password' ici ferait proposer l'ancien.
  test('inscription : nouveau mot de passe', async ({ page }) => {
    await surEcran(page, 'signup');
    await expect(page.locator('#aEmail')).toHaveAttribute('autocomplete', 'username');
    await expect(page.locator('#aPass')).toHaveAttribute('autocomplete', 'new-password');
  });

  test('réinitialisation : nouveau mot de passe aussi', async ({ page }) => {
    await surEcran(page, 'recovery');
    await expect(page.locator('#aPass')).toHaveAttribute('autocomplete', 'new-password');
  });
});
