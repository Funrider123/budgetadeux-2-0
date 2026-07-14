#!/usr/bin/env python3
"""
Génère le HTML carnet du bilan hebdomadaire à partir du JSON bilan.
Usage : python3 generate_bilan_html.py '{json_data}' > bilan-SXX-YYYY.html
        python3 generate_bilan_html.py  (lit stdin)
Sortie : HTML complet prêt à être rendu dans Chromium.
"""

import sys, json, math
from datetime import datetime


# ── Helpers SVG / math ────────────────────────────────────────────────────────

def donut_path(score: int, cx=44, cy=44, r=34) -> str:
    """Arc SVG pour le donut (score en %)."""
    pct = max(0, min(100, score)) / 100
    circ = 2 * math.pi * r
    dash = pct * circ
    gap  = circ - dash
    return f'{dash:.2f} {gap:.2f}'


def block_bar(pct: int, filled_char='█', empty_char='░', width=10) -> tuple[str, str]:
    """Retourne (filled_part, empty_part) pour la barre de blocs."""
    n = round(pct / 100 * width)
    return filled_char * n, empty_char * (width - n)


def week_label(year: int, week: int) -> str:
    return f'S{week}'


def history_svg(history: list, current_week: str) -> str:
    """Génère le SVG de la courbe d'évolution."""
    if not history:
        return ''

    n = len(history)
    # Coordonnées X équidistantes
    xs = [20 + i * (360 // max(n - 1, 1)) for i in range(n)]
    if n == 1:
        xs = [20]

    def gy(v):
        return 85 - (v / 100) * 65  # y=85 → 0%, y=20 → 100%

    pv = [h.get('projet_pct') for h in history]
    av = [h.get('annexe_pct') for h in history]

    # Courbe bezier simple : control points interpolés
    def curve_d(vals, xs):
        pts = [(x, gy(v)) for x, v in zip(xs, vals) if v is not None]
        if len(pts) < 2:
            return ''
        d = f'M {pts[0][0]},{pts[0][1]:.1f}'
        for i in range(1, len(pts)):
            # Point de contrôle centré
            cpx = (pts[i-1][0] + pts[i][0]) / 2
            d += f' C {cpx:.0f},{pts[i-1][1]:.1f} {cpx:.0f},{pts[i][1]:.1f} {pts[i][0]},{pts[i][1]:.1f}'
        return d

    proj_d = curve_d(pv, xs)
    ann_d  = curve_d(av, xs)

    # Area fills
    def area_d(vals, xs):
        pts = [(x, gy(v)) for x, v in zip(xs, vals) if v is not None]
        if len(pts) < 2:
            return ''
        d = f'M {pts[0][0]},{pts[0][1]:.1f}'
        for i in range(1, len(pts)):
            cpx = (pts[i-1][0] + pts[i][0]) / 2
            d += f' C {cpx:.0f},{pts[i-1][1]:.1f} {cpx:.0f},{pts[i][1]:.1f} {pts[i][0]},{pts[i][1]:.1f}'
        last = pts[-1]
        first = pts[0]
        d += f' L {last[0]},85 L {first[0]},85 Z'
        return d

    proj_area = area_d(pv, xs)
    ann_area  = area_d(av, xs)

    # Markers
    proj_circles = ''.join(
        f'<circle cx="{x}" cy="{gy(v):.1f}" r="4" fill="#fff" stroke="#0072B2" stroke-width="2"/>'
        for x, v in zip(xs, pv) if v is not None
    )
    ann_squares = ''.join(
        f'<rect x="{x-3.5:.1f}" y="{gy(v)-3.5:.1f}" width="7" height="7" fill="#E69F00" rx="1"/>'
        for x, v in zip(xs, av) if v is not None
    )

    # Labels semaines
    week_labels = ''
    for x, h in zip(xs, history):
        w = h['week']
        is_cur = (w == current_week)
        weight = 'font-weight="800" fill="#1E1C17"' if is_cur else 'fill="#A89F93"'
        week_labels += f'<text x="{x}" y="99" font-size="9" text-anchor="middle" font-family="sans-serif" {weight}>{w}</text>'

    # Valeurs S actuelle
    cur_idx = next((i for i, h in enumerate(history) if h['week'] == current_week), -1)
    cur_labels = ''
    if cur_idx >= 0:
        cx2 = xs[cur_idx]
        if av[cur_idx] is not None:
            cur_labels += f'<text x="{cx2}" y="{gy(av[cur_idx])-6:.1f}" font-size="8" fill="#E69F00" text-anchor="middle" font-weight="800" font-family="sans-serif">{av[cur_idx]:.0f}%</text>'
        if pv[cur_idx] is not None:
            cur_labels += f'<text x="{cx2}" y="{gy(pv[cur_idx])+14:.1f}" font-size="8" fill="#0072B2" text-anchor="middle" font-weight="800" font-family="sans-serif">{pv[cur_idx]:.0f}%</text>'

    return f'''
    <svg viewBox="0 0 400 105" style="width:100%;height:auto;display:block;overflow:visible">
      <line x1="20" y1="20" x2="380" y2="20" stroke="#E0DAD0" stroke-width="1" stroke-dasharray="3,3"/>
      <line x1="20" y1="52" x2="380" y2="52" stroke="#E0DAD0" stroke-width="1" stroke-dasharray="3,3"/>
      <line x1="20" y1="85" x2="380" y2="85" stroke="#E0DAD0" stroke-width="1"/>
      <text x="14" y="23" font-size="7" fill="#A89F93" text-anchor="end" font-family="sans-serif">100%</text>
      <text x="14" y="55" font-size="7" fill="#A89F93" text-anchor="end" font-family="sans-serif">50%</text>
      {'<path d="' + ann_area + '" fill="#E69F00" opacity="0.09"/>' if ann_area else ''}
      {'<path d="' + proj_area + '" fill="#0072B2" opacity="0.09"/>' if proj_area else ''}
      {'<path d="' + ann_d + '" fill="none" stroke="#E69F00" stroke-width="2.5" stroke-linecap="round"/>' if ann_d else ''}
      {'<path d="' + proj_d + '" fill="none" stroke="#0072B2" stroke-width="2.5" stroke-dasharray="6,3" stroke-linecap="round"/>' if proj_d else ''}
      {ann_squares}
      {proj_circles}
      {cur_labels}
      {week_labels}
    </svg>'''


def render_task_item(task: dict, next_week: int) -> str:
    state = task.get('state', 'fail')
    label = task.get('label', '')

    if state == 'done':
        return f'''
    <div class="task-item">
      <div class="task-cb done"></div>
      <div class="task-label done">{label}</div>
    </div>'''
    elif state == 'unplan':
        return f'''
    <div class="task-item">
      <div class="task-cb" style="border-color:var(--purple)"></div>
      <div class="task-label">{label}</div>
      <div class="task-tag" style="color:var(--purple);background:var(--purple-bg);border:1px solid rgba(107,95,130,.2)">Imprévu</div>
    </div>'''
    else:  # fail
        return f'''
    <div class="task-item">
      <div class="task-cb"></div>
      <div class="task-label">{label}</div>
      <div class="task-tag tag-report">→ report S{next_week}</div>
    </div>'''


def render_next_task(task: dict) -> str:
    state = task.get('state', 'new')
    label = task.get('label', '')

    if state == 'done':
        return f'''
    <div class="task-item">
      <div class="task-cb done"></div>
      <div class="task-label done">{label}</div>
      <div class="task-tag tag-done">✓ fait</div>
    </div>'''
    elif state == 'report':
        return f'''
    <div class="task-item">
      <div class="task-cb"></div>
      <div class="task-label">{label}</div>
      <div class="task-tag tag-report">→ report</div>
    </div>'''
    else:  # new
        return f'''
    <div class="task-item">
      <div class="task-cb"></div>
      <div class="task-label">{label}</div>
      <div class="task-tag tag-new">Nouveau</div>
    </div>'''


# ── Générateur HTML principal ─────────────────────────────────────────────────

def generate_html(data: dict) -> str:
    week       = data['week']
    year       = data['year']
    date_range = data.get('date_range', f'Semaine {week}')
    next_week  = data.get('next_week', week + 1)
    next_dates = data.get('next_week_dates', f'Semaine {next_week}')
    tasks      = data['tasks']
    history    = data.get('history', [])
    analyse    = data.get('analyse', '')
    next_tasks = data.get('next_tasks', [])
    generated  = datetime.now().strftime('%-d %B %Y')

    # Calcul des scores
    proj_tasks = [t for t in tasks if t['type'] == 'projet' and t['state'] != 'unplan']
    ann_tasks  = [t for t in tasks if t['type'] == 'annexe' and t['state'] != 'unplan']
    unpl_tasks = [t for t in tasks if t.get('state') == 'unplan']

    proj_done = sum(1 for t in proj_tasks if t['state'] == 'done')
    ann_done  = sum(1 for t in ann_tasks  if t['state'] == 'done')
    pts       = proj_done * 2 + ann_done
    max_pts   = len(proj_tasks) * 2 + len(ann_tasks)
    score     = round(100 * pts / max_pts) if max_pts > 0 else 0
    grade     = 'A' if score >= 90 else 'B' if score >= 80 else 'C' if score >= 70 else 'D' if score >= 60 else 'F'
    proj_pct  = round(100 * proj_done / len(proj_tasks)) if proj_tasks else 0
    ann_pct   = round(100 * ann_done  / len(ann_tasks))  if ann_tasks  else 0
    n_done    = proj_done + ann_done
    n_tasks   = len(proj_tasks) + len(ann_tasks)

    # Donut
    donut_dash = donut_path(score)

    # Barres de blocs
    pf, pe = block_bar(proj_pct)
    af, ae = block_bar(ann_pct)
    proj_bar_class = 'ok' if proj_pct >= 80 else ''
    ann_bar_class  = 'ok' if ann_pct  >= 80 else ''

    # Analyse auto si absente
    if not analyse:
        if score >= 90:
            analyse = (f'Semaine excellente : {pts}/{max_pts} pts. '
                       f'Toutes les priorités atteintes. Maintenir ce rythme en S{next_week}.')
        elif score >= 70:
            analyse = (f'Bilan pondéré de {score}% — {pts}/{max_pts} pts. '
                       f'Bloc projet à {proj_pct}%, tâches annexes à {ann_pct}%. '
                       f'{"Quelques tâches projet à reprendre en S" + str(next_week) + "." if proj_pct < 100 else ""}')
        else:
            analyse = (f'Semaine difficile : {score}% ({pts}/{max_pts} pts). '
                       f'Bloc projet : {proj_pct}%. Prioriser dès le début de S{next_week}.')

    # SVG évolution
    cur_week_label = f'S{week}'
    evol_svg = history_svg(history, cur_week_label)

    # Tâches semaine
    proj_items = ''.join(render_task_item(t, next_week) for t in proj_tasks)
    ann_items  = ''.join(render_task_item(t, next_week) for t in ann_tasks)
    unpl_items = ''.join(render_task_item(t, next_week) for t in unpl_tasks)
    unpl_tally = f'{len(unpl_tasks)} réalisée(s)' if unpl_tasks else '0 réalisée(s)'
    unpl_empty = '' if unpl_tasks else '<div class="imprev-empty">Aucune tâche imprévue cette semaine.</div>'

    # Objectifs semaine suivante
    next_proj_tasks = [t for t in next_tasks if t.get('type') == 'projet']
    next_ann_tasks  = [t for t in next_tasks if t.get('type') == 'annexe']
    next_proj_items = ''.join(render_next_task(t) for t in next_proj_tasks)
    next_ann_items  = ''.join(render_next_task(t) for t in next_ann_tasks)
    n_next_proj = len(next_proj_tasks)
    n_next_ann  = len(next_ann_tasks)
    n_next_done = sum(1 for t in next_tasks if t.get('state') == 'done')

    # Section objectifs (visible seulement si on a des next_tasks)
    obj_section = ''
    if next_tasks:
        obj_section = f'''
  <!-- Objectifs S{next_week} -->
  <div class="obj-header">
    <div class="obj-header-top">
      <div>
        <div class="obj-header-title">Objectifs S{next_week}</div>
        <div class="obj-header-sub">{next_dates} &nbsp;·&nbsp; {n_next_proj} projet · {n_next_ann} annexes</div>
      </div>
      {"<div class='obj-header-ct'>" + str(n_next_done) + " déjà faite" + ("s" if n_next_done > 1 else "") + "</div>" if n_next_done > 0 else ""}
    </div>
  </div>
  <div class="obj-body">
    {"<div class='obj-sec'><div class='obj-sec-title'>Bloc projet</div><div class='obj-sec-ct'>" + str(n_next_proj) + " tâches</div></div>" + next_proj_items if next_proj_tasks else ""}
    {"<div class='obj-sec'><div class='obj-sec-title'>Tâches annexes</div><div class='obj-sec-ct'>" + str(n_next_ann) + " tâches</div></div>" + next_ann_items if next_ann_tasks else ""}
  </div>'''

    return f'''<meta charset="UTF-8">
<title>S{week} — Bilan · Carnet</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Nunito+Sans:wght@400;600;700;800&display=swap');

:root {{
  --bg: #EDEAE3; --card: #FFFFFF; --line: #E0DAD0;
  --ink: #1E1C17; --muted: #7A7265; --muted-2: #A89F93;
  --green: #2D6A4F; --green-l: #3E8A67; --green-bg: #EAF3EE;
  --olive: #5C4E2E; --olive-l: #7A6840; --olive-bg: #F2EDE3;
  --blush: #FAE8E2; --warn: #C4502A;
  --purple: #6B5F82; --purple-bg: #F2EFF6;
  --teal: #1F5F5B; --teal-l: #2A7A74;
  --serif: 'Fraunces', Georgia, serif;
  --sans: 'Nunito Sans', -apple-system, system-ui, sans-serif;
}}
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ font-family: var(--sans); background: var(--bg); min-height: 100vh;
        padding: 36px 16px 72px; color: var(--ink); -webkit-font-smoothing: antialiased; }}
.doc {{ max-width: 680px; margin: 0 auto; display: flex; flex-direction: column; }}
.doc-header {{ margin-bottom: 28px; }}
.eyebrow {{ font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
            color: var(--green); margin-bottom: 10px; }}
.doc-title {{ font-family: var(--serif); font-size: clamp(28px,6vw,40px); font-weight: 700;
              color: var(--ink); line-height: 1.05; letter-spacing: -.02em; margin-bottom: 8px; }}
.doc-sub {{ font-size: 13px; font-weight: 600; color: var(--muted); }}
.divider {{ border: none; border-top: 1px solid var(--line); margin: 20px 0 24px; }}
.score-card {{ background: var(--card); border-radius: 14px; border: 1px solid var(--line);
               padding: 20px 22px; display: flex; align-items: center; gap: 22px; margin-bottom: 12px; }}
.donut-wrap {{ flex-shrink: 0; }}
.score-info {{ flex: 1; min-width: 0; }}
.score-title {{ font-family: var(--serif); font-size: 22px; font-weight: 700;
                color: var(--ink); letter-spacing: -.01em; margin-bottom: 3px; }}
.score-detail {{ font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 14px; }}
.score-rows {{ display: flex; flex-direction: column; }}
.score-row {{ display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); }}
.score-row:first-child {{ border-top: none; padding-top: 0; }}
.sr-label {{ font-size: 12px; font-weight: 700; color: var(--ink); width: 96px; flex-shrink: 0; }}
.sr-pct {{ font-size: 12px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; width: 36px; flex-shrink: 0; }}
.sr-bar {{ font-family:'Courier New',monospace; font-size:11px; letter-spacing:1px; line-height:1;
           border:1.5px solid var(--ink); border-radius:5px; padding:3px 6px; background:var(--bg); flex:0 0 auto; }}
.sr-bar .f {{ color: var(--olive); }}
.sr-bar.ok .f {{ color: var(--green); }}
.sr-detail {{ font-size: 11px; font-weight: 600; color: var(--muted); white-space: nowrap; }}
.section {{ background: var(--card); border-radius: 14px; border: 1px solid var(--line);
            overflow: hidden; margin-bottom: 12px; }}
.section-head {{ display: flex; align-items: baseline; justify-content: space-between;
                 padding: 16px 20px 14px; border-bottom: 1px solid var(--line); }}
.section-title {{ font-family: var(--serif); font-size: 17px; font-weight: 600; color: var(--ink); }}
.section-tally {{ font-size: 12px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }}
.task-list {{ padding: 4px 0 8px; }}
.task-item {{ display: flex; align-items: flex-start; gap: 10px; padding: 9px 20px; border-top: 1px solid var(--line); }}
.task-item:first-child {{ border-top: none; }}
.task-cb {{ width:16px; height:16px; border-radius:4px; border:1.5px solid var(--line);
            flex-shrink:0; margin-top:2px; display:grid; place-items:center; }}
.task-cb.done {{ background: var(--green); border-color: var(--green); }}
.task-cb.done::after {{ content:''; width:8px; height:5px; border-left:1.5px solid #fff;
                        border-bottom:1.5px solid #fff; transform:rotate(-45deg) translate(1px,-1px); }}
.task-label {{ flex:1; font-size:13.5px; font-weight:600; color:var(--ink); line-height:1.4; }}
.task-label.done {{ color:var(--muted-2); text-decoration:line-through; text-decoration-color:var(--muted-2); }}
.task-tag {{ font-size:10px; font-weight:800; padding:3px 8px; border-radius:6px;
             flex-shrink:0; margin-top:2px; white-space:nowrap; }}
.tag-report {{ color:var(--warn); background:var(--blush); border:1px solid rgba(196,80,42,.15); }}
.tag-new {{ color:var(--green); background:var(--green-bg); border:1px solid rgba(45,106,79,.2); }}
.tag-done {{ color:var(--green); background:var(--green-bg); border:1px solid rgba(45,106,79,.2); }}
.imprev-section {{ background:var(--card); border-radius:14px; border:1px solid rgba(107,95,130,.25);
                   border-left:3px solid var(--purple); overflow:hidden; margin-bottom:12px; }}
.imprev-head {{ display:flex; align-items:baseline; justify-content:space-between; padding:14px 20px 12px; }}
.imprev-title {{ font-family:var(--serif); font-size:17px; font-weight:600; color:var(--purple); }}
.imprev-tally {{ font-size:12px; font-weight:700; color:var(--muted); }}
.imprev-empty {{ padding:12px 20px 16px; font-size:13px; font-style:italic; color:var(--muted);
                 border-top:1px solid rgba(107,95,130,.12); }}
.evol-section {{ background:var(--card); border-radius:14px; border:1px solid var(--line);
                 padding:18px 22px 16px; margin-bottom:12px; }}
.evol-title {{ font-family:var(--serif); font-size:17px; font-weight:600; color:var(--ink); margin-bottom:14px; }}
.evol-legend {{ display:flex; gap:16px; padding-top:10px; border-top:1px solid var(--line); }}
.el {{ display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; color:var(--muted); }}
.obj-header {{ background:linear-gradient(135deg,var(--teal-l),var(--teal)); border-radius:14px 14px 0 0;
               padding:16px 20px; color:#fff; }}
.obj-header-top {{ display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:4px; }}
.obj-header-title {{ font-family:var(--serif); font-size:19px; font-weight:700; }}
.obj-header-sub {{ font-size:11px; opacity:.65; font-weight:600; margin-top:2px; }}
.obj-header-ct {{ font-size:10px; font-weight:800; opacity:.65; text-align:right; }}
.obj-body {{ background:var(--card); border-radius:0 0 14px 14px; border:1px solid var(--line);
             border-top:none; margin-bottom:12px; overflow:hidden; }}
.obj-sec {{ display:flex; align-items:center; justify-content:space-between; padding:8px 20px;
            background:var(--bg); border-top:1px solid var(--line); border-bottom:1px solid var(--line); }}
.obj-sec-title {{ font-size:9px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--ink); }}
.obj-sec-ct {{ font-size:10px; font-weight:700; color:var(--muted); }}
.analyse-section {{ background:var(--card); border-radius:14px; border:1px solid var(--line);
                   padding:18px 22px; margin-bottom:12px; }}
.analyse-eyebrow {{ font-size:9px; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
                    color:var(--muted); margin-bottom:10px; }}
.analyse-text {{ font-family:var(--serif); font-size:14.5px; line-height:1.65; color:var(--ink); }}
</style>

<div class="doc">
  <div class="doc-header">
    <div class="eyebrow">Semaine {week} &nbsp;·&nbsp; Bilan</div>
    <h1 class="doc-title">{date_range}</h1>
    <div class="doc-sub">Lundi → vendredi &nbsp;·&nbsp; Bilan généré le {generated}</div>
  </div>
  <hr class="divider">

  <!-- Score card -->
  <div class="score-card">
    <div class="donut-wrap">
      <svg viewBox="0 0 88 88" width="88" height="88">
        <circle cx="44" cy="44" r="34" fill="none" stroke="#DDE8E2" stroke-width="10"/>
        <circle cx="44" cy="44" r="34" fill="none" stroke="var(--green)" stroke-width="10"
          stroke-dasharray="{donut_dash}" transform="rotate(-90 44 44)" stroke-linecap="round"/>
        <text x="44" y="49" text-anchor="middle" font-family="Georgia,serif"
          font-size="20" font-weight="700" fill="var(--green)">{score}%</text>
      </svg>
    </div>
    <div class="score-info">
      <div class="score-title">{score}% pondéré</div>
      <div class="score-detail">{pts} pts réalisés / {max_pts} pts possibles &nbsp;·&nbsp; {n_done} tâches sur {n_tasks}</div>
      <div class="score-rows">
        <div class="score-row">
          <div class="sr-label">Bloc projet</div>
          <div class="sr-pct">{proj_pct}%</div>
          <div class="sr-bar {proj_bar_class}"><span class="f">{pf}</span>{pe}</div>
          <div class="sr-detail">{proj_done * 2} / {len(proj_tasks) * 2} pts</div>
        </div>
        <div class="score-row">
          <div class="sr-label">Tâches annexes</div>
          <div class="sr-pct">{ann_pct}%</div>
          <div class="sr-bar {ann_bar_class}"><span class="f">{af}</span>{ae}</div>
          <div class="sr-detail">{ann_done} / {len(ann_tasks)} pts</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Bloc projet -->
  <div class="section">
    <div class="section-head">
      <div class="section-title">Bloc projet</div>
      <div class="section-tally">{proj_done} / {len(proj_tasks)} &nbsp;·&nbsp; {proj_done*2} / {len(proj_tasks)*2} pts</div>
    </div>
    <div class="task-list">{proj_items}</div>
  </div>

  <!-- Tâches annexes -->
  <div class="section">
    <div class="section-head">
      <div class="section-title">Tâches annexes</div>
      <div class="section-tally">{ann_done} / {len(ann_tasks)} &nbsp;·&nbsp; {ann_done} / {len(ann_tasks)} pts</div>
    </div>
    <div class="task-list">{ann_items}</div>
  </div>

  <!-- Imprévues -->
  <div class="imprev-section">
    <div class="imprev-head">
      <div class="imprev-title">Tâches imprévues</div>
      <div class="imprev-tally">{unpl_tally}</div>
    </div>
    {unpl_items}{unpl_empty}
  </div>

  <!-- Évolution -->
  {'<div class="evol-section"><div class="evol-title">Évolution hebdomadaire</div>' + evol_svg + '''
    <div class="evol-legend">
      <div class="el">
        <svg width="18" height="8" style="flex-shrink:0"><line x1="0" y1="4" x2="18" y2="4" stroke="#0072B2" stroke-width="2" stroke-dasharray="5,2"/><circle cx="9" cy="4" r="3" fill="#fff" stroke="#0072B2" stroke-width="1.5"/></svg>
        Bloc projet
      </div>
      <div class="el">
        <svg width="18" height="8" style="flex-shrink:0"><line x1="0" y1="4" x2="18" y2="4" stroke="#E69F00" stroke-width="2"/><rect x="5.5" y="0.5" width="7" height="7" fill="#E69F00" rx="1"/></svg>
        Tâches annexes
      </div>
    </div>
  </div>''' if history else ''}

  {obj_section}

  <!-- Analyse -->
  <div class="analyse-section">
    <div class="analyse-eyebrow">Analyse S{week}</div>
    <div class="analyse-text">{analyse}</div>
  </div>
</div>
'''


if __name__ == '__main__':
    if len(sys.argv) > 1:
        raw = sys.argv[1]
    else:
        raw = sys.stdin.read()
    data = json.loads(raw)
    print(generate_html(data))
