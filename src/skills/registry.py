"""Skills: instruction docs the agent reads on demand, each optionally declaring workflows.

A skill is a folder `src/skills/<name>/` with a `SKILL.md`:

    ---
    name: github
    description: One line the agent sees in its prompt for choosing the skill.
    ui: {icon: github, label: GitHub}          # how the chat's tool cards show it
    workflows:
      commits:
        description: One line shown in the skill's doc.
        impl: skills.github.workflows:commits   # module:function
        background: optional   # never | optional (the default) | always: whether it runs as a job
        ui: {activity: Reading commits}         # what the chat shows while it runs
        args:
          repo: {type: string, required: true, positional: true, description: ...}
          limit: {type: integer, default: 10, short: L}
    ---
    Markdown body: when and how to use the skill.

The agent runs a workflow as a command line in the style of `gh`: the skill's name,
then the workflow's words (`repo.list` is typed `repo list`), then its arguments,
`github commits openreader -L 5`. A workflow named `main` is the skill's own command,
typed as just the skill's name. `<skill> --help` shows the skill's doc, and
`<skill> <workflow> --help` one workflow's usage.
- `positional: true` lets the argument be given by place as well as by `--name`;
  `positional: rest` (last positional only) takes all remaining words, so an
  unquoted question still arrives whole.
- `short: L` adds a one-letter flag, `-L`.
- `input: true` (one string argument per workflow) lets a heredoc after the command
  give the argument's text, for long text that is awkward to quote.
The registry is read from disk at startup, so adding or editing a folder is all
it takes to change what the agent sees.
"""

from __future__ import annotations

import argparse
import difflib
import importlib
import inspect
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, NoReturn

import yaml  # type: ignore[import-untyped]
from pydantic import BaseModel, ConfigDict, Field, ValidationError, create_model

from skills.command import CommandSyntaxError, split_command

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


class CommandHelp(CommandError):
    """Not a mistake: the command asked for help, and the message is it."""


MAIN = "main"
_SKILL_UI = {"icon", "label"}
_WORKFLOW_UI = {"activity", "card"}
CARDS = ("default", "subagent")


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
    id: str  # the command that runs it: "<skill> <words>", or "<skill>" for `main`
    skill: str
    description: str
    impl: str
    background: Background
    args: dict[str, dict[str, Any]]
    model: type[BaseModel] = field(repr=False)
    ui: dict[str, str] = field(default_factory=dict)

    @property
    def input_arg(self) -> str | None:
        """The argument a heredoc fills, if any."""
        return next((n for n, spec in self.args.items() if spec.get("input")), None)

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
            options["required"] = (
                bool(spec.get("required")) and not spec.get("positional") and not spec.get("input")
            )
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

    def parse(self, argv: list[str], text: str | None = None) -> dict[str, Any]:
        """Validated arguments from command-line words and a heredoc's text; raises CommandError."""
        parser = self.parser()
        usage = parser.format_usage().strip()
        try:
            # Intermixed, so positionals may come before or after the options.
            parsed = vars(parser.parse_intermixed_args(argv))
        except argparse.ArgumentError as e:  # raised as-is with exit_on_error=False
            raise CommandError(f"{e}\n{usage}") from e
        piped = self.input_arg
        if text is not None:
            if piped is None:
                raise CommandError(f"`{self.id}` doesn't read a heredoc.\n{usage}")
            if parsed.get(piped) is not None or parsed.get(_pos(piped)) not in (None, []):
                raise CommandError(
                    f"{piped.upper()} given twice, in the command and in the heredoc\n{usage}"
                )
            parsed[piped] = text
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
        """The command's usage line, e.g. `github commits REPO [-L N]`."""
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
        if self.input_arg:
            words.append(f"[<<'EOF' {self.input_arg.upper()} EOF]")
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
            if spec.get("input"):
                names.append("heredoc")
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
    ui: dict[str, str] = field(default_factory=dict)

    def doc(self) -> str:
        parts = [f"# Skill: {self.name}", self.description, "", self.body.strip()]
        shown = list(self.workflows.values())
        if shown:
            parts += [
                "",
                "## Commands",
                "Run one with `run`, as in its usage line; quote values with spaces. Add `--bg` to"
                " run it as a background job. A heredoc gives the text of an argument marked"
                " `heredoc`.",
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
        f"Args_{re.sub(r'[^A-Za-z0-9]', '_', workflow_id)}",
        __config__=ConfigDict(extra="forbid"),
        **fields,
    )


