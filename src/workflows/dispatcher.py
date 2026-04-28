from __future__ import annotations

import importlib
import inspect

from pydantic import BaseModel

from workflows.cli_parser import parse_workflow_cli_command
from workflows.registry import SkillRegistry
from workflows.renderers import (
    format_workflow_error_markdown,
    format_workflow_result_markdown,
)


async def run_workflow(command: str, registry: SkillRegistry) -> str:
    try:
        workflow_id, kwargs = parse_workflow_cli_command(command, registry)
    except ValueError as exc:
        return format_workflow_error_markdown("(unknown)", str(exc))

    capability = registry.capabilities[workflow_id]
    try:
        impl = importlib.import_module(capability.impl_module)
    except Exception as exc:
        return format_workflow_error_markdown(
            workflow_id, f"failed to import workflow impl `{capability.impl_module}`: {exc}"
        )

    run_fn = getattr(impl, "run", None)
    if not callable(run_fn):
        return format_workflow_error_markdown(
            workflow_id,
            f"workflow impl `{capability.impl_module}` missing required `run` callable",
        )

    try:
        result = run_fn(**kwargs)
        if inspect.iscoroutine(result):
            result = await result
    except Exception as exc:
        return format_workflow_error_markdown(
            workflow_id, f"workflow execution raised: {type(exc).__name__}: {exc}"
        )

    if not isinstance(result, BaseModel):
        return format_workflow_error_markdown(
            workflow_id,
            f"workflow `{workflow_id}` did not return a pydantic BaseModel "
            f"(got `{type(result).__name__}`)",
        )

    return format_workflow_result_markdown(workflow_id, result)


def render_list_capabilities(registry: SkillRegistry) -> str:
    skills = sorted(
        registry.capabilities.values(), key=lambda skill: (skill.order, skill.id)
    )
    if not skills:
        return "## Available Workflows\n\nNo capabilities registered."

    lines = [
        "## Available Workflows",
        "",
        f"Total: `{len(skills)}` capability(ies). "
        "Call `read_capability(capability_id=...)` to see full usage and arguments.",
        "",
    ]
    for index, skill in enumerate(skills, start=1):
        lines.append(f"### {index}. `{skill.id}`")
        card = skill.list_card.strip("\n")
        if card:
            lines.append(card)
        if index < len(skills):
            lines.append("")
    return "\n".join(lines).rstrip()


def render_capability_doc(registry: SkillRegistry, capability_id: str) -> str:
    skill = registry.capabilities.get(capability_id)
    if skill is None:
        available = ", ".join(sorted(registry.capabilities))
        return "\n".join(
            [
                f"## Capability: `{capability_id}`",
                "",
                "- Status: `unknown`",
                "",
                f"Unknown capability id. Available: {available}",
            ]
        )
    return skill.read_doc.strip("\n")
