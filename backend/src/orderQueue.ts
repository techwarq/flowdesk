// ═══════════════════════════════════════════════════════════════════
// ORDER QUEUE SYSTEM
// DSA: Priority Queue (Heap) + Mutex + Worker Pool + Deduplication
// ═══════════════════════════════════════════════════════════════════
import { EventEmitter } from 'events';
import {
    OrderJob,
    JobState,
    JobPriority,
    OrderEvent,
    OrderEventType,
    getLockKey,
    generateJobId
} from './orderTypes.js';
import { orderCache } from './orderCache.js';
import { fetchOrders } from './orders.js';  // Your existing scraper
import { updateOrdersInContext } from './chat.js';
import { getAccount } from './accounts.js';
// ─────────────────────────────────────────────────────────────────────
// SECTION 1: LOCK MANAGER (Mutex / Semaphore)
// ─────────────────────────────────────────────────────────────────────
/**
 * DSA Concept: Binary Semaphore / Mutex
 * 
 * Purpose: Only ONE job per (accountId + platform) at a time
 * This prevents:
 *   - Cookie race conditions
 *   - Browser session conflicts
 *   - Random logout bugs
 */
class LockManager {
    // Map<lockKey, { jobId, acquiredAt }>
    private locks: Map<string, { jobId: string; acquiredAt: number }> = new Map();

    // Timeout for stale locks (if a job crashes without releasing)
    private LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    /**
     * Try to acquire lock (non-blocking)
     * Returns true if lock acquired, false if already locked
     */
    tryAcquire(lockKey: string, jobId: string): boolean {
        // Check for stale lock
        const existing = this.locks.get(lockKey);
        if (existing) {
            const age = Date.now() - existing.acquiredAt;
            if (age > this.LOCK_TIMEOUT_MS) {
                console.log(`[Lock] Releasing stale lock: ${lockKey} (age: ${age}ms)`);
                this.locks.delete(lockKey);
            } else {
                console.log(`[Lock] BLOCKED - ${lockKey} held by ${existing.jobId}`);
                return false;
            }
        }

        this.locks.set(lockKey, { jobId, acquiredAt: Date.now() });
        console.log(`[Lock] ACQUIRED - ${lockKey} by ${jobId}`);
        return true;
    }

    /**
     * Release lock
     */
    release(lockKey: string, jobId: string): void {
        const existing = this.locks.get(lockKey);
        if (existing && existing.jobId === jobId) {
            this.locks.delete(lockKey);
            console.log(`[Lock] RELEASED - ${lockKey} by ${jobId}`);
        }
    }

    /**
     * Check if a lock is held
     */
    isLocked(lockKey: string): boolean {
        return this.locks.has(lockKey);
    }

    /**
     * Get job holding the lock (for attaching listeners)
     */
    getLockHolder(lockKey: string): string | null {
        return this.locks.get(lockKey)?.jobId ?? null;
    }
}
// ─────────────────────────────────────────────────────────────────────
// SECTION 2: PRIORITY QUEUE (Min-Heap)
// ─────────────────────────────────────────────────────────────────────
/**
 * DSA Concept: Min-Heap (Priority Queue)
 * 
 * Purpose: Process higher-priority jobs first
 *   - User-triggered refresh > Background refresh
 *   - Earlier jobs > Later jobs (FIFO within same priority)
 */
class PriorityQueue {
    private heap: OrderJob[] = [];

    /**
     * Get parent/child indices
     */
    private parent(i: number): number { return Math.floor((i - 1) / 2); }
    private leftChild(i: number): number { return 2 * i + 1; }
    private rightChild(i: number): number { return 2 * i + 2; }

    /**
     * Compare two jobs (for heap ordering)
     * Returns true if a should come before b
     */
    private shouldComeBefore(a: OrderJob, b: OrderJob): boolean {
        // Lower priority number = higher priority
        if (a.priority !== b.priority) {
            return a.priority < b.priority;
        }
        // Same priority → FIFO (earlier created first)
        return a.createdAt < b.createdAt;
    }

