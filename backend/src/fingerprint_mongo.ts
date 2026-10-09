import { getMongoDb } from './cloud_mongo.js';
import logger from './log.js';

export interface Fingerprint {
    userAgent: string;
    viewportWidth?: number;
    viewportHeight?: number;
    locale?: string;
    timezoneId?: string;
}

/**
 * Save fingerprint to MongoDB
 */
export async function saveFingerprint(accountId: string, fingerprint: Fingerprint): Promise<void> {
    const db = await getMongoDb();
    if (!db) {
        logger.warn('[Fingerprint-Mongo] MongoDB not configured, skipping save');
        return;
    }

    try {
        const payload = {
            account_id: accountId.toLowerCase(),
            user_agent: fingerprint.userAgent,
            viewport_width: fingerprint.viewportWidth || 1920,
            viewport_height: fingerprint.viewportHeight || 1080,
            locale: fingerprint.locale || 'en-IN',
            timezone_id: fingerprint.timezoneId || 'Asia/Kolkata',
            updated_at: new Date().toISOString()
        };

        await db.collection('fingerprints').updateOne(
            { account_id: accountId.toLowerCase() },
            { $set: payload },
            { upsert: true }
        );

        logger.info(`[Fingerprint-Mongo] Saved fingerprint for ${accountId}`);
    } catch (e: any) {
        logger.error(`[Fingerprint-Mongo] Failed to save fingerprint for ${accountId}: ${e.message}`);
        throw e;
    }
}

/**
 * Get fingerprint from MongoDB
 */
export async function getFingerprint(accountId: string): Promise<Fingerprint | null> {
    const db = await getMongoDb();
    if (!db) {
        logger.warn('[Fingerprint-Mongo] MongoDB not configured, returning null');
        return null;
    }

    try {
        const data = await db.collection('fingerprints').findOne({ account_id: accountId.toLowerCase() });

        if (!data) {
            logger.debug(`[Fingerprint-Mongo] No fingerprint found for ${accountId}`);
            return null;
        }

        return {
            userAgent: data.user_agent,
            viewportWidth: data.viewport_width,
            viewportHeight: data.viewport_height,
            locale: data.locale,
            timezoneId: data.timezone_id
        };
    } catch (e: any) {
        logger.error(`[Fingerprint-Mongo] Failed to get fingerprint for ${accountId}: ${e.message}`);
        return null;
    }
}

/**
 * Delete fingerprint from MongoDB
 */
export async function deleteFingerprint(accountId: string): Promise<boolean> {
    const db = await getMongoDb();
    if (!db) return false;

    try {
        await db.collection('fingerprints').deleteOne({ account_id: accountId.toLowerCase() });
        logger.info(`[Fingerprint-Mongo] Deleted fingerprint for ${accountId}`);
        return true;
    } catch (e: any) {
        logger.error(`[Fingerprint-Mongo] Failed to delete fingerprint for ${accountId}: ${e.message}`);
        return false;
    }
}
