#!/usr/bin/env python3
"""
Carnet-style weekly bilan PDF — matches bilan-carnet.html.

JSON schema:
{
  "week": 27,
  "year": 2026,
  "date_range": "29 juin - 3 juillet 2026",
  "next_week": 28,
  "next_week_dates": "6 - 10 juillet 2026",     // optional
  "tasks": [
    {"label": "S27 : ...", "type": "projet"|"annexe", "state": "done"|"fail"}
  ],
  "history": [{"week": "S24", "projet_pct": 75, "annexe_pct": 80}],
  "analyse": "Texte libre...",                    // optional — auto-generated if absent
  "next_tasks": [                                 // optional — objectifs S{next_week}
    {"label": "...", "type": "projet"|"annexe", "state": "new"|"report"}
  ]
}
Output: raw base64 string of the PDF (no newlines).
"""

import sys, json, base64, io
from datetime import datetime
from fpdf import FPDF

# ── Palette ──────────────────────────────────────────────────────────────────
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
C_WHITE  = (255, 255, 255)
C_TRACK  = (218, 213, 202)

# Light tints for pill badges (simulate rgba without alpha)
C_OK_TINT   = (218, 238, 228)
C_ACCT_TINT = (213, 226, 243)
C_FAIL_TINT = (242, 218, 218)


def ascii_safe(s: str) -> str:
    table = {
        '—': ' - ', '–': '-', '’': "'", '‘': "'",
        '“': '"',   '”': '"', '…': '...',
        '×': 'x',   '·': '.', '→': '->',
        'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
        'à': 'a', 'â': 'a', 'ä': 'a',
        'î': 'i', 'ï': 'i', 'ô': 'o', 'ö': 'o',
        'ù': 'u', 'û': 'u', 'ü': 'u', 'ç': 'c',
        'É': 'E', 'È': 'E', 'Ê': 'E', 'À': 'A',
        'Â': 'A', 'Ç': 'C', 'Ô': 'O', 'Ù': 'U',
        'Û': 'U',
    }
    for k, v in table.items():
        s = s.replace(k, v)
    return s


def compute_score(tasks):
    projet  = [t for t in tasks if t["type"] == "projet"]
    annexes = [t for t in tasks if t["type"] == "annexe"]
    pd_ = sum(1 for t in projet  if t["state"] == "done")
    ad_ = sum(1 for t in annexes if t["state"] == "done")
    pts     = pd_ * 2 + ad_
    max_pts = len(projet) * 2 + len(annexes)
    score = round(100 * pts / max_pts) if max_pts > 0 else 0
    grade = 'A' if score >= 90 else 'B' if score >= 80 else 'C' if score >= 70 else 'D' if score >= 60 else 'F'
    return score, grade, pd_, len(projet), ad_, len(annexes), pts, max_pts


