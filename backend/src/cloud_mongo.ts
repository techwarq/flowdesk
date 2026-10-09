import { MongoClient, Db } from 'mongodb';
import fs from 'fs-extra';
import path from 'path';
import 'dotenv/config';
import logger from './log.js';
import { getCookieFilePath } from './cookies.js';
import { getStorageFilePath } from './localStorage.js';
import { ACCOUNTS_FILE } from './config.js';

let mongoClient: MongoClient | null = null;
let mongoDb: Db | null = null;

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'flowdesk';

/**
 * Get MongoDB connection
 */
export async function getMongoDb(): Promise<Db | null> {
    if (!MONGODB_URI) return null;

    if (!mongoDb) {
        try {
            logger.info('[Cloud-Mongo] Initializing MongoDB Client...');
            mongoClient = new MongoClient(MONGODB_URI);
            await mongoClient.connect();
            mongoDb = mongoClient.db(DB_NAME);
            logger.info('[Cloud-Mongo] MongoDB Client connected.');
        } catch (e: any) {
            logger.error(`[Cloud-Mongo] Failed to connect to MongoDB: ${e.message}`);
            return null;
        }
    }
    return mongoDb;
}

/**
 * Check if MongoDB is connected and configured
 */
export async function checkCloudConnection(): Promise<{ success: boolean; message: string }> {
    const db = await getMongoDb();
    if (!db) return { success: false, message: 'MongoDB not configured (MONGODB_URI missing).' };
    try {
        await db.command({ ping: 1 });
        return { success: true, message: 'MongoDB connection healthy.' };
    } catch (e: any) {
        return { success: false, message: `MongoDB connection failed: ${e.message}` };
    }
}

/**
 * Mirror of saveAccountsToDB from cloud.ts
 */
export async function saveAccountsToDB(data: any) {
    const db = await getMongoDb();
    if (!db) return;

    const details: any = data.details || {};
    if (data.proxy) details.proxy = data.proxy;
    if (data.lastLoginAt) details.last_login_at = data.lastLoginAt;

    const payload: any = {
        id: data.id?.toLowerCase(),
        platform: data.platform,
        identifier: data.identifier,
        status: data.status,
        details: details,
        updated_at: new Date().toISOString()
    };

    if (data.userId) {
        payload.user_id = data.userId;
    }

    try {
        await db.collection('accounts').updateOne(
            { id: payload.id },
            { $set: payload },
            { upsert: true }
        );
        logger.info(`[Cloud-Mongo] Saved account ${data.id} to MongoDB`);
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to save account to MongoDB: ${e.message}`);
        throw e;
    }
}

/**
 * Mirror of pushAccount from cloud.ts
 */
export async function pushAccount(acc: any) {
    return saveAccountsToDB(acc);
}

/**
 * Mirror of fetchAccountsFromCloud from cloud.ts
 */
export async function fetchAccountsFromCloud(userId?: string): Promise<any[]> {
    const db = await getMongoDb();
    if (!db) return [];

    try {
        const query = userId ? { user_id: userId } : {};
        const data = await db.collection('accounts').find(query).toArray();
        
        if (data && data.length > 0) {
            return data.map((row: any) => ({
                id: row.id,
                userId: row.user_id,
                platform: row.platform,
                identifier: row.identifier,
                status: row.status,
                lastLoginAt: row.last_login_at,
                proxy: row.proxy,
                ...(row.details || {})
            }));
        }
        return [];
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to fetch accounts from MongoDB: ${e.message}`);
        return [];
    }
}

/**
 * Mirror of fetchAccountFromCloud from cloud.ts
 */
export async function fetchAccountFromCloud(accountId: string): Promise<any | null> {
    const db = await getMongoDb();
    if (!db) return null;

    try {
        const row = await db.collection('accounts').findOne({ id: accountId.toLowerCase() });
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
        logger.error(`[Cloud-Mongo] Failed to fetch account from MongoDB: ${e.message}`);
        return null;
    }
}

/**
 * Mirror of deleteAccountFromCloud from cloud.ts
 */
