from __future__ import annotations

import importlib
import re
from dataclasses import dataclass
from pathlib import Path
from types import UnionType
from typing import Any, Union, get_args, get_origin

import yaml  # type: ignore[import-untyped]
from pydantic import BaseModel


class SkillRegistryError(ValueError):
    """Raised when skill documents are invalid."""


@dataclass(frozen=True)
class CapabilitySkill:
    id: str
    kind: str
    order: int
    impl_module: str
    arg_schema: dict[str, Any]
    list_card: str
    read_doc: str
    path: Path


@dataclass(frozen=True)
class ToolSkill:
    id: str
    description: str
    path: Path


class SkillRegistry:
    _DOC_TYPES = {"capability", "tool"}
    _BASE_FIELDS = {"id", "doc_type"}
    _REQUIRED_SECTIONS = {
        "capability": {"list_capabilities", "read_capability"},
        "tool": set(),
    }

    def __init__(self, skills_root: Path) -> None:
        self.skills_root = skills_root
        self.capabilities: dict[str, CapabilitySkill] = {}
        self.tools: dict[str, ToolSkill] = {}
        self._load()

    def tool_description(self, tool_id: str) -> str | None:
        tool = self.tools.get(tool_id)
        if tool is None:
            return None
        return tool.description

    def _load(self) -> None:
        if not self.skills_root.exists():
            raise SkillRegistryError(f"skills directory not found: {self.skills_root}")

        seen_ids: set[str] = set()
        markdown_files = sorted(self.skills_root.rglob("*.md"))
        if not markdown_files:
            raise SkillRegistryError(f"no markdown skill files found under: {self.skills_root}")

        for path in markdown_files:
            metadata, body = _parse_frontmatter(path)

            metadata_id = _metadata_string(metadata, "id", path)
            if metadata_id in seen_ids:
                raise SkillRegistryError(f"duplicate skill id detected: {metadata_id}")
            seen_ids.add(metadata_id)

            doc_type = _metadata_string(metadata, "doc_type", path)
            if doc_type not in self._DOC_TYPES:
                raise SkillRegistryError(f"invalid doc_type `{doc_type}` in: {path}")

            allowed_fields = set(self._BASE_FIELDS)
            kind = metadata.get("kind")
            order = metadata.get("order")
            execution = metadata.get("execution")

            if doc_type == "capability":
                allowed_fields.update({"kind", "order", "execution"})
                if not isinstance(kind, str) or not kind.strip():
                    raise SkillRegistryError(f"missing required `kind` for `capability` in: {path}")
                kind = kind.strip()
                if kind != "workflow":
                    raise SkillRegistryError(
                        f"capability kind must be `workflow` in: {path}"
                    )
                if not isinstance(order, int) or order < 0:
                    raise SkillRegistryError(
                        f"missing/invalid required `order` for `capability` in: {path}"
                    )
                if not isinstance(execution, dict):
                    raise SkillRegistryError(
                        f"missing/invalid required `execution` mapping for workflow capability in: {path}"
                    )
                _validate_execution_keys(execution, {"impl", "arg_schema"}, path)

            unexpected_fields = sorted(set(metadata.keys()) - allowed_fields)
            if unexpected_fields:
                raise SkillRegistryError(
                    f"unexpected frontmatter keys in {path}: {', '.join(unexpected_fields)}"
                )

            if doc_type == "tool":
                description = body.strip("\n")
                if not description.strip():
                    raise SkillRegistryError(f"empty tool description in: {path}")
                description = f"{description}\n"
                self.tools[metadata_id] = ToolSkill(
                    id=metadata_id,
                    description=description,
                    path=path,
                )
                continue

            sections = _parse_sections(body=body, path=path)
            expected_sections = self._REQUIRED_SECTIONS[doc_type]
            missing = sorted(expected_sections - set(sections.keys()))
            if missing:
                raise SkillRegistryError(
                    f"missing required section(s) in {path}: {', '.join(missing)}"
                )
            extra = sorted(set(sections.keys()) - expected_sections)
            if extra:
                raise SkillRegistryError(f"unexpected section(s) in {path}: {', '.join(extra)}")

            assert isinstance(execution, dict)
            assert isinstance(kind, str)
            assert isinstance(order, int)

            impl_module = _execution_string(execution, "impl", path)
            arg_schema = _execution_mapping(execution, "arg_schema", path)
            if "{{EXPECTED_OUTPUT_SUMMARY}}" not in sections["read_capability"]:
                raise SkillRegistryError(
                    f"workflow capability missing `{{EXPECTED_OUTPUT_SUMMARY}}` placeholder in: {path}"
                )
            expected_output_schema = _workflow_output_schema_from_module(
                impl_module=impl_module,
                capability_path=path,
            )
            read_doc = _render_capability_read_doc(
                capability_id=metadata_id,
                arg_schema=arg_schema,
                expected_output_schema=expected_output_schema,
                read_doc=sections["read_capability"],
            )

            self.capabilities[metadata_id] = CapabilitySkill(
                id=metadata_id,
                kind=kind,
                order=order,
                impl_module=impl_module,
                arg_schema=arg_schema,
                list_card=sections["list_capabilities"],
                read_doc=read_doc,
                path=path,
            )


