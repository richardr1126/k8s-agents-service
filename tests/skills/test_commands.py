"""Command lines as the agent writes them: words, heredocs, `--bg`, help and search."""

from pathlib import Path

import pytest

from skills import CommandError, CommandHelp, SkillRegistry, get_registry
from skills.command import CommandSyntaxError, split_command, with_heredoc

BRIEF = """Find the current Node.js LTS.
It's "quoted", has a $HOME and a \\backslash,
  and keeps its indentation."""


def test_words_split_like_a_shell() -> None:
    line = split_command("web search 'k3s ingress' -n 5")
    assert line.words == ["web", "search", "k3s ingress", "-n", "5"]
    assert line.input is None and not line.background


def test_a_heredoc_is_the_input_exactly_as_written() -> None:
    for marker in ("'EOF'", '"EOF"', "EOF"):
        line = split_command(f"agent --type research <<{marker}\n{BRIEF}\nEOF")
        assert line.words == ["agent", "--type", "research"]
        assert line.input == BRIEF


def test_with_heredoc_picks_a_marker_the_text_lacks() -> None:
    text = "first\nEOF\nlast"
    command = with_heredoc("agent", text)
    assert "<<'EOF2'" in command
    assert split_command(command).input == text


def test_words_after_the_marker_still_count() -> None:
    line = split_command("agent <<'EOF' --type research\nbrief\nEOF\n")
    assert line.words == ["agent", "--type", "research"] and line.input == "brief"


def test_a_missing_end_marker_takes_the_rest() -> None:
    assert split_command("agent <<'EOF'\nbrief\nmore").input == "brief\nmore"


def test_quoted_angle_brackets_are_not_a_heredoc() -> None:
    line = split_command("web search 'a <<EOF b'")
    assert line.words == ["web", "search", "a <<EOF b"] and line.input is None


@pytest.mark.parametrize(
    ("command", "says"),
    [
        ("agent <<'EOF'", "lines after"),
        ("agent <<'EOF'\nbrief\nEOF\nweb search x", "Only one command per call"),
        ("web search 'open", "check its quotes"),
    ],
)
def test_bad_lines_say_what_to_fix(command: str, says: str) -> None:
    with pytest.raises(CommandSyntaxError) as e:
        split_command(command)
    assert says in str(e.value)


def test_bg_asks_for_the_background_and_is_removed() -> None:
    line = split_command("papers podcast --bg rag -n 3")
    assert line.background and line.words == ["papers", "podcast", "rag", "-n", "3"]
    # After `--`, it's an argument like any other word.
    line = split_command("web search -- --bg")
    assert not line.background and line.words == ["web", "search", "--", "--bg"]


SKILL = """---
name: demo
description: A demo for testing commands.
ui: {icon: box, label: Demo}
workflows:
  main:
    description: The skill's own command.
    impl: os:getcwd
    args:
      text: {type: string, required: true, positional: rest, input: true}
      loud: {type: boolean, default: false}
  repo.list:
    description: Lists repositories.
    impl: os:getcwd
    ui: {activity: Listing}
    args:
      limit: {type: integer, default: 5, short: L}
---
Use it carefully.
"""


@pytest.fixture
def demo(tmp_path: Path) -> SkillRegistry:
    folder = tmp_path / "demo"
    folder.mkdir()
    (folder / "SKILL.md").write_text(SKILL)
    return SkillRegistry(tmp_path)


def test_commands_are_the_skill_then_its_words(demo: SkillRegistry) -> None:
    parsed = demo.parse("demo repo list -L 2")
    assert parsed.workflow.id == "demo repo list" and parsed.args == {"limit": 2}
    # The older dotted form still works, for chats that used it.
    assert demo.parse("demo.repo.list -L 3").args == {"limit": 3}


def test_main_is_the_skill_itself_and_reads_a_heredoc(demo: SkillRegistry) -> None:
    parsed = demo.parse("demo --loud <<'EOF'\nhello\nthere\nEOF")
    assert parsed.workflow.id == "demo"
    assert parsed.args == {"text": "hello\nthere", "loud": True}
    assert demo.parse("demo say hi").args["text"] == "say hi"
    with pytest.raises(CommandError, match="given twice"):
        demo.parse("demo hi <<'EOF'\nthere\nEOF")
    with pytest.raises(CommandError, match="doesn't read a heredoc"):
        demo.parse("demo repo list <<'EOF'\nx\nEOF")


def test_bg_reaches_the_parse(demo: SkillRegistry) -> None:
    assert demo.parse("demo repo list --bg").background


def test_help_is_the_skill_doc_or_the_usage(demo: SkillRegistry) -> None:
    with pytest.raises(CommandHelp) as e:
        demo.parse("demo --help")
    assert "# Skill: demo" in str(e.value) and "Use it carefully." in str(e.value)
    assert "`demo repo list [-L N]`" in str(e.value)
    with pytest.raises(CommandHelp) as e:
        demo.parse("demo repo list --help")
    assert str(e.value).startswith("### `demo repo list`")
    usage = demo.workflows["demo"].usage()
    assert "`TEXT`, `--text`, `heredoc`" in usage
    assert "[<<'EOF' TEXT EOF]" in usage


def test_hidden_skills_are_refused(demo: SkillRegistry) -> None:
    with pytest.raises(CommandError, match="No skill named `demo`"):
        demo.parse("demo hi", hidden=frozenset({"demo"}))


def test_the_catalog_carries_each_cards_look(demo: SkillRegistry) -> None:
    [skill] = demo.catalog()
    assert skill["ui"] == {"icon": "box", "label": "Demo"}
    assert [w["id"] for w in skill["workflows"]] == ["demo", "demo repo list"]
    assert skill["workflows"][1]["ui"] == {"activity": "Listing"}


def test_search_finds_the_right_command() -> None:
    registry = get_registry()
    top = registry.search("make a podcast about a paper")[0]
    assert top[1] is not None and top[1].id == "papers podcast"
    assert registry.search("recent commits on a repository")[0][1].id == "github commits"
    assert registry.search("search the web for news")[0][1].id == "web search"
    assert all(
        wf is None or wf.skill != "agent"
        for _, wf in registry.search("sub-agent", hidden=frozenset({"agent"}))
    )


def test_every_real_command_has_an_activity_label() -> None:
    for wf in get_registry().workflows.values():
        assert wf.ui.get("activity"), wf.id
