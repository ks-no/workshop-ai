from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image as PILImage
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "sok-en-gang-poc-team-oslo.pdf"

NAVY = HexColor("#2A2859")
TEAL = HexColor("#005650")
CYAN = HexColor("#6FE9F2")
PALE_CYAN = HexColor("#E8F8FA")
PALE_GREEN = HexColor("#E8F3F1")
CREAM = HexColor("#F8F3E6")
INK = HexColor("#182421")
MUTED = HexColor("#52605D")
LINE = HexColor("#CAD2D0")

VIDEO_URL = (
    "https://oslokommune-my.sharepoint.com/:v:/r/personal/"
    "tai_thanh_truong_dig_oslo_kommune_no/Documents/KS%20demo/"
    "Demo-Team-Oslo.mp4?d=w4db3f5d1036341f3922fc8c567e27d19"
    "&csf=1&web=1&e=3CJr6u"
)
CHALLENGE_URL = "https://ksdigital.no/digifest-i-vest-2026/hackathon/"
WORKSHOP_URL = "https://github.com/ks-no/workshop-ai"
SECURITY_URL = "https://learn.microsoft.com/en-us/agent-framework/agents/security"


def register_fonts() -> None:
    font_dir = Path("/System/Library/Fonts/Supplemental")
    pdfmetrics.registerFont(TTFont("Oslo", str(font_dir / "Arial.ttf")))
    pdfmetrics.registerFont(TTFont("OsloMedium", str(font_dir / "Arial Bold.ttf")))
    pdfmetrics.registerFont(TTFont("OsloBold", str(font_dir / "Arial Bold.ttf")))


def split_lines(text: str, font: str, size: float, max_width: float) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if pdfmetrics.stringWidth(candidate, font, size) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_wrapped(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    *,
    font: str = "Oslo",
    size: float = 11,
    leading: float | None = None,
    color=INK,
) -> float:
    leading = leading or size * 1.35
    c.setFillColor(color)
    c.setFont(font, size)
    for line in split_lines(text, font, size, width):
        c.drawString(x, y, line)
        y -= leading
    return y


def draw_bullets(
    c: canvas.Canvas,
    items: Iterable[str],
    x: float,
    y: float,
    width: float,
    *,
    size: float = 11,
    gap: float = 9,
) -> float:
    for item in items:
        c.setFillColor(TEAL)
        c.circle(x + 3, y + 3, 2.4, stroke=0, fill=1)
        y = draw_wrapped(c, item, x + 15, y + 7, width - 15, size=size, leading=size * 1.35)
        y -= gap
    return y


def draw_header(c: canvas.Canvas, page_size, title: str, page_no: int) -> None:
    width, height = page_size
    c.setFillColor(CREAM)
    c.rect(0, height - 24, width, 24, stroke=0, fill=1)
    c.setFillColor(NAVY)
    c.setFont("OsloBold", 8.5)
    c.drawString(34, height - 16, "SØK ÉN GANG  ·  TEAM OSLO")
    c.setFont("Oslo", 8.5)
    c.drawRightString(width - 34, height - 16, title)
    c.setStrokeColor(LINE)
    c.line(34, 26, width - 34, 26)
    c.setFillColor(MUTED)
    c.setFont("Oslo", 8)
    c.drawString(34, 14, "KS Digital Hackathon 2026  ·  Hackathondemo med syntetiske testopplysninger")
    c.drawRightString(width - 34, 14, str(page_no))


def draw_title(c: canvas.Canvas, title: str, subtitle: str, page_size) -> None:
    width, height = page_size
    c.setFillColor(INK)
    c.setFont("OsloBold", 25)
    c.drawString(42, height - 68, title)
    draw_wrapped(c, subtitle, 42, height - 89, width - 84, size=11.5, color=MUTED)


