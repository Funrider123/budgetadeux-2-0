# Budget à Soi

Application de budget personnel, portée depuis **Budget à Deux 2.0** : même design system,
même moteur, sans tout ce qui suppose un partenaire.

Comme la 2.0, c'est **un seul fichier** (`index.html`), sans build ni bundler.

## Ce qui change par rapport à Budget à Deux

| Budget à Deux | Budget à Soi |
|---|---|
| Code couple, invitation, profil Lui/Elle | Un compte, un prénom |
| « Qui a payé » sur chaque dépense | Supprimé |
| 4 modes de répartition des charges | Revenus → charges → catégories → projets → reste à vivre |
| Charges communes / perso | Logement & essentiels / Abonnements |
| Money Date (rituel à deux) | Point du mois (rituel personnel, mêmes 6 étapes) |
| Table `couple_state` (clé `couple_code`) | Table `user_state` (clé `user_id`) |
| Palette terracotta par défaut | Palette sauge par défaut |

Le reste est identique : Vue, Ajouter, Historique, Projets, Analyse 50/30/20, cagnotte,
report d'enveloppe, prévisions, date de démarrage, historique des budgets, export CSV,
mode démo, PWA, thème clair/sombre.

## Développer

```bash
npm ci
npx playwright install chromium
npx playwright test        # 124 tests
python3 -m http.server 4174  # puis ouvrir http://127.0.0.1:4174/index.html
```

## Backend (Supabase)

Même projet Supabase que Budget à Deux, mais **aucune table de la 2.0 n'est utilisée** :
il n'y a pas de ligne `profiles` (elle ne sert là-bas qu'à retrouver le partenaire), le
prénom vit dans les métadonnées du compte et tout le budget dans `user_state`.

- `user_state` — un document JSON par utilisateur, clé `user_id`, RLS `auth.uid() = user_id`,
  publiée en temps réel (synchro téléphone ↔ ordinateur).
- RPC `solo_schedule_deletion`, `solo_get_pending_deletion`, `solo_cancel_deletion` —
  suppression de compte avec le délai de grâce de 14 jours.
- Tâche planifiée quotidienne `purge_expired_solo_deletions` — exécute ce qui a expiré.

## Mise en ligne

Second site Netlify pointé sur ce dossier (**base directory = `solo`**), donc un domaine
distinct de Budget à Deux : deux origines, deux service workers, deux stockages locaux,
deux PWA installables séparément.

Après le premier déploiement, ajouter l'URL du site dans
**Supabase → Authentication → URL Configuration → Redirect URLs**, sinon les liens de
confirmation d'email et de réinitialisation de mot de passe ne reviendront pas sur l'app.
