"""Perplexity-style research: plan queries, search in parallel, read the best pages, rank passages.

`gather` returns an evidence pack of numbered sources and passages that the
assistant writes its cited answer from, so the answer streams to the user.
`report` (deep mode) also writes the answer itself, for background jobs.
"""

from __future__ import annotations

import asyncio
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any, Literal
from urllib.parse import urlparse

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel, Field

from agents.assistant import web
from agents.utils import internal_llm_config
from core import get_model, settings
from jobs import report_progress

Depth = Literal["quick", "deep"]

LIMITS: dict[str, dict[str, int]] = {
    # queries planned, results per query, pages read, passages kept, passages per source
    "quick": {"queries": 3, "results": 5, "pages": 4, "passages": 12, "per_source": 4},
    "deep": {"queries": 6, "results": 6, "pages": 10, "passages": 30, "per_source": 5},
}
PASSAGE_CHARS = 900
_WORD = re.compile(r"[a-z0-9]{3,}")
_STOP = set(
    "the and for with that this from what which when where who how are was were has have had "
    "not but you your its their about into over than then them they will would can could should "
    "does did doing also more most such only other some any all each many much very just".split()
)


class Plan(BaseModel):
    queries: list[str] = Field(description="Distinct web search queries, most important first.")
    news: bool = Field(description="True when the question is about recent events or news.")


@dataclass
class Source:
    url: str
    title: str
    snippet: str
    published: str | None = None
    score: float = 0.0
    hits: int = 0
    text: str = ""
    passages: list[tuple[float, str]] = field(default_factory=list)


def _model(config: RunnableConfig | None) -> Any:
    name = ((config or {}).get("configurable") or {}).get("model") or settings.DEFAULT_MODEL
    return get_model(name)


async def plan(question: str, depth: Depth, config: RunnableConfig | None) -> Plan:
    n = LIMITS[depth]["queries"]
    prompt = (
        f"Today is {datetime.now():%B %d, %Y}. Break the question into at most {n} web search "
        "queries that together cover it: the core question first, then distinct angles "
        "(definitions, recent developments, comparisons, numbers, primary sources). "
        "Keep each query short and specific. Don't repeat the same query reworded."
    )
    try:
        planner = _model(config).with_structured_output(Plan)
        result = await planner.ainvoke(
            [SystemMessage(content=prompt), HumanMessage(content=question)],
            internal_llm_config(config or {}),
        )
        if isinstance(result, Plan) and result.queries:
            queries = list(dict.fromkeys(q.strip() for q in result.queries if q.strip()))
            return Plan(queries=[question, *queries][: n + 1], news=result.news)
    except Exception:
        pass
    return Plan(queries=[question], news=False)


def _terms(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower()) if w not in _STOP]


_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_BARE_URL = re.compile(r"https?://\S+")


def _clean(text: str) -> str:
    """Page markdown without images, link targets or bare URLs, which only add noise."""
    return _BARE_URL.sub("", _LINK.sub(r"\1", _IMAGE.sub("", text)))


def _chunks(text: str) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n\s*\n", _clean(text)) if len(p.strip()) > 80]
    out: list[str] = []
    buf = ""
    for p in paras:
        if buf and len(buf) + len(p) > PASSAGE_CHARS:
            out.append(buf)
            buf = ""
        buf = f"{buf}\n\n{p}" if buf else p
        while len(buf) > PASSAGE_CHARS * 1.5:
            out.append(buf[:PASSAGE_CHARS])
            buf = buf[PASSAGE_CHARS:]
    if buf:
        out.append(buf)
    return out


def rank_passages(sources: list[Source], queries: list[str], keep: int, per_source: int) -> None:
    """Scores each source's passages with BM25 against the queries and keeps the best."""
    query_terms = Counter(t for q in queries for t in _terms(q))
    docs = [(s, c, _terms(c)) for s in sources for c in _chunks(s.text or s.snippet)]
    if not docs or not query_terms:
        return
    avg = sum(len(d[2]) for d in docs) / len(docs) or 1
    df = Counter(t for _, _, terms in docs for t in set(terms))
    scored: list[tuple[float, Source, str]] = []
    for source, chunk, terms in docs:
        tf = Counter(terms)
        score = 0.0
        for term, weight in query_terms.items():
            if not tf[term]:
                continue
            idf = math.log(1 + (len(docs) - df[term] + 0.5) / (df[term] + 0.5))
            score += (
                weight * idf * tf[term] * 2.2 / (tf[term] + 1.2 * (0.25 + 0.75 * len(terms) / avg))
            )
        scored.append((score * (1 + 0.1 * source.hits), source, chunk))
    scored.sort(key=lambda x: x[0], reverse=True)
    taken: Counter[str] = Counter()
    for score, source, chunk in scored:
        if score <= 0 or sum(taken.values()) >= keep:
            break
        if taken[source.url] >= per_source:
            continue
        taken[source.url] += 1
        source.passages.append((score, chunk))


