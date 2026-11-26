"""Sub-agents under the same background rules as the main assistant, end to end.

The real assistant graphs run with a scripted model: the main assistant delegates to
a sub-agent, the sub-agent starts a background job, and when the job ends the
sub-agent is continued with it and its answer reaches the main assistant.
"""

import asyncio
from typing import Any
from uuid import uuid4

import pytest
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

import jobs
from agents.assistant import agent as assistant
from agents.assistant import background as bg
from agents.assistant import follow_ups, subagent_jobs
from agents.configurable_model_graph import ConfigurableModelGraph
from jobs import graphs, runner
from jobs.store import MemoryJobStore
from tests.service.agui_fakes import ScriptedChatModel

pytestmark = pytest.mark.asyncio

CONFIG = {"configurable": {"user_id": "u1", "thread_id": "t1"}}


def call(name: str, **args: Any) -> AIMessage:
    return AIMessage(
        content="", tool_calls=[{"name": name, "args": args, "id": f"c-{uuid4().hex[:8]}"}]
    )


def text_of(message: BaseMessage) -> str:
    return message.content if isinstance(message.content, str) else str(message.content)


class World:
    """Scripted main assistant and sub-agent, and a gated background workflow."""

    def __init__(self) -> None:
        self.gate = asyncio.Event()
        self.agent_command = "agent <<'EOF'\ndig\nEOF"
        self.workflow_policy = "always"
        self.workflow_runs = 0

    def respond(self, messages: list[BaseMessage]) -> AIMessage:
        subagent = "You are a sub-agent" in text_of(messages[0])
        last = messages[-1]
        if subagent:
            if isinstance(last, HumanMessage) and text_of(last).startswith("<job-event"):
                return AIMessage(content="sub got the job's result")
            if isinstance(last, HumanMessage):
                return call("run", command="slow")
            return AIMessage(content="sub started the job")
        if isinstance(last, HumanMessage) and not text_of(last).startswith("<job-event"):
            return call("run", command=self.agent_command)
        if isinstance(last, ToolMessage):
            return AIMessage(content=f"main heard: {text_of(last)}")
        return AIMessage(content="main heard a job event")

    async def slow(self, config: Any) -> str:
        self.workflow_runs += 1
        await self.gate.wait()
        return "the job's result"

    def planner(self, request: Any) -> bg.Plan:
        return bg.Plan(
            policy=self.workflow_policy,  # type: ignore[arg-type]
            label="t.slow",
            args={},
            run=self.slow,
            promote=True,
        )


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch) -> World:
    w = World()
    model = ScriptedChatModel(responder=w.respond)
    monkeypatch.setattr(assistant, "get_model", lambda name: model)
    monkeypatch.setitem(bg.PLANNERS, "run", w.planner)
    main = ConfigurableModelGraph(lambda m: assistant._build(m, subagent=False))
    main.checkpointer = InMemorySaver()
    monkeypatch.setattr(
        assistant,
        "assistant_subagent",
        ConfigurableModelGraph(lambda m: assistant._build(m, subagent=True)),
    )
    monkeypatch.setattr(
        subagent_jobs,
        "_saved",
        ConfigurableModelGraph(lambda m: assistant._build(m, subagent=True)),
    )
    monkeypatch.setattr("agents.get_agent", lambda agent_id: main)
    monkeypatch.setattr(runner, "_store", MemoryJobStore())
    monkeypatch.setattr(runner, "_on_end", [])
    monkeypatch.setattr(follow_ups, "_following", set())
    monkeypatch.setattr(follow_ups, "_started", {})
    monkeypatch.setattr(graphs, "_memory", InMemorySaver())
    follow_ups.install()
    w.main = main  # type: ignore[attr-defined]
    return w


async def settle() -> None:
    for _ in range(100):
        pending = [t for t in [*runner._tasks, *follow_ups._tasks] if not t.done()]
        if not pending:
            return
        await asyncio.gather(*pending, return_exceptions=True)


async def thread(world: World) -> list[BaseMessage]:
    state = await world.main.aget_state(CONFIG)  # type: ignore[attr-defined]
    return list(state.values["messages"])


def task_results(messages: list[BaseMessage]) -> list[ToolMessage]:
    return [m for m in messages if isinstance(m, ToolMessage) and m.name == "task"]


async def test_a_subagents_job_continues_it_and_reaches_the_main_assistant(world: World) -> None:
    await world.main.ainvoke({"messages": [HumanMessage(content="go")]}, CONFIG)  # type: ignore[attr-defined]
    [first] = task_results(await thread(world))
    assert first.content == "sub started the job"
    [job] = [j for j in runner._store.jobs.values()]  # type: ignore[attr-defined]
    assert job.agent == "general-1" and job.thread_id == "t1" and job.status == "running"

    world.gate.set()
    await settle()

    messages = await thread(world)
    first, again = task_results(messages)
    assert again.content == "sub got the job's result"
    assert again.artifact["thread_id"] == "general-1"
    assert "<job-event" in again.artifact["description"]
    assert text_of(messages[-1]).startswith("main heard: sub got the job's result")
    assert (await jobs.store().get(job.id)).notified  # type: ignore[union-attr]
    # The main assistant never got the sub-agent's job as an event of its own.
    assert not any(bg.is_event(m) for m in messages)


async def test_a_background_subagent_lands_as_a_task_result(world: World) -> None:
    world.agent_command = "agent --bg <<'EOF'\ndig\nEOF"
    world.workflow_policy = "optional"
    world.gate.set()  # its workflow finishes inline, well inside the minute
    await world.main.ainvoke({"messages": [HumanMessage(content="go")]}, CONFIG)  # type: ignore[attr-defined]
    started = task_results(await thread(world))[0]
    assert bg.JOB_MARKER in text_of(started)
    await settle()

    messages = await thread(world)
    recorded = task_results(messages)[-1]
    assert recorded.content == "sub started the job"
    assert recorded.artifact["thread_id"] == "general-1"
    assert text_of(messages[-1]).startswith("main heard: sub started the job")


async def test_a_background_subagent_resumes_after_a_restart(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    world.agent_command = "agent --bg <<'EOF'\ndig\nEOF"
    world.workflow_policy = "optional"  # inline in the sub-agent, held at the gate
    await world.main.ainvoke({"messages": [HumanMessage(content="go")]}, CONFIG)  # type: ignore[attr-defined]
    for _ in range(50):
        if world.workflow_runs:
            break
        await asyncio.sleep(0.01)
    [job] = list(runner._store.jobs.values())  # type: ignore[attr-defined]
    assert job.workflow == "agent:general"

    monkeypatch.setattr(runner, "_stopping", False)  # restored after the test
    await runner.stop_jobs()  # the server stops; the job stays `running`
    runner._stopping = False  # and starts again
    monkeypatch.setattr(runner, "STALE_SECONDS", -1)
    world.gate.set()
    assert await runner.sweep() == [job.id]
    await settle()

    assert world.workflow_runs == 2  # the step in progress ran again; nothing before it did
    resumed = await jobs.store().get(job.id)
    assert resumed and resumed.status == "done" and resumed.notified
    assert task_results(await thread(world))[-1].content == "sub started the job"