def _parse_frontmatter(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    if not lines or lines[0].strip() != "---":
        raise SkillRegistryError(f"missing frontmatter start delimiter in: {path}")

    end_index: int | None = None
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            end_index = index
            break

    if end_index is None:
        raise SkillRegistryError(f"missing frontmatter end delimiter in: {path}")

    frontmatter_text = "\n".join(lines[1:end_index])
    body = "\n".join(lines[end_index + 1 :])

    try:
        metadata = yaml.safe_load(frontmatter_text) or {}
    except yaml.YAMLError as exc:
        raise SkillRegistryError(f"invalid frontmatter yaml in {path}: {exc}") from exc

    if not isinstance(metadata, dict):
        raise SkillRegistryError(f"frontmatter must be a mapping in: {path}")

    for required in SkillRegistry._BASE_FIELDS:
        if required not in metadata:
            raise SkillRegistryError(f"missing required frontmatter key `{required}` in: {path}")

    return metadata, body


def _metadata_string(metadata: dict[str, Any], key: str, path: Path) -> str:
    value = metadata.get(key)
    if value is None:
        raise SkillRegistryError(f"missing required frontmatter key `{key}` in: {path}")
    text = str(value).strip()
    if not text:
        raise SkillRegistryError(f"frontmatter key `{key}` must be non-empty in: {path}")
    return text


def _validate_execution_keys(execution: dict[str, Any], allowed_keys: set[str], path: Path) -> None:
    unexpected = sorted(key for key in execution.keys() if key not in allowed_keys)
    if unexpected:
        raise SkillRegistryError(f"unexpected execution keys in {path}: {', '.join(unexpected)}")


def _execution_string(execution: dict[str, Any], key: str, path: Path) -> str:
    value = execution.get(key)
    if not isinstance(value, str) or not value.strip():
        raise SkillRegistryError(f"missing required `execution.{key}` in: {path}")
    return value.strip()


def _execution_mapping(execution: dict[str, Any], key: str, path: Path) -> dict[str, Any]:
    value = execution.get(key)
    if not isinstance(value, dict):
        raise SkillRegistryError(f"missing/invalid required `execution.{key}` mapping in: {path}")
    return {
        str(item_key): item_value
        for item_key, item_value in value.items()
        if isinstance(item_key, str)
    }


def _render_capability_read_doc(
    capability_id: str,
    arg_schema: dict[str, Any],
    expected_output_schema: list[dict[str, str]],
    read_doc: str,
) -> str:
    rendered = read_doc
    if "{{ARG_USAGE}}" in rendered:
        rendered = rendered.replace(
            "{{ARG_USAGE}}", f"`{_capability_arg_usage(capability_id, arg_schema)}`"
        )
    if "{{ARG_TABLE}}" in rendered:
        rendered = rendered.replace("{{ARG_TABLE}}", _capability_arg_table(arg_schema))
    if "{{EXPECTED_OUTPUT_SUMMARY}}" in rendered:
        rendered = rendered.replace(
            "{{EXPECTED_OUTPUT_SUMMARY}}",
            _capability_expected_output_summary(expected_output_schema),
        )
    return rendered


def _capability_arg_usage(capability_id: str, arg_schema: dict[str, Any]) -> str:
    parts: list[str] = []
    positional_names: set[str] = set()
    positional_entries: list[tuple[int, str, dict[str, Any]]] = []
    for arg_name, schema in arg_schema.items():
        if not isinstance(arg_name, str):
            continue
        schema_dict = schema if isinstance(schema, dict) else {}
        raw_position = schema_dict.get("position")
        if raw_position is None:
            continue
        try:
            position = int(raw_position)
        except (TypeError, ValueError):
            continue
        if position <= 0:
            continue
        positional_names.add(arg_name)
        positional_entries.append((position, arg_name, schema_dict))
    positional_entries.sort(key=lambda entry: (entry[0], entry[1]))
    for _, _arg_name, schema_dict in positional_entries:
        value_type = str(schema_dict.get("type", "value")).strip().lower() or "value"
        value_fragment = f"<{value_type}>"
        if schema_dict.get("required"):
            parts.append(value_fragment)
        else:
            parts.append(f"[{value_fragment}]")

    for arg_name, schema in arg_schema.items():
        if not isinstance(arg_name, str):
            continue
        if arg_name in positional_names:
            continue
        schema_dict = schema if isinstance(schema, dict) else {}
        flag = f"--{arg_name.replace('_', '-')}"
        value_type = str(schema_dict.get("type", "value")).strip().lower() or "value"
        value_fragment = f"<{value_type}>"
        if schema_dict.get("required"):
            parts.append(f"{flag} {value_fragment}")
        else:
            parts.append(f"[{flag} {value_fragment}]")
    suffix = f" {' '.join(parts)}" if parts else ""
    return f"{capability_id}{suffix}"


def _capability_arg_table(arg_schema: dict[str, Any]) -> str:
    if not arg_schema:
        return "- (none)"

    lines = [
        "| Name | Short | Positional | Type | Required | Default | Description |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]

    for arg_name, schema in arg_schema.items():
        if not isinstance(arg_name, str):
            continue
        schema_dict = schema if isinstance(schema, dict) else {}
        arg_type = str(schema_dict.get("type", "any")).strip() or "any"
        required = "Yes" if schema_dict.get("required") else "No"
        default = "N/A"
        if "default" in schema_dict:
            default = f"`{schema_dict.get('default')!r}`"
        description = str(schema_dict.get("description", "")).strip() or "N/A"
        short_aliases: list[str] = []
        raw_aliases = schema_dict.get("aliases")
        if isinstance(raw_aliases, list):
            for raw_alias in raw_aliases:
                if not isinstance(raw_alias, str):
                    continue
                alias = raw_alias.strip()
                if re.fullmatch(r"-[A-Za-z0-9]", alias):
                    short_aliases.append(alias)
        short_display = ", ".join(short_aliases) if short_aliases else "N/A"
        raw_position = schema_dict.get("position")
        position_display = "N/A"
        if isinstance(raw_position, int) and raw_position > 0:
            position_display = str(raw_position)
        display_name = f"--{arg_name.replace('_', '-')}"
        escaped_name = display_name.replace("|", "\\|")
        escaped_short = short_display.replace("|", "\\|")
        escaped_position = position_display.replace("|", "\\|")
        escaped_type = arg_type.replace("|", "\\|")
        escaped_description = description.replace("|", "\\|")

        lines.append(
            "| "
            + " | ".join(
                [
                    f"`{escaped_name}`",
                    f"`{escaped_short}`",
                    f"`{escaped_position}`",
                    f"`{escaped_type}`",
                    required,
                    default,
                    escaped_description,
                ]
            )
            + " |"
        )

    return "\n".join(lines)


def _capability_expected_output_summary(expected_output_schema: list[dict[str, str]]) -> str:
    if not expected_output_schema:
        return "- (none)"

    role_renderers = {
        "field": lambda type_name: f"Field with type `{type_name}`.",
        "echoed_input": lambda type_name: f"Echoed input identifier (type `{type_name}`).",
        "summary_details": lambda _type_name: "High-level summary details.",
        "file_list_summary": lambda _type_name: "List of file entries touched by the workflow.",
    }

    lines: list[str] = []
    for item in expected_output_schema:
        field_name = item["name"]
        type_name = item["type"]
        role = item.get("role", "field")
        renderer = role_renderers.get(role)
        if renderer is None:
            raise SkillRegistryError(f"unsupported output schema role `{role}`")
        lines.append(f"- `{field_name}`: {renderer(type_name)}")
    return "\n".join(lines)


def _workflow_output_schema_from_module(
    impl_module: str,
    capability_path: Path,
) -> list[dict[str, str]]:
    output_model = _workflow_output_model_from_module(
        impl_module=impl_module, capability_path=capability_path
    )
    parsed: list[dict[str, str]] = []
    allowed_roles = {"field", "echoed_input", "summary_details", "file_list_summary"}

    for field_name, field_info in output_model.model_fields.items():
        schema_extra = (
            field_info.json_schema_extra
            if isinstance(field_info.json_schema_extra, dict)
            else {}
        )
        if schema_extra.get("include_in_summary") is False:
            continue

        role = str(schema_extra.get("summary_role", "field")).strip() or "field"
        if role not in allowed_roles:
            raise SkillRegistryError(
                f"invalid OutputModel summary_role `{role}` for field `{field_name}` in {impl_module}"
            )

        parsed.append(
            {
                "name": field_name,
                "type": _annotation_to_schema_type(field_info.annotation),
                "role": role,
            }
        )

    if not parsed:
        raise SkillRegistryError(
            f"workflow OutputModel has no summary-visible fields: {impl_module} (from {capability_path})"
        )

    return parsed


def _workflow_output_model_from_module(
    impl_module: str,
    capability_path: Path,
) -> type[BaseModel]:
    try:
        module = importlib.import_module(impl_module)
    except Exception as exc:
        raise SkillRegistryError(
            f"failed to import workflow impl `{impl_module}` (from {capability_path}): {exc}"
        ) from exc

    output_model = getattr(module, "OutputModel", None)
    if not isinstance(output_model, type) or not issubclass(output_model, BaseModel):
        raise SkillRegistryError(
            f"workflow impl `{impl_module}` missing required OutputModel BaseModel class "
            f"(from {capability_path})"
        )
    return output_model


def _annotation_to_schema_type(annotation: Any) -> str:
    if annotation is None:
        return "null"
    if annotation is str:
        return "string"
    if annotation is int:
        return "integer"
    if annotation is float:
        return "number"
    if annotation is bool:
        return "boolean"
    if annotation in {dict, object, Any}:
        return "object"
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return "object"

    origin = get_origin(annotation)
    if origin is list:
        args = get_args(annotation)
        inner = _annotation_to_schema_type(args[0]) if args else "object"
        return f"list[{inner}]"
    if origin is dict:
        return "object"
    if origin in {tuple, set, frozenset}:
        return "list[object]"
    if origin in {UnionType, Union}:
        args = get_args(annotation)
        non_none = [item for item in args if item is not type(None)]
        has_none = len(non_none) != len(args)
        if len(non_none) == 1:
            base = _annotation_to_schema_type(non_none[0])
            return f"{base}|null" if has_none else base
        return "object|null" if has_none else "object"

    return "object"


_SECTION_MARKER = re.compile(r"^---\s*([A-Za-z0-9_.-]+)\s*---$")


def _parse_sections(body: str, path: Path) -> dict[str, str]:
    sections: dict[str, str] = {}
    current_name: str | None = None
    current_lines: list[str] = []

    for raw_line in body.splitlines():
        stripped = raw_line.strip()
        marker_match = _SECTION_MARKER.fullmatch(stripped)
        if marker_match:
            if current_name is not None:
                sections[current_name] = "\n".join(current_lines).strip("\n")
            current_name = marker_match.group(1).strip()
            current_lines = []
            if current_name in sections:
                raise SkillRegistryError(
                    f"duplicate section `{current_name}` in: {path}"
                )
            continue
        if current_name is not None:
            current_lines.append(raw_line)

    if current_name is not None:
        sections[current_name] = "\n".join(current_lines).strip("\n")

    return sections
