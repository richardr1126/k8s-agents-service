import math
import re

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


# Format retrieved documents
def format_contexts(docs):
    return "\n\n".join(doc.page_content for doc in docs)


def load_pgvector_db(collection_name: str = "acme", k: int = 5):
    # Create the connection string
    connection_string = f"postgresql+psycopg://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD.get_secret_value()}@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"

    # Create the embedding function using Azure OpenAI
    try:
        embeddings = AzureOpenAIEmbeddings(
            api_key=settings.AZURE_OPENAI_API_KEY.get_secret_value(),
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            azure_deployment="text-embedding-3-large",
            api_version="2025-02-01-preview",
        )
    except Exception as e:
        raise RuntimeError(
            "Failed to initialize Embeddings. Ensure Azure OpenAI credentials are set correctly."
        ) from e

    # Load the PGVector database
    pg_vector = PGVector(
        embeddings=embeddings,
        collection_name=collection_name,  # Use the same collection name as in create_pgvector_db
        connection=connection_string,
        create_extension=False,
        use_jsonb=True,
    )

    retriever = pg_vector.as_retriever(search_kwargs={"k": k})
    return retriever

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
    retriever = load_pgvector_db(collection_name="richard-projects", k=5)
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
    retriever = load_pgvector_db(collection_name="richard-resume", k=5)
    documents = retriever.invoke(query)
    context_str = format_contexts(documents)
    return context_str