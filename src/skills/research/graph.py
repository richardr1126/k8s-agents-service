r"""Deep research as a LangGraph graph: search, look for gaps, search again, then write.

    plan -> search -> gaps --(missing angles, first time only)--> search
                         \--> write

Each node is checkpointed per job (see `jobs.graphs`), so a restart resumes the report
instead of searching again from scratch.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from agents.utils import internal_llm_config
from jobs import report_progress
from jobs.graphs import run_graph
from skills.research.pipeline import Plan, Source, _model, gather, plan, write_report

MAX_SOURCES = 16
MORE_QUERIES = 3


class Report(TypedDict, total=False):
    question: str
    plan: dict[str, Any]
    queries: list[str]  # what the next search round runs
    rounds: int
    sources: list[dict[str, Any]]
    report: str


class Gaps(BaseModel):
    answered: bool = Field(description="True if the sources cover every part of the question")
    searches: list[str] = Field(
        default_factory=list, description="If not: web searches for the missing parts"
    )


GAPS = """\
You check research sources before a report is written. Given the question and what the sources so far
say, decide whether every part of the question is covered with specific, current evidence. If parts
are missing or thin, give up to {n} short web searches that would fill them; don't repeat these
searches: {done}."""


def _source(data: dict[str, Any]) -> Source:
    data = dict(data)
    data["passages"] = [tuple(p) for p in data.get("passages") or []]
    return Source(**data)


def _sources(state: Report) -> list[Source]:
    return [_source(s) for s in state.get("sources") or []]


async def _plan(state: Report, config: RunnableConfig) -> Report:
    await report_progress(config, "Planning searches")
    the_plan = await plan(state["question"], "deep", config)
    return {"plan": the_plan.model_dump(), "queries": the_plan.queries, "rounds": 0}


async def _search(state: Report, config: RunnableConfig) -> Report:
    first = Plan.model_validate(state["plan"])
    this_round = Plan(queries=state["queries"], news=first.news)
    _, found = await gather(state["question"], "deep", config, this_round)
    # Later rounds add pages the earlier ones didn't have.
    merged = {s.url: s for s in _sources(state)}
    for s in found:
        merged.setdefault(s.url, s)
    done = list(dict.fromkeys([*state["plan"]["queries"], *state["queries"]]))
    return {
        "sources": [asdict(s) for s in list(merged.values())[:MAX_SOURCES]],
        "plan": {**state["plan"], "queries": done},
        "rounds": (state.get("rounds") or 0) + 1,
    }


async def _gaps(state: Report, config: RunnableConfig) -> Report:
    if (state.get("rounds") or 0) >= 2:
        return {"queries": []}
    digest = "\n".join(
        f"- {s.title}: " + " ".join(" ".join(p.split()) for _, p in s.passages[:1])[:400]
        for s in _sources(state)
    )
    await report_progress(config, "Checking what the sources miss")
    try:
        result = (
            await _model(config)
            .with_structured_output(Gaps)
            .ainvoke(
                [
                    SystemMessage(
                        content=GAPS.format(
                            n=MORE_QUERIES, done="; ".join(state["plan"]["queries"])
                        )
                    ),
                    HumanMessage(content=f"Question: {state['question']}\n\nSources:\n{digest}"),
                ],
                internal_llm_config(config),
            )
        )
    except Exception:
        return {"queries": []}
    if not isinstance(result, Gaps) or result.answered:
        return {"queries": []}
    done = set(state["plan"]["queries"])
    more = [q.strip() for q in result.searches if q.strip() and q.strip() not in done]
    return {"queries": more[:MORE_QUERIES]}


def _after_gaps(state: Report) -> str:
    return "search" if state.get("queries") else "write"


async def _write(state: Report, config: RunnableConfig) -> Report:
    the_plan = Plan.model_validate(state["plan"])
    text = await write_report(state["question"], the_plan, _sources(state), config)
    return {"report": text}


def _graph() -> StateGraph:
    g = StateGraph(Report)
    g.add_node("plan", _plan)
    g.add_node("search", _search)
    g.add_node("gaps", _gaps)
    g.add_node("write", _write)
    g.add_edge(START, "plan")
    g.add_edge("plan", "search")
    g.add_edge("search", "gaps")
    g.add_conditional_edges("gaps", _after_gaps, ["search", "write"])
    g.add_edge("write", END)
    return g


DEEP = _graph()


async def deep_report(question: str, config: RunnableConfig | None) -> str:
    state = await run_graph(DEEP, {"question": question}, config)
    return state["report"]
