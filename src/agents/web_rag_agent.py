from datetime import datetime
from typing import Literal

from langchain_core.messages import AIMessage, SystemMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, MessagesState, StateGraph
from langgraph.types import StreamWriter
from pydantic import BaseModel, Field
import logging

from core import get_model, settings
from agents.tools import (
    perform_web_search, 
    store_search_results_in_vector_db,
    web_vector_search,
    cleanup_temp_collection
)
from agents.bg_task_agent.task import Task

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SearchQuery(BaseModel):
    """Structured output for optimized search query generation."""
    optimized_query: str = Field(
        description="An optimized search engine query (2-6 words) that captures key concepts and removes conversational elements"
    )
    reasoning: str = Field(
        description="Brief explanation of why this query was chosen and what key concepts it targets"
    )


class RelevanceDecision(BaseModel):
    """Structured output for relevance assessment and search decision."""
    needs_search: bool = Field(
        description="Whether a new web search is needed based on the existing context quality and query relevance"
    )
    reasoning: str = Field(
        description="Very short explanation of why this decision was made, including assessment of context quality and relevance"
    )


class FirstRunSearchDecision(BaseModel):
    """Structured output for first run search necessity assessment."""
    needs_web_search: bool = Field(
        description="Whether the user's question requires current web information that wouldn't be in a general AI model's training data"
    )
    reasoning: str = Field(
        description="Brief explanation of why web search is or isn't needed for this specific question"
    )


class WebRagState(MessagesState, total=False):
    """`total=False` is PEP589 specs.

    documentation: https://typing.readthedocs.io/en/latest/spec/typeddict.html#totality
    """
    
    is_search_relevant: bool = False  # Track if we have relevant context (from search or existing data)
    optimized_query: str = ""  # Store the optimized search query
    is_first_run: bool = True  # Track if this is the first execution
    has_search_data: bool = False  # Track if we actually have search data in vector store


def get_collection_name_from_thread(config: RunnableConfig) -> str:
    """Create a collection name based on the thread_id for persistence."""
    thread_id = config["configurable"].get("thread_id", "default")
    return f"web_search_{thread_id}"


async def generate_search_query_node(state: WebRagState, config: RunnableConfig) -> WebRagState:
    """Generate an optimized search query for the user's question."""
    # Get the user's latest message
    last_message = state["messages"][-1]
    if isinstance(last_message, HumanMessage):
        user_query = last_message.content
    else:
        user_query = "latest information"
    
    # Get conversation history for context
    conversation_history = ""
    if len(state["messages"]) > 1:
        # Include up to the last 5 messages for context, excluding the current one
        recent_messages = state["messages"][-6:-1] if len(state["messages"]) > 5 else state["messages"][:-1]
        history_parts = []
        for msg in recent_messages:
            if isinstance(msg, HumanMessage):
                history_parts.append(f"User: {msg.content}")
            elif isinstance(msg, AIMessage):
                history_parts.append(f"Assistant: {msg.content}")
        conversation_history = "\n".join(history_parts)
    
    # Generate optimized search query using AI model
    try:
        model = get_model(config["configurable"].get("model", settings.DEFAULT_MODEL))
        
        # Use structured output for search query generation
        model_name = getattr(model, 'deployment_name', getattr(model, 'name', 'unknown'))
        logger.info(f"Using model: {model_name}")
        structured_model = model.with_structured_output(
            SearchQuery, 
            **({"method": "function_calling"} if model_name == "gpt-5-chat" else {})
        )

        current_date = datetime.now().strftime("%Y-%m-%d")
        
        # Include conversation history in the prompt for better context
        search_query_prompt = f"""
        Based on the following conversation and user question, generate an optimized search query that will help find the most relevant and current information using keywords.

        Today's date is {current_date}.
        
        {"Conversation history:" if conversation_history else ""}
        {conversation_history}
        
        Current user question: {user_query}
        
        Instructions:
        - Create a concise search query (2-6 words) that captures the key concepts
        - Focus on specific, searchable terms rather than conversational language
        - Remove question words like "what", "how", "why" unless they're essential
        - Include relevant keywords that would appear in authoritative sources
        - Consider the conversation context to understand what the user is really asking about
        - If this is a follow-up question, incorporate relevant context from the conversation
        """

        # Create a config with skip_stream tag to prevent streaming
        internal_config = RunnableConfig(
            configurable=config["configurable"],
            run_id=config.get("run_id"),
            callbacks=config.get("callbacks", []),
            tags=["skip_stream"]
        )
        
        search_result = await structured_model.ainvoke(
            [SystemMessage(content=search_query_prompt)], 
            internal_config
        )
        optimized_query = search_result.optimized_query
        
        return {
            "optimized_query": optimized_query,
        }
        
    except Exception as e:
        # Fallback to user query if optimization fails
        optimized_query = user_query
        
        return {
            "optimized_query": optimized_query,
            "messages": [AIMessage(content=f"Query optimization failed, using original query: '{optimized_query}'")]
        }


