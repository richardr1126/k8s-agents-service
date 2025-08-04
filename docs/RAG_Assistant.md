# Creating a RAG assistant

You can build a RAG assistant using PGVector with YugabyteDB or PostgreSQL.

## Setting up PGVector Database

To create a PGVector database:

1. Add the data you want to use to a folder, i.e. `./data`, Word and PDF files are currently supported.
2. Open [`create_pgvector_db.py` file](../scripts/create_pgvector_db.py) and set the root_folder_path variable to the path to your data i.e. `./data`.
3. You can change the collection names, chunk size and overlap size.
4. Assuming you have already followed the [Quickstart](#quickstart) and activated the virtual environment, to create the database run:

```sh
python scripts/create_pgvector_db.py
```

5. If successful, your documents will be embedded and stored in the PGVector database with vector indexes for similarity search.

## Configuring the RAG assistant

To create a RAG assistant:
1. Open [`tools.py` file](../src/agents/tools.py) and verify the `load_pgvector_db` function is configured correctly.
2. Modify the amount of documents returned (k parameter), currently set to 5.
3. Update the `database_search` tool function description to accurately describe what the purpose and contents of your database is.
4. Open [`rag_assistant.py` file](../src/agents/rag_assistant.py) and update the agent's instructions to describe what the assistant's specialty is and what knowledge it has access to, for example:

```python
instructions = f"""
    You are a helpful assistant with the ability to search a database containing information on various projects and technical documentation.
    Today's date is {current_date}.

    NOTE: THE USER CAN'T SEE THE TOOL RESPONSE.

    A few things to remember:
    - If you have access to multiple databases, gather information from a diverse range of sources before crafting your response.
    - Please include the source of the information used in your response.
    - Use a friendly but professional tone when replying.
    - Only use information from the database. Do not use information from outside sources.
    """
```

5. Open [`streamlit_app.py` file](../src/streamlit_app.py) and update the agent's welcome message:

```python
WELCOME = """Hello! I'm your AI assistant with access to a knowledge base of projects and technical documentation. Ask me anything!"""
```

6. Run the application and test your RAG assistant.

## Database Configuration

The RAG assistant uses PGVector with YugabyteDB for production deployments, providing:

- **Vector Similarity Search**: Efficient semantic search using pgvector extensions
- **Multiple Collections**: Support for different knowledge bases (e.g., "richard-projects", "acme")
- **Azure OpenAI Embeddings**: Uses text-embedding-3-large for high-quality embeddings
- **Production Scalability**: YugabyteDB's distributed architecture handles large document collections

The database connection and embedding configuration is handled automatically through the application settings.
