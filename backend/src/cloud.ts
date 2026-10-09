import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs-extra';
import path from 'path';
import { getSettings } from './settings.js';
import { ACCOUNTS_FILE } from './config.js';
import { getCookieFilePath } from './cookies.js';
import { getStorageFilePath } from './localStorage.js';
import logger from './log.js';

let supabaseClient: SupabaseClient | null = null;
let supabaseAdminClient: SupabaseClient | null = null;

// Helper to get config
function getSupabaseConfig() {
    const settings = getSettings();

    // URL
    const envUrl = process.env.SUPABASE_URL;
    const url = envUrl || settings.cloudConfig?.url;

    // Keys
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLIC_KEY || process.env.SUPABASE_PUBLISHABLE_DEFAULT_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Enabled check
    // We consider it enabled if we have a URL and at least one key
    const enabled = settings.cloudConfig?.enabled !== false && (!!url && (!!anonKey || !!serviceRoleKey));

    return { url, anonKey, serviceRoleKey, enabled };
}

/**
 * Get Supabase Client (Anon/Public) - Use for Auth & User User operations
 */
export function getSupabaseClient() {
    const { url, anonKey, enabled } = getSupabaseConfig();

    if (!enabled || !url || !anonKey) {
        // Silent fail or warn depending on context? 
        // If we need auth but don't have anon key, it's an issue.
        if (enabled && url && !anonKey) {
            logger.warn('[Cloud] Supabase Anon Key is missing. Auth flows may fail.');
        }
        return null;
    }

    if (!supabaseClient) {
        try {
            const keyUsed = anonKey;
            const maskedKey = keyUsed ? (keyUsed.substring(0, 5) + '...' + keyUsed.substring(keyUsed.length - 5)) : 'NONE';
            logger.info(`[Cloud] Supabase Anon Client initializing with URL: ${url} and Key: ${maskedKey}`);

            supabaseClient = createClient(url, anonKey);
            logger.info(`[Cloud] Supabase Anon Client initialized.`);
        } catch (e: any) {
            logger.error(`[Cloud] Failed to initialize Supabase Anon Client: ${e.message}`);
            return null;
        }
    }
    return supabaseClient;
}

/**
 * Get Supabase Admin Client (Service Role) - Use for Data Sync & Admin operations
 */
export function getSupabaseAdminClient() {
    const { url, serviceRoleKey, enabled } = getSupabaseConfig();

    if (!enabled || !url || !serviceRoleKey) {
        if (enabled && url && !serviceRoleKey) {
            logger.warn('[Cloud] Supabase Service Role Key is missing. Sync flows will fail.');
        }
        return null;
    }

    if (!supabaseAdminClient) {
        try {
            supabaseAdminClient = createClient(url, serviceRoleKey, {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            });
            logger.info(`[Cloud] Supabase Admin Client initialized.`);
        } catch (e: any) {
            logger.error(`[Cloud] Failed to initialize Supabase Admin Client: ${e.message}`);
            return null;
        }
    }
    return supabaseAdminClient;
}

/**
 * Legacy accessor - Defaults to Admin client for backward compatibility in this file context,
 * but specifically for Auth it should NOT be used.
 * @deprecated Use getSupabaseClient() or getSupabaseAdminClient() explicitly.
 */
export function getSupabase() {
    return getSupabaseAdminClient() || getSupabaseClient();
}

/**
 * Health check for Supabase connection & tables
 * Uses Admin access to check table existence reliably
 */
export async function checkCloudConnection() {
    const client = getSupabaseAdminClient();
    if (!client) return { success: false, message: 'Cloud sync (Admin) not configured.' };

    try {
        // More robust check: try to select one row from accounts
        const { error } = await client.from('accounts').select('*').limit(1);
        if (error) {
            // Check for specific "table not found" error
            if (error.code === '42P01' || error.message.includes('schema cache')) {
                return { success: false, message: 'Supabase connected, but "accounts" table is missing. Did you run the SQL schema?' };
            }
            throw error;
        }
        return { success: true, message: 'Supabase connection healthy and tables found.' };
    } catch (e: any) {
        return { success: false, message: `Cloud connection failed: ${e.message}` };
    }
}

