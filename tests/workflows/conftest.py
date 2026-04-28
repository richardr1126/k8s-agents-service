from __future__ import annotations

import sys
import textwrap
from pathlib import Path

import pytest


def _write_impl(tmp_path: Path, name: str, source: str) -> str:
    pkg_root = tmp_path / "impls_pkg"
    pkg_root.mkdir(exist_ok=True)
    (pkg_root / "__init__.py").write_text("")
    (pkg_root / f"{name}.py").write_text(textwrap.dedent(source).lstrip())
    parent = str(tmp_path)
    if parent not in sys.path:
        sys.path.insert(0, parent)
    for cached in [f"impls_pkg.{name}", "impls_pkg"]:
        sys.modules.pop(cached, None)
    return f"impls_pkg.{name}"


_DEFAULT_IMPL_SOURCE = """\
from pydantic import BaseModel, Field

class OutputModel(BaseModel):
    input_value: str = Field(..., json_schema_extra={"summary_role": "echoed_input"})
    doubled: str = Field(..., json_schema_extra={"summary_role": "field"})

def run(text: str, repeat: int = 2, loud: bool = False) -> OutputModel:
    doubled = (text * repeat).upper() if loud else text * repeat
    return OutputModel(input_value=text, doubled=doubled)
"""

_DEFAULT_ARG_SCHEMA_BLOCK = """\
    text:
      type: string
      required: true
      position: 1
      description: Text to repeat.
    repeat:
      type: integer
      required: false
      default: 2
      minimum: 1
      maximum: 10
      aliases: ["-r"]
      description: Repetition count.
    loud:
      type: boolean
      required: false
      default: false
      aliases: ["-l"]
      description: Uppercase the output.
"""


@pytest.fixture
def make_skills(tmp_path: Path):
    def _build(
        *,
        capability_id: str = "echo_workflow",
        impl_source: str | None = None,
        arg_schema_yaml: str | None = None,
    ) -> Path:
        impl_module = _write_impl(
            tmp_path, capability_id, impl_source or _DEFAULT_IMPL_SOURCE
        )

        skills_root = tmp_path / "skills"
        (skills_root / "capabilities").mkdir(parents=True, exist_ok=True)
        (skills_root / "tools").mkdir(parents=True, exist_ok=True)

        if arg_schema_yaml is None:
            arg_schema_block = _DEFAULT_ARG_SCHEMA_BLOCK
        else:
            arg_schema_block = textwrap.indent(textwrap.dedent(arg_schema_yaml), "    ")
        if not arg_schema_block.endswith("\n"):
            arg_schema_block += "\n"

        capability_md = (
            "---\n"
            f"id: {capability_id}\n"
            "doc_type: capability\n"
            "kind: workflow\n"
            "order: 1\n"
            "execution:\n"
            f"  impl: {impl_module}\n"
            "  arg_schema:\n"
            f"{arg_schema_block}"
            "---\n"
            "\n"
            "--- list_capabilities ---\n"
            "- Kind: `workflow`\n"
            "- Summary: test workflow.\n"
            "\n"
            "--- read_capability ---\n"
            f"## Capability: `{capability_id}`\n"
            "\n"
            "{{ARG_USAGE}}\n"
            "\n"
            "{{ARG_TABLE}}\n"
            "\n"
            "{{EXPECTED_OUTPUT_SUMMARY}}\n"
        )
        (skills_root / "capabilities" / f"{capability_id}.md").write_text(capability_md)

        for tool_id in ("list_capabilities", "read_capability", "run_workflow_cli"):
            (skills_root / "tools" / f"{tool_id}.md").write_text(
                f"---\nid: {tool_id}\ndoc_type: tool\n---\n{tool_id} description.\n"
            )

        return skills_root

    return _build


@pytest.fixture
def reset_modules():
    snapshot = set(sys.modules.keys())
    yield
    for name in list(sys.modules.keys()):
        if name not in snapshot:
            sys.modules.pop(name, None)
