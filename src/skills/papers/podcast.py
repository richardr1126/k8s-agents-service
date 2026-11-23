"""A two-host podcast about a paper or a topic: a script from the sources, spoken line by line.

`make` covers one paper from its full text; `skills.papers.topic` gathers several
papers (and web pages) on a topic and hands their notes to `write_script` and `record`.

Speech comes from the user's OpenReader, which they connect in the chat UI
(Settings → Speech), one request per line, and the segments are joined into one MP3 kept with the job.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import asdict
from typing import Any, Literal, TypedDict

import httpx
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from agents.utils import internal_llm_config
from core import get_model, settings
from jobs import report_progress, save_job_file
from jobs.graphs import run_graph
from skills.papers import mp3
from skills.papers.sources import Paper, PaperError, fetch

Length = Literal["short", "standard", "long"]
WORDS: dict[str, int] = {"short": 700, "standard": 1500, "long": 2600}
MAX_LINE_CHARS = 1200
TTS_CONCURRENCY = 4


class Line(BaseModel):
    host: Literal[1, 2] = Field(
        description="1 = the host who read the paper closely, 2 = the curious co-host"
    )
    text: str = Field(description="What the host says, as natural speech")


class Script(BaseModel):
    title: str = Field(description="A short, specific episode title")
    summary: str = Field(description="Two sentences on what the episode covers")
    lines: list[Line]


WRITER = """\
You write the script of a two-host podcast episode {subject}, to be read aloud by text-to-speech voices.

Host 1 has read {read} closely and explains. Host 2 is sharp and curious: asks the questions a
listener would, pushes on weak spots, and connects ideas to things people know. Neither has a name.

{outline}
- Use only what the sources say. Don't invent results, numbers or quotes.
- Write for the ear: short sentences, everyday words, analogies. No markdown, lists, headings, emoji,
  URLs, citations, stage directions or sound effects.
- Spell out symbols, equations and abbreviations the way a person would say them ("O of n squared",
  "the BLEU score").
- Keep turns short (one to four sentences) and alternate often: about {turns} turns and {words} words in
  total. Don't stop early; a script much shorter than that is a failure.
{focus}"""

PAPER_OUTLINE = """\
- Open with a hook: the problem and why it matters, then name the paper and its authors once.
- Cover the motivation, the core idea in plain words, how it works, the key results with real numbers
  from the paper, the limitations, and why it matters. End with two or three takeaways."""


def _model(ctx: RunnableConfig | None) -> Any:
    name = ((ctx or {}).get("configurable") or {}).get("model") or settings.DEFAULT_MODEL
    return get_model(name)


async def write_script(
    material: str,
    length: Length,
    focus: str | None,
    ctx: RunnableConfig | None,
    *,
    subject: str = "about one research paper",
    read: str = "the paper",
    outline: str = PAPER_OUTLINE,
) -> Script:
    system = WRITER.format(
        subject=subject,
        read=read,
        outline=outline,
        words=WORDS[length],
        turns=WORDS[length] // 35,
        focus=f"\nThe listener asked for this emphasis: {focus}\n" if focus else "",
    )
    writer = _model(ctx).with_structured_output(Script)
    script = await writer.ainvoke(
        [SystemMessage(content=system), HumanMessage(content=material)],
        internal_llm_config(ctx or {}),
    )
    if not isinstance(script, Script) or len(script.lines) < 4:
        raise PaperError("Writing the script failed; try again.")
    return script


def paper_material(paper: Paper) -> str:
    head = f"Title: {paper.title}\nAuthors: {', '.join(paper.authors) or 'unknown'}\n"
    if paper.abstract:
        head += f"Abstract: {paper.abstract}\n"
    return f"{head}\nFull text:\n{paper.text}"


def _pieces(text: str) -> list[str]:
    """A line's text in pieces short enough for one TTS request, split at sentences."""
    text = " ".join(text.split())
    if len(text) <= MAX_LINE_CHARS:
        return [text] if text else []
    pieces, current = [], ""
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if current and len(current) + len(sentence) + 1 > MAX_LINE_CHARS:
            pieces.append(current)
            current = ""
        current = f"{current} {sentence}".strip()
    return [*pieces, current] if current else pieces


async def _speak(client: httpx.AsyncClient, text: str, host: int, user_id: str) -> bytes:
    """One piece spoken through the UI, which uses the user's connected OpenReader."""
    headers = {}
    if settings.AUTH_SECRET:
        headers["Authorization"] = f"Bearer {settings.AUTH_SECRET.get_secret_value()}"
    for attempt in range(3):
        res = await client.post(
            "/api/internal/tts",
            json={"text": text, "speaker": host - 1, "user_id": user_id},
            headers=headers,
        )
        if res.status_code == 200:
            return res.content
        if res.status_code not in (429, 500, 502, 503, 504) or attempt == 2:
            try:
                detail = res.json().get("error") or ""
            except ValueError:
                detail = ""
            raise PaperError(
                f"Speech failed (HTTP {res.status_code}){': ' + detail if detail else ''}"
            )
        await asyncio.sleep(2 * (attempt + 1))
    raise AssertionError("unreachable")


