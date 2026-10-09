import { CronJob } from 'cron';
import { deleteAccount, loadAccounts } from '../accounts.js';
import { logActivity, listNotifications, createNotification } from '../cloud_provider.js';

export function startCleanupJob() {
    // Run every hour: '0 * * * *'
    const job = new CronJob('0 * * * *', async () => {
        console.log('[Cleanup] Starting hourly cleanup job...');
        await cleanupOldAccounts();
    });

    job.start();
    console.log('[Cleanup] Auto-deletion job started (Every hour).');
}

async function cleanupOldAccounts() {
    try {
        const data = await loadAccounts();
        const now = new Date();
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

        // Filter for iQOO/Vivo accounts
        const targets = data.accounts.filter(acc =>
            acc.platform === 'iqoo' || acc.platform === 'vivo'
        );

        for (const acc of targets) {
            if (!acc.createdAt) continue;

            const created = new Date(acc.createdAt);
            const diff = now.getTime() - created.getTime();

            if (diff > SEVEN_DAYS_MS) {
                console.log(`[Cleanup] account ${acc.id} (${acc.platform}) is older than 7 days. Requesting deletion...`);

                // Check if a pending notification already exists for this account
                const existing = await listNotifications(acc.userId);
                const hasPending = existing.some((n: any) => n.account_id === acc.id && n.status === 'pending');

                if (!hasPending) {
                    await createNotification({
                        user_id: acc.userId,
                        account_id: acc.id,
                        platform: acc.platform,
                        type: 'account_deletion',
                        title: 'Account Cleanup Required',
                        message: `Account ${acc.id} (${acc.platform}) is older than 7 days and is slated for deletion. Do you want to proceed?`,
                        data: {
                            accountId: acc.id,
                            platform: acc.platform,
                            ageDays: Math.floor(diff / (24 * 60 * 60 * 1000))
                        }
                    });
                }
            }
        }
    } catch (e) {
        console.error('[Cleanup] Error during cleanup:', e);
    }
}
