"""Skills: instruction docs the agent reads on demand, each optionally declaring workflows.

A skill is a folder `src/skills/<name>/` with a `SKILL.md`:

    ---
    name: github
    description: One line the agent sees in its prompt for choosing the skill.
    workflows:
      commits:
        description: One line shown in the skill's doc.
        impl: skills.github.workflows:commits   # module:function
        background: optional   # never | optional (the default) | always: whether it runs as a job
        args:
          repo: {type: string, required: true, positional: true, description: ...}
          limit: {type: integer, default: 10, short: L}
    ---
    Markdown body: when and how to use the skill.

Workflow ids are `<skill>.<workflow>`, and the agent runs one as a command line in
the style of familiar CLIs, `github.commits openreader -L 5`:
- `positional: true` lets the argument be given by place as well as by `--name`;
  `positional: rest` (last positional only) takes all remaining words, so an
  unquoted question still arrives whole.
- `short: L` adds a one-letter flag, `-L`.
The registry is read from disk at startup, so adding or editing a folder is all
it takes to change what the agent sees.
"""

from __future__ import annotations

import argparse
import difflib
import importlib
import inspect
import shlex
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, NoReturn

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


Background = Literal["never", "optional", "always"]
BACKGROUND: tuple[Background, ...] = ("never", "optional", "always")


class SkillError(ValueError):
    """A SKILL.md is invalid."""


class CommandError(ValueError):
    """A workflow command that can't run, with a message that says how to fix it."""


class _Parser(argparse.ArgumentParser):
    """Raises CommandError instead of printing and exiting."""

    def error(self, message: str) -> NoReturn:
        raise CommandError(f"{message}\n{self.format_usage().strip()}")


def _flag(name: str) -> str:
    return "--" + name.replace("_", "-")


def _pos(name: str) -> str:
    return f"_pos_{name}"


def _metavar(name: str, spec: dict[str, Any]) -> str:
    if spec.get("enum"):
        return "{" + ",".join(str(v) for v in spec["enum"]) + "}"
    return {"integer": "N", "number": "X"}.get(spec.get("type", "string"), name.upper())