/**
 * Push a single account to cloud
 */
export async function pushAccount(acc: any) {
    const client = getSupabaseAdminClient();
    if (!client) return;

    try {
        // Build details object with optional fields
        const details: any = {
            loginType: acc.loginType,
            emailConfig: acc.emailConfig,
            assignedTo: acc.assignedTo,
            createdAt: acc.createdAt,
            updatedAt: acc.updatedAt,
            errorCode: acc.errorCode
        };
        if (acc.proxy) details.proxy = acc.proxy;
        if (acc.lastLoginAt) details.lastLoginAt = acc.lastLoginAt;

        // Use only core columns that definitely exist in the schema
        const payload: any = {
            id: acc.id.toLowerCase(),
            platform: acc.platform,
            identifier: acc.identifier,
            status: acc.status,
            details: details,
            updated_at: new Date().toISOString()
        };

        if (acc.userId) {
            payload.user_id = acc.userId;
        }

        // logger.debug(`[Cloud] Pushing account payload: ${JSON.stringify(payload)}`);

        const { error } = await client
            .from('accounts')
            .upsert(payload, { onConflict: 'id' });

        if (error) throw error;
        logger.debug(`[Cloud] Synced single account: ${acc.id}`);
    } catch (e: any) {
        logger.error(`[Cloud] pushAccount failed for ${acc.id}: ${e.message}`);
    }
}

/**
 * Fetch all accounts from cloud database with optional filtering
 */
export async function fetchAccountsFromCloud(userId?: string): Promise<any[]> {
    const client = getSupabaseAdminClient();
    if (!client) {
        logger.warn('[Cloud] fetchAccountsFromCloud: Cloud not configured');
        return [];
    }

    try {
        let allDbAccounts: any[] = [];
        let from = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
            let query = client
                .from('accounts')
                .select('*');
            
            if (userId) {
                if (userId === 'unassigned') {
                    query = query.is('user_id', null);
                } else {
                    query = query.eq('user_id', userId);
                }
            }

            const { data: dbPage, error } = await query
                .range(from, from + limit - 1);

            if (error) throw error;

            if (dbPage && dbPage.length > 0) {
                allDbAccounts = allDbAccounts.concat(dbPage);
                from += limit;
                if (dbPage.length < limit) {
                    hasMore = false;
                }
            } else {
                hasMore = false;
            }
        }

        if (allDbAccounts.length > 0) {
            // Map DB format to Account format
            const accounts = allDbAccounts.map((row: any) => ({
                id: row.id,
                userId: row.user_id,
                platform: row.platform,
                identifier: row.identifier,
                status: row.status,
                lastLoginAt: row.last_login_at,
                proxy: row.proxy,
                // Spread details back
                ...(row.details || {})
            }));
            logger.info(`[Cloud] Fetched ${accounts.length} accounts from DB`);
            return accounts;
        }
        return [];
    } catch (e: any) {
        logger.error(`[Cloud] fetchAccountsFromCloud failed: ${e.message}`);
        return [];
    }
}

/**
 * Fetch single account from cloud database
 */
export async function fetchAccountFromCloud(accountId: string): Promise<any | null> {
    const client = getSupabaseAdminClient();
    if (!client) return null;

    try {
        const { data: row, error } = await client
            .from('accounts')
            .select('*')
            .eq('id', accountId.toLowerCase())
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (row) {
            return {
                id: row.id,
                userId: row.user_id,
                platform: row.platform,
                identifier: row.identifier,
                status: row.status,
                lastLoginAt: row.last_login_at,
                proxy: row.proxy,
                ...(row.details || {})
            };
        }
        return null;
    } catch (e: any) {
        logger.error(`[Cloud] fetchAccountFromCloud failed for ${accountId}: ${e.message}`);
        return null;
    }
}

/**
 * Delete account from cloud database
 */