    /**
     * Swap two elements
     */
    private swap(i: number, j: number): void {
        [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
    }

    /**
     * Bubble up (after insert)
     */
    private bubbleUp(i: number): void {
        while (i > 0 && this.shouldComeBefore(this.heap[i], this.heap[this.parent(i)])) {
            this.swap(i, this.parent(i));
            i = this.parent(i);
        }
    }

    /**
     * Bubble down (after extract)
     */
    private bubbleDown(i: number): void {
        const n = this.heap.length;
        while (true) {
            let smallest = i;
            const left = this.leftChild(i);
            const right = this.rightChild(i);

            if (left < n && this.shouldComeBefore(this.heap[left], this.heap[smallest])) {
                smallest = left;
            }
            if (right < n && this.shouldComeBefore(this.heap[right], this.heap[smallest])) {
                smallest = right;
            }

            if (smallest === i) break;

            this.swap(i, smallest);
            i = smallest;
        }
    }

    /**
     * Insert job into queue
     */
    enqueue(job: OrderJob): void {
        this.heap.push(job);
        this.bubbleUp(this.heap.length - 1);
        console.log(`[Queue] ENQUEUED - ${job.jobId} (priority: ${job.priority}, size: ${this.heap.length})`);
    }

    /**
     * Extract highest priority job
     */
    dequeue(): OrderJob | undefined {
        if (this.heap.length === 0) return undefined;

        const top = this.heap[0];
        const last = this.heap.pop()!;

        if (this.heap.length > 0) {
            this.heap[0] = last;
            this.bubbleDown(0);
        }

        console.log(`[Queue] DEQUEUED - ${top.jobId} (remaining: ${this.heap.length})`);
        return top;
    }

    /**
     * Peek at highest priority job without removing
     */
    peek(): OrderJob | undefined {
        return this.heap[0];
    }

    /**
     * Get queue size
     */
    get size(): number {
        return this.heap.length;
    }

    /**
     * Check if queue is empty
     */
    get isEmpty(): boolean {
        return this.heap.length === 0;
    }

    /**
     * Find job by ID
     */
    findById(jobId: string): OrderJob | undefined {
        return this.heap.find(j => j.jobId === jobId);
    }

    /**
     * Find job by account+platform
     */
    findByAccount(accountId: string, platform: string): OrderJob | undefined {
        return this.heap.find(j =>
            j.accountId.toLowerCase() === accountId.toLowerCase() &&
            j.platform === platform
        );
    }
}
// ─────────────────────────────────────────────────────────────────────
// SECTION 3: DEDUPLICATION SET
// ─────────────────────────────────────────────────────────────────────
/**
 * DSA Concept: HashSet
 * 
 * Purpose: Prevent duplicate jobs for same account+platform
 * When user clicks refresh multiple times:
 *   - Don't create new job
 *   - Return existing job's ID for tracking
 */
class DeduplicationSet {
    // Map<accountId+platform, jobId>
    private inProgress: Map<string, string> = new Map();

    private getKey(accountId: string, platform: string): string {
        return `${accountId.toLowerCase()}:${platform}`;
    }

    /**
     * Check if job already in progress
     */
    isInProgress(accountId: string, platform: string): boolean {
        return this.inProgress.has(this.getKey(accountId, platform));
    }

    /**
     * Get existing job ID if in progress
     */
    getExistingJobId(accountId: string, platform: string): string | null {
        return this.inProgress.get(this.getKey(accountId, platform)) ?? null;
    }

    /**
     * Mark as in progress
     */
    markInProgress(accountId: string, platform: string, jobId: string): void {
        this.inProgress.set(this.getKey(accountId, platform), jobId);
    }

    /**
     * Remove from in-progress set
     */
    markCompleted(accountId: string, platform: string): void {
        this.inProgress.delete(this.getKey(accountId, platform));
    }
}
// ─────────────────────────────────────────────────────────────────────
// SECTION 3.5: FAILED ACCOUNTS SET (Login Failure Tracking)
// ─────────────────────────────────────────────────────────────────────
/**
 * DSA Concept: HashSet / HashMap
 * 
 * Purpose: Track accounts that fail to login even after cookie injection
 *   - Cookies might be expired
 *   - Session might be terminated server-side
 *   - Captcha might be required
 * 
 * At the end of batch processing, return ALL failed accounts with errors
 */
class FailedAccountsSet {
    // Map<accountId+platform, FailedAccount>
    private failures: Map<string, {
        accountId: string;
        platform: string;
        reason: string;
        errorMessage: string;
        failedAt: number;
        retryCount: number;
        lastUrl?: string;
        requiresRelogin: boolean;
    }> = new Map();

    private getKey(accountId: string, platform: string): string {
        return `${accountId.toLowerCase()}:${platform}`;
    }