async def web_search_and_store_node(state: WebRagState, config: RunnableConfig, *, writer: StreamWriter) -> WebRagState:
    """Search the web and store results in vector database."""
    # Use the optimized query from state
    optimized_query = state.get("optimized_query", "latest information")
    
    # Create collection name based on thread_id for persistence across conversation
    collection_name = get_collection_name_from_thread(config)
    
    # Initialize the task for tracking progress
    search_task = Task("Web Search & Store", writer)
    search_task.start(data={"optimized_query": optimized_query, "collection": collection_name})
    
    # Perform web search using the optimized query
    try:
        search_task.write_data(data={"status": "Searching the web...", "query": optimized_query})
        search_content = await perform_web_search(optimized_query, max_results=10)
        search_task.write_data(data={"status": f"{len(search_content)} web searches completed", "results_count": len(search_content)})
    except (ValueError, RuntimeError) as e:
        search_task.finish(result="error", data={"error": str(e)})
        return {
            "messages": [AIMessage(content=str(e))]
        }
    
    # Store search results in vector database
    try:
        search_task.write_data(data={"status": f"Storing {len(search_content)} results in vector database..."})
        num_chunks = await store_search_results_in_vector_db(search_content, collection_name)
        search_task.finish(
            result="success", 
            data={
                "status": "Successfully completed web search and storage",
                "chunks_stored": num_chunks,
                "collection": collection_name
            }
        )
    except (ValueError, RuntimeError) as e:
        search_task.finish(result="error", data={"error": str(e)})
        return {
            "messages": [AIMessage(content=str(e))]
        }
    
    return {
        "is_search_relevant": True,
        "is_first_run": False,  # Mark that first run is completed
        "has_search_data": True,  # Mark that we now have search data available
    }


async def rag_response_node(state: WebRagState, config: RunnableConfig) -> WebRagState:
    """Generate a response using RAG on the stored search results or general knowledge."""
    # Check if we have actual search data available in vector store
    has_search_data = state.get("has_search_data", False)
    
    if has_search_data:
        # Use the same thread-based collection name for consistency
        collection_name = get_collection_name_from_thread(config)
        
        # Extract user query from the last human message in the conversation
        last_human_message = None
        for message in reversed(state["messages"]):
            if isinstance(message, HumanMessage):
                last_human_message = message.content
                break
        
        user_query = last_human_message or "latest information"
        
        try:
            # Use utility function to perform web vector search
            context = web_vector_search(user_query, collection_name, k=5)
            
            # Create prompt for the model
            current_date = datetime.now().strftime("%B %d, %Y")
            system_prompt = f"""
            You are a helpful assistant that provides comprehensive answers based on recent web search results.
            Use the following context from web searches to answer the user's question.
            
            Today's date is {current_date}.
            
            Context from web search:
            {context}
            
            Instructions:
            - Provide a comprehensive and well-structured answer based on the search results
            - Include relevant details and examples from the context
            - When mentioning specific information, reference the sources when possible
            - If the context doesn't contain enough information to fully answer the question, acknowledge this
            - Be accurate and don't make up information not present in the context
            - Use markdown formatting for better readability (headers, lists, etc.)
            - If there are multiple perspectives or sources, present them fairly
            """
            
        except RuntimeError as e:
            return {"messages": [AIMessage(content=str(e))]}
    else:
        # Use general knowledge without web search context
        current_date = datetime.now().strftime("%B %d, %Y")
        system_prompt = f"""
        You are a helpful assistant that provides comprehensive answers using your general knowledge.
        
        Today's date is {current_date}.
        
        Instructions:
        - Provide a comprehensive and well-structured answer based on your knowledge
        - Use markdown formatting for better readability (headers, lists, etc.)
        - If you're not certain about current information that might have changed recently, mention this limitation
        - Be accurate and acknowledge if you don't have specific current information
        """
    
    # Get the model and generate response
    model = get_model(config["configurable"].get("model", settings.DEFAULT_MODEL))
    
    # Include conversation history like in the RAG assistant
    # Prepend the system prompt to the existing conversation
    messages = [SystemMessage(content=system_prompt)] + state["messages"]
    
    response = await model.ainvoke(messages, config)
    
    return {"messages": [response]}


