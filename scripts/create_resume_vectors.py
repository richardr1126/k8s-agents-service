import os
import requests
from dotenv import load_dotenv
from bs4 import BeautifulSoup
from langchain_community.document_loaders import AsyncChromiumLoader, PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_postgres import PGVector
from langchain_openai.embeddings import AzureOpenAIEmbeddings
from langchain.docstore.document import Document

load_dotenv()

def fetch_github_readme(repo_path):
    """Fetch README content from GitHub repository."""
    if not repo_path:
        return None
    
    # Support different README file names
    readme_files = ['README.md', 'readme.md', 'README.txt', 'readme.txt', 'README']
    
    for readme_file in readme_files:
        try:
            # GitHub raw content URL
            url = f"https://raw.githubusercontent.com/{repo_path}/main/{readme_file}"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                return response.text
            
            # Try master branch if main doesn't work
            url = f"https://raw.githubusercontent.com/{repo_path}/master/{readme_file}"
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                return response.text
                
        except requests.exceptions.RequestException as e:
            print(f"Error fetching README from {repo_path}: {e}")
            continue
    
    return None


def fetch_projects_from_json():
    """Fetch projects from richardr.dev/projects.json and return documents."""
    docs = []
    
    try:
        response = requests.get("https://richardr.dev/projects.json")
        response.raise_for_status()
        projects = response.json()
        
        for project in projects:
            # Create project description document (without README content)
            description_parts = [
                f"Title: {project.get('title', '')}",
                f"Description: {project.get('description', '')}",
            ]
            
            # Add tags if available
            if project.get('tags'):
                description_parts.append(f"Technologies: {', '.join(project['tags'])}")
            
            # Add links if available
            if project.get('link'):
                description_parts.append(f"Link: {project['link']}")
            if project.get('repo'):
                description_parts.append(f"Repository: {project['repo']}")
            if project.get('demo'):
                description_parts.append(f"Demo: {project['demo']}")
            
            description_content = "\n".join(description_parts)
            
            # Add project description document
            docs.append(Document(
                page_content=description_content,
                metadata={
                    "section": project.get('title', 'Unknown Project'),
                    "collection": "projects",
                    "title": project.get('title', 'Unknown Project'),
                    "source": "https://richardr.dev/projects.json",
                    "tags": project.get('tags', []),
                    "link": project.get('link', ''),
                    "repo": project.get('repo', ''),
                    "demo": project.get('demo', ''),
                    "content_type": "description",
                }
            ))
            
            # Fetch and process README content separately if repository is available
            if project.get('repo'):
                print(f"Fetching README for {project['title']}...")
                readme_content = fetch_github_readme(project['repo'])
                if readme_content:
                    # Split README content into chunks
                    text_splitter = RecursiveCharacterTextSplitter(
                        chunk_size=1700,
                        chunk_overlap=300
                    )
                    readme_chunks = text_splitter.split_text(readme_content)
                    
                    # Create a document for each README chunk
                    for i, chunk in enumerate(readme_chunks):
                        # Add project context to each README chunk
                        readme_content_with_context = []
                        readme_content_with_context.append(chunk)  # README content first
                        
                        # Add separator and project context at the end
                        readme_content_with_context.append("")  # Empty line for separation
                        readme_content_with_context.append(f"Title: {project.get('title', '')}")
                        if project.get('repo'):
                            readme_content_with_context.append(f"Repository: {project['repo']}")
                        if project.get('link'):
                            readme_content_with_context.append(f"Link: {project['link']}")
                        if project.get('demo'):
                            readme_content_with_context.append(f"Demo: {project['demo']}")
                        
                        readme_doc = Document(
                            page_content="\n".join(readme_content_with_context),
                            metadata={
                                "section": f"{project.get('title', 'Unknown Project')} - README Part {i+1}",
                                "collection": "projects",
                                "title": project.get('title', 'Unknown Project'),
                                "source": "https://richardr.dev/projects.json",
                                "tags": project.get('tags', []),
                                "link": project.get('link', ''),
                                "repo": project.get('repo', ''),
                                "demo": project.get('demo', ''),
                                "content_type": "readme",
                                "chunk_index": i,
                            }
                        )
                        docs.append(readme_doc)
                else:
                    print(f"  No README found for {project['repo']}")
            
    except Exception as e:
        print(f"Error fetching projects: {e}")
        
    return docs


