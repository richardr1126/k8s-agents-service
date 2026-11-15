"""Sub-agent run records stored on `task` ToolMessages and returned by /history."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class SubagentArtifact(BaseModel):
    """Artifact of a `task` ToolMessage: which sub-agent ran and its own messages."""

    type: Literal["subagent_run"] = "subagent_run"
    v: Literal[1] = 1
    subagent_run_id: str
    subagent_type: str
    description: str
    status: Literal["success", "error"] = "success"
    error: str | None = None
    messages: list[dict[str, Any]] = Field(
        default_factory=list, description="langchain messages_to_dict output"
    )


class SubagentRunInfo(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    subagent_run_id: str
    parent_tool_call_id: str
    name: str
    description: str
    status: Literal["success", "error"]
    error: str | None = None


class HistoryResponse(BaseModel):
    messages: list[dict[str, Any]] = Field(description="AG-UI messages, root and sub-agent")
    subagents: list[SubagentRunInfo]
