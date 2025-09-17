import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const baseUrl = process.env.BACKEND_URL;
    const authToken = process.env.BACKEND_AUTH_TOKEN;

    if (!baseUrl) {
      throw new Error('BACKEND_URL environment variable is not set');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${baseUrl}/info`, {
      headers,
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