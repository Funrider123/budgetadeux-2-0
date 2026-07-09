# Routine Bilan Hebdomadaire — Vendredi 18h (Europe/Paris)

## Déclenchement
- Cron : `0 18 * * 5` (vendredi 18h, heure Paris)
- En cas d'échec : retry samedi 8h (CronCreate one-shot)

---

## Règles fondamentales

- **Fuseau horaire** : toujours Europe/Paris
- **Semaine = lundi 00h00 → vendredi 18h00** (Paris). Le week-end est du bonus pour la semaine suivante.
- **Seules les tâches taguées "SXX :"** en début de titre comptent dans le bilan. Ignore tout le reste.
- **Pondération** : Bloc projet = ×2 pts · Tâches annexes = ×1 pt
- **Grade** : ≥90% → A · ≥80% → B · ≥70% → C · ≥60% → D · <60% → F
- **Tâches imprévues** = taguées SXX, faites pendant la semaine, absentes de la liste planifiée initiale

---

## Étape 1 — Calculer la semaine

```bash
python3 -c "
from datetime import datetime, timedelta
import pytz
tz = pytz.timezone('Europe/Paris')
now = datetime.now(tz)
cal = now.isocalendar()
week, year = cal.week, cal.year
monday = now - timedelta(days=now.weekday())
friday = monday + timedelta(days=4)
print(f'WEEK={week}')
print(f'YEAR={year}')
print(f'NEXT_WEEK={week+1 if week < 52 else 1}')
print(f'DATE_RANGE={monday.strftime(\"%d %B\")} - {friday.strftime(\"%d %B %Y\")}')
"
```

---

## Étape 2 — Lire Todoist (semaine courante + semaine suivante)

### 2A — Tâches de la semaine `S{week}`

Rechercher dans Todoist toutes les tâches dont le titre commence par `S{week} :` :

1. **Tâches complétées** cette semaine (lundi 00h → vendredi 18h Paris) → état = **done**
2. **Tâches actives** (non complétées) avec préfixe `S{week} :` → état = **fail**

Classer chaque tâche :
- Tâches dans le projet principal (Budget à Deux, dev, sprint) → **type = "projet"** (×2 pts)
- Toutes les autres → **type = "annexe"** (×1 pt)

### 2B — Objectifs `S{next_week}` (pour la section "Objectifs semaine suivante")

Rechercher dans Todoist toutes les tâches actives dont le titre commence par `S{next_week} :` :

- Chaque tâche trouvée → état = **new**
- Les tâches **fail** de S{week} sont automatiquement ajoutées avec état = **report** (le script le fait si `next_tasks` est vide, mais il vaut mieux les inclure explicitement)
- Classer par type (projet / annexe) de la même façon qu'en 2A

Calculer aussi :
- `next_week_dates` : lundi de S{next_week} → vendredi de S{next_week} (format "DD mois - DD mois YYYY")

---

## Étape 3 — Calculer le score

```
pts_projet   = nb_done_projet × 2
max_projet   = nb_total_projet × 2
pts_annexes  = nb_done_annexes × 1
max_annexes  = nb_total_annexes × 1
score        = round((pts_projet + pts_annexes) / (max_projet + max_annexes) × 100)
grade        = A si ≥90% · B si ≥80% · C si ≥70% · D si ≥60% · F sinon
```

---

## Étape 4 — Construire le JSON bilan

```json
{
  "week": {week},
  "year": {year},
  "date_range": "{date_range}",
  "next_week": {next_week},
  "next_week_dates": "{lundi S{next_week}} - {vendredi S{next_week}}",
  "tasks": [
    {"label": "S{week} : ...", "type": "projet", "state": "done"},
    {"label": "S{week} : ...", "type": "annexe", "state": "fail"},
    ...
  ],
  "history": [
    {"week": "S{week-3}", "projet_pct": {val}, "annexe_pct": {val}},
    {"week": "S{week-2}", "projet_pct": {val}, "annexe_pct": {val}},
    {"week": "S{week-1}", "projet_pct": {val}, "annexe_pct": {val}},
    {"week": "S{week}",   "projet_pct": {val}, "annexe_pct": {val}}
  ],
  "analyse": "{texte_analyse_libre}",
  "next_tasks": [
    {"label": "S{week} : ...",      "type": "projet", "state": "report"},
    {"label": "S{next_week} : ...", "type": "projet", "state": "new"},
    {"label": "S{next_week} : ...", "type": "annexe", "state": "new"},
    ...
  ]
}
```

Pour "history" : lire le fichier `/home/user/budgetadeux-2-0/data/bilan-history.json` s'il existe. Sinon utiliser uniquement la semaine courante.

Pour "analyse" : rédiger 1-3 phrases synthétisant la semaine — performance du bloc projet vs annexes, tâches reportées, recommandation pour S{next_week}. Ton factuel et direct.

Pour "next_tasks" : combiner les tâches fail de S{week} (state="report") + les tâches actives S{next_week} trouvées en étape 2B (state="new").

---

## Étape 5 — Générer le PDF

```bash
B64=$(python3 /home/user/budgetadeux-2-0/scripts/generate_bilan_pdf.py '{json_data}')
echo "Base64 length: ${#B64}"
```

Le script génère un PDF ~3-5KB (Helvetica built-in, pas d'embed de police).
La sortie est la chaîne base64 pure (~4500-6000 caractères).

---

## Étape 6 — Uploader dans Google Drive

Appeler l'outil MCP `mcp__Google_Drive__create_file` avec :
- `title` : `"S{week}-{year} / {score}% — Bilan hebdomadaire"`
- `contentMimeType` : `"application/pdf"`
- `disableConversionToGoogleType` : `true`
- `base64Content` : la chaîne base64 produite à l'étape 5

---

## Étape 7 — Mettre à jour l'historique

Écrire/mettre à jour `/home/user/budgetadeux-2-0/data/bilan-history.json` :
- Ajouter `{"week": "S{week}", "projet_pct": {proj_pct}, "annexe_pct": {ann_pct}}`
- Conserver les 8 dernières entrées maximum
- Commit + push sur `claude/todoist-google-drive-setup-scjm3r`

---

## Étape 8 — Notification push (si disponible)

**Succès** :
> Bilan S{week} generé ✅ — Score {score}% ({grade}) · lien Drive : {viewUrl}

**Échec** :
> Bilan S{week} ❌ — Erreur : {raison}. Retry programmé samedi 8h.
> Créer un CronCreate one-shot : samedi 8h, même prompt.

---

## Paramètres techniques

| Élément | Valeur |
|---|---|
| Script PDF | `/home/user/budgetadeux-2-0/scripts/generate_bilan_pdf.py` |
| Historique | `/home/user/budgetadeux-2-0/data/bilan-history.json` |
| Artifact web | https://claude.ai/code/artifact/c7073614-cc00-4911-adb3-a30dce61238a |
| Branch Git | `claude/todoist-google-drive-setup-scjm3r` |
| PDF taille typ. | ~3-5 KB · ~4500-6000 chars base64 |