def draw_image_contain(
    c: canvas.Canvas,
    image_path: Path,
    x: float,
    y: float,
    width: float,
    height: float,
    *,
    pad: float = 8,
    background=white,
) -> None:
    c.setFillColor(background)
    c.setStrokeColor(LINE)
    c.roundRect(x, y, width, height, 5, stroke=1, fill=1)
    with PILImage.open(image_path) as img:
        iw, ih = img.size
    available_w = width - 2 * pad
    available_h = height - 2 * pad
    scale = min(available_w / iw, available_h / ih)
    render_w = iw * scale
    render_h = ih * scale
    c.drawImage(
        str(image_path),
        x + (width - render_w) / 2,
        y + (height - render_h) / 2,
        render_w,
        render_h,
        preserveAspectRatio=True,
        mask="auto",
    )


def cover(c: canvas.Canvas, page_size, page_no: int) -> None:
    width, height = page_size
    c.setFillColor(CREAM)
    c.rect(0, 0, width, height, stroke=0, fill=1)
    c.setFillColor(CYAN)
    c.rect(0, height - 18, width, 18, stroke=0, fill=1)
    c.setFillColor(TEAL)
    c.roundRect(52, height - 110, 46, 46, 7, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("OsloBold", 29)
    c.drawCentredString(75, height - 99, "é")

    c.setFillColor(INK)
    c.setFont("OsloBold", 38)
    c.drawString(52, height - 165, "Søk én gang")
    c.setFont("OsloMedium", 20)
    c.setFillColor(TEAL)
    c.drawString(52, height - 194, "Fra skjema til samtale")
    c.setFont("Oslo", 13)
    c.setFillColor(MUTED)
    c.drawString(52, height - 226, "PoC for KS Digital Hackathon 2026  ·  Team Oslo")

    panel_y = 52
    panel_h = 190
    c.setFillColor(white)
    c.roundRect(52, panel_y, width - 104, panel_h, 8, stroke=0, fill=1)
    c.setFillColor(NAVY)
    c.setFont("OsloBold", 13)
    c.drawString(74, panel_y + panel_h - 31, "En mer sammenhengende innbyggerreise")
    highlights = [
        ("1", "Gjenbruk data", "Bruk opplysninger det offentlige allerede har."),
        ("2", "Spør mindre", "Spør bare om det som mangler eller må bekreftes."),
        ("3", "Veiled med AI", "Forstå behovet og forklar underveis med tydelige kilder."),
        ("4", "Behold kontrollen", "Kombiner AI, faste regler og menneskelig vurdering."),
    ]
    card_gap = 8
    card_w = (width - 156 - card_gap) / 2
    card_h = 56
    for index, (number, heading, body) in enumerate(highlights):
        column = index % 2
        row = index // 2
        x = 70 + column * (card_w + card_gap)
        y = panel_y + 72 - row * (card_h + 8)
        c.setFillColor(PALE_GREEN if index % 2 == 0 else PALE_CYAN)
        c.roundRect(x, y, card_w, card_h, 5, stroke=0, fill=1)
        c.setFillColor(TEAL)
        c.circle(x + 19, y + card_h - 18, 10, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont("OsloBold", 8.5)
        c.drawCentredString(x + 19, y + card_h - 21, number)
        c.setFillColor(NAVY)
        c.setFont("OsloBold", 11)
        c.drawString(x + 36, y + card_h - 21, heading)
        draw_wrapped(c, body, x + 12, y + 19, card_w - 24, size=9.5, leading=11.5, color=MUTED)
    c.setFillColor(NAVY)
    c.setFont("OsloBold", 9)
    c.drawRightString(width - 52, 30, f"PRESENTASJON  ·  {page_no:02d}")


def journey(c: canvas.Canvas, page_size, page_no: int) -> None:
    draw_header(c, page_size, "INNBYGGERREISEN", page_no)
    draw_title(
        c,
        "Samtalen driver prosessen",
        "Innbyggeren beskriver behovet med egne ord. Tjenesten henter relevante data med samtykke og ber bare om nødvendige avklaringer.",
        page_size,
    )
    width, height = page_size
    steps = [
        ("1", "Forstå behovet", "AI-modellen tolker språk, intensjon og kontekst."),
        ("2", "Be om samtykke", "Personopplysninger hentes først når de er relevante."),
        ("3", "Gjenbruk data", "KS-sandboxen leverer syntetiske registeropplysninger."),
        ("4", "Avklar avvik", "Innbyggeren kan korrigere. Usikkerhet går til menneskelig vurdering."),
        ("5", "Vis neste steg", "Faste regler beregner. AI-modellen forklarer resultatet."),
    ]
    margin = 42
    gap = 9
    card_w = (width - 2 * margin - 4 * gap) / 5
    card_h = 142
    card_y = height - 280
    for index, (number, heading, body) in enumerate(steps):
        x = margin + index * (card_w + gap)
        c.setFillColor(PALE_GREEN if index % 2 == 0 else PALE_CYAN)
        c.roundRect(x, card_y, card_w, card_h, 6, stroke=0, fill=1)
        c.setFillColor(TEAL)
        c.circle(x + 22, card_y + card_h - 23, 13, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont("OsloBold", 10)
        c.drawCentredString(x + 22, card_y + card_h - 27, number)
        c.setFillColor(INK)
        c.setFont("OsloBold", 10.5)
        c.drawString(x + 12, card_y + card_h - 52, heading)
        draw_wrapped(c, body, x + 12, card_y + card_h - 72, card_w - 24, size=8.5, leading=11, color=MUTED)

    box_y = 50
    box_h = 102
    c.setFillColor(NAVY)
    c.roundRect(42, box_y, width - 84, box_h, 6, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("OsloBold", 13)
    c.drawString(62, box_y + box_h - 29, "Kontrollprinsipp")
    draw_wrapped(
        c,
        "AI-modellen kan forstå og forklare, men den kan ikke alene fatte vedtak eller utføre irreversible handlinger. Samtykke, faste regler og human-in-the-loop beskytter innbyggerens kontroll.",
        62,
        box_y + box_h - 51,
        width - 124,
        size=10.5,
        leading=14,
        color=white,
    )


def screenshot_page(c: canvas.Canvas, page_size, page_no: int, title: str, subtitle: str, image: Path) -> None:
    draw_header(c, page_size, "GRENSESNITT", page_no)
    draw_title(c, title, subtitle, page_size)
    width, height = page_size
    draw_image_contain(c, image, 42, 42, width - 84, height - 150, pad=6, background=HexColor("#F2F7F6"))


def diagram_page(c: canvas.Canvas, page_size, page_no: int, title: str, subtitle: str, image: Path) -> None:
    draw_header(c, page_size, "SYSTEMFLYT", page_no)
    draw_title(c, title, subtitle, page_size)
    width, height = page_size
    draw_image_contain(c, image, 34, 38, width - 68, height - 145, pad=8, background=white)


def tech_stack(c: canvas.Canvas, page_size, page_no: int) -> None:
    draw_header(c, page_size, "TEKNOLOGI", page_no)
    draw_title(
        c,
        "Teknologistakk",
        "En modulær PoC der dialog, agenter, data, regler og menneskelig kontroll kan utvikles uavhengig.",
        page_size,
    )
    width, height = page_size
    cards = [
        ("Frontend", "Next.js 16 · React 19 · TypeScript", "Punkt designsystem gir et konsistent og tilgjengelig Oslo-grensesnitt."),
        ("Agent runtime", "Python · Microsoft Agent Framework", "Koordinator og spesialistagenter deler opp behov, kilder og oppgaver."),
        ("AI-tilgang", "AI provider · OpenAI-kompatibelt API", "Leverandøren kan byttes uten å endre innbyggerreisen eller prosessreglene."),
        ("Tjenestelag", "Next.js / Node API", "Saks-ID, revisjon, samtykke og tillatte handlinger kontrolleres på serversiden."),
        ("Integrasjoner", "KS sandbox · OpenAPI · ID-porten mock", "Syntetiske registeropplysninger og regler brukes gjennom dokumenterte kontrakter."),
        ("Data og kontroll", "SQLite · kilder · spor · human-in-the-loop", "Fakta lagres med proveniens. Avvik og usikkerhet sendes til menneskelig vurdering."),
    ]
    margin_x = 42
    gap_x = 12
    gap_y = 12
    card_w = (width - 2 * margin_x - 2 * gap_x) / 3
    card_h = 145
    top_y = height - 267
    for index, (label, technology, description) in enumerate(cards):
        column = index % 3
        row = index // 3
        x = margin_x + column * (card_w + gap_x)
        y = top_y - row * (card_h + gap_y)
        c.setFillColor(PALE_GREEN if index % 2 == 0 else PALE_CYAN)
        c.roundRect(x, y, card_w, card_h, 6, stroke=0, fill=1)
        c.setFillColor(TEAL)
        c.setFont("OsloBold", 9)
        c.drawString(x + 16, y + card_h - 25, label.upper())
        c.setFillColor(INK)
        c.setFont("OsloBold", 12)
        tech_y = y + card_h - 49
        for line in split_lines(technology, "OsloBold", 12, card_w - 32):
            c.drawString(x + 16, tech_y, line)
            tech_y -= 15
        c.setStrokeColor(HexColor("#AFC2BE"))
        c.line(x + 16, tech_y - 3, x + card_w - 16, tech_y - 3)
        draw_wrapped(c, description, x + 16, tech_y - 23, card_w - 32, size=9.5, leading=12.5, color=MUTED)


def ai_security(c: canvas.Canvas, page_size, page_no: int) -> None:
    draw_header(c, page_size, "AI-SIKKERHET", page_no)
    draw_title(
        c,
        "Prompt injection og kontrollgrenser",
        "Agent Framework gir byggeklosser for guardrails. Vertsapplikasjonen må fortsatt håndheve data-, verktøy- og handlingspolicy.",
        page_size,
    )
    width, height = page_size
    panel_y = 218
    panel_h = 248
    gap = 14
    panel_w = (width - 84 - gap) / 2
    panels = [
        (
            42,
            PALE_GREEN,
            "Allerede i PoC-en",
            [
                "Brukerinput, dokumenter og kilder behandles som upålitelig data, ikke instruksjoner.",
                "AI-modellen har ingen verktøy eller rett til å hente KS-data, sende inn eller fatte vedtak.",
                "Svar må følge strenge JSON-skjemaer; fakta krever eksakt sitat og gyldig kilde.",
                "Samtykke, retting og endelig gjennomgang styres deterministisk av vertsapplikasjonen.",
            ],
        ),
        (
            42 + panel_w + gap,
            PALE_CYAN,
            "Neste guard layer",
            [
                "Agent-, chat- og function-middleware kan stoppe en kjøring før modell eller verktøy utføres.",
                "FIDES kan merke data som trusted/untrusted og public/private, og blokkere farlige verktøykall.",
                "Eksternt innhold kan isoleres i en verktøyfri karantenemodell før det når hovedagenten.",
                "Rate limits, tokenbudsjett, redigert audit-logg og prompt-injection-deteksjon legges rundt pipelinen.",
            ],
        ),
    ]
    for x, background, heading, bullets in panels:
        c.setFillColor(background)
        c.roundRect(x, panel_y, panel_w, panel_h, 7, stroke=0, fill=1)
        c.setFillColor(NAVY)
        c.setFont("OsloBold", 15)
        c.drawString(x + 20, panel_y + panel_h - 32, heading)
        draw_bullets(c, bullets, x + 20, panel_y + panel_h - 61, panel_w - 40, size=9.5, gap=10)

    c.setFillColor(NAVY)
    c.setFont("OsloBold", 9)
    c.drawString(42, 188, "FAIL-CLOSED KONTROLLKJEDE")
    flow = [
        ("1", "Input guard", "Grenser og klassifisering"),
        ("2", "Trust labels", "Kilde og konfidensialitet"),
        ("3", "AI-modell", "Minimal kontekst, ingen fri handling"),
        ("4", "Output guard", "Skjema, kilder og policy"),
        ("5", "Human / action", "Samtykke eller eksplisitt godkjenning"),
    ]
    flow_gap = 12
    flow_w = (width - 84 - 4 * flow_gap) / 5
    for index, (number, heading, body) in enumerate(flow):
        x = 42 + index * (flow_w + flow_gap)
        y = 64
        c.setFillColor(white)
        c.setStrokeColor(LINE)
        c.roundRect(x, y, flow_w, 106, 5, stroke=1, fill=1)
        c.setFillColor(TEAL)
        c.circle(x + 18, y + 85, 9, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont("OsloBold", 8)
        c.drawCentredString(x + 18, y + 82, number)
        c.setFillColor(INK)
        c.setFont("OsloBold", 9.5)
        c.drawString(x + 33, y + 81, heading)
        draw_wrapped(c, body, x + 12, y + 57, flow_w - 24, size=8, leading=10.5, color=MUTED)
        if index < len(flow) - 1:
            c.setFillColor(TEAL)
            c.setFont("OsloBold", 13)
            c.drawCentredString(x + flow_w + flow_gap / 2, y + 47, "→")

    c.setFillColor(MUTED)
    c.setFont("Oslo", 8)
    c.drawRightString(width - 42, 188, "Microsoft Agent Framework 1.17 · FIDES er tilgjengelig, men eksperimentell og ikke aktivert i denne PoC-en")


def ks_data_privacy(c: canvas.Canvas, page_size, page_no: int) -> None:
    draw_header(c, page_size, "PERSONVERN", page_no)
    draw_title(
        c,
        "KS-data og AI-provider",
        "Samtykke åpner en kontrollert dataflyt. Det betyr ikke at hele registersvaret skal sendes til modellen.",
        page_size,
    )
    width, height = page_size
    margin = 42
    gap = 12
    card_w = (width - 2 * margin - 2 * gap) / 3
    card_h = 220
    card_y = 246
    cards = [
        (
            "I denne demoen",
            PALE_GREEN,
            [
                "KS-dataene er syntetiske testopplysninger.",
                "Fødselsnummer, navn, adresse og person-ID fjernes før model context bygges.",
                "Koordinatoren ser bare om KS-data finnes; fagagenten får et relevant, redusert utsnitt.",
            ],
        ),
        (
            "Før produksjon",
            PALE_CYAN,
            [
                "Dokumenter behandlingsgrunnlag og formål for hvert felt; samtykke i UI er ikke automatisk rettslig grunnlag.",
                "Krev databehandleravtale, godkjente underleverandører, datalokasjon, sletting og ingen modelltrening.",
                "Gjennomfør DPIA og bygg personvern inn i standardinnstillingene.",
            ],
        ),
        (
            "Fast datagrense",
            CREAM,
            [
                "Send aldri rå FNR, navn, adresse, tilgangstoken, saks-ID eller hele registerdokumenter til AI-provider.",
                "Send bare nødvendige avledede fakta og korte kildeutdrag for det konkrete formålet.",
                "Behandle modelloutput som upålitelig og kontroller skjema, kilder og menneskelig godkjenning.",
            ],
        ),
    ]
    for index, (heading, background, bullets) in enumerate(cards):
        x = margin + index * (card_w + gap)
        c.setFillColor(background)
        c.roundRect(x, card_y, card_w, card_h, 7, stroke=0, fill=1)
        c.setFillColor(NAVY)
        c.setFont("OsloBold", 14)
        c.drawString(x + 18, card_y + card_h - 31, heading)
        draw_bullets(c, bullets, x + 18, card_y + card_h - 61, card_w - 36, size=9.1, gap=10)

    c.setFillColor(NAVY)
    c.setFont("OsloBold", 9)
    c.drawString(margin, 216, "ANBEFALT DATAFLYT")
    flow = [
        ("KS API", "Rådata forblir i backend", PALE_GREEN),
        ("Dataminimering", "Fjern identitet og irrelevante felt", PALE_CYAN),
        ("Minimal context", "Avledede fakta og korte utdrag", CREAM),
        ("AI-provider", "Kun behandling for avtalt formål", PALE_CYAN),
        ("Output guard", "Skjema, kilder og menneskelig kontroll", PALE_GREEN),
    ]
    flow_gap = 12
    flow_w = (width - 2 * margin - 4 * flow_gap) / 5
    for index, (heading, body, background) in enumerate(flow):
        x = margin + index * (flow_w + flow_gap)
        y = 68
        c.setFillColor(background)
        c.roundRect(x, y, flow_w, 128, 5, stroke=0, fill=1)
        c.setFillColor(TEAL)
        c.setFont("OsloBold", 9.5)
        c.drawString(x + 12, y + 96, heading)
        c.setStrokeColor(HexColor("#AFC2BE"))
        c.line(x + 12, y + 84, x + flow_w - 12, y + 84)
        draw_wrapped(c, body, x + 12, y + 65, flow_w - 24, size=8.2, leading=10.5, color=MUTED)
        if index < len(flow) - 1:
            c.setFillColor(TEAL)
            c.setFont("OsloBold", 13)
            c.drawCentredString(x + flow_w + flow_gap / 2, y + 55, "→")

    c.setFillColor(MUTED)
    c.setFont("Oslo", 8)
    c.drawRightString(width - margin, 216, "Inntekt, kommune, husstand og SFO kan fortsatt være personopplysninger selv uten direkte identifikatorer")


def references(c: canvas.Canvas, page_size, page_no: int) -> None:
    draw_header(c, page_size, "LENKER OG KILDER", page_no)
    draw_title(
        c,
        "Se demoen og grunnlaget",
        "PoC-en bruker syntetiske opplysninger og sandbox-tjenester. Ingen søknad sendes.",
        page_size,
    )
    width, height = page_size
    items = [
        ("Videodemo", "Demo-Team-Oslo.mp4", VIDEO_URL, PALE_CYAN),
        ("KS Digital", "Offisiell hackathonbeskrivelse", CHALLENGE_URL, PALE_GREEN),
        ("Workshop", "OpenAPI-filer og eksempler", WORKSHOP_URL, CREAM),
        ("AI-sikkerhet", "Microsoft Agent Framework FIDES", SECURITY_URL, PALE_CYAN),
    ]
    y = height - 145
    for label, caption, url, bg in items:
        c.setFillColor(bg)
        c.roundRect(48, y - 58, width - 96, 58, 5, stroke=0, fill=1)
        c.setFillColor(NAVY)
        c.setFont("OsloBold", 12)
        c.drawString(66, y - 24, label)
        c.setFillColor(MUTED)
        c.setFont("Oslo", 10)
        c.drawString(66, y - 42, caption)
        c.setFillColor(TEAL)
        c.setFont("OsloBold", 9)
        c.drawRightString(width - 66, y - 33, "ÅPNE LENKE  ↗")
        c.linkURL(url, (48, y - 58, width - 48, y), relative=0)
        y -= 75

    c.setFillColor(NAVY)
    c.roundRect(48, 50, width - 96, 76, 5, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("OsloBold", 12)
    c.drawString(66, 101, "Diskusjon")
    draw_wrapped(
        c,
        "Kan dette være et nyttig utgangspunkt når vi skal velge case og retning for hackathonet? Innspill til innbyggerreisen, avgrensningen og human-in-the-loop er spesielt nyttige.",
        66,
        81,
        width - 132,
        size=10,
        leading=13,
        color=white,
    )


def main() -> None:
    register_fonts()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=landscape(A4), pageCompression=1)
    c.setTitle("Søk én gang - PoC - Team Oslo")
    c.setAuthor("Team Oslo")
    c.setSubject("PoC for en dialogbasert innbyggerreise")

    pages = [
        (landscape(A4), lambda page_no: cover(c, landscape(A4), page_no)),
        (landscape(A4), lambda page_no: journey(c, landscape(A4), page_no)),
        (
            landscape(A4),
            lambda page_no: screenshot_page(
                c,
                landscape(A4),
                page_no,
                "Start med behovet, ikke et skjema",
                "Innbyggeren beskriver situasjonen med egne ord. Agenten finner relevant tjeneste og neste steg.",
                ROOT / "assets" / "screenshots" / "pdf-actual" / "01-start.png",
            ),
        ),
        (
            landscape(A4),
            lambda page_no: screenshot_page(
                c,
                landscape(A4),
                page_no,
                "Agentarbeidet er synlig",
                "Innbyggeren ser hvilken oppgave som pågår og kan åpne aktivitetene uten å forlate samtalen.",
                ROOT / "assets" / "screenshots" / "pdf-actual" / "02-agentarbeid.png",
            ),
        ),
        (
            landscape(A4),
            lambda page_no: screenshot_page(
                c,
                landscape(A4),
                page_no,
                "Samtykke når persondata blir relevant",
                "Tjenesten forklarer hvilke syntetiske personopplysninger som hentes og hvorfor. Innbyggeren velger selv.",
                ROOT / "assets" / "screenshots" / "pdf-actual" / "04-samtykke-closeup.png",
            ),
        ),
        (
            landscape(A4),
            lambda page_no: screenshot_page(
                c,
                landscape(A4),
                page_no,
                "Et svar med grunnlag",
                "KS-sandboxen leverer data og regelresultat. AI-modellen forklarer, mens kilden følger svaret.",
                ROOT / "assets" / "screenshots" / "pdf-actual" / "05-ks-hentet.png",
            ),
        ),
        (
            landscape(A4),
            lambda page_no: screenshot_page(
                c,
                landscape(A4),
                page_no,
                "Kilder og referanser samlet på ett sted",
                "Innbyggeren kan se hvilke kilder agentene faktisk brukte og åpne grunnlaget bak svaret.",
                ROOT / "assets" / "screenshots" / "pdf-actual" / "06-kilder.png",
            ),
        ),
        (
            landscape(A4),
            lambda page_no: screenshot_page(
                c,
                landscape(A4),
                page_no,
                "Tavlen viser det som gjenstår",
                "Fakta, avvik og oppgaver samles i en kompakt plan. Punkter som krever menneskelig kontroll er tydelig merket.",
                ROOT / "assets" / "screenshots" / "pdf-actual" / "07-tavle.png",
            ),
        ),
        (landscape(A4), lambda page_no: tech_stack(c, landscape(A4), page_no)),
        (landscape(A4), lambda page_no: ai_security(c, landscape(A4), page_no)),
        (landscape(A4), lambda page_no: ks_data_privacy(c, landscape(A4), page_no)),
        (
            landscape(A4),
            lambda page_no: diagram_page(
                c,
                landscape(A4),
                page_no,
                "Systemarkitektur",
                "AI-modellen forstår og forklarer. Koordinator, spesialistagenter, regler og samtykke styrer prosessen.",
                ROOT / "public" / "diagrams" / "agentic-architecture.png",
            ),
        ),
        (
            A4,
            lambda page_no: diagram_page(
                c,
                A4,
                page_no,
                "Arbeidsflyt",
                "Fra åpent spørsmål til relevant datahenting, avklaring, vurdering og neste steg.",
                ROOT / "public" / "diagrams" / "agentic-workflow.png",
            ),
        ),
        (
            landscape(A4),
            lambda page_no: diagram_page(
                c,
                landscape(A4),
                page_no,
                "Sekvens",
                "Samspillet mellom innbyggeren, agentene, samtykke, KS-sandboxen, regelmotoren og menneskelig vurdering.",
                ROOT / "public" / "diagrams" / "agentic-sequence.png",
            ),
        ),
        (
            landscape(A4),
            lambda page_no: diagram_page(
                c,
                landscape(A4),
                page_no,
                "Dataflyt",
                "Kilder og proveniens følger opplysningene gjennom hele reisen, slik at svar og vurderinger kan etterprøves.",
                ROOT / "public" / "diagrams" / "agentic-data-flow.png",
            ),
        ),
        (
            landscape(A4),
            lambda page_no: diagram_page(
                c,
                landscape(A4),
                page_no,
                "Livsløp",
                "Saken går fra behov til samtykke, datagrunnlag, vurdering og kontrollert oppfølging over tid.",
                ROOT / "public" / "diagrams" / "agentic-lifecycle.png",
            ),
        ),
        (landscape(A4), lambda page_no: references(c, landscape(A4), page_no)),
    ]

    for index, (page_size, draw_page) in enumerate(pages, start=1):
        c.setPageSize(page_size)
        draw_page(index)
        c.showPage()

    c.save()
    print(OUTPUT)


if __name__ == "__main__":
    main()
