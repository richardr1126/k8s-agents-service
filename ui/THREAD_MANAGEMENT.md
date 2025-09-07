# User and Thread Management Implementation

This implementation provides a comprehensive user and thread management system with localStorage persistence for the K8s Agents Service UI.

## Key Components

### 1. User Storage Hook (`/hooks/use-user-storage.ts`)
- **Persistent User ID**: Generates and stores unique user IDs in localStorage
- **Thread Management**: Create, update, delete, and archive threads
- **Local Persistence**: All data is stored in localStorage with fallback handling
- **Thread Activity Tracking**: Updates timestamps and last messages for threads

### 2. User Provider (`/components/user-provider.tsx`)
- **Context API**: Provides user data throughout the application
- **Computed Values**: Active threads, archived threads, current thread
- **Centralized State**: Single source of truth for user and thread state

### 3. URL State Management (`/hooks/use-url-state.ts`)
- **URL Synchronization**: Thread ID is reflected in the URL
- **Navigation Support**: Browser back/forward buttons work correctly
- **Deep Linking**: Direct links to specific threads

### 4. Enhanced Runtime Provider (`/components/custom-runtime-provider.tsx`)
- **Thread List Integration**: Works with assistant-ui's thread list components for chat.richardr.dev
- **Auto Title Generation**: Automatically generates thread titles from first message
- **Error Handling**: Graceful handling of missing chat history
- **Streaming Support**: Full support for streaming responses and tool calls

### 5. Improved Error Handling
- **History API**: Returns empty messages for non-existent threads instead of 500 errors
- **Frontend Client**: Graceful fallback to empty messages on API errors
- **Load Tracking**: Prevents duplicate history loading attempts

## Features

### User Management
- **Unique User ID**: Each user gets a persistent, unique identifier
- **Data Persistence**: All user data is stored in localStorage
- **Data Recovery**: Handles localStorage errors gracefully

### Thread Management
- **Create Threads**: New threads are created with unique IDs
- **Switch Threads**: Navigate between threads with URL synchronization
- **Auto Titles**: Thread titles are generated from the first user message
- **Archive/Delete**: Threads can be archived or permanently deleted
- **Activity Tracking**: Last message and timestamp are tracked per thread

### Chat History
- **Persistent Storage**: Chat history is loaded from the backend when available
- **Error Handling**: Graceful handling of missing or empty chat history
- **Deduplication**: Prevents duplicate API calls for the same thread

### URL Management
- **Thread URLs**: Current thread is reflected in the URL (`?thread=thread-id`)
- **Navigation**: Browser navigation works correctly with threads
- **Deep Linking**: Users can bookmark and share specific threads

## Usage

### Basic Setup
The system is initialized automatically when the app starts:

```tsx
// app/assistant.tsx
<Suspense fallback={<div>Loading...</div>}>
  <CustomRuntimeProvider>
    {/* Your app content */}
  </CustomRuntimeProvider>
</Suspense>
```

### Accessing User Data
```tsx
import { useUser } from '@/components/user-provider';

function MyComponent() {
  const { 
    userData, 
    activeThreads, 
    currentThread,
    createNewThread,
    switchToThread 
  } = useUser();
  
  // Use the data and functions
}
```

### Thread Operations
```tsx
// Create a new thread
const newThreadId = createNewThread("My Custom Thread");

// Switch to a thread
switchToThread(threadId);

// Update thread title
updateThreadTitle(threadId, "New Title");

// Archive a thread
archiveThread(threadId);
```

## Data Structure

### User Data
```typescript
interface UserData {
  userId: string;           // Unique user identifier
  threads: ThreadInfo[];    // Array of all threads
  currentThreadId: string | null; // Currently active thread
  createdAt: number;        // User creation timestamp
}
```

### Thread Info
```typescript
interface ThreadInfo {
  id: string;              // Unique thread identifier
  title: string;           // Thread title
  lastMessage?: string;    // Preview of last message
  timestamp: number;       // Last activity timestamp
  archived?: boolean;      // Whether thread is archived
}
```

## Error Handling

### Chat History Errors
- If a thread doesn't exist in the backend, returns empty messages
- Failed history loads are cached to prevent retries
- Graceful fallback to empty thread state

### LocalStorage Errors
- Handles quota exceeded errors
- Graceful degradation if localStorage is unavailable
- State updates continue even if persistence fails

### API Errors
- Network failures are handled gracefully
- User can continue using the app offline
- Automatic retry mechanisms where appropriate

## Debug Mode

In development mode, a debug panel shows:
- Current user ID
- Active thread information
- Thread count and status
- URL state synchronization

## Migration and Compatibility

The system is designed to be backward-compatible:
- Existing "default" thread IDs are handled
- Old data structures are migrated automatically
- Fallback to hardcoded defaults if needed

## Performance Considerations

- **Lazy Loading**: Chat history is only loaded when threads are accessed
- **Deduplication**: Prevents duplicate API calls
- **Local Caching**: Frequently accessed data is cached in memory
- **Efficient Updates**: Only necessary components re-render on state changes

## Security

- User IDs are generated client-side and don't contain sensitive information
- All data is stored locally (localStorage)
- No sensitive data is transmitted in URLs
- Thread IDs use timestamp + random components for uniqueness