import json
from unittest.mock import AsyncMock, patch

import langsmith
import pytest
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from langgraph.types import Interrupt, StateSnapshot

from agents.agents import DEFAULT_AGENT, Agent
from schema import ChatHistory, ChatMessage, ServiceMetadata
from schema.models import OpenAIModelName


def test_invoke(test_client, mock_agent) -> None:
    QUESTION = "What is the weather in Tokyo?"
    ANSWER = "The weather in Tokyo is 70 degrees."
    mock_agent.ainvoke.return_value = [("values", {"messages": [AIMessage(content=ANSWER)]})]

    response = test_client.post("/invoke", json={"message": QUESTION})
    assert response.status_code == 200

    mock_agent.ainvoke.assert_awaited_once()
    input_message = mock_agent.ainvoke.await_args.kwargs["input"]["messages"][0]
    assert input_message.content == QUESTION

    output = ChatMessage.model_validate(response.json())
    assert output.type == "ai"
    assert output.content == ANSWER


def test_invoke_custom_agent(test_client, mock_agent) -> None:
    """Test that /invoke works with a custom agent_id path parameter."""
    CUSTOM_AGENT = "custom_agent"
    QUESTION = "What is the weather in Tokyo?"
    CUSTOM_ANSWER = "The weather in Tokyo is sunny."
    DEFAULT_ANSWER = "This is from the default agent."

    # Create a separate mock for the default agent
    default_mock = AsyncMock()
    default_mock.ainvoke.return_value = [
        ("values", {"messages": [AIMessage(content=DEFAULT_ANSWER)]})
    ]

    # Configure our custom mock agent
    mock_agent.ainvoke.return_value = [("values", {"messages": [AIMessage(content=CUSTOM_ANSWER)]})]

    # Patch get_agent to return the correct agent based on the provided agent_id
    def agent_lookup(agent_id):
        if agent_id == CUSTOM_AGENT:
            return mock_agent
        return default_mock

    with patch("service.service.get_agent", side_effect=agent_lookup):
        response = test_client.post(f"/{CUSTOM_AGENT}/invoke", json={"message": QUESTION})
        assert response.status_code == 200

        # Verify custom agent was called and default wasn't
        mock_agent.ainvoke.assert_awaited_once()
        default_mock.ainvoke.assert_not_awaited()

        input_message = mock_agent.ainvoke.await_args.kwargs["input"]["messages"][0]
        assert input_message.content == QUESTION

        output = ChatMessage.model_validate(response.json())
        assert output.type == "ai"
        assert output.content == CUSTOM_ANSWER  # Verify we got the custom agent's response


def test_invoke_model_param(test_client, mock_agent) -> None:
    """Test that the model parameter is correctly passed to the agent."""
    QUESTION = "What is the weather in Tokyo?"
    ANSWER = "The weather in Tokyo is sunny."
    CUSTOM_MODEL = "claude-3.5-sonnet"
    mock_agent.ainvoke.return_value = [("values", {"messages": [AIMessage(content=ANSWER)]})]

    response = test_client.post("/invoke", json={"message": QUESTION, "model": CUSTOM_MODEL})
    assert response.status_code == 200

    # Verify the model was passed correctly in the config
    mock_agent.ainvoke.assert_awaited_once()
    config = mock_agent.ainvoke.await_args.kwargs["config"]
    assert config["configurable"]["model"] == CUSTOM_MODEL

    # Verify the response is still correct
    output = ChatMessage.model_validate(response.json())
    assert output.type == "ai"
    assert output.content == ANSWER

    # Verify an invalid model throws a validation error
    INVALID_MODEL = "gpt-7-notreal"
    response = test_client.post("/invoke", json={"message": QUESTION, "model": INVALID_MODEL})
    assert response.status_code == 422


def test_invoke_custom_agent_config(test_client, mock_agent) -> None:
    """Test that the agent_config parameter is correctly passed to the agent."""
    QUESTION = "What is the weather in Tokyo?"
    ANSWER = "The weather in Tokyo is sunny."
    CUSTOM_CONFIG = {"spicy_level": 0.1, "additional_param": "value_foo"}

    mock_agent.ainvoke.return_value = [("values", {"messages": [AIMessage(content=ANSWER)]})]

    response = test_client.post(
        "/invoke", json={"message": QUESTION, "agent_config": CUSTOM_CONFIG}
    )
    assert response.status_code == 200

    # Verify the agent_config was passed correctly in the config
    mock_agent.ainvoke.assert_awaited_once()
    config = mock_agent.ainvoke.await_args.kwargs["config"]
    assert config["configurable"]["spicy_level"] == 0.1
    assert config["configurable"]["additional_param"] == "value_foo"

    # Verify the response is still correct
    output = ChatMessage.model_validate(response.json())
    assert output.type == "ai"
    assert output.content == ANSWER

    # Verify a reserved key in agent_config throws a validation error
    INVALID_CONFIG = {"model": "gpt-4o"}
    response = test_client.post(
        "/invoke", json={"message": QUESTION, "agent_config": INVALID_CONFIG}
    )
    assert response.status_code == 422