    /**
     * Detect login failure reason from error message / URL
     */
    private detectFailureReason(errorMessage: string, url?: string): { reason: string; requiresRelogin: boolean } {
        const msgLower = errorMessage.toLowerCase();
        const urlLower = (url || '').toLowerCase();

        // Check for login redirect (most common indicator of expired cookies)
        if (urlLower.includes('/login') || urlLower.includes('/signin') || urlLower.includes('/account/login')) {
            return { reason: 'COOKIES_EXPIRED', requiresRelogin: true };
        }

        // Check for specific error patterns
        if (msgLower.includes('cookie') && (msgLower.includes('expired') || msgLower.includes('invalid'))) {
            return { reason: 'COOKIES_EXPIRED', requiresRelogin: true };
        }

        if (msgLower.includes('session') && (msgLower.includes('expired') || msgLower.includes('terminated'))) {
            return { reason: 'SESSION_TERMINATED', requiresRelogin: true };
        }

        if (msgLower.includes('captcha') || msgLower.includes('verification')) {
            return { reason: 'CAPTCHA_REQUIRED', requiresRelogin: true };
        }

        if (msgLower.includes('locked') || msgLower.includes('blocked') || msgLower.includes('suspended')) {
            return { reason: 'ACCOUNT_LOCKED', requiresRelogin: true };
        }

        if (msgLower.includes('ip') && msgLower.includes('blocked')) {
            return { reason: 'IP_BLOCKED', requiresRelogin: false };
        }

        if (msgLower.includes('timeout') || msgLower.includes('timed out')) {
            return { reason: 'TIMEOUT', requiresRelogin: false };
        }

        if (msgLower.includes('network') || msgLower.includes('connection') || msgLower.includes('econnrefused')) {
            return { reason: 'NETWORK_ERROR', requiresRelogin: false };
        }

        // Default
        return { reason: 'UNKNOWN', requiresRelogin: false };
    }

    /**
     * Add a failed account
     */
    addFailure(
        accountId: string,
        platform: string,
        errorMessage: string,
        retryCount: number,
        lastUrl?: string
    ): void {
        const key = this.getKey(accountId, platform);
        const { reason, requiresRelogin } = this.detectFailureReason(errorMessage, lastUrl);

        this.failures.set(key, {
            accountId,
            platform,
            reason,
            errorMessage,
            failedAt: Date.now(),
            retryCount,
            lastUrl,
            requiresRelogin
        });

        console.log(`[FailedAccounts] ADDED - ${key} | Reason: ${reason} | ReLogin: ${requiresRelogin}`);
    }

    /**
     * Check if account has already failed
     */
    hasFailed(accountId: string, platform: string): boolean {
        return this.failures.has(this.getKey(accountId, platform));
    }

    /**
     * Get failure details for an account
     */
    getFailure(accountId: string, platform: string): typeof this.failures extends Map<any, infer V> ? V | undefined : never {
        return this.failures.get(this.getKey(accountId, platform));
    }

    /**
     * Get ALL failed accounts (call at end of batch)
     */
    getAllFailures(): Array<{
        accountId: string;
        platform: string;
        reason: string;
        errorMessage: string;
        failedAt: number;
        retryCount: number;
        lastUrl?: string;
        requiresRelogin: boolean;
    }> {
        return Array.from(this.failures.values());
    }

    /**
     * Get only accounts that require manual re-login
     */
    getAccountsRequiringRelogin(): string[] {
        return Array.from(this.failures.values())
            .filter(f => f.requiresRelogin)
            .map(f => f.accountId);
    }

    /**
     * Remove a failure (e.g., after successful re-login)
     */
    removeFailure(accountId: string, platform: string): void {
        this.failures.delete(this.getKey(accountId, platform));
    }

    /**
     * Clear all failures (start fresh batch)
     */
    clear(): void {
        const count = this.failures.size;
        this.failures.clear();
        console.log(`[FailedAccounts] CLEARED - ${count} failures removed`);
    }

    /**
     * Get count of failed accounts
     */
    get size(): number {
        return this.failures.size;
    }

