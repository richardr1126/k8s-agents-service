"""Finding papers on arXiv and reading their text."""

from __future__ import annotations

import asyncio
import io
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

import httpx
from pypdf import PdfReader

from agents.assistant import web

ARXIV_API = "https://export.arxiv.org/api/query"
_ATOM = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
# 2401.01234, 2401.01234v2, or old-style hep-th/9901001
_ARXIV_ID = re.compile(r"(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?)")
_ARXIV_URL = re.compile(r"arxiv\.org/(?:abs|pdf|html)/" + _ARXIV_ID.pattern)
MAX_PDF_BYTES = 30_000_000
MAX_TEXT = 120_000


class PaperError(RuntimeError):
    pass


@dataclass
class Paper:
    title: str
    url: str
    authors: list[str] = field(default_factory=list)
    published: str = ""
    abstract: str = ""
    arxiv_id: str | None = None
    pdf_url: str | None = None
    text: str = ""

    def byline(self) -> str:
        names = ", ".join(self.authors[:4]) + (" et al." if len(self.authors) > 4 else "")
        return " · ".join(p for p in (names, self.published[:10]) if p)

    def card(self) -> dict[str, object]:
        return {
            "title": self.title,
            "url": self.url,
            "authors": self.authors,
            "published": self.published,
        }


def arxiv_id(ref: str) -> str | None:
    """The arXiv id in an id or arxiv.org link, else None."""
    ref = ref.strip().removeprefix("arXiv:").removeprefix("arxiv:")
    if m := _ARXIV_URL.search(ref):
        return m[1].removesuffix(".pdf")
    if m := _ARXIV_ID.fullmatch(ref):
        return m[1]
    return None


def _text(node: ET.Element | None) -> str:
    return " ".join((node.text or "").split()) if node is not None else ""


def _entries(xml: str) -> list[Paper]:
    root = ET.fromstring(xml)
    papers = []
    for entry in root.findall("a:entry", _ATOM):
        abs_url = _text(entry.find("a:id", _ATOM))
        if "/abs/" not in abs_url:
            continue  # arXiv returns an error entry for bad ids
        pdf = next(
            (
                link.get("href")
                for link in entry.findall("a:link", _ATOM)
                if link.get("title") == "pdf"
            ),
            None,
        )
        papers.append(
            Paper(
                title=_text(entry.find("a:title", _ATOM)),
                url=abs_url.replace("http://", "https://"),
                authors=[_text(a.find("a:name", _ATOM)) for a in entry.findall("a:author", _ATOM)],
                published=_text(entry.find("a:published", _ATOM)),
                abstract=_text(entry.find("a:summary", _ATOM)),
                arxiv_id=arxiv_id(abs_url),
                pdf_url=(pdf or "").replace("http://", "https://") or None,
            )
        )
    return papers


async def _arxiv(params: dict[str, str | int]) -> list[Paper]:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        res = await client.get(ARXIV_API, params=params)
    if res.status_code >= 400:
        raise PaperError(f"arXiv search failed (HTTP {res.status_code}).")
    return _entries(res.text)


async def search(query: str, limit: int = 8, sort: str = "relevance") -> list[Paper]:
    terms = " AND ".join(f"all:{w}" for w in re.findall(r"[\w-]+", query)[:12])
    if not terms:
        raise PaperError("Give some words to search for.")
    return await _arxiv(
        {
            "search_query": terms,
            "max_results": min(limit, 25),
            "sortBy": "submittedDate" if sort == "newest" else "relevance",
        }
    )


def _pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    pages = [page.extract_text() or "" for page in reader.pages[:60]]
    text = "\n".join(pages)
    text = re.sub(r"-\n(?=[a-z])", "", text)  # words split across lines
    text = re.sub(r"[ \t]+", " ", text)
    # The reference list costs tokens and adds nothing to a summary or podcast.
    cut = max(
        text.rfind("\nReferences\n"), text.rfind("\nREFERENCES\n"), text.rfind("\nBibliography\n")
    )
    if cut > len(text) * 0.5:
        text = text[:cut]
    return text.strip()[:MAX_TEXT]


async def fetch(ref: str) -> Paper:
    """A paper with its full text, from an arXiv id or link, or any public PDF or page link."""
    if aid := arxiv_id(ref):
        found = await _arxiv({"id_list": aid, "max_results": 1})
        if not found:
            raise PaperError(f"arXiv has no paper {aid}.")
        paper = found[0]
        pdf = await web.public_get(
            paper.pdf_url or f"https://arxiv.org/pdf/{aid}", timeout=60, max_bytes=MAX_PDF_BYTES
        )
        paper.text = await asyncio.to_thread(_pdf_text, pdf.content)
        return paper

    if not ref.startswith(("http://", "https://")):
        raise PaperError("Give an arXiv id or link, or a link to the paper's PDF or page.")
    got = await web.public_get(ref, timeout=60, max_bytes=MAX_PDF_BYTES)
    if "pdf" in got.content_type or got.content[:5] == b"%PDF-":
        text = await asyncio.to_thread(_pdf_text, got.content)
        title = next((line.strip() for line in text.splitlines() if len(line.strip()) > 15), ref)
        return Paper(title=title[:200], url=ref, text=text)
    pages = await web.extract([got.url])
    text = pages.get(got.url) or next(iter(pages.values()), "")
    if not text:
        raise PaperError("Couldn't read that page.")
    title = next((line.lstrip("# ").strip() for line in text.splitlines() if line.strip()), ref)
    return Paper(title=title[:200], url=ref, text=text[:MAX_TEXT])
