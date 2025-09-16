from langgraph_supervisor import create_supervisor

from core import get_model, settings
from agents.rag_assistant import rag_assistant
from agents.web_rag_agent import web_rag_agent

model = get_model(settings.DEFAULT_MODEL)

# Configure the resume agent (rag_assistant) with appropriate settings
# Note: Don't pre-configure here, let the supervisor pass through the config
resume_agent = rag_assistant

# Configure the web RAG agent with appropriate settings  
# Note: Don't pre-configure here, let the supervisor pass through the config
web_research_agent = web_rag_agent

# Create supervisor workflow
workflow = create_supervisor(
    [resume_agent, web_research_agent],
    model=model,
    prompt=(
        "You are a team supervisor managing a resume agent and a web research agent. "
        "Use the resume agent for questions about Richard's professional background, skills, "
        "experience, projects, education, or career-related information. "
        "Use the web rag agent for questions that require current information from the web, "
        "recent news, current events, real-time data, or any information that needs to be searched online. "
        "Choose the most appropriate agent based on the nature of the user's question."
        "\n\n"
        "Use these available tools:\n"
        "- call_resume-agent: For questions about Richard's resume, skills, experience, projects, and career.\n"
        "- call_web-rag-agent: For questions that require up-to-date information from the web or current events.\n\n"
        "When a user query is broad or ambiguous, decompose it into specific sub-questions and assign them to the appropriate agents. "
        "Ensure that each sub-question is clear and can be effectively addressed by the selected agent."
    ),
    handoff_tool_prefix="call_",
    add_handoff_back_messages=False,  # Don't add messages when agents hand back
    output_mode='last_message',  # Only return the last message, not full history
    supervisor_name="auto-router",  # Explicit name for the supervisor
)

langgraph_supervisor_agent = workflow.compile()
