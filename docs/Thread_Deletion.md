# Thread Deletion API

This document describes the thread deletion functionality implemented in the k8s-agents-service.

## Overview

The thread deletion system provides complete removal of conversation threads from both the frontend UI state and backend memory stores. This replaces the previous archiving functionality with true deletion.

## Architecture

The deletion process involves two main components:

1. **Frontend (UI Postgres, `threads` table)**: Thread metadata and ownership
2. **Backend (Postgres)**: Conversation memory, long-term storage and the thread's web search vectors

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
- Supports all checkpointer types: PostgreSQL, SQLite
- Graceful error handling with detailed logging

### Frontend: DELETE /api/threads/[threadId]

Frontend API route that checks the session user owns the thread, calls the backend `DELETE /thread`, then deletes the `threads` row.

**Response:**
```json
{
  "ok": true
}
```

**Error Responses:**
- `401`: Unauthorized (user not authenticated)
- `404`: Thread not found or not owned by the user
- `502`: Backend deletion failed (the row is kept)

## Database Schema Changes

### UI Postgres (Frontend)
- `threads` rows are deleted outright; there is no soft deletion
- Rows cascade-delete with their owning `user`

### Postgres (Backend)
- Uses LangGraph's built-in deletion methods
- Automatically cleans up all related data:
  - Checkpoints table entries
  - Writes table entries
  - Store namespace data
  - The thread's `web_search_<thread_id>` vector collection (its embeddings cascade)

## User Interface Changes

### Thread List Component
- Replaced archive icon with delete (trash) icon
- Added confirmation dialog for deletion
- Changed styling to use destructive colors

### Thread Management
- Deleting the open thread switches to a new, empty thread
- The thread list updates after the backend confirms the deletion

### Docker Compose
No changes needed - deletion works with existing database setup.

### Kubernetes
No changes needed - deletion works with existing Helm charts.

## Error Handling

### Frontend
- User confirmation dialog prevents accidental deletion
- A failed backend deletion leaves the thread in place

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