@dataclass(frozen=True)
class Workflow:
    id: str  # "<skill>.<name>"
    description: str
    impl: str
    background: Background
    args: dict[str, dict[str, Any]]
    model: type[BaseModel] = field(repr=False)

    def resolve(self) -> Callable[..., Any]:
        module_name, _, attr = self.impl.partition(":")
        return getattr(importlib.import_module(module_name), attr)

    def parser(self) -> argparse.ArgumentParser:
        """The workflow's command-line options: `--name` (and `-x`) per argument, plus
        a positional word for arguments marked `positional`."""
        parser = _Parser(
            prog=self.id,
            usage=self.command(),
            add_help=False,
            allow_abbrev=False,
            exit_on_error=False,
        )
        for name, spec in self.args.items():
            kind = spec.get("type", "string")
            flags = list(dict.fromkeys([_flag(name), f"--{name}"]))
            if spec.get("short"):
                flags.insert(0, f"-{spec['short']}")
            options: dict[str, Any] = {"dest": name, "help": spec.get("description")}
            if kind == "boolean":
                options["action"] = argparse.BooleanOptionalAction
            else:
                options["type"] = {"integer": int, "number": float}.get(kind, str)
                options["metavar"] = _metavar(name, spec)
                if kind == "array":
                    options["nargs"] = "+"
            if spec.get("enum"):
                options["choices"] = spec["enum"]
                options.pop("metavar")
            # Positional arguments are checked after parsing, as either form may give them.
            options["required"] = bool(spec.get("required")) and not spec.get("positional")
            parser.add_argument(*flags, **options)
            if spec.get("positional"):
                many = kind == "array" or spec["positional"] == "rest"
                pos: dict[str, Any] = {"nargs": "*" if many else "?", "metavar": name.upper()}
                if kind != "array" and spec["positional"] != "rest":
                    pos["type"] = options["type"]
                    if spec.get("enum"):
                        pos["choices"] = spec["enum"]
                parser.add_argument(_pos(name), **pos)
        return parser

    def parse(self, argv: list[str]) -> dict[str, Any]:
        """Validated arguments from command-line words; raises CommandError."""
        parser = self.parser()
        usage = parser.format_usage().strip()
        try:
            # Intermixed, so positionals may come before or after the options.
            parsed = vars(parser.parse_intermixed_args(argv))
        except argparse.ArgumentError as e:  # raised as-is with exit_on_error=False
            raise CommandError(f"{e}\n{usage}") from e
        for name, spec in self.args.items():
            if not spec.get("positional"):
                continue
            given = parsed.pop(_pos(name), None)
            if given in (None, []):
                if spec.get("required") and parsed.get(name) is None:
                    raise CommandError(f"missing {name.upper()} (or {_flag(name)})\n{usage}")
                continue
            if parsed.get(name) is not None:
                raise CommandError(
                    f"{name.upper()} given twice, by place and by {_flag(name)}\n{usage}"
                )
            if isinstance(given, list) and spec.get("type") != "array":
                given = " ".join(given)
            parsed[name] = given
        try:
            return self.validate({k: v for k, v in parsed.items() if v is not None})
        except ValueError as e:
            raise CommandError(f"{e}\n{usage}") from e

    def command(self) -> str:
        """The command's usage line, e.g. `github.commits REPO [-L N]`."""
        words = [self.id]
        for name, spec in self.args.items():
            if spec.get("positional"):
                word = name.upper() + (" ..." if spec["positional"] == "rest" else "")
            elif spec.get("type") == "boolean":
                word = f"--[no-]{name.replace('_', '-')}"
            else:
                flag = f"-{spec['short']}" if spec.get("short") else _flag(name)
                word = f"{flag} {_metavar(name, spec)}"
                if spec.get("type") == "array":
                    word += " ..."
            words.append(word if spec.get("required") else f"[{word}]")
        return " ".join(words)

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
        note = {
            "always": " (always runs in the background)",
            "optional": "",
            "never": " (can't run in the background)",
        }[self.background]
        lines = [f"### `{self.id}`{note}", self.description, f"`{self.command()}`"]
        for name, spec in self.args.items():
            bits = [spec.get("type", "string")]
            if spec.get("required"):
                bits.append("required")
            elif "default" in spec:
                bits.append(f"default {spec['default']!r}")
            if spec.get("enum"):
                bits.append("one of " + ", ".join(repr(v) for v in spec["enum"]))
            desc = spec.get("description", "")
            names = [_flag(name)]
            if spec.get("short"):
                names.insert(0, f"-{spec['short']}")
            if spec.get("positional"):
                names.insert(0, name.upper())
            label = ", ".join(f"`{n}`" for n in names)
            lines.append(f"- {label} ({', '.join(bits)}){': ' + desc if desc else ''}")
        return "\n".join(lines)


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    body: str
    workflows: dict[str, Workflow]
    path: Path

    def doc(self) -> str:
        parts = [f"# Skill: {self.name}", self.description, "", self.body.strip()]
        shown = list(self.workflows.values())
        if shown:
            parts += [
                "",
                "## Workflows",
                'Run one with `run_workflow(command="<workflow> ARG --option value ...")`, as'
                " in the usage lines; quote values with spaces."
                " Add `background=true` to run it as a job.",
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


def _check_cli(path: Path, workflow_id: str, args: dict[str, Any]) -> None:
    """`positional` and `short` must make an unambiguous command line."""
    shorts: set[str] = set()
    positional = [
        n for n, spec in args.items() if isinstance(spec, dict) and spec.get("positional")
    ]
    for name, spec in args.items():
        if not isinstance(spec, dict):
            continue
        short = spec.get("short")
        if short is not None:
            if not (
                isinstance(short, str) and len(short) == 1 and short.isalpha() and short != "h"
            ):
                raise SkillError(
                    f"{path}: `{workflow_id}` `{name}`: `short` must be one letter, not h"
                )
            if short in shorts:
                raise SkillError(f"{path}: `{workflow_id}` uses `-{short}` twice")
            shorts.add(short)
        mode = spec.get("positional")
        if mode not in (None, False, True, "rest"):
            raise SkillError(f"{path}: `{workflow_id}` `{name}`: `positional` is true or rest")
        if mode and spec.get("type") == "boolean":
            raise SkillError(f"{path}: `{workflow_id}` `{name}`: a boolean can't be positional")
        many = mode == "rest" or (mode and spec.get("type") == "array")
        if many and name != positional[-1]:
            raise SkillError(
                f"{path}: `{workflow_id}` `{name}` takes the remaining words, so it must be the"
                " last positional argument"
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
        _check_cli(path, wf_id, args)
        background = spec.get("background", "optional")
        if background not in BACKGROUND:
            raise SkillError(
                f"{path}: workflow `{wf_name}` has background `{background}`; "
                f"use one of {', '.join(BACKGROUND)}"
            )
        workflows[wf_id] = Workflow(
            id=wf_id,
            description=" ".join(str(spec["description"]).split()),
            impl=str(spec["impl"]),
            background=background,
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

    def parse_command(self, command: str) -> tuple[Workflow, dict[str, Any]]:
        """The workflow a command names and its validated arguments; raises CommandError.

        `<workflow> --help` raises one too, carrying the workflow's usage.
        """
        try:
            words = shlex.split(command)
        except ValueError as e:
            raise CommandError(f"Can't read the command ({e}); check its quotes.") from e
        if not words:
            raise CommandError(
                "The command is empty. Start it with a workflow id, e.g. `github.repo.list`."
            )
        name, argv = words[0], words[1:]
        wf = self.workflows.get(name)
        if wf is None:
            close = difflib.get_close_matches(name, self.workflows, n=3, cutoff=0.5)
            hint = f" Did you mean {', '.join(f'`{c}`' for c in close)}?" if close else ""
            raise CommandError(
                f"No workflow named `{name}`.{hint} Workflows: {', '.join(self.workflows) or 'none'}."
            )
        if any(word in ("-h", "--help") for word in argv):
            raise CommandError(wf.usage())
        return wf, wf.parse(argv)

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
