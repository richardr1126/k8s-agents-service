"""Workflow entry points of the research skill."""

from __future__ import annotations

from langchain_core.runnables import RunnableConfig

from skills.research.graph import deep_report
from skills.research.pipeline import evidence, gather


async def quick(question: str, ctx: RunnableConfig | None = None) -> str:
    the_plan, sources = await gather(question, "quick", ctx)
    return evidence(question, the_plan, sources)


async def deep(question: str, ctx: RunnableConfig | None = None) -> str:
    return await deep_report(question, ctx)
