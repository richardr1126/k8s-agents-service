import math
import re
from datetime import datetime
from typing import List

import numexpr
from langchain_community.tools import TavilySearchResults
from langchain_core.documents import Document
from langchain_core.tools import BaseTool, tool
from langchain_postgres import PGVector
from langchain_openai.embeddings import AzureOpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
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


# Format retrieved documents
def format_contexts(docs):
    return "\n\n".join(doc.page_content for doc in docs)


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


async def perform_web_search(query: str, max_results: int = 5):
    """Perform web search using Tavily API."""
    tavily_api_key = settings.TAVILY_API_KEY
    
    if not tavily_api_key:
        raise ValueError("TAVILY_API_KEY is required for web search functionality")
    
    try:
        web_search = TavilySearchResults(
            api_key=tavily_api_key.get_secret_value(),
            max_results=max_results,
            search_depth="advanced",
            include_answer=True,
            include_raw_content=True
        )
        
        search_results = await web_search.ainvoke(query)
        
        # Extract search result content
        search_content = []
        if isinstance(search_results, list):
            for result in search_results:
                if isinstance(result, dict):
                    # Handle Tavily result format
                    title = result.get("title", "")
                    content = result.get("content", "")
                    url = result.get("url", "")
                    formatted_content = f"Title: {title}\nContent: {content}\nSource: {url}\n"
                    search_content.append(formatted_content)
                else:
                    search_content.append(str(result))
        else:
            search_content.append(str(search_results))
            
        return search_content
        
    except Exception as e:
        raise RuntimeError(f"Web search failed: {str(e)}")


async def store_search_results_in_vector_db(search_results: List[str], collection_name: str) -> int:
    """Store search results in a vector database collection.
    
    Args:
        search_results: List of search result strings to store
        collection_name: Name of the collection to store results in
        
    Returns:
        Number of chunks stored in the database
        
    Raises:
        RuntimeError: If storing fails
    """
    if not search_results:
        raise ValueError("No search results to store")
    
    try:
        # Initialize text splitter
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
        )
        
        # Initialize PGVector using utility function with async mode
        pg_vector = create_pgvector_instance(collection_name, async_mode=True)
        
        # Convert search results to documents and split them
        documents = []
        for i, result in enumerate(search_results):
            doc = Document(
                page_content=result,
                metadata={
                    "source": f"web_search_result_{i}",
                    "collection": collection_name,
                    "timestamp": datetime.now().isoformat(),
                }
            )
            documents.append(doc)
        
        # Split documents into chunks
        chunks = text_splitter.split_documents(documents)
        
        # Add chunks to vector database (this is typically sync, but we can run it in executor if needed)
        await pg_vector.aadd_documents(chunks)
        
        return len(chunks)
        
    except Exception as e:
        raise RuntimeError(f"Error storing search results in vector database: {str(e)}")


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
def projects_search(query: str) -> str:
    """
    Searches Richard's projects for relevant documents.
    The contents are the README files from his repos.

    Args:
        query (str): The search query.
        
    Returns:
        str: The formatted search results.
    """
    pg_vector = create_pgvector_instance("richard-projects")
    retriever = pg_vector.as_retriever(search_kwargs={"k": 5})
    documents = retriever.invoke(query)
    context_str = format_contexts(documents)
    return context_str

@tool
def resume_search(query: str) -> str:
    """
    Searches Richard's resume for relevant documents.
    This contains educational and professional experience information as well as technical skills.

    Args:
        query (str): The search query.
        
    Returns:
        str: The formatted search results.
    """
    pg_vector = create_pgvector_instance("richard-resume")
    retriever = pg_vector.as_retriever(search_kwargs={"k": 5})
    documents = retriever.invoke(query)
    context_str = format_contexts(documents)
    return context_str