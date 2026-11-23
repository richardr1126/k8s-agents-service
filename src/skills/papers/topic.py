"""A podcast episode about a research topic, drawn from several papers and the web.

1. Plan a few short arXiv searches for the topic and run them at once.
2. Merge the hits and let the model pick the papers that best cover the topic together.
3. Read each chosen paper's full text and boil it down to notes for this topic, in parallel,
   so the script writer sees every paper without holding all their full texts at once.
4. Optionally add web passages (the research skill's search) for context beyond the papers.
5. Check the picks cover the topic; once, search again for what's missing.
6. Write one two-host script from the notes and record it like a single-paper episode.

The steps run as a LangGraph graph (`EPISODE`), checkpointed per job so a restart resumes it.
"""

from __future__ import annotations

import asyncio
import operator
import re
from dataclasses import asdict
from typing import Annotated, Any, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send
from pydantic import BaseModel, Field

from agents.utils import internal_llm_config
from jobs import report_progress
from jobs.graphs import run_graph
from skills.papers import podcast, sources
from skills.papers.sources import Paper, PaperError

SEARCHES = 4
HITS_PER_SEARCH = 8
CANDIDATES = 16
NOTES_INPUT_CHARS = 60_000
WEB_CHARS = 8_000


class Searches(BaseModel):
    queries: list[str] = Field(
        description="Short arXiv searches (2-5 words each) that together cover the topic"
    )
    landmarks: list[str] = Field(
        default_factory=list,
        description="Exact titles of the topic's founding or most influential papers on arXiv",
    )


class Pick(BaseModel):
    ids: list[str] = Field(description="arXiv ids of the chosen papers, most central first")


PLANNER = """\
Plan arXiv searches for a podcast episode about a research topic. arXiv matches every word of a
search, so keep each one to two to five distinctive words: the topic's core terms, then distinct angles
(the founding idea, main methods, recent work, surveys). At most {n} searches, no rewordings.

Keyword search often misses the papers that started a field, so also list the exact titles of up to
{n} landmark papers on the topic that you are sure are on arXiv: the founding work and the most
influential follow-ups. Leave the list empty rather than guess a title."""

PICKER = """\
Choose {n} papers for a podcast episode about the topic below, from the arXiv results listed. Pick
papers that are truly about the topic and together cover it: a founding or survey paper when there is
one, the main approaches, and recent advances. Skip near-duplicates, off-topic hits, and tutorial or
workshop proposals. Papers marked [landmark] are well-known founding or influential works: include
the central ones. Answer with their arXiv ids exactly as listed."""

NOTES = """\
You take notes on one research paper for a podcast episode about: {topic}.
Write about 300 words of plain notes: the problem, the core idea in plain words, how it works, the key
results with the paper's real numbers, limitations, and how it bears on the topic. Use only the paper.{focus}"""

OUTLINE = """\
- Open with a hook: what the topic is and why it matters now.
- Tell the topic's story through the papers: where the idea came from, the main approaches and how they
  differ, the key results with real numbers, open problems and disagreements. Compare the papers;
  don't just summarize them one after another.
- Name each paper once, by its title or its lead author ("a team led by ..."), when it comes up.
- End with two or three takeaways and where the field seems to be heading."""


def _model(ctx: RunnableConfig | None) -> Any:
    return podcast._model(ctx)


def _base_id(paper: Paper) -> str:
    return re.sub(r"v\d+$", "", paper.arxiv_id or paper.url)


async def plan_searches(topic: str, ctx: RunnableConfig | None) -> tuple[list[str], list[str]]:
    """Keyword searches for the topic, and the titles of its landmark papers."""
    queries: list[str] = []
    landmarks: list[str] = []
    try:
        result = (
            await _model(ctx)
            .with_structured_output(Searches)
            .ainvoke(
                [SystemMessage(content=PLANNER.format(n=SEARCHES)), HumanMessage(content=topic)],
                internal_llm_config(ctx or {}),
            )
        )
        if isinstance(result, Searches):
            queries = [q.strip() for q in result.queries if q.strip()]
            landmarks = [t.strip() for t in result.landmarks if t.strip()]
    except Exception:
        pass
    return list(dict.fromkeys([*queries[:SEARCHES], topic])), landmarks[:SEARCHES]


