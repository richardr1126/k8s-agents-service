import math
import re
from datetime import datetime
from typing import Dict, Any, Optional, List

import numexpr
from langchain_core.tools import BaseTool, tool
from langchain_postgres import PGVector
from langchain_openai.embeddings import AzureOpenAIEmbeddings
from core import settings


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


def build_metadata_filter(
    content_type: Optional[str] = None,
    section: Optional[str] = None,
    project_title: Optional[str] = None,
    tags: Optional[str] = None
) -> Dict[str, Any]:
    """Build metadata filter dictionary for PGVector queries."""
    filter_dict = {}
    
    if content_type:
        filter_dict["content_type"] = {"$eq": content_type}
    
    if section:
        filter_dict["section"] = {"$eq": section}
    
    if project_title:
        filter_dict["title"] = {"$like": f"%{project_title}%"}
    
    if tags:
        # Convert tags to lowercase and split
        tag_list = [tag.strip().lower() for tag in tags.split(",")]
        # Use overlap operator for JSONB arrays in PostgreSQL
        filter_dict["tags"] = {"$overlap": tag_list}
    
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


def web_vector_search(query: str, collection_name: str, k: int = 5, score_threshold: float = None) -> str:
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
        pg_vector = create_pgvector_instance(collection_name)
        
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
        relevant_docs = retriever.invoke(query)
        
        # Format the context from retrieved documents using utility function
        context = format_contexts(relevant_docs)
        
        return context
        
    except Exception as e:
        raise RuntimeError(f"Error performing web vector search: {str(e)}")


def cleanup_temp_collection(collection_name: str) -> bool:
    """Clean up temporary collection from the database."""
    try:
        pg_vector = create_pgvector_instance(collection_name)
        
        # Delete the collection
        pg_vector.delete_collection()
        return True
    except Exception as e:
        print(f"Warning: Could not cleanup temporary collection {collection_name}: {e}")
        return False


@tool
def projects_search(
    query: str, 
    tags: Optional[str] = None, 
    content_type: Optional[str] = None, 
    project_title: Optional[str] = None,
    k: int = 5
) -> str:
    """
    Searches Richard's projects for relevant documents.
    The contents are the README files from his repos.

    Args:
        query (str): Optimized search query for technical projects documentation.
        tags (str, optional): Comma-separated list of technology tags to filter by (e.g., "python,react,typescript").
        content_type (str, optional): Filter by content type - "description" or "readme".
        project_title (str, optional): Filter by specific project title (partial match supported).
        k (int, optional): Number of results to return (default: 5).
        
    Returns:
        str: The formatted search results.
    """
    pg_vector = create_pgvector_instance("richard-projects")
    
    # Build metadata filter using helper function
    filter_dict = build_metadata_filter(
        content_type=content_type,
        project_title=project_title,
        tags=tags
    )
    
    # Create search kwargs with filter
    search_kwargs = {"k": k}
    if filter_dict:
        search_kwargs["filter"] = filter_dict
    
    retriever = pg_vector.as_retriever(search_kwargs=search_kwargs)
    documents = retriever.invoke(query)
    context_str = format_contexts(documents)
    return context_str

@tool
def resume_search(
    query: str, 
    section: Optional[str] = None, 
    k: int = 5
) -> str:
    """
    Searches Richard's resume for relevant documents.
    This contains educational and professional experience information as well as technical skills.

    Args:
        query (str): Optimized search query for Richard's resume.
        section (str, optional): Filter by resume section - "Work Experience", "Education", "Skills", etc.
        k (int, optional): Number of results to return (default: 5).
        
    Returns:
        str: The formatted search results.
    """
    pg_vector = create_pgvector_instance("richard-resume")
    
    # Build metadata filter using helper function
    filter_dict = build_metadata_filter(section=section)
    
    # Create search kwargs with filter
    search_kwargs = {"k": k}
    if filter_dict:
        search_kwargs["filter"] = filter_dict
    
    retriever = pg_vector.as_retriever(search_kwargs=search_kwargs)
    documents = retriever.invoke(query)
    context_str = format_contexts(documents)
    return context_str