async def check_first_run_search_need_node(state: WebRagState, config: RunnableConfig) -> WebRagState:
    """On first run, analyze if the user's prompt actually needs web search. On subsequent runs, route to search query generation."""
    # If not first run, just pass through - this will route to generate_search_query
    if not state.get("is_first_run", True):
        return state
    
    # Get the user's latest message
    last_message = state["messages"][-1]
    if isinstance(last_message, HumanMessage):
        user_query = last_message.content
    else:
        user_query = "latest information"
    
    try:
        model = get_model(config["configurable"].get("model", settings.DEFAULT_MODEL))
        
        # Use structured output for first run search decision
        model_name = getattr(model, 'deployment_name', getattr(model, 'name', 'unknown'))
        logger.info(f"Using model: {model_name}")
        structured_model = model.with_structured_output(
            FirstRunSearchDecision, 
            **({"method": "function_calling"} if model_name == "gpt-5-chat" else {})
        )

        current_date = datetime.now().strftime("%Y-%m-%d")
        
        first_run_prompt = f"""
        Analyze whether this user question requires current web information or can be answered with general knowledge.
        
        Today's date is {current_date}.
        
        User question: {user_query}
        
        Determine if web search is needed based on these criteria:
        
        NEEDS WEB SEARCH if the question asks about:
        - Current events, news, or recent developments
        - Real-time information (stock prices, weather, etc.)
        - Recent product releases or updates
        - Current status of companies, people, or projects
        - Latest research findings or publications
        - Up-to-date statistics or data
        - Recent changes in laws, policies, or regulations
        - Current availability, pricing, or specifications
        - Recent technological developments
        - Time-sensitive information that changes frequently
        
        DOES NOT NEED WEB SEARCH if the question is about:
        - General knowledge that doesn't change frequently
        - Historical facts or well-established information
        - Theoretical concepts or explanations
        - Basic how-to questions with standard procedures
        - Definitions or explanations of established concepts
        - Mathematical or scientific principles
        - Programming concepts or general coding help
        - General advice that doesn't depend on current information
        
        Be conservative: if in doubt about whether current information is needed, choose to search.
        """

        # Create a config with skip_stream tag to prevent streaming
        internal_config = RunnableConfig(
            configurable=config["configurable"],
            run_id=config.get("run_id"),
            callbacks=config.get("callbacks", []),
            tags=["skip_stream"]
        )
        
        decision = await structured_model.ainvoke(
            [SystemMessage(content=first_run_prompt)], 
            internal_config
        )

        return {
            "is_search_relevant": not decision.needs_web_search,  # If web search not needed, we have "relevant" context (general knowledge)
        }
        
    except Exception as e:
        # Fallback: if analysis fails, default to searching (conservative approach)
        logger.warning(f"First run search analysis failed: {e}")
        return {
            "is_search_relevant": False,  # Default to searching
        }


