# Web RAG Agent

The Web RAG Agent is an intelligent multi-node agent that combines web search with Retrieval-Augmented Generation (RAG). It optimizes queries, checks for existing relevant context, and only performs new searches when necessary.

## Architecture

The agent uses a smart four-step process with conditional routing:

```
User Query → Generate Search Query → Check Relevance → [Web Search & Store] → RAG Response
                                           ↓
                                    Use Existing Context
```

### Node Flow

1. **Generate Search Query** (`generate_search_query_node`)
   - Uses AI to optimize user queries into effective search terms
   - Considers conversation history for context
   - Generates focused 2-6 word search queries

2. **Check Relevance** (`check_relevance_node`) 
   - Intelligently assesses if existing vector database context is sufficient
   - Uses AI-based relevance scoring to decide if new search is needed
   - Evaluates context quality, completeness, and freshness

3. **Web Search & Store** (`web_search_and_store_node`)
   - Searches using Tavily API for high-quality results
   - Stores results in PostgreSQL vector database with pgvector
   - Creates thread-based collections for conversation persistence

4. **RAG Response** (`rag_response_node`)
   - Retrieves relevant context from vector database
   - Generates comprehensive responses with source attribution
   - Maintains conversation history throughout the process

## Key Features

### Intelligent Search Optimization
- **AI-Powered Query Generation**: Converts conversational queries into effective search terms
- **Context Awareness**: Considers conversation history when optimizing queries
- **Conditional Search**: Only searches when existing context is insufficient

### Advanced Persistence
- **Thread-Based Collections**: Creates persistent collections per conversation thread
- **Smart Relevance Checking**: Avoids redundant searches when context exists
- **Conversation Memory**: Maintains context across multiple interactions

### Enterprise-Grade Storage
- **PostgreSQL with pgvector**: Vector similarity search with full SQL capabilities
- **Azure OpenAI Embeddings**: Uses text-embedding-3-large for high-quality embeddings
- **Metadata Preservation**: Maintains source URLs, timestamps, and context information

## Configuration

### Required Environment Variables

```bash
# Tavily API (Required for web search)
TAVILY_API_KEY=your_tavily_api_key

# Azure OpenAI (Required for embeddings and AI decisions)
AZURE_OPENAI_API_KEY=your_azure_openai_key
AZURE_OPENAI_ENDPOINT=your_azure_endpoint

# Database Configuration
POSTGRES_HOST=your_postgres_host
POSTGRES_PORT=5432
POSTGRES_USER=your_username
POSTGRES_PASSWORD=your_password
POSTGRES_DB=your_database

# Model Configuration
DEFAULT_MODEL=your_preferred_model
```

## Usage

### Basic API Usage

```bash
curl -X POST "http://localhost:8080/invoke" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "web-rag-agent",
    "message": "What are the latest developments in AI?",
    "model": "gpt-4"
  }'
```

### Python Usage

```python
from agents.web_rag_agent import web_rag_agent

response = await web_rag_agent.ainvoke({
    "messages": [{"role": "user", "content": "What are the latest developments in AI?"}]
})
```

## Technical Implementation

### Search Strategy
- **Tavily Integration**: Advanced search depth with raw content extraction
- **Error Handling**: Graceful fallbacks with informative error messages
- **Rate Limiting**: Respects API rate limits and quotas

### Vector Database
- **Chunking Strategy**: 1000-character chunks with 200-character overlap
- **Collection Management**: Thread-based naming for conversation persistence
- **Retrieval**: Configurable similarity thresholds and result limits

### AI Decision Making
- **Structured Output**: Uses Pydantic models for reliable AI decisions
- **Relevance Assessment**: Multi-factor evaluation of context quality
- **Query Optimization**: Intelligent transformation of conversational queries

## Performance Characteristics

### Efficiency Features
- **Conditional Searching**: Avoids redundant web searches
- **Context Reuse**: Leverages existing relevant information
- **Smart Routing**: Optimizes flow based on conversation state

### Limitations
- **Tavily Dependency**: Requires valid Tavily API key
- **Context Accumulation**: Thread-based collections grow over time
- **Search Rate Limits**: Subject to Tavily API quotas
- **Memory Usage**: Vector storage increases with search activity

## Error Handling

The agent provides robust error handling:

- **API Failures**: Graceful handling of Tavily API errors
- **Database Issues**: Informative messages for connection problems
- **Missing Configuration**: Clear guidance for setup requirements
- **Context Retrieval**: Fallback strategies for vector search failures

## Extending the Agent

### Custom Search Providers

Add alternative search providers in the `web_search_and_store_node`:

```python
# In tools.py, modify perform_web_search function
if your_search_api_key:
    # Implement your search logic
    pass
elif tavily_api_key:
    # Existing Tavily implementation
    pass
```

### Custom Chunking

Modify text splitter parameters in `store_search_results_in_vector_db`:

```python
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1500,  # Adjust as needed
    chunk_overlap=300,
    length_function=len,
)
```

### Response Customization

Customize the system prompt in `rag_response_node` for different response styles.

## Dependencies

Core dependencies:
- `langchain-postgres` - Vector database integration
- `langchain-openai` - Azure OpenAI embeddings
- `tavily-python` - Web search API
- `pydantic` - Structured AI outputs

## Contributing

When contributing:
1. Test both search and relevance checking functionality
2. Verify vector database operations across conversation threads
3. Test error handling scenarios
4. Update documentation for new features
5. Maintain backward compatibility

## License

Part of the k8s-agents-service project under MIT license.