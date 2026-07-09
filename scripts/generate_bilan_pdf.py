#!/usr/bin/env python3
"""
Generate the weekly bilan PDF — carnet style (stone background, Times-Roman, donut).
Usage:
    python3 generate_bilan_pdf.py '<json>'
    echo '<json>' | python3 generate_bilan_pdf.py

JSON schema:
{
  "week": 27,
  "year": 2026,
  "date_range": "29 juin - 3 juillet 2026",
  "next_week": 28,
  "tasks": [
    {"label": "S27 : Tester GLM", "type": "projet", "state": "done"},
    {"label": "S27 : Veille tech",  "type": "annexe", "state": "fail"}
  ],
  "history": [
    {"week": "S24", "projet_pct": 75, "annexe_pct": 80}
  ]
}

Output: raw base64 string of the PDF (no newlines).
"""

import sys, json, base64, io
from datetime import datetime
from fpdf import FPDF

# ── Palette ──────────────────────────────────────────────────────────────────
C_BG     = (237, 234, 227)   # stone background
C_CARD   = (253, 251, 247)   # off-white card
C_BORDER = (216, 210, 197)   # card border
C_TEXT   = (44,  42,  37)    # near-black
C_MUTED  = (138, 130, 119)   # muted grey
C_ACCENT = (42,  75, 124)    # navy blue
C_OK     = (61, 122,  95)    # green
C_FAIL   = (150,  48,  48)   # red
C_WARN   = (139, 105,  20)   # amber
C_WHITE  = (255, 255, 255)
C_TRACK  = (220, 215, 203)   # donut track


def ascii_safe(s: str) -> str:
    """Transliterate characters that fpdf2 built-in fonts can't encode."""
    table = {
        '—': ' - ', '–': '-', '’': "'", '‘': "'",
        '“': '"',   '”': '"', '…': '...',
        'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
        'à': 'a', 'â': 'a', 'ä': 'a',
        'î': 'i', 'ï': 'i',
        'ô': 'o', 'ö': 'o',
        'ù': 'u', 'û': 'u', 'ü': 'u',
        'ç': 'c', 'Ç': 'C',
        'É': 'E', 'È': 'E', 'Ê': 'E',
        'À': 'A', 'Â': 'A',
        'Ô': 'O', 'Ù': 'U', 'Û': 'U',
        '×': 'x', '°': 'deg',
    }
    for k, v in table.items():
        s = s.replace(k, v)
    return s


def compute_score(tasks):
    projet  = [t for t in tasks if t["type"] == "projet"]
    annexes = [t for t in tasks if t["type"] == "annexe"]
    proj_done = sum(1 for t in projet  if t["state"] == "done")
    ann_done  = sum(1 for t in annexes if t["state"] == "done")
    total_pts = proj_done * 2 + ann_done
    max_pts   = len(projet) * 2 + len(annexes)
    score = round(100 * total_pts / max_pts) if max_pts > 0 else 0
    if   score >= 90: grade = 'A'
    elif score >= 80: grade = 'B'
    elif score >= 70: grade = 'C'
    elif score >= 60: grade = 'D'
    else:             grade = 'F'
    return score, grade, proj_done, len(projet), ann_done, len(annexes), total_pts, max_pts


class CarnetPDF(FPDF):
    def header(self): pass
    def footer(self): pass


