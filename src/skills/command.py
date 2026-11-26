"""Splitting a command line the way a shell would, for the agent's one tool, `run`.

    web search "k3s ingress" -n 5
    agent --type research --bg <<'EOF'
    Find the current Node.js LTS and link its release notes.
    EOF

Words are split with shell quoting. One heredoc may follow the command's words: its
text is the command's input, kept exactly as written (no quoting or `$` expansion,
whatever the marker's quotes). `--bg` anywhere before `--` asks for a background job.
"""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass

BACKGROUND_FLAG = "--bg"
_HEREDOC = re.compile(r"<<-?[ \t]*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")


class CommandSyntaxError(ValueError):
    """A command line that can't be split; the message says how to fix it."""


@dataclass(frozen=True)
class CommandLine:
    words: list[str]
    input: str | None = None  # the heredoc's text
    background: bool = False


def _heredoc(command: str) -> tuple[str, str | None]:
    """The command without its heredoc, and the heredoc's text."""
    for match in _HEREDOC.finditer(command):
        head = command[: match.start()]
        try:
            shlex.split(head)
        except ValueError:
            continue  # inside an open quote, so not a heredoc
        line_end = command.find("\n", match.end())
        rest_of_line = command[match.end() : line_end if line_end >= 0 else len(command)]
        if line_end < 0:
            raise CommandSyntaxError(
                f"The heredoc's text goes on the lines after `<<{match.group(2)}`, "
                f"ending with a line that is just `{match.group(2)}`."
            )
        marker = match.group(2)
        lines = command[line_end + 1 :].split("\n")
        end = next((i for i, line in enumerate(lines) if line.strip() == marker), None)
        body = lines if end is None else lines[:end]
        after = "" if end is None else "\n".join(lines[end + 1 :])
        if after.strip():
            raise CommandSyntaxError(
                f"Only one command per call: found more after the heredoc's `{marker}` line."
            )
        return head + rest_of_line, "\n".join(body)
    return command, None


def split_command(command: str) -> CommandLine:
    line, text = _heredoc(command.strip())
    try:
        words = shlex.split(line)
    except ValueError as e:
        raise CommandSyntaxError(f"Can't read the command ({e}); check its quotes.") from e
    end = words.index("--") if "--" in words else len(words)
    background = BACKGROUND_FLAG in words[:end]
    if background:
        words = [w for w in words[:end] if w != BACKGROUND_FLAG] + words[end:]
    return CommandLine(words=words, input=text, background=background)


def quote(value: str) -> str:
    return shlex.quote(value)


def with_heredoc(command: str, text: str) -> str:
    """`command` with `text` as its heredoc, choosing a marker the text doesn't contain."""
    marker = "EOF"
    lines = {line.strip() for line in text.split("\n")}
    n = 1
    while marker in lines:
        n += 1
        marker = f"EOF{n}"
    return f"{command} <<'{marker}'\n{text}\n{marker}"
