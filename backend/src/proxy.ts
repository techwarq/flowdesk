import fs from 'fs-extra';
import path from 'path';
import { DATA_DIR } from './config.js';
import { getSupabaseAdminClient } from './cloud_provider.js';
import logger from './log.js';

export interface ProxyConfig {
    server: string; // e.g., 'http://user:pass@host:port' or 'http://host:port'
    username?: string;
    password?: string;
    bypass?: string; // Comma separated domains to bypass
}

export interface ProxyRecord {
    id: number;
    proxy_url: string;
    label?: string;
    is_active: boolean;
    created_at?: string;
    updated_at?: string;
}

const PROXY_FILE = path.join(DATA_DIR, 'proxies.json');

// In-memory cache
let cachedProxies: string[] = [];
let lastLoaded = 0;

/**
 * Load proxies from Supabase database
 */
export async function loadProxiesFromDB(): Promise<string[]> {
    const client = getSupabaseAdminClient();
    if (!client) {
        logger.debug('[Proxy] Supabase not configured, falling back to file');
        return [];
    }

    try {
        const { data, error } = await client
            .from('proxies')
            .select('proxy_url')
            .eq('is_active', true)
            .order('id', { ascending: true });

        if (error) {
            // If table doesn't exist, fail silently and use file fallback
            if (error.code === '42P01') {
                logger.debug('[Proxy] proxies table not found, using file fallback');
                return [];
            }
            throw error;
        }

        if (data && data.length > 0) {
            const proxies = data.map((row: any) => row.proxy_url);
            logger.info(`[Proxy] Loaded ${proxies.length} proxies from database`);
            return proxies;
        }
        return [];
    } catch (e: any) {
        logger.error(`[Proxy] Failed to load from DB: ${e.message}`);
        return [];
    }
}

/**
 * Load proxies - from database ONLY (no JSON file fallback)
 */
export async function loadProxies(): Promise<string[]> {
    try {
        // Cache for 1 minute
        if (Date.now() - lastLoaded < 60000 && cachedProxies.length > 0) {
            return cachedProxies;
        }

        // Try database ONLY - no file fallback
        const dbProxies = await loadProxiesFromDB();
        if (dbProxies.length > 0) {
            cachedProxies = dbProxies;
            lastLoaded = Date.now();
            return cachedProxies;
        }

        // Check for env var fallback (for simple deployments without DB)
        if (process.env.PROXY_LIST) {
            logger.info('[Proxy] Using PROXY_LIST env var');
            return process.env.PROXY_LIST.split(',').map(p => p.trim());
        }

        logger.warn('[Proxy] No proxies found in database');
        return [];
    } catch (e) {
        logger.error(`[Proxy] Failed to load proxy list: ${e}`);
        return [];
    }
}

/**
 * Save proxies to database
 */
export async function saveProxiesToDB(proxies: string[], labels?: string[]): Promise<boolean> {
    const client = getSupabaseAdminClient();
    if (!client) {
        logger.warn('[Proxy] Supabase not configured, cannot save to DB');
        return false;
    }

    try {
        // First, mark all existing proxies as inactive
        await client
            .from('proxies')
            .update({ is_active: false })
            .eq('is_active', true);

        // Insert new proxies
        const rows = proxies.map((proxy_url, index) => ({
            proxy_url,
            label: labels?.[index] || `Proxy ${index + 1}`,
            is_active: true,
            updated_at: new Date().toISOString()
        }));

        const { error } = await client
            .from('proxies')
            .upsert(rows, { onConflict: 'proxy_url' });

        if (error) throw error;

        // Clear cache to force reload
        cachedProxies = [];
        lastLoaded = 0;

        logger.info(`[Proxy] Saved ${proxies.length} proxies to database`);
        return true;
    } catch (e: any) {
        logger.error(`[Proxy] Failed to save to DB: ${e.message}`);
        return false;
    }
}

/**
 * Save proxies to file (legacy, also saves to DB if available)
 */
export async function saveProxies(proxies: string[]) {
    await fs.ensureDir(DATA_DIR);
    await fs.writeFile(PROXY_FILE, JSON.stringify(proxies, null, 2));
    cachedProxies = proxies;
    lastLoaded = Date.now();

    // Also try to save to DB
    await saveProxiesToDB(proxies);
}

/**
 * Get all proxies from database (for admin UI)
 */
