import { logoutFromAllDevices } from './login/logout.js';
import { deleteAccount } from './accounts.js';
import logger from './log.js';

interface LogoutJob {
    jobId: string;
    accountIds: string[];
    currentAccountId?: string;
    completed: string[];
    failed: Array<{ accountId: string; error: string }>;
    status: 'idle' | 'processing' | 'completed';
    total: number;
}

class LogoutQueue {
    private job: LogoutJob | null = null;

    async createJob(accountIds: string[]): Promise<string> {
        if (this.job && this.job.status === 'processing') {
            throw new Error('A logout job is already in progress. Please wait.');
        }

        const jobId = `logout_${Date.now()}`;
        this.job = {
            jobId,
            accountIds: [...accountIds],
            completed: [],
            failed: [],
            status: 'idle',
            total: accountIds.length
        };

        this.processQueue(); // Start processing asynchronously
        return jobId;
    }

    getJobStatus() {
        return this.job;
    }

    private async processQueue() {
        if (!this.job) return;

        this.job.status = 'processing';
        logger.info(`[LogoutQueue] Starting job ${this.job.jobId} with ${this.job.total} accounts.`);

        for (const accountId of this.job.accountIds) {
            this.job.currentAccountId = accountId;
            logger.info(`[LogoutQueue] Processing logout for ${accountId}...`);

            try {
                const result = await logoutFromAllDevices(accountId);
                if (result.success) {
                    this.job.completed.push(accountId);
                    logger.info(`[LogoutQueue] Successfully logged out ${accountId}`);

                    // Permanent Delete (DB + Local Files) after successful global logout
                    await deleteAccount(accountId);
                    logger.info(`[LogoutQueue] Deleted account ${accountId} from database and local storage.`);
                } else {
                    this.job.failed.push({ accountId, error: result.message });
                    logger.error(`[LogoutQueue] Failed to log out ${accountId}: ${result.message}`);
                }
            } catch (error: any) {
                this.job.failed.push({ accountId, error: error.message || String(error) });
                logger.error(`[LogoutQueue] Critical error for ${accountId}: ${error.message}`);
            }

            // Add a small delay between accounts to be safe
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        this.job.status = 'completed';
        this.job.currentAccountId = undefined;
        logger.info(`[LogoutQueue] Job ${this.job.jobId} completed. Success: ${this.job.completed.length}, Failed: ${this.job.failed.length}`);
    }
}

export const logoutQueue = new LogoutQueue();
