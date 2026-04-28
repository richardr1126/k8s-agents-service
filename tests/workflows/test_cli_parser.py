from __future__ import annotations

import pytest

from workflows.cli_parser import parse_workflow_cli_command
from workflows.registry import SkillRegistry


@pytest.fixture
def registry(make_skills, reset_modules) -> SkillRegistry:
    return SkillRegistry(make_skills())


def test_positional_arg(registry):
    workflow_id, args = parse_workflow_cli_command("echo_workflow hello", registry)
    assert workflow_id == "echo_workflow"
    assert args == {"text": "hello", "repeat": 2, "loud": False}


def test_long_flag_separate_value(registry):
    _, args = parse_workflow_cli_command("echo_workflow --text hi --repeat 3", registry)
    assert args["text"] == "hi"
    assert args["repeat"] == 3


def test_long_flag_inline_value(registry):
    _, args = parse_workflow_cli_command("echo_workflow --text=hi --repeat=4", registry)
    assert args["repeat"] == 4


def test_short_alias(registry):
    _, args = parse_workflow_cli_command("echo_workflow hi -r 5", registry)
    assert args["repeat"] == 5


def test_boolean_flag_bare_and_explicit(registry):
    _, args = parse_workflow_cli_command("echo_workflow hi --loud", registry)
    assert args["loud"] is True

    _, args = parse_workflow_cli_command("echo_workflow hi --loud false", registry)
    assert args["loud"] is False


def test_quoted_value_with_spaces(registry):
    _, args = parse_workflow_cli_command('echo_workflow "hello world"', registry)
    assert args["text"] == "hello world"


def test_double_dash_terminator(registry):
    _, args = parse_workflow_cli_command("echo_workflow -- --text", registry)
    assert args["text"] == "--text"


def test_missing_required_arg_errors(make_skills, reset_modules):
    registry = SkillRegistry(
        make_skills(
            arg_schema_yaml="value:\n  type: string\n  required: true",
            capability_id="needs_value",
        )
    )
    with pytest.raises(ValueError, match="missing required flags"):
        parse_workflow_cli_command("needs_value", registry)


def test_unknown_workflow_errors(registry):
    with pytest.raises(ValueError, match="unknown workflow_id"):
        parse_workflow_cli_command("does_not_exist", registry)


def test_unknown_flag_errors(registry):
    with pytest.raises(ValueError, match="unknown flag"):
        parse_workflow_cli_command("echo_workflow hi --bogus 1", registry)


def test_integer_bounds(registry):
    with pytest.raises(ValueError, match=r"--repeat.*must be <= 10"):
        parse_workflow_cli_command("echo_workflow hi --repeat 99", registry)


def test_integer_type_coercion_failure(registry):
    with pytest.raises(ValueError, match="invalid integer"):
        parse_workflow_cli_command("echo_workflow hi --repeat abc", registry)


def test_default_filled_when_omitted(registry):
    _, args = parse_workflow_cli_command("echo_workflow hi", registry)
    assert args["repeat"] == 2
    assert args["loud"] is False


def test_empty_command_errors(registry):
    with pytest.raises(ValueError, match="must not be empty"):
        parse_workflow_cli_command("   ", registry)
