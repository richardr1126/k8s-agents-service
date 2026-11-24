import logging
import re
import warnings
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from langchain_core._api import LangChainBetaWarning
from langchain_core.messages import AIMessage, AnyMessage, BaseMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langfuse import Langfuse
from langgraph.types import Command
from langsmith import Client as LangsmithClient
from pydantic import BaseModel

from agents import DEFAULT_AGENT, AgentGraph, get_agent, get_all_agent_info
from agents.assistant import follow_ups
from agents.assistant.focus import get_focuses
from agents.tools import delete_web_collection
from core import settings
from jobs import delete_jobs, setup_jobs, stop_jobs
from jobs import store as jobs_store
from memory import initialize_database, initialize_store
from schema import (
    ChatHistoryInput,
    ChatMessage,
    DeleteThreadInput,
    DeleteThreadResponse,
    Feedback,
    FeedbackResponse,
    RevertThreadInput,
    RevertThreadResponse,
    ServiceMetadata,
    TitleInput,
    TitleResponse,
    UserInput,
)
from schema.schema import FocusInfo, SkillInfo
from schema.subagent import HistoryResponse
from service import live_runs
from service.agui import langfuse_callbacks
from service.agui import router as agui_router
from service.history import build_history
from service.revert import RevertError, revert_thread
from service.title import generate_title
from service.utils import langchain_to_chat_message
from skills import get_registry

warnings.filterwarnings("ignore", category=LangChainBetaWarning)
logger = logging.getLogger(__name__)


def _extract_messages_from_state(values: Any) -> list[AnyMessage]:
    """Best-effort extraction of message history from a LangGraph state payload."""
    if not isinstance(values, dict):
        return []
    messages = values.get("messages")
    if not isinstance(messages, list):
        return []
    return [m for m in messages if isinstance(m, BaseMessage)]


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

            await setup_jobs(saver)
            follow_ups.install()

            # Configure agents with both memory components
            for a in get_all_agent_info():
                agent = get_agent(a.key)
                # Set checkpointer for thread-scoped memory (conversation history)
                agent.checkpointer = saver
                # Set store for long-term memory (cross-conversation knowledge)
                agent.store = store
            try:
                yield
            finally:
                await live_runs.stop_all()
                await stop_jobs()
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
        focuses=[
            FocusInfo(name=f.name, label=f.label, description=f.description)
            for f in get_focuses().values()
        ],
        skills=[
            SkillInfo(name=s.name, description=s.description, workflows=list(s.workflows))
            for s in get_registry().skills.values()
        ],
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
        callbacks=langfuse_callbacks(),
        recursion_limit=settings.AGENT_RECURSION_LIMIT,
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
    # If an agent outputs multiple AIMessages in one run, earlier AI outputs are omitted.
    # You could update the API to return a list of ChatMessages in that case.
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


@router.post("/history", response_model_exclude_none=True)
async def history(input: ChatHistoryInput) -> HistoryResponse:
    """Get a thread's AG-UI messages, with each sub-agent run's messages and status."""
    agent: AgentGraph = get_agent(DEFAULT_AGENT)
    state = await agent.aget_state(
        config=RunnableConfig(configurable={"thread_id": input.thread_id})
    )
    return build_history(_extract_messages_from_state(state.values))


def _refuse_while_answering_job(thread_id: str) -> None:
    # The follow-up's reply would land on the reverted or deleted thread.
    if follow_ups.busy(thread_id):
        raise HTTPException(
            status_code=409, detail="The assistant is answering a background job in this chat."
        )


def _refuse_while_following(thread_id: str) -> None:
    _refuse_while_answering_job(thread_id)
    # A reply still running would land on the reverted or deleted thread.
    if live_runs.running(thread_id):
        raise HTTPException(
            status_code=409, detail="The assistant is still answering in this chat."
        )


@router.post("/thread/revert")
async def revert(input: RevertThreadInput) -> RevertThreadResponse:
    """Revert a thread to just before a user message and return that message's text.

    Forks the newest checkpoint from before the message, so the next run
    continues from there. Earlier checkpoints stay in the database.
    """
    _refuse_while_following(input.thread_id)
    try:
        agent: AgentGraph = get_agent(input.agent_id or DEFAULT_AGENT)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown agent {input.agent_id}")
    try:
        text = await revert_thread(agent, input.thread_id, input.message_id)
    except RevertError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return RevertThreadResponse(text=text)


