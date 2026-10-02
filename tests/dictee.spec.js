// Dictée : d'une phrase à un formulaire pré-rempli.
//
// C'est le cœur de la saisie vocale, et la partie qui porte tout le risque — le micro, lui,
// n'est que trois lignes de code. On le teste donc en écrivant les phrases plutôt qu'en les
// prononçant : cent tournures à la minute, et des cas de travers qu'on ne penserait jamais
// à dire à voix haute devant un téléphone.
//
// Rappel de la règle que ces tests protègent : l'analyse PRÉ-REMPLIT, elle ne valide jamais.
const { test, expect } = require('@playwright/test');
const { openApp, loginAs } = require('./helpers');

async function installer(page) {
  await openApp(page);
  await loginAs(page, {
    auth: { loggedIn: true, email: 'jb@test.fr', name: 'JB', profile: 'lui',
            coupleCode: 'TEST01', partnerLinked: true },
    partner: { name: 'Val', profile: 'elle' },
    categories: [
      { id: 'courses', emoji: '🛒', name: 'Courses', budget: 500, cls: 'besoin', rollover: true, rolloverStart: 0, rolloverFrom: null, rolloverMigre: true },
      { id: 'loisirs', emoji: '🎉', name: 'Loisirs/Sorties', budget: 200, cls: 'envie', rollover: true, rolloverStart: 0, rolloverFrom: null, rolloverMigre: true },
      { id: 'maison', emoji: '📦', name: 'Entretien courant', budget: 100, cls: 'envie', rollover: true, rolloverStart: 0, rolloverFrom: null, rolloverMigre: true },
    ],
    merchants: [
      { id: 'm1', cat: 'courses', name: 'Carrefour', emoji: '🏪' },
      { id: 'm2', cat: 'courses', name: 'Carrefour Market', emoji: '🏪' },
      { id: 'm3', cat: 'courses', name: 'Lidl', emoji: '🏪' },
    ],
    cagnotte: { balance: 300, history: [] },
  });
}

const lire = (page, phrase) => page.evaluate(p => analyserDictee(p), phrase);

test.describe('La phrase de référence', () => {
  test('« 19,95 euros chez Carrefour dans les courses »', async ({ page }) => {
    await installer(page);
    const r = await lire(page, '19,95 euros chez Carrefour dans les courses');
    expect(r.amount).toBe('19,95');
    expect(r.merchant).toBe('m1');
    expect(r.cat).toBe('courses');
  });

  // Le vrai gain : la catégorie n'a pas besoin d'être prononcée, S.merchants la connaît déjà.
  test('la catégorie se déduit du commerce quand on ne la dit pas', async ({ page }) => {
    await installer(page);
    const r = await lire(page, '19,95 euros chez Carrefour');
    expect(r.cat).toBe('courses');
  });

  test('le nom de commerce le plus long gagne', async ({ page }) => {
    await installer(page);
    const r = await lire(page, '12 euros chez Carrefour Market');
    expect(r.merchant).toBe('m2');
  });

  test('« chez » n\'est pas obligatoire', async ({ page }) => {
    await installer(page);
    const r = await lire(page, 'Lidl 23 euros');
    expect(r.merchant).toBe('m3');
    expect(r.amount).toBe('23');
  });
});

test.describe('Le montant', () => {
  const cas = [
    ['19,95 euros', '19,95'],
    ['19.95 euros', '19,95'],
    ['19,95€', '19,95'],
    ['vingt euros', '20'],
    ['quarante-cinq euros', '45'],
    ['quatre-vingt-dix euros', '90'],
    ['quatre-vingt-quinze euros', '95'],
    ['soixante-douze euros', '72'],
    ['cent vingt euros', '120'],
    ['40 balles', '40'],
    // À l'oral, les centimes passent très souvent APRÈS le mot « euros ».
    ['dix-neuf euros quatre-vingt-quinze', '19,95'],
    ['2 euros 50', '2,5'],
  ];
  for (const [phrase, attendu] of cas) {
    test(`« ${phrase} » → ${attendu}`, async ({ page }) => {
      await installer(page);
      expect((await lire(page, phrase)).amount).toBe(attendu);
    });
  }

  // Sans cette préférence, le premier nombre venu gagnerait et le montant serait faux.
  test('on prend le nombre collé à « euros », pas le premier de la phrase', async ({ page }) => {
    await installer(page);
    expect((await lire(page, '2 baguettes 3 euros')).amount).toBe('3');
  });

  test('une phrase sans montant n\'en invente pas', async ({ page }) => {
    await installer(page);
    expect((await lire(page, 'chez Carrefour')).amount).toBeUndefined();
  });

  test('une phrase vide ne renvoie rien du tout', async ({ page }) => {
    await installer(page);
    const r = await lire(page, '   ');
    expect(r.amount).toBeUndefined();
    expect(r.cat).toBeUndefined();
    expect(r.compris).toEqual([]);
  });
});

test.describe('La catégorie', () => {
  test('un nom composé se reconnaît par l\'un de ses mots', async ({ page }) => {
    await installer(page);
    expect((await lire(page, '30 euros dans les sorties')).cat).toBe('loisirs');
  });

  test('la catégorie prononcée l\'emporte sur celle du commerce', async ({ page }) => {
    await installer(page);
    const r = await lire(page, '15 euros chez Carrefour dans entretien');
    expect(r.merchant).toBe('m1');
    expect(r.cat).toBe('maison');
  });

  test('« cagnotte » bascule sur la cagnotte commune et rien d\'autre', async ({ page }) => {
    await installer(page);
    const r = await lire(page, '60 euros sur la cagnotte');
    expect(r.cat).toBe('__cagnotte__');
  });
});