def _check_cli(path: Path, workflow_id: str, args: dict[str, Any]) -> None:
    """`positional` and `short` must make an unambiguous command line."""
    shorts: set[str] = set()
    if sum(1 for spec in args.values() if isinstance(spec, dict) and spec.get("input")) > 1:
        raise SkillError(f"{path}: `{workflow_id}`: only one argument can take `input`")
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
        if spec.get("input") and spec.get("type", "string") != "string":
            raise SkillError(f"{path}: `{workflow_id}` `{name}`: only a string can take `input`")
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
    unknown = set(meta) - {"name", "description", "workflows", "ui"}
    if unknown:
        raise SkillError(f"{path}: unknown front matter keys: {', '.join(sorted(unknown))}")
    name = str(meta.get("name") or "").strip()
    description = " ".join(str(meta.get("description") or "").split())
    if not name or name != path.parent.name:
        raise SkillError(f"{path}: `name` must match the folder name `{path.parent.name}`")
    if not description:
        raise SkillError(f"{path}: `description` is required")
    ui = _ui(path, "the skill", meta.get("ui"), _SKILL_UI)
    workflows: dict[str, Workflow] = {}
    for wf_name, spec in (meta.get("workflows") or {}).items():
        words = str(wf_name).split(".")
        if not all(re.fullmatch(r"[a-z][a-z0-9-]*", w) for w in words):
            raise SkillError(f"{path}: workflow `{wf_name}`: use lowercase words joined by dots")
        wf_id = name if wf_name == MAIN else " ".join([name, *words])
        if not isinstance(spec, dict) or not spec.get("impl") or not spec.get("description"):
            raise SkillError(f"{path}: workflow `{wf_name}` needs `impl` and `description`")
        unknown = set(spec) - {"description", "impl", "background", "args", "ui"}
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
        wf_ui = _ui(path, f"workflow `{wf_name}`", spec.get("ui"), _WORKFLOW_UI)
        if wf_ui.get("card", "default") not in CARDS:
            raise SkillError(f"{path}: workflow `{wf_name}`: `card` is one of {', '.join(CARDS)}")
        workflows[wf_id] = Workflow(
            id=wf_id,
            skill=name,
            description=" ".join(str(spec["description"]).split()),
            impl=str(spec["impl"]),
            background=background,
            args=args,
            model=_arg_model(wf_id, args, path),
            ui=wf_ui,
        )
    return Skill(
        name=name, description=description, body=body, workflows=workflows, path=path, ui=ui
    )


def _ui(path: Path, where: str, value: Any, keys: set[str]) -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, dict) or set(value) - keys:
        raise SkillError(f"{path}: {where}: `ui` takes {', '.join(sorted(keys))}")
    return {k: str(v) for k, v in value.items()}


@dataclass(frozen=True)
class Parsed:
    workflow: Workflow
    args: dict[str, Any]
    background: bool


_STOP = set(
    "a an and are as at be by can do for from get how i in is it me my of on or the this to "
    "what when where which who why with you your".split()
)


