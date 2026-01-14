import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs-extra';
import path from 'path';
import { getSettings } from './settings.js';
import { ACCOUNTS_FILE } from './config.js';
import { getCookieFilePath } from './cookies.js';
import logger from './log.js';

let supabase: SupabaseClient | null = null;

/**
 * Initialize Supabase client if enabled
 */
export function getSupabase() {
    const settings = getSettings();
    if (!settings.cloudConfig?.enabled || !settings.cloudConfig.url || !settings.cloudConfig.key) {
        return null;
    }

    if (!supabase) {
        supabase = createClient(settings.cloudConfig.url, settings.cloudConfig.key);
    }
    return supabase;
}

/**
 * Push accounts.json to cloud
 */
export async function pushAccounts() {
    const client = getSupabase();
    if (!client) return;

    try {
        const data = await fs.readJSON(ACCOUNTS_FILE);
        // We use a simple 'settings' table or bucket. 
        // For simplicity, let's assume a 'sync_data' bucket.
        const { error } = await client.storage
            .from('sync_data')
            .upload('accounts.json', JSON.stringify(data), {
                upsert: true,
                contentType: 'application/json'
            });

        if (error) throw error;
        logger.info('[Cloud] Accounts synced successfully.');
    } catch (e: any) {
        logger.error(`[Cloud] Sync push failed: ${e.message}`);
    }
}

/**
 * Push specific cookie file to cloud
 */
export async function pushCookies(accountId: string, platform: 'flipkart' | 'shopsy') {
    const client = getSupabase();
    if (!client) return;

    try {
        const filePath = getCookieFilePath(accountId, platform);
        if (!await fs.pathExists(filePath)) return;

        const data = await fs.readJSON(filePath);
        const remotePath = `cookies/${accountId}_${platform}.json`;

        const { error } = await client.storage
            .from('sync_data')
            .upload(remotePath, JSON.stringify(data), {
                upsert: true,
                contentType: 'application/json'
            });

        if (error) throw error;
        logger.info(`[Cloud] Cookies for ${accountId} (${platform}) synced.`);
    } catch (e: any) {
        logger.error(`[Cloud] Cookie sync failed: ${e.message}`);
    }
}

/**
 * Pull all data from cloud (for new device setup)
 */
export async function pullSyncData() {
    const client = getSupabase();
    if (!client) return { success: false, error: 'Cloud sync not enabled' };

    try {
        // 1. Pull Accounts
        const { data: accData, error: accError } = await client.storage
            .from('sync_data')
            .download('accounts.json');

        if (accError) {
            logger.warn('[Cloud] No accounts.json found in cloud.');
        } else {
            const json = JSON.parse(await accData.text());
            await fs.writeJSON(ACCOUNTS_FILE, json, { spaces: 2 });
            logger.info('[Cloud] Accounts pulled and restored.');
        }

        // 2. Pull Cookies (Batch)
        const { data: files, error: listError } = await client.storage
            .from('sync_data')
            .list('cookies');

        if (listError) throw listError;

        for (const file of files || []) {
            const { data: cookieBlob, error: downloadError } = await client.storage
                .from('sync_data')
                .download(`cookies/${file.name}`);

            if (downloadError) continue;

            const localPath = path.join(path.dirname(getCookieFilePath('dummy', 'flipkart')), file.name);
            await fs.writeJSON(localPath, JSON.parse(await cookieBlob.text()), { spaces: 2 });
        }

        logger.info(`[Cloud] Restored ${files?.length || 0} cookie files.`);
        return { success: true };
    } catch (e: any) {
        logger.error(`[Cloud] Sync pull failed: ${e.message}`);
        return { success: false, error: e.message };
    }
}

/**
 * Log user activity to Supabase
 */
export async function logActivity(username: string, action: string, data: any = {}) {
    const client = getSupabase();
    if (!client) return;

    try {
        const deviceInfo = {
            os: process.platform,
            arch: process.arch,
            hostname: require('os').hostname()
        };

        await client.from('activity_logs').insert({
            username,
            action,
            platform: data.platform || null,
            account_id: data.accountId || null,
            device_info: deviceInfo,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.error('[Cloud] Failed to log activity:', e);
    }
}

/**
 * Report error to Supabase
 */
export async function reportError(username: string, message: string, stack?: string, context: any = {}) {
    const client = getSupabase();
    if (!client) return;

    try {
        const deviceInfo = {
            os: process.platform,
            arch: process.arch,
            hostname: require('os').hostname()
        };

        await client.from('app_errors').insert({
            username,
            message,
            stack,
            context: { ...context, deviceInfo },
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.error('[Cloud] Failed to report error:', e);
    }
}

/**
 * Fetch centralized users from Supabase
 */
export async function fetchCloudUsers() {
    const client = getSupabase();
    if (!client) return null;

    try {
        const { data, error } = await client.from('app_users').select('*');
        if (error) throw error;
        return data;
    } catch (e) {
        logger.error(`[Cloud] Failed to fetch users: ${e}`);
        return null;
    }
}

/**
 * Upsert user in Supabase (Admin Only)
 */
export async function upsertCloudUser(user: any) {
    const client = getSupabase();
    if (!client) return;
    const { error } = await client.from('app_users').upsert(user);
    if (error) throw error;
}

/**
 * Delete user from Supabase
 */
export async function deleteCloudUser(username: string) {
    const client = getSupabase();
    if (!client) return;
    const { error } = await client.from('app_users').delete().eq('username', username);
    if (error) throw error;
}

/**
 * Fetch recent activity logs from Supabase
 */
export async function fetchActivityLogs() {
    const client = getSupabase();
    if (!client) return [];

    try {
        const { data, error } = await client
            .from('activity_logs')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(100);
        if (error) throw error;
        return data;
    } catch (e) {
        logger.error(`[Cloud] Failed to fetch activity logs: ${e}`);
        return [];
    }
}

/**
 * Fetch recent app errors from Supabase
 */
export async function fetchAppErrors() {
    const client = getSupabase();
    if (!client) return [];

    try {
        const { data, error } = await client
            .from('app_errors')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(100);
        if (error) throw error;
        return data;
    } catch (e) {
        logger.error(`[Cloud] Failed to fetch app errors: ${e}`);
        return [];
    }
}