def test_invoke_interrupt(test_client, mock_agent) -> None:
    QUESTION = "What is the weather in Tokyo?"
    ANSWER = "The weather in Tokyo is 70 degrees."
    INTERRUPT = "Confirm weather check"
    mock_agent.ainvoke.return_value = [
        ("values", {"messages": [AIMessage(content=ANSWER)]}),
        ("updates", {"__interrupt__": [Interrupt(value=INTERRUPT)]}),
    ]

    response = test_client.post("/invoke", json={"message": QUESTION})
    assert response.status_code == 200

    mock_agent.ainvoke.assert_awaited_once()
    input_message = mock_agent.ainvoke.await_args.kwargs["input"]["messages"][0]
    assert input_message.content == QUESTION

    output = ChatMessage.model_validate(response.json())
    assert output.type == "ai"
    assert output.content == INTERRUPT


@patch("service.service.LangsmithClient")
def test_feedback(mock_client: langsmith.Client, test_client) -> None:
    ls_instance = mock_client.return_value
    ls_instance.create_feedback.return_value = None
    body = {
        "run_id": "847c6285-8fc9-4560-a83f-4e6285809254",
        "key": "human-feedback-stars",
        "score": 0.8,
    }
    response = test_client.post("/feedback", json=body)
    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    ls_instance.create_feedback.assert_called_once_with(
        run_id="847c6285-8fc9-4560-a83f-4e6285809254",
        key="human-feedback-stars",
        score=0.8,
    )


def test_history(test_client, mock_agent) -> None:
    QUESTION = "What is the weather in Tokyo?"
    ANSWER = "The weather in Tokyo is 70 degrees."
    user_question = HumanMessage(content=QUESTION)
    agent_response = AIMessage(content=ANSWER)
    mock_agent.get_state.return_value = StateSnapshot(
        values={"messages": [user_question, agent_response]},
        next=(),
        config={},
        metadata=None,
        created_at=None,
        parent_config=None,
        tasks=(),
        interrupts=(),
    )

    response = test_client.post(
        "/history", json={"thread_id": "7bcc7cc1-99d7-4b1d-bdb5-e6f90ed44de6"}
    )
    assert response.status_code == 200

    output = ChatHistory.model_validate(response.json())
    assert output.messages[0].type == "human"
    assert output.messages[0].content == QUESTION
    assert output.messages[1].type == "ai"
    assert output.messages[1].content == ANSWER


@pytest.mark.asyncio
async def test_stream(test_client, mock_agent) -> None:
    """Test streaming tokens and messages."""
    QUESTION = "What is the weather in Tokyo?"
    TOKENS = ["The", " weather", " in", " Tokyo", " is", " sunny", "."]
    FINAL_ANSWER = "The weather in Tokyo is sunny."

    # Configure mock to use our async iterator function
    events = [
        (
            "messages",
            (
                AIMessageChunk(content=token),
                {"tags": []},
            ),
        )
        for token in TOKENS
    ] + [
        (
            "updates",
            {"chat_model": {"messages": [AIMessage(content=FINAL_ANSWER)]}},
        )
    ]

    async def mock_astream(**kwargs):
        for event in events:
            yield event

    mock_agent.astream = mock_astream

    # Make request with streaming
    with test_client.stream(
        "POST", "/stream", json={"message": QUESTION, "stream_tokens": True}
    ) as response:
        assert response.status_code == 200

        # Collect all SSE messages
        messages = []
        for line in response.iter_lines():
            if line and line.strip() != "data: [DONE]":  # Skip [DONE] message
                messages.append(json.loads(line.lstrip("data: ")))

        # Verify streamed tokens
        token_messages = [msg for msg in messages if msg["type"] == "token"]
        assert len(token_messages) == len(TOKENS)
        for i, msg in enumerate(token_messages):
            assert msg["content"] == TOKENS[i]

        # Verify final message
        final_messages = [msg for msg in messages if msg["type"] == "message"]
        assert len(final_messages) == 1
        assert final_messages[0]["content"]["content"] == FINAL_ANSWER
        assert final_messages[0]["content"]["type"] == "ai"