export async function deleteAccountFromCloud(accountId: string): Promise<boolean> {
    const client = getSupabaseAdminClient();
    if (!client) return false;

    try {
        const id = accountId.toLowerCase();

        // Delete all associated data in parallel for speed
        await Promise.all([
            client.from('cookies').delete().eq('account_id', id),
            client.from('local_storage').delete().eq('account_id', id),
            client.from('fingerprints').delete().eq('account_id', id)
        ]);

        // Delete account record last
        const { error } = await client.from('accounts').delete().eq('id', id);

        if (error) throw error;

        logger.info(`[Cloud] Deleted account ${id} (and all associated data) from DB`);
        return true;
    } catch (e: any) {
        logger.error(`[Cloud] deleteAccountFromCloud failed: ${e.message}`);
        return false;
    }
}

/**
 * @deprecated Legacy function - no longer used. Individual account operations now use pushAccount() directly.
 * This function was previously used to sync accounts.json to DB, but we no longer use local files.
 */
export async function pushAccounts() {
    // Deprecated - all account operations now use pushAccount() directly for DB writes
    logger.debug('[Cloud] pushAccounts: DEPRECATED - Use pushAccount() for individual account operations');
}

export async function saveAccountsToDB(data: any) {
    const client = getSupabaseAdminClient();
    if (!client) return;

    // Build details object with optional fields
    const details: any = data.details || {};
    if (data.proxy) details.proxy = data.proxy;
    if (data.lastLoginAt) details.lastLoginAt = data.lastLoginAt;

    // Use only core columns that definitely exist in the schema
    const payload: any = {
        id: data.id?.toLowerCase(),
        platform: data.platform,
        identifier: data.identifier,
        status: data.status,
        details: details,
        updated_at: new Date().toISOString()
    };

    // Only include user_id if present
    if (data.userId) {
        payload.user_id = data.userId;
    }

    try {
        const { error } = await client.from('accounts').upsert(payload, { onConflict: 'id' });
        if (error) throw error;
        logger.info(`[Cloud] Saved account ${data.id} to DB`);
    } catch (e: any) {
        logger.error(`[Cloud] saveAccountsToDB failed for ${data.id}: ${e.message}`);
        throw e;
    }
}

export async function saveCookies_DB(accountId: string, platform: string, cookies: any[]) {
    const client = getSupabaseAdminClient();
    if (!client) return;

    // 1. Delete existing cookies for this account & platform
    await client
        .from('cookies')
        .delete()
        .eq('account_id', accountId.toLowerCase())
        .eq('platform', platform);

    if (!cookies || cookies.length === 0) return;

    // 2. Prepare cookie rows
    const rows = cookies.map(c => ({
        account_id: accountId.toLowerCase(),
        platform: platform,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        http_only: c.httpOnly,
        expiration_date: c.expires || c.expirationDate,
        same_site: c.sameSite,
        session: c.session
    }));

    // 3. Insert new cookies
    const { error } = await client
        .from('cookies')
        .insert(rows);

    if (error) {
        console.error('Failed to save cookies:', error);
        throw error;
    }
}

/**
 * @deprecated Legacy function - no longer used. Cookie operations now use pushCookies() directly.
 * This function was previously used for initial sync from local files to DB.
 */
export async function pushAllCookies() {
    // Deprecated - cookies are now saved directly to DB via pushCookies() during login
    logger.debug('[Cloud] pushAllCookies: DEPRECATED - Cookies are synced directly to DB during login');
}

/**
 * Push specific cookie file to cloud (SQL Table: cookies)
 */
