"""Workflow entry points of the papers skill."""

from __future__ import annotations

from typing import Any

from langchain_core.runnables import RunnableConfig

from jobs import report_progress
from skills.papers import podcast as podcast_module
from skills.papers import sources, topic

READ_CHARS = 20_000


async def search(query: str, limit: int = 8, sort: str = "relevance") -> str:
    papers = await sources.search(query, limit, sort)
    if not papers:
        return f"No arXiv papers match {query!r}."
    lines = [
        f"arXiv papers for {query!r} ({'newest first' if sort == 'newest' else 'most relevant first'}):"
    ]
    for p in papers:
        abstract = p.abstract if len(p.abstract) <= 400 else p.abstract[:400] + "…"
        lines.append(f"- **{p.title}** ({p.byline()}) arXiv:{p.arxiv_id} <{p.url}>\n  {abstract}")
    return "\n".join(lines)


async def read(paper: str) -> str:
    p = await sources.fetch(paper)
    body = (
        p.text
        if len(p.text) <= READ_CHARS
        else p.text[:READ_CHARS] + f"\n\n… (cut at {READ_CHARS} characters)"
    )
    head = f"# {p.title}\n{p.byline()}\n<{p.url}>\n"
    if p.abstract:
        head += f"\nAbstract: {p.abstract}\n"
    return f"{head}\n## Text\n{body}"


async def podcast(
    subject: str,
    papers: int = 4,
    length: str = "standard",
    focus: str | None = None,
    web: bool = True,
    ctx: RunnableConfig | None = None,
) -> dict[str, Any]:
    """One paper's episode for an arXiv id or a link; otherwise a topic episode from several."""
    subject = subject.strip()
    if sources.arxiv_id(subject) or subject.startswith(("http://", "https://")):
        await report_progress(ctx, "Reading the paper…")
        p = await sources.fetch(subject)
        return await podcast_module.make(p, length, focus, ctx)  # type: ignore[arg-type]
    return await topic.make(subject, papers, length, focus, web, ctx)  # type: ignore[arg-type]
