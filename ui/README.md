# Next.js Chat UI for K8s Agents Service

A modern, production-ready chat interface built with **Next.js 15**, **React 19**, **assistant-ui**, and **Tailwind CSS 4**. This UI provides an enhanced user experience with intelligent tool visualization, real-time streaming, and comprehensive agent interaction capabilities.

## ✨ Features

- **🎨 Modern UI**: Clean, responsive design with dark/light mode support
- **🔄 Real-time Streaming**: Token-by-token streaming with visual feedback
- **🤖 Multi-Agent Support**: Seamless switching between different AI agents
- **🛠️ Tool Visualization**: Rich tool call displays with contextual icons
- **📱 Mobile Responsive**: Optimized for desktop, tablet, and mobile devices
- **🔐 Authentication**: Secure user authentication with session management
- **💬 Thread Management**: Create, delete, and manage conversation threads with complete data cleanup
- **⚡ Optimistic Updates**: Instant UI feedback with background sync
- **🎯 Agent Routing**: Intelligent supervisor agent with automatic routing

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (recommended: use Node 20+)
- Package manager: `pnpm` (recommended), `npm`, `yarn`, or `bun`
- Running backend service (see main project README)

### Installation

```bash
# Clone the repository (if not already done)
git clone https://github.com/richardr1126/k8s-agents-service.git
cd k8s-agents-service/ui

# Install dependencies
pnpm install  # or npm install / yarn install / bun install

# Copy environment template
cp .env.example .env.local

# Start development server
pnpm dev  # or npm run dev / yarn dev / bun dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## ⚙️ Configuration

Create a `.env.local` file with the following variables:

```bash
# Backend Service Configuration
BACKEND_URL=http://localhost:8080          # FastAPI agent service URL
BACKEND_AUTH_TOKEN=                        # Optional: Backend authentication token

# Authentication (Better Auth)
BETTER_AUTH_SECRET=your-secret-key         # Required: Session encryption key
BETTER_AUTH_URL=http://localhost:3000      # Your app URL

# Database (for user sessions and threads)
DATABASE_URL=postgres://user:pass@host:5432/dbname

# Optional: For client-side fallbacks (not recommended for production)
OPENAI_API_KEY=sk-...
```

### Environment Variables Explained

| Variable | Description | Required |
|----------|-------------|----------|
| `BACKEND_URL` | Base URL of the FastAPI agent service | ✅ |
| `BACKEND_AUTH_TOKEN` | Authentication token for backend API | Optional |
| `BETTER_AUTH_SECRET` | Secret key for session encryption | ✅ |
| `BETTER_AUTH_URL` | Public URL of your application | ✅ |
| `DATABASE_URL` | PostgreSQL connection string for user data | ✅ |
| `OPENAI_API_KEY` | OpenAI API key (client-side fallback only) | Optional |

## 🏗️ Architecture

### Key Components

- **`app/assistant.tsx`** - Main chat interface and layout
- **`components/auth-user-provider.tsx`** - User authentication and thread management
- **`components/service-info-provider.tsx`** - Shared agent/model info context
- **`components/custom-runtime-provider.tsx`** - Chat runtime integration
- **`components/assistant-ui/thread.tsx`** - Chat thread display and interactions
- **`app/api/`** - Next.js API routes for backend communication

### Data Flow

```
User Interface
     ↓
Service Info Provider (agents, models)
     ↓
Auth Provider (user, threads)
     ↓
Custom Runtime Provider (chat state)
     ↓
API Routes (/api/*)
     ↓
FastAPI Backend Service
```

### State Management

- **Service Info**: Shared context prevents duplicate API calls for agent/model data
- **User & Threads**: Optimistic updates with background database synchronization and complete thread deletion
- **Chat Messages**: Real-time streaming with message history persistence
- **Authentication**: Session-based auth with automatic token refresh

## 🔧 Development

### Available Scripts

```bash
# Development
pnpm dev          # Start development server with hot reload
pnpm build        # Build for production
pnpm start        # Start production server
pnpm lint         # Run ESLint
pnpm type-check   # Run TypeScript type checking

# Database
pnpm db:generate  # Generate Prisma client
pnpm db:push      # Push schema changes to database
pnpm db:studio    # Open Prisma Studio
```

### Project Structure

```
ui/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   ├── assistant.tsx      # Main chat interface
│   └── page.tsx          # Home page
├── components/            # React components
│   ├── assistant-ui/     # Chat UI components
│   ├── ui/               # Reusable UI components
│   └── providers/        # Context providers
├── lib/                  # Utilities and configuration
│   ├── api-client.ts     # Backend API client
│   ├── auth.ts           # Authentication setup
│   └── types.ts          # TypeScript types
└── public/               # Static assets
```

## 🎨 Customization

### Theming

The UI uses Tailwind CSS with CSS variables for theming. Customize colors in:

- `app/globals.css` - CSS custom properties
- `tailwind.config.ts` - Tailwind configuration
- `components/ui/` - Base UI components

### Adding New Agents

1. Ensure your agent is registered in the backend service
2. The UI will automatically detect new agents via the `/api/service-info` endpoint
3. Customize agent descriptions and routing in the backend

### Custom Tools

Tool calls are automatically rendered with contextual icons. To add custom tool visualizations:

1. Add tool icons to `components/ui/tool-fallback.tsx`
2. Implement custom rendering in `components/assistant-ui/thread.tsx`

### Thread Management

The UI implements complete thread deletion functionality:

- **Frontend**: Removes thread metadata from Neon database
- **Backend**: Deletes conversation memory and long-term storage data
- **UI**: Provides confirmation dialogs and optimistic updates with rollback on failure

## 🚀 Deployment

### Docker

```bash
# Build the container
docker build -t k8s-agents-ui .

# Run with environment variables
docker run -p 3000:3000 \
  -e BACKEND_URL=http://backend:8080 \
  -e DATABASE_URL=postgres://... \
  k8s-agents-ui
```

### Kubernetes

Helm charts for Kubernetes deployment are coming soon. For now, use standard Next.js deployment practices.

### Vercel/Netlify

The application can be deployed to any platform that supports Next.js:

1. Connect your repository
2. Set environment variables
3. Deploy with default Next.js build settings

## 🤝 Contributing

Contributions are welcome! Please see the main project's contributing guidelines.

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `pnpm lint && pnpm type-check`
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License - see the main project LICENSE file for details.
