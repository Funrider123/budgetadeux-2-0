// Edge Function : rappel email pour le "Money Date" (rendez-vous financier du couple).
// Déclenchée une fois par jour par un cron (voir README-cron.md dans ce dossier).
//
// Pour chaque couple dont couple_state.data.moneyDate.nextDate tombe demain ou aujourd'hui
// (heure de Paris), on envoie un email aux deux partenaires via l'API Resend — le même
// domaine déjà vérifié pour les emails de récupération de mot de passe (no-reply@budgetadeux.fr).
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

const FROM = "Budget à Deux <no-reply@budgetadeux.fr>";

function emailHtml(prenom: string, when: "demain" | "aujourdhui") {
  const titre = when === "demain" ? "Votre Money Date, c'est demain !" : "C'est aujourd'hui votre Money Date !";
  const sous = when === "demain"
    ? "Prenez un moment ce soir pour vous organiser à deux."
    : "Votre rendez-vous financier à deux, en 6 étapes.";
  return `
  <div style="background:#141414;padding:32px 16px;font-family:Georgia,serif;color:#eee">
    <div style="max-width:480px;margin:0 auto;background:#1c1c1c;border-radius:12px;padding:32px;text-align:center">
      <h1 style="color:#e07856;margin:0 0 4px">Budget à Deux</h1>
      <p style="color:#999;font-style:italic;margin:0 0 24px">« L'argent n'est qu'un outil pour construire la vie que nous aimons ensemble. »</p>
      <h2 style="margin:0 0 12px">${titre}</h2>
      <p style="color:#ccc;margin:0 0 24px">Bonjour ${prenom ? prenom : ""} — ${sous}</p>
      <a href="https://budgetadeux.fr" style="display:inline-block;background:#c1573f;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:bold">Ouvrir Budget à Deux →</a>
    </div>
  </div>`;
}

async function sendEmail(to: string, prenom: string, when: "demain" | "aujourdhui", apiKey: string) {
  const subject = when === "demain" ? "💛 Votre Money Date, c'est demain" : "❤️ C'est aujourd'hui votre Money Date !";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html: emailHtml(prenom, when) }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
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

    const today = parisDateStr(0);
    const tomorrow = parisDateStr(1);

    const { data: couples, error: cErr } = await admin.from("couple_state").select("couple_code, data");
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

    return json({ ok: true, today, tomorrow, sent, errors });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
