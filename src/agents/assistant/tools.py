"""The assistant's always-on tools. Skills add more through `run_workflow`."""

from __future__ import annotations

import asyncio
import json
from typing import Annotated, Any, Literal

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from agents.assistant import web
from agents.tools import _filtered_search, build_keyword_filter
from skills import call_workflow, get_registry


def is_subagent(config: RunnableConfig | None) -> bool:
    return bool(((config or {}).get("configurable") or {}).get("assistant_subagent"))


@tool(response_format="content_and_artifact")
async def web_search(
    query: Annotated[str, "What to search for. Specific beats broad."],
    max_results: Annotated[int, "How many results, 1-10."] = 5,
    topic: Annotated[Literal["general", "news"], "'news' for recent events."] = "general",
    days: Annotated[int | None, "With topic 'news': only results from the last N days."] = None,
) -> tuple[str, dict[str, Any]]:
    """Search the web. Returns numbered results with title, link, date and a snippet.

    Snippets are short: read a page with `fetch_page` when the snippet isn't enough.
    """
    try:
        hits = await web.search(
            query, max_results=max(1, min(max_results, 10)), topic=topic, days=days
        )
    except Exception as e:
        return f"Search failed: {e}", {"sources": []}
    if not hits:
        return f"No results for {query!r}.", {"sources": []}
    lines = [f"Results for {query!r}:"]
    for i, h in enumerate(hits, 1):
        date = f" ({h.published})" if h.published else ""
        lines.append(f"[{i}] {h.title}{date}\n{h.url}\n{web.clip(h.content, 800)}")
    return "\n\n".join(lines), {"sources": [{"title": h.title, "url": h.url} for h in hits]}


@tool(response_format="content_and_artifact")
async def fetch_page(
    url: Annotated[str, "The page's full http(s) URL."],
) -> tuple[str, dict[str, Any]]:
    """Read a web page as text (up to about 12,000 characters)."""
    try:
        pages = await web.extract([url])
    except Exception as e:
        return f"Couldn't read {url}: {e}", {"sources": []}
    text = next(iter(pages.values()), "")
    if not text.strip():
        return f"Couldn't read {url}.", {"sources": []}
    return f"{url}\n\n{web.clip(text)}", {"sources": [{"title": url, "url": url}]}


@tool
async def search_richard(
    query: Annotated[str, "One topic per query, e.g. 'work experience', 'kubernetes projects'."],
    source: Annotated[
        Literal["all", "resume", "projects"],
        "'resume' for work, education and skills; 'projects' for project write-ups and READMEs.",
    ] = "all",
) -> str:
    """Search Richard's resume and project write-ups. Each call returns a few matching passages."""
    targets = {"resume": "richard-resume", "projects": "richard-projects"}
    chosen = targets if source == "all" else {source: targets[source]}
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


@tool
def list_skills() -> str:
    """List every skill with its description and workflows."""
    return get_registry().index()


@tool
def read_skill(
    name: Annotated[str, "The skill's name, e.g. 'github'."], config: RunnableConfig
) -> str:
    """Read a skill's instructions and the arguments of its workflows."""
    registry = get_registry()
    skill = registry.skills.get(name.strip())
    if skill is None:
        return f"No skill named {name!r}. Skills: {', '.join(registry.skills) or 'none'}."
    return skill.doc(include_background=not is_subagent(config))


@tool
async def run_workflow(
    workflow: Annotated[str, "The workflow id, '<skill>.<workflow>', e.g. 'github.readme'."],
    config: RunnableConfig,
    arguments: Annotated[
        dict[str, Any] | None, "The workflow's arguments, as named in its skill doc."
    ] = None,
) -> str:
    """Run a skill's workflow. Read the skill first to learn its workflows' arguments."""
    from agents.assistant.jobs import start_job  # jobs import the agent's tools

    registry = get_registry()
    wf = registry.workflows.get(workflow.strip())
    if wf is None:
        return (
            f"No workflow named {workflow!r}. Workflows: {', '.join(registry.workflows) or 'none'}."
        )
    if isinstance(arguments, str):  # some models send the arguments as a JSON string
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError:
            return "`arguments` must be an object of the workflow's arguments."
    try:
        validated = wf.validate(arguments or {})
    except ValueError as e:
        return str(e)
    if wf.background:
        if is_subagent(config):
            return f"`{wf.id}` runs in the background; only the main assistant can start it."
        return await start_job(wf, validated, config)
    try:
        result = await call_workflow(wf.resolve(), validated, config)
    except Exception as e:
        return f"`{wf.id}` failed: {e}"
    return (
        result if isinstance(result, str) else json.dumps(result, ensure_ascii=False, default=str)
    )
