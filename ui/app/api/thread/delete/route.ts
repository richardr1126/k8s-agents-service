import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { Pool } from 'pg';

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

export async function POST(req: NextRequest) {
  try {
    // Check authentication
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { threadId } = await req.json();

    if (!threadId) {
      return NextResponse.json({ error: 'Thread ID is required' }, { status: 400 });
    }

    // Validate user ownership of the thread in frontend database
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT id FROM user_threads WHERE id = $1 AND user_id = $2',
        [threadId, session.user.id]
      );

      if (result.rowCount === 0) {
        return NextResponse.json({ 
          error: 'Thread not found or you do not have permission to delete it' 
        }, { status: 403 });
      }

      // Delete from frontend database first
      await client.query(
        'DELETE FROM user_threads WHERE id = $1 AND user_id = $2',
        [threadId, session.user.id]
      );
    } finally {
      client.release();
    }

    // Call the backend delete endpoint (backend doesn't track users, so just pass thread_id)
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8080';
    const backendResponse = await fetch(`${backendUrl}/thread`, {
      method: 'DELETE',
      headers: { 
        'Content-Type': 'application/json',
        ...(process.env.BACKEND_AUTH_TOKEN && {
          'Authorization': `Bearer ${process.env.BACKEND_AUTH_TOKEN}`
        })
      },
      body: JSON.stringify({ thread_id: threadId }),
    });

    if (!backendResponse.ok) {
      console.error('Backend delete failed:', await backendResponse.text());
      // Note: Frontend DB record is already deleted, so this is just a warning
      console.warn(`Thread ${threadId} deleted from frontend DB but backend deletion failed`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting thread:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}