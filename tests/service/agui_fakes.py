"""Hermetic graphs and a scripted chat model for the AG-UI endpoint tests."""

import json
from collections.abc import AsyncIterator, Callable
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    ToolMessage,
)
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langgraph.graph import END, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.types import interrupt

import agents.main_agent as main_agent
import agents.web_rag_agent as web_rag_agent
from agents.configurable_model_graph import ConfigurableModelGraph
from agents.utils import internal_llm_config

Responder = Callable[[list[BaseMessage]], AIMessage]


class ScriptedChatModel(BaseChatModel):
    """Streams whatever `responder` returns for the given messages, tool calls included."""

    responder: Responder

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools: Any, **kwargs: Any) -> "ScriptedChatModel":  # type: ignore[override]
        return self

    def _generate(self, messages: list[BaseMessage], *args: Any, **kwargs: Any) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=self.responder(messages))])

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        message = self.responder(messages)
        text = message.content if isinstance(message.content, str) else ""
        words = text.split(" ") if text else []
        for piece in words[:1] + [" " + word for word in words[1:]]:
            chunk = AIMessageChunk(content=piece, id=message.id)
            if run_manager:
                await run_manager.on_llm_new_token(
                    chunk.text, chunk=ChatGenerationChunk(message=chunk)
                )
            yield ChatGenerationChunk(message=chunk)
        for index, call in enumerate(message.tool_calls):
            yield ChatGenerationChunk(
                message=AIMessageChunk(
                    content="",
                    id=message.id,
                    tool_call_chunks=[
                        {
                            "name": call["name"],
                            "args": json.dumps(call["args"]),
                            "id": call["id"],
                            "index": index,
                        }
                    ],
                )
            )


def _last_human(messages: list[BaseMessage]) -> str:
    return next(str(m.content) for m in reversed(messages) if isinstance(m, HumanMessage))


def main_responder(messages: list[BaseMessage]) -> AIMessage:
    """User text "type:topic|type:topic" dispatches one `task` per entry, then summarises."""
    turn = sum(isinstance(m, HumanMessage) for m in messages)
    if isinstance(messages[-1], HumanMessage):
        entries = [entry.split(":") for entry in _last_human(messages).split("|")]
        calls = [
            {
                "name": "task",
                "args": {"description": f"research {topic}", "subagent_type": subagent_type},
                "id": f"call_{topic}_{turn}",
            }
            for subagent_type, topic in entries
        ]
        return AIMessage(content="", id=f"main-dispatch-{turn}", tool_calls=calls)
    results = [str(m.content) for m in messages if isinstance(m, ToolMessage)]
    return AIMessage(content=f"Summary: {results[-1]}", id=f"main-answer-{turn}")


# --- a generic sub-agent: model -> tools (ToolNode) -> model ------------------


@tool
def lookup(topic: str) -> str:
    """Look a topic up."""
    return f"facts about {topic}"


@tool
def confirm(question: str) -> str:
    """Ask the user to confirm before continuing."""
    return f"user said {interrupt({'question': question})}"


def sub_responder(messages: list[BaseMessage]) -> AIMessage:
    description = _last_human(messages)
    if "boom" in description:
        raise RuntimeError("search backend down")
    name = description.split()[-1]
    if isinstance(messages[-1], HumanMessage):
        tool_name = "confirm" if "confirm" in description else "lookup"
        arg = "question" if tool_name == "confirm" else "topic"
        call = {"name": tool_name, "args": {arg: name}, "id": f"call_{tool_name}_{name}"}
        return AIMessage(content="", id=f"sub-{name}-call", tool_calls=[call])
    return AIMessage(content=f"Answer for {name}: {messages[-1].content}", id=f"sub-{name}-answer")


