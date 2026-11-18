from dataclasses import dataclass

from langgraph.graph.state import CompiledStateGraph
from langgraph.pregel import Pregel

from agents.chatbot import chatbot
from agents.configurable_model_graph import ConfigurableModelGraph
from agents.main_agent import main_agent
from agents.rag_assistant import rag_assistant
from agents.web_rag_agent import web_rag_agent
from agents.workflow_agent import workflow_agent
from schema import AgentInfo

DEFAULT_AGENT = "auto-router"

# Type alias to handle LangGraph's different agent patterns
# - @entrypoint functions return Pregel
# - StateGraph().compile() returns CompiledStateGraph
AgentGraph = CompiledStateGraph | Pregel | ConfigurableModelGraph


@dataclass
class Agent:
    description: str
    graph: AgentGraph


agents: dict[str, Agent] = {
    "chatbot": Agent(description="A simple chatbot.", graph=chatbot),
    "auto-router": Agent(
        description="Hello! I'm an agent that routes between a resume assistant and a web research assistant. Ask follow-ups any time; they pick up where they left off.",
        graph=main_agent,
    ),
    "resume-agent": Agent(
        description="""Hello! I'm a professional resume assistant designed to help showcase Richard's skills, experience, and accomplishments.
        I can search through resume information and project repositories to provide comprehensive answers about his professional background, technical skills, work experience, and project achievements. Ask me anything about his career!""",
        graph=rag_assistant,
    ),
    "web-rag-agent": Agent(
        description="""Hello! I'm a web research assistant designed to help you find information online.
        I can browse the web, summarize articles, and provide you with the most relevant information. Ask me anything about your research topic!""",
        graph=web_rag_agent,
    ),
    "workflow-agent": Agent(
        description="""Hello! I'm a workflow-driven assistant. I expose a small tool surface (list_capabilities, read_capability, run_workflow_cli) that fronts a library of pregenerated CLI-style workflows. Ask me what I can do, or give me a task and I'll discover the right workflow and run it.""",
        graph=workflow_agent,
    ),
}


def get_agent(agent_id: str) -> AgentGraph:
    return agents[agent_id].graph


def get_all_agent_info() -> list[AgentInfo]:
    return [
        AgentInfo(key=agent_id, description=agent.description) for agent_id, agent in agents.items()
    ]
