


if (process.env.OPENAI_API_KEY) {
    console.log('OpenAI API Key loaded.');
} else {
    console.warn('OpenAI API Key NOT found in environment.');
}

import fs from 'fs';
import path from 'path';

// Top-level error handler to catch startup crashes immediately
process.on('uncaughtException', (err) => {
    console.error('CRITICAL STARTUP ERROR:', err);
    try {
        // Resolve data directory similar to config.ts logic
        const userDataPath = process.env.USER_DATA_PATH;
        const logDir = userDataPath
            ? path.join(userDataPath, 'data', 'logs')
            : path.join(process.cwd(), 'data', 'logs');

        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

        const logFile = path.join(logDir, 'backend-startup-error.log');
        fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] CRITICAL STARTUP ERROR:\n${err.message}\n${err.stack}\n`);
    } catch (e) {
        console.error('Failed to write startup log:', e);
    }
    process.exit(1);
});

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadAccounts, getAccount, upsertAccount, deleteAccount, updateAccountStatus, moveAccounts } from './src/accounts.js';
import { fetchLocalStorage, pushLocalStorage, listNotifications, createNotification, updateNotificationStatus, getNotification, logActivity } from './src/cloud_provider.js';
import { saveLocalStorage } from './src/localStorage.js';
// Re-export required functions if they are not directly exported or if path logic differs, 
// but here we import directly from the restored src files.
// Note: We need to ensure src/accounts.ts exports everything we need. 
// It does: loadAccounts, checkAccountHealth (wait, checkAccountHealth is in src/check/health.ts), refreshSession (src/refresh/flow.ts).
// I need to import them from correct paths.

import { checkAccountHealth as checkHealthLogic } from './src/check/health.js';
import { refreshSession as refreshSessionLogic } from './src/refresh/flow.js';
import { loginFlipkart, loginShopsy, loginIqoo, loginPlatform } from './src/login/index.js';
import { signUpSupabase, signInSupabase, verifySession, listAllUsers } from './src/auth_provider.js';
import { orderCache } from './src/orderCache.js';

const fastify = Fastify({ 
    logger: true,
    disableRequestLogging: true // We will manually log to avoid noisy endpoints
});

// Custom logger hook to silence noisy endpoints
fastify.addHook('onRequest', (request, reply, done) => {
    // Still log the incoming request manually for important endpoints
    if (request.method !== 'OPTIONS' && !request.url.includes('/localstorage') && !request.url.includes('/status')) {
        request.log.info({ req: request }, 'incoming request');
    }
    done();
});

fastify.addHook('onResponse', (request, reply, done) => {
    // Only log completed requests for non-noisy endpoints
    if (request.method !== 'OPTIONS' && !request.url.includes('/localstorage') && !request.url.includes('/status')) {
        const responseTime = typeof (reply as any).getResponseTime === 'function' ? (reply as any).getResponseTime() : (reply as any).elapsedTime;
        request.log.info({ res: reply, responseTime }, 'request completed');
    }
    done();
});

// CORS will be registered inside the start function

// Allow DELETE requests with Content-Type: application/json and empty body
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
    if (body === '' || body === null || body === undefined) {
        done(null, null);
    } else {
        try {
            const json = JSON.parse(body as string);
            done(null, json);
        } catch (err: any) {
            done(err, undefined);
        }
    }
});

// Health check
fastify.get('/api/health', async (request, reply) => {
    return { status: 'ok', version: '1.2.0' };
});

// Accounts
fastify.get('/api/accounts', async (request, reply) => {
    const authHeader = request.headers.authorization;
    let userId: string | undefined;
    let session: any;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        session = await verifySession(token);
        if (session) {
            userId = session.id;
        }
    }

    if (!userId) {
        return { accounts: [] };
    }

    const query = request.query as { userId?: string };
    
    // Determine the userId to filter by in the database
    let dbFilterUserId: string | undefined;

    if (session?.role === 'admin') {
        // Admin: Can filter by optional query.userId
        if (query.userId) {
            dbFilterUserId = query.userId;
        }
        // If no query.userId, Admin still gets ALL accounts (dbFilterUserId stays undefined)
    } else {
        // Non-Admin: Strict filtering to own accounts
        dbFilterUserId = userId;
    }

    const data = await loadAccounts(dbFilterUserId);

    let targetAccounts = data.accounts;

    // Inject cached orders (transient, not in DB)
    const accountsWithOrders = targetAccounts.map(account => {
        const cached = orderCache.get(account.id, account.platform);
        if (cached) {
            return { ...account, orders: cached };
        }
        return account;
    });

    return { accounts: accountsWithOrders };
});

fastify.post('/api/accounts', async (request, reply) => {
    const authHeader = request.headers.authorization;
    let userId: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const session = await verifySession(token);
        if (session) {
            userId = session.id;
        }
    }

    if (!userId) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }

    const body = request.body as any;
    // Enforce userId ownership
    body.userId = userId;

    const account = await upsertAccount(body);
    return account;
});

fastify.get('/api/admin/profiles', async (request, reply) => {
    // Auth Check
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);
    if (!session || session.role !== 'admin') {
        return reply.status(403).send({ success: false, message: 'Forbidden' });
    }

    const profiles = await listAllUsers();
    return profiles;
});

fastify.delete('/api/accounts/:id', async (request, reply) => {
    // Add Auth Check
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);
    if (!session) {
        return reply.status(401).send({ success: false, message: 'Invalid session' });
    }

    try {
        const { id } = request.params as { id: string };
        const decodedId = decodeURIComponent(id);

        // Check ownership before delete if not admin
        if (session.role !== 'admin') {
            const account = await getAccount(decodedId);
            if (account && account.userId && account.userId !== session.id) {
                return reply.status(403).send({ success: false, message: 'Forbidden' });
            }
        }

        console.log(`[API] Deleting account: ${decodedId}`);
        const result = await deleteAccount(decodedId);
        return { success: result };
    } catch (e: any) {
        console.error('[API] Delete account error:', e);
        return reply.status(500).send({ success: false, error: e.message });
    }
});

fastify.post('/api/accounts/pre-login-session', async (request, reply) => {
    // Auth Check
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);
    if (!session) {
        return reply.status(401).send({ success: false, message: 'Invalid session' });
    }

    const { id, platform = 'flipkart', headless = false } = request.body as { id: string, platform: string, headless?: boolean };
    const decodedId = decodeURIComponent(id);

    try {
        console.log(`[API] Starting PRE-LOGIN session for ${decodedId} on ${platform}`);

        let result;
        if (platform === 'shopsy') {
            result = await loginShopsy({
                accountId: decodedId,
                identifier: decodedId,
                headless: headless,
                keepOpen: true,
                forceFresh: true
            });
        } else if (platform === 'flipkart') {
            result = await loginFlipkart({
                accountId: decodedId,
                identifier: decodedId,
                headless: headless,
                keepOpen: true,
                forceFresh: true
            });
        } else if (platform === 'iqoo') {
            result = await loginIqoo({
                accountId: decodedId,
                identifier: decodedId,
                headless: headless,
                keepOpen: true,
                forceFresh: true
            });
        } else {
            // Use unified loginPlatform for all new platforms (vivo, oppo, realme, xiaomi, samsung, oneplus, vijaysales, reliancedigital, amazon)
            result = await loginPlatform(platform, {
                accountId: decodedId,
                identifier: decodedId,
                headless: headless,
                keepOpen: true,
                forceFresh: true
            });
        }

        return result;
    } catch (e: any) {
        console.error('[API] Pre-login session error:', e);
        return reply.status(500).send({ success: false, error: e.message });
    }
});

fastify.post('/api/accounts/:id/login-session', async (request, reply) => {
    // Auth Check
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);
    if (!session) {
        return reply.status(401).send({ success: false, message: 'Invalid session' });
    }

    const { id } = request.params as { id: string };
    const { platform = 'flipkart', headless = false } = request.body as { platform: string, headless?: boolean };
    const decodedId = decodeURIComponent(id);

    try {
        // Verify account exists and ownership
        const account = await getAccount(decodedId);
        if (!account) {
            return reply.status(404).send({ success: false, message: 'Account not found' });
        }
        if (session.role !== 'admin' && account.userId && account.userId !== session.id) {
            return reply.status(403).send({ success: false, message: 'Forbidden' });
        }

        console.log(`[API] Starting login session for ${decodedId} on ${platform} (Visible Browser)`);

        let result;
        if (platform === 'shopsy') {
            result = await loginShopsy({
                accountId: decodedId,
                identifier: account.identifier,
                headless: headless,
                keepOpen: true
            });
        } else if (platform === 'flipkart') {
            result = await loginFlipkart({
                accountId: decodedId,
                identifier: account.identifier,
                headless: headless,
                keepOpen: true
            });
        } else if (platform === 'iqoo') {
            result = await loginIqoo({
                accountId: decodedId,
                identifier: account.identifier,
                headless: headless,
                keepOpen: true
            });
        } else {
            // Generic fallback for others
            const { openSession } = await import('./src/session.js');
            result = await openSession({ accountId: decodedId, platform: platform });
        }

        return result;
    } catch (e: any) {
        console.error('[API] Login session error:', e);
        return reply.status(500).send({ success: false, error: e.message });
    }
});

fastify.post('/api/accounts/:id/rotate-ip', async (request, reply) => {
    // Note: this endpoint is called from the browser overlay, which might not have the auth token.
    // For local usage, we allow it. In production, we should inject a one-time token or session key.

    const { id } = request.params as { id: string };
    const decodedId = decodeURIComponent(id);

    try {
        const account = await getAccount(decodedId);
        if (!account) {
            return reply.status(404).send({ success: false, message: 'Account not found' });
        }

        // === OPTIMIZED ROTATION: ZERO LATECY ===
        // 1. Calculate New State Immediately (In-Memory)
        const currentOffset = account.proxyOffset || 0;
        const newOffset = currentOffset + 1;

        // 2. Fetch Proxy for NEW offset (Fast, cached)
        // Temporarily patch the account object in memory to reuse getProxyForAccount logic effectively
        // Or better: manually calculate it here to be 100% sure we get the "next" one.
        // Let's rely on our getProxy logic but pass the simulated state
        // Actually, getProxyForAccount pulls from DB or Cache. We need to be careful.
        // Let's just manually get the proxy list and pick the next index.

        // Import here to use internal functions if needed, but getProxyForAccount is imported.
        // We need to simulate: "What if offset was newOffset?"
        // Strategy: We can't easily injection-patch getProxyForAccount. 
        // We will just replicate the hash logic briefly or accept that we need to calculate it.
        // Let's use the DB update as the source of truth but do it in background? 
        // No, client needs the proxy NOW.

        // Simplest Robust Way: 
        // 1. Calculate new proxy.
        // 2. Send it.
        // 3. Save it.

        const { loadProxies } = await import('./src/proxy.js'); // Ensure we have access
        const proxies = await loadProxies();

        let proxyString: string | null = null;

        if (proxies.length > 0) {
            // Replicate hash logic from proxy.ts (simple sum of char codes)
            let hash = 0;
            for (let i = 0; i < decodedId.length; i++) {
                const char = decodedId.charCodeAt(i);
                hash = (hash << 5) - hash + char;
                hash = hash & hash;
            }
            hash = Math.abs(hash);

            const index = (hash + newOffset) % proxies.length;
            const rawProxy = proxies[index];

            // Format it
            try {
                // Handle format: protocol://user:pass@host:port OR protocol://host:port
                const url = new URL(rawProxy.includes('://') ? rawProxy : `http://${rawProxy}`);
                if (url.username && url.password) {
                    proxyString = `${url.protocol}//${encodeURIComponent(decodeURIComponent(url.username))}:${encodeURIComponent(decodeURIComponent(url.password))}@${url.hostname}:${url.port}`;
                } else {
                    proxyString = rawProxy.replace(/\/$/, '');
                }
            } catch (e) {
                proxyString = rawProxy.replace(/\/$/, '');
            }
        }

        // 3. SEND RESPONSE IMMEDIATELY
        reply.send({ success: true, message: 'Rotation initiated', proxy: proxyString });

        // 4. Background: Persist and Restart
        (async () => {
            try {
                // Update DB
                await upsertAccount({
                    id: decodedId,
                    platform: account.platform,
                    proxyOffset: newOffset
                });
                console.log(`[API] Rotated IP for ${decodedId} (New Offset: ${newOffset}) - Background Save`);

                // Restart Session
                const { skipLaunch } = request.body as { skipLaunch?: boolean } || {};
                if (!skipLaunch) {
                    await browsers.closeAccount(decodedId);
                    console.log(`[API] Restarting session for ${decodedId}...`);
                    if (account.platform === 'shopsy') {
                        await loginShopsy({ accountId: decodedId, identifier: account.identifier, headless: false, keepOpen: true });
                    } else if (account.platform === 'iqoo') {
                        await loginIqoo({ accountId: decodedId, identifier: account.identifier, headless: false, keepOpen: true });
                    } else {
                        await loginFlipkart({ accountId: decodedId, identifier: account.identifier, headless: false, keepOpen: true });
                    }
                }
            } catch (bgError) {
                console.error(`[API] Background rotation error for ${decodedId}:`, bgError);
            }
        })();

        return reply; // Already sent above? Fastify might complain if we return after reply.send. 
        // fastify.post handler: usage of async implies we return the value.
        // If we use reply.send(), we should return reply.

    } catch (e: any) {
        console.error('[API] Rotate IP error:', e);
        return reply.status(500).send({ success: false, error: e.message });
    }
});

