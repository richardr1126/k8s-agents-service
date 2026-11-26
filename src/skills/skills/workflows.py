"""Finding skills and commands."""

from __future__ import annotations

from langchain_core.runnables import RunnableConfig

from skills.registry import get_registry, hidden_skills


async def search(query: str, ctx: RunnableConfig) -> str:
    hidden = hidden_skills(ctx)
    found = get_registry().search(query, hidden=hidden)
    if not found:
        return f"No skill matches {query!r}. `skills list` shows them all."
    lines = [f"Best matches for {query!r}:"]
    for skill, wf in found:
        if wf is None:
            lines.append(f"- `{skill.name} --help`: {skill.description}")
        else:
            lines.append(f"- `{wf.command()}`: {wf.description}")
    lines.append("\n`<skill> --help` shows a skill's instructions and options.")
    return "\n".join(lines)


async def listing(ctx: RunnableConfig) -> str:
    return get_registry().index(hidden=hidden_skills(ctx))