def _terms(text: str) -> set[str]:
    """Lowercase word stems, for matching a search to skills and workflows."""
    out = set()
    for word in re.findall(r"[a-z0-9]+", text.lower()):
        if word in _STOP or len(word) < 2:
            continue
        for suffix in ("ing", "es", "s"):
            if len(word) > len(suffix) + 2 and word.endswith(suffix):
                word = word[: -len(suffix)]
                break
        out.add(word)
    return out


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

    def parse(self, command: str, *, hidden: frozenset[str] = frozenset()) -> Parsed:
        """The workflow a command line names, its validated arguments and whether it asked
        for the background. Raises CommandError, or CommandHelp for `--help`. Skills in
        `hidden` are refused, as if they didn't exist."""
        try:
            line = split_command(command)
        except CommandSyntaxError as e:
            raise CommandError(str(e)) from e
        words = line.words
        skills = {n: s for n, s in self.skills.items() if n not in hidden}
        if not words:
            raise CommandError(
                "The command is empty. Start it with a skill, e.g. `skills search <what you need>`."
            )
        if "." in words[0] and words[0].split(".", 1)[0] in skills:
            words = [*words[0].split("."), *words[1:]]  # the older `github.repo.list` form
        skill = skills.get(words[0])
        if skill is None:
            close = difflib.get_close_matches(words[0], skills, n=3, cutoff=0.5)
            hint = f" Did you mean {', '.join(f'`{c}`' for c in close)}?" if close else ""
            raise CommandError(
                f"No skill named `{words[0]}`.{hint} Skills: {', '.join(skills) or 'none'}. "
                "`skills search <what you need>` finds the right one."
            )
        wf, argv = None, words[1:]
        for n in range(len(words), 0, -1):
            found = skill.workflows.get(" ".join(words[:n]))
            if found is not None:
                wf, argv = found, words[n:]
                break
        asked_help = any(word in ("-h", "--help") for word in argv)
        if wf is None or (wf.id == skill.name and asked_help and not argv[1:]):
            if wf is None and argv and not asked_help:
                asked = " ".join(words[:2])
                rest = {w.removeprefix(skill.name).strip(): w for w in skill.workflows}
                close = list(
                    dict.fromkeys(
                        rest[c]
                        for n in (1, 2, 3)
                        for c in difflib.get_close_matches(" ".join(argv[:n]), rest, cutoff=0.6)
                    )
                )[:3]
                hint = f" Did you mean {', '.join(f'`{c}`' for c in close)}?" if close else ""
                commands = ", ".join(f"`{w}`" for w in skill.workflows) or "none"
                raise CommandError(
                    f"`{skill.name}` has no command `{asked}`.{hint} Commands: {commands}."
                    f" `{skill.name} --help` shows how to use them."
                )
            raise CommandHelp(skill.doc())
        if asked_help:
            raise CommandHelp(wf.usage())
        return Parsed(wf, wf.parse(argv, line.input), line.background)

    def parse_command(self, command: str) -> tuple[Workflow, dict[str, Any]]:
        parsed = self.parse(command)
        return parsed.workflow, parsed.args

    def index(self, names: list[str] | None = None, *, hidden: frozenset[str] = frozenset()) -> str:
        """One line per skill, for the system prompt."""
        lines = []
        for skill in self.skills.values():
            if (names is not None and skill.name not in names) or skill.name in hidden:
                continue
            commands = [w.removeprefix(skill.name).strip() or skill.name for w in skill.workflows]
            listed = ", ".join(commands) or "instructions only"
            lines.append(f"- `{skill.name}`: {skill.description} (commands: {listed})")
        return "\n".join(lines) or "- (none)"

    def search(
        self, query: str, *, limit: int = 8, hidden: frozenset[str] = frozenset()
    ) -> list[tuple[Skill, Workflow | None]]:
        """The skills and workflows that best match `query`, best first."""
        wanted = _terms(query)
        scored: list[tuple[float, int, Skill, Workflow | None]] = []
        order = 0
        for skill in self.skills.values():
            if skill.name in hidden:
                continue
            skill_terms = _terms(f"{skill.name} {skill.description}")
            body_terms = _terms(skill.body)
            base = 2 * len(wanted & skill_terms) + 0.5 * len(wanted & body_terms)
            if not skill.workflows and base:
                scored.append((base, order, skill, None))
            for wf in skill.workflows.values():
                order += 1
                arg_text = " ".join(str(a.get("description", "")) for a in wf.args.values())
                score = (
                    base
                    + 3 * len(wanted & _terms(wf.id))
                    + 2 * len(wanted & _terms(wf.description))
                    + len(wanted & _terms(arg_text))
                )
                if score:
                    scored.append((score, order, skill, wf))
        scored.sort(key=lambda x: (-x[0], x[1]))
        return [(skill, wf) for _, _, skill, wf in scored[:limit]]

    def catalog(self) -> list[dict[str, Any]]:
        """What the chat needs to show each command's card."""
        return [
            {
                "name": skill.name,
                "description": skill.description,
                "ui": skill.ui,
                "workflows": [
                    {
                        "id": wf.id,
                        "description": wf.description,
                        "background": wf.background,
                        "ui": wf.ui,
                    }
                    for wf in skill.workflows.values()
                ],
            }
            for skill in self.skills.values()
        ]


async def call_workflow(fn: Callable[..., Any], args: dict[str, Any], context: Any) -> Any:
    """Calls a workflow function, passing `ctx` only to functions that take it."""
    kwargs = dict(args)
    if "ctx" in inspect.signature(fn).parameters:
        kwargs["ctx"] = context
    result = fn(**kwargs)
    if inspect.isawaitable(result):
        result = await result
    return result


def hidden_skills(config: Any) -> frozenset[str]:
    """Skills a run can't use: sub-agents can't start sub-agents."""
    configurable = (config or {}).get("configurable") or {} if isinstance(config, dict) else {}
    return frozenset({"agent"}) if configurable.get("assistant_subagent") else frozenset()


_registry: SkillRegistry | None = None


def get_registry() -> SkillRegistry:
    global _registry
    if _registry is None:
        _registry = SkillRegistry()
    return _registry
