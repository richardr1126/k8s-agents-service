"""Skills: instruction docs the agent reads on demand, each optionally declaring workflows.

A skill is a folder `src/skills/<name>/` with a `SKILL.md`:

    ---
    name: github
    description: One line the agent sees in its prompt for choosing the skill.
    workflows:
      commits:
        description: One line shown in the skill's doc.
        impl: skills.github.workflows:commits   # module:function
        background: false                       # true runs it as a job
        args:
          repo: {type: string, required: true, description: ...}
          limit: {type: integer, default: 10}
    ---
    Markdown body: when and how to use the skill.

Workflow ids are `<skill>.<workflow>`. The registry is read from disk at
startup, so adding or editing a folder is all it takes to change what the
agent sees.
"""

from __future__ import annotations

import importlib
import inspect
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml  # type: ignore[import-untyped]
from pydantic import BaseModel, ConfigDict, Field, ValidationError, create_model

SKILLS_ROOT = Path(__file__).resolve().parent

_TYPES: dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "array": list[str],
}


class SkillError(ValueError):
    """A SKILL.md is invalid."""


@dataclass(frozen=True)
class Workflow:
    id: str  # "<skill>.<name>"
    description: str
    impl: str
    background: bool
    args: dict[str, dict[str, Any]]
    model: type[BaseModel] = field(repr=False)

    def resolve(self) -> Callable[..., Any]:
        module_name, _, attr = self.impl.partition(":")
        return getattr(importlib.import_module(module_name), attr)

    def validate(self, args: dict[str, Any]) -> dict[str, Any]:
        """Validated arguments with defaults; raises ValueError with a readable message."""
        try:
            return self.model.model_validate(args).model_dump()
        except ValidationError as e:
            problems = "; ".join(
                f"{'.'.join(str(p) for p in err['loc']) or 'args'}: {err['msg']}"
                for err in e.errors()
            )
            raise ValueError(f"Invalid arguments for `{self.id}`: {problems}") from e

    def usage(self) -> str:
        lines = [
            f"### `{self.id}`{' (runs in the background)' if self.background else ''}",
            self.description,
        ]
        if not self.args:
            lines.append("- No arguments.")
        for name, spec in self.args.items():
            bits = [spec.get("type", "string")]
            if spec.get("required"):
                bits.append("required")
            elif "default" in spec:
                bits.append(f"default {spec['default']!r}")
            if spec.get("enum"):
                bits.append("one of " + ", ".join(repr(v) for v in spec["enum"]))
            desc = spec.get("description", "")
            lines.append(f"- `{name}` ({', '.join(bits)}){': ' + desc if desc else ''}")
        return "\n".join(lines)


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    body: str
    workflows: dict[str, Workflow]
    path: Path

    def doc(self, *, include_background: bool = True) -> str:
        parts = [f"# Skill: {self.name}", self.description, "", self.body.strip()]
        shown = [w for w in self.workflows.values() if include_background or not w.background]
        if shown:
            parts += [
                "",
                "## Workflows",
                "Run one with `run_workflow(workflow=..., arguments={...})`.",
                "",
            ]
            parts += [w.usage() + "\n" for w in shown]
        return "\n".join(parts).strip() + "\n"


def _arg_model(workflow_id: str, args: dict[str, dict[str, Any]], path: Path) -> type[BaseModel]:
    fields: dict[str, Any] = {}
    for name, spec in args.items():
        if not isinstance(spec, dict):
            raise SkillError(f"{path}: argument `{name}` of `{workflow_id}` must be a mapping")
        kind = spec.get("type", "string")
        if kind not in _TYPES:
            raise SkillError(f"{path}: argument `{name}` has unknown type `{kind}`")
        annotation: Any = _TYPES[kind]
        if spec.get("enum"):
            annotation = Literal[tuple(spec["enum"])]  # type: ignore[valid-type]
        info: dict[str, Any] = {"description": spec.get("description")}
        for bound in ("ge", "le", "max_length"):
            if bound in spec:
                info[bound] = spec[bound]
        if spec.get("required"):
            fields[name] = (annotation, Field(..., **info))
        else:
            fields[name] = (annotation | None, Field(spec.get("default"), **info))
    return create_model(
        f"Args_{workflow_id.replace('.', '_')}",
        __config__=ConfigDict(extra="forbid"),
        **fields,
    )