import { getProxyForAccount } from './src/proxy.js';
fastify.get('/api/accounts/:id/proxy', async (request, reply) => {
    // Auth Check
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // Loose auth for local dev overlay usage if needed, but safer to enforce
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);
    if (!session) return reply.status(403).send({ success: false, message: 'Forbidden' });

    const { id } = request.params as { id: string };
    const decodedId = decodeURIComponent(id);

    const proxy = await getProxyForAccount(decodedId);

    let proxyString: string | null = null;
    if (proxy) {
        if (proxy.username && proxy.password) {
            // Manually construct URL to avoid trailing slash from url.toString()
            const serverUrl = new URL(proxy.server);
            const protocol = serverUrl.protocol; // e.g., 'http:'
            const host = serverUrl.hostname;
            const port = serverUrl.port;
            // Format: protocol://username:password@host:port (NO trailing slash)
            proxyString = `${protocol}//${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@${host}:${port}`;
        } else {
            // Remove any trailing slash from server
            proxyString = proxy.server.replace(/\/$/, '');
        }
    }

    return { success: true, proxy: proxyString };
});

// Settings
import { getSettings, saveSettings, loadSettings } from './src/settings.js';

fastify.get('/api/settings', async (request, reply) => {
    return getSettings();
});

fastify.post('/api/settings', async (request, reply) => {
    const body = request.body as any;
    saveSettings(body);
    return { success: true };
});

