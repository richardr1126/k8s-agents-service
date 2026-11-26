"""The `run` tool, the `agent` command stored as `task`, and old chats read back as commands."""

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from agents.assistant.commands import as_run, as_stored, as_task, for_model, run
from skills.command import split_command

pytestmark = pytest.mark.asyncio

MAIN = {"configurable": {}}
SUB = {"configurable": {"assistant_subagent": True}}


def call(name: str, i: str = "c1", /, **args: object) -> dict:
    return {"name": name, "args": args, "id": i, "type": "tool_call"}


async def test_run_shows_help_and_mistakes_as_its_result() -> None:
    text, artifact = await run.coroutine("skills --help", MAIN)  # type: ignore[misc]
    assert "# Skill: skills" in text and artifact is None
    text, _ = await run.coroutine("github comits openreader", MAIN)  # type: ignore[misc]
    assert "Did you mean `github commits`?" in text


async def test_sub_agents_cant_start_sub_agents() -> None:
    text, _ = await run.coroutine("agent <<'EOF'\ndig\nEOF", SUB)  # type: ignore[misc]
    assert "No skill named `agent`" in text
    text, _ = await run.coroutine("skills list", SUB)  # type: ignore[misc]
    assert "`agent`" not in text and "`web`" in text


async def test_run_returns_a_workflows_data_for_the_card(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake(query: str, limit: int, news: bool, days: int | None) -> dict:
        return {"text": f"hits for {query} ({limit})", "data": {"sources": [{"url": "u"}]}}

    monkeypatch.setattr("skills.web.workflows.search", fake)
    text, artifact = await run.coroutine("web search 'k3s ingress' -n 2", MAIN)  # type: ignore[misc]
    assert text == "hits for k3s ingress (2)"
    assert artifact == {"workflow": "web search", "data": {"sources": [{"url": "u"}]}}


def test_an_agent_command_is_stored_as_a_task_call() -> None:
    stored = as_task(
        call("run", command="agent --type research --thread research-1 --bg <<'EOF'\nfind it\nEOF")
    )
    assert stored == call(
        "task",
        description="find it",
        subagent_type="research",
        thread_id="research-1",
        background=True,
    )
    assert as_task(call("run", command="agent plain words")) == call(
        "task", description="plain words", subagent_type="general"
    )
    assert as_task(call("run", command="web search x")) is None
    assert as_task(call("run", command="agent")) is None  # `run` explains the missing brief


def test_as_stored_keeps_the_message_and_its_other_calls() -> None:
    message = AIMessage(
        content="",
        id="m1",
        tool_calls=[
            call("run", "a", command="agent <<'EOF'\npython\nEOF"),
            call("run", "b", command="web search rust"),
        ],
    )
    [stored] = as_stored([message])
    assert stored is message and stored.id == "m1"
    assert [c["name"] for c in stored.tool_calls] == ["task", "run"]
    assert [c["id"] for c in stored.tool_calls] == ["a", "b"]


def test_a_skill_called_as_a_tool_is_run_as_its_command() -> None:
    assert as_run(call("github", command="repo list")) == call("run", command="github repo list")
    assert as_run(call("skills")) == call("run", command="skills")
    assert as_run(call("run", command="x")) is None and as_run(call("nope")) is None
    message = AIMessage(
        content="",
        tool_calls=[
            call("agent", "a", command="--type research <<'EOF'\ndig\nEOF"),
            call("web", "b", command="search x"),
        ],
    )
    as_stored([message])
    assert [c["name"] for c in message.tool_calls] == ["task", "run"]
    assert message.tool_calls[1]["args"] == {"command": "web search x"}
    # A sub-agent's calls are fixed too, but never become sub-agents.
    message = AIMessage(content="", tool_calls=[call("agent", "a", command="dig")])
    as_stored([message], sub_agents=False)
    assert message.tool_calls[0] == call("run", "a", command="agent dig")


LEGACY = [
    (
        call("task", description="dig in", subagent_type="research", thread_id="research-2"),
        "agent --type research --thread research-2 <<'EOF'\ndig in\nEOF",
    ),
    (
        call("task", description="go", subagent_type="general", background=True),
        "agent --bg <<'EOF'\ngo\nEOF",
    ),
    (
        call("web_search", query="k3s 'ingress'", max_results=3, topic="news", days=7),
        "web search 'k3s '\"'\"'ingress'\"'\"'' -n 3 --news --days 7",
    ),
    (call("fetch_page", url="https://example.com/a b"), "web read 'https://example.com/a b'"),
    (
        call("search_richard", query="kubernetes", source="projects"),
        "richard search kubernetes --source projects",
    ),
    (call("search_richard", query="work", source="all"), "richard search work"),
    (call("check_job", job_id="job-1"), "jobs check job-1"),
    (call("list_skills"), "skills list"),
    (call("read_skill", name="github"), "github --help"),
    (
        call("run_workflow", command="github.commits openreader -L 5", background=True),
        "github commits openreader -L 5 --bg",
    ),
]


@pytest.mark.parametrize(("old", "command"), LEGACY)
def test_old_calls_read_back_as_commands(old: dict, command: str) -> None:
    [message] = for_model([AIMessage(content="", tool_calls=[old])])
    [shown] = message.tool_calls
    assert shown["name"] == "run" and shown["id"] == old["id"]
    assert shown["args"] == {"command": command}


def test_old_commands_still_parse_the_same() -> None:
    # What the model reads back is something `run` accepts and turns into the same call.
    for old, command in LEGACY:
        if old["name"] == "task":
            assert as_task(call("run", command=command))["args"] == old["args"]
        else:
            assert split_command(command).words


def test_for_model_copies_and_renames_results() -> None:
    ai = AIMessage(content="", tool_calls=[call("web_search", query="x")])
    result = ToolMessage(content="found", tool_call_id="c1", name="web_search")
    messages = [HumanMessage("q"), ai, result]
    shown = for_model(messages)
    assert shown[2].name == "run" and shown[2].content == "found"
    assert ai.tool_calls[0]["name"] == "web_search" and result.name == "web_search"