    /**
     * Get summary stats
     */
    getStats(): {
        total: number;
        byReason: Record<string, number>;
        requiresRelogin: number;
    } {
        const byReason: Record<string, number> = {};
        let requiresRelogin = 0;

        for (const failure of this.failures.values()) {
            byReason[failure.reason] = (byReason[failure.reason] || 0) + 1;
            if (failure.requiresRelogin) requiresRelogin++;
        }

        return {
            total: this.failures.size,
            byReason,
            requiresRelogin
        };
    }
}
// ─────────────────────────────────────────────────────────────────────
// SECTION 4: EVENT EMITTER (Observer Pattern / Pub-Sub)
// ─────────────────────────────────────────────────────────────────────
/**
 * DSA Concept: Observer Pattern / Pub-Sub
 * 
 * Purpose: Frontend subscribes to events for real-time updates
 *   - job_queued, job_started, order_found, etc.
 */
class OrderEventBus extends EventEmitter {
    emit(event: OrderEventType, payload: OrderEvent): boolean {
        console.log(`[Events] ${event} - ${payload.jobId}`);
        return super.emit(event, payload);
    }

    /**
     * Helper to create event payload
     */
    createEvent(
        type: OrderEventType,
        jobId: string,
        accountId: string,
        platform: string,
        data?: any
    ): OrderEvent {
        return {
            type,
            jobId,
            accountId,
            platform,
            data,
            timestamp: Date.now()
        };
    }
}
// ─────────────────────────────────────────────────────────────────────
// SECTION 5: WORKER POOL (Bounded Concurrency)
// ─────────────────────────────────────────────────────────────────────
/**
 * DSA Concept: Producer-Consumer with bounded threads
 * 
 * Purpose: Limit concurrent browser instances
 *   - Prevents memory exhaustion
 *   - Stable CPU usage
 *   - Predictable performance
 */
class WorkerPool {
    private activeWorkers = 0;
    private readonly maxWorkers: number;
    private processingQueue: (() => void)[] = [];

    constructor(maxWorkers: number = 3) {
        this.maxWorkers = maxWorkers;
        console.log(`[WorkerPool] Initialized with ${maxWorkers} max workers`);
    }

    /**
     * Execute a task when a worker slot is available
     */
    async execute<T>(task: () => Promise<T>): Promise<T> {
        // Wait for available slot
        await this.waitForSlot();

        this.activeWorkers++;
        console.log(`[WorkerPool] Worker started (${this.activeWorkers}/${this.maxWorkers})`);

        try {
            return await task();
        } finally {
            this.activeWorkers--;
            console.log(`[WorkerPool] Worker finished (${this.activeWorkers}/${this.maxWorkers})`);
            this.releaseSlot();
        }
    }

    private waitForSlot(): Promise<void> {
        if (this.activeWorkers < this.maxWorkers) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            this.processingQueue.push(resolve);
        });
    }

    private releaseSlot(): void {
        const next = this.processingQueue.shift();
        if (next) next();
    }

    /**
     * Get current stats
     */
    getStats(): { active: number; queued: number; max: number } {
        return {
            active: this.activeWorkers,
            queued: this.processingQueue.length,
            max: this.maxWorkers
        };
    }
}
// ─────────────────────────────────────────────────────────────────────
// SECTION 6: RETRY STRATEGY (Exponential Backoff)
// ─────────────────────────────────────────────────────────────────────
/**
 * DSA Concept: Exponential Backoff
 * 
 * Purpose: On failure, wait progressively longer before retry
 *   retry 1: wait 2s
 *   retry 2: wait 4s
 *   retry 3: wait 8s
 *   ... (capped at max)
 */
function calculateBackoff(retryCount: number, baseMs: number = 2000, maxMs: number = 30000): number {
    const delay = Math.min(baseMs * Math.pow(2, retryCount), maxMs);
    // Add jitter (±20%) to prevent thundering herd
    const jitter = delay * 0.2 * (Math.random() - 0.5);
    return Math.floor(delay + jitter);
}
// ─────────────────────────────────────────────────────────────────────
// SECTION 7: ORDER QUEUE MANAGER (Orchestrator)
// ─────────────────────────────────────────────────────────────────────
/**
 * Main orchestrator that ties everything together
 */
class OrderQueueManager {
    private queue = new PriorityQueue();
    private locks = new LockManager();
    private dedup = new DeduplicationSet();
    private failedAccounts = new FailedAccountsSet();  // NEW: Track login failures
    private workers = new WorkerPool(3);  // Max 3 concurrent scrapers
    private events = new OrderEventBus();

    // Track all jobs by ID
    private jobs = new Map<string, OrderJob>();

