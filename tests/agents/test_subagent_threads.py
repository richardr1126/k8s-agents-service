from langchain_core.messages import AIMessage, HumanMessage, ToolMessage, messages_to_dict

from agents.delegation import new_thread_id as _new_thread_id
from agents.delegation import subagent_runs as _subagent_runs
from agents.delegation import tag_threads as _tag_threads
from agents.delegation import thread_transcript as _thread_transcript
from schema.subagent import SubagentArtifact


def _run(
    run_id: str, kind: str, thread: str, description: str, answer: str, **extra
) -> ToolMessage:
    return ToolMessage(
        name="task",
        tool_call_id=f"call-{run_id}",
        content=answer,
        artifact=SubagentArtifact(
            subagent_run_id=run_id,
            subagent_type=kind,
            description=description,
            thread_id=thread,
            messages=messages_to_dict([AIMessage(content=answer, id=f"ai-{run_id}")]),
            **extra,
        ).model_dump(),
    )


MESSAGES = [
    HumanMessage(content="hi"),
    _run("r1", "web", "web-1", "news on X", "X news"),
    _run("r2", "resume", "resume-1", "skills", "Python"),
    _run("r3", "web", "web-1", "more on X", "more X"),
    _run("r4", "web", "web-1", "and Y?", "failed", status="error", error="boom"),
]


def test_thread_ids_are_short_and_per_type():
    runs = _subagent_runs(MESSAGES)
    assert _new_thread_id(runs, "web") == "web-2"
    assert _new_thread_id(runs, "resume") == "resume-2"
    assert _new_thread_id([], "web") == "web-1"


def test_transcript_replays_the_threads_successful_runs():
    transcript = _thread_transcript(_subagent_runs(MESSAGES), "web-1")
    assert [(type(m).__name__, m.content) for m in transcript] == [
        ("HumanMessage", "news on X"),
        ("AIMessage", "X news"),
        ("HumanMessage", "more on X"),
        ("AIMessage", "more X"),
    ]


def test_model_sees_thread_ids_but_state_stays_clean():
    shown = _tag_threads(MESSAGES)
    assert shown[1].content == "X news\n\n[thread_id: web-1]"
    assert shown[0].content == "hi"
    assert MESSAGES[1].content == "X news"
