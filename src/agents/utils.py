from langchain_core.runnables import RunnableConfig
from langchain_core.runnables.config import merge_configs


def internal_llm_config(config: RunnableConfig) -> RunnableConfig:
    """Config for LLM calls whose output is not part of the conversation.

    ag-ui-langgraph skips streaming for runs with these metadata flags; the
    `langsmith:nostream` tag does the same for LangGraph's own stream modes.
    """
    return merge_configs(
        config,
        {
            "metadata": {"emit-messages": False, "emit-tool-calls": False},
            "tags": ["langsmith:nostream"],
        },
    )
