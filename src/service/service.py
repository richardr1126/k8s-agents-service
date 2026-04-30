import inspect
import json
import logging
import warnings
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Annotated, Any, cast
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, FastAPI, HTTPException, status
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from langchain_core._api import LangChainBetaWarning
from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    AnyMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage,
)
from langchain_core.runnables import RunnableConfig
from langfuse import Langfuse
from langfuse.langchain import CallbackHandler
from langgraph.types import Command
from langsmith import Client as LangsmithClient

from agents import DEFAULT_AGENT, AgentGraph, get_agent, get_all_agent_info, load_agent
from core import settings
from memory import initialize_database, initialize_store
from schema import (
    ChatHistory,
    ChatHistoryInput,
    ChatMessage,
    DeleteThreadInput,
    DeleteThreadResponse,
    Feedback,
    FeedbackResponse,
    ServiceMetadata,
    StreamInput,
    UserInput,
)
from service.utils import (
    convert_message_content_to_string,
    extract_reasoning_from_payload,
    langchain_to_chat_message,
    remove_tool_calls,
)

warnings.filterwarnings("ignore", category=LangChainBetaWarning)
logger = logging.getLogger(__name__)
ROOT_BRANCH_ID = "root"


def _extract_messages_from_state(values: Any) -> list[AnyMessage]:
    """Best-effort extraction of message history from a LangGraph state payload."""
    if not isinstance(values, dict):
        return []
    messages = values.get("messages")
    if not isinstance(messages, list):
        return []
    return [m for m in messages if isinstance(m, BaseMessage)]


def _normalize_namespace(raw_namespace: Any) -> tuple[str, ...]:
    if isinstance(raw_namespace, tuple):
        return tuple(str(part) for part in raw_namespace)
    if isinstance(raw_namespace, list):
        return tuple(str(part) for part in raw_namespace)
    return ()


def _branch_context(namespace: tuple[str, ...]) -> dict[str, Any]:
    if not namespace:
        return {
            "branch_id": "root",
            "branch_path": [],
            "branch_label": "root",
        }
    branch_path = list(namespace)
    branch_label = branch_path[-1].split(":", maxsplit=1)[0] or "root"
    return {
        "branch_id": "/".join(branch_path),
        "branch_path": branch_path,
        "branch_label": branch_label,
    }


def _branch_context_from_id(branch_id: str) -> dict[str, Any]:
    if branch_id == "root":
        return {
            "branch_id": "root",
            "branch_path": [],
            "branch_label": "root",
        }
    branch_path = branch_id.split("/") if branch_id else []
    branch_label = branch_id.split(":", maxsplit=1)[0] if branch_id else "root"
    return {
        "branch_id": branch_id or "root",
        "branch_path": branch_path,
        "branch_label": branch_label or "root",
    }


def _is_internal_branch_id(branch_id: str) -> bool:
    return branch_id.startswith("__") or branch_id.startswith("branch:")


def _extract_task_branch_id(tool_call: dict[str, Any]) -> str | None:
    tool_call_id = tool_call.get("id")
    args = tool_call.get("args")
    if not isinstance(tool_call_id, str) or not tool_call_id:
        return None
    if not isinstance(args, dict):
        return None
    subagent_type = args.get("subagent_type")
    if not isinstance(subagent_type, str) or not subagent_type:
        return None
    return f"{subagent_type}:{tool_call_id}"


def _tool_call_id_from_branch_id(branch_id: str) -> str | None:
    if ":" not in branch_id:
        return None
    _, tool_call_id = branch_id.split(":", maxsplit=1)
    return tool_call_id or None


def _branch_tag_from_metadata(metadata: Any) -> str | None:
    if not isinstance(metadata, dict):
        return None
    tags = metadata.get("tags")
    if not isinstance(tags, list):
        return None
    for tag in tags:
        if not isinstance(tag, str):
            continue
        if tag.startswith("branch:") and len(tag) > len("branch:"):
            return tag[len("branch:") :]
    return None