    // Processing loop state
    private isProcessing = false;

    /**
     * Submit a new order fetch request
     * 
     * Returns: { jobId, cached: boolean, orders?: any[] }
     */
    async submitJob(
        accountId: string,
        platform: string,
        priority: JobPriority = JobPriority.USER_TRIGGERED,
        forceRefresh: boolean = false
    ): Promise<{ jobId: string; cached: boolean; orders?: any[] }> {

        // ─── STEP 1: Check cache first (unless force refresh) ───
        if (!forceRefresh) {
            const cached = orderCache.get(accountId, platform);
            if (cached && cached.length > 0) {
                console.log(`[Manager] Returning cached orders for ${accountId}`);

                // If cache is stale, trigger background refresh
                if (orderCache.isStale(accountId, platform)) {
                    console.log(`[Manager] Cache stale, triggering background refresh`);
                    // Fire and forget background refresh
                    this.submitJob(accountId, platform, JobPriority.BACKGROUND_REFRESH, true).catch(() => { });
                }

                return { jobId: 'cache', cached: true, orders: cached };
            }
        }

        // ─── STEP 2: Check deduplication (is job already running?) ───
        const existingJobId = this.dedup.getExistingJobId(accountId, platform);
        if (existingJobId) {
            console.log(`[Manager] Job already in progress: ${existingJobId}`);
            // Return existing job ID so frontend can subscribe to its events
            return { jobId: existingJobId, cached: false };
        }

        // ─── STEP 3: Create new job ───
        const job: OrderJob = {
            jobId: generateJobId(),
            accountId,
            platform,
            priority,
            state: 'QUEUED',
            createdAt: Date.now(),
            retryCount: 0,
            maxRetries: 3
        };

        // ─── STEP 4: Register job ───
        this.jobs.set(job.jobId, job);
        this.dedup.markInProgress(accountId, platform, job.jobId);
        this.queue.enqueue(job);

        // Emit event
        this.events.emit('job_queued', this.events.createEvent(
            'job_queued', job.jobId, accountId, platform, { priority }
        ));

        // ─── STEP 5: Start processing if not already ───
        this.startProcessing();

        return { jobId: job.jobId, cached: false };
    }

    /**
     * Main processing loop
     */
    private async startProcessing(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        console.log('[Manager] Processing loop started');

        while (!this.queue.isEmpty) {
            const job = this.queue.dequeue();
            if (!job) break;

            // Process job in worker pool (bounded concurrency)
            this.workers.execute(() => this.processJob(job)).catch(err => {
                console.error(`[Manager] Worker error: ${err.message}`);
            });
        }

        this.isProcessing = false;
        console.log('[Manager] Processing loop ended');
    }

    /**
     * Detect if error indicates login failure
     */
    private isLoginFailure(errorMessage: string, lastUrl?: string): boolean {
        const msgLower = errorMessage.toLowerCase();
        const urlLower = (lastUrl || '').toLowerCase();

        // URL-based detection (most reliable)
        if (urlLower.includes('/login') || urlLower.includes('/signin')) {
            return true;
        }

        // Error message patterns
        const loginFailurePatterns = [
            'cookies expired',
            'please log in',
            'session expired',
            'not logged in',
            'authentication failed',
            'login required',
            'unauthorized'
        ];

        return loginFailurePatterns.some(pattern => msgLower.includes(pattern));
    }

