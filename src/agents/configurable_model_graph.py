"""Graph wrapper that selects an agent graph based on per-request model config."""

from collections.abc import AsyncIterator, Callable, Iterator
from typing import Any, cast

from langchain_core.runnables import RunnableConfig

from core import settings
from schema.models import AllModelEnum


class ConfigurableModelGraph:
    """Route graph calls to a cached graph instance for the requested model."""

    def __init__(self, graph_factory: Callable[[AllModelEnum], Any]) -> None:
        self._graph_factory = graph_factory
        self._graphs: dict[AllModelEnum, Any] = {}
        self._checkpointer: Any = None
        self._store: Any = None

    @property
    def checkpointer(self) -> Any:
        return self._checkpointer

    @checkpointer.setter
    def checkpointer(self, checkpointer: Any) -> None:
        self._checkpointer = checkpointer
        for graph in self._graphs.values():
            graph.checkpointer = checkpointer

    @property
    def store(self) -> Any:
        return self._store

    @store.setter
    def store(self, store: Any) -> None:
        self._store = store
        for graph in self._graphs.values():
            graph.store = store

    def _graph_for_config(self, config: RunnableConfig | None) -> Any:
        configurable = (config or {}).get("configurable", {})
        model_name = configurable.get("model") or settings.DEFAULT_MODEL
        if model_name is None:
            raise ValueError("DEFAULT_MODEL must be configured.")
        model_name = cast(AllModelEnum, model_name)
        graph = self._graphs.get(model_name)
        if graph is None:
            graph = self._graph_factory(model_name)
            graph.checkpointer = self._checkpointer
            graph.store = self._store
            self._graphs[model_name] = graph
        return graph

    async def ainvoke(
        self, input: Any, config: RunnableConfig | None = None, **kwargs: Any
    ) -> Any:
        graph = self._graph_for_config(config)
        return await graph.ainvoke(input=input, config=config, **kwargs)

    def invoke(self, input: Any, config: RunnableConfig | None = None, **kwargs: Any) -> Any:
        graph = self._graph_for_config(config)
        return graph.invoke(input=input, config=config, **kwargs)

    async def astream(
        self, input: Any, config: RunnableConfig | None = None, **kwargs: Any
    ) -> AsyncIterator[Any]:
        graph = self._graph_for_config(config)
        async for event in graph.astream(input=input, config=config, **kwargs):
            yield event

    def stream(
        self, input: Any, config: RunnableConfig | None = None, **kwargs: Any
    ) -> Iterator[Any]:
        graph = self._graph_for_config(config)
        yield from graph.stream(input=input, config=config, **kwargs)

    async def aget_state(self, config: RunnableConfig | None = None, **kwargs: Any) -> Any:
        graph = self._graph_for_config(config)
        return await graph.aget_state(config=config, **kwargs)

    def get_state(self, config: RunnableConfig | None = None, **kwargs: Any) -> Any:
        graph = self._graph_for_config(config)
        return graph.get_state(config=config, **kwargs)
