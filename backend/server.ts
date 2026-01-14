
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadAccounts, getAccount, upsertAccount, deleteAccount, updateAccountStatus } from './src/accounts.js';
// Re-export required functions if they are not directly exported or if path logic differs, 
// but here we import directly from the restored src files.
// Note: We need to ensure src/accounts.ts exports everything we need. 
// It does: loadAccounts, checkAccountHealth (wait, checkAccountHealth is in src/check/health.ts), refreshSession (src/refresh/flow.ts).
// I need to import them from correct paths.

import { checkAccountHealth as checkHealthLogic } from './src/check/health.js';
import { refreshSession as refreshSessionLogic } from './src/refresh/flow.js';
import { loginFlipkart } from './src/login/flipkart.js';
import { loginShopsy } from './src/login/shopsy.js';

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
    origin: '*', // Allow all for local desktop app
});

// Health check
fastify.get('/api/health', async (request, reply) => {
    return { status: 'ok', version: '1.2.0' };
});

// Accounts
fastify.get('/api/accounts', async (request, reply) => {
    const data = await loadAccounts();
    return data;
});

fastify.post('/api/accounts', async (request, reply) => {
    const body = request.body as any;
    const account = await upsertAccount(body);
    return account;
});

fastify.delete('/api/accounts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await deleteAccount(id);
    return { success: result };
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

fastify.post('/api/session', async (request, reply) => {
    const body = request.body as any;
    const { accountId, platform } = body;

    try {
        const result = await openSession({ accountId, platform });
        return result;
    } catch (error) {
        return { status: 'error', message: String(error) };
    }
});

// Browser Management
import { browsers } from './src/browserManager.js';

fastify.post('/api/terminate-all', async (request, reply) => {
    await browsers.closeAll();
    return { success: true };
});

// Cloud Sync
import { pullSyncData, fetchCloudUsers, upsertCloudUser as upsertCloudUserFn, deleteCloudUser as deleteCloudUserFn, fetchActivityLogs, fetchAppErrors as fetchCloudErrors, pushAccounts, pushAllCookies, checkCloudConnection } from './src/cloud.js';
import { initDirs } from './src/config.js';

fastify.post('/api/cloud/sync', async (request, reply) => {
    return await pullSyncData();
});


// Admin: Logs
import { getActivityLogs, getAppErrors } from './src/log.js';
import { loadCookiesFromDisk } from './src/cookies.js';

fastify.get('/api/accounts/:id/:platform/cookies', async (request, reply) => {
    const { id, platform } = request.params as { id: string, platform: 'flipkart' | 'shopsy' };
    return await loadCookiesFromDisk(id, platform);
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

// Admin: Users
import { getUsers, upsertUser, deleteUser } from './src/users.js';

fastify.get('/api/admin/users', async (request, reply) => {
    const cloudUsers = await fetchCloudUsers();
    if (cloudUsers) return cloudUsers;
    return await getUsers();
});

fastify.post('/api/admin/users', async (request, reply) => {
    const body = request.body as any;
    // Try to save to cloud if possible, also save local as backup? 
    // Or just prefer cloud. 
    try {
        await upsertCloudUserFn(body);
        return { success: true, source: 'cloud' };
    } catch (e) {
        return await upsertUser(body);
    }
});

fastify.delete('/api/admin/users/:username', async (request, reply) => {
    const { username } = request.params as { username: string };
    try {
        await deleteCloudUserFn(username);
        return { success: true, source: 'cloud' };
    } catch (e) {
        return { success: await deleteUser(username) };
    }
});

// Cloud Sync health check
fastify.get('/api/cloud/status', async (request, reply) => {
    return checkCloudConnection();
});

const start = async () => {
    try {
        await initDirs();
        await loadSettings();
        console.log('Settings loaded.');

        const cloudStatus = await checkCloudConnection();
        if (cloudStatus.success) {
            console.log('Cloud Connection: OK');
        } else {
            console.warn(`Cloud Connection Warning: ${cloudStatus.message}`);
        }

        const port = parseInt(process.env.PORT || '3001');
        // Initial sync push to cloud
        pushAccounts().catch(e => console.error('Initial account sync failed:', e));
        pushAllCookies().catch(e => console.error('Initial cookie sync failed:', e));

        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on port ${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