def wrap_text(pdf, text, width):
    """Return list of line strings that fit within width using current font."""
    words  = text.split()
    lines  = []
    cur    = ''
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

    # Auto-fill next_tasks from current fail tasks if not provided
    if not next_tasks:
        next_tasks = [
            {"label": ascii_safe(t["label"]), "type": t["type"], "state": "report"}
            for t in tasks if t["state"] == "fail"
        ]

    score, grade, proj_done, proj_total, ann_done, ann_total, pts, max_pts = compute_score(tasks)
    grade_col  = C_OK if grade in ('A', 'B') else (C_FAIL if grade == 'F' else C_WARN)
    n_tasks    = len(tasks)
    n_done     = proj_done + ann_done

    # Auto-generate analyse text
    if not analyse:
        if score >= 90:
            analyse = f'Semaine excellente : {pts}/{max_pts} pts ({score}%). Toutes les priorites atteintes. Maintenir ce rythme en S{next_week}.'
        elif score >= 70:
            missed = max_pts - pts
            analyse = (f'Score de {score}% (Grade {grade}) - {pts}/{max_pts} pts. '
                       f'{missed} pt(s) manquant(s). '
                       f'{proj_total - proj_done} tache(s) projet a reprendre en S{next_week}.')
        else:
            analyse = (f'Semaine difficile : {pts}/{max_pts} pts ({score}%, Grade {grade}). '
                       f'Bloc projet : {proj_done}/{proj_total}. '
                       f'Prioriser les taches projet des le debut de S{next_week}.')

    pdf = CarnetPDF(format='A4')
    pdf.set_auto_page_break(False)
    pdf.add_page()
    W, H = pdf.w, pdf.h
    M  = 12.0
    CW = W - 2 * M

    # Adapt row height for dense weeks
    n_current = len(tasks)
    n_next    = len(next_tasks)
    ROW_H = 6.2 if (n_current + n_next) <= 14 else 5.5

    # ── Stone background ─────────────────────────────────────────────────────
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
    Y += 13.5

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
    pdf.set_line_width(0.2)
    Y += 6.0

    # ── Score card ────────────────────────────────────────────────────────────
    CARD_H = 40.0
    pdf.set_fill_color(*C_CARD)
    pdf.set_draw_color(*C_BORDER)
    pdf.set_line_width(0.3)
    pdf.rect(M, Y, CW, CARD_H, 'FD')

    # Donut (left side of card)
    OR  = 15.0
    IR  = OR * 0.60
    dcx = M + 6 + OR          # center x: card left + padding + radius
    dcy = Y + CARD_H / 2      # center y: mid-card

    pdf.set_fill_color(*C_TRACK)
    pdf.circle(dcx, dcy, OR, 'F')

    if score > 0:
        pdf.set_fill_color(*grade_col)
        # clockwise=False → CCW in math = CW on screen (Y-down PDF)
        pdf.solid_arc(dcx, dcy, OR, -90, -90 + score * 3.6, OR, 0, False, 'F')

    pdf.set_fill_color(*C_CARD)
    pdf.circle(dcx, dcy, IR, 'F')

    # Grade letter in donut center
    pdf.set_font('Times', 'B', 16)
    pdf.set_text_color(*grade_col)
    pdf.set_xy(dcx - 6, dcy - 6)
    pdf.cell(12, 7, grade, align='C')

    # Percentage below grade letter
    pdf.set_font('Courier', '', 5.5)
    pdf.set_text_color(*C_MUTED)
    pdf.set_xy(dcx - 7, dcy + 2)
    pdf.cell(14, 3, f'{score}%', align='C')

    # ── Score details (right of donut) ────────────────────────────────────────
    rx = dcx + OR + 7   # text area start x
    rw = M + CW - rx - 3

    # "78% pondéré"
    pdf.set_font('Courier', 'B', 14)
    pdf.set_text_color(*C_TEXT)
    pdf.set_xy(rx, Y + 5)
    pdf.cell(rw, 8, f'{score}% pondere')

    # "7 pts / 9 pts possibles · 6 taches sur 7"
    pdf.set_font('Courier', '', 6.5)
    pdf.set_text_color(*C_MUTED)
    pdf.set_xy(rx, Y + 14)
    pdf.cell(rw, 4, f'{pts} pts / {max_pts} pts possibles  .  {n_done} taches sur {n_tasks}')

    # Pill badges
    PH = 5.0
    py = Y + 20
    px = rx

    def pill(x, y, text, fill_rgb, border_rgb, text_rgb):
        pdf.set_font('Courier', '', 5.5)
        w = pdf.get_string_width(text) + 7
        pdf.set_fill_color(*fill_rgb)
        pdf.set_draw_color(*border_rgb)
        pdf.set_line_width(0.25)
        pdf.rect(x, y, w, PH, 'FD')
        pdf.set_text_color(*text_rgb)
        pdf.set_xy(x + 2, y + 0.5)
        pdf.cell(w - 4, PH - 1, text, align='C')
        return x + w + 4

    px = pill(px, py, f'Projet x2  ->  {proj_done}/{proj_total} pts',
              C_OK_TINT, C_OK, C_OK)
    pill(px, py, f'Annexes x1  ->  {ann_done}/{ann_total} pts',
         C_ACCT_TINT, C_ACCENT, C_ACCENT)

    Y += CARD_H + 4.0

    # ── Task section ──────────────────────────────────────────────────────────
    def task_section(title, sub, task_list, done_count, total_count, y):
        n   = len(task_list)
        SH  = 7.0
        BAR = 4.0
        ch  = SH + BAR + 1.5 + n * ROW_H + 2.5

        pdf.set_fill_color(*C_CARD)
        pdf.set_draw_color(*C_BORDER)
        pdf.set_line_width(0.2)
        pdf.rect(M, y, CW, ch, 'FD')

        # Section header
        pdf.set_font('Times', 'B', 10)
        pdf.set_text_color(*C_TEXT)
        pdf.set_xy(M + 4, y + 2)
        pdf.cell(CW - 50, 5, title)

        pdf.set_font('Courier', '', 6)
        pdf.set_text_color(*C_MUTED)
        pdf.set_xy(M + 4, y + 2)
        pdf.cell(CW - 6, 5, sub, align='R')

        # Progress bar
        pct = done_count / total_count if total_count > 0 else 0
        bar_y = y + SH
        pdf.set_fill_color(*C_BG2)
        pdf.rect(M + 4, bar_y, CW - 8, BAR - 0.5, 'F')
        if pct > 0:
            bar_col = C_OK if pct >= 0.8 else (C_WARN if pct >= 0.4 else C_FAIL)
            pdf.set_fill_color(*bar_col)
            pdf.rect(M + 4, bar_y, (CW - 8) * pct, BAR - 0.5, 'F')

        # Task rows
        ty = y + SH + BAR + 1.5
        for t in task_list:
            state = t["state"]
            lbl   = ascii_safe(t["label"])
            cx2   = M + 8.5
            cy2   = ty + ROW_H / 2
            r     = 2.0

            if state == 'done':
                # Filled green checkbox
                pdf.set_fill_color(*C_OK)
                pdf.rect(cx2 - r, cy2 - r, 2 * r, 2 * r, 'F')
                pdf.set_font('Helvetica', 'B', 5.5)
                pdf.set_text_color(*C_WHITE)
                pdf.set_xy(cx2 - r, cy2 - 3)
                pdf.cell(2 * r, 6, 'v', align='C')
                # Struck-through label
                pdf.set_font('Times', '', 8)
                pdf.set_text_color(*C_MUTED)
                pdf.set_xy(M + 13.5, ty + (ROW_H - 3.5) / 2)
                pdf.cell(CW - 17, 3.5, lbl)
                lw = min(pdf.get_string_width(lbl), CW - 18)
                pdf.set_draw_color(*C_MUTED)
                pdf.set_line_width(0.18)
                mid = ty + ROW_H / 2
                pdf.line(M + 13.5, mid, M + 13.5 + lw, mid)
            else:
                # Empty red-border checkbox
                pdf.set_draw_color(*C_FAIL)
                pdf.set_line_width(0.4)
                pdf.rect(cx2 - r, cy2 - r, 2 * r, 2 * r)
                # Label
                BW = 26
                pdf.set_font('Times', '', 8)
                pdf.set_text_color(*C_TEXT)
                pdf.set_xy(M + 13.5, ty + (ROW_H - 3.5) / 2)
                pdf.cell(CW - 17 - BW - 3, 3.5, lbl)
                # Fail badge
                bx = M + CW - BW - 2
                pdf.set_fill_color(*C_FAIL_TINT)
                pdf.set_draw_color(*C_FAIL)
                pdf.set_line_width(0.2)
                pdf.rect(bx, ty + 1.3, BW, 3.8, 'FD')
                pdf.set_font('Courier', '', 5)
                pdf.set_text_color(*C_FAIL)
                pdf.set_xy(bx, ty + 1.5)
                pdf.cell(BW, 3.5, f'-> report S{next_week}', align='C')

            ty += ROW_H

        return y + ch

    projet_tasks = [t for t in tasks if t["type"] == "projet"]
    Y = task_section(
        'Bloc projet',
        f'{proj_done} / {proj_total}  .  {proj_done * 2} / {proj_total * 2} pts',
        projet_tasks, proj_done, proj_total, Y)
    Y += 3.0

    annexe_tasks = [t for t in tasks if t["type"] == "annexe"]
    Y = task_section(
        'Taches annexes',
        f'{ann_done} / {ann_total}  .  {ann_done} / {ann_total} pts',
        annexe_tasks, ann_done, ann_total, Y)
    Y += 3.0

    # ── Analyse card ──────────────────────────────────────────────────────────
    LINE_H = 4.5
    pdf.set_font('Times', 'I', 8)
    a_lines = wrap_text(pdf, analyse, CW - 10)
    AH = 8.0 + len(a_lines) * LINE_H + 2
    AH = max(AH, 16.0)

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
        pdf.cell(CW - 8, LINE_H, line)
        ay += LINE_H

    Y += AH + 3.0

    # ── Evolution chart (compact, inside card) ────────────────────────────────
    has_next = bool(next_tasks)
    spare    = H - 8 - Y          # remaining space before footer
    need_for_next = 12 + (len(next_tasks) * ROW_H + 13) if has_next else 0
    CHART_TOTAL = 36.0            # chart card total height

    if history and spare > (CHART_TOTAL + need_for_next + 3):
        pdf.set_fill_color(*C_CARD)
        pdf.set_draw_color(*C_BORDER)
        pdf.set_line_width(0.2)
        pdf.rect(M, Y, CW, CHART_TOTAL, 'FD')

        # Title + legend
        pdf.set_font('Times', 'B', 9)
        pdf.set_text_color(*C_TEXT)
        pdf.set_xy(M + 4, Y + 3)
        pdf.cell(70, 4, 'Evolution hebdomadaire')

        lx = M + CW - 55
        pdf.set_fill_color(*C_OK)
        pdf.rect(lx, Y + 4.5, 10, 2, 'F')
        pdf.set_font('Courier', '', 5.5)
        pdf.set_text_color(*C_MUTED)
        pdf.set_xy(lx + 12, Y + 3)
        pdf.cell(22, 4, 'Bloc projet')
        pdf.set_fill_color(*C_ACCENT)
        pdf.rect(lx + 36, Y + 4.5, 10, 2, 'F')
        pdf.set_xy(lx + 48, Y + 3)
        pdf.cell(20, 4, 'Annexes')

        CH    = 22.0
        cy0   = Y + 10
        CW_   = CW - 8

        weeks_lbl = [h["week"] for h in history]
        proj_vals = [h.get("projet_pct") for h in history]
        ann_vals  = [h.get("annexe_pct")  for h in history]

        def gy(v): return cy0 + CH - CH * v / 100

        # Grid lines
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

        n   = len(weeks_lbl)
        seg = CW_ / (n + 1)
        xs  = [M + 4 + (i + 1) * seg for i in range(n)]
        cur = f'S{week}'

        for col, vals in ((C_OK, proj_vals), (C_ACCENT, ann_vals)):
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

        for i, w in enumerate(weeks_lbl):
            pdf.set_font('Courier', 'B' if w == cur else '', 5.5)
            pdf.set_text_color(*(C_TEXT if w == cur else C_MUTED))
            pdf.set_xy(xs[i] - 7, cy0 + CH + 2)
            pdf.cell(14, 3, w, align='C')

        Y += CHART_TOTAL + 3.0

    # ── Objectifs S{next_week} ────────────────────────────────────────────────
    if next_tasks and Y < H - 22:
        next_proj = [t for t in next_tasks if t["type"] == "projet"]
        next_ann  = [t for t in next_tasks if t["type"] == "annexe"]

        # Blue header band
        OHH = 12.0
        pdf.set_fill_color(*C_ACCENT)
        pdf.rect(M, Y, CW, OHH, 'F')

        pdf.set_font('Times', 'B', 12)
        pdf.set_text_color(*C_WHITE)
        pdf.set_xy(M + 5, Y + 2)
        pdf.cell(CW - 10, 6, f'Objectifs S{next_week}')

        sub = next_dates if next_dates else f'Semaine {next_week}'
        pdf.set_font('Courier', '', 5.5)
        pdf.set_text_color(175, 195, 225)
        np_  = len(next_proj)
        na_  = len(next_ann)
        pdf.set_xy(M + 5, Y + 8)
        pdf.cell(CW - 10, 3.5, f'{sub}  .  {np_} projet  .  {na_} annexes')
        Y += OHH

        NR = ROW_H

        def obj_block(title, task_list, y):
            n   = len(task_list)
            SHB = 6.5
            ch  = SHB + n * NR + 1
            if y + ch > H - 10:
                ch = H - 10 - y   # clip if overflow

            pdf.set_fill_color(*C_CARD)
            pdf.set_draw_color(*C_BORDER)
            pdf.set_line_width(0.2)
            pdf.rect(M, y, CW, ch, 'FD')

            pdf.set_font('Times', 'B', 8.5)
            pdf.set_text_color(*C_TEXT)
            pdf.set_xy(M + 4, y + 1.5)
            pdf.cell(CW - 50, 4, title)

            pdf.set_font('Courier', '', 5.5)
            pdf.set_text_color(*C_MUTED)
            pdf.set_xy(M + 4, y + 1.5)
            pdf.cell(CW - 6, 4, f'{n} taches', align='R')

            ty = y + SHB
            for i, t in enumerate(task_list):
                if ty + NR > y + ch:
                    break
                state = t.get("state", "new")
                lbl   = ascii_safe(t["label"])
                clr   = C_FAIL if state == 'report' else C_OK

                # Dot
                pdf.set_fill_color(*clr)
                pdf.circle(M + 7, ty + NR / 2, 1.5, 'F')

                # Label
                BW2 = 22
                pdf.set_font('Times', '', 7.5)
                pdf.set_text_color(*C_TEXT)
                pdf.set_xy(M + 11.5, ty + (NR - 3.5) / 2)
                pdf.cell(CW - 15 - BW2 - 2, 3.5, lbl)

                # Badge
                badge_txt  = f'report S{week}' if state == 'report' else 'nouveau'
                badge_fill = C_FAIL_TINT if state == 'report' else C_OK_TINT
                badge_col  = C_FAIL if state == 'report' else C_OK
                bx = M + CW - BW2 - 2
                pdf.set_fill_color(*badge_fill)
                pdf.set_draw_color(*badge_col)
                pdf.set_line_width(0.2)
                pdf.rect(bx, ty + 1.5, BW2, 3.5, 'FD')
                pdf.set_font('Courier', '', 4.5)
                pdf.set_text_color(*badge_col)
                pdf.set_xy(bx, ty + 1.8)
                pdf.cell(BW2, 3, badge_txt, align='C')

                # Row separator
                if i < n - 1:
                    pdf.set_draw_color(*C_BG)
                    pdf.set_line_width(0.15)
                    pdf.line(M + 10, ty + NR, M + CW - 2, ty + NR)

                ty += NR

            return y + ch

        if next_proj:
            Y = obj_block('Bloc projet', next_proj, Y)
        if next_ann and Y < H - 16:
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
