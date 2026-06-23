# ✅ Checklist de parité — Budget à Deux 1.0 → 2.0

> Document vivant. Coche les cases au fur et à mesure que la 2.0 rattrape la 1.0.
> Créé le 2026-06-21 · Comparaison entre `budgetadeuxv322.html` (1.0) et `budget-a-deux-2.0.html` (2.0).

## Légende
- `[x]` ✅ **Pareil** — présent en 2.0 et fonctionne comme la 1.0 (refait au design 2.0)
- `[ ]` 🔧 **Modifié** — présent en 2.0 mais changé, simplifié ou pas encore branché à la vraie logique
- `[ ]` ❌ **Manquant** — existe en 1.0, pas encore en 2.0
- ✨ **Nouveau** — ajouté en 2.0, n'existait pas en 1.0

## ⚠️ Contexte important
La 2.0 est aujourd'hui une **maquette front-end** : les écrans sont dessinés et navigables, mais les données sont **simulées en local** (pas de vrai backend). C'est ce qui explique la plupart des 🔧 et ❌ — l'écran existe, mais la logique réelle n'est pas encore connectée.

---

## 🔐 Authentification & couple
- [ ] 🔧 **Connexion / inscription email + mot de passe** — refaite mais simulée (pas le vrai Supabase Auth)
- [ ] 🔧 **Mot de passe oublié + lien de réinitialisation** — écran présent, lien email pas branché
- [x] ✅ **Accueil : prénom + code couple (créer / rejoindre)**
- [x] ✅ **Choix profil Lui / Elle**
- [ ] 🔧 **Restauration de session** — simple drapeau local

## ➕ Ajouter une dépense
- [x] ✅ **Montant, date, description**
- [x] ✅ **Sélecteur catégorie + budget restant** — 2.0 affiche mois + semaine
- [x] ✅ **Commerces habituels (max 8)**
- [ ] 🔧 **Prévision 🔮** — 1.0 : via date + Money Date · 2.0 : toggle direct
- [ ] 🔧 **Dépense depuis la cagnotte** — 2.0 : toggle explicite
- [x] ✅ **Détection des virements internes** — 2.0 : auto par mot-clé

## 📊 Vue (dashboard)
- [x] ✅ **Bascule mensuel / hebdo**
- [x] ✅ **Cartes total / restant / %**
- [x] ✅ **Répartition Lui / Elle**
- [x] ✅ **Barres par catégorie + alertes (presque atteint / dépassé)**
- [ ] 🔧 **Graphique annuel 12 mois** — présent mais données factices
- [ ] 🔧 **Bannières d'alerte globales en haut** — 2.0 : alertes par catégorie seulement
- ✨ **Équilibre du couple (cœur)** — nouveau déco 2.0

## 📋 Historique
- [x] ✅ **Navigation mois par mois**
- [x] ✅ **Filtres type / personne / catégorie**
- [x] ✅ **Récap par catégorie**
- [x] ✅ **Recatégoriser une dépense**
- [x] ✅ **Supprimer une dépense**
- [x] ✅ **Notes sur mouvements internes**

## 🎯 Projets
- [x] ✅ **Cagnotte : solde + historique des entrées/sorties**
- [ ] 🔧 **Création projet (cible, épargné, durée, jour, répartition %, classif.)** — 2.0 manque « date de début »
- [x] ✅ **Calcul mensuel auto**
- [x] ✅ **Pause / reprise**
- [x] ✅ **Réaffectation de l'épargne**
- [x] ✅ **Abandon (récupérer / supprimer)**
- [ ] 🔧 **Disponible pour projets** — montant affiché, sans la formule détaillée

## 📈 Analyse (50/30/20) — le plus gros écart
- [ ] 🔧 **Donuts idéal vs réel** — 1.0 : 4 catégories (Besoins/Envies/Invest/Protection) · 2.0 : 3 seulement
- [ ] ❌ **Ajuster l'idéal (sliders)** — figé à 50/30/20 en 2.0
- [x] ✅ **Verdict bienveillant**
- [ ] 🔧 **Accord du couple par catégorie** — 1.0 : accordéon détaillé · 2.0 : simple case « d'accord »
- [ ] ❌ **Graphe empilé 12 mois par type**
- [ ] ❌ **Courbe Vision / Budgété / Réel + tooltip**
- [ ] ❌ **Concept « Vision » (trajectoire cible)**
- [ ] ❌ **4ᵉ catégorie « Protection »** — fusionnée dans « épargne » en 2.0

## 📅 Money Date
- [x] ✅ **6 étapes + barre de progression X/6**
- [ ] 🔧 **Format** — 1.0 : checklist déroulante · 2.0 : assistant pas-à-pas
- [ ] 🔧 **Transfert de surplus (vrai formulaire) à l'étape 3** — 2.0 : choix visuel factice
- [ ] 🔧 **Gérer les prévisions à l'étape 5** — 2.0 : mini-formulaire factice
- [ ] 🔧 **Fixer prochain RDV : date + heure** — 2.0 : date seule
- [ ] ❌ **Bannière « prochain Money Date »**
- [ ] ❌ **Liens → Vue / Historique / Projets depuis les étapes**

