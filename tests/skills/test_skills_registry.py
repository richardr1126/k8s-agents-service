from pathlib import Path

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from agents.assistant.agent import _task_ordinal
from agents.assistant.focus import get_focuses
from agents.assistant.prompt import build_prompt
from skills import SkillError, SkillRegistry, get_registry
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
