import os

from dotenv import load_dotenv
from langchain_community.document_loaders import Docx2txtLoader, PyPDFLoader
from langchain_openai import OpenAIEmbeddings
from langchain_postgres import PGVector
from langchain_text_splitters import RecursiveCharacterTextSplitter

# Load environment variables from the .env file
load_dotenv()


def create_pgvector_db_for_folder(
    folder_path: str,
    collection_name: str,
    connection_string: str,
    embeddings,
    reset_db: bool = True,
    chunk_size: int = 2000,
    chunk_overlap: int = 500,
):
    # Initialize PGVector for this collection
    pg_vector = PGVector(
        embeddings=embeddings,
        collection_name=collection_name,
        connection=connection_string,
        use_jsonb=True,
        create_extension=True,
    )
    
    # Reset the collection if requested
    if reset_db:
        pg_vector.delete_collection()
        pg_vector.create_collection()
        print(f"Reset the collection {collection_name}")

    # Initialize text splitter
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    # Iterate over files in the folder
    for filename in os.listdir(folder_path):
        file_path = os.path.join(folder_path, filename)
        
        # Skip directories
        if os.path.isdir(file_path):
            continue

        # Load document based on file extension
        # Add more loaders if required, i.e. JSONLoader, TxtLoader, etc.
        if filename.endswith(".pdf"):
            loader = PyPDFLoader(file_path)
        elif filename.endswith(".docx"):
            loader = Docx2txtLoader(file_path)
        elif filename.endswith(".md") or filename.endswith(".txt"):
            from langchain_community.document_loaders import TextLoader
            loader = TextLoader(file_path)
        else:
            continue  # Skip unsupported file types

        # Load and split document into chunks
        document = loader.load()
        chunks = text_splitter.split_documents(document)
        chunks = [c for c in chunks if c.page_content and c.page_content.strip()]
        if not chunks:
            print(f"Document {filename} has no non-empty chunks. Skipping.")
            continue

        # Update metadata to include the title (filename) and collection name
        for chunk in chunks:
            if 'source' in chunk.metadata:
                chunk.metadata['title'] = os.path.basename(chunk.metadata['source'])
                chunk.metadata['collection'] = collection_name

        # Add chunks to PGVector with fallback for transient empty embedding responses.
        try:
            pg_vector.add_documents(chunks)
            print(f"Document {filename} added to collection {collection_name}.")
        except ValueError as e:
            if "No embedding data received" not in str(e):
                raise
            print(
                f"Batch embed returned no data for {filename}. "
                "Retrying with smaller batches."
            )
            added = 0
            skipped = 0
            batch_size = 8
            for i in range(0, len(chunks), batch_size):
                batch = chunks[i : i + batch_size]
                try:
                    pg_vector.add_documents(batch)
                    added += len(batch)
                except ValueError as batch_error:
                    if "No embedding data received" not in str(batch_error):
                        raise
                    for chunk in batch:
                        try:
                            pg_vector.add_documents([chunk])
                            added += 1
                        except ValueError as single_error:
                            if "No embedding data received" not in str(single_error):
                                raise
                            skipped += 1
            print(f"Document {filename}: added {added} chunks, skipped {skipped}.")

    print(f"Vector database collection {collection_name} created in PostgreSQL.")
    return pg_vector


def create_pgvector_collections(
    root_folder_path: str,
    reset_db: bool = True,
    chunk_size: int = 2000,
    chunk_overlap: int = 500,
):
    # Create Postgres connection string from environment variables
    pg_user = "postgres"
    pg_password = "postgres"  # Replace with your actual password or use environment variable
    pg_host = "localhost"
    pg_port = 5432
    pg_db = "postgres"

    connection_string = f"postgresql+psycopg://{pg_user}:{pg_password}@{pg_host}:{pg_port}/{pg_db}"
    
    # Initialize embeddings (shared across collections)
    openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
    if not openrouter_api_key:
        raise ValueError("OPENROUTER_API_KEY environment variable must be set")
    embeddings = OpenAIEmbeddings(
        model="qwen/qwen3-embedding-8b",
        openai_api_base="https://openrouter.ai/api/v1",
        openai_api_key=openrouter_api_key,
    )

    collections = {}
    
    # Get all subdirectories in the root folder
    subdirs = [d for d in os.listdir(root_folder_path) if os.path.isdir(os.path.join(root_folder_path, d))]
    
    if not subdirs:
        # If no subdirectories, create a single collection for the root folder
        collection_name = os.path.basename(root_folder_path)
        collections[collection_name] = create_pgvector_db_for_folder(
            root_folder_path,
            collection_name,
            connection_string,
            embeddings,
            reset_db,
            chunk_size,
            chunk_overlap
        )
    else:
        # Create a collection for each subdirectory
        for subdir in subdirs:
            folder_path = os.path.join(root_folder_path, subdir)
            collection_name = subdir  # Use subdirectory name as collection name
            collections[collection_name] = create_pgvector_db_for_folder(
                folder_path,
                collection_name,
                connection_string,
                embeddings,
                reset_db,
                chunk_size,
                chunk_overlap
            )
    
    return collections


if __name__ == "__main__":
    # Path to the root folder containing the document subfolders
    root_folder_path = "./data"

    # Create the PGVector collections
    collections = create_pgvector_collections(root_folder_path=root_folder_path)

    # # Example: Use one of the collections for a query
    # if collections:
    #     # Get the first collection for demonstration
    #     first_collection_name = next(iter(collections))
    #     collection = collections[first_collection_name]
        
    #     # Create retriever from this collection
    #     retriever = collection.as_retriever(search_kwargs={"k": 3})

    #     # Perform a similarity search
    #     query = "What's my company's mission and values"
    #     similar_docs = retriever.invoke(query)

    #     # Display results
    #     print(f"\nQuery results from collection '{first_collection_name}':")
    #     for i, doc in enumerate(similar_docs, start=1):
    #         print(f"\n🔹 Result {i}:\n{doc.page_content}\nTitle: {doc.metadata.get('title', 'N/A')}")
