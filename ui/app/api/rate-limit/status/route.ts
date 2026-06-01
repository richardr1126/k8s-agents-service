import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { rateLimiter } from '@/lib/rate-limiter';
import { getIsAnonymous } from '@/lib/utils';

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
      email: session.user.email,
      isAnonymous: getIsAnonymous(session.user)
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