@pytest.mark.asyncio
async def test_stream_emits_reasoning_events(test_client, mock_agent) -> None:
    QUESTION = "How would you solve this?"
    FINAL_ANSWER = "Here is the final answer."

    events = [
        (
            "messages",
            (
                AIMessageChunk(content="", additional_kwargs={"reasoning_content": "Plan first."}),
                {"tags": []},
            ),
        ),
        (
            "messages",
            (
                AIMessageChunk(content="Here", additional_kwargs={"reasoning_content": "Plan first."}),
                {"tags": []},
            ),
        ),
        (
            "updates",
            {"chat_model": {"messages": [AIMessage(content=FINAL_ANSWER)]}},
        ),
    ]

    async def mock_astream(**kwargs):
        for event in events:
            yield event

    mock_agent.astream = mock_astream

    with test_client.stream(
        "POST", "/stream", json={"message": QUESTION, "stream_tokens": True}
    ) as response:
        assert response.status_code == 200
        messages = []
        for line in response.iter_lines():
            if line and line.strip() != "data: [DONE]":
                messages.append(json.loads(line.lstrip("data: ")))

        reasoning_messages = [msg for msg in messages if msg["type"] == "reasoning"]
        assert len(reasoning_messages) == 1
        assert reasoning_messages[0]["type"] == "reasoning"
        assert reasoning_messages[0]["content"] == "Plan first."
        assert reasoning_messages[0]["branch_id"] == "root"
        assert "run_id" in reasoning_messages[0]


@pytest.mark.asyncio
async def test_stream_emits_branch_aware_tool_call_and_result_events(test_client, mock_agent) -> None:
    QUESTION = "Use tools."
    tool_call_id = "call_parallel_1"
    events = [
        (
            ("tools:task-a",),
            "updates",
            {
                "tools": {
                    "messages": [
                        AIMessage(
                            content="",
                            tool_calls=[
                                {
                                    "name": "task",
                                    "args": {"description": "subtask"},
                                    "id": tool_call_id,
                                }
                            ],
                        )
                    ]
                }
            },
        ),
        (
            ("tools:task-a",),
            "updates",
            {
                "tools": {
                    "messages": [ToolMessage(content="subtask complete", tool_call_id=tool_call_id)]
                }
            },
        ),
    ]

    async def mock_astream(**kwargs):
        for event in events:
            yield event

    mock_agent.astream = mock_astream

    with test_client.stream(
        "POST", "/stream", json={"message": QUESTION, "stream_tokens": False}
    ) as response:
        assert response.status_code == 200
        messages = []
        for line in response.iter_lines():
            if line and line.strip() != "data: [DONE]":
                messages.append(json.loads(line.lstrip("data: ")))

        tool_call_events = [msg for msg in messages if msg["type"] == "tool_call"]
        tool_result_events = [msg for msg in messages if msg["type"] == "tool_result"]
        assert len(tool_call_events) == 1
        assert len(tool_result_events) == 1

        tool_call_event = tool_call_events[0]
        tool_result_event = tool_result_events[0]
        assert tool_call_event["content"]["id"] == tool_call_id
        assert tool_result_event["content"]["toolCallId"] == tool_call_id
        assert tool_call_event["branch_id"] == "tools:task-a"
        assert tool_result_event["branch_id"] == "tools:task-a"
        assert messages.index(tool_call_event) < messages.index(tool_result_event)


