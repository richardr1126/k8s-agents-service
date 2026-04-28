from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from workflows.registry import SkillRegistry, SkillRegistryError


def test_loads_capability_and_tools(make_skills, reset_modules):
    skills_root = make_skills()
    registry = SkillRegistry(skills_root)

    assert "echo_workflow" in registry.capabilities
    assert set(registry.tools) == {"list_capabilities", "read_capability", "run_workflow_cli"}

    cap = registry.capabilities["echo_workflow"]
    assert cap.kind == "workflow"
    assert cap.impl_module.endswith(".echo_workflow")
    assert "text" in cap.arg_schema
    assert cap.arg_schema["repeat"]["default"] == 2


def test_read_doc_renders_placeholders(make_skills, reset_modules):
    registry = SkillRegistry(make_skills())
    doc = registry.capabilities["echo_workflow"].read_doc

    assert "{{ARG_USAGE}}" not in doc
    assert "{{ARG_TABLE}}" not in doc
    assert "{{EXPECTED_OUTPUT_SUMMARY}}" not in doc
    assert "echo_workflow <string>" in doc
    assert "`--text`" in doc
    assert "`-r`" in doc
    assert "`input_value`: Echoed input identifier" in doc


def test_missing_expected_output_summary_placeholder_errors(tmp_path: Path, reset_modules):
    skills_root = tmp_path / "skills"
    (skills_root / "capabilities").mkdir(parents=True)
    (skills_root / "tools").mkdir(parents=True)
    impl_pkg = tmp_path / "pkg"
    impl_pkg.mkdir()
    (impl_pkg / "__init__.py").write_text("")
    (impl_pkg / "no_summary.py").write_text(
        textwrap.dedent(
            """
            from pydantic import BaseModel

            class OutputModel(BaseModel):
                value: str

            def run(value: str) -> OutputModel:
                return OutputModel(value=value)
            """
        ).lstrip()
    )
    import sys

    if str(tmp_path) not in sys.path:
        sys.path.insert(0, str(tmp_path))

    (skills_root / "capabilities" / "no_summary.md").write_text(
        textwrap.dedent(
            """\
            ---
            id: no_summary
            doc_type: capability
            kind: workflow
            order: 1
            execution:
              impl: pkg.no_summary
              arg_schema:
                value:
                  type: string
                  required: true
            ---

            --- list_capabilities ---
            x

            --- read_capability ---
            ## Capability: `no_summary`
            (no expected output placeholder here)
            """
        )
    )
    (skills_root / "tools" / "list_capabilities.md").write_text(
        "---\nid: list_capabilities\ndoc_type: tool\n---\nx\n"
    )

    with pytest.raises(SkillRegistryError, match="EXPECTED_OUTPUT_SUMMARY"):
        SkillRegistry(skills_root)


def test_unknown_doc_type_errors(tmp_path: Path, reset_modules):
    skills_root = tmp_path / "skills"
    skills_root.mkdir()
    (skills_root / "bogus.md").write_text(
        textwrap.dedent(
            """\
            ---
            id: bogus
            doc_type: nonsense
            ---
            body
            """
        )
    )
    with pytest.raises(SkillRegistryError, match="invalid doc_type"):
        SkillRegistry(skills_root)


def test_duplicate_ids_error(tmp_path: Path, reset_modules):
    skills_root = tmp_path / "skills"
    skills_root.mkdir()
    for letter in ("a", "b"):
        (skills_root / f"{letter}.md").write_text(
            textwrap.dedent(
                """\
                ---
                id: same
                doc_type: tool
                ---
                desc
                """
            )
        )
    with pytest.raises(SkillRegistryError, match="duplicate skill id"):
        SkillRegistry(skills_root)