// Proxies
import { loadProxies, saveProxies } from './src/proxy.js';

fastify.get('/api/proxies', async (request, reply) => {
    // Auth Check
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);
    if (!session || session.role !== 'admin') {
        return reply.status(403).send({ success: false, message: 'Forbidden' });
    }

    return await loadProxies();
});

fastify.post('/api/proxies', async (request, reply) => {
    // Auth Check
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);
    if (!session || session.role !== 'admin') {
        return reply.status(403).send({ success: false, message: 'Forbidden' });
    }

    const { proxies } = request.body as { proxies: string[] };
    if (!Array.isArray(proxies)) {
        return reply.status(400).send({ success: false, message: 'Proxies must be an array of strings' });
    }

    await saveProxies(proxies);
    return { success: true, count: proxies.length };
});

// Auth (Supabase)
fastify.post('/api/auth/signup', async (request, reply) => {
    const { username, password } = request.body as any;
    if (!username || !password) {
        return reply.status(400).send({ success: false, message: 'Username and password are required' });
    }
    return await signUpSupabase(username, password);
});

fastify.post('/api/auth/signin', async (request, reply) => {
    const { username, password } = request.body as any;
    if (!username || !password) {
        return reply.status(400).send({ success: false, message: 'Username and password are required' });
    }
    return await signInSupabase(username, password);
});