def build_pdf(data: dict) -> str:
    week       = data["week"]
    year       = data["year"]
    date_range = ascii_safe(data.get("date_range", ""))
    next_week  = data.get("next_week", week + 1)
    tasks      = data["tasks"]
    history    = data.get("history", [])

    score, grade, proj_done, proj_total, ann_done, ann_total, pts, max_pts = compute_score(tasks)
    grade_col = C_OK if grade in ('A', 'B') else (C_FAIL if grade == 'F' else C_WARN)

    pdf = CarnetPDF(format='A4')
    pdf.set_auto_page_break(False)
    pdf.add_page()
    W, H = pdf.w, pdf.h
    M  = 12.0
    CW = W - 2 * M

    # ── Full-page stone background ────────────────────────────────────────────
    pdf.set_fill_color(*C_BG)
    pdf.rect(0, 0, W, H, 'F')

    Y = 10.0

    # ── Eyebrow ──────────────────────────────────────────────────────────────
    pdf.set_font('Courier', '', 7.5)
    pdf.set_text_color(*C_ACCENT)
    pdf.set_xy(M, Y)
    pdf.cell(CW, 5, f'SEMAINE {week} - {year}  .  {date_range}')
    Y += 7.0

    # ── Title ────────────────────────────────────────────────────────────────
    pdf.set_font('Times', 'B', 26)
    pdf.set_text_color(*C_TEXT)
    pdf.set_xy(M, Y)
    pdf.cell(CW, 12, 'Bilan hebdomadaire')
    Y += 14.0

    # ── Separator ────────────────────────────────────────────────────────────
    pdf.set_draw_color(*C_BORDER)
    pdf.set_line_width(0.25)
    pdf.line(M, Y, M + CW, Y)
    Y += 5.0

    # ── Score card ────────────────────────────────────────────────────────────
    CARD_H = 48.0
    pdf.set_fill_color(*C_CARD)
    pdf.set_draw_color(*C_BORDER)
    pdf.set_line_width(0.3)
    pdf.rect(M, Y, CW, CARD_H, 'FD')

    # Donut chart
    dcx = M + 29.0
    dcy = Y + CARD_H / 2
    OR  = 16.0
    IR  = 10.5

    pdf.set_fill_color(*C_TRACK)
    pdf.circle(dcx, dcy, OR, 'F')

    if score > 0:
        pdf.set_fill_color(*grade_col)
        # clockwise=False → CCW in math coords → CW on screen (PDF Y-down)
        pdf.solid_arc(dcx, dcy, OR, -90, -90 + score * 3.6, OR, 0, False, 'F')

    pdf.set_fill_color(*C_CARD)
    pdf.circle(dcx, dcy, IR, 'F')

    # Score text inside donut
    pdf.set_font('Times', 'B', 11)
    pdf.set_text_color(*C_TEXT)
    pdf.set_xy(dcx - 9, dcy - 5)
    pdf.cell(18, 5, f'{score}%', align='C')
    pdf.set_font('Times', '', 6.0)
    pdf.set_text_color(*C_MUTED)
    pdf.set_xy(dcx - 9, dcy + 1)
    pdf.cell(18, 3, f'Grade {grade}', align='C')

    # Score details (right of donut)
    dx = M + 56.0
    pdf.set_font('Times', 'B', 18)
    pdf.set_text_color(*grade_col)
    pdf.set_xy(dx, Y + 6)
    pdf.cell(CW - 58, 10, f'{score} %')

    pdf.set_font('Times', '', 8.5)
    pdf.set_text_color(*C_MUTED)
    pdf.set_xy(dx, Y + 18)
    pdf.cell(CW - 58, 4.5, f'Projet : {proj_done}/{proj_total} x 2 pts = {proj_done * 2} pts')
    pdf.set_xy(dx, Y + 23)
    pdf.cell(CW - 58, 4.5, f'Annexes : {ann_done}/{ann_total} x 1 pt = {ann_done} pts')
    pdf.set_xy(dx, Y + 28)
    pdf.cell(CW - 58, 4.5, f'Total : {pts} / {max_pts} pts')

    # Grade badge
    pdf.set_fill_color(*grade_col)
    pdf.rect(dx, Y + 36, 26, 7, 'F')
    pdf.set_font('Times', 'B', 10)
    pdf.set_text_color(*C_WHITE)
    pdf.set_xy(dx, Y + 37.5)
    pdf.cell(26, 4, f'Grade {grade}', align='C')

    Y += CARD_H + 5.0

    # ── Progress bar ─────────────────────────────────────────────────────────
    pdf.set_fill_color(*C_BORDER)
    pdf.rect(M, Y, CW, 3.5, 'F')
    if score > 0:
        pdf.set_fill_color(*grade_col)
        pdf.rect(M, Y, CW * score / 100, 3.5, 'F')
    # Grade thresholds markers
    for pct in (60, 70, 80, 90):
        x = M + CW * pct / 100
        pdf.set_draw_color(*C_CARD)
        pdf.set_line_width(0.3)
        pdf.line(x, Y, x, Y + 3.5)
    Y += 7.0

    ROW_H = 6.8

    def section_card(title, sub, task_list, y):
        n  = len(task_list)
        SH = 7.5
        ch = SH + n * ROW_H + 3.0

        pdf.set_fill_color(*C_CARD)
        pdf.set_draw_color(*C_BORDER)
        pdf.set_line_width(0.2)
        pdf.rect(M, y, CW, ch, 'FD')

        pdf.set_fill_color(*C_ACCENT)
        pdf.rect(M, y, 2.5, ch, 'F')

        pdf.set_font('Courier', 'B', 7)
        pdf.set_text_color(*C_ACCENT)
        pdf.set_xy(M + 5, y + 2)
        pdf.cell(CW - 10, 4, title.upper())

        pdf.set_font('Courier', '', 6.5)
        pdf.set_text_color(*C_MUTED)
        pdf.set_xy(M + 5, y + 2)
        pdf.cell(CW - 7, 4, sub, align='R')

        ty = y + SH
        for i, t in enumerate(task_list):
            if i % 2 == 1:
                pdf.set_fill_color(246, 244, 239)
                pdf.rect(M + 2.5, ty, CW - 2.5, ROW_H, 'F')

            cx2 = M + 9.0
            cy2 = ty + ROW_H / 2
            r   = 2.0
            state = t["state"]
            lbl   = ascii_safe(t["label"])

            if state == 'done':
                # Filled green square checkbox
                pdf.set_fill_color(*C_OK)
                pdf.rect(cx2 - r, cy2 - r, 2 * r, 2 * r, 'F')
                pdf.set_font('Helvetica', 'B', 6)
                pdf.set_text_color(*C_WHITE)
                pdf.set_xy(cx2 - r, cy2 - 3)
                pdf.cell(2 * r, 6, 'v', align='C')
                # Label with strikethrough
                pdf.set_font('Times', '', 8.5)
                pdf.set_text_color(*C_MUTED)
                pdf.set_xy(M + 14.5, ty + (ROW_H - 4) / 2)
                pdf.cell(CW - 17, 4, lbl)
                lw = min(pdf.get_string_width(lbl), CW - 18)
                pdf.set_draw_color(*C_MUTED)
                pdf.set_line_width(0.2)
                mid_y = ty + ROW_H / 2
                pdf.line(M + 14.5, mid_y, M + 14.5 + lw, mid_y)
            else:
                # Empty red-border square checkbox
                pdf.set_draw_color(*C_FAIL)
                pdf.set_line_width(0.4)
                pdf.rect(cx2 - r, cy2 - r, 2 * r, 2 * r)
                # Label
                badge_w = 28
                pdf.set_font('Times', '', 8.5)
                pdf.set_text_color(*C_TEXT)
                pdf.set_xy(M + 14.5, ty + (ROW_H - 4) / 2)
                pdf.cell(CW - 17 - badge_w - 3, 4, lbl)
                # Fail badge
                bx = M + CW - badge_w
                pdf.set_fill_color(*C_FAIL)
                pdf.rect(bx, ty + 1.5, badge_w, 4, 'F')
                pdf.set_font('Helvetica', 'B', 5.5)
                pdf.set_text_color(*C_WHITE)
                pdf.set_xy(bx, ty + 1.5)
                pdf.cell(badge_w, 4, f'report S{next_week}', align='C')

            ty += ROW_H

        return y + ch

    # ── Bloc projet ───────────────────────────────────────────────────────────
    projet_tasks = [t for t in tasks if t["type"] == "projet"]
    Y = section_card('Bloc projet',
                     f'{proj_done}/{proj_total} realisees  x2 pts',
                     projet_tasks, Y)
    Y += 4.0

    # ── Taches annexes ────────────────────────────────────────────────────────
    annexe_tasks = [t for t in tasks if t["type"] == "annexe"]
    Y = section_card('Taches annexes',
                     f'{ann_done}/{ann_total} realisees  x1 pt',
                     annexe_tasks, Y)
    Y += 4.0

    # ── Analyse card ──────────────────────────────────────────────────────────
    if score >= 90:
        lines = [
            'Semaine excellente - toutes les priorites atteintes.',
            f'Maintenir ce rythme en S{next_week}.',
        ]
    elif score >= 70:
        missed = max_pts - pts
        lines = [
            f'{missed} pt(s) manquant(s) sur {max_pts}. Bonne semaine globalement.',
            f'{proj_total - proj_done} tache(s) projet a reprendre en S{next_week}.',
        ]
    else:
        lines = [
            f'Semaine difficile : {pts}/{max_pts} pts ({score}%).',
            f'Prioriser les {proj_total - proj_done} tache(s) projet en S{next_week}.',
        ]

    AH = 8.0 + len(lines) * 5.5
    pdf.set_fill_color(*C_CARD)
    pdf.set_draw_color(*C_BORDER)
    pdf.set_line_width(0.2)
    pdf.rect(M, Y, CW, AH, 'FD')
    pdf.set_fill_color(*C_ACCENT)
    pdf.rect(M, Y, 2.5, AH, 'F')
    pdf.set_font('Courier', 'B', 7)
    pdf.set_text_color(*C_ACCENT)
    pdf.set_xy(M + 5, Y + 2)
    pdf.cell(CW - 7, 4, 'ANALYSE')
    ay = Y + 8.0
    for line in lines:
        pdf.set_font('Times', 'I', 8.5)
        pdf.set_text_color(*C_TEXT)
        pdf.set_xy(M + 5, ay)
        pdf.cell(CW - 8, 5, ascii_safe(line))
        ay += 5.5
    Y += AH + 4.0

    # ── Evolution chart ───────────────────────────────────────────────────────
    if history and Y < H - 52:
        pdf.set_font('Courier', 'B', 7)
        pdf.set_text_color(*C_ACCENT)
        pdf.set_xy(M, Y)
        pdf.cell(CW, 4, 'EVOLUTION - DERNIERES SEMAINES')
        Y += 6.0

        CH = 26.0
        weeks_lbl = [h["week"] for h in history]
        proj_vals = [h.get("projet_pct") for h in history]
        ann_vals  = [h.get("annexe_pct")  for h in history]

        def gy(v): return Y + CH - CH * v / 100

        # Grid lines
        pdf.set_line_width(0.12)
        for pct in (0, 50, 100):
            g = gy(pct)
            pdf.set_draw_color(*C_BORDER)
            pdf.set_dash_pattern(dash=1, gap=2)
            pdf.line(M, g, M + CW, g)
            pdf.set_font('Courier', '', 5)
            pdf.set_text_color(*C_MUTED)
            pdf.set_xy(M - 10, g - 1.5)
            pdf.cell(8, 3, f'{pct}%', align='R')
        pdf.set_dash_pattern()

        n   = len(weeks_lbl)
        seg = CW / (n + 1)
        xs  = [M + (i + 1) * seg for i in range(n)]
        cur = f'S{week}'

        for col, vals in ((C_ACCENT, proj_vals), (C_OK, ann_vals)):
            pdf.set_draw_color(*col)
            pdf.set_line_width(0.5)
            px = py = None
            for x, v in zip(xs, vals):
                if v is not None:
                    cy3 = gy(v)
                    if px is not None:
                        pdf.line(px, py, x, cy3)
                    px, py = x, cy3
            pdf.set_line_width(0.12)
            for x, v in zip(xs, vals):
                if v is not None:
                    pdf.set_fill_color(*col)
                    pdf.circle(x, gy(v), 1.5, 'F')

        for i, w in enumerate(weeks_lbl):
            pdf.set_font('Courier', 'B' if w == cur else '', 5.5)
            pdf.set_text_color(*(C_ACCENT if w == cur else C_MUTED))
            pdf.set_xy(xs[i] - 7, Y + CH + 2)
            pdf.cell(14, 3, w, align='C')

        LY = Y + CH + 8
        pdf.set_fill_color(*C_ACCENT)
        pdf.rect(M, LY, 8, 2.5, 'F')
        pdf.set_font('Courier', '', 5.5)
        pdf.set_text_color(*C_MUTED)
        pdf.set_xy(M + 10, LY - 0.5)
        pdf.cell(25, 3.5, 'Bloc projet')
        pdf.set_fill_color(*C_OK)
        pdf.rect(M + 42, LY, 8, 2.5, 'F')
        pdf.set_xy(M + 52, LY - 0.5)
        pdf.cell(30, 3.5, 'Taches annexes')
        Y = LY + 8

    # ── Footer ────────────────────────────────────────────────────────────────
    now_str = datetime.now().strftime('%d/%m/%Y a %Hh%M')
    FH = 8
    pdf.set_fill_color(*C_ACCENT)
    pdf.rect(0, H - FH, W, FH, 'F')
    pdf.set_font('Courier', '', 5.5)
    pdf.set_text_color(175, 195, 225)
    pdf.set_xy(M, H - FH + 2)
    pdf.cell(CW / 2, 4, f'Budget a Deux  .  Bilan S{week}-{year}')
    pdf.set_xy(M + CW / 2, H - FH + 2)
    pdf.cell(CW / 2, 4, f'Genere automatiquement le {now_str}', align='R')

    # ── Output ────────────────────────────────────────────────────────────────
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
