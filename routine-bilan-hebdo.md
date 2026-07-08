# Routine Bilan Hebdomadaire — Vendredi 18h (Europe/Paris)

## Déclenchement
- Cron : `0 18 * * 5` (vendredi 18h, heure Paris)
- En cas d'échec : notification push + retry samedi 8h

---

## Règles fondamentales

- **Fuseau horaire** : toujours Europe/Paris (UTC+2 en été, UTC+1 en hiver)
- **Semaine = lundi 00h00 → vendredi 18h00** (Paris). Le week-end est du bonus pour la semaine suivante.
- **Seules les tâches taguées "SXX :"** en début de titre comptent dans le bilan. Les tâches sans tag = en attente, ignorées.
- **Pondération** : 1 tâche Bloc projet = 2 pts · 1 tâche Tâches annexes = 1 pt
- **Score pondéré** = pts réalisés / pts possibles (arrondi à l'entier le plus proche)
- **Tâches imprévues** = tâches taguées SXX faites pendant la semaine mais absentes de la liste planifiée du vendredi précédent
- **Grade** : ≥90% → A · ≥80% → B · ≥70% → C · ≥60% → D · <60% → F

---

## Étape 1 — Identifier la semaine courante

Calculer le numéro de semaine ISO (SXX) et les dates en Paris timezone :
- Début de semaine = lundi de la semaine courante
- Fin de semaine = vendredi de la semaine courante (aujourd'hui, 18h)
- Semaine suivante = S(XX+1), lundi → vendredi

---

## Étape 2 — Lire Superlist

Charger les 3 listes : "Bloc projet", "Tâches annexes" (+ toute autre liste pertinente)

**Tâches SXX faites** (onglet Done/Marked as done) :
- Filtrer toutes les tâches dont le titre commence par "SXX :" ou "SXX ;"
- Répartir par catégorie : Bloc projet / Tâches annexes

**Tâches SXX non faites** (onglet Tasks for me, non cochées) :
- Même filtre
- Répartir par catégorie

**Tâches S(XX+1)** (onglet Tasks for me, non cochées) :
- Filtrer "S(XX+1) :"
- Répartir par catégorie : Bloc projet / Tâches annexes
- Identifier lesquelles sont déjà faites (Done) → badge "✓ fait"
- Identifier les reports depuis SXX (tâches non faites de SXX replanifiées en S(XX+1)) → badge "↻ report"
- Toutes les autres → badge "nouveau"

**Tâches imprévues** :
- Tâches taguées SXX présentes dans Done mais absentes de la liste planifiée initiale

---

## Étape 3 — Calculs

```
pts_projet   = nb_projet_faits × 2
max_projet   = nb_projet_total × 2
pts_annexes  = nb_annexes_faits × 1
max_annexes  = nb_annexes_total × 1
score_pondere = round((pts_projet + pts_annexes) / (max_projet + max_annexes) × 100)
score_brut    = round((nb_projet_faits + nb_annexes_faits) / (nb_projet_total + nb_annexes_total) × 100)
```

Grade : ≥90→A · ≥80→B · ≥70→C · ≥60→D · <60→F

Donut SVG (r=38, circumference=238.76) :
- dasharray_fill = round(238.76 × score_pondere / 100, 2)
- dasharray_gap  = round(238.76 - dasharray_fill, 2)

---

## Étape 4 — Générer l'analyse

**Partie Performance** (2-3 phrases) :
- Commenter le score pondéré vs brut
- Mentionner ce qui tire vers le haut / vers le bas
- Si le bloc projet est en retrait ≥2 semaines consécutives : suggérer de bloquer du temps projet en début de semaine

**Partie Qualité des tâches** (uniquement si des tâches non faites ont une formulation floue) :
- Signaler les verbes trop vagues : "finaliser", "stabiliser", "faire", "gérer", "s'occuper de"
- Proposer une reformulation actionnable et vérifiable
- Ne pas commenter les tâches bien formulées

---

## Étape 5 — Générer le bilan HTML (format Carnet)

Publier un Artifact HTML avec le template ci-dessous, en remplaçant toutes les données dynamiques.

Le template de référence est l'Artifact publié à l'URL :
https://claude.ai/code/artifact/c7073614-cc00-4911-adb3-a30dce61238a

Données à injecter :
- Numéro de semaine (SXX)
- Dates lundi–vendredi (Paris)
- Score pondéré + grade + donut SVG (dasharray calculé)
- Score brut (N faites / M totales)
- Formule pondération (pts projet / pts annexes)
- Liste tâches Bloc projet (done/fail/report badges)
- Liste tâches Tâches annexes (done)
- Liste tâches Imprévues (violet, 0 si vide)
- Texte analyse (performance + qualité)
- Graphe double courbe (mettre à jour les points existants + ajouter le nouveau)
- Section Objectifs S(XX+1) : Bloc projet + Tâches annexes séparés, badges report/nouveau/fait

Footer : "généré automatiquement le [jour] [date] à 18h" ou "[jour] [date] (routine du [vendredi précédent] en échec)" si retry

---

## Étape 6 — Créer le Google Drive

Créer un nouveau fichier Google Doc nommé "Semaine XX - Bilan" avec le contenu structuré en texte brut (même données que le HTML, format lisible).

---

## Étape 7 — Notifications push

**Succès** :
> Bilan S{XX} généré ✅ — Score {score}% ({grade}) · {n}/{m} tâches · [lien Artifact]

**Échec** (Superlist non disponible ou erreur) :
> Bilan S{XX} ❌ — Raison : {erreur}. Retry programmé samedi à 8h.
> → Créer un CronCreate one-shot pour samedi 8h avec le même prompt.

**Retry samedi** (succès ou échec) :
> Bilan S{XX} — retry samedi : {succès ✅ score% / échec ❌ raison}
