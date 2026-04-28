from __future__ import annotations

import logging
from pathlib import Path

from langchain_core.tools import tool

from workflows.dispatcher import (
    render_capability_doc,
    render_list_capabilities,
    run_workflow,
)
from workflows.registry import SkillRegistry

logger = logging.getLogger(__name__)

_SKILLS_ROOT = Path(__file__).resolve().parent.parent / "workflows" / "skills"
_REGISTRY = SkillRegistry(_SKILLS_ROOT)


@tool
async def list_capabilities() -> str:
    """List all available workflow capabilities."""
    return render_list_capabilities(_REGISTRY)


@tool
async def read_capability(capability_id: str) -> str:
    """Return full documentation for a workflow capability."""
    return render_capability_doc(_REGISTRY, capability_id)


@tool
async def run_workflow_cli(command: str) -> str:
    """Execute a workflow capability via a CLI-style command string."""
    return await run_workflow(command, _REGISTRY)


for _tool, _tool_id in (
    (list_capabilities, "list_capabilities"),
    (read_capability, "read_capability"),
    (run_workflow_cli, "run_workflow_cli"),
):
    _description = _REGISTRY.tool_description(_tool_id)
    if _description:
        _tool.description = _description.strip()
    else:
        logger.warning("Tool description missing from skills, keeping fallback: %s", _tool_id)


workflow_tools = [list_capabilities, read_capability, run_workflow_cli]
