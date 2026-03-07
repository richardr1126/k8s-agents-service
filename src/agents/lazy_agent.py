"""Agent types with async initialization and dynamic graph creation."""

from abc import ABC, abstractmethod

from langgraph.graph.state import CompiledStateGraph
from langgraph.pregel import Pregel

from agents.configurable_model_graph import ConfigurableModelGraph


class LazyLoadingAgent(ABC):
    """Base class for agents that require async loading."""

    def __init__(self) -> None:
        self._loaded = False
        self._graph: CompiledStateGraph | Pregel | ConfigurableModelGraph | None = None

    @abstractmethod
    async def load(self) -> None:
        """Perform async loading for this agent and create its graph."""
        raise NotImplementedError  # pragma: no cover

    def get_graph(self) -> CompiledStateGraph | Pregel | ConfigurableModelGraph:
        """Get the graph created during `load()`."""
        if not self._loaded:
            raise RuntimeError("Agent not loaded. Call load() first.")
        if self._graph is None:
            raise RuntimeError("Agent graph not created during load().")
        return self._graph
