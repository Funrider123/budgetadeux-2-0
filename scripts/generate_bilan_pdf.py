#!/usr/bin/env python3
"""
Generate the weekly bilan PDF using fpdf2 (built-in fonts, ~3-5KB output).
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
    {
      "label": "Tester GLM 5.3",
      "type": "projet",       // "projet" | "annexe"
      "state": "done"         // "done" | "fail" | "unplan"
    },
    ...
  ],
  "history": [               // optional, up to 6 entries newest last
    {"week": "S24", "projet_pct": 75, "annexe_pct": 80},
    ...
  ]
}

Output: raw base64 string of the PDF (no newlines)
"""

import sys, json, base64, math
from datetime import datetime
from fpdf import FPDF, XPos, YPos

C_ACCENT = (42,  75, 124)
C_OK     = (61, 122,  95)
C_FAIL   = (150,  48,  48)
C_UNPLAN = (90,  61, 122)
C_MUTED  = (120, 115, 108)
C_BORDER = (200, 195, 188)
C_WHITE  = (255, 255, 255)
C_DARK   = (30,  27,  22)
C_STRIPE = (248, 246, 242)
C_BG     = (237, 234, 227)


def compute_score(tasks):
    projet = [t for t in tasks if t["type"] == "projet"]
    annexes = [t for t in tasks if t["type"] == "annexe"]
    proj_done = sum(1 for t in projet if t["state"] == "done")
    ann_done  = sum(1 for t in annexes if t["state"] == "done")
    total_pts = proj_done * 2 + ann_done * 1
    max_pts   = len(projet) * 2 + len(annexes) * 1
    score_pct = round(100 * total_pts / max_pts) if max_pts > 0 else 0
    if   score_pct >= 90: grade = "A"
    elif score_pct >= 80: grade = "B"
    elif score_pct >= 70: grade = "C"
    elif score_pct >= 60: grade = "D"
    else:                  grade = "F"
    return score_pct, grade, proj_done, len(projet), ann_done, len(annexes), total_pts, max_pts


class BilanPDF(FPDF):
    def header(self): pass
    def footer(self): pass