async def check_relevance_node(state: WebRagState, config: RunnableConfig) -> WebRagState:
    """Use AI model to intelligently decide if existing context is sufficient or if new search is needed."""
    optimized_query = state.get("optimized_query", "")
    collection_name = get_collection_name_from_thread(config)
    
    # Get user's current question for context
    last_human_message = None
    for message in reversed(state["messages"]):
        if isinstance(message, HumanMessage):
            last_human_message = message.content
            break
    
    user_query = last_human_message or "latest information"
    
    try:
        # Try to get existing context from vector database
        existing_context = web_vector_search(optimized_query, collection_name, k=5, score_threshold=0.3)
        context_length = len(existing_context.strip()) if existing_context else 0
        
        # Use AI model to make intelligent relevance decision
        model = get_model(config["configurable"].get("model", settings.DEFAULT_MODEL))

        # Use structured output for relevance decision
        model_name = getattr(model, 'deployment_name', getattr(model, 'name', 'unknown'))
        logger.info(f"Using model: {model_name}")
        structured_model = model.with_structured_output(
            RelevanceDecision, 
            **({"method": "function_calling"} if model_name == "gpt-5-chat" else {})
        )

        current_date = datetime.now().strftime("%Y-%m-%d")
        
        relevance_prompt = f"""
        You are an intelligent relevance assessor. Analyze whether the existing context is sufficient to answer the user's question, or if a new web search is needed.
        
        Today's date is {current_date}.
        
        User's original question: {user_query}
        Optimized search query: {optimized_query}
        
        Existing context from previous searches ({context_length} characters):
        {existing_context[:2000] if existing_context else "No existing context found"}
        
        Assessment criteria:
        1. Context relevance: Does the existing context directly relate to the user's question?
        2. Context completeness: Is there enough information to provide a comprehensive answer?
        3. Context freshness: For time-sensitive queries, is the information recent enough?
        4. Context quality: Is the information detailed and from credible sources?
        
        Decision guidelines:
        - needs_search = True if:
          * No existing context found
          * Context is not relevant to the query
          * Context is too brief/incomplete for a good answer
          * Query asks for very recent information and context seems outdated
          * Context quality is poor or unreliable
        
        - needs_search = False if:
          * Existing context is highly relevant and comprehensive
          * Context provides sufficient detail to answer the question well
          * Information appears current enough for the query type
          * Context comes from credible sources
        """

        # Create a config with skip_stream tag to prevent streaming
        internal_config = RunnableConfig(
            configurable=config["configurable"],
            run_id=config.get("run_id"),
            callbacks=config.get("callbacks", []),
            tags=["skip_stream"]
        )
        
        decision = await structured_model.ainvoke(
            [SystemMessage(content=relevance_prompt)], 
            internal_config
        )

        return {
            "is_search_relevant": not decision.needs_search,  # Invert because is_search_relevant means we have sufficient data
            "has_search_data": not decision.needs_search,  # We have search data if we don't need new search
            #"messages": [AIMessage(content=decision.reasoning)],
        }
        
    except RuntimeError as e:
        # If vector search fails (e.g., collection doesn't exist), we definitely need to search
        return {
            "is_search_relevant": False,
            "messages": [AIMessage(content=f"Vector database not found for query: '{optimized_query}'. Will perform web search.")]
        }
    except Exception as e:
        # Fallback: if AI decision fails, use simple heuristic
        context_exists = existing_context and len(existing_context.strip()) > 100
        return {
            "is_search_relevant": context_exists,
            "has_search_data": context_exists,
            "messages": [AIMessage(content=f"AI relevance assessment failed ({str(e)}), using fallback decision: {'Using existing context' if context_exists else 'Will search web'}")]
        }


def route_after_first_run_check(state: WebRagState) -> Literal["rag_response", "generate_search_query"]:
    """Route after first run check based on whether web search is needed or if it's a subsequent run."""
    # If not first run, route to search query generation
    if not state.get("is_first_run", True):
        return "generate_search_query"
    
    # If first run and search not needed, use general knowledge
    if state.get("is_search_relevant", False):
        return "rag_response"  # Can answer with general knowledge
    else:
        return "generate_search_query"  # Need to generate search query and search web


def route_after_search_query(state: WebRagState) -> Literal["check_relevance", "web_search_and_store"]:
    """Route after generating search query based on whether this is the first run."""
    if state.get("is_first_run", True):
        return "web_search_and_store"  # First run after deciding search is needed
    else:
        return "check_relevance"  # Subsequent runs check existing context


def route_after_relevance_check(state: WebRagState) -> Literal["rag_response", "web_search_and_store"]:
    """Route after relevance check based on whether we have sufficient context."""
    if state.get("is_search_relevant", False):
        return "rag_response"
    else:
        return "web_search_and_store"


# Define the graph
agent = StateGraph(WebRagState)

# Add nodes
agent.add_node("generate_search_query", generate_search_query_node)
agent.add_node("check_first_run_search_need", check_first_run_search_need_node)
agent.add_node("check_relevance", check_relevance_node)
agent.add_node("web_search_and_store", web_search_and_store_node)
agent.add_node("rag_response", rag_response_node)

# Set entry point based on first run
agent.set_entry_point("check_first_run_search_need")

# Define the flow with conditional routing
# First run check routes to either general response or search query generation
agent.add_conditional_edges(
    "check_first_run_search_need",
    route_after_first_run_check,
    {
        "generate_search_query": "generate_search_query",
        "rag_response": "rag_response"
    }
)
# Search query generation routes based on whether it's first run or subsequent
agent.add_conditional_edges(
    "generate_search_query",
    route_after_search_query,
    {
        "check_relevance": "check_relevance",
        "web_search_and_store": "web_search_and_store"
    }
)
agent.add_conditional_edges(
    "check_relevance",
    route_after_relevance_check,
    {
        "web_search_and_store": "web_search_and_store",
        "rag_response": "rag_response"
    }
)
agent.add_edge("web_search_and_store", "rag_response")
agent.add_edge("rag_response", END)

# Compile the graph
web_rag_agent = agent.compile()
