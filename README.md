# 🧰 Kubernetes AI Agents Service

[![GitHub License](https://img.shields.io/github/license/richardr1126/k8s-agents-service)](https://github.com/richardr1126/k8s-agents-service/blob/main/LICENSE)

A Kubernetes deployment of an AI agents service built with LangGraph and FastAPI, featuring a Helm chart with multi-architecture images and GitOps integration. Currently configured as a professional resume and portfolio showcase system with intelligent RAG-based assistance and live web research.

### Next.js Chat UI (`ui/`)

The chat interface is built with **Next.js 16**, **React 19**, **assistant-ui** and **Tailwind CSS 4**, and talks to the service over the [AG-UI protocol](https://docs.ag-ui.com). It is the only frontend. Sub-agent runs stream live as collapsible cards nested under the tool call that started them, and agent interrupts are answered from a banner above the composer. Visitors can sign up or continue as a guest, and per-user run limits (stricter for guests) are stored in Postgres. See [ui/README.md](ui/README.md).

This project extends [JoshuaC215's agent-service-toolkit](https://github.com/JoshuaC215/agent-service-toolkit) with Kubernetes deployment capabilities, including a Helm chart, GitOps deployment, Postgres with pgvector, and multi-architecture container builds.

> **⚠️ Important Notice**: This project is currently in development and is **not fully featured for production** use. While it provides a solid foundation for Kubernetes deployment of AI agents, additional hardening, monitoring, and operational considerations may be needed for production environments.

## 🙏 Acknowledgments

This project is built upon the excellent foundation provided by [JoshuaC215's AI Agent Service Toolkit](https://github.com/JoshuaC215/agent-service-toolkit). Special thanks to @JoshuaC215 for creating the original comprehensive toolkit that demonstrates best practices for LangGraph-based agent development.

## ✨ What's New in k8s-agents-service

This fork adds Kubernetes deployment capabilities on top of the original toolkit:

- **🎯 Kubernetes-Native**: Helm chart for the agent service
- **🔄 GitOps Ready**: ArgoCD application manifests for automated deployments  
- **🗄️ Postgres + pgvector**: One Postgres database for conversation memory, long-term memory and RAG vectors
- **🏗️ Multi-Architecture**: Docker builds for both AMD64 and ARM64 architectures for the service and cron containers
- **📦 Container Registry**: Automated builds and publishing to GitHub Container Registry with separate image streams
- **🔧 Deployment Scripts**: Comprehensive deployment automation with database setup, secrets management, and dependency updates
- **🔍 Enhanced Search**: Tavily search integration for improved web research capabilities

## Overview

### Core Features (from original toolkit)

1. **LangGraph Agent and latest features**: A customizable agent built using the LangGraph framework. Implements the latest LangGraph v0.6+ features including human in the loop with `interrupt()`, flow control with `Command`, long-term memory with `Store`, and `langgraph-supervisor` with intelligent auto-routing capabilities.
1. **FastAPI Service**: Serves the agents with a non-streaming `/invoke` endpoint and an [AG-UI](https://docs.ag-ui.com) event stream, see [API](#api).
1. **Sub-agent streaming**: Sub-agents run by the auto-router stream their own text and tool calls, tagged with a `subagentRunId`, and are stored with the thread so `/history` can rebuild them.
1. **Next.js Chat UI**: Modern production-focused React/Next.js application - [see UI README](ui/README.md)
1. **Multiple Agent Support**: Run multiple agents in the service and call by URL path. Available agents and models are described in `/info`
1. **Asynchronous Design**: Utilizes async/await for efficient handling of concurrent requests.
1. **Content Moderation**: Implements LlamaGuard for content moderation (requires Groq API key).
1. **RAG Agent**: RAG implementation using PGVector on Postgres - see [docs](docs/RAG_Assistant.md).
1. **Thread Management**: Deleting a thread removes its conversation memory (checkpointer), long-term memory (store) and its web search vectors.
1. **Feedback Mechanism**: Includes a star-based feedback system integrated with LangSmith.
1. **Docker Support**: Includes Dockerfiles and a docker compose file for easy development and deployment.
1. **Testing**: Includes robust unit and integration tests for the full repo.

### New Kubernetes Features

1. **Helm Chart**: `agents-service` chart for the backend, with an optional CronJob
1. **ArgoCD Integration**: GitOps-ready application manifests for automated deployments
1. **Postgres on Kubernetes**: Runs against a CloudNativePG cluster with the pgvector extension
1. **Multi-Architecture Builds**: AMD64 and ARM64 Docker images for the service and cron job published to GitHub Container Registry
1. **Automated Deployment Scripts**: Deployment automation with database setup and dependency management
1. **Kubernetes Secrets Management**: Secure handling of API keys and database credentials with enhanced environment configuration
1. **Automated Cron Jobs**: Kubernetes CronJob support for scheduled tasks like vector database updates and maintenance

### Resume & Portfolio Features

1. **Auto-Router Agent**: Default intelligent supervisor that automatically routes queries between the resume and web research sub-agents based on context
1. **Resume Agent**: AI assistant that showcases professional background, skills, and project experience using RAG
1. **Web RAG Agent**: Research assistant capable of browsing and summarizing web content using Tavily search integration
1. **Nested Sub-Agent Streaming**: Sub-agent runs stream over AG-UI and render nested under the `task` tool call that started them, live and after a reload
1. **Professional UI**: Next.js interface with guest sessions, database-backed run limits, responsive design, tool visualization and a 560-character input limit
1. **Portfolio Integration**: Automated vector database creation from GitHub projects and resume data
1. **Smart Search**: Intelligent filtering and source attribution in resume and project searches

### Automated Tasks & Cron Jobs

1. **Scheduled Vector Updates**: Automated cron job that refreshes vector databases with latest resume and project data
1. **Google Drive Integration**: Automatically syncs resume data from public Google Drive documents
1. **GitHub Repository Scanning**: Fetches and processes README files from project repositories for up-to-date documentation
1. **Configurable Scheduling**: Flexible cron schedule configuration (default: daily at 7 AM UTC)
1. **Dedicated Cron Container**: Purpose-built Docker image with Chromium and Playwright for web scraping tasks
1. **Kubernetes CronJob Management**: Full Kubernetes CronJob lifecycle with history limits, concurrency policies, and failure handling

### ArgoCD Diagram

<img src="media/argocd.png" width="full">

## 🚀 Quickstart

### Local Development (Docker)

```sh
# At least one LLM API key is required
echo 'OPENROUTER_API_KEY=your_openrouter_api_key' >> .env

# Run with docker compose watch for live reloading
docker compose watch
```

### Local Development (Python)

```sh
# uv is the recommended way to install dependencies
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install dependencies and run
uv sync --frozen
source .venv/bin/activate
python src/run_service.py

# In another shell, the Next.js UI (see ui/README.md)
cd ui && pnpm install && pnpm dev
```

### Kubernetes Deployment

Argo CD runs the chart on the homelab k3s cluster with a CloudNativePG Postgres; see
[Kubernetes Deployment](#kubernetes-deployment-1) for the secrets it needs.

### Key Files

The repository is structured as follows:

**Core Application:**
- `src/agents/`: Defines several agents with different capabilities
- `src/schema/`: Defines the protocol schema  
- `src/core/`: Core modules including LLM definition and settings
- `src/service/service.py`: FastAPI service to serve the agents
- `src/service/agui.py`: AG-UI streaming endpoint (ag-ui-langgraph)
- `src/service/history.py`: rebuilds a thread's AG-UI history, sub-agent runs included
- `ui/`: Next.js chat UI
- `tests/`: Unit and integration tests

**Kubernetes Deployment:**
- `helm/agents-service/`: Complete Helm chart for the backend service
- `helm/create_secrets.sh`: creates the `app-secrets` Secret the chart reads
- `docker/`: Multi-architecture Dockerfiles for the service and cron job builds
- `scripts/create_resume_vectors_cron.py`: Automated vector database update script for scheduled execution

## Setup and Usage

1. Clone the repository:

   ```sh
   git clone https://github.com/richardr1126/k8s-agents-service.git
   cd k8s-agents-service
   ```

2. Set up environment variables:
   Create a `.env` file in the root directory. At least one LLM API key or configuration is required. See the [`.env.example` file](./.env.example) for a full list of available environment variables, including a variety of model provider API keys, header-based authentication, LangSmith tracing, testing and development modes, and OpenWeatherMap API key.

3. You can now run the agent service locally, either with Docker or just using Python. The Docker setup is recommended for simpler environment setup and immediate reloading of the services when you make changes to your code.

### Additional setup for specific AI providers

- [Setting up Ollama](docs/Ollama.md)
- [Setting up RAG with PGVector](docs/RAG_Assistant.md)
- [Thread Deletion API](docs/Thread_Deletion.md)

### Building or customizing your own agent

To customize the agent for your own use case:

1. Add your new agent to the `src/agents` directory. You can copy `rag_assistant.py` (resume agent) or `web_rag_agent.py` and modify it to change the agent's behavior and tools.
1. Import and add your new agent to the `agents` dictionary in `src/agents/agents.py`. Your agent can be called by `/<your_agent_name>/invoke` or `/<your_agent_name>/ag-ui`.
1. Adjust the Next.js UI in `ui/` to match your agent's capabilities.
1. Update the `DEFAULT_AGENT` constant in `src/agents/agents.py` to set your preferred default agent (currently set to "auto-router" for intelligent routing).
1. For supervisor-style routing, configure the routing logic in `src/agents/main_agent.py` to define how queries should be distributed between your specialized agents.

### Current Available Agents

- **auto-router** (default): Intelligent supervisor agent that automatically routes queries between the resume agent and web research agent based on context
- **resume-agent**: Professional resume assistant that searches through resume information and project repositories
- **web-rag-agent**: Web research assistant that can browse the internet and summarize articles
- **chatbot**: Simple conversational agent for general purpose chat


### Database Configuration

The service keeps everything in one Postgres database with the **pgvector** extension: LangGraph checkpoints (conversation memory), the long-term memory store, and the RAG vector collections. Locally that's the `pgvector/pgvector` container from `compose.yaml`; on the cluster it's a CloudNativePG cluster.

**RAG Implementation:**
- **PGVector Integration**: Uses `langchain-postgres` with PGVector for vector storage and retrieval
- **Collections**: `richard-resume` and `richard-projects` for the resume agent, plus one `web_search_<thread_id>` collection per conversation for web research, dropped when the thread is deleted
- **OpenRouter Embeddings**: Uses `qwen/qwen3-embedding-8b` for vector generation
- **Automatic Setup**: Database schema and vector extensions are automatically configured

Set `DATABASE_TYPE=postgres` for Postgres, or `sqlite` for quick local runs and tests (no RAG vectors).

### Resume & Portfolio Data Setup

The current implementation includes automated scripts for creating vector databases from resume and project data:

- `scripts/create_resume_vectors.py`: Loads the resume PDF from Google Drive (`GDRIVE_DOC_ID`), the project list and resume sections from richardr.dev, and each project's GitHub README, then embeds them into the `richard-resume` and `richard-projects` collections of a local Postgres (`localhost:5432`). Needs Playwright's Chromium: `uv run playwright install chromium`.
- `scripts/create_resume_vectors_cron.py`: the same, run by the Kubernetes CronJob.

To adapt this for your own portfolio, point the scripts at your own resume and project sources, run them, and update the agent descriptions in `src/agents/agents.py`.

### Handling Private Credential files

If your agents or chosen LLM require file-based credential files or certificates, the `privatecredentials/` has been provided for your development convenience. All contents, excluding the `.gitkeep` files, are ignored by git and docker's build process. See [Working with File-based Credentials](docs/File_Based_Credentials.md) for suggested use.


### Kubernetes Deployment

This repository includes comprehensive Kubernetes deployment capabilities using Helm charts and GitOps with ArgoCD.

#### Prerequisites

- Kubernetes cluster with the CloudNativePG operator
- Helm 3.x
- Docker registry access (GitHub Container Registry)

#### How it's deployed

The chart in `helm/agents-service/` holds the service, its CronJob, the ingress for agents.richardr.dev, and a
CloudNativePG `Cluster` (`templates/database.yaml`) that bootstraps the `agentsservice` database with pgvector.
The pods read the database password from the `agents-service-db-app` Secret that CloudNativePG generates, and
everything else from `app-secrets`.

Argo CD deploys it from `main`: the Application is `argocd/apps/agents-service.yaml` in the
[k3s-cluster](https://github.com/richardr1126/k3s-cluster) repo. Pushing to `main` builds the
`k8s-agents-service` and `k8s-agents-cron` images (arm64, tagged `latest`), so the pods pin to arm64 nodes. The
Argo CD Image Updater (k3s-cluster `argocd/image-updaters/`) sees each new digest within a couple of minutes and the
Application syncs it automatically, so a push to `main` deploys itself.

#### Secrets

`helm/create_secrets.sh` applies `app-secrets` in the `default` namespace from `helm/.env`:

```bash
AUTH_SECRET=...          # bearer token; must match the UI's BACKEND_AUTH_TOKEN
OPENROUTER_API_KEY=...
TAVILY_API_KEY=...
GDRIVE_DOC_ID=...
LANGSMITH_API_KEY=...    # optional; turns on LangSmith tracing
```

Run it once before the first sync, and again whenever a key changes:

```sh
./helm/create_secrets.sh
kubectl rollout restart deployment/agents-service
```

#### Without Argo CD

```sh
./helm/create_secrets.sh
helm install agents-service ./helm/agents-service   # the release must be named agents-service
```

#### Automated Tasks with CronJobs

The deployment includes a Kubernetes CronJob for automated maintenance tasks:

**Cron Job Features:**
- **Automated Vector Database Updates**: Scheduled refresh of resume and project data
- **Google Drive Integration**: Syncs data from public Google Drive documents using `GDRIVE_DOC_ID`
- **Web Scraping**: Uses Chromium and Playwright to extract data from portfolio websites
- **GitHub Repository Processing**: Automatically fetches and processes README files from project repositories

**Configuration:**
```yaml
# helm/agents-service/values.yaml
cronjob:
  enabled: true
  schedule: "0 7 * * *"  # Daily at 7 AM UTC
  concurrencyPolicy: Forbid
  image:
    repository: ghcr.io/richardr1126/k8s-agents-cron
    tag: "latest"
```

**Required Environment Variables:**
- `GDRIVE_DOC_ID`: Google Drive document ID for resume data
- The database settings, which the chart sets
- `OPENROUTER_API_KEY`: For model inference and embeddings

#### Database Support

- **Postgres with pgvector**: required for RAG (CloudNativePG on the cluster)
- **SQLite**: for development and tests only

### Docker Setup

This project includes a Docker setup for easy development and deployment. The `compose.yaml` file defines the `postgres` and `agent_service` services. The Dockerfiles are in `docker/`.

For local development, we recommend using [docker compose watch](https://docs.docker.com/compose/file-watch/). This feature allows for a smoother development experience by automatically updating your containers when changes are detected in your source code.

1. Make sure you have Docker and Docker Compose (>=[2.23.0](https://docs.docker.com/compose/release-notes/#2230)) installed on your system.

2. Create a `.env` file from the `.env.example`. At minimum, you need to provide an LLM API key (e.g., OPENROUTER_API_KEY).
   ```sh
   cp .env.example .env
   # Edit .env to add your API keys
   ```

3. Build and launch the services in watch mode:

   ```sh
   docker compose watch
   ```

   This will automatically:
   - Start a PostgreSQL database service that the agent service connects to
   - Start the agent service with FastAPI

4. The services will now automatically update when you make changes to your code:
   - Changes in the relevant python files and directories will trigger updates for the relevant services.
   - NOTE: If you make changes to the `pyproject.toml` or `uv.lock` files (such as adding dependencies), you will need to rebuild the services by running `docker compose up --build`.

5. Run the Next.js UI:
   ```sh
   cd ui
   pnpm install  # or npm/yarn
   cp .env.example .env.local
   # Adjust environment variables as needed - see ui/README.md
   pnpm db:migrate  # apply the schema to POSTGRES_URL
   pnpm dev
   ```
   The Next.js app will be available at `http://localhost:3000`.

6. The agent service API will be available at `http://0.0.0.0:8080`. You can also use the OpenAPI docs at `http://0.0.0.0:8080/redoc`.

7. Use `docker compose down` to stop the services.

This setup allows you to develop and test your changes in real-time without manually restarting the services.

### API

- `POST /{agent_id}/ag-ui`: runs an agent and streams [AG-UI](https://docs.ag-ui.com) events (`text/event-stream`). The body is an AG-UI `RunAgentInput`; `forwardedProps.model` picks the model and `forwardedProps.user_id` is passed to the agent. To answer an interrupt, send its id back in `resume`. Events from a sub-agent carry a `subagentRunId` and sit between its `SUBAGENT_STARTED` and `SUBAGENT_FINISHED`/`SUBAGENT_ERROR`, which come before the parent `task` call's `TOOL_CALL_RESULT`. An interrupt, including one raised inside a sub-agent, ends the run with `RUN_FINISHED.outcome` of type `interrupt`.
- `POST /history`: `{"thread_id"}` returns `{"messages", "subagents"}`: the thread's AG-UI messages, with each sub-agent's messages (tagged with `subagentRunId`) just before its `task` result, and one `{subagentRunId, parentToolCallId, name, description, status, error?}` entry per sub-agent run.
- `POST /{agent_id}/invoke`: runs an agent and returns its final message.
- `DELETE /thread`: deletes a thread's checkpoints, sub-agent runs included, its long-term memory, and its web search vector collection.
- `GET /info`, `POST /feedback`, `GET /health`.

When `AUTH_SECRET` is set, every endpoint except `/health` needs `Authorization: Bearer <AUTH_SECRET>`.

### Development with LangGraph Studio

The agent supports [LangGraph Studio](https://langchain-ai.github.io/langgraph/concepts/langgraph_studio/), the IDE for developing agents in LangGraph.

`langgraph-cli[inmem]` is installed with `uv sync`. You can simply add your `.env` file to the root directory as described above, and then launch LangGraph Studio with `langgraph dev`. Customize `langgraph.json` as needed. See the [local quickstart](https://langchain-ai.github.io/langgraph/cloud/how-tos/studio/quick_start/#local-development-server) to learn more.

### Local development without Docker

You can also run the agent service locally without Docker, just using a Python virtual environment.

1. Create a virtual environment and install dependencies:

   ```sh
   uv sync --frozen
   source .venv/bin/activate
   ```

2. Run the FastAPI server:

   ```sh
   python src/run_service.py
   ```

3. In a separate terminal, run the Next.js UI as described in [ui/README.md](ui/README.md).

## Projects built with or inspired by the original agent-service-toolkit

The following are projects that drew code or inspiration from [JoshuaC215's original agent-service-toolkit](https://github.com/JoshuaC215/agent-service-toolkit):

- **[k8s-agents-service](https://github.com/richardr1126/k8s-agents-service)** (This repo) - Kubernetes deployment with Helm, GitOps and Postgres/pgvector, and an AG-UI chat UI
- **[PolyRAG](https://github.com/QuentinFuxa/PolyRAG)** - Extends agent-service-toolkit with RAG capabilities over both PostgreSQL databases and PDF documents
- **[alexrisch/agent-web-kit](https://github.com/alexrisch/agent-web-kit)** - A Next.JS frontend for agent-service-toolkit
- **[raushan-in/dapa](https://github.com/raushan-in/dapa)** - Digital Arrest Protection App (DAPA) enables users to report financial scams and frauds efficiently via a user-friendly platform

If you've built something using this template, please create a pull request or open a discussion to be added to the list!

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. Currently the tests need to be run using the local development without Docker setup. To run the tests for the agent service:

1. Ensure you're in the project root directory and have activated your virtual environment.

2. Install the development dependencies and pre-commit hooks:

   ```sh
   uv sync --frozen
   pre-commit install
   ```

3. Run the tests using pytest:

   ```sh
   pytest
   ```

## License

This project is licensed under the MIT License - see the LICENSE file for details.
