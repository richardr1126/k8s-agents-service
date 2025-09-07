from dataclasses import dataclass

from langgraph.graph.state import CompiledStateGraph
from langgraph.pregel import Pregel

from agents.bg_task_agent.bg_task_agent import bg_task_agent
from agents.chatbot import chatbot
from agents.command_agent import command_agent
from agents.interrupt_agent import interrupt_agent
from agents.knowledge_base_agent import kb_agent
from agents.langgraph_supervisor_agent import langgraph_supervisor_agent
from agents.rag_assistant import rag_assistant
from agents.research_assistant import research_assistant
from agents.web_rag_agent import web_rag_agent
from schema import AgentInfo

DEFAULT_AGENT = "resume-agent"

# Type alias to handle LangGraph's different agent patterns
# - @entrypoint functions return Pregel
# - StateGraph().compile() returns CompiledStateGraph
AgentGraph = CompiledStateGraph | Pregel


@dataclass
class Agent:
    description: str
    graph: AgentGraph


agents: dict[str, Agent] = {
    "chatbot": Agent(description="A simple chatbot.", graph=chatbot),
    # "research-assistant": Agent(
    #     description="A research assistant with web search and calculator.", graph=research_assistant
    # ),
    "resume-agent": Agent(
        description="""Hello! I'm a professional resume assistant designed to help showcase Richard's skills, experience, and accomplishments.
        I can search through resume information and project repositories to provide comprehensive answers about his professional background, technical skills, work experience, and project achievements. Ask me anything about his career!""",
        graph=rag_assistant
    ),
    "web-rag-agent": Agent(
        description="""Hello! I'm a web research assistant designed to help you find information online.
        I can browse the web, summarize articles, and provide you with the most relevant information. Ask me anything about your research topic!""",
        graph=web_rag_agent
    ),
    # "command-agent": Agent(description="A command agent.", graph=command_agent),
    # "bg-task-agent": Agent(description="A background task agent.", graph=bg_task_agent),
    # "langgraph-supervisor-agent": Agent(
    #     description="A langgraph supervisor agent", graph=langgraph_supervisor_agent
    # ),
    # "interrupt-agent": Agent(description="An agent the uses interrupts.", graph=interrupt_agent),
    # "knowledge-base-agent": Agent(
    #     description="A retrieval-augmented generation agent using Amazon Bedrock Knowledge Base",
    #     graph=kb_agent,
    # ),
}


def get_agent(agent_id: str) -> AgentGraph:
    return agents[agent_id].graph


def get_all_agent_info() -> list[AgentInfo]:
    return [
        AgentInfo(key=agent_id, description=agent.description) for agent_id, agent in agents.items()
    ]
