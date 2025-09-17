import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { threadId } = await req.json();

    if (!threadId) {
      return NextResponse.json({ error: 'Thread ID is required' }, { status: 400 });
    }

    // Call the backend delete endpoint
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
      return NextResponse.json({ 
        error: 'Failed to delete thread data from backend' 
      }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting thread:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}