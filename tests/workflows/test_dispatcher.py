from __future__ import annotations

import pytest

from workflows.dispatcher import (
    render_capability_doc,
    render_list_capabilities,
    run_workflow,
)
from workflows.registry import SkillRegistry


@pytest.fixture
def registry(make_skills, reset_modules) -> SkillRegistry:
    return SkillRegistry(make_skills())


@pytest.mark.asyncio
async def test_run_workflow_success(registry):
    out = await run_workflow("echo_workflow hello --repeat 3", registry)
    assert "## Workflow: `echo_workflow`" in out
    assert "`input_value`: `hello`" in out
    assert "`doubled`: `hellohellohello`" in out


@pytest.mark.asyncio
async def test_run_workflow_boolean_flag(registry):
    out = await run_workflow("echo_workflow hi --loud", registry)
    assert "`doubled`: `HIHI`" in out


@pytest.mark.asyncio
async def test_run_workflow_parse_error(registry):
    out = await run_workflow("echo_workflow --bogus 1", registry)
    assert "- Status: `error`" in out
    assert "unknown flag" in out


@pytest.mark.asyncio
async def test_run_workflow_unknown_id(registry):
    out = await run_workflow("nope --x 1", registry)
    assert "- Status: `error`" in out
    assert "unknown workflow_id" in out


def test_render_list_capabilities(registry):
    out = render_list_capabilities(registry)
    assert "## Available Workflows" in out
    assert "### 1. `echo_workflow`" in out


def test_render_capability_doc(registry):
    out = render_capability_doc(registry, "echo_workflow")
    assert "## Capability: `echo_workflow`" in out
    assert "echo_workflow <string>" in out


def test_render_capability_doc_unknown(registry):
    out = render_capability_doc(registry, "missing")
    assert "Unknown capability id" in out
