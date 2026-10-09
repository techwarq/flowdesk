import { chromium, Browser, BrowserContext } from 'playwright';
import { fetchOrders } from './orders.js';
import { getAccountLogger } from './log.js';
import { getAccount } from './accounts.js';
import { orderCache } from './orderCache.js';
import { orderQueueManager, JobPriority } from './orderQueue.js';
import { EventEmitter } from 'events';
import { getChromiumPath } from './utils/browserPath.js';

export interface BatchAccount {
    accountId: string;
    platform: string;
}

export interface MultiBatchOptions {
    concurrencyPerPlatform?: number;
    globalMaxConcurrency?: number;
    headless?: boolean;
    forceRefresh?: boolean;
}

export interface MultiBatchResult {
    jobId: string;
    successful: Array<{ accountId: string; platform: string; count: number }>;
    failed: Array<{ accountId: string; platform: string; error: string }>;
    stats: {
        total: number;
        successful: number;
        failed: number;
        startTime: number;
        endTime: number;
    };
}

class PlatformWorker extends EventEmitter {
    private platform: string;
    private accounts: BatchAccount[];
    private concurrency: number;
    private headless: boolean;
    private forceRefresh: boolean;
    private browser: Browser | null = null;
    private activeCount = 0;
    private processedCount = 0;
    private results: any[] = [];
    private errors: any[] = [];
    private isRunning = false;

    constructor(platform: string, accounts: BatchAccount[], options: MultiBatchOptions) {
        super();
        this.platform = platform;
        this.accounts = [...accounts];
        this.concurrency = options.concurrencyPerPlatform || 5;
        this.headless = options.headless !== false;
        this.forceRefresh = options.forceRefresh || false;
    }

    async start() {
        if (this.isRunning || this.accounts.length === 0) return;
        this.isRunning = true;

        console.log(`[MultiBatch] Starting ${this.platform} worker with ${this.accounts.length} accounts`);

        try {
            // Launch one browser per platform
            this.browser = await chromium.launch({
                headless: this.headless,
                executablePath: getChromiumPath(),
                args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
            });

            const workers = [];
            for (let i = 0; i < Math.min(this.concurrency, this.accounts.length); i++) {
                workers.push(this.processQueue());
            }

            await Promise.all(workers);
        } catch (error: any) {
            console.error(`[MultiBatch] ${this.platform} worker fatal error:`, error);
        } finally {
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
            }
            this.isRunning = false;
            this.emit('done', {
                platform: this.platform,
                successful: this.results,
                failed: this.errors
            });
        }
    }

    private async processQueue() {
        while (this.accounts.length > 0) {
            const account = this.accounts.shift();
            if (!account) break;

            this.activeCount++;
            try {
                const log = getAccountLogger(account.accountId);
                log.info(`[MultiBatch] Processing ${this.platform} account: ${account.accountId}`);

                // In a multi-batch, we might want to check cache first if not forceRefresh
                if (!this.forceRefresh) {
                    const cached = orderCache.get(account.accountId, account.platform);
                    if (cached) {
                        log.info(`[MultiBatch] Using cached orders for ${account.accountId}`);
                        this.results.push({ accountId: account.accountId, platform: account.platform, count: cached.length });
                        continue;
                    }
                }

                // Create a dedicated context for this account using the shared browser
                // Note: We don't use BrowserManager here because we want isolation for this batch run
                const context = await this.browser!.newContext();

                try {
                    const result = await fetchOrders(account.accountId, account.platform, context);
                    if (Array.isArray(result)) {
                        this.results.push({ accountId: account.accountId, platform: account.platform, count: result.length });
                    } else if (result && typeof result === 'object' && 'success' in result) {
                        if (result.success) {
                            this.results.push({ accountId: account.accountId, platform: account.platform, count: result.count });
                        } else {
                            this.errors.push({ accountId: account.accountId, platform: account.platform, error: (result as any).error || 'Unknown error' });
                        }
                    } else {
                        this.errors.push({ accountId: account.accountId, platform: account.platform, error: 'Invalid response format' });
                    }
                } catch (e: any) {
                    this.errors.push({ accountId: account.accountId, platform: account.platform, error: e.message });
                } finally {
                    await context.close();
                }

            } catch (err: any) {
                this.errors.push({ accountId: account.accountId, platform: account.platform, error: err.message });
            } finally {
                this.activeCount--;
                this.processedCount++;
                this.emit('progress', {
                    platform: this.platform,
                    completed: this.processedCount,
                    total: this.processedCount + this.accounts.length
                });
            }
        }
    }
}

export class MultiPlatformJobManager {
    private jobs: Map<string, MultiBatchResult> = new Map();

    async startMultiBatch(accounts: BatchAccount[], options: MultiBatchOptions = {}): Promise<string> {
        const jobId = `mbatch_${Date.now()}`;
        const startTime = Date.now();

        // Group by platform
        const platformGroups: Record<string, BatchAccount[]> = {};
        accounts.forEach(acc => {
            if (!platformGroups[acc.platform]) platformGroups[acc.platform] = [];
            platformGroups[acc.platform].push(acc);
        });

        const platforms = Object.keys(platformGroups);
        console.log(`[MultiBatch] Starting multi-platform job ${jobId} with ${accounts.length} accounts across ${platforms.length} platforms`);

        const workers = platforms.map(platform => new PlatformWorker(platform, platformGroups[platform], options));

        // Track overall progress
        const finalResult: MultiBatchResult = {
            jobId,
            successful: [],
            failed: [],
            stats: {
                total: accounts.length,
                successful: 0,
                failed: 0,
                startTime,
                endTime: 0
            }
        };

        this.jobs.set(jobId, finalResult);

        // Run all platform workers in parallel (interleaved naturally by JS event loop)
        Promise.all(workers.map(w => w.start())).then(() => {
            finalResult.stats.endTime = Date.now();
            console.log(`[MultiBatch] Job ${jobId} completed in ${finalResult.stats.endTime - startTime}ms`);
        });

        // Collect results as they finish
        workers.forEach(worker => {
            worker.on('done', (data) => {
                finalResult.successful.push(...data.successful);
                finalResult.failed.push(...data.failed);
                finalResult.stats.successful += data.successful.length;
                finalResult.stats.failed += data.failed.length;
            });
        });

        return jobId;
    }

    getJobStatus(jobId: string): MultiBatchResult | null {
        return this.jobs.get(jobId) || null;
    }
}

export const multiBatchManager = new MultiPlatformJobManager();
