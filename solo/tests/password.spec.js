// Règle de mot de passe (Supabase Auth : longueur mini + "Letters and digits").
//
// Le bug signalé : le contrôle côté app était resté sur l'ancienne règle (6 caractères,
// sans exigence de composition), donc un mot de passe insuffisant passait l'écran du
// mot de passe, puis l'écran du prénom — et n'était refusé par Supabase qu'au
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
