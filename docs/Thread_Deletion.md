# Thread Deletion API

This document describes the thread deletion functionality implemented in the k8s-agents-service.

## Overview

The thread deletion system provides complete removal of conversation threads from both the frontend UI state and backend memory stores. This replaces the previous archiving functionality with true deletion.

## Architecture

The deletion process involves two main components:

1. **Frontend (Neon Database)**: Thread metadata and UI state
2. **Backend (YugabyteDB)**: Conversation memory and long-term storage

## API Endpoints

### Backend: DELETE /thread

Deletes a thread from the backend conversation memory and long-term storage.

**Request:**
```json
{
  "thread_id": "string"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Thread deleted successfully"
}
```

**Error Responses:**
- `400`: Invalid request format
- `422`: Validation error (missing thread_id)
- `500`: Internal server error

**Implementation Details:**
- Uses LangGraph's built-in `adelete_thread()` method for proper cleanup
- Deletes from both checkpointer (conversation memory) and store (long-term memory)
- Supports all checkpointer types: PostgreSQL, SQLite, MongoDB
- Graceful error handling with detailed logging

### Frontend: POST /api/thread/delete

Frontend API route that calls the backend delete endpoint and handles UI state cleanup.

**Request:**
```json
{
  "threadId": "string"
}
```

**Response:**
```json
{
  "success": true
}
```

**Error Responses:**
- `400`: Missing threadId
- `401`: Unauthorized (user not authenticated)
- `500`: Backend deletion failed

## Database Schema Changes

### Neon Database (Frontend)
- Removed `archived` column from `user_threads` table
- Simplified thread CRUD operations
- Direct deletion instead of soft deletion

### YugabyteDB (Backend)
- Uses LangGraph's built-in deletion methods
- Automatically cleans up all related data:
  - Checkpoints table entries
  - Writes table entries
  - Store namespace data

## User Interface Changes

### Thread List Component
- Replaced archive icon with delete (trash) icon
- Added confirmation dialog for deletion
- Changed styling to use destructive colors
- Immediate optimistic UI updates

### Thread Management
- Automatic switching to most recent remaining thread
- Creates new thread if no threads remain
- Rollback on deletion failure

### Docker Compose
No changes needed - deletion works with existing database setup.

### Kubernetes
No changes needed - deletion works with existing Helm charts.

## Error Handling

### Frontend
- Optimistic updates with rollback on failure
- User confirmation dialog prevents accidental deletion
- Graceful handling of backend failures

### Backend
- Comprehensive logging of all deletion operations
- Fails fast on checkpointer errors (primary data)
- Continues on store errors (secondary data)
- Proper HTTP status codes

## Security Considerations

- User authentication required for frontend API
- Backend authentication via `BACKEND_AUTH_TOKEN` (optional)
- Thread ownership validation in frontend
- No data recovery once deleted

## Performance

- Deletion is immediate and permanent
- No impact on existing thread performance
- Minimal database operations
- Efficient cleanup of related data

## Future Enhancements

Potential improvements for future versions:

1. **Bulk Deletion**: Delete multiple threads at once
2. **Soft Delete Option**: Add back soft deletion as an option
3. **Audit Trail**: Track deletion events for compliance
4. **Recovery**: Implement thread recovery within a time window
5. **Batch Processing**: Background cleanup of orphaned data