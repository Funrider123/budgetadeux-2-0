#!/usr/bin/env python3
"""
Carnet-style weekly bilan PDF v5.
Matches bilan-carnet.html — donut %, % projet/annexes, imprévues, évolution toujours visible.

JSON schema:
{
  "week": 27,
  "year": 2026,
  "date_range": "29 juin - 3 juillet 2026",
  "next_week": 28,
  "next_week_dates": "6 - 10 juillet 2026",
  "tasks": [
    {"label": "S27 : ...", "type": "projet"|"annexe", "state": "done"|"fail"|"unplan"}
  ],
  "history": [{"week": "S27", "projet_pct": 50, "annexe_pct": 100}],
  "analyse": "...",           // optional — auto-generated if absent
  "next_tasks": [             // optional — objectifs S{next_week}
    {"label": "...", "type": "projet"|"annexe", "state": "new"|"report"}
  ]
}
Output: raw base64 string of the PDF (no newlines).
"""

import sys, json, base64, io
from datetime import datetime
from fpdf import FPDF

C_BG     = (237, 234, 227)
C_BG2    = (245, 242, 235)
C_CARD   = (253, 251, 247)
C_BORDER = (216, 210, 197)
C_TEXT   = (44,  42,  37)
C_MUTED  = (138, 130, 119)
C_ACCENT = (42,  75, 124)
C_OK     = (61, 122,  95)
C_FAIL   = (150,  48,  48)
C_WARN   = (139, 105,  20)
C_UNPLAN = (90,  61, 122)
C_WHITE  = (255, 255, 255)
C_TRACK  = (218, 213, 202)
C_OK_T   = (218, 238, 228)   # light green tint
C_ACC_T  = (213, 226, 243)   # light blue tint
C_FAIL_T = (242, 218, 218)   # light red tint


def ascii_safe(s: str) -> str:
    table = {
        '—': ' - ', '–': '-', ''': "'", ''': "'",
        '"': '"',   '"': '"', '…': '...',
        '×': 'x',  '·': '.', '→': '->',
        'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
        'à': 'a', 'â': 'a', 'ä': 'a',
        'î': 'i', 'ï': 'i', 'ô': 'o', 'ö': 'o',
        'ù': 'u', 'û': 'u', 'ü': 'u', 'ç': 'c',
        'É': 'E', 'È': 'E', 'Ê': 'E', 'À': 'A',
        'Â': 'A', 'Ç': 'C', 'Ô': 'O', 'Ù': 'U', 'Û': 'U',
    }
    for k, v in table.items():
        s = s.replace(k, v)
    return s


def compute_score(tasks):
    projet  = [t for t in tasks if t["type"] == "projet" and t["state"] != "unplan"]
    annexes = [t for t in tasks if t["type"] == "annexe" and t["state"] != "unplan"]
    pd_ = sum(1 for t in projet  if t["state"] == "done")
    ad_ = sum(1 for t in annexes if t["state"] == "done")
    pts     = pd_ * 2 + ad_
    max_pts = len(projet) * 2 + len(annexes)
    score   = round(100 * pts / max_pts) if max_pts > 0 else 0
    grade   = 'A' if score >= 90 else 'B' if score >= 80 else 'C' if score >= 70 else 'D' if score >= 60 else 'F'
    return score, grade, pd_, len(projet), ad_, len(annexes), pts, max_pts


