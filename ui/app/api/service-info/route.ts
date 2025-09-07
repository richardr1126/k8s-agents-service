import { NextResponse } from 'next/server';
import { createBackendClient } from '@/lib/backend-client';

export async function GET() {
  try {
    const backendClient = createBackendClient();
    const serviceInfo = await backendClient.getServiceInfo();
    
    return NextResponse.json(serviceInfo);
  } catch (error) {
    console.error('Service info API error:', error);
    return NextResponse.json(
      { error: 'Failed to get service info' },
      { status: 500 }
    );
  }
}