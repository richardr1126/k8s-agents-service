import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { Pool } from 'pg';
import { UserThread, generateThreadId } from '@/lib/user-threads';

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// Initialize user_threads table if it doesn't exist
async function initializeThreadsTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_threads (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        title TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        agent_id VARCHAR(255),
        model_id VARCHAR(255),
        last_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create index on user_id for faster queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_threads_user_id ON user_threads(user_id)
    `);
  } finally {
    client.release();
  }
}

// GET - Fetch user threads
export async function GET() {
  try {
    // Get session to verify user is authenticated
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initializeThreadsTable();

    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM user_threads WHERE user_id = $1 ORDER BY timestamp DESC',
        [session.user.id]
      );

      const threads: UserThread[] = result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        title: row.title,
        timestamp: parseInt(row.timestamp),
        agentId: row.agent_id,
        modelId: row.model_id,
        lastMessage: row.last_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      return NextResponse.json({ threads });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching threads:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Create new thread or update existing thread
export async function POST(req: NextRequest) {
  try {
    // Get session to verify user is authenticated
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action, threadData } = body;

    await initializeThreadsTable();

    const client = await pool.connect();
    try {
      if (action === 'create') {
        const threadId = generateThreadId();
        const { title = 'New Chat', agentId, modelId } = threadData || {};

        await client.query(
          `INSERT INTO user_threads (id, user_id, title, timestamp, agent_id, model_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [threadId, session.user.id, title, Date.now(), agentId, modelId]
        );

        return NextResponse.json({ threadId, success: true });
      } else if (action === 'update') {
        const { id, title, agentId, modelId, lastMessage, timestamp } = threadData;

        await client.query(
          `UPDATE user_threads 
           SET title = COALESCE($2, title),
               agent_id = COALESCE($3, agent_id),
               model_id = COALESCE($4, model_id),
               last_message = COALESCE($5, last_message),
               timestamp = COALESCE($6, timestamp),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND user_id = $7`,
          [id, title, agentId, modelId, lastMessage, timestamp, session.user.id]
        );

        return NextResponse.json({ success: true });
      } else if (action === 'delete') {
        const { threadId } = threadData;

        await client.query(
          'DELETE FROM user_threads WHERE id = $1 AND user_id = $2',
          [threadId, session.user.id]
        );

        return NextResponse.json({ success: true });
      }

      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error managing thread:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}