def _sse_event(
    *,
    event_type: str,
    content: Any,
    branch: dict[str, Any],
    run_id: UUID,
    message_id: str | None = None,
) -> str:
    payload: dict[str, Any] = {
        "type": event_type,
        "content": content,
        "run_id": str(run_id),
        **branch,
    }
    if message_id:
        payload["message_id"] = message_id
    return f"data: {json.dumps(payload)}\n\n"


@dataclass
class _StreamState:
    """Mutable stream state used while translating LangGraph events to SSE output."""

    run_id: UUID
    user_message: str
    streamed_message_ids: set[str] = field(default_factory=set)
    last_reasoning_chunk: str | None = None
    tool_call_branch: dict[str, dict[str, Any]] = field(default_factory=dict)
    pending_task_branches: list[str] = field(default_factory=list)
    stream_chunk_branch_by_message_id: dict[str, str] = field(default_factory=dict)
    raw_branch_overrides: dict[str, str] = field(default_factory=dict)
    emitted_task_maps: set[tuple[str, str]] = field(default_factory=set)
    emitted_tool_result_ids: set[str] = field(default_factory=set)

    def emit(
        self,
        *,
        event_type: str,
        content: Any,
        branch: dict[str, Any],
        message_id: str | None = None,
    ) -> str:
        return _sse_event(
            event_type=event_type,
            content=content,
            branch=branch,
            run_id=self.run_id,
            message_id=message_id,
        )

    def resolve_branch(self, namespace: tuple[str, ...]) -> tuple[dict[str, Any], str]:
        raw_branch = _branch_context(namespace)
        raw_branch_id = raw_branch["branch_id"]
        mapped_branch_id = self.raw_branch_overrides.get(raw_branch_id)
        branch = _branch_context_from_id(mapped_branch_id) if mapped_branch_id else raw_branch

        if (
            raw_branch_id not in self.raw_branch_overrides
            and raw_branch_id != ROOT_BRANCH_ID
            and not _is_internal_branch_id(raw_branch_id)
            and self.pending_task_branches
        ):
            next_branch = self.pending_task_branches.pop(0)
            self.raw_branch_overrides[raw_branch_id] = next_branch
            branch = _branch_context_from_id(next_branch)
            if settings.DEBUG_TASK_BRANCH_MAP:
                logger.info(
                    "task_branch_map.assign raw_branch=%s mapped_branch=%s",
                    raw_branch_id,
                    next_branch,
                )
        return branch, raw_branch_id

    def emit_task_branch_map_once(
        self,
        *,
        tool_call_id: str,
        branch_id: str,
        branch: dict[str, Any],
    ) -> str | None:
        key = (tool_call_id, branch_id)
        if key in self.emitted_task_maps:
            return None
        self.emitted_task_maps.add(key)
        if settings.DEBUG_TASK_BRANCH_MAP:
            logger.info(
                "task_branch_map.emit tool_call_id=%s branch_id=%s",
                tool_call_id,
                branch_id,
            )
        return self.emit(
            event_type="task_branch_map",
            content={"toolCallId": tool_call_id, "branchId": branch_id},
            branch=branch,
        )


async def _extract_existing_message_ids(agent: AgentGraph, config: RunnableConfig) -> set[str]:
    """Capture already-persisted message ids so stream output only emits new events."""
    try:
        initial_state = await agent.aget_state(config=config)
    except Exception:
        return set()
    values = getattr(initial_state, "values", {})
    messages = values.get("messages", []) if isinstance(values, dict) else []
    message_ids: set[str] = set()
    for message in messages:
        message_id = getattr(message, "id", None)
        if isinstance(message_id, str) and message_id:
            message_ids.add(message_id)
    return message_ids


def _parse_stream_event(stream_event: Any) -> tuple[tuple[str, ...], str, Any] | None:
    if not isinstance(stream_event, tuple):
        return None
    if len(stream_event) == 3:
        raw_namespace, stream_mode, event = stream_event
        namespace = _normalize_namespace(raw_namespace)
        return namespace, stream_mode, event
    if len(stream_event) == 2:
        stream_mode, event = stream_event
        return (), stream_mode, event
    return None


