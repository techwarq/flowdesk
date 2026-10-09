import { getMongoDb } from './cloud_mongo.js';
import logger from './log.js';

export interface ProxyRecord {
    id?: number; // MongoDB uses _id by default, but we'll map if needed or just use numeric id if they want
    _id?: any;
    proxy_url: string;
    label?: string;
    is_active: boolean;
    created_at?: string;
    updated_at?: string;
}

/**
 * Load proxies from MongoDB
 */
export async function loadProxiesFromDB(): Promise<string[]> {
    const db = await getMongoDb();
    if (!db) {
        logger.debug('[Proxy-Mongo] MongoDB not configured');
        return [];
    }

    try {
        const data = await db.collection('proxies')
            .find({ is_active: true })
            .sort({ id: 1 })
            .toArray();

        if (data && data.length > 0) {
            const proxies = data.map((row: any) => row.proxy_url);
            logger.info(`[Proxy-Mongo] Loaded ${proxies.length} proxies from database`);
            return proxies;
        }
        return [];
    } catch (e: any) {
        logger.error(`[Proxy-Mongo] Failed to load from DB: ${e.message}`);
        return [];
    }
}

/**
 * Save proxies to MongoDB
 */
export async function saveProxiesToDB(proxies: string[], labels?: string[]): Promise<boolean> {
    const db = await getMongoDb();
    if (!db) {
        logger.warn('[Proxy-Mongo] MongoDB not configured, cannot save to DB');
        return false;
    }

    try {
        // Mark existing as inactive (consistent with proxy.ts)
        await db.collection('proxies').updateMany(
            { is_active: true },
            { $set: { is_active: false } }
        );

        // Insert/Upsert new proxies
        const rows = proxies.map((proxy_url, index) => ({
            proxy_url,
            label: labels?.[index] || `Proxy ${index + 1}`,
            is_active: true,
            updated_at: new Date().toISOString()
        }));

        for (const row of rows) {
            await db.collection('proxies').updateOne(
                { proxy_url: row.proxy_url },
                { $set: row },
                { upsert: true }
            );
        }

        logger.info(`[Proxy-Mongo] Saved ${proxies.length} proxies to database`);
        return true;
    } catch (e: any) {
        logger.error(`[Proxy-Mongo] Failed to save to DB: ${e.message}`);
        return false;
    }
}

/**
 * Get all proxies from MongoDB for UI
 */
export async function getAllProxiesFromDB(): Promise<ProxyRecord[]> {
    const db = await getMongoDb();
    if (!db) return [];

    try {
        const data = await db.collection('proxies')
            .find({})
            .sort({ updated_at: -1 })
            .toArray();
        return data as unknown as ProxyRecord[];
    } catch (e: any) {
        logger.error(`[Proxy-Mongo] Failed to get all proxies: ${e.message}`);
        return [];
    }
}

/**
 * Add a single proxy to MongoDB
 */
export async function addProxyToDB(proxy_url: string, label?: string): Promise<boolean> {
    const db = await getMongoDb();
    if (!db) return false;

    try {
        await db.collection('proxies').updateOne(
            { proxy_url },
            {
                $set: {
                    proxy_url,
                    label: label || 'New Proxy',
                    is_active: true,
                    updated_at: new Date().toISOString()
                }
            },
            { upsert: true }
        );
        logger.info(`[Proxy-Mongo] Added/Updated proxy in database: ${label || proxy_url}`);
        return true;
    } catch (e: any) {
        logger.error(`[Proxy-Mongo] Failed to add proxy: ${e.message}`);
        return false;
    }
}

/**
 * Delete a proxy from MongoDB
 */
export async function deleteProxyFromDB(proxyUrl: string): Promise<boolean> {
    const db = await getMongoDb();
    if (!db) return false;

    try {
        await db.collection('proxies').deleteOne({ proxy_url: proxyUrl });
        logger.info(`[Proxy-Mongo] Deleted proxy ${proxyUrl} from database`);
        return true;
    } catch (e: any) {
        logger.error(`[Proxy-Mongo] Failed to delete proxy: ${e.message}`);
        return false;
    }
}

/**
 * Toggle proxy active status in MongoDB
 */
export async function toggleProxyActive(proxyUrl: string, is_active: boolean): Promise<boolean> {
    const db = await getMongoDb();
    if (!db) return false;

    try {
        await db.collection('proxies').updateOne(
            { proxy_url: proxyUrl },
            { $set: { is_active, updated_at: new Date().toISOString() } }
        );
        logger.info(`[Proxy-Mongo] Toggled proxy ${proxyUrl} active: ${is_active}`);
        return true;
    } catch (e: any) {
        logger.error(`[Proxy-Mongo] Failed to toggle proxy: ${e.message}`);
        return false;
    }
}