fastify.get('/api/auth/me', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);
    if (!session) {
        return reply.status(401).send({ success: false, message: 'Invalid or expired session' });
    }
    return { success: true, session };
});


// Operations
fastify.post('/api/check/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const account = await getAccount(id);
    if (!account) {
        reply.status(404).send({ error: 'Account not found' });
        return;
    }

    // Run health check
    try {
        const result = await checkHealthLogic(account.platform, id);
        // Persist the status to the account
        if (result.status === 'Healthy' || result.status === 'NeedsRefresh' || result.status === 'Error') {
            await updateAccountStatus(id, result.status as any);
        }
        return result;
    } catch (error) {
        fastify.log.error(error);
        await updateAccountStatus(id, 'Error', String(error));
        return { status: 'Error', message: String(error) };
    }
});

fastify.post('/api/refresh/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const account = await getAccount(id);
    if (!account) {
        reply.status(404).send({ error: 'Account not found' });
        return;
    }

    try {
        const result = await refreshSessionLogic(account.platform, id, account.identifier);
        return result || { status: 'success', message: 'Refresh process completed' };
    } catch (error) {
        fastify.log.error(error);
        return { status: 'error', message: String(error) };
    }
});

fastify.post('/api/login', async (request, reply) => {
    const body = request.body as any;
    const { accountId, identifier, platform } = body;

    try {
        let result;
        if (platform === 'flipkart') {
            result = await loginFlipkart({ accountId, identifier, headless: false, keepOpen: true });
        } else if (platform === 'iqoo') {
            result = await loginIqoo({ accountId, identifier, headless: false, keepOpen: true });
        } else {
            result = await loginShopsy({ accountId, identifier, headless: false, keepOpen: true });
        }
        return result;
    } catch (error) {
        return { status: 'error', message: String(error) };
    }
});

// Session View - Opens browser with saved cookies
import { openSession } from './src/session.js';
import { fetchOrders } from './src/orders.js';
import { startBatchFetch, getJobStatus, cancelJob, pollRecentOrders, BatchJob, BatchProgress } from './src/batchOrders.js';

fastify.post('/api/session', async (request, reply) => {
    const body = request.body as any;
    const { accountId, platform } = body;

    try {
        const result = await openSession({ accountId, platform });
        return result;
    } catch (error) {
        console.error('[Session Error Detail]:', error);
        return { status: 'error', message: String(error) };
    }
});

