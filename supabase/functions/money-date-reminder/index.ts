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

// L'adresse d'envoi doit être sur budgetadeux.fr : c'est le domaine vérifié chez Resend,
// celui que SPF et DKIM signent. Une adresse @gmail.com ici échouerait DMARC et partirait en
// indésirables. "no-reply@" a l'inconvénient d'annoncer le silence ; c'est pourquoi la relance
// de J+7 écrit l'adresse de contact noir sur blanc dans son texte, au lieu de compter sur le
// seul bouton « Répondre ».
const FROM = "Budget à Deux <no-reply@budgetadeux.fr>";

// Adresse réellement relevée. Tous les emails la portent en reply-to : avec une poignée de
// couples testeurs, une réponse à un rappel Money Date vaut de l'or, il serait absurde de la
// refuser sous prétexte que cet email-là n'en demandait pas. Le bouton « Répondre » d'un
// client mail suit ce champ, pas le no-reply affiché : la réponse arrive donc bien ici.
const REPLY_TO = "equipe.budgetadeux@gmail.com";

// La veille : un simple rappel, sans appel à l'action — il n'y a rien à faire ce soir-là, et
// un gros bouton inviterait à commencer le rendez-vous tout seul, sans l'autre.
// Le jour J : le lien ouvre directement l'écran du Money Date (?ecran=moneydate), pour ne pas
// retomber sur la Vue et devoir le retrouver dans le menu.
function emailHtml(prenom: string, when: "demain" | "aujourdhui") {
  const bonjour = prenom ? `Bonjour ${prenom},` : "Bonjour,";
  const corps = when === "demain"
    ? `<h2 style="margin:0 0 12px;font-size:21px">Votre Money Date, c'est demain</h2>
       <p style="color:#ccc;margin:0">${bonjour} pensez à garder une demi-heure ensemble demain.</p>`
    : `<h2 style="margin:0 0 12px;font-size:21px">C'est aujourd'hui votre Money Date</h2>
       <p style="color:#ccc;margin:0 0 24px">${bonjour} une demi-heure à deux, et tout sera dit pour le mois.</p>
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
    ? `Votre Money Date, c'est demain.\n\n${bonjour} pensez à garder une demi-heure ensemble demain.`
    : `C'est aujourd'hui votre Money Date.\n\n${bonjour} une demi-heure à deux, et tout sera dit pour le mois.\n\nCommencer notre Money Date : https://budgetadeux.fr/?ecran=moneydate`);
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
function resteAFaire(c: Candidat): string[] {
  if (c.manque_partenaire) return ["inviter votre partenaire"];
  const l: string[] = [];
  if (c.manque_moneydate) l.push("programmer votre premier Money Date");
  if (c.manque_budget) l.push("valider votre budget du mois");
  return l;
}

function onboardingEmail(c: Candidat) {
  const prenom = c.name ? c.name : "";
  const bonjour = prenom ? `Bonjour ${prenom},` : "Bonjour,";
  const lien = c.manque_partenaire
    ? "https://budgetadeux.fr/?ecran=reglages"
    : c.manque_moneydate ? "https://budgetadeux.fr/?ecran=moneydate" : "https://budgetadeux.fr/?ecran=pilotage";

  if (c.stage === "j2") {
    const corps = c.manque_partenaire
      ? `<h2 style="margin:0 0 12px;font-size:21px">Votre partenaire vous attend</h2>
         <p style="color:#ccc;margin:0 0 10px">${bonjour} vous avez créé votre espace il y a quelques jours ; mais vous y êtes encore seul(e).</p>
         <p style="color:#999;margin:0 0 24px;font-size:14px">Budget à Deux prend tout son sens à partir du moment où vous le partagez avec votre partenaire.</p>
         ${bouton(lien, "Inviter mon/ma partenaire →")}`
      : `<h2 style="margin:0 0 12px;font-size:21px">Il reste une étape</h2>
         <p style="color:#ccc;margin:0 0 10px">${bonjour} votre espace est presque prêt. Il vous reste à ${resteAFaire(c).join(" et ")}.</p>
         ${bouton(lien, "Reprendre là où j'en étais →")}`;
    const texte = c.manque_partenaire
      ? `Votre partenaire vous attend.\n\n${bonjour} vous avez créé votre espace il y a quelques jours ; mais vous y êtes encore seul(e).\n\nBudget à Deux prend tout son sens à partir du moment où vous le partagez avec votre partenaire.\n\nInviter mon/ma partenaire : ${lien}`
      : `Il reste une étape.\n\n${bonjour} votre espace est presque prêt. Il vous reste à ${resteAFaire(c).join(" et ")}.\n\nReprendre là où j'en étais : ${lien}`;
    return {
      subject: c.manque_partenaire ? "Vous êtes encore seul(e) sur Budget à Deux" : "Il reste une étape pour démarrer",
      html: coquille(corps),
      text: signature(texte),
    };
  }

  // J+7 : on ne répète pas la même consigne, on demande ce qui a bloqué. À ce stade, le
  // retour d'un couple resté à l'arrêt vaut plus qu'une inscription de plus.
  const corps = `<h2 style="margin:0 0 12px;font-size:21px">Tout va bien de votre côté&nbsp;?</h2>
     <p style="color:#ccc;margin:0 0 10px">${bonjour} on ne veut pas vous embêter ; juste vérifier que rien ne vous a bloqué.</p>
     <p style="color:#999;margin:0 0 20px;font-size:14px">Si quelque chose vous a arrêté, même un détail, <b style="color:#ccc">vous pouvez répondre à cet email</b>, ou nous écrire directement à <a href="mailto:${REPLY_TO}" style="color:#e07856;text-decoration:none">${REPLY_TO}</a>. C'est le genre de retour qui nous aide le plus en ce moment, bien plus qu'une inscription de plus.</p>
     ${bouton(lien, "Reprendre l'application →")}
     <p style="color:#777;margin:22px 0 0;font-size:12px">Et si ce n'est finalement pas pour vous, aucun souci : c'est notre dernier message.</p>`;
  const texte = `Tout va bien de votre côté ?\n\n${bonjour} on ne veut pas vous embêter ; juste vérifier que rien ne vous a bloqué.\n\nSi quelque chose vous a arrêté, même un détail, vous pouvez répondre à cet email, ou nous écrire directement à ${REPLY_TO}. C'est le genre de retour qui nous aide le plus en ce moment, bien plus qu'une inscription de plus.\n\nReprendre l'application : ${lien}\n\nEt si ce n'est finalement pas pour vous, aucun souci : c'est notre dernier message.`;
  return { subject: "Tout va bien de votre côté ?", html: coquille(corps), text: signature(texte) };
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