def _dedupe_update_messages(
    update_messages: list[Any],
    *,
    stream_state: _StreamState,
) -> list[Any]:
    filtered_messages: list[Any] = []
    for message in update_messages:
        message_id = getattr(message, "id", None)
        if isinstance(message_id, str) and message_id in stream_state.streamed_message_ids:
            continue
        if isinstance(message, HumanMessage) and message.content == stream_state.user_message:
            continue
        filtered_messages.append(message)
        if isinstance(message_id, str) and message_id:
            stream_state.streamed_message_ids.add(message_id)
    return filtered_messages


def _extract_update_messages(event: Any, stream_state: _StreamState) -> list[Any]:
    if not isinstance(event, dict):
        if settings.DEBUG_TASK_BRANCH_MAP:
            logger.info("stream.updates.skip_non_dict event_type=%s", type(event).__name__)
        return []

    new_messages: list[Any] = []
    for node, updates in event.items():
        if node == "__interrupt__":
            if isinstance(updates, list):
                for interrupt in updates:
                    new_messages.append(AIMessage(content=interrupt.value))
            continue
        if not isinstance(updates, dict):
            continue
        update_messages = _dedupe_update_messages(
            list(updates.get("messages", [])),
            stream_state=stream_state,
        )
        # Auto-router emits internal scaffolding ToolMessages; only keep final tool output.
        if node == "auto-router":
            if update_messages and isinstance(update_messages[-1], ToolMessage):
                update_messages = [update_messages[-1]]
            else:
                update_messages = []
        new_messages.extend(update_messages)
    return new_messages


def _build_processed_messages(new_messages: list[Any]) -> list[Any]:
    """Collapse streamed message tuples into AIMessage objects."""
    processed_messages: list[Any] = []
    current_message_parts: dict[str, Any] = {}
    for message in new_messages:
        if isinstance(message, tuple):
            key, value = message
            current_message_parts[key] = value
            continue
        if current_message_parts:
            processed_messages.append(_create_ai_message(current_message_parts))
            current_message_parts = {}
        processed_messages.append(message)
    if current_message_parts:
        processed_messages.append(_create_ai_message(current_message_parts))
    return processed_messages


async def _emit_missing_tool_results_from_state(
    *,
    agent: AgentGraph,
    config: RunnableConfig,
    stream_state: _StreamState,
) -> AsyncGenerator[str, None]:
    """Emit final ToolMessages that LangGraph persisted but did not stream.

    Some graphs surface parent AI tool calls during `astream`, then only expose
    the corresponding parent ToolMessages in the final checkpoint. History
    renders those results correctly from checkpoint state; this catch-up keeps
    live streaming consistent with history.
    """
    try:
        final_state = await agent.aget_state(config=config)
    except Exception:
        logger.exception("stream.tool_result_catchup.state_failed")
        return

    for message in _extract_messages_from_state(final_state.values):
        if not isinstance(message, ToolMessage):
            continue
        tool_call_id = message.tool_call_id
        if not tool_call_id:
            continue
        if tool_call_id in stream_state.emitted_tool_result_ids:
            continue
        tool_branch = stream_state.tool_call_branch.get(tool_call_id)
        if not tool_branch:
            continue

        chat_message = langchain_to_chat_message(message)
        chat_message.run_id = str(stream_state.run_id)
        message_id = str(message.id) if getattr(message, "id", None) else None
        stream_state.emitted_tool_result_ids.add(tool_call_id)
        yield stream_state.emit(
            event_type="tool_result",
            content={
                "toolCallId": tool_call_id,
                "result": chat_message.content,
            },
            branch=tool_branch,
            message_id=message_id,
        )