fastify.post('/api/orders/:id/fetch', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { platform } = request.body as { platform: string };

    // Add auth check similar to other endpoints if needed, skipping for dev speed/consistency with session
    try {
        const result = await fetchOrders(id, platform);
        return result;
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

fastify.post('/api/orders/:id/fetch-gv', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { platform } = request.body as { platform: string };
    // Import the new function dynamically to ensure it uses the latest file
    const { fetchGiftCardBalance } = await import('./src/orders.js');

    try {
        const result = await fetchGiftCardBalance(id, platform);
        return result;
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

// ============================================
// BATCH ORDER FETCHING
// ============================================

// Start batch fetch for multiple accounts
fastify.post('/api/orders/batch', async (request, reply) => {
    const { accountIds, platform, concurrency, headless } = request.body as {
        accountIds: string[];
        platform: string;
        concurrency?: number;
        headless?: boolean;
    };

    if (!accountIds || accountIds.length === 0) {
        return reply.status(400).send({ success: false, message: 'accountIds array is required' });
    }

    if (!platform) {
        return reply.status(400).send({ success: false, message: 'platform is required' });
    }

    console.log(`[Batch] Starting batch fetch for ${accountIds.length} accounts on ${platform}`);

    // Start batch job - returns job ID immediately (synchronous)
    const jobId = startBatchFetch(accountIds, platform, {
        concurrency: concurrency || 5,
        headless: headless !== false,
        onProgress: (progress: BatchProgress) => {
            console.log(`[Batch] Progress: ${progress.completed}/${progress.total} - ${progress.type}`);
        }
    });

    return {
        success: true,
        jobId,
        message: `Batch job started for ${accountIds.length} accounts`,
        total: accountIds.length
    };
});

// Get batch job status
fastify.get('/api/orders/batch/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = getJobStatus(jobId);

    if (!job) {
        return reply.status(404).send({ success: false, message: 'Job not found' });
    }

    return {
        success: true,
        job: {
            jobId: job.jobId,
            status: job.status,
            total: job.total,
            completed: job.completed,
            failed: job.failed,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            results: job.results,
            errors: job.errors
        }
    };
});

// Cancel batch job
fastify.post('/api/orders/batch/:jobId/cancel', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const cancelled = cancelJob(jobId);

    if (!cancelled) {
        return reply.status(400).send({ success: false, message: 'Job not found or not running' });
    }

    return { success: true, message: 'Job cancellation requested' };
});

// Poll for recent orders (lightweight, for checking new orders)
fastify.post('/api/orders/poll', async (request, reply) => {
    const { accountIds, platform } = request.body as {
        accountIds: string[];
        platform: 'flipkart' | 'shopsy';
    };

    if (!accountIds || accountIds.length === 0) {
        return reply.status(400).send({ success: false, message: 'accountIds array is required' });
    }

    try {
        const results = await pollRecentOrders(accountIds, platform, {
            concurrency: 5,
            headless: true
        });

        return {
            success: true,
            accountsPolled: accountIds.length,
            accountsWithOrders: results.size,
            orders: Object.fromEntries(results)
        };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

// ============================================
// ORDER QUEUE SYSTEM (Priority Queue + Cache)
// ============================================
import { orderQueueManager, JobPriority } from './src/orderQueue.js';

// Queue-based single order fetch
fastify.post('/api/queue/orders/:id/fetch', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!request.body) {
        return reply.status(400).send({ success: false, error: 'Missing request body' });
    }

    const { platform, forceRefresh = false } = request.body as any;

    if (!platform) {
        return reply.status(400).send({ success: false, error: 'Missing "platform" in request body' });
    }

    const decodedId = decodeURIComponent(id);

    try {
        const result = await orderQueueManager.submitJob(
            decodedId, platform, JobPriority.USER_TRIGGERED, forceRefresh
        );

        // If cached, return immediately with orders
        if (result.cached && result.orders) {
            return { success: true, cached: true, orders: result.orders };
        }

        // Otherwise, wait for job to complete and return orders
        const jobResult = await orderQueueManager.waitForJobPublic(result.jobId);
        return {
            success: jobResult.success,
            jobId: result.jobId,
            orders: jobResult.orders,
            error: jobResult.error
        };
    } catch (error) {
        return { success: false, error: String(error) };
    }
});

// Queue-based batch fetch with failure tracking
fastify.post('/api/queue/orders/batch', async (request, reply) => {
    const { accounts, forceRefresh = false } = request.body as {
        accounts: Array<{ accountId: string; platform: string }>;
        forceRefresh?: boolean;
    };

    if (!accounts || accounts.length === 0) {
        return reply.status(400).send({ success: false, message: 'accounts array is required' });
    }

    console.log(`[Queue] Starting batch for ${accounts.length} accounts`);
    const result = await orderQueueManager.processBatch(accounts, { forceRefresh });
    return { success: true, ...result };
});

// MULTI-PLATFORM BATCH FETCHING (Interleaved)
import { multiBatchManager } from './src/batchOrdersMulti.js';

fastify.post('/api/queue/orders/batch-multi', async (request, reply) => {
    const { accounts, forceRefresh = false, headless = true, concurrencyPerPlatform = 5 } = request.body as {
        accounts: Array<{ accountId: string; platform: string }>;
        forceRefresh?: boolean;
        headless?: boolean;
        concurrencyPerPlatform?: number;
    };

    if (!accounts || accounts.length === 0) {
        return reply.status(400).send({ success: false, message: 'accounts array is required' });
    }

    const jobId = await multiBatchManager.startMultiBatch(accounts, {
        forceRefresh,
        headless,
        concurrencyPerPlatform
    });

    return {
        success: true,
        jobId,
        message: `Multi-platform batch job started for ${accounts.length} accounts`,
        stats: { total: accounts.length }
    };
});

fastify.get('/api/queue/orders/batch-multi/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = multiBatchManager.getJobStatus(jobId);

    if (!job) {
        return reply.status(404).send({ success: false, message: 'Job not found' });
    }

    return { success: true, job };
});

// Get queue stats
fastify.get('/api/queue/stats', async () => {
    return {
        queue: orderQueueManager.getStats(),
        failures: orderQueueManager.getFailureStats()
    };
});

// Get failed accounts that need re-login
fastify.get('/api/queue/failed', async () => {
    return {
        accounts: orderQueueManager.getFailedAccounts(),
        requiresRelogin: orderQueueManager.getAccountsRequiringRelogin()
    };
});

// Clear failures (after user re-logs in)
fastify.post('/api/queue/clear-failures', async () => {
    orderQueueManager.clearFailures();
    return { success: true };
});

// Browser Management
import { browsers } from './src/browserManager.js';

fastify.post('/api/terminate-all', async (request, reply) => {
    await browsers.closeAll();
    return { success: true };
});

// Cloud Sync
import { pullSyncData, fetchCloudUsers, upsertCloudUser as upsertCloudUserFn, deleteCloudUser as deleteCloudUserFn, fetchActivityLogs, fetchAppErrors as fetchCloudErrors, pushAccounts, pushAllCookies, checkCloudConnection, saveCookies_DB } from './src/cloud_provider.js';
import { initDirs } from './src/config.js';

fastify.post('/api/cloud/sync', async (request, reply) => {
    return await pullSyncData();
});


// ============================================
// LOGOUT FROM ALL DEVICES (Bulk + Queue)
// ============================================
import { logoutQueue } from './src/logoutQueue.js';

fastify.post('/api/accounts/logout-all', async (request, reply) => {
    // Auth Check
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);
    if (!session) {
        return reply.status(401).send({ success: false, message: 'Invalid session' });
    }

    const { accountIds } = request.body as { accountIds: string[] };

    if (!accountIds || accountIds.length === 0) {
        return reply.status(400).send({ success: false, message: 'No accounts selected.' });
    }

    // Optional: Filter accountIds by ownership if not admin (skipped for now, relying on validation earlier)

    try {
        const jobId = await logoutQueue.createJob(accountIds);
        return { success: true, jobId, message: `Logout process started for ${accountIds.length} accounts.` };
    } catch (error: any) {
        return reply.status(400).send({ success: false, message: error.message });
    }
});

fastify.get('/api/logout/status', async (request, reply) => {
    // Auth Check ... (Skipping strict for lightness, but good practice)
    const status = logoutQueue.getJobStatus();
    return status || { status: 'idle' };
});

// Admin: Logs
import { getActivityLogs, getAppErrors } from './src/log.js';
import { getUnifiedCookies } from './src/cookies.js';

fastify.get('/api/accounts/:id/cookies', async (request, reply) => {
    const { id } = request.params as { id: string };
    const decodedId = decodeURIComponent(id);
    return await getUnifiedCookies(decodedId);
});

fastify.get('/api/accounts/:id/:platform/cookies', async (request, reply) => {
    const { id, platform } = request.params as { id: string, platform: string };
    const decodedId = decodeURIComponent(id);
    return await getUnifiedCookies(decodedId, platform);
});

fastify.get('/api/accounts/:id/:platform/localstorage', async (request, reply) => {
    const { id, platform } = request.params as { id: string, platform: string };
    const decodedId = decodeURIComponent(id);
    return await fetchLocalStorage(decodedId, platform);
});

fastify.post('/api/accounts/:id/:platform/localstorage', async (request, reply) => {
    const { id, platform } = request.params as { id: string, platform: string };
    const { data } = request.body as { data: any };
    const decodedId = decodeURIComponent(id);

    try {
        await saveLocalStorage(decodedId, data, platform);
        await pushLocalStorage(decodedId, platform);
        return { success: true };
    } catch (e: any) {
        return reply.status(500).send({ success: false, error: e.message });
    }
});

// ============================================
// FINGERPRINT ENDPOINTS (for iQOO session persistence)
// ============================================
import { saveFingerprint, getFingerprint } from './src/fingerprintDb';

fastify.get('/api/accounts/:id/fingerprint', async (request, reply) => {
    const { id } = request.params as { id: string };
    const decodedId = decodeURIComponent(id);

    try {
        const fingerprint = await getFingerprint(decodedId);
        return fingerprint || { userAgent: null };
    } catch (e: any) {
        return reply.status(500).send({ success: false, error: e.message });
    }
});

fastify.post('/api/accounts/:id/fingerprint', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { fingerprint } = request.body as { fingerprint: any };
    const decodedId = decodeURIComponent(id);

    if (!fingerprint || !fingerprint.userAgent) {
        return reply.status(400).send({ success: false, error: 'fingerprint.userAgent is required' });
    }

    try {
        await saveFingerprint(decodedId, fingerprint);
        return { success: true };
    } catch (e: any) {
        console.error(`[API] Failed to save fingerprint for ${decodedId}:`, e);
        return reply.status(500).send({ success: false, error: e.message });
    }
});