test.describe('La date', () => {
  test('hier', async ({ page }) => {
    await installer(page);
    const [r, attendu] = await Promise.all([lire(page, 'hier 20 euros au Lidl'), page.evaluate(() => iso(1))]);
    expect(r.date).toBe(attendu);
  });

  test('avant-hier', async ({ page }) => {
    await installer(page);
    const [r, attendu] = await Promise.all([lire(page, 'avant-hier 20 euros'), page.evaluate(() => iso(2))]);
    expect(r.date).toBe(attendu);
  });

  test('il y a 3 jours', async ({ page }) => {
    await installer(page);
    const [r, attendu] = await Promise.all([lire(page, '20 euros il y a 3 jours'), page.evaluate(() => iso(3))]);
    expect(r.date).toBe(attendu);
  });

  // Un jour de la semaine désigne le passé : on note une dépense faite, pas une dépense à venir.
  test('un jour de la semaine remonte au plus récent passé', async ({ page }) => {
    await installer(page);
    const r = await lire(page, 'lundi 20 euros au Lidl');
    const ecart = await page.evaluate(d => Math.round((new Date(iso(0)) - new Date(d)) / 86400000), r.date);
    expect(ecart).toBeGreaterThan(0);
    expect(ecart).toBeLessThanOrEqual(7);
  });

  test('sans indication de date, on ne force rien', async ({ page }) => {
    await installer(page);
    expect((await lire(page, '20 euros au Lidl')).date).toBeUndefined();
  });
});

test.describe('Qui a payé, et le reste', () => {
  test('le prénom du partenaire est reconnu', async ({ page }) => {
    await installer(page);
    expect((await lire(page, '50 euros chez Carrefour, Val a payé')).who).toBe('elle');
  });

  test('« moi » renvoie à la personne connectée', async ({ page }) => {
    await installer(page);
    expect((await lire(page, '50 euros chez Carrefour pour moi')).who).toBe('lui');
  });

  test('une prévision est détectée', async ({ page }) => {
    await installer(page);
    expect((await lire(page, 'prévision 100 euros chez Carrefour')).prevision).toBe(true);
  });

  // Un commerce inconnu ne doit pas être perdu : il atterrit en description, dans sa casse
  // d'origine, prêt à être enregistré comme nouveau commerce.
  test('un commerce inconnu part en description', async ({ page }) => {
    await installer(page);
    const r = await lire(page, '25 euros chez Biocoop');
    expect(r.merchant).toBeUndefined();
    expect(r.desc).toBe('Biocoop');
  });

  test('aucune description quand le commerce est connu', async ({ page }) => {
    await installer(page);
    expect((await lire(page, '25 euros chez Carrefour')).desc).toBeUndefined();
  });
});

// Ce que le couple verra affiché avant de valider : si cette liste est vide ou fausse,
// la fonctionnalité perd tout son intérêt, même si les champs sont bons.
test('la liste de ce qui a été compris est lisible', async ({ page }) => {
  await installer(page);
  const r = await lire(page, '19,95 euros chez Carrefour');
  expect(r.compris.join(' · ')).toContain('Carrefour');
  expect(r.compris.join(' · ')).toMatch(/19,95/);
});

// Du texte au formulaire. Tout ce qui précède peut être juste et la fonctionnalité quand même
// inutilisable si les champs ne se remplissent pas vraiment à l'écran.
test.describe('Le formulaire se remplit', () => {
  test('la phrase pré-remplit montant, catégorie et commerce', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => { go('ajouter'); appliquerDictee('19,95 euros chez Carrefour'); });

    await expect(page.locator('#dAmount')).toHaveValue('19,95');
    await expect(page.locator('.cat-pill.on[data-catpick="courses"]')).toHaveCount(1);
    await expect(page.locator('.cat-pill.on[data-merchpick="m1"]')).toHaveCount(1);
  });

  // La garantie centrale : on propose, le couple relit. La phrase entendue est affichée telle
  // quelle pour qu'une transcription fautive se voie avant d'entrer dans le budget.
  test('le bandeau montre ce qui a été compris ET la phrase entendue', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => { go('ajouter'); appliquerDictee('19,95 euros chez Carrefour'); });

    const bandeau = page.locator('.card-soft').filter({ hasText: 'Entendu' });
    await expect(bandeau).toContainText('Carrefour');
    await expect(bandeau).toContainText('19,95 euros chez Carrefour');
    await expect(bandeau).toContainText('Vérifiez avant de valider');
  });

  // Une dictée qui ne parle que du montant ne doit pas effacer la catégorie déjà choisie.
  test('un champ absent de la phrase garde sa valeur', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => {
      go('ajouter');
      draft.cat = 'loisirs'; draft.desc = 'Cinéma';
      appliquerDictee('30 euros');
    });

    const d = await page.evaluate(() => ({ amount: draft.amount, cat: draft.cat, desc: draft.desc }));
    expect(d).toEqual({ amount: '30', cat: 'loisirs', desc: 'Cinéma' });
  });

  test('une phrase incompréhensible le dit, sans rien casser', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => { go('ajouter'); draft.cat='courses'; appliquerDictee('bonjour comment ça va'); });

    await expect(page.locator('.card-soft').filter({ hasText: "Je n'en ai rien tiré" })).toHaveCount(1);
    expect(await page.evaluate(() => draft.cat)).toBe('courses');
  });

  // Rien ne doit partir tout seul dans le budget : la dictée remplit, elle ne valide jamais.
  test('la dictée n\'enregistre aucune dépense', async ({ page }) => {
    await installer(page);
    await page.evaluate(() => { go('ajouter'); appliquerDictee('19,95 euros chez Carrefour dans les courses'); });
    expect(await page.evaluate(() => S.expenses.length)).toBe(0);
  });
});