async def candidates(
    queries: list[str], landmarks: list[str] | None = None
) -> tuple[list[Paper], set[str]]:
    """Every search's hits, merged by reciprocal rank so papers several searches found come
    first, after the landmark papers found by title; also the landmarks' ids."""
    results, titled = await asyncio.gather(
        asyncio.gather(
            *(sources.search(q, HITS_PER_SEARCH) for q in queries), return_exceptions=True
        ),
        asyncio.gather(*(sources.find_title(t) for t in landmarks or []), return_exceptions=True),
    )
    papers: dict[str, Paper] = {}
    marked: set[str] = set()
    for found in titled:
        if isinstance(found, Paper):
            key = _base_id(found)
            papers.setdefault(key, found)
            marked.add(key)
    scores: dict[str, float] = {}
    for hits in results:
        if isinstance(hits, BaseException):
            continue
        for rank, paper in enumerate(hits):
            key = _base_id(paper)
            papers.setdefault(key, paper)
            scores[key] = scores.get(key, 0.0) + 1 / (rank + 3)
    ranked = sorted(papers, key=lambda k: (k in marked, scores.get(k, 0.0)), reverse=True)
    return [papers[k] for k in ranked[:CANDIDATES]], marked


async def pick(
    topic: str,
    found: list[Paper],
    n: int,
    ctx: RunnableConfig | None,
    landmarks: set[str] | None = None,
) -> list[Paper]:
    if len(found) <= n:
        return found
    listing = "\n\n".join(
        f"[{_base_id(p)}]{' [landmark]' if _base_id(p) in (landmarks or set()) else ''} {p.title}"
        f" ({p.published[:4]})\n{p.abstract[:600]}"
        for p in found
    )
    by_id = {_base_id(p): p for p in found}
    try:
        result = (
            await _model(ctx)
            .with_structured_output(Pick)
            .ainvoke(
                [
                    SystemMessage(content=PICKER.format(n=n)),
                    HumanMessage(content=f"Topic: {topic}\n\nResults:\n\n{listing}"),
                ],
                internal_llm_config(ctx or {}),
            )
        )
        chosen = [by_id[i] for i in dict.fromkeys(getattr(result, "ids", None) or []) if i in by_id]
    except Exception:
        chosen = []
    # Fill up from the merged ranking if the model chose too few or invalid ids.
    for p in found:
        if len(chosen) >= n:
            break
        if p not in chosen:
            chosen.append(p)
    return chosen[:n]


async def _read(paper: Paper) -> Paper:
    """The paper with its full text; on failure, the search result (abstract only)."""
    try:
        return await sources.fetch(paper.arxiv_id or paper.url)
    except Exception:
        return paper


async def notes(topic: str, paper: Paper, focus: str | None, ctx: RunnableConfig | None) -> str:
    head = f"{paper.title}\n{paper.byline()}\n{paper.url}"
    if not paper.text:
        return f"{head}\n(Only the abstract could be read.)\nAbstract: {paper.abstract}"
    system = NOTES.format(topic=topic, focus=f" Give extra attention to: {focus}." if focus else "")
    try:
        msg = await _model(ctx).ainvoke(
            [
                SystemMessage(content=system),
                HumanMessage(content=podcast.paper_material(paper)[:NOTES_INPUT_CHARS]),
            ],
            internal_llm_config(ctx or {}),
        )
        text = (
            msg.content
            if isinstance(msg.content, str)
            else "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in msg.content)
        )
    except Exception:
        text = ""
    return f"{head}\n{text.strip() or 'Abstract: ' + paper.abstract}"