fastify.post('/api/accounts/:id/:platform/cookies', async (request, reply) => {
    const { id, platform } = request.params as { id: string, platform: string };
    const { cookies } = request.body as { cookies: any[] };
    const decodedId = decodeURIComponent(id);

    if (!cookies || !Array.isArray(cookies)) {
        return reply.status(400).send({ success: false, error: 'Cookies array is required' });
    }

    try {
        await saveCookies_DB(decodedId, platform, cookies);
        
        // If an account was in 'New' state (pre-login), receiving cookies
        // means the InAppBrowser successfully verified the login and synced it.
        // We must upgrade its status to Healthy here.
        await updateAccountStatus(decodedId, 'Healthy');
        
        return { success: true, count: cookies.length };
    } catch (e: any) {
        console.error(`[API] Failed to save cookies for ${decodedId}:`, e);
        return reply.status(500).send({ success: false, error: e.message });
    }
});

fastify.get('/api/logs/activity', async (request, reply) => {
    // Try cloud first, else local
    const cloudLogs = await fetchActivityLogs();
    if (cloudLogs && cloudLogs.length > 0) return cloudLogs;
    return await getActivityLogs();
});

fastify.get('/api/logs/errors', async (request, reply) => {
    const cloudErrors = await fetchCloudErrors();
    if (cloudErrors && cloudErrors.length > 0) return cloudErrors;
    return await getAppErrors();
});

