from __future__ import annotations

from collections.abc import Callable
from typing import Any

from pydantic import BaseModel

WorkflowRenderer = Callable[[BaseModel], list[str]]

_RENDERERS: dict[str, WorkflowRenderer] = {}


def register_renderer(workflow_id: str, renderer: WorkflowRenderer) -> None:
    _RENDERERS[workflow_id] = renderer


def format_workflow_result_markdown(workflow_id: str, result: BaseModel) -> str:
    lines = [f"## Workflow: `{workflow_id}`", ""]
    renderer = _RENDERERS.get(workflow_id, _default_renderer)
    body = renderer(result)
    if body:
        lines.extend(body)
    return "\n".join(lines).rstrip()


def format_workflow_error_markdown(workflow_id: str, message: str) -> str:
    return "\n".join(
        [
            f"## Workflow: `{workflow_id}`",
            "",
            "- Status: `error`",
            "",
            "### Error",
            f"```text\n{message}\n```",
        ]
    )


def _default_renderer(result: BaseModel) -> list[str]:
    payload = result.model_dump()
    return _render_dict_lines(payload)


def _render_dict_lines(payload: Any) -> list[str]:
    if payload is None:
        return ["No structured workflow payload returned."]
    if isinstance(payload, (str, int, float, bool)):
        return [f"Result: `{payload}`"]
    if isinstance(payload, list):
        if not payload:
            return ["Result list is empty."]
        lines = [f"Result list with `{len(payload)}` items:"]
        for index, item in enumerate(payload[:10], start=1):
            lines.append(f"{index}. `{item}`")
        if len(payload) > 10:
            lines.append(f"... and `{len(payload) - 10}` more items.")
        return lines
    if isinstance(payload, dict):
        lines = ["Result fields:"]
        for key, value in payload.items():
            if isinstance(value, (str, int, float, bool)) or value is None:
                lines.append(f"- `{key}`: `{value}`")
            elif isinstance(value, list):
                lines.append(f"- `{key}`: list with `{len(value)}` items")
            elif isinstance(value, dict):
                lines.append(f"- `{key}`: object with `{len(value)}` fields")
            else:
                lines.append(f"- `{key}`: `{type(value).__name__}`")
        return lines
    return [f"Result type: `{type(payload).__name__}`"]