def build_pdf(data: dict) -> str:
    week      = data["week"]
    year      = data["year"]
    date_range = data.get("date_range", "")
    next_week = data.get("next_week", week + 1)
    tasks     = data["tasks"]
    history   = data.get("history", [])

    score, grade, proj_done, proj_total, ann_done, ann_total, pts, max_pts = compute_score(tasks)

    pdf = BilanPDF(format='A4')
    pdf.set_auto_page_break(False)
    pdf.add_page()
    W = pdf.w
    M = 14
    CW = W - 2 * M

    # ── HEADER ──────────────────────────────────────────────
    pdf.set_fill_color(*C_ACCENT)
    pdf.rect(0, 0, W, 26, 'F')

    pdf.set_fill_color(55, 82, 138)
    pdf.rect(M, 6, 46, 9, 'F')
    pdf.set_font('Helvetica', 'B', 7)
    pdf.set_text_color(*C_WHITE)
    pdf.set_xy(M, 8)
    pdf.cell(46, 5, f'SEMAINE {week} - {year}', align='C')

    pdf.set_font('Helvetica', 'B', 14)
    pdf.set_text_color(*C_WHITE)
    pdf.set_xy(M + 50, 4)
    pdf.cell(0, 8, 'Bilan hebdomadaire')

    pdf.set_font('Helvetica', '', 7)
    pdf.set_text_color(175, 195, 225)
    pdf.set_xy(M + 50, 13)
    pdf.cell(0, 5, f'{date_range}  .  Projet x2 pts  .  Annexes x1 pt')

    pdf.set_font('Helvetica', 'B', 22)
    pdf.set_text_color(*C_WHITE)
    pdf.set_xy(W - M - 38, 2)
    pdf.cell(38, 13, f'{score}%', align='R')

    grade_col = C_OK if grade in ('A', 'B') else (C_FAIL if grade == 'F' else C_MUTED)
    pdf.set_fill_color(*grade_col)
    pdf.rect(W - M - 12, 15, 12, 8, 'F')
    pdf.set_font('Helvetica', 'B', 9)
    pdf.set_text_color(*C_WHITE)
    pdf.set_xy(W - M - 12, 16)
    pdf.cell(12, 6, grade, align='C')

    Y = 29

    # ── PROGRESS BAR ────────────────────────────────────────
    pdf.set_fill_color(*C_BORDER)
    pdf.rect(M, Y, CW, 5, 'F')
    pdf.set_fill_color(*C_ACCENT)
    pdf.rect(M, Y, CW * score / 100, 5, 'F')
    for pct in [60, 70, 80, 90]:
        x = M + CW * pct / 100
        pdf.set_draw_color(*C_WHITE)
        pdf.line(x, Y, x, Y + 5)
        pdf.set_font('Helvetica', '', 5)
        pdf.set_text_color(*C_MUTED)
        pdf.set_xy(x - 3, Y + 5.5)
        pdf.cell(6, 3, f'{pct}%', align='C')
    Y += 11

    # ── SECTION HEADER ──────────────────────────────────────
    def section_hdr(title, sub, y):
        pdf.set_fill_color(*C_ACCENT)
        pdf.rect(M, y, CW, 8, 'F')
        pdf.set_fill_color(*C_OK)
        pdf.rect(M, y, 2.5, 8, 'F')
        pdf.set_font('Helvetica', 'B', 9)
        pdf.set_text_color(*C_WHITE)
        pdf.set_xy(M + 4, y + 1.5)
        pdf.cell(CW - 8, 5, title)
        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(175, 195, 225)
        pdf.set_xy(M + 4, y + 1.5)
        pdf.cell(CW - 6, 5, sub, align='R')
        return y + 10

    # ── TASK ROW ────────────────────────────────────────────
    ROW_H = 7.0

    def task_row(label, state, badge, y, stripe):
        if stripe:
            pdf.set_fill_color(*C_STRIPE)
            pdf.rect(M, y, CW, ROW_H, 'F')
        cx, cy = M + 5, y + ROW_H / 2
        r = 2.1
        clr = C_OK if state == 'done' else (C_FAIL if state == 'fail' else C_UNPLAN)
        pdf.set_fill_color(*clr)
        pdf.circle(cx - r, cy - r, 2 * r, 'F')
        pdf.set_font('Helvetica', 'B', 6.5)
        pdf.set_text_color(*C_WHITE)
        pdf.set_xy(cx - 2, cy - 2.5)
        pdf.cell(4, 5, 'v' if state == 'done' else 'x', align='C')
        txt_x = M + 10.5
        max_w = CW - 11.5 - (27 if badge else 0)
        pdf.set_font('Helvetica', '', 8.5)
        pdf.set_text_color(*C_DARK)
        pdf.set_xy(txt_x, y + (ROW_H - 4) / 2)
        pdf.cell(max_w, 4, label)
        if state == 'done':
            lw = min(pdf.get_string_width(label), max_w - 1)
            pdf.set_draw_color(*C_MUTED)
            pdf.set_line_width(0.15)
            pdf.line(txt_x, y + ROW_H / 2 + 0.3, txt_x + lw, y + ROW_H / 2 + 0.3)
        if badge:
            bx = M + CW - 26
            pdf.set_fill_color(*C_UNPLAN)
            pdf.rect(bx, y + 1, 25, 5, 'F')
            pdf.set_font('Helvetica', 'B', 6.5)
            pdf.set_text_color(*C_WHITE)
            pdf.set_xy(bx, y + 1)
            pdf.cell(25, 5, badge, align='C')
        return y + ROW_H + 0.3

    # ── BLOC PROJET ─────────────────────────────────────────
    projet_tasks = [t for t in tasks if t["type"] == "projet"]
    Y = section_hdr('Bloc projet',
                    f'{proj_done} / {proj_total} realisees  -  x2 pts/tache', Y)
    for i, t in enumerate(projet_tasks):
        badge = f'-> report S{next_week}' if t["state"] != "done" else None
        Y = task_row(t["label"], t["state"], badge, Y, i % 2 == 0)
    Y += 4

    # ── TACHES ANNEXES ──────────────────────────────────────
    annexe_tasks = [t for t in tasks if t["type"] == "annexe"]
    Y = section_hdr('Taches annexes',
                    f'{ann_done} / {ann_total} realisees  -  x1 pt/tache', Y)
    for i, t in enumerate(annexe_tasks):
        badge = f'-> report S{next_week}' if t["state"] != "done" else None
        Y = task_row(t["label"], t["state"], badge, Y, i % 2 == 0)
    Y += 5

    # ── SCORE SUMMARY ───────────────────────────────────────
    pdf.set_fill_color(*C_BG)
    pdf.rect(M, Y, CW, 14, 'F')
    pdf.set_draw_color(*C_BORDER)
    pdf.set_line_width(0.25)
    pdf.rect(M, Y, CW, 14)
    pdf.set_fill_color(*C_ACCENT)
    pdf.rect(M, Y, 2.5, 14, 'F')
    pdf.set_font('Helvetica', '', 7)
    pdf.set_text_color(*C_MUTED)
    pdf.set_xy(M + 5, Y + 2)
    pdf.cell(CW - 45, 4,
             f'Projet : {proj_done}/{proj_total} x 2 pts = {proj_done * 2} pts    '
             f'Annexes : {ann_done}/{ann_total} x 1 pt = {ann_done} pts')
    pdf.set_font('Helvetica', 'B', 8)
    pdf.set_text_color(*C_DARK)
    pdf.set_xy(M + 5, Y + 7)
    pdf.cell(40, 4, f'Total : {pts} / {max_pts} pts')
    pdf.set_font('Helvetica', 'B', 16)
    pdf.set_text_color(*C_ACCENT)
    pdf.set_xy(W - M - 43, Y + 1)
    pdf.cell(22, 12, f'{score} %', align='R')
    pdf.set_font('Helvetica', 'B', 10)
    pdf.set_text_color(*grade_col)
    pdf.set_xy(W - M - 20, Y + 3)
    pdf.cell(20, 8, f'Grade {grade}', align='R')
    Y += 18

    # ── SPARKLINE ────────────────────────────────────────────
    if history:
        pdf.set_font('Helvetica', 'B', 7)
        pdf.set_text_color(*C_ACCENT)
        pdf.set_xy(M, Y)
        pdf.cell(CW, 4, 'Evolution - dernieres semaines')
        Y += 6

        CH = 24
        weeks_lbl = [h["week"] for h in history]
        proj_vals = [h.get("projet_pct") for h in history]
        ann_vals  = [h.get("annexe_pct") for h in history]

        def gy(v):
            return Y + CH - CH * v / 100

        # grid
        pdf.set_line_width(0.12)
        for pct in [0, 50, 100]:
            g = gy(pct)
            pdf.set_draw_color(*C_BORDER)
            pdf.set_dash_pattern(dash=1, gap=2)
            pdf.line(M, g, M + CW, g)
            pdf.set_font('Helvetica', '', 5)
            pdf.set_text_color(*C_MUTED)
            pdf.set_xy(M - 10, g - 1.5)
            pdf.cell(8, 3, f'{pct}%', align='R')
        pdf.set_dash_pattern()
        pdf.set_draw_color(*C_BORDER)
        pdf.set_line_width(0.15)
        pdf.line(M, Y, M, Y + CH)
        pdf.line(M, Y + CH, M + CW, Y + CH)

        n = len(weeks_lbl)
        seg = CW / (n + 1)
        xs = [M + (i + 1) * seg for i in range(n)]
        cur_lbl = f'S{week}'

        for col, vals in [(C_ACCENT, proj_vals), (C_OK, ann_vals)]:
            pdf.set_draw_color(*col)
            pdf.set_line_width(0.4)
            prev_x = prev_y = None
            for x, v in zip(xs, vals):
                if v is not None:
                    cy = gy(v)
                    if prev_x is not None:
                        pdf.line(prev_x, prev_y, x, cy)
                    prev_x, prev_y = x, cy
            for x, v in zip(xs, vals):
                if v is not None:
                    pdf.set_fill_color(*col)
                    pdf.circle(x - 1.3, gy(v) - 1.3, 2.6, 'F')

        for i, w in enumerate(weeks_lbl):
            pdf.set_font('Helvetica', 'B' if w == cur_lbl else '', 6)
            pdf.set_text_color(*C_ACCENT if w == cur_lbl else C_MUTED)
            pdf.set_xy(xs[i] - 7, Y + CH + 1.5)
            pdf.cell(14, 3, w, align='C')

        LY = Y + CH + 7
        pdf.set_fill_color(*C_ACCENT)
        pdf.rect(M, LY, 9, 2.5, 'F')
        pdf.set_font('Helvetica', '', 6)
        pdf.set_text_color(*C_MUTED)
        pdf.set_xy(M + 11, LY - 0.5)
        pdf.cell(22, 3.5, 'Bloc projet')
        pdf.set_fill_color(*C_OK)
        pdf.rect(M + 40, LY, 9, 2.5, 'F')
        pdf.set_xy(M + 51, LY - 0.5)
        pdf.cell(30, 3.5, 'Taches annexes')

    # ── FOOTER ──────────────────────────────────────────────
    now_str = datetime.now().strftime('%A %d %B %Y a %Hh%M')
    pdf.set_fill_color(*C_ACCENT)
    pdf.rect(0, pdf.h - 8, W, 8, 'F')
    pdf.set_font('Helvetica', '', 6)
    pdf.set_text_color(175, 195, 225)
    pdf.set_xy(M, pdf.h - 6)
    pdf.cell(CW / 2, 4, f'Budget a Deux  .  Bilan S{week}-{year}')
    pdf.set_xy(M + CW / 2, pdf.h - 6)
    pdf.cell(CW / 2, 4, f'Genere automatiquement le {now_str}', align='R')

    # ── OUTPUT ──────────────────────────────────────────────
    import io
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
