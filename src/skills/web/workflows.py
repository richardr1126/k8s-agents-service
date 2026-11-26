"""Web search and page reading, through Tavily (see agents.assistant.web)."""

from __future__ import annotations

from typing import Any

from agents.assistant import web


async def search(query: str, limit: int, news: bool, days: int | None) -> dict[str, Any]:
    try:
        hits = await web.search(
            query, max_results=limit, topic="news" if news else "general", days=days
        )
    except Exception as e:
        return {"text": f"Search failed: {e}", "data": {"sources": []}}
    if not hits:
        return {"text": f"No results for {query!r}.", "data": {"sources": []}}
    lines = [f"Results for {query!r}:"]
    for i, h in enumerate(hits, 1):
        date = f" ({h.published})" if h.published else ""
        lines.append(f"[{i}] {h.title}{date}\n{h.url}\n{web.clip(h.content, 800)}")
    sources = [{"title": h.title, "url": h.url} for h in hits]
    return {"text": "\n\n".join(lines), "data": {"sources": sources}}


async def read(url: str) -> dict[str, Any]:
    try:
        pages = await web.extract([url])
    except Exception as e:
        return {"text": f"Couldn't read {url}: {e}", "data": {"sources": []}}
    text = next(iter(pages.values()), "")
    if not text.strip():
        return {"text": f"Couldn't read {url}.", "data": {"sources": []}}
    return {"text": f"{url}\n\n{web.clip(text)}", "data": {"sources": [{"title": url, "url": url}]}}