async def web_context(topic: str, ctx: RunnableConfig | None) -> str:
    """Web passages on the topic from the research skill's quick search; empty if it fails."""
    from skills.research.pipeline import gather

    # Without the job's progress callback, so its steps don't overwrite the episode's.
    configurable = {
        k: v for k, v in ((ctx or {}).get("configurable") or {}).items() if k != "job_progress"
    }
    quiet: RunnableConfig = {**(ctx or {}), "configurable": configurable}
    try:
        _, found = await gather(topic, "quick", quiet)
    except Exception:
        return ""
    parts = [
        f"{s.title} ({s.url})\n" + "\n".join(" ".join(p.split()) for _, p in s.passages[:2])
        for s in found
        if s.passages
    ]
    return "\n\n".join(parts)[:WEB_CHARS]


# The episode as a graph: each node's output is checkpointed, so a job cut off by a restart
# resumes where it stopped, and the coverage check can send it back to search for more.
#
#   plan -> find -> pick -> check --(gaps, first time only)--> find
#                             \--> note (one per paper, in parallel) + web --> write -> record


def _plain(paper: Paper) -> dict[str, Any]:
    """A paper for the graph's state: without its full text, which notes read themselves."""
    return {**asdict(paper), "text": ""}


def _paper(data: dict[str, Any]) -> Paper:
    return Paper(**data)


class Episode(TypedDict, total=False):
    topic: str
    papers: int
    length: str
    focus: str | None
    web: bool
    queries: list[str]
    landmarks: list[str]
    rounds: int
    found: list[dict[str, Any]]
    marked: list[str]
    chosen: list[dict[str, Any]]
    # (published date, notes), one per paper, gathered from the parallel note tasks.
    notes: Annotated[list[tuple[str, str]], operator.add]
    web_text: str
    script: dict[str, Any]
    result: dict[str, Any]


class Coverage(BaseModel):
    covered: bool = Field(description="True if these papers together cover the topic well")
    searches: list[str] = Field(
        default_factory=list,
        description="If not: short arXiv searches (2-5 words) for what's missing",
    )


CHECK = """These papers were chosen for a podcast episode about the topic below. Do they cover it together: the
founding idea, the main approaches, and recent work? If an important part is missing, give up to
{n} short arXiv searches (two to five words) that would find it. If they cover it, say so."""


async def _plan(state: Episode, config: RunnableConfig) -> Episode:
    await report_progress(config, "Planning arXiv searches…")
    queries, landmarks = await plan_searches(state["topic"], config)
    return {"queries": queries, "landmarks": landmarks, "rounds": 0}


async def _find(state: Episode, config: RunnableConfig) -> Episode:
    queries, landmarks = state.get("queries") or [], state.get("landmarks") or []
    await report_progress(config, f"Searching arXiv ({len(queries) + len(landmarks)} searches)…")
    found, marked = await candidates(queries, landmarks)
    # Later rounds add to what earlier rounds found.
    known = {_base_id(_paper(p)): p for p in state.get("found") or []}
    for p in found:
        known.setdefault(_base_id(p), _plain(p))
    if not known:
        raise PaperError(f"arXiv has no papers on {state['topic']!r}; try other words.")
    return {
        "found": list(known.values()),
        "marked": sorted({*(state.get("marked") or []), *marked}),
        "rounds": (state.get("rounds") or 0) + 1,
    }


async def _pick(state: Episode, config: RunnableConfig) -> Episode:
    found = [_paper(p) for p in state["found"]]
    n = state["papers"]
    await report_progress(config, f"Choosing {min(n, len(found))} of {len(found)} papers…")
    chosen = await pick(state["topic"], found, n, config, set(state.get("marked") or []))
    return {"chosen": [_plain(p) for p in chosen]}