async def speak_script(script: Script, ctx: RunnableConfig | None) -> mp3.Frames:
    user_id = str(((ctx or {}).get("configurable") or {}).get("user_id") or "")
    if not user_id:
        raise PaperError("Podcasts need a signed-in user.")
    jobs = [(piece, line.host) for line in script.lines for piece in _pieces(line.text)]
    segments: list[bytes | None] = [None] * len(jobs)
    done = 0
    limit = asyncio.Semaphore(TTS_CONCURRENCY)

    async with httpx.AsyncClient(base_url=settings.UI_URL, timeout=120) as client:

        async def one(i: int, text: str, host: int) -> None:
            nonlocal done
            async with limit:
                segments[i] = await _speak(client, text, host, user_id)
            done += 1
            if done % 4 == 0 or done == len(jobs):
                await report_progress(ctx, f"Recording the episode ({done} of {len(jobs)} lines)…")

        await asyncio.gather(*(one(i, text, host) for i, (text, host) in enumerate(jobs)))
    return mp3.join([s for s in segments if s])


def _minutes(seconds: float) -> str:
    m, s = divmod(round(seconds), 60)
    return f"{m}:{s:02d}"


async def record(
    script: Script, about: str, papers: list[Paper], ctx: RunnableConfig | None
) -> dict[str, Any]:
    """Speaks the script, keeps the MP3 with the job and returns the job's result."""
    await report_progress(ctx, f"Recording the episode (0 of {len(script.lines)} lines)…")
    audio = await speak_script(script, ctx)
    if not audio.frames:
        raise PaperError("OpenReader returned no audio.")
    job_id = await save_job_file(ctx, "episode.mp3", "audio/mpeg", audio.data)
    words = sum(len(line.text.split()) for line in script.lines)
    text = f"**{script.title}**\n\n{script.summary}\n\n{about.rstrip()}\n\n{_minutes(audio.seconds)} long."
    return {
        "text": text,
        "data": {
            "paper": papers[0].card() if len(papers) == 1 else None,
            "papers": [p.card() for p in papers],
            "podcast": {
                "title": script.title,
                "audio": f"/api/jobs/{job_id}/files/episode.mp3",
                "seconds": round(audio.seconds, 1),
                "bytes": len(audio.data),
                "words": words,
                "script": [line.model_dump() for line in script.lines],
            },
        },
    }


class OnePaper(TypedDict, total=False):
    ref: str
    length: str
    focus: str | None
    paper: dict[str, Any]
    material: str
    script: dict[str, Any]
    result: dict[str, Any]


async def _read_paper(state: OnePaper, config: RunnableConfig) -> OnePaper:
    await report_progress(config, "Reading the paper…")
    paper = await fetch(state["ref"])
    return {"paper": {**asdict(paper), "text": ""}, "material": paper_material(paper)}


async def _write_paper(state: OnePaper, config: RunnableConfig) -> OnePaper:
    paper = Paper(**state["paper"])
    await report_progress(config, f"Writing a script about “{paper.title}”…", paper=paper.card())
    script = await write_script(state["material"], state["length"], state.get("focus"), config)  # type: ignore[arg-type]
    return {"script": script.model_dump()}


async def _record_paper(state: OnePaper, config: RunnableConfig) -> OnePaper:
    paper = Paper(**state["paper"])
    about = f"About [{paper.title}]({paper.url}){' by ' + paper.byline() if paper.authors else ''}."
    script = Script.model_validate(state["script"])
    return {"result": await record(script, about, [paper], config)}


def _one_paper_graph() -> StateGraph:
    g = StateGraph(OnePaper)
    g.add_node("read", _read_paper)
    g.add_node("write", _write_paper)
    g.add_node("record", _record_paper)
    g.add_edge(START, "read")
    g.add_edge("read", "write")
    g.add_edge("write", "record")
    g.add_edge("record", END)
    return g


ONE_PAPER = _one_paper_graph()


async def make(
    ref: str, length: Length, focus: str | None, ctx: RunnableConfig | None
) -> dict[str, Any]:
    """An episode about one paper, from its full text; checkpointed per job like topic episodes."""
    inputs: OnePaper = {"ref": ref, "length": length, "focus": focus}
    state = await run_graph(ONE_PAPER, dict(inputs), ctx)
    return state["result"]