@pytest.mark.asyncio
async def test_stream_catches_up_persisted_tool_results_missing_from_updates(
    test_client, mock_agent
) -> None:
    QUESTION = "Use parallel tasks."
    tool_call_id = "call_parent_task"
    tool_call_message = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "task",
                "args": {"description": "subtask", "subagent_type": "resume"},
                "id": tool_call_id,
            }
        ],
    )
    final_tool_message = ToolMessage(
        content="parent task complete",
        tool_call_id=tool_call_id,
    )
    events = [
        (
            "updates",
            {
                "model": {
                    "messages": [tool_call_message],
                }
            },
        ),
        (
            "updates",
            {
                "model": {
                    "messages": [AIMessage(content="final answer")],
                }
            },
        ),
    ]

    async def mock_astream(**kwargs):
        for event in events:
            yield event

    mock_agent.astream = mock_astream
    mock_agent.aget_state.side_effect = [
        StateSnapshot(
            values={"messages": []},
            next=(),
            config={},
            metadata=None,
            created_at=None,
            parent_config=None,
            tasks=(),
            interrupts=(),
        ),
        StateSnapshot(
            values={"messages": []},
            next=(),
            config={},
            metadata=None,
            created_at=None,
            parent_config=None,
            tasks=(),
            interrupts=(),
        ),
        StateSnapshot(
            values={"messages": [tool_call_message, final_tool_message]},
            next=(),
            config={},
            metadata=None,
            created_at=None,
            parent_config=None,
            tasks=(),
            interrupts=(),
        ),
    ]

    with test_client.stream(
        "POST", "/stream", json={"message": QUESTION, "stream_tokens": False}
    ) as response:
        assert response.status_code == 200
        messages = []
        for line in response.iter_lines():
            if line and line.strip() != "data: [DONE]":
                messages.append(json.loads(line.lstrip("data: ")))

        tool_result_events = [msg for msg in messages if msg["type"] == "tool_result"]
        assert len(tool_result_events) == 1
        assert tool_result_events[0]["content"] == {
            "toolCallId": tool_call_id,
            "result": "parent task complete",
        }
        assert tool_result_events[0]["branch_id"] == "root"


@pytest.mark.asyncio
async def test_stream_closes_parent_task_when_branch_final_message_arrives(
    test_client, mock_agent
) -> None:
    QUESTION = "Use parallel tasks."
    tool_call_id = "call_parent_task"
    root_tool_call = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "task",
                "args": {"description": "subtask", "subagent_type": "resume"},
                "id": tool_call_id,
            }
        ],
    )
    branch_final = AIMessage(content="branch answer")
    main_final = AIMessage(content="main answer")
    events = [
        (
            "updates",
            {
                "model": {
                    "messages": [root_tool_call],
                }
            },
        ),
        (
            ("tools:branch-a",),
            "updates",
            {
                "model": {
                    "messages": [branch_final],
                }
            },
        ),
        (
            "updates",
            {
                "model": {
                    "messages": [main_final],
                }
            },
        ),
    ]

    async def mock_astream(**kwargs):
        for event in events:
            yield event

    mock_agent.astream = mock_astream
    mock_agent.aget_state.side_effect = [
        StateSnapshot(
            values={"messages": []},
            next=(),
            config={},
            metadata=None,
            created_at=None,
            parent_config=None,
            tasks=(),
            interrupts=(),
        ),
        StateSnapshot(
            values={"messages": []},
            next=(),
            config={},
            metadata=None,
            created_at=None,
            parent_config=None,
            tasks=(),
            interrupts=(),
        ),
        StateSnapshot(
            values={"messages": []},
            next=(),
            config={},
            metadata=None,
            created_at=None,
            parent_config=None,
            tasks=(),
            interrupts=(),
        ),
    ]

    with test_client.stream(
        "POST", "/stream", json={"message": QUESTION, "stream_tokens": False}
    ) as response:
        assert response.status_code == 200
        messages = []
        for line in response.iter_lines():
            if line and line.strip() != "data: [DONE]":
                messages.append(json.loads(line.lstrip("data: ")))

        tool_result_events = [msg for msg in messages if msg["type"] == "tool_result"]
        final_main_messages = [
            msg
            for msg in messages
            if msg["type"] == "message"
            and msg["branch_id"] == "root"
            and msg["content"]["type"] == "ai"
            and msg["content"]["content"] == "main answer"
        ]

        assert len(tool_result_events) == 1
        assert tool_result_events[0]["branch_id"] == "root"
        assert tool_result_events[0]["content"] == {
            "toolCallId": tool_call_id,
            "result": "branch answer",
        }
        assert messages.index(tool_result_events[0]) < messages.index(final_main_messages[0])


