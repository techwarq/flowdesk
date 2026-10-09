/**
 * Batch Order Fetching Module
 * 
 * Scalable system for fetching orders from 500+ Flipkart/Shopsy accounts:
 * - Job queue with configurable concurrency (default: 5 parallel browsers)
 * - List-only scraping (no deep scrape for speed)
 * - Progress tracking with callback support
 * - Order caching per account
 * - Headless browser mode
 */

import { chromium, Browser, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { PROFILES_DIR } from './config.js';
import { generateFingerprint } from './fingerprint.js';
import { getAccountLogger } from './log.js';
import { loadCookiesFromDB, getUnifiedCookies } from './cookies.js';
import { upsertAccount, getAccount, loadAccounts } from './accounts.js';
import { getChromiumPath } from './utils/browserPath.js';

// ============================================
// TYPES
// ============================================

export interface BatchJob {
    jobId: string;
    status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
    total: number;
    completed: number;
    failed: number;
    startedAt?: Date;
    completedAt?: Date;
    results: BatchAccountResult[];
    errors: { accountId: string; error: string }[];
}

export interface BatchAccountResult {
    accountId: string;
    platform: string;
    status: 'pending' | 'running' | 'done' | 'error';
    ordersFound: number;
    gvBalance?: string;
    error?: string;
}

export interface BatchProgress {
    type: 'started' | 'progress' | 'account_complete' | 'account_error' | 'done' | 'cancelled';
    jobId: string;
    accountId?: string;
    completed: number;
    total: number;
    ordersFound?: number;
    gvBalance?: string;
    error?: string;
}

export interface FetchOptions {
    concurrency?: number;          // Max parallel browsers (default: 5)
    headless?: boolean;            // Run headless (default: true)
    fetchGvBalance?: boolean;      // Fetch GV balance (default: true)
    onProgress?: (progress: BatchProgress) => void;
}

// ============================================
// JOB MANAGEMENT
// ============================================

const activeJobs: Map<string, BatchJob> = new Map();
let cancelledJobs: Set<string> = new Set();

/**
 * Generate unique job ID
 */
function generateJobId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Get job status
 */
export function getJobStatus(jobId: string): BatchJob | undefined {
    return activeJobs.get(jobId);
}

/**
 * Cancel a running job
 */
export function cancelJob(jobId: string): boolean {
    const job = activeJobs.get(jobId);
    if (job && job.status === 'running') {
        cancelledJobs.add(jobId);
        job.status = 'cancelled';
        return true;
    }
    return false;
}

/**
 * Get all active jobs for a summary
 */
export function getAllJobs(): BatchJob[] {
    return Array.from(activeJobs.values());
}

// ============================================
// BROWSER POOL
// ============================================

let sharedBrowser: Browser | null = null;

async function getSharedBrowser(headless: boolean = true): Promise<Browser> {
    if (sharedBrowser && sharedBrowser.isConnected()) {
        return sharedBrowser;
    }

    // Use Playwright's default installed browser (cross-platform)
    sharedBrowser = await chromium.launch({
        headless: headless,
        executablePath: getChromiumPath(),
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });

    return sharedBrowser;
}

// ============================================
// LIST-ONLY ORDER SCRAPING (FAST)
// ============================================

async function fetchOrdersListOnly(
    accountId: string,
    platform: string,
    browser: Browser,
    options: FetchOptions
): Promise<{ orders: any[]; gvBalance?: string }> {
    const log = getAccountLogger(accountId);
    const fingerprint = generateFingerprint(platform, accountId);

    // Use unified cookies for best session compatibility
    const cookies = await getUnifiedCookies(accountId, 'flipkart');
    if (cookies.length === 0) {
        throw new Error('No saved cookies found - please login to Flipkart first');
    }

    const context = await browser.newContext({
        userAgent: fingerprint.userAgent,
        locale: fingerprint.locale,
        timezoneId: fingerprint.timezoneId,
        viewport: { width: 1280, height: 720 }
    });

    await context.addCookies(cookies);

    let gvBalance: string | undefined;
    let orders: any[] = [];

    try {
        // Determine base domain based on platform
        const baseDomain = platform === 'shopsy' ? 'https://www.shopsy.in' : 'https://www.flipkart.com';

        // 1. Fetch GV Balance (optional) - only for Flipkart, Shopsy doesn't have GV
        if (options.fetchGvBalance !== false && platform === 'flipkart') {
            try {
                const gvPage = await context.newPage();
                await gvPage.goto(`${baseDomain}/account/giftcard?type=active`, {
                    waitUntil: 'domcontentloaded',
                    timeout: 20000
                });
                await gvPage.waitForTimeout(2000);

                gvBalance = await gvPage.evaluate(() => {
                    const text = document.body.innerText;
                    // Match patterns like "Balance: ₹0" or "Total Balance ₹500"
                    const match = text.match(/Balance\s*[:\-]?\s*(₹[\d,]+)/i);
                    return match ? match[1] : '';
                });

                if (gvBalance) {
                    log.info(`[Batch] GV Balance: ${gvBalance}`);
                }
                await gvPage.close();
            } catch (e: any) {
                log.warn(`[Batch] GV balance fetch failed: ${e.message}`);
            }
        }

        // 2. Fetch Orders (List Only - No Deep Scrape)
        const page = await context.newPage();
        await page.goto(`${baseDomain}/account/orders`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForTimeout(3000);

        const currentUrl = page.url();
        if (currentUrl.includes('/login')) {
            throw new Error('Cookies expired - login required');
        }

        // Scroll to load more orders
        let previousHeight = 0;
        let sameCount = 0;
        while (sameCount < 3) {
            const height = await page.evaluate(() => document.body.scrollHeight);
            if (height === previousHeight) sameCount++;
            else {
                sameCount = 0;
                previousHeight = height;
            }
            await page.mouse.wheel(0, 600);
            await page.waitForTimeout(800);
        }

        // Scrape all visible orders from list
        orders = await page.evaluate(() => {
            const results: any[] = [];
            const processed = new Set<string>();

            // Find all order cards
            const cards = document.querySelectorAll('.ZcgLRi, .kok32b, ._2aFisS, a[href*="order_details"]');

            cards.forEach(card => {
                const el = card as HTMLElement;

                // Get order URL
                let href = '';
                if (el.tagName === 'A') {
                    href = el.getAttribute('href') || '';
                } else {
                    const anchor = el.closest('a') || el.querySelector('a');
                    if (anchor) href = anchor.getAttribute('href') || '';
                }

                const fullUrl = href.startsWith('/') ? `https://www.flipkart.com${href}` : href;

                // Extract order ID
                let orderId = '';
                if (fullUrl.includes('order_id=')) {
                    const match = fullUrl.match(/order_id=([^&]+)/);
                    if (match) orderId = match[1];
                }
                if (!orderId) {
                    const textMatch = el.innerText.match(/OD\d{16,}/);
                    if (textMatch) orderId = textMatch[0];
                }

                if (!orderId || processed.has(orderId)) return;
                processed.add(orderId);

                // Extract text content
                const text = el.innerText;
                const lines = text.split('\n').filter(l => l.trim());

                // Price
                const priceMatch = text.match(/₹[\d,]+/);
                const price = priceMatch ? priceMatch[0] : '';

                // Status
                let status = 'Ordered';
                const statusPatterns = [
                    /Delivered on .+/i,
                    /Delivered/i,
                    /Shipped/i,
                    /Out for delivery/i,
                    /Cancelled/i,
                    /Returned/i,
                    /Refund/i
                ];
                for (const pattern of statusPatterns) {
                    const match = text.match(pattern);
                    if (match) {
                        status = match[0];
                        break;
                    }
                }

                // OTP (visible in list for some orders)
                let otp = '';
                const otpMatch = text.match(/OTP\s*[:\-]?\s*(\d{4,6})/i);
                if (otpMatch) otp = otpMatch[1];

                // Product name (first meaningful line)
                let productName = lines.find(l =>
                    !l.includes('₹') &&
                    !l.includes('Delivered') &&
                    !l.includes('Ordered') &&
                    l.length > 5
                ) || 'Product';

                // Image
                const img = el.querySelector('img');
                const imageUrl = img?.src || '';

                // Receiver name hint (from address section if visible)
                let receiverName = '';
                const addressMatch = text.match(/Delivery details[\s\S]*?(\w+)\s*\d{10}/i);
                if (addressMatch) receiverName = addressMatch[1];

                // Tracking ID
                let trackingId = '';
                const trackMatch = text.match(/(FMPC|FMPP)[A-Z0-9]+/i);
                if (trackMatch) trackingId = trackMatch[0];

                results.push({
                    orderId,
                    productName,
                    price,
                    status,
                    deliveryDate: '',
                    imageUrl,
                    orderUrl: fullUrl || 'https://www.flipkart.com/account/orders',
                    otp,
                    receiverName,
                    trackingId,
                    deliveryDetails: text.substring(0, 500) // Store raw text for parsing
                });
            });

            return results.slice(0, 50); // Limit to 50 orders per account
        });

        log.info(`[Batch] Found ${orders.length} orders for ${accountId}`);

        // Update account with orders
        if (orders.length > 0 || gvBalance) {
            const account = await getAccount(accountId);
            await upsertAccount({
                id: accountId,
                platform: platform as any,
                orders: orders.length > 0 ? orders : account?.orders,
                details: gvBalance ? { ...account?.details, gvBalance } : account?.details
            });
        }

        await page.close();
    } finally {
        await context.close();
    }

    return { orders, gvBalance };
}

// ============================================
// BATCH PROCESSING WITH JOB QUEUE
// ============================================

/**
 * Start a batch fetch job synchronously (returns job ID immediately)
 * The actual processing happens in the background
 */
export function startBatchFetch(
    accountIds: string[],
    platform: string,
    options: FetchOptions = {}
): string {
    const jobId = generateJobId();
    const job: BatchJob = {
        jobId,
        status: 'running',
        total: accountIds.length,
        completed: 0,
        failed: 0,
        startedAt: new Date(),
        results: accountIds.map(id => ({
            accountId: id,
            platform,
            status: 'pending' as const,
            ordersFound: 0
        })),
        errors: []
    };

    // Register job SYNCHRONOUSLY before any async work
    activeJobs.set(jobId, job);
    console.log(`[Batch] Job ${jobId} registered for ${accountIds.length} accounts`);

    // Start async processing in background (don't await)
    runBatchJob(job, accountIds, platform, options).catch(err => {
        console.error(`[Batch] Job ${jobId} failed:`, err);
        job.status = 'failed';
        job.errors.push({ accountId: 'system', error: String(err) });
    });

    return jobId;
}

/**
 * Internal: Run the actual batch processing
 */
async function runBatchJob(
    job: BatchJob,
    accountIds: string[],
    platform: string,
    options: FetchOptions
): Promise<void> {
    const concurrency = options.concurrency || 5;
    const headless = options.headless !== false;

    // Notify start
    options.onProgress?.({
        type: 'started',
        jobId: job.jobId,
        completed: 0,
        total: job.total
    });

    // Get shared browser
    let browser: Browser;
    try {
        browser = await getSharedBrowser(headless);
    } catch (e: any) {
        job.status = 'failed';
        job.errors.push({ accountId: 'system', error: e.message });
        return;
    }

    // Process in batches with concurrency limit
    const queue = [...accountIds];
    const processing: Promise<void>[] = [];

    const processOne = async (accountId: string) => {
        // Check if cancelled
        if (cancelledJobs.has(job.jobId)) {
            return;
        }

        const result = job.results.find(r => r.accountId === accountId)!;
        result.status = 'running';

        try {
            const { orders, gvBalance } = await fetchOrdersListOnly(
                accountId,
                platform,
                browser,
                options
            );

            result.status = 'done';
            result.ordersFound = orders.length;
            result.gvBalance = gvBalance;
            job.completed++;

            options.onProgress?.({
                type: 'account_complete',
                jobId: job.jobId,
                accountId,
                completed: job.completed,
                total: job.total,
                ordersFound: orders.length,
                gvBalance
            });

        } catch (e: any) {
            result.status = 'error';
            result.error = e.message;
            job.failed++;
            job.errors.push({ accountId, error: e.message });

            options.onProgress?.({
                type: 'account_error',
                jobId: job.jobId,
                accountId,
                completed: job.completed,
                total: job.total,
                error: e.message
            });
        }
    };

    // Parallel execution with concurrency limit
    while (queue.length > 0 || processing.length > 0) {
        // Check cancellation
        if (cancelledJobs.has(job.jobId)) {
            job.status = 'cancelled';
            options.onProgress?.({
                type: 'cancelled',
                jobId: job.jobId,
                completed: job.completed,
                total: job.total
            });
            break;
        }

        // Start new tasks up to concurrency limit
        while (processing.length < concurrency && queue.length > 0) {
            const accountId = queue.shift()!;
            const promise = processOne(accountId).then(() => {
                const idx = processing.indexOf(promise);
                if (idx > -1) processing.splice(idx, 1);
            });
            processing.push(promise);
        }

        // Wait for at least one to complete
        if (processing.length > 0) {
            await Promise.race(processing);
        }
    }

    // Complete
    if (job.status === 'running') {
        job.status = 'completed';
        job.completedAt = new Date();

        options.onProgress?.({
            type: 'done',
            jobId: job.jobId,
            completed: job.completed,
            total: job.total
        });
    }

    // Cleanup cancelled set
    cancelledJobs.delete(job.jobId);
}

// ============================================
// POLLING FOR RECENT ORDERS
// ============================================

/**
 * Quick poll for recently placed orders
 * Lighter weight than full batch - only checks first few orders
 */
export async function pollRecentOrders(
    accountIds: string[],
    platform: string,
    options: FetchOptions = {}
): Promise<Map<string, any[]>> {
    const results = new Map<string, any[]>();

    // Start batch job and wait for completion by polling
    const jobId = startBatchFetch(accountIds, platform, {
        ...options,
        fetchGvBalance: false, // Skip GV balance for polling
    });

    // Wait for job to complete (poll every 500ms)
    let job = getJobStatus(jobId);
    while (job && job.status === 'running') {
        await new Promise(r => setTimeout(r, 500));
        job = getJobStatus(jobId);
    }

    // Extract results
    if (job) {
        for (const result of job.results) {
            if (result.status === 'done' && result.ordersFound > 0) {
                const account = await getAccount(result.accountId);
                if (account?.orders) {
                    results.set(result.accountId, account.orders);
                }
            }
        }
    }

    return results;
}

// ============================================
// ORDER CACHE
// ============================================

// In-memory cache for fast lookups: accountId -> orderIds[]
const orderCache: Map<string, string[]> = new Map();

/**
 * Get cached order IDs for an account
 */
export function getCachedOrderIds(accountId: string): string[] {
    return orderCache.get(accountId) || [];
}

/**
 * Refresh cache from disk
 */
export async function refreshOrderCache(): Promise<void> {
    const data = await loadAccounts();
    orderCache.clear();

    for (const account of data.accounts) {
        if (account.orders && account.orders.length > 0) {
            orderCache.set(account.id, account.orders.map(o => o.orderId));
        }
    }
}

// Initialize cache on load
refreshOrderCache().catch(console.error);
