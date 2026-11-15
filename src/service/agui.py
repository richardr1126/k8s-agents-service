"""AG-UI streaming endpoint backed by ag-ui-langgraph."""

import re
from collections.abc import AsyncGenerator, AsyncIterator, Iterator
from typing import Any, cast

from ag_ui.core import EventType, Message, RunAgentInput, ToolCallResultEvent
from ag_ui.encoder import EventEncoder
from ag_ui_langgraph import LangGraphAgent
from ag_ui_langgraph.agent import ProcessedEvents
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage
from langfuse.langchain import CallbackHandler

from agents import get_agent
from agents.agents import agents
from agents.configurable_model_graph import ConfigurableModelGraph
from core import settings

router = APIRouter()

_MINTED_ROOT_ID = re.compile(r"::__root__(?:::\d+)?$")


def langfuse_callbacks() -> list[BaseCallbackHandler]:
    return [cast(BaseCallbackHandler, CallbackHandler())] if settings.LANGFUSE_TRACING else []


def _split_tool_call_chunks(event: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Split a streamed model chunk into pieces the adapter streams in full.

    ag-ui-langgraph 0.0.47 reads only the first tool-call chunk of a model
    chunk, drops args that arrive together with the call's name, and ignores a
    chunk carrying finish_reason. Providers that send a whole call in one
    chunk (Gemini, for one) would lose the call's args on the wire.
    """
    chunk = (event.get("data") or {}).get("chunk")
    if event.get("event") != "on_chat_model_stream" or not (
        isinstance(chunk, AIMessageChunk) and chunk.tool_call_chunks
    ):
        yield event
        return
    pieces = [AIMessageChunk(content=chunk.content, id=chunk.id)] if chunk.content else []
    for call in chunk.tool_call_chunks:
        if call.get("name"):
            pieces.append(
                AIMessageChunk(content="", id=chunk.id, tool_call_chunks=[{**call, "args": ""}])
            )
        if call.get("args"):
            args_only = {**call, "name": None, "id": None}
            pieces.append(AIMessageChunk(content="", id=chunk.id, tool_call_chunks=[args_only]))
    if chunk.response_metadata.get("finish_reason") or chunk.usage_metadata:
        pieces.append(
            AIMessageChunk(
                content="",
                id=chunk.id,
                response_metadata=chunk.response_metadata,
                usage_metadata=chunk.usage_metadata,
            )
        )
    for piece in pieces:
        yield {**event, "data": {**event["data"], "chunk": piece}}


class _Agent(LangGraphAgent):
    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._results_sent: set[str] = set()

    async def _handle_single_event(
        self, event: Any, state: Any
    ) -> AsyncGenerator[ProcessedEvents, None]:
        for piece in _split_tool_call_chunks(event):
            async for out in super()._handle_single_event(piece, state):
                if out is not None and out.type == EventType.TOOL_CALL_RESULT:
                    self._results_sent.add(out.tool_call_id)
                yield out
        # A tool error that ToolNode turns into a result fires on_tool_error, not
        # on_tool_end, and the adapter streams no TOOL_CALL_RESULT for it. Send
        # the error result from the ToolNode's output instead.
        if event.get("event") == "on_chain_end" and event.get("name") == "tools":
            output = (event.get("data") or {}).get("output")
            for message in output.get("messages", []) if isinstance(output, dict) else []:
                if not isinstance(message, ToolMessage) or message.status != "error":
                    continue
                call_id = self._resolve_public_tool_call_id(message.tool_call_id)
                if call_id in self._results_sent:
                    continue
                self._results_sent.add(call_id)
                # ProcessedEvents omits ToolCallResultEvent, which the adapter
                # dispatches itself all the same.
                result = ToolCallResultEvent(
                    type=EventType.TOOL_CALL_RESULT,
                    message_id=message.id or call_id,
                    tool_call_id=call_id,
                    content=str(message.content),
                    role="tool",
                )
                yield self._dispatch_event(cast(ProcessedEvents, result))


_prototypes: dict[tuple[str, str], _Agent] = {}


def _prototype(agent_id: str, model: str) -> _Agent:
    key = (agent_id, model)
    if key not in _prototypes:
        graph = get_agent(agent_id)
        if isinstance(graph, ConfigurableModelGraph):
            graph = graph.graph_for_model(cast(Any, model))
        _prototypes[key] = _Agent(
            name=agent_id,
            graph=cast(Any, graph),
            subagent_visibility="attributed",
            emit_interrupt_outcome=True,
            enable_legacy_on_interrupt_event=False,
            emit_raw_events=False,
        )
    return _prototypes[key]


def _guard_inbound(messages: list[Message], checkpoint: list[Any]) -> list[Message]:
    """Keep echoed history the checkpoint knows, plus genuinely new trailing input.

    The checkpoint is the source of truth; anything else a client echoes back
    (for example untagged copies of sub-agent messages) must not enter the
    parent state. Sub-agent-tagged messages pass through: the adapter splits
    them out itself and uses them to keep public ids stable.
    """
    known = {m.id for m in checkpoint}
    last_ai = next((m for m in reversed(checkpoint) if isinstance(m, AIMessage)), None)
    answered = {m.tool_call_id for m in checkpoint if isinstance(m, ToolMessage)}
    pending = {tc["id"] for tc in (last_ai.tool_calls if last_ai else [])} - answered

    def is_known(message: Message) -> bool:
        return _MINTED_ROOT_ID.sub("", message.id) in known

    root = [m for m in messages if getattr(m, "subagent_run_id", None) is None]
    tail_start = len(root)
    while tail_start and not is_known(root[tail_start - 1]):
        tail_start -= 1
    new = {
        id(m)
        for m in root[tail_start:]
        if m.role == "user" or (m.role == "tool" and m.tool_call_id in pending)
    }
    return [
        m
        for m in messages
        if getattr(m, "subagent_run_id", None) is not None or is_known(m) or id(m) in new
    ]


async def _events(agent: _Agent, input: RunAgentInput) -> AsyncIterator[str]:
    encoder = EventEncoder()
    async for event in agent.run(input):
        # The checkpoint, via /history, is the source of truth for messages.
        if event.type != EventType.MESSAGES_SNAPSHOT:
            yield encoder.encode(event)


@router.post("/{agent_id}/ag-ui")
async def ag_ui(agent_id: str, input: RunAgentInput) -> StreamingResponse:
    """Run an agent and stream AG-UI events (text/event-stream)."""
    if agent_id not in agents:
        raise HTTPException(status_code=404, detail=f"Unknown agent '{agent_id}'")
    forwarded = input.forwarded_props or {}
    model = forwarded.get("model") or settings.DEFAULT_MODEL
    if model not in settings.AVAILABLE_MODELS:
        raise HTTPException(status_code=422, detail=f"Unknown model '{model}'")

    agent = _prototype(agent_id, model).clone()
    agent.config = {
        "recursion_limit": settings.AGENT_RECURSION_LIMIT,
        "callbacks": langfuse_callbacks(),
        "configurable": {"model": model, "user_id": forwarded.get("user_id")},
    }
    state = await agent.graph.aget_state({"configurable": {"thread_id": input.thread_id}})
    input = input.model_copy(
        update={
            # The adapter merges forwardedProps into the graph input; they are
            # already in the config.
            "forwarded_props": None,
            "messages": _guard_inbound(input.messages, state.values.get("messages", [])),
        }
    )
    # Starlette cancels this generator, and with it the graph run, when the
    # client disconnects.
    return StreamingResponse(_events(agent, input), media_type="text/event-stream")
