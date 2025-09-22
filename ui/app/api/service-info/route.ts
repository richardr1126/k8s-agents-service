import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function GET() {
  try {
    // Check authentication
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const baseUrl = process.env.BACKEND_URL;
    const authToken = process.env.BACKEND_AUTH_TOKEN;

    if (!baseUrl) {
      throw new Error('BACKEND_URL environment variable is not set');
    }

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authToken) {
      requestHeaders['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${baseUrl}/info`, {
      headers: requestHeaders,
    });

    if (!response.ok) {
      throw new Error(`Backend request failed: ${response.status}`);
    }

    const serviceInfo = await response.json();
    return NextResponse.json(serviceInfo);
  } catch (error) {
    console.error('Service info API error:', error);
    return NextResponse.json(
      { error: 'Failed to get service info' },
      { status: 500 }
    );
  }
}