export async function pushCookies(accountId: string, platform: string, directCookies?: any[]) {
    const client = getSupabaseAdminClient();
    if (!client) return;

    try {
        let cookies = directCookies;
        if (!cookies) {
            const filePath = getCookieFilePath(accountId, platform);
            if (await fs.pathExists(filePath)) {
                cookies = await fs.readJSON(filePath);
            }
        }

        if (!cookies || !Array.isArray(cookies)) return;

        if (!cookies || !Array.isArray(cookies)) return;

        // 2. Insert new cookies using UPSERT to prevent data loss (merge)
        // Map playright/extension cookie format to DB schema
        let userId: string | null = null;
        try {
            const { data: accData } = await client
                .from('accounts')
                .select('user_id')
                .eq('id', accountId.toLowerCase())
                .maybeSingle();

            if (accData?.user_id) {
                userId = accData.user_id;
            }
        } catch (err) {
            // ignore
        }

        const rows = cookies.map((c: any) => ({
            account_id: accountId.toLowerCase(),
            platform: platform,
            user_id: userId, // Add user_id foreign key
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            http_only: c.httpOnly,
            // Handle both Playwright ('expires') and Extension ('expirationDate') formats
            expiration_date: c.expires || c.expirationDate,
            same_site: c.sameSite,
            host_only: c.hostOnly,
            session: c.session
        }));

        if (rows.length > 0) {
            try {
                // Upsert based on (account_id, platform, name, domain)
                // Assuming backend has unique constraint on these columns
                const { error: insError } = await client
                    .from('cookies')
                    .upsert(rows, { onConflict: 'account_id, platform, name, domain' });

                if (insError) throw insError;
                logger.info(`[Cloud] Upserted ${rows.length} cookies for ${accountId} (${platform}).`);
            } catch (err: any) {
                // FALLBACK: If upsert setup fails or schema issue
                if (err.message?.includes('user_id') || err.code === '42703') {
                    const fallbackRows = rows.map((r: any) => {
                        const { user_id, ...rest } = r;
                        return rest;
                    });
                    const { error: fallbackError } = await client
                        .from('cookies')
                        .upsert(fallbackRows, { onConflict: 'account_id, platform, name, domain' });

                    if (fallbackError) throw fallbackError;
                    logger.debug(`[Cloud] Upserted ${rows.length} cookies (no user_id).`);
                } else {
                    // Critical: If UPSERT is not supported or index missing, delete+insert is risky but fallback
                    logger.warn(`[Cloud] UPSERT failed (${err.message}). Falling back to Delete+Insert (Merge unsafe).`);
                    await client.from('cookies').delete().eq('account_id', accountId).eq('platform', platform);
                    await client.from('cookies').insert(rows);
                }
            }
        }
    } catch (e: any) {
        logger.error(`[Cloud] Cookie sync failed for ${accountId}: ${e.message}`);
    }
}

/**
 * Push Local Storage to cloud (SQL Table: local_storage)
 */
export async function pushLocalStorage(accountId: string, platform: string, directData?: Record<string, any>) {
    const client = getSupabaseAdminClient();
    if (!client) return;

    try {
        let data = directData;

        if (!data) {
            const filePath = getStorageFilePath(accountId, platform);
            if (await fs.pathExists(filePath)) {
                data = await fs.readJSON(filePath);
            }
        }

        if (!data) return;

        // Lookup userId from DB (Strict DB extraction as requested)
        let userId: string | null = null;
        try {
            const { data: accData } = await client
                .from('accounts')
                .select('user_id')
                .eq('id', accountId.toLowerCase())
                .maybeSingle();

            if (accData?.user_id) {
                userId = accData.user_id;
            }
        } catch (err) {
            // ignore
        }

        // Upsert to local_storage table
        // Schema assumed: account_id, platform, data (jsonb), updated_at
        const payload = {
            account_id: accountId.toLowerCase(),
            platform: platform,
            user_id: userId,
            data: data,
            updated_at: new Date().toISOString()
        };

        try {
            const { error } = await client
                .from('local_storage')
                .upsert(payload, { onConflict: 'account_id, platform' });

            if (error) throw error;
            logger.info(`[Cloud] Synced Local Storage for ${accountId} (${platform}).`);

        } catch (err: any) {
            if (err.message?.includes('user_id') || err.code === '42703') {
                // Retry without user_id silently
                const { user_id, ...fallbackPayload } = payload;
                const { error: fallbackError } = await client
                    .from('local_storage')
                    .upsert(fallbackPayload, { onConflict: 'account_id, platform' });

                if (fallbackError) throw fallbackError;
                logger.debug(`[Cloud] Synced Local Storage (schema has no user_id).`);
            } else {
                throw err;
            }
        }
    } catch (e: any) {
        logger.error(`[Cloud] LS sync failed for ${accountId}: ${e.message}`);
    }
}

/**
 * Fetch Local Storage from cloud
 */