export async function deleteAccountFromCloud(accountId: string): Promise<boolean> {
    const db = await getMongoDb();
    if (!db) return false;

    const id = accountId.toLowerCase();
    try {
        await db.collection('accounts').deleteOne({ id });
        await db.collection('cookies').deleteMany({ account_id: id });
        await db.collection('local_storage').deleteMany({ account_id: id });
        await db.collection('fingerprints').deleteMany({ account_id: id });
        await db.collection('proxies').deleteMany({ account_id: id });
        
        logger.info(`[Cloud-Mongo] Deleted account ${id} (and all associated data) from MongoDB`);
        return true;
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to delete account from MongoDB: ${e.message}`);
        return false;
    }
}

/**
 * Mirror of saveCookies_DB from cloud.ts (Supabase row-based parity)
 */
export async function saveCookies_DB(accountId: string, platform: string, cookies: any[]) {
    const db = await getMongoDb();
    if (!db) return;

    const id = accountId.toLowerCase();

    // 1. Delete existing cookies for this account & platform (parity with Supabase)
    await db.collection('cookies').deleteMany({ account_id: id, platform });

    if (!cookies || cookies.length === 0) return;

    // 2. Prepare cookie rows (documents)
    const rows = cookies.map(c => ({
        account_id: id,
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
    await db.collection('cookies').insertMany(rows);
    logger.info(`[Cloud-Mongo] Saved ${rows.length} cookies to MongoDB for ${accountId}`);
}

/**
 * Mirror of pushCookies from cloud.ts
 */
export async function pushCookies(accountId: string, platform: string, directCookies?: any[]) {
    const db = await getMongoDb();
    if (!db) return;

    try {
        let cookies = directCookies;
        if (!cookies) {
            const filePath = getCookieFilePath(accountId, platform);
            if (await fs.pathExists(filePath)) {
                cookies = await fs.readJSON(filePath);
            }
        }

        if (!cookies || !Array.isArray(cookies)) return;

        await saveCookies_DB(accountId, platform, cookies);
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to push cookies for ${accountId}: ${e.message}`);
    }
}

/**
 * Mirror of pushLocalStorage from cloud.ts
 */
export async function pushLocalStorage(accountId: string, platform: string, directData?: Record<string, any>) {
    const db = await getMongoDb();
    if (!db) return;

    try {
        let data = directData;
        if (!data) {
            const filePath = getStorageFilePath(accountId, platform);
            if (await fs.pathExists(filePath)) {
                data = await fs.readJSON(filePath);
            }
        }
        if (!data) return;

        const id = accountId.toLowerCase();
        let userId: string | null = null;
        try {
            const acc = await db.collection('accounts').findOne({ id });
            if (acc?.user_id) userId = acc.user_id;
        } catch (err) {}

        const payload = {
            account_id: id,
            platform: platform,
            user_id: userId,
            data: data,
            updated_at: new Date().toISOString()
        };

        await db.collection('local_storage').updateOne(
            { account_id: id, platform },
            { $set: payload },
            { upsert: true }
        );
        logger.info(`[Cloud-Mongo] Synced Local Storage for ${accountId} (${platform}) to MongoDB.`);
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] LS sync failed for ${accountId}: ${e.message}`);
    }
}

/**
 * Mirror of fetchLocalStorage from cloud.ts
 */
export async function fetchLocalStorage(accountId: string, platform: string): Promise<Record<string, string> | null> {
    const db = await getMongoDb();
    if (!db) return null;

    try {
        const row = await db.collection('local_storage').findOne({ account_id: accountId.toLowerCase(), platform });
        if (row && row.data) {
            return row.data;
        }
        return null;
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to fetch LS from MongoDB for ${accountId}: ${e.message}`);
        return null;
    }
}

/**
 * Mirror of fetchCookiesFromCloud from cloud.ts (Supabase row-based parity)
 */