async def gather(
    question: str, depth: Depth, config: RunnableConfig | None
) -> tuple[Plan, list[Source]]:
    limits = LIMITS[depth]
    await report_progress(config, "Planning searches")
    the_plan = await plan(question, depth, config)
    await report_progress(config, f"Searching {len(the_plan.queries)} angles")
    results = await asyncio.gather(
        *(
            web.search(
                q,
                max_results=limits["results"],
                topic="news" if the_plan.news else "general",
                depth="advanced" if depth == "deep" else "basic",
            )
            for q in the_plan.queries
        ),
        return_exceptions=True,
    )
    by_url: dict[str, Source] = {}
    for hits in results:
        if isinstance(hits, BaseException):
            continue
        for rank, hit in enumerate(hits):
            src = by_url.setdefault(
                hit.url,
                Source(url=hit.url, title=hit.title, snippet=hit.content, published=hit.published),
            )
            src.hits += 1
            src.score += (hit.score or 0.5) + 1 / (rank + 2)
    if not by_url:
        errors = [str(r) for r in results if isinstance(r, BaseException)]
        raise web.WebError(errors[0] if errors else f"No results for {question!r}.")
    # Prefer pages several queries agreed on, and at most two pages per site.
    ranked = sorted(by_url.values(), key=lambda s: s.score, reverse=True)
    per_site: Counter[str] = Counter()
    chosen: list[Source] = []
    for s in ranked:
        site = urlparse(s.url).netloc
        if per_site[site] >= 2:
            continue
        per_site[site] += 1
        chosen.append(s)
    to_read = chosen[: limits["pages"]]
    await report_progress(config, f"Reading {len(to_read)} pages")
    try:
        pages = await web.extract([s.url for s in to_read])
    except Exception:
        pages = {}
    for s in to_read:
        s.text = pages.get(s.url, "")
    sources = chosen[: max(limits["pages"] + 2, 6)]
    rank_passages(sources, the_plan.queries, limits["passages"], limits["per_source"])
    used = [s for s in sources if s.passages] or sources[: limits["pages"]]
    return the_plan, used


def _date(published: str) -> str:
    """ISO day from Tavily's ISO or RFC 2822 dates."""
    try:
        return parsedate_to_datetime(published).date().isoformat()
    except (TypeError, ValueError):
        return published[:10]


def evidence(question: str, the_plan: Plan, sources: list[Source]) -> str:
    lines = [
        f"# Research: {question}",
        "Searched: " + "; ".join(f"`{q}`" for q in the_plan.queries),
        "",
        "## Sources",
    ]
    for i, s in enumerate(sources, 1):
        date = f" ({_date(s.published)})" if s.published else ""
        lines.append(f"[{i}] {s.title}{date} <{s.url}>")
    lines += ["", "## Passages"]
    for i, s in enumerate(sources, 1):
        body = [p for _, p in s.passages] or [s.snippet]
        for p in body:
            lines.append(f"[{i}] {' '.join(p.split())}")
            lines.append("")
    body = web.clip("\n".join(lines), 22_000)
    cite = ", ".join(f"[{i}]({s.url})" for i, s in enumerate(sources[:2], 1))
    return (
        f"{body}\n\n## How to cite\nCite each claim with a separate markdown link per source "
        f"right after it, e.g. {cite}. Never write bare [1] or [1, 2]. End with a numbered "
        '"Sources" list of `[title](url)` links, one per line, then 2-3 follow-up questions.'
    )


WRITER = """\
You write research answers like a careful analyst. Today is {date}.
Using only the numbered passages below, answer the question.
- Start with a direct two- or three-sentence answer, then the details in short sections or lists.
- Cite every factual claim with its source number as a markdown link right after it, like [1](url).
- When sources disagree, say so and cite both. If the passages don't answer something, say that.
- End with a "Sources" list ("1. [title](url)") of the sources you cited, then "Follow-up questions"
  with three short questions the reader might ask next.
"""


async def report(question: str, depth: Depth, config: RunnableConfig | None) -> str:
    the_plan, sources = await gather(question, depth, config)
    urls = "\n".join(f"[{i}] {s.url}" for i, s in enumerate(sources, 1))
    await report_progress(config, f"Writing the report from {len(sources)} sources")
    msg = await _model(config).ainvoke(
        [
            SystemMessage(content=WRITER.format(date=f"{datetime.now():%B %d, %Y}")),
            HumanMessage(
                content=f"{evidence(question, the_plan, sources)}\n\nURLs:\n{urls}\n\nQuestion: {question}"
            ),
        ],
        internal_llm_config(config or {}),
    )
    content = msg.content
    return (
        content
        if isinstance(content, str)
        else "".join(
            part.get("text", "") if isinstance(part, dict) else str(part) for part in content
        )
    )