    /**
     * Process a single job
     */
    private async processJob(job: OrderJob): Promise<void> {
        const lockKey = getLockKey(job.accountId, job.platform);
        let lastUrl: string | undefined;

        // ─── STEP 1: Acquire lock ───
        if (!this.locks.tryAcquire(lockKey, job.jobId)) {
            // Lock held, re-queue with slight delay
            console.log(`[Manager] Lock unavailable, re-queuing ${job.jobId}`);
            setTimeout(() => {
                if (job.state !== 'DONE' && job.state !== 'FAILED') {
                    this.queue.enqueue(job);
                    this.startProcessing();
                }
            }, 1000);
            return;
        }

        try {
            // ─── STEP 2: Update state ───
            job.state = 'RUNNING';
            job.startedAt = Date.now();

            this.events.emit('job_started', this.events.createEvent(
                'job_started', job.jobId, job.accountId, job.platform
            ));

            // ─── STEP 3: Execute the actual scraper ───
            console.log(`[Manager] Executing scraper for ${job.jobId}`);
            const result = await fetchOrders(job.accountId, job.platform);

            // Capture last URL for login failure detection
            lastUrl = (result as any).lastUrl;  // Extracted if object

            // ─── STEP 4: Handle result ───
            if (Array.isArray(result) || (result && typeof result === 'object' && result.success)) {
                job.state = 'DONE';
                job.completedAt = Date.now();

                const orders = Array.isArray(result) ? result : result.orders || [];
                const count = Array.isArray(result) ? result.length : result.count || orders.length;

                // Update cache
                orderCache.set(job.accountId, job.platform, orders);

                // Re-sync with Chat Context (Vector DB)
                const fullAccount = await getAccount(job.accountId);
                if (fullAccount) {
                    const chatUserId = fullAccount.userId || job.accountId;
                    console.log(`[Queue] Triggering Vector DB sync for ${job.accountId} (userId: ${chatUserId})`);
                    updateOrdersInContext(chatUserId, job.accountId, job.platform, orders).catch(e => {
                        console.error(`[Queue] Chat context update failed: ${e.message}`);
                    });
                }

                // Clear any previous failure for this account
                this.failedAccounts.removeFailure(job.accountId, job.platform);

                this.events.emit('job_completed', this.events.createEvent(
                    'job_completed', job.jobId, job.accountId, job.platform,
                    { orders, count }
                ));
            } else {
                const errorMsg = result && typeof result === 'object' && 'error' in result ? result.error : 'Unknown error fetching orders';
                throw new Error(errorMsg);
            }

        } catch (error: any) {
            console.error(`[Manager] Job failed: ${job.jobId} - ${error.message}`);
            job.error = error.message;

            // ─── CHECK FOR LOGIN FAILURE ───
            const isLoginError = this.isLoginFailure(error.message, lastUrl);

            if (isLoginError) {
                // Don't retry login failures - add to failed set immediately
                console.log(`[Manager] LOGIN FAILURE detected for ${job.accountId}`);

                this.failedAccounts.addFailure(
                    job.accountId,
                    job.platform,
                    error.message,
                    job.retryCount,
                    lastUrl
                );

                job.state = 'FAILED';
                job.completedAt = Date.now();

                this.events.emit('job_failed', this.events.createEvent(
                    'job_failed', job.jobId, job.accountId, job.platform,
                    {
                        error: error.message,
                        isLoginFailure: true,
                        requiresRelogin: true
                    }
                ));
            }
            // ─── RETRY LOGIC (for non-login errors) ───
            else if (job.retryCount < job.maxRetries) {
                job.retryCount++;
                job.state = 'RETRYING';

                const backoffMs = calculateBackoff(job.retryCount);
                console.log(`[Manager] Scheduling retry ${job.retryCount}/${job.maxRetries} in ${backoffMs}ms`);

                setTimeout(() => {
                    job.state = 'QUEUED';
                    this.queue.enqueue(job);
                    this.startProcessing();
                }, backoffMs);
            } else {
                // Max retries reached - add to failed accounts
                this.failedAccounts.addFailure(
                    job.accountId,
                    job.platform,
                    error.message,
                    job.retryCount,
                    lastUrl
                );

                job.state = 'FAILED';
                job.completedAt = Date.now();

                this.events.emit('job_failed', this.events.createEvent(
                    'job_failed', job.jobId, job.accountId, job.platform,
                    { error: error.message }
                ));
            }

        } finally {
            // ─── STEP 5: Release lock ───
            this.locks.release(lockKey, job.jobId);

            // ─── STEP 6: Clean up dedup if terminal state ───
            if (job.state === 'DONE' || job.state === 'FAILED') {
                this.dedup.markCompleted(job.accountId, job.platform);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // BATCH PROCESSING - Process multiple accounts and return failures
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Process a batch of accounts and return results including ALL failed accounts
     * 
     * This is what you call when refreshing all accounts at once
     */
    async processBatch(
        accounts: Array<{ accountId: string; platform: string }>,
        options: {
            forceRefresh?: boolean;
            priority?: JobPriority;
        } = {}
    ): Promise<{
        successful: Array<{ accountId: string; platform: string; orders: any[] }>;
        failed: Array<{
            accountId: string;
            platform: string;
            reason: string;
            errorMessage: string;
            failedAt: number;
            retryCount: number;
            lastUrl?: string;
            requiresRelogin: boolean;
        }>;
        stats: {
            total: number;
            successful: number;
            failed: number;
            processingTimeMs: number;
        };
    }> {
        const startTime = Date.now();
        const { forceRefresh = false, priority = JobPriority.BATCH_SYNC } = options;

        // Clear previous batch failures
        this.failedAccounts.clear();

        console.log(`[Manager] Starting batch processing for ${accounts.length} accounts`);

        // Submit all jobs
        const jobPromises: Promise<{
            accountId: string;
            platform: string;
            result: any
        }>[] = [];

        for (const { accountId, platform } of accounts) {
            const promise = (async () => {
                try {
                    const jobResult = await this.submitJob(accountId, platform, priority, forceRefresh);

                    // If cached, return immediately
                    if (jobResult.cached) {
                        return {
                            accountId,
                            platform,
                            result: { success: true, orders: jobResult.orders }
                        };
                    }

                    // Otherwise, wait for job to complete
                    const finalResult = await this.waitForJobPublic(jobResult.jobId);
                    return { accountId, platform, result: finalResult };
                } catch (error: any) {
                    return {
                        accountId,
                        platform,
                        result: { success: false, error: error.message }
                    };
                }
            })();

            jobPromises.push(promise);
        }

        // Wait for all jobs
        const results = await Promise.all(jobPromises);

        // Separate successful and failed
        const successful: Array<{ accountId: string; platform: string; orders: any[] }> = [];

        for (const { accountId, platform, result } of results) {
            if (result.success && result.orders) {
                successful.push({ accountId, platform, orders: result.orders });
            }
            // Failed accounts are already tracked in failedAccounts set
        }

        const endTime = Date.now();

        // Get all failed accounts
        const failed = this.failedAccounts.getAllFailures();

        console.log(`[Manager] Batch complete: ${successful.length} successful, ${failed.length} failed`);

        return {
            successful,
            failed,
            stats: {
                total: accounts.length,
                successful: successful.length,
                failed: failed.length,
                processingTimeMs: endTime - startTime
            }
        };
    }

    /**
     * Wait for a job to complete (public for API use)
     */
    waitForJobPublic(jobId: string, timeoutMs: number = 120000): Promise<any> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Job timeout'));
            }, timeoutMs);

            const checkJob = () => {
                const job = this.jobs.get(jobId);
                if (!job) {
                    clearTimeout(timeout);
                    reject(new Error('Job not found'));
                    return;
                }

                if (job.state === 'DONE') {
                    clearTimeout(timeout);
                    // Get orders from cache
                    const orders = orderCache.get(job.accountId, job.platform) || [];
                    resolve({ success: true, orders });
                } else if (job.state === 'FAILED') {
                    clearTimeout(timeout);
                    resolve({ success: false, error: job.error });
                } else {
                    // Still processing, check again
                    setTimeout(checkJob, 500);
                }
            };

            checkJob();
        });
    }

    /**
     * Get job status
     */
    getJobStatus(jobId: string): OrderJob | undefined {
        return this.jobs.get(jobId);
    }

    /**
     * Get all failed accounts (can be called anytime)
     */
    getFailedAccounts() {
        return this.failedAccounts.getAllFailures();
    }

    /**
     * Get accounts requiring re-login
     */
    getAccountsRequiringRelogin(): string[] {
        return this.failedAccounts.getAccountsRequiringRelogin();
    }

    /**
     * Get failure stats
     */
    getFailureStats() {
        return this.failedAccounts.getStats();
    }

    /**
     * Clear failed accounts (e.g., after user re-logs in)
     */
    clearFailures(): void {
        this.failedAccounts.clear();
    }

    /**
     * Subscribe to events
     */
    on(event: OrderEventType, listener: (payload: OrderEvent) => void): void {
        this.events.on(event, listener);
    }

    /**
     * Get queue stats
     */
    getStats(): {
        queueSize: number;
        workers: { active: number; queued: number; max: number };
        totalJobs: number;
    } {
        return {
            queueSize: this.queue.size,
            workers: this.workers.getStats(),
            totalJobs: this.jobs.size
        };
    }
}
// ─────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────
// Export singleton instance
export const orderQueueManager = new OrderQueueManager();
// Export classes for testing or custom instances
export {
    LockManager,
    PriorityQueue,
    DeduplicationSet,
    OrderEventBus,
    WorkerPool,
    calculateBackoff,
    JobPriority
};
