"""Focuses: presets of the assistant, read from `focus/*.md`.

    ---
    name: research
    label: Research            # shown in the mode picker
    description: One line, shown in the picker and to the model.
    skills: [github]           # skill docs loaded into the prompt up front
    ---
    A few lines added to the system prompt.

The user picks one for a chat; the assistant can also start a sub-agent with one.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml  # type: ignore[import-untyped]

from skills import SkillError, get_registry

FOCUS_ROOT = Path(__file__).resolve().parent / "focus"


@dataclass(frozen=True)
class Focus:
    name: str
    label: str
    description: str
    skills: tuple[str, ...]
    prompt: str


def _load(path: Path) -> Focus:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        raise SkillError(f"{path}: missing front matter")
    _, front, body = text.split("---", 2)
    meta = yaml.safe_load(front) or {}
    unknown = set(meta) - {"name", "label", "description", "skills"}
    if unknown:
        raise SkillError(f"{path}: unknown front matter keys: {', '.join(sorted(unknown))}")
    name = str(meta.get("name") or "")
    if name != path.stem:
        raise SkillError(f"{path}: `name` must match the file name `{path.stem}`")
    skills = tuple(meta.get("skills") or [])
    missing = [s for s in skills if s not in get_registry().skills]
    if missing:
        raise SkillError(f"{path}: unknown skills: {', '.join(missing)}")
    if not meta.get("label") or not meta.get("description"):
        raise SkillError(f"{path}: `label` and `description` are required")
    return Focus(
        name=name,
        label=str(meta["label"]),
        description=" ".join(str(meta["description"]).split()),
        skills=skills,
        prompt=body.strip(),
    )


_focuses: dict[str, Focus] | None = None


def get_focuses() -> dict[str, Focus]:
    global _focuses
    if _focuses is None:
        _focuses = {f.name: f for f in (_load(p) for p in sorted(FOCUS_ROOT.glob("*.md")))}
    return _focuses


def focus_index() -> str:
    return "\n".join(f"- `{f.name}`: {f.description}" for f in get_focuses().values()) or "- (none)"
