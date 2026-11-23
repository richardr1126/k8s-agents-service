from pathlib import Path

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from agents.assistant.agent import _task_ordinal
from agents.assistant.focus import get_focuses
from agents.assistant.prompt import build_prompt
from skills import CommandError, SkillError, SkillRegistry, get_registry
from skills.registry import load_skill


def test_repo_skills_load_and_import() -> None:
    registry = get_registry()
    registry.check_impls()
    assert "github" in registry.skills
    assert "github.readme" in registry.workflows


def test_focuses_reference_real_skills() -> None:
    for focus in get_focuses().values():
        assert focus.label and focus.description
        assert all(skill in get_registry().skills for skill in focus.skills)


def test_prompt_lists_every_skill_and_focus() -> None:
    prompt = build_prompt(focus=None, subagent=False, max_tasks=4)
    for name in get_registry().skills:
        assert f"`{name}`" in prompt
    for name in get_focuses():
        assert f"`{name}`" in prompt
    sub = build_prompt(focus="github", subagent=True, max_tasks=4)
    assert "## Sub-agents" not in sub and "# Skill: github" in sub


def write_skill(root: Path, name: str, front: str, body: str = "Body.") -> Path:
    folder = root / name
    folder.mkdir()
    path = folder / "SKILL.md"
    path.write_text(f"---\n{front}\n---\n{body}\n")
    return path


def test_workflow_args_are_validated(tmp_path: Path) -> None:
    write_skill(
        tmp_path,
        "demo",
        "name: demo\ndescription: A demo.\nworkflows:\n  go:\n    description: Go.\n    impl: os:getcwd\n"
        "    args:\n      n: {type: integer, required: true, ge: 1}\n      mode: {type: string, default: a, enum: [a, b]}",
    )
    wf = SkillRegistry(tmp_path).workflows["demo.go"]
    assert wf.validate({"n": 2}) == {"n": 2, "mode": "a"}
    for bad in ({}, {"n": 0}, {"n": 1, "mode": "c"}, {"n": 1, "extra": True}):
        with pytest.raises(ValueError):
            wf.validate(bad)


DEMO = (
    "name: demo\ndescription: A demo.\nworkflows:\n  go:\n    description: Go.\n    impl: os:getcwd\n"
    "    args:\n      query: {type: string, required: true}\n"
    "      max_results: {type: integer, default: 5, ge: 1, le: 10}\n"
    "      mode: {type: string, default: a, enum: [a, b]}\n"
    "      loud: {type: boolean, default: false}\n"
    "      tags: {type: array}"
)


@pytest.fixture
def demo(tmp_path: Path) -> SkillRegistry:
    write_skill(tmp_path, "demo", DEMO)
    return SkillRegistry(tmp_path)


def test_commands_parse_with_types_defaults_and_quotes(demo: SkillRegistry) -> None:
    wf, args = demo.parse_command(
        "demo.go --query 'speculative decoding' --max-results 3 --mode b --loud --tags x y"
    )
    assert wf.id == "demo.go"
    assert args == {
        "query": "speculative decoding",
        "max_results": 3,
        "mode": "b",
        "loud": True,
        "tags": ["x", "y"],
    }
    # Underscored flags work too, and unset options take their defaults.
    _, args = demo.parse_command("demo.go --query=hi --max_results 2")
    assert args == {"query": "hi", "max_results": 2, "mode": "a", "loud": False, "tags": None}


@pytest.mark.parametrize(
    ("command", "says"),
    [
        ("demo.go", "the following arguments are required: --query"),
        ("demo.go --query x --max-results lots", "invalid int value: 'lots'"),
        ("demo.go --query x --max-results 50", "less than or equal to 10"),
        ("demo.go --query x --mode c", "invalid choice: 'c'"),
        ("demo.go --query x --colour red", "unrecognized arguments: --colour red"),
        ("demo.goo --query x", "Did you mean `demo.go`?"),
        ("demo.go --query 'unclosed", "check its quotes"),
        ("", "The command is empty"),
    ],
)
def test_bad_commands_say_what_to_fix(demo: SkillRegistry, command: str, says: str) -> None:
    with pytest.raises(CommandError) as e:
        demo.parse_command(command)
    assert says in str(e.value)
    if command.split(" ", 1)[0] == "demo.go" and "quotes" not in says:
        assert "usage: demo.go" in str(e.value)  # with the usage to retry from


def test_help_shows_the_usage(demo: SkillRegistry) -> None:
    with pytest.raises(CommandError) as e:
        demo.parse_command("demo.go --help")
    text = str(e.value)
    assert (
        "`demo.go --query QUERY [--max-results N] [--mode {a,b}] [--[no-]loud] [--tags TAGS ...]`"
        in text
    )
    assert "`--max-results`" in text


def test_skill_name_must_match_folder(tmp_path: Path) -> None:
    path = write_skill(tmp_path, "demo", "name: other\ndescription: x")
    with pytest.raises(SkillError):
        load_skill(path)


def test_task_cap_counts_calls_in_this_turn() -> None:
    def ai(*ids: str) -> AIMessage:
        return AIMessage(
            content="", tool_calls=[{"name": "task", "args": {}, "id": i} for i in ids]
        )

    messages = [
        HumanMessage("old"),
        ai("a"),
        ToolMessage("r", tool_call_id="a"),
        HumanMessage("new"),
        ai("b", "c"),
        ToolMessage("r", tool_call_id="b"),
        ai("d"),
    ]
    assert [_task_ordinal(messages, i) for i in ("b", "c", "d")] == [1, 2, 3]