export async function getAllProxiesFromDB(): Promise<ProxyRecord[]> {
    const client = getSupabaseAdminClient();
    if (!client) return [];

    try {
        const { data, error } = await client
            .from('proxies')
            .select('*')
            .order('id', { ascending: true });

        if (error) throw error;
        return data || [];
    } catch (e: any) {
        logger.error(`[Proxy] Failed to get all proxies: ${e.message}`);
        return [];
    }
}

/**
 * Add a single proxy to database
 */
export async function addProxyToDB(proxy_url: string, label?: string): Promise<boolean> {
    const client = getSupabaseAdminClient();
    if (!client) return false;

    try {
        const { error } = await client
            .from('proxies')
            .insert({
                proxy_url,
                label: label || 'New Proxy',
                is_active: true
            });

        if (error) throw error;

        // Clear cache
        cachedProxies = [];
        lastLoaded = 0;

        logger.info(`[Proxy] Added proxy to database: ${label || proxy_url}`);
        return true;
    } catch (e: any) {
        logger.error(`[Proxy] Failed to add proxy: ${e.message}`);
        return false;
    }
}

/**
 * Delete a proxy from database
 */
export async function deleteProxyFromDB(id: number): Promise<boolean> {
    const client = getSupabaseAdminClient();
    if (!client) return false;

    try {
        const { error } = await client
            .from('proxies')
            .delete()
            .eq('id', id);

        if (error) throw error;

        // Clear cache
        cachedProxies = [];
        lastLoaded = 0;

        logger.info(`[Proxy] Deleted proxy ${id} from database`);
        return true;
    } catch (e: any) {
        logger.error(`[Proxy] Failed to delete proxy: ${e.message}`);
        return false;
    }
}

/**
 * Toggle proxy active status
 */
export async function toggleProxyActive(id: number, is_active: boolean): Promise<boolean> {
    const client = getSupabaseAdminClient();
    if (!client) return false;

    try {
        const { error } = await client
            .from('proxies')
            .update({ is_active, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) throw error;

        // Clear cache
        cachedProxies = [];
        lastLoaded = 0;

        logger.info(`[Proxy] Toggled proxy ${id} active: ${is_active}`);
        return true;
    } catch (e: any) {
        logger.error(`[Proxy] Failed to toggle proxy: ${e.message}`);
        return false;
    }
}

/**
 * simple hash function to assign a sticky proxy to an account ID
 */
function getHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

// Import getAccount dynamically to avoid circular dependency if possible, or move interfaces to types.ts
import { getAccount } from './accounts.js';

export async function getProxyForAccount(accountId: string): Promise<ProxyConfig | undefined> {
    // 1. Check for global rotating proxy env var (Highest priority for simple setups)
    if (process.env.ROTATING_PROXY_URL) {
        return parseProxyString(process.env.ROTATING_PROXY_URL);
    }

    // Load account to check for specific proxy
    let account;
    try {
        account = await getAccount(accountId);
        if (account && account.proxy) {
            console.log(`[Proxy] Using account-specific proxy for ${accountId}`);
            return parseProxyString(account.proxy);
        }
    } catch (e) {
        // Ignore error if account load fails
    }

    // 2. Load list and assign sticky
    const proxies = await loadProxies();
    if (proxies.length === 0) return undefined;

    // Get Account Offset
    let offset = 0;
    if (account && account.proxyOffset) {
        offset = account.proxyOffset;
    }

    const index = (getHash(accountId) + offset) % proxies.length;
    return parseProxyString(proxies[index]);
}


function parseProxyString(proxyStr: string): ProxyConfig {
    try {
        // Handle format: protocol://user:pass@host:port OR protocol://host:port
        // Playwright expects: { server: 'http://myproxy.com:3128', username: 'usr', password: 'pwd' }

        const url = new URL(proxyStr.includes('://') ? proxyStr : `http://${proxyStr}`);

        const config: ProxyConfig = {
            server: `${url.protocol}//${url.hostname}:${url.port}`
        };

        if (url.username) config.username = decodeURIComponent(url.username);
        if (url.password) config.password = decodeURIComponent(url.password);

        return config;
    } catch (e) {
        console.error('Invalid proxy string:', proxyStr);
        // Return as server anyway, let Playwright fail if invalid
        return { server: proxyStr };
    }
}

