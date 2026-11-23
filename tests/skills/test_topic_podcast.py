from typing import Any

import pytest

from skills.papers import topic, workflows
from skills.papers.sources import Paper

pytestmark = pytest.mark.asyncio


def paper(aid: str, title: str = "") -> Paper:
    return Paper(title=title or f"Paper {aid}", url=f"https://arxiv.org/abs/{aid}", arxiv_id=aid)


async def test_candidates_merge_searches_and_rank_shared_hits_first(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    results = {
        "a": [paper("1.1v1"), paper("2.2")],
        "b": [paper("3.3"), paper("1.1v2")],
        "c": RuntimeError("arXiv is down"),
    }

    async def search(query: str, limit: int = 8, sort: str = "relevance") -> list[Paper]:
        hits = results[query]
        if isinstance(hits, Exception):
            raise hits
        return hits

    async def find_title(title: str) -> Paper | None:
        return paper("9.9", title) if title == "The Founding Paper" else None

    monkeypatch.setattr(topic.sources, "search", search)
    monkeypatch.setattr(topic.sources, "find_title", find_title)
    found, marked = await topic.candidates(["a", "b", "c"])
    # 1.1 was found by two searches (as v1 and v2), so it leads and appears once.
    assert [p.arxiv_id for p in found] == ["1.1v1", "3.3", "2.2"]
    # Landmark papers found by title come first, whatever the keyword searches found.
    found, marked = await topic.candidates(["a", "b"], ["The Founding Paper", "Made Up"])
    assert [p.arxiv_id for p in found] == ["9.9", "1.1v1", "3.3", "2.2"]
    assert marked == {"9.9"}


async def test_pick_fills_up_when_the_model_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(ctx: Any) -> Any:
        raise RuntimeError("no model")

    monkeypatch.setattr(topic, "_model", broken)
    found = [paper(f"{i}.0") for i in range(6)]
    assert await topic.pick("x", found, 3, None) == found[:3]
    assert await topic.pick("x", found[:2], 3, None) == found[:2]


@pytest.mark.parametrize(
    ("subject", "single"),
    [
        ("1706.03762", True),
        ("https://arxiv.org/abs/1706.03762", True),
        ("https://example.com/paper.pdf", True),
        ("speculative decoding for LLMs", False),
    ],
)
async def test_podcast_covers_one_paper_or_a_topic(
    monkeypatch: pytest.MonkeyPatch, subject: str, single: bool
) -> None:
    calls: list[str] = []

    async def fetch(ref: str) -> Paper:
        return paper("1706.03762")

    async def one(p: Paper, *args: Any) -> dict[str, Any]:
        calls.append("paper")
        return {}

    async def many(t: str, n: int, *args: Any) -> dict[str, Any]:
        calls.append(f"topic:{t}:{n}")
        return {}

    monkeypatch.setattr(workflows.sources, "fetch", fetch)
    monkeypatch.setattr(workflows.podcast_module, "make", one)
    monkeypatch.setattr(workflows.topic, "make", many)
    await workflows.podcast(subject, papers=5)
    assert calls == (["paper"] if single else [f"topic:{subject}:5"])
