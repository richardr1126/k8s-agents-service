"""Background jobs for long workflows."""

from __future__ import annotations

from typing import Any

from langchain_core.runnables import RunnableConfig

from skills import Workflow


async def start_job(wf: Workflow, args: dict[str, Any], config: RunnableConfig) -> str:
    return f"`{wf.id}` runs in the background, which isn't available yet."