def build_sub_agent() -> Any:
    model = ScriptedChatModel(responder=sub_responder)

    async def call_model(state: MessagesState, config: RunnableConfig) -> dict:
        return {"messages": [await model.ainvoke(state["messages"], config)]}

    graph = StateGraph(MessagesState)
    graph.add_node("model", call_model)
    graph.add_node("tools", ToolNode([lookup, confirm]))
    graph.set_entry_point("model")
    graph.add_conditional_edges("model", tools_condition, {"tools": "tools", END: END})
    graph.add_edge("tools", "model")
    return graph.compile(name="fake-sub")


def build_router(monkeypatch: Any) -> ConfigurableModelGraph:
    """The real main agent with scripted models; "web" is the real web agent."""
    monkeypatch.setattr(
        main_agent, "get_model", lambda _: ScriptedChatModel(responder=main_responder)
    )
    sub_agent = build_sub_agent()
    resolve = main_agent._resolve_sub_agent
    monkeypatch.setattr(
        main_agent,
        "_resolve_sub_agent",
        lambda t: resolve(t) if t == "web" else sub_agent,
    )
    patch_web_agent(monkeypatch)
    return ConfigurableModelGraph(main_agent._build_main_graph)


# --- the real web agent, with its LLM, search and vector store faked ----------

WEB_ANSWER = "Rust 2.0 shipped in October."


def web_responder(messages: list[BaseMessage]) -> AIMessage:
    prompt = str(messages[0].content) if messages else ""
    if "requires current web information" in prompt:
        args: dict[str, Any] = {"needs_web_search": True, "reasoning": "INTERNAL-first-run"}
        return AIMessage(
            content="INTERNAL decision text",
            id="web-internal-1",
            tool_calls=[{"name": "FirstRunSearchDecision", "args": args, "id": "call_internal_1"}],
        )
    if "optimized search query" in prompt:
        args = {"optimized_query": "rust release", "reasoning": "INTERNAL-query"}
        return AIMessage(
            content="INTERNAL query text",
            id="web-internal-2",
            tool_calls=[{"name": "SearchQuery", "args": args, "id": "call_internal_2"}],
        )
    if "relevance assessor" in prompt:
        args = {"needs_search": True, "reasoning": "INTERNAL-relevance"}
        return AIMessage(
            content="INTERNAL relevance text",
            id="web-internal-3",
            tool_calls=[{"name": "RelevanceDecision", "args": args, "id": "call_internal_3"}],
        )
    return AIMessage(content=WEB_ANSWER, id="web-answer")


def patch_web_agent(monkeypatch: Any) -> None:
    async def fake_search(query: str, max_results: int = 5) -> list[str]:
        return [f"Title: {query}\nContent: {WEB_ANSWER}\nSource: https://example.test\n"]

    async def fake_store(results: list[str], collection_name: str) -> int:
        return len(results)

    async def fake_vector_search(query: str, collection_name: str, **kwargs: Any) -> str:
        return WEB_ANSWER

    monkeypatch.setattr(
        web_rag_agent, "get_model", lambda _: ScriptedChatModel(responder=web_responder)
    )
    monkeypatch.setattr(web_rag_agent, "perform_web_search", fake_search)
    monkeypatch.setattr(web_rag_agent, "store_search_results_in_vector_db", fake_store)
    monkeypatch.setattr(web_rag_agent, "web_vector_search", fake_vector_search)


# --- a graph whose only "internal" call must not stream ------------------------


def build_internal_call_graph() -> Any:
    model = ScriptedChatModel(
        responder=lambda m: AIMessage(
            content="INTERNAL" if "internal" in str(m[-1].content) else "visible reply",
            id="internal" if "internal" in str(m[-1].content) else "visible",
        )
    )

    async def node(state: MessagesState, config: RunnableConfig) -> dict:
        await model.ainvoke([HumanMessage("internal")], internal_llm_config(config))
        return {"messages": [await model.ainvoke(state["messages"], config)]}

    graph = StateGraph(MessagesState)
    graph.add_node("respond", node)
    graph.set_entry_point("respond")
    graph.add_edge("respond", END)
    return graph.compile(name="internal-call")
