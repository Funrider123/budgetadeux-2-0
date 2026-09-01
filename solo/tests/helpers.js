// Utilitaires partagés par les tests.
//
// L'app charge Supabase et EmailJS depuis un CDN et parle à une vraie base.
// Les tests interceptent ces requêtes et injectent un faux client Supabase
// piloté depuis `window.__mock` : aucun test ne touche la vraie base, et on
// peut vérifier exactement ce que l'app a tenté d'écrire.

/**
 * Faux client Supabase, injecté à la place du SDK CDN.
 * L'état et les appels observés vivent dans `window.__mock`.
 */
const SUPABASE_STUB = `
window.__mock = {
  session: null,          // session Supabase courante (null = déconnecté)
  tables: { user_state: [] },
  // window.__rpcPresets, quand présent, vient d'un page.addInitScript() posé AVANT le
  // chargement de la page : seul moyen de préconfigurer une réponse RPC lue dès le boot.
  rpc: window.__rpcPresets || {}, // nom -> valeur retournée (ou fonction(args))
  rpcErrors: {},          // nom -> message d'erreur à renvoyer
  calls: { rpc: [], upsert: [], insert: [], select: [] },
};

function __rows(table){ return window.__mock.tables[table] || (window.__mock.tables[table] = []); }
function __match(row, filters){
  return filters.every(f => f.op === 'neq' ? row[f.col] !== f.val : row[f.col] === f.val);
}

function __builder(table, filters){
  filters = filters || [];
  const resolve = () => ({ data: __rows(table).filter(r => __match(r, filters)), error: null });
  const api = {
    eq: (col, val) => __builder(table, filters.concat([{ col, val, op: 'eq' }])),
    neq: (col, val) => __builder(table, filters.concat([{ col, val, op: 'neq' }])),
    maybeSingle: async () => {
      const hits = resolve().data;
      return { data: hits.length ? hits[0] : null, error: null };
    },
    single: async () => {
      const hits = resolve().data;
      return { data: hits[0] || null, error: hits.length ? null : { message: 'no rows' } };
    },
    // Un builder est "thenable" : \`await sb.from(t).select().eq(...)\` marche
    // sans .maybeSingle(), comme avec le vrai SDK.
    then: (onOk, onErr) => Promise.resolve(resolve()).then(onOk, onErr),
  };
  return api;
}

window.supabase = {
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: window.__mock.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
      signOut: async () => { window.__mock.session = null; return {}; },
      signUp: async () => ({ data: { session: window.__mock.session, user: window.__mock.session && window.__mock.session.user }, error: null }),
      signInWithPassword: async () => ({ data: { session: window.__mock.session }, error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
    },
    from: (table) => ({
      select: (cols) => { window.__mock.calls.select.push({ table, cols }); return __builder(table); },
      insert: async (row) => {
        window.__mock.calls.insert.push({ table, row });
        __rows(table).push(JSON.parse(JSON.stringify(row)));
        return { error: null };
      },
      upsert: async (row) => {
        window.__mock.calls.upsert.push({ table, row: JSON.parse(JSON.stringify(row)) });
        const rows = __rows(table);
        const keyCol = 'user_id';
        const i = rows.findIndex(r => r[keyCol] === row[keyCol]);
        if (i >= 0) rows[i] = JSON.parse(JSON.stringify(row));
        else rows.push(JSON.parse(JSON.stringify(row)));
        return { error: null };
      },
    }),
    rpc: async (name, args) => {
      window.__mock.calls.rpc.push({ name, args });
      if (window.__mock.rpcErrors[name]) return { data: null, error: { message: window.__mock.rpcErrors[name] } };
      const v = window.__mock.rpc[name];
      return { data: typeof v === 'function' ? v(args) : (v === undefined ? null : v), error: null };
    },
    channel: () => ({ on: () => ({ subscribe: () => {} }) }),
  }),
};
`;

const EMAILJS_STUB = `window.emailjs = { init(){}, send: async () => ({ status: 200 }) };`;

// GIF transparent 1x1 : évite les requêtes réseau vers Unsplash pendant les tests.
const PIXEL = Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64');

/**
 * Charge l'app avec toutes les dépendances externes bouchonnées.
 * À appeler au début de chaque test, avant toute interaction.
 */
async function openApp(page, path = '/index.html') {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.route('**://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', r =>
    r.fulfill({ contentType: 'application/javascript', body: SUPABASE_STUB }));
  await page.route('**://cdn.jsdelivr.net/npm/@emailjs/browser@4/**', r =>
    r.fulfill({ contentType: 'application/javascript', body: EMAILJS_STUB }));
  await page.route('**://images.unsplash.com/**', r =>
    r.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL }));
  await page.route('**://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));

  await page.goto(path);
  // `S` est déclaré avec `let` : c'est une variable globale mais pas une propriété
  // de `window`, d'où le test direct sur l'identifiant plutôt que sur `window.S`.
  await page.waitForFunction(() => typeof S === 'object' && S !== null && typeof go === 'function');
  return { errors };
}

/**
 * Préconfigure des réponses RPC lues dès le boot (avant le premier rendu), donc trop tôt
 * pour un simple page.evaluate() après openApp(). À appeler AVANT openApp().
 */
async function presetRpc(page, presets) {
  await page.addInitScript((p) => { window.__rpcPresets = p; }, presets);
}

/**
 * Place l'app dans l'état "connecté", sans passer par l'écran d'auth.
 * `state` permet de surcharger n'importe quelle partie de S (categories, charges…).
 */
async function loginAs(page, state = {}) {
  await page.evaluate((override) => {
    S.auth = Object.assign({
      loggedIn: true, email: 'alex@test.fr', name: 'Alex',
      userId: '11111111-1111-4111-8111-111111111111',
      pendingDeletionAt: null, pendingDeletionMode: null,
    }, override.auth || {});
    // Les pop-ups de premier lancement masqueraient l'écran testé.
    S.ui.welcomeSeen = true;
    S.ui.natureHelpSeen = true;
    Object.keys(override).forEach(k => { if (k !== 'auth') S[k] = override[k]; });
    save();
    enterApp();
  }, state);
  await page.waitForSelector('#main:not(.hidden)');
}

/** Raccourci : évalue une expression dans le contexte de l'app. */
const evalApp = (page, fn, arg) => page.evaluate(fn, arg);

module.exports = { openApp, loginAs, evalApp, presetRpc, SUPABASE_STUB };