export async function fetchLocalStorage(accountId: string, platform: string): Promise<Record<string, string> | null> {
    const client = getSupabaseAdminClient();
    if (!client) return null;

    try {
        console.log(`[Cloud] Fetching LS for ${accountId} (${platform})...`);
        const { data, error } = await client
            .from('local_storage')
            .select('data')
            .eq('account_id', accountId.toLowerCase())
            .eq('platform', platform)
            .maybeSingle();

        if (error) {
            console.error(`[Cloud] DB Error fetching LS: ${error.message} (Code: ${error.code})`);
            throw error;
        }

        if (!data) {
            console.warn(`[Cloud] LS not found in DB for ${accountId} (${platform}) - Row missing`);
            return null;
        }

        if (data && data.data) {
            const keyCount = Object.keys(data.data).length;
            logger.info(`[Cloud] Fetched Local Storage from DB for ${accountId} (${platform}). Keys: ${keyCount}`);
            return data.data;
        }
        console.warn(`[Cloud] LS found but empty data column for ${accountId}`);
        return null;
    } catch (e: any) {
        logger.error(`[Cloud] Failed to fetch LS from DB for ${accountId}: ${e.message}`);
        return null;
    }
}


/**
 * Fetch cookies for a specific account from cloud database
 */
export async function fetchCookiesFromCloud(accountId: string, platform: string): Promise<any[]> {
    const client = getSupabaseAdminClient();
    if (!client) return [];

    try {
        const { data: dbCookies, error } = await client
            .from('cookies')
            .select('*')
            .eq('account_id', accountId.toLowerCase())
            .eq('platform', platform);

        if (error) throw error;

        if (dbCookies && dbCookies.length > 0) {
            // Map back to Playwright-compatible cookie format
            const cookies = dbCookies.map((row: any) => {
                // Convert expiration_date to proper Unix timestamp (number)
                let expires: number | undefined;
                if (row.expiration_date != null) {
                    const exp = Number(row.expiration_date);
                    expires = isNaN(exp) ? undefined : exp;
                }

                const sameSite = row.same_site === 'no_restriction' ? 'None' :
                    (['Strict', 'Lax', 'None'].includes(row.same_site) ? row.same_site : 'Lax');

                return {
                    name: row.name,
                    value: row.value,
                    domain: row.domain,
                    path: row.path,
                    // Critical: SameSite=None requires Secure=true
                    secure: row.secure || sameSite === 'None',
                    httpOnly: row.http_only,
                    ...(expires !== undefined && { expires }),
                    sameSite: sameSite
                };
            });
            logger.info(`[Cloud] Fetched ${cookies.length} cookies from DB for ${accountId} (${platform}).`);
            return cookies;
        }
        return [];
    } catch (e: any) {
        logger.error(`[Cloud] Failed to fetch cookies from DB for ${accountId}: ${e.message}`);
        return [];
    }
}

/**
 * Pull all data from cloud (for new device setup)
 */
