"""Searching Richard's resume and project write-ups."""

from __future__ import annotations

import asyncio

from agents.tools import _filtered_search, build_keyword_filter

COLLECTIONS = {"resume": "richard-resume", "projects": "richard-projects"}


async def search(query: str, source: str) -> str:
    chosen = COLLECTIONS if source == "all" else {source: COLLECTIONS[source]}
    results = await asyncio.gather(
        *(
            _filtered_search(collection, query, build_keyword_filter(query, collection_type=kind))
            for kind, collection in chosen.items()
        ),
        return_exceptions=True,
    )
    return "\n\n".join(
        f"## {kind}\n"
        + (
            f"(search failed: {text})"
            if isinstance(text, BaseException)
            else text or "(no matches)"
        )
        for kind, text in zip(chosen, results, strict=True)
    )
