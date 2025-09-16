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
        "Use the web research agent for questions that require current information from the web, "
        "recent news, current events, real-time data, or any information that needs to be searched online. "
        "Choose the most appropriate agent based on the nature of the user's question. Don't add messages when agents hand back."
    ),
    add_handoff_back_messages=False,  # Don't add messages when agents hand back
    output_mode='last_message',  # Only return the last message, not full history
    supervisor_name="auto-router",  # Explicit name for the supervisor
)

langgraph_supervisor_agent = workflow.compile()