def _emit_parent_task_result_from_branch_message(
    *,
    chat_message: ChatMessage,
    branch: dict[str, Any],
    stream_state: _StreamState,
    message_id: str | None,
) -> str | None:
    """Close a parent `task` tool call as soon as its sub-agent branch answers."""
    if chat_message.type != "ai":
        return None
    if chat_message.tool_calls:
        return None
    if not chat_message.content.strip():
        return None

    tool_call_id = _tool_call_id_from_branch_id(str(branch.get("branch_id", "")))
    if not tool_call_id:
        return None
    if tool_call_id in stream_state.emitted_tool_result_ids:
        return None

    tool_branch = stream_state.tool_call_branch.get(tool_call_id)
    if not tool_branch:
        return None

    stream_state.emitted_tool_result_ids.add(tool_call_id)
    return stream_state.emit(
        event_type="tool_result",
        content={
            "toolCallId": tool_call_id,
            "result": chat_message.content,
        },
        branch=tool_branch,
        message_id=message_id,
    )


def verify_bearer(
    http_auth: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(HTTPBearer(description="Please provide AUTH_SECRET api key.", auto_error=False)),
    ],
) -> None:
    if not settings.AUTH_SECRET:
        return
    auth_secret = settings.AUTH_SECRET.get_secret_value()
    if not auth_secret:
        return
    if not http_auth or http_auth.credentials != auth_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Configurable lifespan that initializes the appropriate database checkpointer and store
    based on settings.
    """
    try:
        # Initialize both checkpointer (for short-term memory) and store (for long-term memory)
        async with initialize_database() as saver, initialize_store() as store:
            # Set up both components
            if hasattr(saver, "setup"):  # ignore: union-attr
                await saver.setup()
            # Only setup store for Postgres as InMemoryStore doesn't need setup
            if hasattr(store, "setup"):  # ignore: union-attr
                await store.setup()

            # Configure agents with both memory components
            agents = get_all_agent_info()
            for a in agents:
                try:
                    await load_agent(a.key)
                    logger.info(f"Agent loaded: {a.key}")
                except Exception as e:
                    logger.error(f"Failed to load agent {a.key}: {e}")
                    # Continue with other agents instead of failing service startup
                    continue

                agent = get_agent(a.key)
                # Set checkpointer for thread-scoped memory (conversation history)
                agent.checkpointer = saver
                # Set store for long-term memory (cross-conversation knowledge)
                agent.store = store
            yield
    except Exception as e:
        logger.error(f"Error during database/store initialization: {e}")
        raise


app = FastAPI(lifespan=lifespan)
router = APIRouter(dependencies=[Depends(verify_bearer)])


@router.get("/info")
async def info() -> ServiceMetadata:
    models = list(settings.AVAILABLE_MODELS)
    models.sort()
    return ServiceMetadata(
        agents=get_all_agent_info(),
        models=models,
        default_agent=DEFAULT_AGENT,
        default_model=settings.DEFAULT_MODEL,
    )


async def _handle_input(user_input: UserInput, agent: AgentGraph) -> tuple[dict[str, Any], UUID]:
    """
    Parse user input and handle any required interrupt resumption.
    Returns kwargs for agent invocation and the run_id.
    """
    run_id = uuid4()
    thread_id = user_input.thread_id or str(uuid4())
    user_id = user_input.user_id or str(uuid4())

    configurable = {"thread_id": thread_id, "model": user_input.model, "user_id": user_id}

    callbacks: list[BaseCallbackHandler] = []
    if settings.LANGFUSE_TRACING:
        # Initialize Langfuse CallbackHandler for Langchain (tracing)
        langfuse_handler = cast(BaseCallbackHandler, CallbackHandler())

        callbacks.append(langfuse_handler)

    if user_input.agent_config:
        if overlap := configurable.keys() & user_input.agent_config.keys():
            raise HTTPException(
                status_code=422,
                detail=f"agent_config contains reserved keys: {overlap}",
            )
        configurable.update(user_input.agent_config)

    config = RunnableConfig(
        configurable=configurable,
        run_id=run_id,
        callbacks=callbacks,
    )

    # Check for interrupts that need to be resumed
    state = await agent.aget_state(config=config)
    interrupted_tasks = [
        task for task in state.tasks if hasattr(task, "interrupts") and task.interrupts
    ]

    input: Command | dict[str, Any]
    if interrupted_tasks:
        # assume user input is response to resume agent execution from interrupt
        input = Command(resume=user_input.message)
    else:
        input = {"messages": [HumanMessage(content=user_input.message)]}

    kwargs = {
        "input": input,
        "config": config,
    }

    return kwargs, run_id


@router.post("/{agent_id}/invoke")
@router.post("/invoke")
async def invoke(user_input: UserInput, agent_id: str = DEFAULT_AGENT) -> ChatMessage:
    """
    Invoke an agent with user input to retrieve a final response.

    If agent_id is not provided, the default agent will be used.
    Use thread_id to persist and continue a multi-turn conversation. run_id kwarg
    is also attached to messages for recording feedback.
    Use user_id to persist and continue a conversation across multiple threads.
    """
    # NOTE: Currently this only returns the last message or interrupt.
    # In the case of an agent outputting multiple AIMessages (such as the background step
    # in interrupt-agent, or a tool step in research-assistant), it's omitted. Arguably,
    # you'd want to include it. You could update the API to return a list of ChatMessages
    # in that case.
    agent: AgentGraph = get_agent(agent_id)
    kwargs, run_id = await _handle_input(user_input, agent)

    try:
        response_events: list[tuple[str, Any]] = await agent.ainvoke(**kwargs, stream_mode=["updates", "values"])  # type: ignore # fmt: skip
        response_type, response = response_events[-1]
        if response_type == "values":
            # Normal response, the agent completed successfully
            messages = _extract_messages_from_state(response)
            if not messages:
                raise ValueError("Agent response contained no messages")
            output = langchain_to_chat_message(messages[-1])
        elif response_type == "updates" and "__interrupt__" in response:
            # The last thing to occur was an interrupt
            # Return the value of the first interrupt as an AIMessage
            output = langchain_to_chat_message(
                AIMessage(content=response["__interrupt__"][0].value)
            )
        else:
            raise ValueError(f"Unexpected response type: {response_type}")

        output.run_id = str(run_id)
        return output
    except Exception as e:
        logger.error(f"An exception occurred: {e}")
        raise HTTPException(status_code=500, detail="Unexpected error")


async def message_generator(
    user_input: StreamInput, agent_id: str = DEFAULT_AGENT
) -> AsyncGenerator[str, None]:
    """
    Generate a stream of messages from the agent.

    This is the workhorse method for the /stream endpoint.
    """
    agent: AgentGraph = get_agent(agent_id)
    kwargs, run_id = await _handle_input(user_input, agent)
    stream_state = _StreamState(run_id=run_id, user_message=user_input.message)
    stream_state.streamed_message_ids = await _extract_existing_message_ids(
        agent, kwargs["config"]
    )

    try:
        # Process streamed events from the graph and yield messages over the SSE stream.
        async for stream_event in agent.astream(
            **kwargs, stream_mode=["updates", "messages", "custom"], subgraphs=True
        ):
            parsed_stream_event = _parse_stream_event(stream_event)
            if not parsed_stream_event:
                continue
            namespace, stream_mode, event = parsed_stream_event
            branch, raw_branch_id = stream_state.resolve_branch(namespace)
            if settings.PARALLEL_BRANCH_DEBUG:
                logger.info(
                    "stream.event mode=%s branch=%s path=%s",
                    stream_mode,
                    branch["branch_id"],
                    branch["branch_path"],
                )
            new_messages: list[Any] = []
            if stream_mode == "updates":
                new_messages = _extract_update_messages(event, stream_state)
            elif stream_mode == "custom":
                new_messages = [event]

            for message in _build_processed_messages(new_messages):
                try:
                    chat_message = langchain_to_chat_message(message)
                    chat_message.run_id = str(run_id)
                except Exception as e:
                    logger.error(f"Error parsing message: {e}")
                    yield f"data: {json.dumps({'type': 'error', 'content': 'Unexpected error'})}\n\n"
                    continue
                # LangGraph re-sends the input message, which feels weird, so drop it
                if chat_message.type == "human" and chat_message.content == user_input.message:
                    continue

                raw_message_id = getattr(message, "id", None)
                message_id = str(raw_message_id) if raw_message_id else None

                if chat_message.type == "ai" and chat_message.tool_calls:
                    for tool_call in chat_message.tool_calls:
                        tool_call_id = tool_call.get("id")
                        if tool_call_id:
                            stream_state.tool_call_branch[tool_call_id] = branch
                        if tool_call.get("name") == "task":
                            task_branch_id = _extract_task_branch_id(tool_call)
                            if task_branch_id and tool_call_id:
                                stream_state.pending_task_branches.append(task_branch_id)
                                mapped_event = stream_state.emit_task_branch_map_once(
                                    tool_call_id=tool_call_id,
                                    branch_id=task_branch_id,
                                    branch=branch,
                                )
                                if mapped_event:
                                    yield mapped_event
                        yield stream_state.emit(
                            event_type="tool_call",
                            content={
                                "id": tool_call_id,
                                "name": tool_call.get("name"),
                                "args": tool_call.get("args", {}),
                            },
                            branch=branch,
                            message_id=message_id,
                        )
                    if settings.PARALLEL_BRANCH_DEBUG:
                        logger.info(
                            "stream.tool_calls branch=%s count=%s",
                            branch["branch_id"],
                            len(chat_message.tool_calls),
                        )

                if chat_message.type == "tool" and chat_message.tool_call_id:
                    tool_branch = stream_state.tool_call_branch.get(chat_message.tool_call_id, branch)
                    if isinstance(message, ToolMessage) and isinstance(message.artifact, dict):
                        artifact_branch_id = message.artifact.get("branch_id")
                        if isinstance(artifact_branch_id, str) and artifact_branch_id:
                            tool_branch = _branch_context_from_id(artifact_branch_id)
                            mapped_event = stream_state.emit_task_branch_map_once(
                                tool_call_id=chat_message.tool_call_id,
                                branch_id=artifact_branch_id,
                                branch=tool_branch,
                            )
                            if mapped_event:
                                yield mapped_event
                    stream_state.emitted_tool_result_ids.add(chat_message.tool_call_id)
                    yield stream_state.emit(
                        event_type="tool_result",
                        content={
                            "toolCallId": chat_message.tool_call_id,
                            "result": chat_message.content,
                        },
                        branch=tool_branch,
                        message_id=message_id,
                    )
                    if settings.PARALLEL_BRANCH_DEBUG:
                        logger.info(
                            "stream.tool_result branch=%s tool_call_id=%s",
                            tool_branch["branch_id"],
                            chat_message.tool_call_id,
                        )

                yield stream_state.emit(
                    event_type="message",
                    content=chat_message.model_dump(),
                    branch=branch,
                    message_id=message_id,
                )
                parent_task_result_event = _emit_parent_task_result_from_branch_message(
                    chat_message=chat_message,
                    branch=branch,
                    stream_state=stream_state,
                    message_id=message_id,
                )
                if parent_task_result_event:
                    yield parent_task_result_event

            if stream_mode != "messages" or not user_input.stream_tokens:
                continue
            if not isinstance(event, tuple) or len(event) != 2:
                if settings.DEBUG_TASK_BRANCH_MAP:
                    logger.info(
                        "stream.messages.skip_invalid_event branch=%s event_type=%s",
                        branch["branch_id"],
                        type(event).__name__,
                    )
                continue
            msg, metadata = event
            if not isinstance(metadata, dict):
                if settings.DEBUG_TASK_BRANCH_MAP:
                    logger.info(
                        "stream.messages.skip_invalid_metadata branch=%s metadata_type=%s",
                        branch["branch_id"],
                        type(metadata).__name__,
                    )
                continue

            branch_tag = _branch_tag_from_metadata(metadata)
            if branch_tag and raw_branch_id != ROOT_BRANCH_ID:
                stream_state.raw_branch_overrides[raw_branch_id] = branch_tag
                branch = _branch_context_from_id(branch_tag)
                mapped_tool_call_id = _tool_call_id_from_branch_id(branch_tag)
                if mapped_tool_call_id:
                    mapped_event = stream_state.emit_task_branch_map_once(
                        tool_call_id=mapped_tool_call_id,
                        branch_id=branch_tag,
                        branch=branch,
                    )
                    if mapped_event:
                        yield mapped_event
            tags = metadata.get("tags")
            if not isinstance(tags, list):
                tags = []
            if "skip_stream" in tags or not isinstance(msg, AIMessageChunk):
                continue

            message_id = str(msg.id) if getattr(msg, "id", None) else None
            metadata_branch = _branch_context(_normalize_namespace(metadata.get("langgraph_path")))
            token_branch = branch
            if (
                token_branch["branch_id"] == ROOT_BRANCH_ID
                and metadata_branch["branch_id"] != ROOT_BRANCH_ID
            ):
                token_branch = metadata_branch

            if message_id:
                mapped_branch_id = stream_state.stream_chunk_branch_by_message_id.get(message_id)
                if mapped_branch_id:
                    token_branch = _branch_context_from_id(mapped_branch_id)
                else:
                    current_branch_id = token_branch["branch_id"]
                    if current_branch_id != ROOT_BRANCH_ID and not _is_internal_branch_id(
                        current_branch_id
                    ):
                        stream_state.stream_chunk_branch_by_message_id[message_id] = (
                            current_branch_id
                        )

            reasoning_chunks: list[str] = []
            reasoning_chunks.extend(extract_reasoning_from_payload(msg.content))
            reasoning_chunks.extend(extract_reasoning_from_payload(msg.additional_kwargs))
            reasoning_chunks.extend(extract_reasoning_from_payload(msg.response_metadata))
            for chunk in reasoning_chunks:
                if chunk == "":
                    continue
                if (
                    stream_state.last_reasoning_chunk is not None
                    and chunk == stream_state.last_reasoning_chunk
                ):
                    continue
                yield stream_state.emit(
                    event_type="reasoning",
                    content=chunk,
                    branch=token_branch,
                    message_id=message_id,
                )
                stream_state.last_reasoning_chunk = chunk

            content = remove_tool_calls(msg.content)
            if content:
                yield stream_state.emit(
                    event_type="token",
                    content=convert_message_content_to_string(content),
                    branch=token_branch,
                    message_id=message_id,
                )
        async for catchup_event in _emit_missing_tool_results_from_state(
            agent=agent,
            config=kwargs["config"],
            stream_state=stream_state,
        ):
            yield catchup_event
    except Exception as e:
        error_payload: dict[str, Any] = {
            "type": type(e).__name__,
            "message": str(e),
        }
        if getattr(e, "args", None):
            error_payload["args"] = [str(arg) for arg in e.args]
        for attr in ("status_code", "body", "response", "metadata"):
            value = getattr(e, attr, None)
            if value is not None:
                try:
                    json.dumps(value)
                    error_payload[attr] = value
                except TypeError:
                    error_payload[attr] = str(value)

        logger.exception("Error in message generator: %s", error_payload)
        yield f"data: {json.dumps({'type': 'error', 'content': error_payload})}\n\n"
    finally:
        yield "data: [DONE]\n\n"


def _create_ai_message(parts: dict) -> AIMessage:
    sig = inspect.signature(AIMessage)
    valid_keys = set(sig.parameters)
    filtered = {k: v for k, v in parts.items() if k in valid_keys}
    return AIMessage(**filtered)


def _sse_response_example() -> dict[int | str, Any]:
    return {
        status.HTTP_200_OK: {
            "description": "Server Sent Event Response",
            "content": {
                "text/event-stream": {
                    "example": "data: {'type': 'token', 'content': 'Hello'}\n\ndata: {'type': 'token', 'content': ' World'}\n\ndata: [DONE]\n\n",
                    "schema": {"type": "string"},
                }
            },
        }
    }


@router.post(
    "/{agent_id}/stream",
    response_class=StreamingResponse,
    responses=_sse_response_example(),
)
@router.post("/stream", response_class=StreamingResponse, responses=_sse_response_example())
async def stream(user_input: StreamInput, agent_id: str = DEFAULT_AGENT) -> StreamingResponse:
    """
    Stream an agent's response to a user input, including intermediate messages and tokens.

    If agent_id is not provided, the default agent will be used.
    Use thread_id to persist and continue a multi-turn conversation. run_id kwarg
    is also attached to all messages for recording feedback.
    Use user_id to persist and continue a conversation across multiple threads.

    Set `stream_tokens=false` to return intermediate messages but not token-by-token.
    """
    return StreamingResponse(
        message_generator(user_input, agent_id),
        media_type="text/event-stream",
    )


@router.post("/feedback")
async def feedback(feedback: Feedback) -> FeedbackResponse:
    """
    Record feedback for a run to LangSmith.

    This is a simple wrapper for the LangSmith create_feedback API, so the
    credentials can be stored and managed in the service rather than the client.
    See: https://api.smith.langchain.com/redoc#tag/feedback/operation/create_feedback_api_v1_feedback_post
    """
    client = LangsmithClient()
    kwargs = feedback.kwargs or {}
    client.create_feedback(
        run_id=feedback.run_id,
        key=feedback.key,
        score=feedback.score,
        **kwargs,
    )
    return FeedbackResponse()


@router.post("/history")
def history(input: ChatHistoryInput) -> ChatHistory:
    """
    Get chat history.
    """
    # TODO: Hard-coding DEFAULT_AGENT here is wonky
    agent: AgentGraph = get_agent(DEFAULT_AGENT)
    try:
        state_snapshot = agent.get_state(
            config=RunnableConfig(configurable={"thread_id": input.thread_id})
        )
        messages = _extract_messages_from_state(state_snapshot.values)
        chat_messages: list[ChatMessage] = [langchain_to_chat_message(m) for m in messages]
        return ChatHistory(messages=chat_messages)
    except Exception as e:
        logger.error(f"An exception occurred: {e}")
        raise HTTPException(status_code=500, detail="Unexpected error")


@router.delete("/thread")
async def delete_thread(input: DeleteThreadInput) -> DeleteThreadResponse:
    """
    Delete a thread and all its associated data.
    
    This deletes the thread from the checkpointer (conversation memory)
    and store (long-term memory). Frontend should handle UI state cleanup.
    """
    try:
        # Get the default agent to access checkpointer and store
        agent: AgentGraph = get_agent(DEFAULT_AGENT)
        
        checkpointer = agent.checkpointer
        if not checkpointer or checkpointer is True:
            raise HTTPException(status_code=500, detail="Checkpointer not available")
        
        # Delete from checkpointer (conversation memory) using built-in method
        try:
            # All LangGraph checkpointers (AsyncPostgresSaver, AsyncSqliteSaver, AsyncMongoDBSaver) 
            # support the adelete_thread method for proper thread deletion
            await checkpointer.adelete_thread(input.thread_id)
            logger.info(f"Successfully deleted thread {input.thread_id} from checkpointer")
        except Exception as e:
            logger.error(f"Error deleting thread {input.thread_id} from checkpointer: {e}")
            # Fail the operation if checkpointer deletion fails since this is the primary data
            raise HTTPException(status_code=500, detail=f"Failed to delete thread from checkpointer: {str(e)}")
        
        # Delete from store (long-term memory)
        try:
            if agent.store and hasattr(agent.store, "adelete"):
                # Delete any store data associated with this thread
                await agent.store.adelete(namespace=("threads",), key=input.thread_id)
                logger.info(f"Successfully deleted thread {input.thread_id} from store")
            elif agent.store:
                logger.info(f"Store does not support deletion for thread {input.thread_id}")
        except Exception as e:
            logger.warning(f"Error deleting thread {input.thread_id} from store: {e}")
            # Don't fail the entire operation if store deletion fails since store is optional
        
        return DeleteThreadResponse()
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting thread {input.thread_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete thread")


@app.get("/health")
async def health_check():
    """Health check endpoint."""

    health_status = {"status": "ok"}

    if settings.LANGFUSE_TRACING:
        try:
            langfuse = Langfuse()
            health_status["langfuse"] = "connected" if langfuse.auth_check() else "disconnected"
        except Exception as e:
            logger.error(f"Langfuse connection error: {e}")
            health_status["langfuse"] = "disconnected"

    return health_status


app.include_router(router)
