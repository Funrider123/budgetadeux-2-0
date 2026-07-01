// Edge Function : suppression de compte / données couple (sécurisée, service_role)
// Modes :
//   'account' → supprime mon profil + mon compte auth (email/login).
//               Si je suis le dernier membre → supprime aussi tout le couple.
//   'couple'  → réinitialise le budget commun (couple_state) ; garde les comptes.
//               (Affecte aussi le partenaire — budget remis à zéro.)
//   'all'     → supprime mon compte auth ET le budget commun.
//               Si dernier membre → suppression totale du couple ; sinon budget réinitialisé.
//
// On ne supprime la ligne `couples` (et couple_names) que lorsqu'il ne reste
// plus aucun membre, pour ne jamais casser le partenaire restant.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Budget "vierge" (mêmes clés que l'app) — arrays vides pour un vrai reset.
const RESET_BUDGET = {
  settings: { salaries: { lui: 0, elle: 0 }, mode: "5050", custom: { lui: 50, elle: 50 } },
  categories: [
    { id: "courses", emoji: "🛒", name: "Courses", budget: 300, cls: "besoin" },
    { id: "loisirs", emoji: "🎉", name: "Loisirs", budget: 100, cls: "envie" },
  ],
  charges: [],
  merchants: [],
  expenses: [],
  cagnotte: { balance: 0, history: [] },
  projects: [],
  moneyDate: { doneSteps: [], nextDate: "" },
  budgetHistory: [],
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!jwt) return json({ error: "no-auth" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Identifie l'appelant depuis son JWT (on ne peut supprimer que soi-même)
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "invalid-user" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode;
    if (!["account", "couple", "all"].includes(mode)) return json({ error: "bad-mode" }, 400);

    // Profil + couple de l'appelant
    const { data: prof } = await admin
      .from("profiles").select("couple_code").eq("user_id", uid).maybeSingle();
    const coupleCode: string | null = prof?.couple_code ?? null;

    // Reste-t-il d'autres membres ?
    let otherCount = 0;
    if (coupleCode) {
      const { data: members } = await admin
        .from("profiles").select("user_id").eq("couple_code", coupleCode).neq("user_id", uid);
      otherCount = members?.length ?? 0;
    }
    const amLast = otherCount === 0;

    const deleteCoupleFully = async () => {
      if (!coupleCode) return;
      await admin.from("couple_state").delete().eq("couple_code", coupleCode);
      await admin.from("couple_names").delete().eq("couple_code", coupleCode);
      for (const t of ["expenses", "categories", "revenues", "projects", "charges_fixes",
                       "cagnotte", "mouvements", "budget_history", "clotures", "perso_budget"]) {
        await admin.from(t).delete().eq("couple_code", coupleCode);
      }
      await admin.from("couples").delete().eq("code", coupleCode);
    };
    const resetBudget = async () => {
      if (!coupleCode) return;
      await admin.from("couple_state").upsert({
        couple_code: coupleCode,
        data: RESET_BUDGET,
        updated_at: new Date().toISOString(),
        updated_by: "reset-" + Math.random().toString(36).slice(2, 8),
      });
    };
    const deleteMyAccount = async () => {
      await admin.from("profiles").delete().eq("user_id", uid);
      await admin.auth.admin.deleteUser(uid);
    };

    if (mode === "couple") {
      await resetBudget();
    } else if (mode === "account") {
      await deleteMyAccount();
      if (amLast) await deleteCoupleFully();
    } else if (mode === "all") {
      if (amLast) await deleteCoupleFully();
      else await resetBudget(); // le partenaire reste : on vide le budget mais on garde le couple
      await deleteMyAccount();
    }

    return json({ ok: true, mode, amLast });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
