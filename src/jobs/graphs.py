"""Long workflows as LangGraph graphs, checkpointed under the job's id so a restart resumes them.

A workflow builds a `StateGraph` and calls `run_graph`. Each finished node is saved
to the checkpointer (Postgres in production), on thread `job:<job id>`. If the
server stops mid-job, another process claims the job (see `runner.sweep`) and calls
the workflow again with the same job id; `run_graph` then finds the checkpoint and
carries on from the last finished node instead of starting over.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import StateGraph

logger = logging.getLogger(__name__)

_saver: Any = None
_memory = InMemorySaver()
_compiled: dict[tuple[int, int], Any] = {}

# What a resumed job needs to rebuild its run's config, kept in each checkpoint's metadata.
CARRIED = ("model", "focus")


def use_saver(saver: Any) -> None:
    """The checkpointer job graphs save to; without one they checkpoint in memory."""
    global _saver
    _saver = saver
    _compiled.clear()


def saver() -> Any:
    return _saver if _saver is not None else _memory


def thread_of(job_id: str) -> str:
    return f"job:{job_id}"


async def saved_run(job_id: str) -> dict[str, Any] | None:
    """The carried config of a job that checkpointed a graph, or None if it has no checkpoint."""
    try:
        found = await saver().aget_tuple({"configurable": {"thread_id": thread_of(job_id)}})
    except Exception:
        logger.exception("Reading job %s's checkpoint failed", job_id)
        return None
    if found is None:
        return None
    metadata = found.metadata or {}
    return {key: metadata.get(f"job_{key}") for key in CARRIED}


def _compile(builder: StateGraph) -> Any:
    key = (id(builder), id(saver()))
    if key not in _compiled:
        _compiled[key] = builder.compile(checkpointer=saver())
    return _compiled[key]


async def run_graph(
    builder: StateGraph, inputs: dict[str, Any], ctx: RunnableConfig | None
) -> dict[str, Any]:
    """Runs the graph to its end and returns its final state, resuming a saved run of this job."""
    configurable = dict((ctx or {}).get("configurable") or {})
    job_id = configurable.get("job_id") or f"inline-{uuid4().hex[:12]}"
    # The job's own config, minus the namespace the job runner set for tool calls.
    configurable.pop("checkpoint_ns", None)
    configurable["chat_thread_id"] = configurable.get("chat_thread_id") or configurable.get(
        "thread_id"
    )
    configurable["thread_id"] = thread_of(job_id)
    config: RunnableConfig = {
        "configurable": configurable,
        "metadata": {f"job_{key}": configurable.get(key) for key in CARRIED},
        "recursion_limit": 60,
    }
    graph = _compile(builder)
    state = await graph.aget_state(config)
    if state.next:
        logger.info("Resuming job %s at %s", job_id, ", ".join(state.next))
        result = await graph.ainvoke(None, config)
    elif state.values:
        result = state.values  # it finished before the restart; only recording the end was lost
    else:
        result = await graph.ainvoke(inputs, config)
    try:
        await saver().adelete_thread(thread_of(job_id))
    except Exception:
        logger.warning("Couldn't delete job %s's checkpoints", job_id, exc_info=True)
    return result