export async function fetchCookiesFromCloud(accountId: string, platform: string): Promise<any[]> {
    const db = await getMongoDb();
    if (!db) return [];

    try {
        const dbCookies = await db.collection('cookies').find({ 
            account_id: accountId.toLowerCase(), 
            platform 
        }).toArray();

        if (dbCookies && dbCookies.length > 0) {
            return dbCookies.map((row: any) => {
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
                    secure: row.secure || sameSite === 'None',
                    httpOnly: row.http_only,
                    ...(expires !== undefined && { expires }),
                    sameSite: sameSite
                };
            });
        }
        return [];
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to fetch cookies from MongoDB for ${accountId}: ${e.message}`);
        return [];
    }
}

/**
 * Mirror of pullSyncData from cloud.ts
 */
export async function pullSyncData() {
    const db = await getMongoDb();
    if (!db) return;

    try {
        logger.info('[Cloud-Mongo] Starting data pull from MongoDB...');

        // 1. Pull Accounts
        const dbAccounts = await fetchAccountsFromCloud();
        if (dbAccounts.length > 0) {
            const accounts = dbAccounts.map(row => ({
                id: row.id,
                userId: row.userId,
                platform: row.platform,
                identifier: row.identifier,
                status: row.status,
                lastLoginAt: row.lastLoginAt,
                proxy: row.proxy,
                ...(row.details || {})
            }));
            await fs.writeJSON(ACCOUNTS_FILE, { accounts }, { spaces: 2 });
            logger.info(`[Cloud-Mongo] Pulled ${accounts.length} accounts from MongoDB.`);
        }

        // 2. Pull Cookies (Row-based)
        const dbCookies = await db.collection('cookies').find({}).toArray();
        if (dbCookies && dbCookies.length > 0) {
            const grouped: Record<string, any[]> = {};
            for (const row of dbCookies) {
                const key = `${row.account_id}_${row.platform}`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push({
                    name: row.name,
                    value: row.value,
                    domain: row.domain,
                    path: row.path,
                    secure: row.secure,
                    httpOnly: row.http_only,
                    expirationDate: row.expiration_date,
                    sameSite: row.same_site,
                    session: row.session
                });
            }
            for (const key in grouped) {
                const [accId, platform] = key.split('_');
                const localPath = getCookieFilePath(accId, platform);
                await fs.ensureDir(path.dirname(localPath));
                await fs.writeJSON(localPath, grouped[key], { spaces: 2 });
            }
            logger.info(`[Cloud-Mongo] Pulled cookies for ${Object.keys(grouped).length} accounts.`);
        }

        // 3. Pull Local Storage
        const dbLs = await db.collection('local_storage').find({}).toArray();
        if (dbLs && dbLs.length > 0) {
            for (const row of dbLs) {
                if (row.data) {
                    const localPath = getStorageFilePath(row.account_id, row.platform);
                    await fs.ensureDir(path.dirname(localPath));
                    await fs.writeJSON(localPath, row.data, { spaces: 2 });
                }
            }
            logger.info(`[Cloud-Mongo] Pulled Local Storage for ${dbLs.length} accounts.`);
        }

        logger.info('[Cloud-Mongo] Data pull complete.');
        return { success: true };
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Data pull failed: ${e.message}`);
        return { success: false, error: e.message };
    }
}

/**
 * Mirror of listNotifications from cloud.ts (Supabase)
 */
export async function listNotifications(userId?: string) {
    const db = await getMongoDb();
    if (!db) return [];
    try {
        const query: any = { status: 'pending' };
        if (userId) query.user_id = userId;
        return await db.collection('notifications').find(query).sort({ created_at: -1 }).toArray();
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to list notifications: ${e.message}`);
        return [];
    }
}

/**
 * Mirror of createNotification from cloud.ts (Supabase)
 */
export async function createNotification(n: any) {
    const db = await getMongoDb();
    if (!db) return;
    try {
        const payload = {
            ...n,
            status: 'pending',
            created_at: new Date().toISOString()
        };
        await db.collection('notifications').insertOne(payload);
        logger.info(`[Cloud-Mongo] Created notification: ${n.title}`);
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to create notification: ${e.message}`);
    }
}

/**
 * Mirror of updateNotificationStatus from cloud.ts (Supabase)
 */
