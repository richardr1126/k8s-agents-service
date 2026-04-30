from uuid import UUID

from agents.main_agent import _subagent_config_for_branch
from langchain_core.runnables import RunnableConfig


def test_subagent_config_for_branch_isolated_thread_and_deterministic_run_id() -> None:
    parent = RunnableConfig(
        configurable={"thread_id": "thread-123", "model": "gpt-test"},
        run_id=UUID("11111111-1111-1111-1111-111111111111"),
        tags=["existing-tag"],
    )

    branch_a = _subagent_config_for_branch(
        parent,
        subagent_type="web",
        tool_call_id="call-a",
    )
    branch_a_again = _subagent_config_for_branch(
        parent,
        subagent_type="web",
        tool_call_id="call-a",
    )
    branch_b = _subagent_config_for_branch(
        parent,
        subagent_type="resume",
        tool_call_id="call-b",
    )

    assert branch_a["configurable"]["thread_id"] == "thread-123::subagent::web:call-a"
    assert branch_a["configurable"]["parent_thread_id"] == "thread-123"
    assert branch_a["configurable"]["subagent_call_id"] == "call-a"
    assert branch_a["configurable"]["subagent_type"] == "web"

    assert branch_a["run_id"] == branch_a_again["run_id"]
    assert branch_a["run_id"] != branch_b["run_id"]

    tags = branch_a["tags"] or []
    assert "existing-tag" in tags
    assert "subagent-call" in tags
    assert "subagent:web" in tags
    assert "branch:web:call-a" in tags
