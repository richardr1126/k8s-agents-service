import { Pool } from 'pg';

// Rate limits configuration
export const RATE_LIMITS = {
  ANONYMOUS: 3,    // 3 messages per day for anonymous users
  AUTHENTICATED: 15 // 15 messages per day for authenticated users
} as const;

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// Initialize rate limiting table
export async function initializeRateLimitTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_message_counts (
        user_id VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        message_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, date)
      )
    `);
    
    // Create index for faster queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_message_counts_date ON user_message_counts(date)
    `);
  } finally {
    client.release();
  }
}

export interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  resetTime: Date;
  remainingMessages: number;
}

export interface UserInfo {
  id: string;
  isAnonymous?: boolean;
}

export class RateLimiter {
  private pool: Pool;

  constructor() {
    this.pool = pool;
  }

  /**
   * Check if a user can send a message and increment their count if allowed
   */
  async checkAndIncrementLimit(user: UserInfo): Promise<RateLimitResult> {
    await initializeRateLimitTable();
    
    const client = await this.pool.connect();
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      const limit = user.isAnonymous ? RATE_LIMITS.ANONYMOUS : RATE_LIMITS.AUTHENTICATED;
      
      // Start a transaction to ensure atomicity
      await client.query('BEGIN');
      
      try {
        // Get or create today's record for this user
        const result = await client.query(`
          INSERT INTO user_message_counts (user_id, date, message_count)
          VALUES ($1, $2, 0)
          ON CONFLICT (user_id, date)
          DO UPDATE SET updated_at = CURRENT_TIMESTAMP
          RETURNING message_count
        `, [user.id, today]);
        
        const currentCount = result.rows[0].message_count;
        
        // Check if user has exceeded their limit
        if (currentCount >= limit) {
          await client.query('COMMIT');
          return {
            allowed: false,
            currentCount,
            limit,
            resetTime: this.getResetTime(),
            remainingMessages: 0
          };
        }
        
        // Increment the count
        const updateResult = await client.query(`
          UPDATE user_message_counts 
          SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $1 AND date = $2
          RETURNING message_count
        `, [user.id, today]);
        
        const newCount = updateResult.rows[0].message_count;
        
        await client.query('COMMIT');
        
        return {
          allowed: true,
          currentCount: newCount,
          limit,
          resetTime: this.getResetTime(),
          remainingMessages: limit - newCount
        };
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /**
   * Get current usage for a user without incrementing
   */
  async getCurrentUsage(user: UserInfo): Promise<RateLimitResult> {
    await initializeRateLimitTable();
    
    const client = await this.pool.connect();
    try {
      const today = new Date().toISOString().split('T')[0];
      const limit = user.isAnonymous ? RATE_LIMITS.ANONYMOUS : RATE_LIMITS.AUTHENTICATED;
      
      const result = await client.query(
        'SELECT message_count FROM user_message_counts WHERE user_id = $1 AND date = $2',
        [user.id, today]
      );
      
      const currentCount = result.rows.length > 0 ? result.rows[0].message_count : 0;
      
      return {
        allowed: currentCount < limit,
        currentCount,
        limit,
        resetTime: this.getResetTime(),
        remainingMessages: Math.max(0, limit - currentCount)
      };
    } finally {
      client.release();
    }
  }

  /**
   * Transfer message counts when anonymous user creates an account
   */
  async transferAnonymousUsage(anonymousUserId: string, authenticatedUserId: string): Promise<void> {
    await initializeRateLimitTable();
    
    const client = await this.pool.connect();
    try {
      const today = new Date().toISOString().split('T')[0];
      
      await client.query('BEGIN');
      
      try {
        // Get anonymous user's current count
        const anonymousResult = await client.query(
          'SELECT message_count FROM user_message_counts WHERE user_id = $1 AND date = $2',
          [anonymousUserId, today]
        );
        
        if (anonymousResult.rows.length > 0) {
          const anonymousCount = anonymousResult.rows[0].message_count;
          
          // Update or create record for authenticated user
          await client.query(`
            INSERT INTO user_message_counts (user_id, date, message_count)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, date)
            DO UPDATE SET 
              message_count = GREATEST(user_message_counts.message_count, $3),
              updated_at = CURRENT_TIMESTAMP
          `, [authenticatedUserId, today, anonymousCount]);
          
          // Remove anonymous user's record
          await client.query(
            'DELETE FROM user_message_counts WHERE user_id = $1 AND date = $2',
            [anonymousUserId, today]
          );
        }
        
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /**
   * Clean up old records (optional maintenance)
   */
  async cleanupOldRecords(daysToKeep: number = 30): Promise<void> {
    const client = await this.pool.connect();
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
      
      await client.query(
        'DELETE FROM user_message_counts WHERE date < $1',
        [cutoffDateStr]
      );
    } finally {
      client.release();
    }
  }

  private getResetTime(): Date {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0); // Start of next day
    return tomorrow;
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();