export async function updateNotificationStatus(id: string, status: string) {
    const db = await getMongoDb();
    if (!db) return;
    try {
        const { ObjectId } = await import('mongodb');
        await db.collection('notifications').updateOne(
            { _id: new ObjectId(id) },
            { $set: { status, updated_at: new Date().toISOString() } }
        );
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to update notification: ${e.message}`);
    }
}

/**
 * Mirror of getNotification from cloud.ts (Supabase)
 */
export async function getNotification(id: string) {
    const db = await getMongoDb();
    if (!db) return null;
    try {
        const { ObjectId } = await import('mongodb');
        return await db.collection('notifications').findOne({ _id: new ObjectId(id) });
    } catch (e: any) {
        return null;
    }
}

/**
 * Mirror of logActivity from cloud.ts
 */
export async function logActivity(username: string, action: string, data: any = {}) {
    const db = await getMongoDb();
    if (!db) return;

    try {
        const deviceInfo = {
            os: process.platform,
            arch: process.arch,
            hostname: path.basename(process.cwd()) // Fallback for hostname
        };
        await db.collection('activity_logs').insertOne({
            username,
            action,
            data: data,
            account_id: data.accountId || null,
            device_info: deviceInfo,
            created_at: new Date().toISOString()
        });
        logger.info(`[Cloud-Mongo] Activity logged to MongoDB: ${action}`);
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to log activity to Mongo: ${e.message}`);
    }
}

/**
 * Mirror of reportError from cloud.ts
 */
export async function reportError(username: string, message: string, stack?: string, context: any = {}) {
    const db = await getMongoDb();
    if (!db) return;

    try {
        const deviceInfo = {
            os: process.platform,
            arch: process.arch,
            hostname: path.basename(process.cwd()) // Fallback
        };
        await db.collection('app_errors').insertOne({
            username,
            message,
            stack,
            context: { ...context, deviceInfo },
            created_at: new Date().toISOString()
        });
        logger.info(`[Cloud-Mongo] Error reported to MongoDB for ${username}`);
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to report error to Mongo: ${e.message}`);
    }
}

/**
 * Mirror of fetchCloudUsers from cloud.ts
 */
export async function fetchCloudUsers() {
    const db = await getMongoDb();
    if (!db) return null;

    try {
        const data = await db.collection('profiles').find({}).toArray();
        return data.map((u: any) => ({
            username: u.username,
            role: u.role || 'user',
            allowedAccounts: u.allowed_accounts || 10,
            created_at: u.created_at
        }));
    } catch (e: any) {
        return [];
    }
}

/**
 * Mirror of upsertCloudUser from cloud.ts
 */
export async function upsertCloudUser(user: any) {
    const db = await getMongoDb();
    if (!db) return;

    try {
        const payload = {
            username: user.username,
            role: user.role || 'user',
            allowed_accounts: user.allowedAccounts || 10,
            updated_at: new Date().toISOString()
        };
        await db.collection('profiles').updateOne(
            { username: user.username },
            { $set: payload },
            { upsert: true }
        );
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to upsert user: ${e.message}`);
    }
}

/**
 * Mirror of deleteCloudUser from cloud.ts
 */
export async function deleteCloudUser(username: string) {
    const db = await getMongoDb();
    if (!db) return;
    try {
        await db.collection('profiles').deleteOne({ username });
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to delete user: ${e.message}`);
    }
}

/**
 * Mirror of fetchActivityLogs from cloud.ts
 */
export async function fetchActivityLogs() {
    const db = await getMongoDb();
    if (!db) return [];
    try {
        return await db.collection('activity_logs').find({}).sort({ created_at: -1 }).limit(100).toArray();
    } catch (e: any) {
        return [];
    }
}

/**
 * Mirror of fetchAppErrors from cloud.ts
 */
export async function fetchAppErrors() {
    const db = await getMongoDb();
    if (!db) return [];
    try {
        return await db.collection('app_errors').find({}).sort({ created_at: -1 }).limit(100).toArray();
    } catch (e: any) {
        return [];
    }
}

/**
 * Mirror of deleteCloudAccount from cloud.ts
 */
export async function deleteCloudAccount(accountId: string) {
    return deleteAccountFromCloud(accountId);
}

/**
 * Mirror of updateAccountOwnershipInDB from cloud.ts
 */
export async function updateAccountOwnershipInDB(accountIds: string[], targetUserId: string) {
    const db = await getMongoDb();
    if (!db) return;

    try {
        await db.collection('accounts').updateMany(
            { id: { $in: accountIds.map(id => id.toLowerCase()) } },
            { $set: { user_id: targetUserId, updated_at: new Date().toISOString() } }
        );
        logger.info(`[Cloud-Mongo] Updated ownership for ${accountIds.length} accounts to ${targetUserId}`);
    } catch (e: any) {
        logger.error(`[Cloud-Mongo] Failed to update account ownership: ${e.message}`);
    }
}
