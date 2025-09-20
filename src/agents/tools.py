import math
import re
from datetime import datetime
from typing import Dict, Any, Optional, List
import logging

import numexpr
from langchain_core.tools import BaseTool, tool
from langchain_postgres import PGVector
from langchain_openai.embeddings import AzureOpenAIEmbeddings
from langchain_mcp_adapters.client import MultiServerMCPClient

from core import settings

logger = logging.getLogger(__name__)

async def get_mcp_tools() -> list:
    try:
        # Initialize MCP client to connect to postgres-mcp server
        mcp_client = MultiServerMCPClient(
            {
                "postgres-mcp": {
                    "url": settings.POSTGRES_MCP_URL,
                    "transport": "sse",
                }
            }
        )
        
        # Load MCP tools from the postgres server
        mcp_tools = await mcp_client.get_tools()
        logger.info(f"Successfully loaded {len(mcp_tools)} MCP tools from postgres server")
        return mcp_tools
        
    except Exception as e:
        # Fallback gracefully if MCP connection fails
        logger.warning(f"Could not connect to MCP server at {settings.POSTGRES_MCP_URL}: {e}")
        logger.info("Continuing with no tools...")
        return []

def calculator_func(expression: str) -> str:
    """Calculates a math expression using numexpr.

    Useful for when you need to answer questions about math using numexpr.
    This tool is only for math questions and nothing else. Only input
    math expressions.

    Args:
        expression (str): A valid numexpr formatted math expression.

    Returns:
        str: The result of the math expression.
    """

    try:
        local_dict = {"pi": math.pi, "e": math.e}
        output = str(
            numexpr.evaluate(
                expression.strip(),
                global_dict={},  # restrict access to globals
                local_dict=local_dict,  # add common mathematical functions
            )
        )
        return re.sub(r"^\[|\]$", "", output)
    except Exception as e:
        raise ValueError(
            f'calculator("{expression}") raised error: {e}.'
            " Please try again with a valid numerical expression"
        )


calculator: BaseTool = tool(calculator_func)
calculator.name = "Calculator"


def format_contexts(docs):
    return "\n\n".join(doc.page_content for doc in docs)


def build_keyword_filter(query: str, collection_type: str) -> Dict[str, Any]:
    """Build metadata filter dictionary based on keywords found in the query.
    
    Uses simple keyword matching as recommended for enterprise RAG systems.
    More reliable than LLM-based metadata extraction.
    """
    filter_dict = {}
    query_lower = query.lower()
    
    if collection_type == "projects":
        # Technology keywords for tag filtering
        tech_keywords = {
            "python": "python",
            "react": "react", 
            "typescript": "typescript",
            "javascript": "javascript",
            "nextjs": "nextjs",
            "next.js": "nextjs",
            "django": "django",
            "fastapi": "fastapi",
            "streamlit": "streamlit",
            "docker": "docker",
            "kubernetes": "kubernetes",
            "k8s": "kubernetes",
            "postgresql": "postgresql",
            "postgres": "postgresql",
            "mongodb": "mongodb",
            "redis": "redis",
            "tensorflow": "tensorflow",
            "pytorch": "pytorch",
            "openai": "openai",
            "langchain": "langchain",
            "anthropic": "anthropic",
            "azure": "azure",
            "aws": "aws",
            "gcp": "gcp",
            "google cloud": "gcp"
        }
        
        # Check for technology tags using $like operator for JSON array search
        matching_tags = []
        for keyword, tag in tech_keywords.items():
            if keyword in query_lower:
                matching_tags.append(tag)
        
        if matching_tags:
            # Use $like operator to search within JSON arrays
            # This works by treating the JSON array as a string and searching for the tag value
            tag_filters = []
            for tag in matching_tags:
                tag_filters.append({"tags": {"$like": f"%{tag}%"}})
            
            # If multiple tags, use $or to match any of them
            if len(tag_filters) == 1:
                filter_dict.update(tag_filters[0])
            else:
                filter_dict["$or"] = tag_filters
        
        # Content type filtering
        if "readme" in query_lower or "documentation" in query_lower or "detailed" in query_lower:
            filter_dict["content_type"] = {"$eq": "readme"}
        elif "description" in query_lower or "summary" in query_lower or "overview" in query_lower:
            filter_dict["content_type"] = {"$eq": "description"}
    
    elif collection_type == "resume":
        # Section-based filtering for resume
        if any(keyword in query_lower for keyword in ["work", "experience", "job", "employment", "career"]):
            filter_dict["section"] = {"$eq": "Work Experience"}
        elif any(keyword in query_lower for keyword in ["education", "school", "university", "degree", "colorado", "boulder", "cu"]):
            filter_dict["section"] = {"$eq": "Education"}
        elif any(keyword in query_lower for keyword in ["skills", "technical", "programming", "languages", "technologies"]):
            filter_dict["section"] = {"$eq": "Skills"}
        
        # Source-based filtering
        if "pdf" in query_lower:
            filter_dict["source"] = {"$like": "%drive.google.com%"}
        elif "web" in query_lower or "website" in query_lower:
            filter_dict["source"] = {"$like": "%richardr.dev%"}
    
    return filter_dict