## ⚙️ Réglages
- [x] ✅ **Code couple + copier**
- [x] ✅ **Inviter WhatsApp / SMS**
- [x] ✅ **Changer de profil / déconnexion**
- [x] ✅ **Réinitialiser les dépenses**
- [x] ✅ **Export CSV**
- [ ] 🔧 **Gestion des commerces habituels** — 1.0 : modal dédié ici · 2.0 : ajout depuis « Ajouter »
- [ ] 🔧 **Mode clair / sombre** — 1.0 : sombre par défaut · 2.0 : clair par défaut

## 🎛️ Pilotage du budget
- [x] ✅ **Revenus / salaires**
- [x] ✅ **4 modes de répartition**
- [x] ✅ **Charges communes**
- [ ] 🔧 **Charges perso Lui / Elle** — 1.0 : blocs détaillés par personne + sliders · 2.0 : liste simple
- [ ] 🔧 **Verrouillage des charges** — 2.0 : cadenas décoratif
- [x] ✅ **Catégories (emoji / budget / classification, hebdo auto)**
- [x] ✅ **Total à verser par personne**
- ✨ **Copier RIB** — nouveau en 2.0
- [ ] 🔧 **Virements détaillés (→ compte commun + → épargne projets)** — 2.0 : total + part, sans le détail 2 destinations
- [ ] ❌ **Verrou « figer les paramètres » + Annuler (undo)**
- [ ] 🔧 **Date d'effet du budget** — affichée, logique d'application différée absente

## 🚧 Chantier en pause — Moteur Supabase
> En attente : accès Supabase (mot de passe DB / schéma exact des tables 1.0).
> Pour reprendre : dire « ok on démarre [nom de la tâche] » à Claude, qui relira cette section.

**Fait :**
- SDK `@supabase/supabase-js` chargé dans `index.html` (`<head>`)
- Client `sb` initialisé avec l'URL du projet 1.0 (`https://oleysrvrwaqorbaawiwd.supabase.co`) et la clé `anon`
- Décisions déjà actées pour l'auth réelle (à implémenter dès le schéma connu) :
  1. Code couple inconnu → message d'erreur explicite ("ce code n'est pas connu, merci de vérifier")
  2. Email non confirmé → accès bloqué jusqu'à confirmation
  3. Un couple = exactement 2 profils → message si on tente de rejoindre un code déjà complet
  4. Écran par défaut au premier lancement = signup (pas "Heureux de vous revoir") — déjà fait
  5. Copie clarifiée : chacun crée son propre compte, lié ensuite via le code couple (pas un compte partagé)

**Reste à faire — la tâche complète au démarrage couvrira tout ça, dans cet ordre :**
1. Récupérer le schéma exact des tables 1.0 (`couples`, `profiles`, etc.) — requête SQL prête à lancer dans le SQL Editor Supabase :
   ```sql
   select table_name, column_name, data_type, is_nullable, column_default
   from information_schema.columns
   where table_schema = 'public'
   order by table_name, ordinal_position;
   ```
2. **Rédiger le schéma SQL en avance si besoin** (CREATE TABLE + RLS pour `couples`, `profiles`, `categories`, `expenses`, `mouvements`, `budget_history`, `projects`, `charges_fixes`, `perso_budget`, `revenues`, `cagnotte`) si le schéma 1.0 n'existe pas encore tel quel ou doit être complété
3. **Simulation locale temporaire** des 3 messages de validation (code inconnu / couple complet / email non confirmé) via localStorage, pour valider l'UX rapidement — étape intermédiaire avant le vrai branchement, à ne pas oublier de retirer ensuite
4. Écrire signup/login réels (`supabase.auth.signUp` / `signInWithPassword`)
5. Écrire la logique de création/jointure de couple par code (avec les 3 messages d'erreur ci-dessus, cette fois branchés sur la vraie base)
6. Brancher la confirmation d'email et le "mot de passe oublié" réel

## 🔧 Transverses — les vrais gros morceaux
- [ ] ❌ **Synchro temps réel Supabase** — 2.0 = local seulement → CHANTIER N°1
- [ ] ❌ **Report du dépassement d'un mois sur l'autre**
- [ ] ❌ **Virements figés (geler les virements du mois)**
- [ ] 🔧 **Historique des budgets + date d'effet** — liste affichée, logique non branchée
- [x] ✅ **Bouton signalement de bug 🚨**
- [x] ✅ **Notifications toast**
- [x] ✅ **Thème clair / sombre** — défaut inversé

---

## 🎯 Les 5 priorités à porter pour une vraie parité
1. **Le moteur Supabase** (auth réelle + synchro + même schéma que la 1.0) → 80 % de l'écart « maquette → appli officielle ».
2. **L'Analyse riche** : 4ᵉ catégorie Protection, idéal ajustable, courbes Vision/Budgété/Réel, accord du couple détaillé.
3. **Le report du dépassement** d'un mois sur l'autre.
4. **Pilotage complet** : verrou/figer + undo, virements à 2 destinations, charges perso détaillées.
5. **Money Date** : transfert et prévisions réels (pas factices), date + heure, bannière de rappel.

> Le reste (les ✅ et la majorité des 🔧) est surtout du **branchement de logique** sur des écrans déjà dessinés — donc rapide une fois le moteur en place.

---

## 🗂️ Rappel des tables Supabase de la 1.0 (pour le branchement futur)
Toutes indexées par `couple_code` :
`couples` · `couple_names` · `profiles` · `categories` · `expenses` · `mouvements` · `budget_history` · `projects` · `charges_fixes` · `perso_budget` · `revenues` · `cagnotte`
