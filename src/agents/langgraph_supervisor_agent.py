from langgraph_supervisor import create_supervisor

from agents.configurable_model_graph import ConfigurableModelGraph
from core import get_model
from agents.rag_assistant import rag_assistant
from agents.mcp_agent import mcp_agent
from agents.web_rag_agent import web_rag_agent
from schema.models import AllModelEnum

SUPERVISOR_PROMPT = (
    "# Supervisor Instructions\n"
    "You are a team supervisor managing three specialized agents: a resume agent, a web research agent, and a database analyst. "
    "Use the resume agent for questions about Richard's professional background, skills, "
    "experience, projects, education, or career-related information. "
    "Use the web rag agent for questions that require current information from the web, "
    "recent news, current events, real-time data, or any information that needs to be searched online. "
    "Use the postgres agent for questions about the Cosmere Feed database, including user engagement metrics, "
    "content analysis, activity patterns, or any data-driven insights about the Bluesky feed featuring Brandon Sanderson's Cosmere content. "
    "Choose the most appropriate agent based on the nature of the user's question."
    "\n\n"
    "## Available Tools:\n"
    "- call_resume-agent: For questions about Richard's resume, skills, experience, projects, and career.\n"
    "- call_web-rag-agent: For questions that require up-to-date information from the web or current events.\n"
    "- call_postgres-mcp-agent: For questions about Cosmere Feed database analysis, user metrics, and content insights.\n\n"
    "When a user's query is broad or ambiguous, decompose it into specific sub-questions and assign them to the appropriate agents one at a time. "
    "Ensure that each sub-question is clear and can be effectively addressed by the selected agent."
    "\n\n"
    "REMEMBER ONLY CALL AGENTS ONE AT A TIME, WAIT FOR THE RESPONSE, THEN DECIDE NEXT STEPS.\n"
)


def _build_supervisor_graph(model_name: AllModelEnum):
    sub_agents = [rag_assistant, web_rag_agent, mcp_agent.get_graph()]
    resolved_sub_agents = [
        agent.graph_for_model(model_name)
        if isinstance(agent, ConfigurableModelGraph)
        else agent
        for agent in sub_agents
    ]
    workflow = create_supervisor(
        resolved_sub_agents,
        model=get_model(model_name),
        prompt=SUPERVISOR_PROMPT,
        handoff_tool_prefix="call_",
        add_handoff_back_messages=False,  # Don't add messages when agents hand back
        output_mode="last_message",  # Only return the last message, not full history
        supervisor_name="auto-router",  # Explicit name for the supervisor
        include_agent_name="inline",  # Include agent name in messages
    )
    return workflow.compile()


langgraph_supervisor_agent = ConfigurableModelGraph(_build_supervisor_graph)