@pytest.mark.asyncio
async def test_stream_emits_distinct_branch_ids_for_interleaved_tokens(test_client, mock_agent) -> None:
    QUESTION = "Run branches."
    events = [
        (
            ("tools:branch-a",),
            "messages",
            (
                AIMessageChunk(content="A", id="chunk-a"),
                {"tags": [], "langgraph_path": ["tools:branch-a"]},
            ),
        ),
        (
            ("tools:branch-b",),
            "messages",
            (
                AIMessageChunk(content="B", id="chunk-b"),
                {"tags": [], "langgraph_path": ["tools:branch-b"]},
            ),
        ),
    ]

    async def mock_astream(**kwargs):
        for event in events:
            yield event

    mock_agent.astream = mock_astream

    with test_client.stream(
        "POST", "/stream", json={"message": QUESTION, "stream_tokens": True}
    ) as response:
        assert response.status_code == 200
        messages = []
        for line in response.iter_lines():
            if line and line.strip() != "data: [DONE]":
                messages.append(json.loads(line.lstrip("data: ")))

        token_events = [msg for msg in messages if msg["type"] == "token"]
        assert len(token_events) == 2
        assert token_events[0]["content"] == "A"
        assert token_events[0]["branch_id"] == "tools:branch-a"
        assert token_events[0]["message_id"] == "chunk-a"
        assert token_events[1]["content"] == "B"
        assert token_events[1]["branch_id"] == "tools:branch-b"
        assert token_events[1]["message_id"] == "chunk-b"


@pytest.mark.asyncio
async def test_stream_no_tokens(test_client, mock_agent) -> None:
    """Test streaming without tokens."""
    QUESTION = "What is the weather in Tokyo?"
    TOKENS = ["The", " weather", " in", " Tokyo", " is", " sunny", "."]
    FINAL_ANSWER = "The weather in Tokyo is sunny."

    # Configure mock to use our async iterator function
    events = [
        (
            "messages",
            (
                AIMessageChunk(content=token),
                {"tags": []},
            ),
        )
        for token in TOKENS
    ] + [
        (
            "updates",
            {"chat_model": {"messages": [AIMessage(content=FINAL_ANSWER)]}},
        )
    ]

    async def mock_astream(**kwargs):
        for event in events:
            yield event

    mock_agent.astream = mock_astream

    # Make request with streaming disabled
    with test_client.stream(
        "POST", "/stream", json={"message": QUESTION, "stream_tokens": False}
    ) as response:
        assert response.status_code == 200

        # Collect all SSE messages
        messages = []
        for line in response.iter_lines():
            if line and line.strip() != "data: [DONE]":  # Skip [DONE] message
                messages.append(json.loads(line.lstrip("data: ")))

        # Verify no token messages
        token_messages = [msg for msg in messages if msg["type"] == "token"]
        assert len(token_messages) == 0

        # Verify final message
        assert len(messages) == 1
        assert messages[0]["type"] == "message"
        assert messages[0]["content"]["content"] == FINAL_ANSWER
        assert messages[0]["content"]["type"] == "ai"


def test_stream_interrupt(test_client, mock_agent) -> None:
    QUESTION = "What is the weather in Tokyo?"
    INTERRUPT = "Confirm weather check"
    # Configure mock to use our async iterator function
    events = [
        (
            "updates",
            {"__interrupt__": [Interrupt(value=INTERRUPT)]},
        )
    ]

    async def mock_astream(**kwargs):
        for event in events:
            yield event

    mock_agent.astream = mock_astream

    # Make request with streaming disabled
    with test_client.stream(
        "POST", "/stream", json={"message": QUESTION, "stream_tokens": False}
    ) as response:
        assert response.status_code == 200

        # Collect all SSE messages
        messages = []
        for line in response.iter_lines():
            if line and line.strip() != "data: [DONE]":  # Skip [DONE] message
                messages.append(json.loads(line.lstrip("data: ")))

        # Verify interrupt message
        assert len(messages) == 1
        assert messages[0]["content"]["content"] == INTERRUPT
        assert messages[0]["content"]["type"] == "ai"


def test_info(test_client, mock_settings) -> None:
    """Test that /info returns the correct service metadata."""

    base_agent = Agent(description="A base agent.", graph=None)
    mock_settings.AUTH_SECRET = None
    mock_settings.DEFAULT_MODEL = OpenAIModelName.GPT_4O_MINI
    mock_settings.AVAILABLE_MODELS = {OpenAIModelName.GPT_4O_MINI, OpenAIModelName.GPT_4O}
    with patch.dict("agents.agents.agents", {"base-agent": base_agent}, clear=True):
        response = test_client.get("/info")
        assert response.status_code == 200
        output = ServiceMetadata.model_validate(response.json())

    assert output.default_agent == DEFAULT_AGENT
    assert len(output.agents) == 1
    assert output.agents[0].key == "base-agent"
    assert output.agents[0].description == "A base agent."

    assert output.default_model == OpenAIModelName.GPT_4O_MINI
    assert output.models == [OpenAIModelName.GPT_4O, OpenAIModelName.GPT_4O_MINI]