export async function pullSyncData() {
    const client = getSupabaseAdminClient();
    if (!client) return { success: false, error: 'Cloud sync not enabled' };

    try {
        // --- Generic Pagination Helper ---
        const fetchAllRows = async (table: string) => {
            let allRows: any[] = [];
            let from = 0;
            const limit = 1000;
            let hasMore = true;
            
            while (hasMore) {
                const { data, error } = await client
                    .from(table)
                    .select('*')
                    .range(from, from + limit - 1);
                    
                if (error) throw error;
                
                if (data && data.length > 0) {
                    allRows = allRows.concat(data);
                    from += limit;
                    if (data.length < limit) hasMore = false;
                } else {
                    hasMore = false;
                }
            }
            return allRows;
        };

        // 1. Pull Accounts
        const dbAccounts = await fetchAllRows('accounts');

        if (dbAccounts && dbAccounts.length > 0) {
            // Reconstruct accounts.json format
            const accounts = dbAccounts.map((row: any) => ({
                id: row.id,
                platform: row.platform,
                identifier: row.identifier,
                status: row.status,
                lastLoginAt: row.last_login_at,
                proxy: row.proxy,
                // Spread details back
                ...row.details
            }));

            await fs.writeJSON(ACCOUNTS_FILE, { accounts }, { spaces: 2 });
            logger.info(`[Cloud] Pulled ${accounts.length} accounts from SQL.`);
        }

        // 2. Pull Cookies
        // We pull ALL cookies. If dataset is huge, this fetches completely using pagination.
        const dbCookies = await fetchAllRows('cookies');

        if (dbCookies && dbCookies.length > 0) {
            // Group by account_id + platform
            const grouped: Record<string, any[]> = {};

            for (const row of dbCookies) {
                const key = `${row.account_id}_${row.platform}`;
                if (!grouped[key]) grouped[key] = [];

                // Map back to Cookie object
                grouped[key].push({
                    name: row.name,
                    value: row.value,
                    domain: row.domain,
                    path: row.path,
                    secure: row.secure,
                    httpOnly: row.http_only,
                    expirationDate: row.expiration_date,
                    sameSite: row.same_site,
                    hostOnly: row.host_only,
                    session: row.session
                });
            }

            for (const key in grouped) {
                const [accId, platform] = key.split('_');
                // We need to match the actual file path logic in 'getCookieFilePath'
                // But getCookieFilePath requires platform param. 
                // We can just construct it manually or use the helper if we know the args.
                // Re-importing or using the helper logic:
                // backend/data/cookies/{id}_{platform}.json
                const localPath = path.join(path.dirname(getCookieFilePath('dummy', 'flipkart')), `${accId}_${platform}.json`);
                await fs.writeJSON(localPath, grouped[key], { spaces: 2 });
            }
            logger.info(`[Cloud] Pulled cookies for ${Object.keys(grouped).length} sessions.`);
        }

        return { success: true };
    } catch (e: any) {
        logger.error(`[Cloud] Sync pull failed: ${e.message}`);
        return { success: false, error: e.message };
    }
}

/**
 * Log user activity to Supabase
 */
import { DATA_DIR } from './config.js';

// ... (existing imports)

/**
 * Log user activity to Supabase (and Local File)
 */
export async function logActivity(username: string, action: string, data: any = {}) {
    // 1. Local Log (Always works)
    try {
        const localPath = path.join(DATA_DIR, 'activity.json');
        let logs: any[] = [];
        if (await fs.pathExists(localPath)) {
            logs = await fs.readJSON(localPath);
        }

        const logEntry = {
            username,
            action,
            platform: data.platform || null,
            accountId: data.accountId || null,
            details: data,
            timestamp: new Date().toISOString()
        };

        // Prepend new log
        logs.unshift(logEntry);
        // Limit to 100 items to prevent bloat
        if (logs.length > 100) logs = logs.slice(0, 100);

        await fs.writeJSON(localPath, logs, { spaces: 2 });
    } catch (e: any) {
        logger.error(`[Cloud] Failed to write local activity log: ${e.message}`);
    }

    // 2. Cloud Log (If configured)
    const client = getSupabaseAdminClient();
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
        logger.info(`[Cloud] Activity logged to DB: ${action}`);
    } catch (e: any) {
        logger.error(`[Cloud] Failed to log activity to DB: ${e.message}`);
    }
}

/**
 * Bulk update account ownership across all tables (accounts, cookies, local_storage, fingerprints)
 */
export async function updateAccountOwnershipInDB(accountIds: string[], targetUserId: string) {
    const client = getSupabaseAdminClient();
    if (!client) return;

    const ids = accountIds.map(id => id.toLowerCase().trim());
    
    try {
        logger.info(`[Cloud] Transferring ownership of ${ids.length} accounts to ${targetUserId}`);

        // Update accounts table
        const { error: accError } = await client
            .from('accounts')
            .update({ user_id: targetUserId, updated_at: new Date().toISOString() })
            .in('id', ids);
        if (accError) throw accError;

        // Update associate data tables
        const tables = ['cookies', 'local_storage', 'fingerprints'];
        for (const table of tables) {
            const column = (table === 'cookies' || table === 'local_storage' || table === 'fingerprints') ? 'account_id' : 'id';
            // Note: cookies and local_storage use account_id
            const { error } = await client
                .from(table)
                .update({ user_id: targetUserId })
                .in('account_id', ids);
            
            if (error) {
                // Ignore if table doesn't have user_id column yet (legacy schema)
                if (error.code !== '42703') {
                    logger.warn(`[Cloud] Failed to update user_id in ${table}: ${error.message}`);
                }
            }
        }

        logger.info(`[Cloud] Successfully transferred ownership of ${ids.length} accounts to ${targetUserId}`);
    } catch (e: any) {
        logger.error(`[Cloud] updateAccountOwnershipInDB failed: ${e.message}`);
        throw e;
    }
}

