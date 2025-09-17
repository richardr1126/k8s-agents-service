This is the chat.richardr.dev AI chat interface built with [assistant-ui](https://github.com/Yonom/assistant-ui).

## Architecture Overview

The frontend uses a simplified single-client architecture:
- **API Client** (`lib/api-client.ts`): Single client that calls Next.js API routes
- **API Routes** (`app/api/*/route.ts`): Handle all backend communication and authentication
- **Service Info Provider**: Shared context to prevent duplicate service-info API calls
- **Auth & User Management**: Better-auth integration with optimistic thread updates

### Key Components
- `components/auth-user-provider.tsx` - User authentication and thread management with optimistic updates
- `components/service-info-provider.tsx` - Shared service info context (agents, models, defaults)
- `components/custom-runtime-provider.tsx` - Chat runtime with assistant-ui integration
- `app/api/` - Next.js API routes that proxy to Python backend service

### Backend Communication
All backend communication flows through Next.js API routes which handle:
- Authentication and session management
- Direct communication with Python backend service
- Request/response transformation between frontend and backend formats

## Getting Started

First, add your environment variables to `.env.local` file:

```
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
BACKEND_URL=http://localhost:8000
BACKEND_AUTH_TOKEN=your-backend-token
```

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.