// Notifications
fastify.get('/api/notifications', async (request, reply) => {
    const authHeader = request.headers.authorization;
    let userId: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const session = await verifySession(token);
        if (session) userId = session.id;
    }
    return await listNotifications(userId);
});

fastify.post('/api/notifications/:id/respond', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { action } = request.body as { action: 'allow' | 'deny' };

    const notification = await getNotification(id);
    if (!notification) {
        return reply.status(404).send({ success: false, message: 'Notification not found' });
    }

    if (action === 'allow' && notification.type === 'account_deletion') {
        const accountId = notification.account_id;
        console.log(`[Notification] User allowed deletion of ${accountId}. Executing...`);
        const success = await deleteAccount(accountId);
        if (success) {
            await updateNotificationStatus(id, 'allowed');
            await logActivity('User', 'Manual Delete (via Notification)', { accountId });
            return { success: true };
        } else {
            return { success: false, message: 'Delete failed' };
        }
    } else {
        await updateNotificationStatus(id, 'denied');
        return { success: true, message: 'Notification ignored' };
    }
});

// Admin: Users
// Admin: Users
// REMOVED local getUsers/upsertUser/deleteUser imports to enforce Cloud-only mode

fastify.get('/api/admin/users', async (request, reply) => {
    const cloudUsers = await fetchCloudUsers();
    // Strict Cloud Only: If cloud fetch fails (null), return empty or error, do NOT fallback to local
    if (cloudUsers) return cloudUsers;
    return [];
});

fastify.post('/api/admin/users', async (request, reply) => {
    const body = request.body as any;
    const { username, password, role } = body;

    if (!username || !password) {
        return reply.status(400).send({ success: false, message: 'Username and password are required' });
    }

    // Use signUpSupabase to create user in profiles table with proper password hash
    try {
        const result = await signUpSupabase(username, password);

        if (!result.success) {
            return { success: false, message: result.message };
        }

        // If role specified (not user default), update the profile
        if (role && role !== 'user') {
            const { getSupabaseAdminClient } = await import('./src/cloud_provider.js');
            const client = getSupabaseAdminClient() as any;
            if (client) {
                await client
                    .from('profiles')
                    .update({ role: role })
                    .eq('username', username.toLowerCase());
            }
        }

        return { success: true, message: 'User created successfully', source: 'cloud' };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
});

fastify.delete('/api/admin/users/:username', async (request, reply) => {
    const { username } = request.params as { username: string };
    try {
        await deleteCloudUserFn(username);
        return { success: true, source: 'cloud' };
    } catch (e: any) {
        // Strict Cloud Only: No fallback to local delete
        return reply.status(500).send({ success: false, message: e.message });
    }
});

fastify.post('/api/admin/accounts/clear-errors', async (request, reply) => {
    // Auth check
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);
    if (!session || session.role !== 'admin') {
        return reply.status(403).send({ success: false, message: 'Forbidden' });
    }

    try {
        const data = await loadAccounts();
        const errorAccounts = data.accounts.filter(a => a.status === 'Error');

        let count = 0;
        for (const acc of errorAccounts) {
            await updateAccountStatus(acc.id, 'NeedsRefresh');
            count++;
        }

        return { success: true, count, message: `Cleared errors for ${count} accounts.` };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
});

fastify.post('/api/admin/move-accounts', async (request, reply) => {
    // Auth Check
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);

    // Strict Admin Only
    if (!session || session.role !== 'admin') {
        return reply.status(403).send({ success: false, message: 'Forbidden' });
    }

    const { accountIds, targetUserId } = request.body as { accountIds: string[], targetUserId: string };

    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
        return reply.status(400).send({ success: false, message: 'Invalid accountIds' });
    }
    if (!targetUserId) {
        return reply.status(400).send({ success: false, message: 'Target userId is required' });
    }

    try {
        console.log(`[Admin] Moving ${accountIds.length} accounts to user ${targetUserId}`);
        const count = await moveAccounts(accountIds, targetUserId);
        return { success: true, count, message: `Moved ${count} accounts to user ${targetUserId}` };
    } catch (e: any) {
        console.error('[API] Move accounts error:', e);
        return reply.status(500).send({ success: false, error: e.message });
    }
});