def extract_sections_from_portfolio(html: str):
    """Parse richardr.dev and return documents split by section labels."""
    soup = BeautifulSoup(html, "html.parser")
    docs = []

    section_map = {
        "Work Experience": "resume",
        "Education": "resume",
        "Skills": "resume",
    }

    # Extract content by headers for resume sections
    for header in soup.find_all(["h2", "h3"]):
        title = header.get_text(strip=True)
        if title in section_map:
            content_parts = []
            for sibling in header.find_next_siblings():
                if sibling.name in ["h2", "h3"]:
                    break
                content_parts.append(sibling.get_text(" ", strip=True))
            content = "\n".join([p for p in content_parts if p])

            if content.strip():
                docs.append(Document(
                    page_content=content,
                    metadata={
                        "section": title,
                        "collection": section_map[title],
                        "title": title,
                        "source": "https://richardr.dev/"
                    }
                ))

    # Also extract education content that doesn't have its own header
    for elem in soup.find_all(['div']):
        text = elem.get_text(strip=True)
        if (text and 
            ("Bachelor's of Science in Computer Science" in text or "Master's in Computer Science" in text) and 
            len(text) > 50 and len(text) < 500 and  # Reasonable content length
            "University of Colorado Boulder" in text):
            
            docs.append(Document(
                page_content=text,
                metadata={
                    "section": "Education",
                    "collection": "resume",
                    "title": "Education",
                    "source": "https://richardr.dev/"
                }
            ))
            break  # Only add one education block to avoid duplicates

    return docs


def fetch_public_resume_pdf(doc_id: str, tmp_path: str = "resume.pdf"):
    """Download a public Google Doc as PDF and load it with PyPDFLoader."""
    url = f"https://drive.google.com/uc?export=download&id={doc_id}"
    r = requests.get(url)
    r.raise_for_status()
    with open(tmp_path, "wb") as f:
        f.write(r.content)

    loader = PyPDFLoader(tmp_path)
    return loader.load()


def create_pgvector_collection(
    collection_name: str,
    documents,
    embeddings,
    connection_string: str,
    reset_db: bool = True,
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
    skip_chunking: bool = False,
):
    pg_vector = PGVector(
        embeddings=embeddings,
        collection_name=collection_name,
        connection=connection_string,
        use_jsonb=True,
        create_extension=True,
    )

    if reset_db:
        pg_vector.delete_collection()
        pg_vector.create_collection()
        print(f"Reset collection {collection_name}")

    if skip_chunking:
        # Documents are already chunked, add them directly
        pg_vector.add_documents(documents)
        print(f"Added {len(documents)} chunks to {collection_name}")
    else:
        # Split documents into chunks
        splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
        split_docs = splitter.split_documents(documents)
        pg_vector.add_documents(split_docs)
        print(f"Added {len(split_docs)} chunks to {collection_name}")
    
    return pg_vector


if __name__ == "__main__":
    connection_string = "postgresql+psycopg://postgres:postgres@localhost:5432/postgres"

    embeddings = AzureOpenAIEmbeddings(
        api_key=os.getenv("AZURE_OPENAI_API_KEY"),
        azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
        azure_deployment="text-embedding-3-large",
        api_version="2025-02-01-preview",
    )

    # --- 1. Google Drive Resume (public) ---
    resume_docs = fetch_public_resume_pdf(os.getenv("GDRIVE_DOC_ID"))
    create_pgvector_collection("richard-resume", resume_docs, embeddings, connection_string)

    # --- 2. Portfolio Site ---
    # Fetch projects from JSON endpoint
    projects = fetch_projects_from_json()

    # Fetch resume sections from HTML
    chromium_loader = AsyncChromiumLoader(["https://richardr.dev/"])
    html_docs = chromium_loader.load()

    portfolio_sections = extract_sections_from_portfolio(html_docs[0].page_content)
    resume_bits = [d for d in portfolio_sections if d.metadata["collection"] == "resume"]

    if projects:
        create_pgvector_collection("richard-projects", projects, embeddings, connection_string, skip_chunking=True)
    if resume_bits:
        create_pgvector_collection("richard-resume", resume_bits, embeddings, connection_string, reset_db=False)