def get_embeddings():
    """Get the embeddings model."""
    return AzureOpenAIEmbeddings(
        api_key=settings.AZURE_OPENAI_API_KEY.get_secret_value(),
        azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
        azure_deployment="text-embedding-3-large",
        api_version="2025-02-01-preview",
    )


def get_pgvector_connection():
    """Get PGVector connection string."""
    return f"postgresql+psycopg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD.get_secret_value()}@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"


def create_pgvector_instance(collection_name: str, async_mode: bool = False):
    """Create a PGVector instance for a given collection."""
    embeddings = get_embeddings()
    connection_string = get_pgvector_connection()
    
    return PGVector(
        embeddings=embeddings,
        collection_name=collection_name,
        connection=connection_string,
        create_extension=False,
        use_jsonb=True,
        async_mode=async_mode,
    )

async def web_vector_search(query: str, collection_name: str, k: int = 5, score_threshold: float = None) -> str:
    """Search a temporary web collection for relevant documents.
    
    Args:
        query: The search query
        collection_name: Name of the temporary collection to search
        k: Number of results to return
        score_threshold: Minimum relevance threshold for similarity_score_threshold
        
    Returns:
        Formatted search results as a string
        
    Raises:
        RuntimeError: If search fails
    """
    try:
        # Initialize PGVector using utility function
        pg_vector = create_pgvector_instance(collection_name, async_mode=True)
        
        # Create retriever with score threshold if provided
        search_kwargs = {"k": k}
        if score_threshold is not None:
            retriever = pg_vector.as_retriever(
                search_type="similarity_score_threshold",
                search_kwargs={
                    "k": k,
                    "score_threshold": score_threshold
                }
            )
        else:
            retriever = pg_vector.as_retriever(search_kwargs=search_kwargs)
        
        # Retrieve relevant documents
        relevant_docs = await retriever.ainvoke(query)

        # Format the context from retrieved documents using utility function
        context = format_contexts(relevant_docs)
        
        return context
        
    except Exception as e:
        raise RuntimeError(f"Error performing web vector search: {str(e)}")


async def cleanup_temp_collection(collection_name: str) -> bool:
    """Clean up temporary collection from the database."""
    try:
        pg_vector = create_pgvector_instance(collection_name, async_mode=True)
        
        # Delete the collection
        await pg_vector.adelete_collection()
        return True
    except Exception as e:
        print(f"Warning: Could not cleanup temporary collection {collection_name}: {e}")
        return False


@tool
async def projects_search(query: str) -> str:
    """
    Searches Richard's projects for relevant documents.
    The contents include project descriptions and README files from his repos.
    
    Automatically filters based on keywords in your query:
    - Technology keywords: python, react, typescript, nextjs, etc.
    - Content type keywords: "readme" for detailed docs, "description" for summaries
    - Project keywords: specific project names will be matched
    
    Args:
        query (str): Search query for technical projects. Include technology names,
                    project features, or specific project names you're looking for. DO NOT INCLUDE UNRELATED TERMS IN A SINGLE QUERY.
        
    Returns:
        str: The formatted search results.
    """
    pg_vector = create_pgvector_instance("richard-projects", async_mode=True)
    
    # Build metadata filter based on keywords in query
    filter_dict = build_keyword_filter(query, collection_type="projects")
    
    # Create search kwargs with filter
    search_kwargs = {"k": 5}
    if filter_dict:
        search_kwargs["filter"] = filter_dict
    
    retriever = pg_vector.as_retriever(search_kwargs=search_kwargs)
    documents = await retriever.ainvoke(query)
    context_str = format_contexts(documents)
    return context_str

@tool
async def resume_search(query: str) -> str:
    """
    Searches Richard's resume for relevant documents.
    This contains educational and professional experience information as well as technical skills.
    
    Automatically filters based on keywords in your query:
    - Section keywords: "work", "experience", "job", "education", "skills", "technical"
    - Source keywords: "pdf" for PDF resume, "web" for website content
    - University keywords: "colorado", "boulder", "cu" for education info
    
    Args:
        query (str): Search query for resume information. Include terms like
                    "work experience", "education", "skills", or specific technologies. DO NOT INCLUDE UNRELATED TERMS IN A SINGLE QUERY.
        
    Returns:
        str: The formatted search results.
    """
    pg_vector = create_pgvector_instance("richard-resume", async_mode=True)
    
    # Build metadata filter based on keywords in query
    filter_dict = build_keyword_filter(query, collection_type="resume")
    
    # Create search kwargs with filter
    search_kwargs = {"k": 5}
    if filter_dict:
        search_kwargs["filter"] = filter_dict
    
    retriever = pg_vector.as_retriever(search_kwargs=search_kwargs)
    documents = await retriever.ainvoke(query)
    context_str = format_contexts(documents)
    return context_str