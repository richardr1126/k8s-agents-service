import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { rateLimiter } from '@/lib/rate-limiter';

export async function GET() {
  try {
    // Check authentication
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userInfo = {
      id: session.user.id,
      isAnonymous: session.user.isAnonymous || false
    };

    const rateLimitResult = await rateLimiter.getCurrentUsage(userInfo);

    return NextResponse.json({
      allowed: rateLimitResult.allowed,
      currentCount: rateLimitResult.currentCount,
      limit: rateLimitResult.limit,
      remainingMessages: rateLimitResult.remainingMessages,
      resetTime: rateLimitResult.resetTime,
      userType: userInfo.isAnonymous ? 'anonymous' : 'authenticated'
    });
  } catch (error) {
    console.error('Rate limit status error:', error);
    return NextResponse.json(
      { error: 'Failed to get rate limit status' },
      { status: 500 }
    );
  }
}