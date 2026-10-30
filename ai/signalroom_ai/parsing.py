"""Turn raw documents into ordered sections: (heading, page, text).

- PDF: pypdf text per page; page numbers are 1-based. Headings are inferred from
  short title-like lines (PDFs carry no reliable heading structure).
- DOCX: python-docx paragraphs in body order; `Heading N`/`Title` styles become
  headings, tables are flattened row by row.
- Markdown / plain text: `#` headings.
- HTML (URL documents): readability main-content extraction, then h1-h4 headings.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass

from docx import Document as DocxDocument
from docx.table import Table
from docx.text.paragraph import Paragraph
from pypdf import PdfReader


class ParseError(ValueError):
    """The input cannot be parsed (corrupt file, empty text, unsupported type)."""


@dataclass
class Section:
    heading: str | None
    page: int | None
    text: str


def _clean(text: str) -> str:
    text = text.replace(" ", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _merge(sections: list[Section]) -> list[Section]:
    out: list[Section] = []
    for s in sections:
        text = _clean(s.text)
        if not text:
            continue
        prev = out[-1] if out else None
        # A heading's text split by a page break: glue a short orphan to its continuation.
        if prev and prev.heading == s.heading and len(prev.text) < 200:
            prev.text += "\n" + text
        else:
            out.append(Section(s.heading, s.page, text))
    if not out:
        raise ParseError("no extractable text")
    return out


# --- PDF -------------------------------------------------------------------

HEADING_SIZE_RATIO = 1.15  # a line set this much larger than body text is a heading


@dataclass
class _Line:
    text: str
    size: float


def _page_lines(page) -> list[_Line]:
    """Text lines of a page with the largest font size used on each line."""
    lines: list[_Line] = []
    cur: list[str] = []
    size = 0.0

    def visit(text, cm, tm, font_dict, font_size):
        nonlocal size
        scale = abs(tm[3] * cm[3]) or 1.0
        parts = text.split("\n")
        for i, part in enumerate(parts):
            if part.strip():
                cur.append(part)
                size = max(size, float(font_size) * scale)
            if i < len(parts) - 1:
                flush()

    def flush():
        nonlocal size
        line = "".join(cur).replace("\x7f", "").strip()
        if line:
            lines.append(_Line(line, size))
        cur.clear()
        size = 0.0

    page.extract_text(visitor_text=visit)
    flush()
    return lines


def _running_lines(pages: list[list[_Line]]) -> set[str]:
    """Headers/footers: lines (digits ignored) repeated on most pages of a multi-page PDF."""
    if len(pages) < 2:
        return set()
    seen: dict[str, int] = {}
    for lines in pages:
        for key in {re.sub(r"\d+", "#", ln.text) for ln in lines}:
            seen[key] = seen.get(key, 0) + 1
    return {k for k, n in seen.items() if n >= 2 and n >= 0.6 * len(pages)}


def _body_size(pages: list[list[_Line]]) -> float:
    weight: dict[float, int] = {}
    for lines in pages:
        for ln in lines:
            key = round(ln.size, 1)
            weight[key] = weight.get(key, 0) + len(ln.text)
    return max(weight, key=weight.get) if weight else 0.0


def parse_pdf(data: bytes) -> list[Section]:
    """Headings are lines set in a larger font than the document's body text."""
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [_page_lines(page) for page in reader.pages]
    except Exception as exc:  # pypdf raises many exception types for corrupt files
        raise ParseError(f"invalid PDF: {exc}") from exc
    running = _running_lines(pages)
    body = _body_size(pages)
    sections: list[Section] = []
    heading: str | None = None
    for page_no, lines in enumerate(pages, start=1):
        buf: list[str] = []
        for ln in lines:
            if re.sub(r"\d+", "#", ln.text) in running:
                continue
            if body and ln.size >= body * HEADING_SIZE_RATIO and len(ln.text) <= 120:
                if buf:
                    sections.append(Section(heading, page_no, "\n".join(buf)))
                    buf = []
                heading = ln.text
            else:
                buf.append(ln.text)
        if buf:
            sections.append(Section(heading, page_no, "\n".join(buf)))
    return _merge(sections)


# --- DOCX ------------------------------------------------------------------


def parse_docx(data: bytes) -> list[Section]:
    try:
        doc = DocxDocument(io.BytesIO(data))
    except Exception as exc:  # python-docx raises zipfile/KeyError/etc. on bad input
        raise ParseError(f"invalid DOCX: {exc}") from exc
    sections: list[Section] = []
    heading: str | None = None
    buf: list[str] = []

    def flush() -> None:
        if buf:
            sections.append(Section(heading, None, "\n".join(buf)))
            buf.clear()

    for block in doc.iter_inner_content():
        if isinstance(block, Paragraph):
            text = block.text.strip()
            if not text:
                continue
            style = (block.style.name if block.style is not None else "") or ""
            if style.startswith("Heading") or style == "Title":
                flush()
                heading = text
            else:
                buf.append(text)
        elif isinstance(block, Table):
            for row in block.rows:
                cells = [c.text.strip() for c in row.cells]
                # Merged cells repeat their text; drop consecutive duplicates.
                dedup = [c for i, c in enumerate(cells) if c and (i == 0 or c != cells[i - 1])]
                if dedup:
                    buf.append(" | ".join(dedup))
    flush()
    return _merge(sections)


# --- Markdown / text ---------------------------------------------------------

_MD_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


def parse_text(data: bytes | str) -> list[Section]:
    text = data.decode("utf-8", errors="replace") if isinstance(data, bytes) else data
    sections: list[Section] = []
    heading: str | None = None
    buf: list[str] = []
    for line in text.splitlines():
        m = _MD_HEADING.match(line.strip())
        if m:
            if buf:
                sections.append(Section(heading, None, "\n".join(buf)))
                buf = []
            heading = m.group(2).strip()
        else:
            buf.append(line)
    if buf:
        sections.append(Section(heading, None, "\n".join(buf)))
    return _merge(sections)


# --- HTML ------------------------------------------------------------------


def parse_html(data: bytes) -> tuple[str | None, list[Section]]:
    """Return (page title, sections) from the main content of an HTML page."""
    from lxml import html as lxml_html
    from readability import Document as Readability

    raw = data.decode("utf-8", errors="replace")
    try:
        article = Readability(raw)
        title = article.short_title() or None
        tree = lxml_html.fromstring(article.summary(html_partial=True))
    except Exception as exc:  # readability/lxml raise on empty or broken markup
        raise ParseError(f"invalid HTML: {exc}") from exc
    sections: list[Section] = []
    heading: str | None = None
    buf: list[str] = []
    for el in tree.iter("h1", "h2", "h3", "h4", "p", "li", "pre", "td", "th", "blockquote"):
        text = " ".join(el.text_content().split())
        if not text:
            continue
        if el.tag in ("h1", "h2", "h3", "h4"):
            if buf:
                sections.append(Section(heading, None, "\n".join(buf)))
                buf = []
            heading = text
        else:
            buf.append(text)
    if buf:
        sections.append(Section(heading, None, "\n".join(buf)))
    return title, _merge(sections)