@router.post("/title")
async def title(input: TitleInput) -> TitleResponse:
    """Name a conversation from its first message with the small title model."""
    try:
        return TitleResponse(title=await generate_title(input.text, input.model))
    except Exception as e:
        logger.warning(f"Title generation failed: {e}")
        raise HTTPException(status_code=502, detail="Title generation failed")


@router.delete("/thread")
async def delete_thread(input: DeleteThreadInput) -> DeleteThreadResponse:
    """
    Delete a thread and all its associated data.

    Stops a reply still running, then deletes the thread from the checkpointer
    (conversation memory) and store (long-term memory), its background jobs with
    their files, and its web search vectors. Frontend should handle UI state cleanup.
    """
    _refuse_while_answering_job(input.thread_id)
    await live_runs.stop(input.thread_id)
    try:
        # Jobs first: a running one is stopped before its thread goes.
        await delete_jobs(thread_id=input.thread_id)

        # Get the default agent to access checkpointer and store
        agent: AgentGraph = get_agent(DEFAULT_AGENT)

        checkpointer = agent.checkpointer
        if not checkpointer or checkpointer is True:
            raise HTTPException(status_code=500, detail="Checkpointer not available")

        # Delete from checkpointer (conversation memory) using built-in method
        try:
            # All LangGraph checkpointers (AsyncPostgresSaver, AsyncSqliteSaver)
            # support the adelete_thread method for proper thread deletion
            await checkpointer.adelete_thread(input.thread_id)
            logger.info(f"Successfully deleted thread {input.thread_id} from checkpointer")
        except Exception as e:
            logger.error(f"Error deleting thread {input.thread_id} from checkpointer: {e}")
            # Fail the operation if checkpointer deletion fails since this is the primary data
            raise HTTPException(
                status_code=500, detail=f"Failed to delete thread from checkpointer: {str(e)}"
            )

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

        # Delete the conversation's web search vectors
        try:
            await delete_web_collection(input.thread_id)
        except Exception as e:
            logger.warning(f"Error deleting web search vectors for thread {input.thread_id}: {e}")

        return DeleteThreadResponse()

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting thread {input.thread_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete thread")


@router.delete("/user/{user_id}/data")
async def delete_user_data(user_id: str) -> dict[str, int]:
    """Deletes what the user owns outside their conversations: their background jobs
    and files, including any whose conversation is already gone."""
    try:
        return {"jobs": await delete_jobs(user_id=user_id)}
    except Exception:
        logger.exception("Deleting user %s's data failed", user_id)
        raise HTTPException(status_code=500, detail="Failed to delete the user's data")


class MoveUserDataInput(BaseModel):
    to_user_id: str


@router.post("/user/{user_id}/data/move")
async def move_user_data(user_id: str, input: MoveUserDataInput) -> dict[str, int]:
    """Gives a guest's background jobs and files to the account they signed up or in with."""
    if not input.to_user_id or input.to_user_id == user_id:
        raise HTTPException(status_code=400, detail="Give a different user to move to")
    return {"jobs": await jobs_store().move(user_id, input.to_user_id)}


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


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, user_id: str) -> dict[str, Any]:
    """A background job, if it belongs to the user."""
    job = await jobs_store().get(job_id)
    if job is None or job.user_id != user_id:
        raise HTTPException(status_code=404, detail="Job not found")
    # While true, the assistant is replying to this job (or about to) on its thread.
    answering = job.status != "running" and follow_ups.busy(job.thread_id or "")
    return {**job.public(), "answering": answering}


_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


@router.get("/jobs/{job_id}/files/{name}")
async def get_job_file(job_id: str, name: str, user_id: str, request: Request) -> Response:
    """A file a background job produced, such as a podcast's audio, with Range support."""
    job = await jobs_store().get(job_id)
    found = await jobs_store().get_file(job_id, name) if job and job.user_id == user_id else None
    if found is None:
        raise HTTPException(status_code=404, detail="File not found")
    content_type, data = found
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"}
    match = _RANGE.match(request.headers.get("range", ""))
    if match and (match[1] or match[2]):
        size = len(data)
        if match[1]:
            start, end = int(match[1]), int(match[2]) if match[2] else size - 1
        else:  # the last N bytes
            start, end = max(0, size - int(match[2])), size - 1
        end = min(end, size - 1)
        if start > end:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        return Response(data[start : end + 1], 206, headers, media_type=content_type)
    return Response(data, headers=headers, media_type=content_type)


router.include_router(agui_router)
app.include_router(router)