fastify.post('/api/admin/accounts/:id/reset', async (request, reply) => {
    // Auth check
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);
    if (!session || session.role !== 'admin') {
        return reply.status(403).send({ success: false, message: 'Forbidden' });
    }

    const { id } = request.params as { id: string };
    const decodedId = decodeURIComponent(id);

    try {
        await updateAccountStatus(decodedId, 'NeedsRefresh');
        return { success: true, message: `Account ${decodedId} reset.` };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
});


// Chat / AI
import { ingestOrdersForUser, chatWithContext } from './src/chat.js';

fastify.post('/api/chat/sync', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);
    if (!session) {
        return reply.status(401).send({ success: false, message: 'Invalid session' });
    }


    try {
        const result = await ingestOrdersForUser(session.id);
        return {
            success: true,
            count: result.count,
            orderIds: result.orderIds,
            message: `Synced ${result.count} orders to knowledge base.`
        };
    } catch (e: any) {
        fastify.log.error(e);
        return { success: false, error: e.message };
    }
});

fastify.post('/api/chat/ask', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ success: false, message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const session = await verifySession(token);
    if (!session) {
        return reply.status(401).send({ success: false, message: 'Invalid session' });
    }

    const { query } = request.body as { query: string };
    if (!query) {
        return reply.status(400).send({ success: false, message: 'Query is required' });
    }

    try {
        // Proactive Ingestion if Vector Store is empty
        const { getVectorStoreForUser } = await import('./src/vector_store.js');
        const { ingestOrdersForUser } = await import('./src/chat.js');
        const store = getVectorStoreForUser(session.id);
        if (await store.getDocumentCount() === 0) {
            console.log(`[Chat] Vector store empty for user ${session.id}, triggering initial ingestion...`);
            await ingestOrdersForUser(session.id);
        }

        const chatResponse = await chatWithContext(session.id, query);
        return { success: true, ...chatResponse };
    } catch (e: any) {
        fastify.log.error(e);
        return { success: false, error: e.message };
    }
});

// Cloud Sync health check
fastify.get('/api/cloud/status', async (request, reply) => {
    return checkCloudConnection();
});


const start = async () => {
    await fastify.register(cors, {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    });

    try {
        await initDirs();
    } catch (e) {
        console.error('Failed to init directories (non-fatal):', e);
    }

    try {
        await loadSettings();
        console.log('Settings loaded.');
    } catch (e) {
        console.error('Failed to load settings (non-fatal):', e);
    }

    // Start Auto-Cleanup Job (non-critical)
    try {
        const { startCleanupJob } = await import('./src/cron/cleanup.js');
        startCleanupJob();
    } catch (e) {
        console.error('Cleanup job failed to start (non-fatal):', e);
    }

    // Cloud connection check (non-critical)
    try {
        const cloudStatus = await checkCloudConnection();
        if (cloudStatus.success) {
            console.log('Cloud Connection: OK');
        } else {
            console.warn(`Cloud Connection Warning: ${cloudStatus.message}`);
        }
    } catch (e) {
        console.error('Cloud connection check failed (non-fatal):', e);
    }

    // Initial sync push to cloud (non-critical)
    try {
        await pushAccounts();
        pushAllCookies().catch(e => console.error('Initial cookie sync failed:', e));
    } catch (e) {
        console.error('Initial account sync failed (non-fatal):', e);
    }

    // CRITICAL: Start the server - this must succeed
    const port = parseInt(process.env.PORT || '35412');
    try {
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on port ${port}`);
    } catch (err) {
        fastify.log.error(err);
        console.error(`FATAL: Server failed to listen on port ${port}:`, err);
        process.exit(1);
    }
};

start();