def wrap_lines(pdf, text, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        cand = cur + (' ' if cur else '') + w
        if pdf.get_string_width(cand) > width:
            if cur:
                lines.append(cur)
            cur = w
        else:
            cur = cand
    if cur:
        lines.append(cur)
    return lines


class CarnetPDF(FPDF):
    def header(self): pass
    def footer(self): pass


def build_pdf(data: dict) -> str:
    week       = data["week"]
    year       = data["year"]
    date_range = ascii_safe(data.get("date_range", f"Semaine {week}"))
    next_week  = data.get("next_week", week + 1)
    next_dates = ascii_safe(data.get("next_week_dates", ""))
    tasks      = data["tasks"]
    history    = data.get("history", [])
    analyse    = ascii_safe(data.get("analyse", ""))
    next_tasks = data.get("next_tasks", [])

    if not next_tasks:
        next_tasks = [
            {"label": ascii_safe(t["label"]), "type": t["type"], "state": "report"}
            for t in tasks if t["state"] == "fail"
        ]

    score, grade, proj_done, proj_total, ann_done, ann_total, pts, max_pts = compute_score(tasks)
    grade_col = C_OK if grade in ('A', 'B') else (C_FAIL if grade == 'F' else C_WARN)
    proj_pct  = round(100 * proj_done / proj_total) if proj_total > 0 else 0
    ann_pct   = round(100 * ann_done  / ann_total)  if ann_total  > 0 else 0
    n_done    = proj_done + ann_done
    n_tasks   = sum(1 for t in tasks if t["state"] != "unplan")

    if not analyse:
        if score >= 90:
            analyse = f'Semaine excellente : {pts}/{max_pts} pts. Toutes les priorites atteintes. Maintenir ce rythme en S{next_week}.'
        elif score >= 70:
            analyse = (f'Score de {score}% : {pts}/{max_pts} pts. '
                       f'{proj_total - proj_done} tache(s) projet a reprendre en S{next_week}. '
                       f'Bloc annexes : {ann_pct}%.')
        else:
            analyse = (f'Semaine difficile : {pts}/{max_pts} pts ({score}%). '
                       f'Bloc projet : {proj_pct}%. Prioriser des le debut de S{next_week}.')

    pdf = CarnetPDF(format='A4')
    pdf.set_auto_page_break(False)
    pdf.add_page()
    W, H = pdf.w, pdf.h
    M  = 12.0
    CW = W - 2 * M
    ROW_H = 5.5

    # Stone background
    pdf.set_fill_color(*C_BG)
    pdf.rect(0, 0, W, H, 'F')

    Y = 9.0

    # ── Eyebrow ──────────────────────────────────────────────────────────────
    pdf.set_font('Courier', 'B', 6.5)
    pdf.set_text_color(*C_ACCENT)
    pdf.set_xy(M, Y)
    pdf.cell(CW, 4, f'SEMAINE {week}  .  BILAN')
    Y += 5.5

    # ── Title = date range ────────────────────────────────────────────────────
    pdf.set_font('Times', 'B', 26)
    pdf.set_text_color(*C_TEXT)
    pdf.set_xy(M, Y)
    pdf.cell(CW, 12, date_range)
    Y += 13.0

    # ── Subtitle ─────────────────────────────────────────────────────────────
    now_str = ascii_safe(datetime.now().strftime('%d %B %Y'))
    pdf.set_font('Courier', '', 6.5)
    pdf.set_text_color(*C_MUTED)
    pdf.set_xy(M, Y)
    pdf.cell(CW, 4, f'Lundi -> vendredi 18h  .  Bilan genere le {now_str}')
    Y += 5.5

    # ── Header rule ───────────────────────────────────────────────────────────
    pdf.set_draw_color(*C_ACCENT)
    pdf.set_line_width(0.4)
    pdf.line(M, Y, M + CW, Y)
    Y += 6.0

    # ── Score card ────────────────────────────────────────────────────────────
    CARD_H = 40.0
    pdf.set_fill_color(*C_CARD)
    pdf.set_draw_color(*C_BORDER)
    pdf.set_line_width(0.3)
    pdf.rect(M, Y, CW, CARD_H, 'FD')

    OR  = 15.0
    IR  = OR * 0.60
    dcx = M + 6 + OR
    dcy = Y + CARD_H / 2

    # Track
    pdf.set_fill_color(*C_TRACK)
    pdf.circle(dcx, dcy, OR, 'F')
    # Score arc — clockwise=True → CW on screen from top
    if score > 0:
        pdf.set_fill_color(*grade_col)
        pdf.solid_arc(dcx, dcy, OR, -90, -90 + score * 3.6, OR, 0, True, 'F')
    # Inner hole
    pdf.set_fill_color(*C_CARD)
    pdf.circle(dcx, dcy, IR, 'F')
    # Score % in center (no grade letter)
    pdf.set_font('Courier', 'B', 10)
    pdf.set_text_color(*grade_col)
    pdf.set_xy(dcx - 8, dcy - 4)
    pdf.cell(16, 8, f'{score}%', align='C')

    # Score details
    rx = dcx + OR + 7
    rw = M + CW - rx - 3

    pdf.set_font('Courier', 'B', 14)
    pdf.set_text_color(*C_TEXT)
    pdf.set_xy(rx, Y + 4)
    pdf.cell(rw, 8, f'{score}% pondere')

    pdf.set_font('Courier', '', 6.5)
    pdf.set_text_color(*C_MUTED)
    pdf.set_xy(rx, Y + 13)
    pdf.cell(rw, 4, f'{pts} pts / {max_pts} pts possibles  .  {n_done} taches sur {n_tasks}')

    # Two % stats: Bloc projet | Taches annexes
    half = (rw - 6) / 2
    sy   = Y + 20
    for col, pct, label, tint in (
        (C_OK,     proj_pct, 'Bloc projet',    C_OK_T),
        (C_ACCENT, ann_pct,  'Taches annexes', C_ACC_T),
    ):
        ox = rx if col == C_OK else rx + half + 6
        pdf.set_fill_color(*tint)
        pdf.set_draw_color(*col)
        pdf.set_line_width(0.25)
        pdf.rect(ox, sy, half, 14, 'FD')
        pdf.set_font('Courier', 'B', 13)
        pdf.set_text_color(*col)
        pdf.set_xy(ox, sy + 1)
        pdf.cell(half, 8, f'{pct}%', align='C')
        pdf.set_font('Courier', '', 5.5)
        pdf.set_text_color(*C_MUTED)
        pdf.set_xy(ox, sy + 8.5)
        pdf.cell(half, 4, label, align='C')

    Y += CARD_H + 4.0

    # ── Task section helper ───────────────────────────────────────────────────
    def task_block(title, sub, task_list, done_c, total_c, left_col, y):
        n   = len(task_list)
        SH  = 7.0
        BAR = 3.5
        ch  = SH + BAR + 1.5 + n * ROW_H + 2.0

        pdf.set_fill_color(*C_CARD)
        pdf.set_draw_color(*C_BORDER)
        pdf.set_line_width(0.2)
        pdf.rect(M, y, CW, ch, 'FD')

        if left_col:
            pdf.set_fill_color(*left_col)
            pdf.rect(M, y, 2.5, ch, 'F')

        pdf.set_font('Times', 'B', 10)
        pdf.set_text_color(*C_TEXT if not left_col else left_col)
        pdf.set_xy(M + 5, y + 2)
        pdf.cell(CW - 50, 5, title)

        pdf.set_font('Courier', '', 6)
        pdf.set_text_color(*C_MUTED)
        pdf.set_xy(M + 5, y + 2)
        pdf.cell(CW - 7, 5, sub, align='R')

        pct = done_c / total_c if total_c > 0 else 0
        by  = y + SH
        pdf.set_fill_color(*C_BG2)
        pdf.rect(M + 5, by, CW - 10, BAR, 'F')
        if pct > 0:
            bc = C_OK if pct >= 0.8 else (C_WARN if pct >= 0.4 else C_FAIL)
            pdf.set_fill_color(*bc)
            pdf.rect(M + 5, by, (CW - 10) * pct, BAR, 'F')

        ty = y + SH + BAR + 1.5
        for t in task_list:
            st  = t["state"]
            lbl = ascii_safe(t["label"])
            cx2 = M + (9.0 if not left_col else 9.5)
            cy2 = ty + ROW_H / 2
            r   = 2.0

            if st == 'done':
                pdf.set_fill_color(*C_OK)
                pdf.rect(cx2 - r, cy2 - r, 2*r, 2*r, 'F')
                pdf.set_font('Helvetica', 'B', 5.5)
                pdf.set_text_color(*C_WHITE)
                pdf.set_xy(cx2 - r, cy2 - 3)
                pdf.cell(2*r, 6, 'v', align='C')
                pdf.set_font('Times', '', 8)
                pdf.set_text_color(*C_MUTED)
                pdf.set_xy(M + 14, ty + (ROW_H - 3.5) / 2)
                pdf.cell(CW - 17, 3.5, lbl)
                lw = min(pdf.get_string_width(lbl), CW - 18)
                pdf.set_draw_color(*C_MUTED)
                pdf.set_line_width(0.18)
                pdf.line(M + 14, ty + ROW_H/2, M + 14 + lw, ty + ROW_H/2)
            elif st == 'unplan':
                # Purple dot for unplanned
                pdf.set_fill_color(*C_UNPLAN)
                pdf.circle(cx2, cy2, r * 0.7, 'F')
                pdf.set_font('Times', '', 8)
                pdf.set_text_color(*C_TEXT)
                pdf.set_xy(M + 14, ty + (ROW_H - 3.5) / 2)
                pdf.cell(CW - 17, 3.5, lbl)
            else:
                pdf.set_draw_color(*C_FAIL)
                pdf.set_line_width(0.4)
                pdf.rect(cx2 - r, cy2 - r, 2*r, 2*r)
                BW = 26
                pdf.set_font('Times', '', 8)
                pdf.set_text_color(*C_TEXT)
                pdf.set_xy(M + 14, ty + (ROW_H - 3.5) / 2)
                pdf.cell(CW - 17 - BW - 3, 3.5, lbl)
                bx = M + CW - BW - 2
                pdf.set_fill_color(*C_FAIL_T)
                pdf.set_draw_color(*C_FAIL)
                pdf.set_line_width(0.2)
                pdf.rect(bx, ty + 1.2, BW, 3.8, 'FD')
                pdf.set_font('Courier', '', 5)
                pdf.set_text_color(*C_FAIL)
                pdf.set_xy(bx, ty + 1.5)
                pdf.cell(BW, 3.5, f'-> report S{next_week}', align='C')

            ty += ROW_H

        return y + ch

    # Bloc projet
    projet_tasks = [t for t in tasks if t["type"] == "projet" and t["state"] != "unplan"]
    Y = task_block('Bloc projet',
                   f'{proj_done}/{proj_total}  .  {proj_done*2}/{proj_total*2} pts',
                   projet_tasks, proj_done, proj_total, None, Y)
    Y += 3.0

    # Taches annexes
    annexe_tasks = [t for t in tasks if t["type"] == "annexe" and t["state"] != "unplan"]
    Y = task_block('Taches annexes',
                   f'{ann_done}/{ann_total}  .  {ann_done}/{ann_total} pts',
                   annexe_tasks, ann_done, ann_total, None, Y)
    Y += 3.0

    # Taches imprevues
    unplan_tasks = [t for t in tasks if t.get("state") == "unplan"]
    n_unplan = len(unplan_tasks)
    UH = 8.0 + (n_unplan * ROW_H if n_unplan > 0 else 5.0)

    pdf.set_fill_color(*C_CARD)
    pdf.set_draw_color(*C_BORDER)
    pdf.set_line_width(0.2)
    pdf.rect(M, Y, CW, UH, 'FD')
    pdf.set_fill_color(*C_UNPLAN)
    pdf.rect(M, Y, 2.5, UH, 'F')
    pdf.set_font('Times', 'B', 10)
    pdf.set_text_color(*C_UNPLAN)
    pdf.set_xy(M + 5, Y + 2)
    pdf.cell(CW - 50, 5, 'Taches imprevues')
    pdf.set_font('Courier', '', 6)
    pdf.set_text_color(*C_MUTED)
    pdf.set_xy(M + 5, Y + 2)
    pdf.cell(CW - 7, 5, f'{n_unplan} realisee(s)', align='R')
    if n_unplan == 0:
        pdf.set_font('Times', 'I', 8)
        pdf.set_text_color(*C_MUTED)
        pdf.set_xy(M + 5, Y + 8)
        pdf.cell(CW - 8, 4, 'Aucune tache imprevue cette semaine.')
    else:
        ty = Y + 8
        for t in unplan_tasks:
            pdf.set_fill_color(*C_UNPLAN)
            pdf.circle(M + 9.5, ty + ROW_H/2, 1.5, 'F')
            pdf.set_font('Times', '', 8)
            pdf.set_text_color(*C_TEXT)
            pdf.set_xy(M + 14, ty + (ROW_H - 3.5)/2)
            pdf.cell(CW - 17, 3.5, ascii_safe(t["label"]))
            ty += ROW_H
    Y += UH + 3.0

    # ── Analyse card ──────────────────────────────────────────────────────────
    pdf.set_font('Times', 'I', 8)
    a_lines = wrap_lines(pdf, analyse, CW - 10)
    AH = 8.0 + len(a_lines) * 4.5 + 1.0
    AH = max(AH, 14.0)

    pdf.set_fill_color(*C_CARD)
    pdf.set_draw_color(*C_BORDER)
    pdf.set_line_width(0.2)
    pdf.rect(M, Y, CW, AH, 'FD')
    pdf.set_fill_color(*C_ACCENT)
    pdf.rect(M, Y, 2.5, AH, 'F')
    pdf.set_font('Courier', 'B', 6)
    pdf.set_text_color(*C_ACCENT)
    pdf.set_xy(M + 5, Y + 2)
    pdf.cell(CW - 7, 4, f'ANALYSE  .  S{week}')
    ay = Y + 8.0
    pdf.set_font('Times', 'I', 8)
    pdf.set_text_color(*C_TEXT)
    for line in a_lines:
        pdf.set_xy(M + 5, ay)
        pdf.cell(CW - 8, 4.5, line)
        ay += 4.5
    Y += AH + 3.0

    # ── Evolution chart — always shown ────────────────────────────────────────
    if history:
        CH    = 20.0
        CTOT  = 8 + CH + 7  # card total: title + chart + labels = 35mm
        pdf.set_fill_color(*C_CARD)
        pdf.set_draw_color(*C_BORDER)
        pdf.set_line_width(0.2)
        pdf.rect(M, Y, CW, CTOT, 'FD')

        pdf.set_font('Times', 'B', 9)
        pdf.set_text_color(*C_TEXT)
        pdf.set_xy(M + 4, Y + 2.5)
        pdf.cell(70, 4, 'Evolution hebdomadaire')

        # Legend
        lx = M + CW - 52
        pdf.set_fill_color(*C_OK)
        pdf.rect(lx, Y + 4, 10, 2, 'F')
        pdf.set_font('Courier', '', 5.5)
        pdf.set_text_color(*C_MUTED)
        pdf.set_xy(lx + 12, Y + 3)
        pdf.cell(20, 4, 'Bloc projet')
        pdf.set_fill_color(*C_ACCENT)
        pdf.rect(lx + 35, Y + 4, 10, 2, 'F')
        pdf.set_xy(lx + 47, Y + 3)
        pdf.cell(18, 4, 'Annexes')

        cy0  = Y + 8
        CW_  = CW - 8
        wlbl = [h["week"] for h in history]
        pv   = [h.get("projet_pct") for h in history]
        av   = [h.get("annexe_pct") for h in history]

        def gy(v): return cy0 + CH - CH * v / 100

        for pct in (0, 50, 100):
            g = gy(pct)
            pdf.set_draw_color(*C_BORDER)
            pdf.set_line_width(0.1)
            pdf.set_dash_pattern(dash=1, gap=2)
            pdf.line(M + 4, g, M + 4 + CW_, g)
            pdf.set_font('Courier', '', 4.5)
            pdf.set_text_color(*C_MUTED)
            pdf.set_xy(M - 10, g - 1.5)
            pdf.cell(8, 3, f'{pct}%', align='R')
        pdf.set_dash_pattern()

        n   = len(wlbl)
        seg = CW_ / (n + 1)
        xs  = [M + 4 + (i + 1) * seg for i in range(n)]
        cur = f'S{week}'

        for col, vals in ((C_OK, pv), (C_ACCENT, av)):
            pdf.set_draw_color(*col)
            pdf.set_line_width(0.5)
            px2 = py2 = None
            for x, v in zip(xs, vals):
                if v is not None:
                    g = gy(v)
                    if px2 is not None:
                        pdf.line(px2, py2, x, g)
                    px2, py2 = x, g
            for x, v in zip(xs, vals):
                if v is not None:
                    pdf.set_fill_color(*col)
                    pdf.circle(x, gy(v), 1.8, 'F')

        for i, w in enumerate(wlbl):
            pdf.set_font('Courier', 'B' if w == cur else '', 5.5)
            pdf.set_text_color(*(C_TEXT if w == cur else C_MUTED))
            pdf.set_xy(xs[i] - 7, cy0 + CH + 2)
            pdf.cell(14, 3, w, align='C')

        Y += CTOT + 3.0

    # ── Objectifs S{next_week} — afficher ce qui rentre ───────────────────────
    if next_tasks and Y < H - 20:
        next_proj = [t for t in next_tasks if t["type"] == "projet"]
        next_ann  = [t for t in next_tasks if t["type"] == "annexe"]

        # Blue header
        OHH = 11.0
        pdf.set_fill_color(*C_ACCENT)
        pdf.rect(M, Y, CW, OHH, 'F')
        pdf.set_font('Times', 'B', 11)
        pdf.set_text_color(*C_WHITE)
        pdf.set_xy(M + 5, Y + 2)
        pdf.cell(CW - 10, 5.5, f'Objectifs S{next_week}')
        sub = next_dates if next_dates else f'Semaine {next_week}'
        pdf.set_font('Courier', '', 5.5)
        pdf.set_text_color(175, 195, 225)
        pdf.set_xy(M + 5, Y + 7.5)
        pdf.cell(CW - 10, 3.5,
                 f'{sub}  .  {len(next_proj)} projet  .  {len(next_ann)} annexes')
        Y += OHH

        NR = ROW_H

        def obj_block(title, task_list, y):
            available = H - 10 - y
            max_rows  = max(0, int((available - 7) / NR))
            visible   = task_list[:max_rows]
            hidden    = len(task_list) - len(visible)
            if not visible:
                return y
            ch = 6.5 + len(visible) * NR + (4 if hidden > 0 else 0) + 1

            pdf.set_fill_color(*C_CARD)
            pdf.set_draw_color(*C_BORDER)
            pdf.set_line_width(0.2)
            pdf.rect(M, y, CW, ch, 'FD')

            pdf.set_font('Times', 'B', 8.5)
            pdf.set_text_color(*C_TEXT)
            pdf.set_xy(M + 4, y + 1.5)
            pdf.cell(CW - 40, 4, title)
            pdf.set_font('Courier', '', 5.5)
            pdf.set_text_color(*C_MUTED)
            pdf.set_xy(M + 4, y + 1.5)
            pdf.cell(CW - 6, 4, f'{len(task_list)} taches', align='R')

            ty = y + 6.5
            for i, t in enumerate(visible):
                st  = t.get("state", "new")
                lbl = ascii_safe(t["label"])
                clr = C_FAIL if st == 'report' else C_OK

                pdf.set_fill_color(*clr)
                pdf.circle(M + 7, ty + NR/2, 1.5, 'F')

                BW2 = 20
                pdf.set_font('Times', '', 7.5)
                pdf.set_text_color(*C_TEXT)
                pdf.set_xy(M + 11.5, ty + (NR - 3.5)/2)
                pdf.cell(CW - 15 - BW2 - 2, 3.5, lbl)

                badge_txt  = f'report S{week}' if st == 'report' else 'nouveau'
                bfill = C_FAIL_T if st == 'report' else C_OK_T
                bcol  = C_FAIL  if st == 'report' else C_OK
                bx = M + CW - BW2 - 2
                pdf.set_fill_color(*bfill)
                pdf.set_draw_color(*bcol)
                pdf.set_line_width(0.2)
                pdf.rect(bx, ty + 1.5, BW2, 3.3, 'FD')
                pdf.set_font('Courier', '', 4.5)
                pdf.set_text_color(*bcol)
                pdf.set_xy(bx, ty + 1.7)
                pdf.cell(BW2, 3, badge_txt, align='C')

                if i < len(visible) - 1:
                    pdf.set_draw_color(*C_BG)
                    pdf.set_line_width(0.12)
                    pdf.line(M + 10, ty + NR, M + CW - 2, ty + NR)

                ty += NR

            if hidden > 0:
                pdf.set_font('Courier', 'I', 5.5)
                pdf.set_text_color(*C_MUTED)
                pdf.set_xy(M + 5, ty + 0.5)
                pdf.cell(CW - 8, 3, f'+ {hidden} autre(s) tache(s)...')

            return y + ch

        if next_proj:
            Y = obj_block('Bloc projet', next_proj, Y)
        if next_ann and Y < H - 14:
            Y = obj_block('Taches annexes', next_ann, Y)

    # ── Footer ────────────────────────────────────────────────────────────────
    FH = 8
    pdf.set_fill_color(*C_ACCENT)
    pdf.rect(0, H - FH, W, FH, 'F')
    pdf.set_font('Courier', '', 5.5)
    pdf.set_text_color(175, 195, 225)
    pdf.set_xy(M, H - FH + 2)
    pdf.cell(CW / 2, 4, f'bilan S{week}  .  genere automatiquement le vendredi a 18h')
    pdf.set_xy(M + CW / 2, H - FH + 2)
    pdf.cell(CW / 2, 4, f'Budget a Deux  .  {year}', align='R')

    buf = io.BytesIO()
    pdf.output(buf)
    return base64.b64encode(buf.getvalue()).decode()


if __name__ == '__main__':
    if len(sys.argv) > 1:
        raw = sys.argv[1]
    else:
        raw = sys.stdin.read()
    data = json.loads(raw)
    print(build_pdf(data), end='')