/**
 * Report error to Supabase
 */
export async function reportError(username: string, message: string, stack?: string, context: any = {}) {
    const client = getSupabaseAdminClient();
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
        logger.info(`[Cloud] Error reported to cloud for ${username}`);
    } catch (e: any) {
        logger.error(`[Cloud] Failed to report error: ${e.message}`);
    }
}

/**
 * Fetch centralized users from Supabase (from profiles table)
 * Returns all users except their password hashes
 */
export async function fetchCloudUsers() {
    const client = getSupabaseAdminClient();
    if (!client) return null;

    try {
        // Select all and filter in code to avoid column name issues
        const { data, error } = await client
            .from('profiles')
            .select('*');

        if (error) {
            logger.error(`[Cloud] Failed to fetch users: ${error.message}`);
            return null;
        }

        if (!data || data.length === 0) {
            logger.info('[Cloud] No users found in profiles table');
            return [];
        }

        // Map to frontend-expected format, excluding password_hash
        return data.map((u: any) => ({
            username: u.username,
            role: u.role || 'user',
            allowedAccounts: u.allowed_accounts || 10,
            createdAt: u.created_at
        }));
    } catch (e: any) {
        logger.error(`[Cloud] fetchCloudUsers exception: ${e.message}`);
        return null;
    }
}

/**
 * Update user settings in Supabase profiles table (Admin Only)
 * Note: For creating new users, use signUpSupabase instead
 */
export async function upsertCloudUser(user: any) {
    const client = getSupabaseAdminClient();
    if (!client) throw new Error('Cloud sync not configured');

    const { error } = await client
        .from('profiles')
        .update({
            role: user.role || 'user',
            allowed_accounts: user.allowedAccounts || 10
        })
        .eq('username', user.username?.toLowerCase());

    if (error) throw error;
    logger.info(`[Cloud] Updated user settings: ${user.username}`);
}

/**
 * Delete user from Supabase profiles table
 */
export async function deleteCloudUser(username: string) {
    const client = getSupabaseAdminClient();
    if (!client) throw new Error('Cloud sync not configured');

    const { error } = await client
        .from('profiles')
        .delete()
        .eq('username', username.toLowerCase());

    if (error) throw error;
    logger.info(`[Cloud] Deleted user: ${username}`);
}

/**
 * Fetch recent activity logs from Supabase
 */
export async function fetchActivityLogs() {
    const client = getSupabaseAdminClient();
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
    const client = getSupabaseAdminClient();
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

/**
 * Delete account and all associated data from cloud
 */
export async function deleteCloudAccount(accountId: string) {
    const client = getSupabaseAdminClient();
    if (!client) return;

    const id = accountId.toLowerCase().trim();
    try {
        // 1. Delete cookies
        const { error: cookError } = await client
            .from('cookies')
            .delete()
            .eq('account_id', id);
        if (cookError) throw cookError;

        // 2. Delete local storage
        const { error: lsError } = await client
            .from('local_storage')
            .delete()
            .eq('account_id', id);
        if (lsError) throw lsError;

        // 3. Delete account record
        const { error: accError } = await client
            .from('accounts')
            .delete()
            .eq('id', id);
        if (accError) throw accError;

        logger.info(`[Cloud] Deleted account and all data for ${id}`);
    } catch (e: any) {
        logger.error(`[Cloud] Deletion failed for ${id}: ${e.message}`);
        throw e;
    }
}
/**
 * Notification stubs for Supabase (TBD implementation)
 */
export async function listNotifications(userId?: string) { return []; }
export async function createNotification(n: any) { }
export async function updateNotificationStatus(id: string, status: string) { }
export async function getNotification(id: string) { return null; }
