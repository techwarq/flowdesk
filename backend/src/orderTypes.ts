export type JobState =
    'QUEUED' | 'RUNNING' | 'PARTIAL' | 'DONE' | 'FAILED' | 'RETRYING';

export enum JobPriority {
    USER_TRIGGERED = 1,    // User clicked refresh → highest priority
    BACKGROUND_REFRESH = 5, // Scheduled background refresh
    BATCH_SYNC = 10        // Bulk sync operations → lowest priority
}



export interface OrderJob {
    jobId: string;                          // Unique job identifier
    accountId: string;                      // Account to fetch orders for
    platform: string;        // Platform
    priority: JobPriority;                  // Priority (for heap ordering)
    state: JobState;                        // FSM state
    createdAt: number;                      // Timestamp
    startedAt?: number;                     // When execution started
    completedAt?: number;                   // When execution finished
    retryCount: number;                     // Number of retries so far
    maxRetries: number;                     // Max retry attempts
    error?: string;                         // Last error message
    progress?: number;                      // 0-100 progress percentage
    partialResults?: any[];                 // Partial orders scraped so far
}

export function getLockKey(accountId: string, platform: string): string {
    return `lock:${accountId.toLowerCase()}:${platform}`;
}

export function generateJobId(): string {
    return `job_${Date.now().toString(36)}`;
}

export interface CacheEntry {
    orders: any[];
    timestamp: number;
    ttlMs: number;
    accountId: string;
    platform: string;
}

export type OrderEventType =
    | 'job_queued'
    | 'job_started'
    | 'job_progress'
    | 'order_found'
    | 'order_updated'
    | 'job_completed'
    | 'job_failed';
export interface OrderEvent {
    type: OrderEventType;
    jobId: string;
    accountId: string;
    platform: string;
    data?: any;
    timestamp: number;
}
// ═══════════════════════════════════════════════════════════════════
// FAILED ACCOUNTS TRACKING (HashSet for login failures)
// ═══════════════════════════════════════════════════════════════════
/**
 * Reasons why login failed even after cookie injection
 */
export enum LoginFailureReason {
    COOKIES_EXPIRED = 'COOKIES_EXPIRED',           // Cookies no longer valid
    COOKIES_INVALID = 'COOKIES_INVALID',           // Cookies malformed/incomplete
    SESSION_TERMINATED = 'SESSION_TERMINATED',     // Server-side session killed
    CAPTCHA_REQUIRED = 'CAPTCHA_REQUIRED',         // CAPTCHA challenge appeared
    ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',             // Account temporarily locked
    IP_BLOCKED = 'IP_BLOCKED',                     // IP address blocked
    NETWORK_ERROR = 'NETWORK_ERROR',               // Connection failed
    TIMEOUT = 'TIMEOUT',                           // Request timed out
    UNKNOWN = 'UNKNOWN'                            // Unknown error
}
/**
 * Structure for tracking a failed account
 */
export interface FailedAccount {
    accountId: string;
    platform: string;
    reason: LoginFailureReason;
    errorMessage: string;
    failedAt: number;                              // Timestamp
    retryCount: number;                            // How many times we tried
    lastUrl?: string;                              // URL when failure detected
    requiresRelogin: boolean;                      // Needs manual re-authentication
}
/**
 * Batch processing result with failed accounts
 */
export interface BatchResult {
    successful: Array<{
        accountId: string;
        platform: string;
        orders: any[];
    }>;
    failed: FailedAccount[];
    totalProcessed: number;
    totalSuccessful: number;
    totalFailed: number;
    processingTimeMs: number;
}