async def _check(state: Episode, config: RunnableConfig) -> Episode:
    """Looks for gaps once; a second search round only adds what's missing."""
    if (state.get("rounds") or 0) >= 2:
        return {"queries": []}
    listing = "\n".join(
        f"- {p['title']} ({p['published'][:4]}): {p['abstract'][:300]}" for p in state["chosen"]
    )
    await report_progress(config, "Checking the papers cover the topic…")
    try:
        result = (
            await _model(config)
            .with_structured_output(Coverage)
            .ainvoke(
                [
                    SystemMessage(content=CHECK.format(n=SEARCHES // 2)),
                    HumanMessage(content=f"Topic: {state['topic']}\n\nPapers:\n{listing}"),
                ],
                internal_llm_config(config),
            )
        )
    except Exception:
        return {"queries": []}
    if not isinstance(result, Coverage) or result.covered:
        return {"queries": []}
    more = [q.strip() for q in result.searches if q.strip()][: SEARCHES // 2]
    return {"queries": more, "landmarks": []}


def _after_check(state: Episode) -> list[Send] | str:
    if state.get("queries"):
        return "find"
    chosen = state["chosen"]
    sends = [
        Send("note", {"topic": state["topic"], "focus": state.get("focus"), "paper": p})
        for p in chosen
    ]
    if state.get("web"):
        sends.append(Send("web", {"topic": state["topic"]}))
    return sends


class NoteTask(TypedDict):
    topic: str
    focus: str | None
    paper: dict[str, Any]


async def _note(task: NoteTask, config: RunnableConfig) -> Episode:
    paper = await _read(_paper(task["paper"]))
    text = await notes(task["topic"], paper, task.get("focus"), config)
    return {"notes": [(paper.published, text)]}


async def _web(task: dict[str, Any], config: RunnableConfig) -> Episode:
    return {"web_text": await web_context(task["topic"], config)}


async def _write(state: Episode, config: RunnableConfig) -> Episode:
    topic = state["topic"]
    # Oldest first, so the script can tell the topic's story in order.
    ordered = [text for _, text in sorted(state.get("notes") or [])]
    material = f"Topic: {topic}\n\n" + "\n\n".join(
        f"## Paper {i}\n{n}" for i, n in enumerate(ordered, 1)
    )
    if state.get("web_text"):
        material += (
            f"\n\n## From the web (background only; the papers come first)\n{state['web_text']}"
        )
    cards = [_paper(p).card() for p in state["chosen"]]
    await report_progress(config, f"Writing a script about {topic}…", papers=cards)
    script = await podcast.write_script(
        material,
        state["length"],  # type: ignore[arg-type]
        state.get("focus"),
        config,
        subject=f"about a research topic, {topic}, drawing on {len(ordered)} papers",
        read="the papers",
        outline=OUTLINE,
    )
    return {"script": script.model_dump()}


async def _record(state: Episode, config: RunnableConfig) -> Episode:
    chosen = sorted((_paper(p) for p in state["chosen"]), key=lambda p: p.published)
    listing = "\n".join(
        f"- [{p.title}]({p.url}){' · ' + p.byline() if p.byline() else ''}" for p in chosen
    )
    result = await podcast.record(
        podcast.Script.model_validate(state["script"]),
        f"Papers discussed:\n{listing}\n\n",
        chosen,
        config,
    )
    return {"result": result}


def _graph() -> StateGraph:
    g = StateGraph(Episode)
    g.add_node("plan", _plan)
    g.add_node("find", _find)
    g.add_node("pick", _pick)
    g.add_node("check", _check)
    g.add_node("note", _note)  # type: ignore[arg-type]
    g.add_node("web", _web)  # type: ignore[arg-type]
    g.add_node("write", _write)
    g.add_node("record", _record)
    g.add_edge(START, "plan")
    g.add_edge("plan", "find")
    g.add_edge("find", "pick")
    g.add_edge("pick", "check")
    g.add_conditional_edges("check", _after_check, ["find", "note", "web"])
    g.add_edge("note", "write")
    g.add_edge("web", "write")
    g.add_edge("write", "record")
    g.add_edge("record", END)
    return g


EPISODE = _graph()


async def make(
    topic: str,
    papers: int,
    length: podcast.Length,
    focus: str | None,
    web: bool,
    ctx: RunnableConfig | None,
) -> dict[str, Any]:
    inputs: Episode = {
        "topic": topic,
        "papers": papers,
        "length": length,
        "focus": focus,
        "web": web,
    }
    state = await run_graph(EPISODE, dict(inputs), ctx)
    return state["result"]