def _parse(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        raise SkillError(f"{path}: missing front matter")
    _, front, body = text.split("---", 2)
    meta = yaml.safe_load(front) or {}
    if not isinstance(meta, dict):
        raise SkillError(f"{path}: front matter must be a mapping")
    return meta, body


def load_skill(path: Path) -> Skill:
    meta, body = _parse(path)
    unknown = set(meta) - {"name", "description", "workflows"}
    if unknown:
        raise SkillError(f"{path}: unknown front matter keys: {', '.join(sorted(unknown))}")
    name = str(meta.get("name") or "").strip()
    description = " ".join(str(meta.get("description") or "").split())
    if not name or name != path.parent.name:
        raise SkillError(f"{path}: `name` must match the folder name `{path.parent.name}`")
    if not description:
        raise SkillError(f"{path}: `description` is required")
    workflows: dict[str, Workflow] = {}
    for wf_name, spec in (meta.get("workflows") or {}).items():
        wf_id = f"{name}.{wf_name}"
        if not isinstance(spec, dict) or not spec.get("impl") or not spec.get("description"):
            raise SkillError(f"{path}: workflow `{wf_name}` needs `impl` and `description`")
        unknown = set(spec) - {"description", "impl", "background", "args"}
        if unknown:
            raise SkillError(
                f"{path}: workflow `{wf_name}` has unknown keys: {', '.join(sorted(unknown))}"
            )
        args = spec.get("args") or {}
        workflows[wf_id] = Workflow(
            id=wf_id,
            description=" ".join(str(spec["description"]).split()),
            impl=str(spec["impl"]),
            background=bool(spec.get("background", False)),
            args=args,
            model=_arg_model(wf_id, args, path),
        )
    return Skill(name=name, description=description, body=body, workflows=workflows, path=path)


class SkillRegistry:
    def __init__(self, root: Path = SKILLS_ROOT) -> None:
        self.root = root
        self.skills: dict[str, Skill] = {}
        for path in sorted(root.glob("*/SKILL.md")):
            skill = load_skill(path)
            self.skills[skill.name] = skill
        self.workflows: dict[str, Workflow] = {
            wid: wf for skill in self.skills.values() for wid, wf in skill.workflows.items()
        }

    def check_impls(self) -> None:
        """Import every workflow's function; raises SkillError naming the first broken one."""
        for wf in self.workflows.values():
            try:
                fn = wf.resolve()
            except Exception as e:
                raise SkillError(f"{wf.id}: cannot import `{wf.impl}`: {e}") from e
            if not callable(fn):
                raise SkillError(f"{wf.id}: `{wf.impl}` is not callable")

    def index(self, names: list[str] | None = None) -> str:
        """One line per skill, for the system prompt."""
        lines = []
        for skill in self.skills.values():
            if names is not None and skill.name not in names:
                continue
            wfs = ", ".join(w.split(".", 1)[1] for w in skill.workflows) or "instructions only"
            lines.append(f"- `{skill.name}`: {skill.description} (workflows: {wfs})")
        return "\n".join(lines) or "- (none)"


async def call_workflow(fn: Callable[..., Any], args: dict[str, Any], context: Any) -> Any:
    """Calls a workflow function, passing `ctx` only to functions that take it."""
    kwargs = dict(args)
    if "ctx" in inspect.signature(fn).parameters:
        kwargs["ctx"] = context
    result = fn(**kwargs)
    if inspect.isawaitable(result):
        result = await result
    return result


_registry: SkillRegistry | None = None


def get_registry() -> SkillRegistry:
    global _registry
    if _registry is None:
        _registry = SkillRegistry()
    return _registry
