/**
 * Session management utilities for better authentication handling
 */

// Keys for localStorage
const WAS_AUTHENTICATED_KEY = 'wasAuthenticated';
const LAST_ACTIVITY_KEY = 'lastActivity';
const SIGNED_OUT_KEY = 'signedOut';

/**
 * Mark user as authenticated (called when user signs in)
 */
export function markUserAsAuthenticated(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(WAS_AUTHENTICATED_KEY, 'true');
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
    // Clear explicit sign-out marker upon successful auth
    localStorage.removeItem(SIGNED_OUT_KEY);
  }
}

/**
 * Check if user was previously authenticated
 */
export function wasUserPreviouslyAuthenticated(): boolean {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(WAS_AUTHENTICATED_KEY) === 'true';
  }
  return false;
}

/**
 * Clear authentication state (called on explicit logout)
 */
export function clearAuthenticationState(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(WAS_AUTHENTICATED_KEY);
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    // Leave SIGNED_OUT_KEY untouched here; caller may intentionally set it
  }
}

/**
 * Update last activity timestamp
 */
export function updateLastActivity(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
  }
}

/**
 * Get last activity timestamp
 */
export function getLastActivity(): number | null {
  if (typeof window !== 'undefined') {
    const lastActivity = localStorage.getItem(LAST_ACTIVITY_KEY);
    return lastActivity ? parseInt(lastActivity, 10) : null;
  }
  return null;
}

/**
 * Check if session might have expired based on last activity
 * (This is a client-side heuristic, not authoritative)
 */
export function mightSessionBeExpired(): boolean {
  const lastActivity = getLastActivity();
  if (!lastActivity) return false;
  
  // Consider session potentially expired if no activity for 7+ days
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return (Date.now() - lastActivity) > sevenDaysMs;
}

/**
 * Explicit sign-out helpers to differentiate logout from expiry
 */
export function markSignedOut(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(SIGNED_OUT_KEY, 'true');
  }
}

export function wasSignedOut(): boolean {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(SIGNED_OUT_KEY) === 'true';
  }
  return false;
}

export function clearSignedOut(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SIGNED_OUT_KEY);
  }
}