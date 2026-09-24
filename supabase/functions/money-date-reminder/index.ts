// Edge Function : rappel email pour le "Money Date" (rendez-vous financier du couple).
// Déclenchée une fois par jour par un cron (voir README-cron.md dans ce dossier).
//
// Pour chaque couple dont couple_state.data.moneyDate.nextDate tombe demain ou aujourd'hui
// (heure de Paris), on envoie un email aux deux partenaires via l'API Resend, sur le domaine
// budgetadeux.fr déjà vérifié pour les emails de récupération de mot de passe.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Date civile du jour à Paris, au format YYYY-MM-DD (comme S.moneyDate.nextDate côté app).
function parisDateStr(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Une seule adresse fait tout : c'est l'expéditeur ET celle où les réponses arrivent
// réellement. Elle est sur budgetadeux.fr (le domaine vérifié chez Resend, signé SPF/DKIM),
// donc aucune perte d'authentification par rapport à no-reply@ — c'est un alias (redirigé vers
// Gmail via ImprovMX), pas un compte gmail.com direct, ce qui évite la pénalité de délivrabilité
// qu'un reply-to freemail déclenche (signature classique d'une usurpation aux yeux des filtres :
// domaine pro en expéditeur, boîte gratuite en retour ; -2,5 points mesurés sur mail-tester
// avant qu'on isole cette cause). Et contrairement à no-reply@, elle n'annonce pas le silence :
// ce qu'on voit dans le client mail est déjà la vraie adresse de réponse, pas besoin de
// découvrir un reply-to caché pour le savoir.
const CONTACT = "contact@budgetadeux.fr";
const FROM = `Budget à Deux <${CONTACT}>`;
const REPLY_TO = CONTACT;

// La veille : un simple rappel, sans appel à l'action — il n'y a rien à faire ce soir-là, et
// un gros bouton inviterait à commencer le rendez-vous tout seul, sans l'autre.
// Le jour J : le lien ouvre directement l'écran du Money Date (?ecran=moneydate), pour ne pas
// retomber sur la Vue et devoir le retrouver dans le menu.
function emailHtml(prenom: string, when: "demain" | "aujourdhui") {
  const bonjour = prenom ? `Bonjour ${prenom},` : "Bonjour,";
  const corps = when === "demain"
    ? `<h2 style="margin:0 0 12px;font-size:21px">Votre Money Date, c'est demain</h2>
       <p style="color:#ccc;margin:0">${bonjour} pensez à vous garder un instant à deux demain pour faire le point sur vos finances.</p>`
    : `<h2 style="margin:0 0 12px;font-size:21px">C'est aujourd'hui votre Money Date</h2>
       <p style="color:#ccc;margin:0 0 24px">${bonjour} pensez à prendre un instant à deux aujourd'hui pour repartir avec un mois de sérénité.</p>
       <a href="https://budgetadeux.fr/?ecran=moneydate" style="display:inline-block;background:#c1573f;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold">Commencer notre Money Date →</a>`;
  return `
  <div style="background:#141414;padding:32px 16px;font-family:Georgia,serif;color:#eee">
    <div style="max-width:480px;margin:0 auto;background:#1c1c1c;border-radius:12px;padding:32px;text-align:center">
      <h1 style="color:#e07856;margin:0 0 4px;font-size:24px">Budget à Deux</h1>
      <p style="color:#999;font-style:italic;margin:0 0 24px;font-size:14px">« L'argent n'est qu'un outil pour construire la vie que nous aimons ensemble. »</p>
      ${corps}
    </div>
  </div>`;
}

// Version texte, obligatoire. Un email qui n'a qu'une partie HTML est un des profils que les
// filtres anti-spam sanctionnent le plus, Microsoft en tête — et c'est justement chez Microsoft
// qu'un rappel est tombé en indésirables. Ce n'est pas une politesse pour les vieux clients
// mail : c'est la moitié manquante d'un email correctement formé.
const signature = (corps: string) =>
  `${corps}\n\n--\nBudget à Deux\n« L'argent n'est qu'un outil pour construire la vie que nous aimons ensemble. »\nPour nous écrire : ${REPLY_TO}`;

function emailTexte(prenom: string, when: "demain" | "aujourdhui") {
  const bonjour = prenom ? `Bonjour ${prenom},` : "Bonjour,";
  return signature(when === "demain"
    ? `Votre Money Date, c'est demain.\n\n${bonjour} pensez à vous garder un instant à deux demain pour faire le point sur vos finances.`
    : `C'est aujourd'hui votre Money Date.\n\n${bonjour} pensez à prendre un instant à deux aujourd'hui pour repartir avec un mois de sérénité.\n\nCommencer notre Money Date : https://budgetadeux.fr/?ecran=moneydate`);
}

// Un envoi automatique récurrent sans moyen de s'en défaire est mal vu des filtres, et à juste
// titre. À cette échelle un mailto suffit et il est honnête : les demandes arrivent sur une
// boîte réellement relevée. Pas de List-Unsubscribe-Post ici : l'en-tête « un clic » exige une
// URL HTTPS, l'annoncer avec un simple mailto serait une déclaration fausse.
const ENTETES = { "List-Unsubscribe": `<mailto:${REPLY_TO}?subject=Desabonnement>` };

async function sendEmail(to: string, prenom: string, when: "demain" | "aujourdhui", apiKey: string) {
  // Pas d'emoji dans l'objet : le cœur était un signal de mailing publicitaire, pour un gain
  // d'affection à peu près nul face au coût d'un passage en indésirables.
  const subject = when === "demain" ? "Rappel : votre Money Date, c'est demain" : "C'est aujourd'hui votre Money Date";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM, to: [to], subject, reply_to: REPLY_TO, headers: ENTETES,
      html: emailHtml(prenom, when), text: emailTexte(prenom, when),
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

/* ============================================================
   RELANCES D'ACTIVATION (48 h puis J+7)
   Qui relancer et à quel stade est décidé par la vue SQL onboarding_candidates :
   la règle y reste testable sans redéployer la fonction. Deux relances au maximum,
   jamais plus — au-delà, chaque envoi coûte plus de confiance qu'il ne rapporte.
   ============================================================ */
type Candidat = {
  couple_code: string; stage: "j2" | "j7"; email: string; name: string | null;
  manque_partenaire: boolean; manque_moneydate: boolean; manque_budget: boolean;
};

function coquille(corps: string) {
  return `
  <div style="background:#141414;padding:32px 16px;font-family:Georgia,serif;color:#eee">
    <div style="max-width:480px;margin:0 auto;background:#1c1c1c;border-radius:12px;padding:32px;text-align:center">
      <h1 style="color:#e07856;margin:0 0 4px;font-size:24px">Budget à Deux</h1>
      <p style="color:#999;font-style:italic;margin:0 0 24px;font-size:14px">« L'argent n'est qu'un outil pour construire la vie que nous aimons ensemble. »</p>
      ${corps}
    </div>
  </div>`;
}
const bouton = (url: string, texte: string) =>
  `<a href="${url}" style="display:inline-block;background:#c1573f;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold">${texte}</a>`;

// Tant que le partenaire n'est pas là, rien d'autre n'a de sens : on ne liste pas trois
// tâches à quelqu'un qui n'a pas franchi la première. Une seule action par email.
// Le budget passe avant le Money Date : c'est lui qui rend l'app utile tout de suite. L'app dit
// déjà la même chose, son bandeau de configuration le qualifie de « base sans laquelle rien
// d'autre n'a de sens ». Caler un rendez-vous avant d'avoir de quoi en parler serait l'inverse.
//
// « votre budget » et non « ton budget » : ils appartiennent au couple, pas à la personne qui
// lit. Et pas « du mois » : la validation tient jusqu'à ce qu'on la modifie, écrire « du mois »
// ferait craindre une corvée mensuelle qui n'existe pas.
function resteAFaire(c: Candidat): string[] {
  if (c.manque_partenaire) return ["inviter ton/ta partenaire"];
  const l: string[] = [];
  if (c.manque_budget) l.push("valider votre budget");
  if (c.manque_moneydate) l.push("programmer votre premier Money Date");
  return l;
}
// « Pense à X ensemble, puis à Y. » : le « ensemble » se place après la PREMIÈRE tâche, sinon
// il ne porterait grammaticalement que sur la seconde.
function phraseAFaire(c: Candidat): string {
  const taches = resteAFaire(c);
  if (!taches.length) return "Pense à finir de configurer votre espace ensemble.";
  return `Pense à ${taches[0]} ensemble${taches[1] ? `, puis à ${taches[1]}` : ""}.`;
}

function onboardingEmail(c: Candidat) {
  const prenom = c.name ? c.name : "";
  const bonjour = prenom ? `Bonjour ${prenom},` : "Bonjour,";
  // Le bouton suit le même ordre que le texte : tant que le budget manque, il ouvre le Pilotage.
  // Sinon on enverrait le couple caler un rendez-vous avant d'avoir de quoi en parler.
  const lien = c.manque_partenaire
    ? "https://budgetadeux.fr/?ecran=reglages"
    : c.manque_budget ? "https://budgetadeux.fr/?ecran=pilotage" : "https://budgetadeux.fr/?ecran=moneydate";

  if (c.stage === "j2") {
    // « un pas » / « deux pas » plutôt qu'un nombre d'étapes fixe : le titre annonçait une seule
    // étape même quand le corps en listait deux.
    const pas = resteAFaire(c).length > 1 ? "deux" : "un";
    const ouverture = `${bonjour} ton espace est créé, mais il lui manque encore de quoi fonctionner.`;
    // « Vous n'êtes pas encore deux » et surtout pas « ton/ta partenaire t'attend » : à ce
    // stade le/la partenaire ignore que l'app existe, personne n'attend rien. Le dire mettait
    // une dette sur le dos de la seule personne à qui on écrit, justement parce qu'elle n'a
    // rien fait. Le constat de solitude est porté par le titre, la phrase ne le répète donc
    // pas ; ne reste que le repère de temps, qui justifie qu'on écrive maintenant.
    const corps = c.manque_partenaire
      ? `<h2 style="margin:0 0 12px;font-size:21px">Vous n'êtes pas encore deux</h2>
         <p style="color:#ccc;margin:0 0 24px">${bonjour} tu as créé ton espace il y a quelques jours. Budget à Deux prend tout son sens à partir du moment où tu le partages avec ton/ta partenaire.</p>
         ${bouton(lien, "Inviter mon/ma partenaire →")}`
      : `<h2 style="margin:0 0 12px;font-size:21px">Encore ${pas} pas et vous y êtes</h2>
         <p style="color:#ccc;margin:0 0 24px">${ouverture} ${phraseAFaire(c)}</p>
         ${bouton(lien, "Compléter mon espace →")}`;
    const texte = c.manque_partenaire
      ? `Vous n'êtes pas encore deux.\n\n${bonjour} tu as créé ton espace il y a quelques jours. Budget à Deux prend tout son sens à partir du moment où tu le partages avec ton/ta partenaire.\n\nInviter mon/ma partenaire : ${lien}`
      : `Encore ${pas} pas et vous y êtes.\n\n${ouverture} ${phraseAFaire(c)}\n\nCompléter mon espace : ${lien}`;
    return {
      // L'objet porte l'action, le titre porte le constat : lus coup sur coup, deux fois le
      // même « tu es encore seul(e) » sonnait insistant.
      subject: c.manque_partenaire ? "Il ne manque plus que ton/ta partenaire" : "Ton espace n'est pas encore opérationnel",
      html: coquille(corps),
      text: signature(texte),
    };
  }

  // J+7 : on ne répète pas la même consigne, on demande ce qui a bloqué. À ce stade, le
  // retour d'un couple resté à l'arrêt vaut plus qu'une inscription de plus.
  const corps = `<h2 style="margin:0 0 12px;font-size:21px">Tout va bien de ton côté&nbsp;?</h2>
     <p style="color:#ccc;margin:0 0 10px">${bonjour} on ne veut pas t'embêter ; juste vérifier que rien ne t'a bloqué.</p>
     <p style="color:#999;margin:0 0 20px;font-size:14px">Si quelque chose t'a arrêté, même un détail, <b style="color:#ccc">tu peux répondre à cet email</b>, ou nous écrire directement à <a href="mailto:${REPLY_TO}" style="color:#e07856;text-decoration:none">${REPLY_TO}</a>. C'est le genre de retour qui nous aide le plus en ce moment, bien plus qu'une inscription de plus.</p>
     ${bouton(lien, "Reprendre l'application →")}
     <p style="color:#777;margin:22px 0 0;font-size:12px">Et si ce n'est finalement pas pour toi, aucun souci : c'est notre dernier message.</p>`;
  const texte = `Tout va bien de ton côté ?\n\n${bonjour} on ne veut pas t'embêter ; juste vérifier que rien ne t'a bloqué.\n\nSi quelque chose t'a arrêté, même un détail, tu peux répondre à cet email, ou nous écrire directement à ${REPLY_TO}. C'est le genre de retour qui nous aide le plus en ce moment, bien plus qu'une inscription de plus.\n\nReprendre l'application : ${lien}\n\nEt si ce n'est finalement pas pour toi, aucun souci : c'est notre dernier message.`;
  return { subject: "Tout va bien de ton côté ?", html: coquille(corps), text: signature(texte) };
}

async function envoiRelance(c: Candidat, apiKey: string) {
  const { subject, html, text } = onboardingEmail(c);
  const body = { from: FROM, to: [c.email], subject, reply_to: REPLY_TO, headers: ENTETES, html, text };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

// deno-lint-ignore no-explicit-any
async function relancesActivation(admin: any, resendKey: string) {
  const { data, error } = await admin.from("onboarding_candidates").select("*");
  if (error) throw error;
  const candidats = (data ?? []) as Candidat[];

  let sent = 0;
  const errors: string[] = [];
  const aMarquer = new Map<string, { couple_code: string; stage: string; recipients: number }>();

  for (const c of candidats) {
    try {
      await envoiRelance(c, resendKey);
      sent++;
      const k = `${c.couple_code}|${c.stage}`;
      const acc = aMarquer.get(k) ?? { couple_code: c.couple_code, stage: c.stage, recipients: 0 };
      acc.recipients++;
      aMarquer.set(k, acc);
    } catch (e) {
      errors.push(`relance ${c.stage} ${c.couple_code}/${c.email}: ${(e as Error).message}`);
    }
  }

  // Marqué seulement après un envoi réussi : si Resend est en panne, le couple sera retenté
  // demain plutôt que perdu en silence. La clé primaire (couple_code, stage) garantit de
  // toute façon qu'une relance ne partira jamais deux fois.
  for (const v of aMarquer.values()) {
    const { error: upErr } = await admin.from("onboarding_reminders")
      .upsert(v, { onConflict: "couple_code,stage" });
    if (upErr) errors.push(`marquage ${v.couple_code}/${v.stage}: ${upErr.message}`);
  }
  return { sent, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
      return json({ error: "unauthorized" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Mode aperçu : POST {"apercu":"adresse@exemple.fr"} envoie les cinq emails du produit à
    // cette seule adresse, puis s'arrête. Rien n'est lu ni écrit en base, aucun couple n'est
    // relancé, aucune relance n'est marquée comme envoyée. Un navigateur ment sur le rendu
    // d'un email (fond sombre, polices, Outlook) : le seul juge est une vraie boîte mail.
    const corpsRequete = await req.json().catch(() => ({}));
    const apercu = typeof corpsRequete?.apercu === "string" ? corpsRequete.apercu.trim() : "";
    if (apercu) {
      const prenom = typeof corpsRequete?.prenom === "string" ? corpsRequete.prenom : "JB";
      const seul = typeof corpsRequete?.variante === "string" ? corpsRequete.variante : "";
      const faux = (o: Partial<Candidat>): Candidat => ({
        couple_code: "APERCU", stage: "j2", email: apercu, name: prenom,
        manque_partenaire: false, manque_moneydate: false, manque_budget: false, ...o,
      });
      const envois: Array<[string, () => Promise<void>]> = [
        ["moneyDate/veille", () => sendEmail(apercu, prenom, "demain", resendKey)],
        ["moneyDate/jourJ", () => sendEmail(apercu, prenom, "aujourdhui", resendKey)],
        ["relance/j2-partenaire-manquant", () => envoiRelance(faux({ manque_partenaire: true, manque_moneydate: true, manque_budget: true }), resendKey)],
        ["relance/j2-partenaire-present", () => envoiRelance(faux({ manque_moneydate: true, manque_budget: true }), resendKey)],
        ["relance/j7", () => envoiRelance(faux({ stage: "j7", manque_partenaire: true, manque_moneydate: true, manque_budget: true }), resendKey)],
      ];
      const envoyes: string[] = [];
      const echecs: string[] = [];
      // Un test de délivrabilité (mail-tester et consorts) note UNE adresse sur UN message :
      // lui en envoyer cinq fausse le résultat. {"variante":"..."} n'en envoie qu'un.
      for (const [nom, envoyer] of envois) {
        if (seul && nom !== seul) continue;
        try { await envoyer(); envoyes.push(nom); }
        catch (e) { echecs.push(`${nom}: ${(e as Error).message}`); }
      }
      return json({ ok: echecs.length === 0, apercu: true, destinataire: apercu, envoyes, echecs });
    }

    // Les deux usages partagent une exécution, mais on doit pouvoir n'en déclencher qu'un à la
    // main : relancer les activations un jour où un Money Date tombe renverrait un rappel déjà
    // reçu le matin même, et un doublon inquiète toujours plus qu'il n'informe.
    // POST {"seulement":"relances"} ou {"seulement":"moneydate"}. Le cron, lui, ne passe rien.
    const seulement = typeof corpsRequete?.seulement === "string" ? corpsRequete.seulement : "";
    const faireMoneyDate = seulement !== "relances";
    const faireRelances = seulement !== "moneydate";

    const today = parisDateStr(0);
    const tomorrow = parisDateStr(1);

    const { data: couples, error: cErr } = faireMoneyDate
      ? await admin.from("couple_state").select("couple_code, data")
      : { data: [], error: null };
    if (cErr) throw cErr;

    let sent = 0;
    const errors: string[] = [];

    for (const row of couples ?? []) {
      const nextDate: string | undefined = row.data?.moneyDate?.nextDate;
      if (!nextDate) continue;
      const when = nextDate === tomorrow ? "demain" : nextDate === today ? "aujourdhui" : null;
      if (!when) continue;

      const { data: members } = await admin
        .from("profiles").select("email, name").eq("couple_code", row.couple_code);
      for (const m of members ?? []) {
        if (!m.email) continue;
        try {
          await sendEmail(m.email, m.name || "", when, resendKey);
          sent++;
        } catch (e) {
          errors.push(`${row.couple_code}/${m.email}: ${(e as Error).message}`);
        }
      }
    }

    // Relances d'activation, dans la même exécution quotidienne : un seul cron, un seul
    // démarrage à froid (le coûteux, ~14 s) pour les deux usages.
    let relances = { sent: 0, errors: [] as string[] };
    try {
      if (faireRelances) relances = await relancesActivation(admin, resendKey);
    } catch (e) {
      // Un échec ici ne doit pas masquer le résultat des rappels Money Date, qui sont
      // la fonction principale et ont déjà été envoyés à ce stade.
      relances.errors.push(`relances: ${(e as Error).message}`);
    }

    return json({
      ok: true, today, tomorrow, seulement: seulement || null,
      moneyDate: faireMoneyDate ? { sent, errors } : "ignoré",
      relances: faireRelances ? relances : "ignoré",
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
