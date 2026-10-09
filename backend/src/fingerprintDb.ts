/**
 * Fingerprint Database Operations
 * Auto-switches between MongoDB and Supabase based on MONGODB_URI env var.
 * Aligned 1:1 with Supabase snake_case fields.
 */

import logger from './log.js';

const useMongo = !!process.env.MONGODB_URI;

export interface Fingerprint {
    userAgent: string;
    viewportWidth?: number;
    viewportHeight?: number;
    locale?: string;
    timezoneId?: string;
}

// ─── MongoDB implementation ────────────────────────────────────────────────────

async function saveFingerprintMongo(accountId: string, fingerprint: Fingerprint): Promise<void> {
    const { getMongoDb } = await import('./cloud_mongo.js');
    const db = await getMongoDb();
    if (!db) return;

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
        { account_id: payload.account_id },
        { $set: payload },
        { upsert: true }
    );
    logger.info(`[Fingerprint] Saved fingerprint for ${accountId} to MongoDB`);
}

async function getFingerprintMongo(accountId: string): Promise<Fingerprint | null> {
    const { getMongoDb } = await import('./cloud_mongo.js');
    const db = await getMongoDb();
    if (!db) return null;

    const data = await db.collection('fingerprints').findOne({ account_id: accountId.toLowerCase() });
    if (!data) return null;

    return {
        userAgent: data.user_agent,
        viewportWidth: data.viewport_width,
        viewportHeight: data.viewport_height,
        locale: data.locale,
        timezoneId: data.timezone_id
    };
}

async function deleteFingerprintMongo(accountId: string): Promise<boolean> {
    const { getMongoDb } = await import('./cloud_mongo.js');
    const db = await getMongoDb();
    if (!db) return false;

    await db.collection('fingerprints').deleteOne({ account_id: accountId.toLowerCase() });
    logger.info(`[Fingerprint] Deleted fingerprint for ${accountId} from MongoDB`);
    return true;
}

// ─── Supabase implementation ────────────────────────────────────────────────────

async function saveFingerprintSupabase(accountId: string, fingerprint: Fingerprint): Promise<void> {
    const { getSupabaseAdminClient } = await import('./cloud_provider.js');
    const client = getSupabaseAdminClient() as any;
    if (!client) {
        logger.warn('[Fingerprint] Cloud not configured, skipping save');
        return;
    }

    const payload = {
        account_id: accountId.toLowerCase(),
        user_agent: fingerprint.userAgent,
        viewport_width: fingerprint.viewportWidth || 1920,
        viewport_height: fingerprint.viewportHeight || 1080,
        locale: fingerprint.locale || 'en-IN',
        timezone_id: fingerprint.timezoneId || 'Asia/Kolkata',
        updated_at: new Date().toISOString()
    };

    const { error } = await client.from('fingerprints').upsert(payload, { onConflict: 'account_id' });
    if (error) throw error;
    logger.info(`[Fingerprint] Saved fingerprint for ${accountId} to Supabase`);
}

async function getFingerprintSupabase(accountId: string): Promise<Fingerprint | null> {
    const { getSupabaseAdminClient } = await import('./cloud_provider.js');
    const client = getSupabaseAdminClient() as any;
    if (!client) {
        logger.warn('[Fingerprint] Cloud not configured, returning null');
        return null;
    }

    const { data, error } = await client
        .from('fingerprints')
        .select('*')
        .eq('account_id', accountId.toLowerCase())
        .maybeSingle();

    if (error || !data) return null;

    return {
        userAgent: data.user_agent,
        viewportWidth: data.viewport_width,
        viewportHeight: data.viewport_height,
        locale: data.locale,
        timezoneId: data.timezone_id
    };
}

async function deleteFingerprintSupabase(accountId: string): Promise<boolean> {
    const { getSupabaseAdminClient } = await import('./cloud_provider.js');
    const client = getSupabaseAdminClient() as any;
    if (!client) return false;

    const { error } = await client.from('fingerprints').delete().eq('account_id', accountId.toLowerCase());
    if (error) throw error;
    return true;
}

// ─── Exported API (auto-switches) ──────────────────────────────────────────────

export async function saveFingerprint(accountId: string, fingerprint: Fingerprint): Promise<void> {
    try {
        return useMongo
            ? await saveFingerprintMongo(accountId, fingerprint)
            : await saveFingerprintSupabase(accountId, fingerprint);
    } catch (e: any) {
        logger.error(`[Fingerprint] Failed to save fingerprint for ${accountId}: ${e.message}`);
    }
}

export async function getFingerprint(accountId: string): Promise<Fingerprint | null> {
    try {
        return useMongo
            ? await getFingerprintMongo(accountId)
            : await getFingerprintSupabase(accountId);
    } catch (e: any) {
        logger.error(`[Fingerprint] Failed to get fingerprint for ${accountId}: ${e.message}`);
        return null;
    }
}

export async function deleteFingerprint(accountId: string): Promise<boolean> {
    try {
        return useMongo
            ? await deleteFingerprintMongo(accountId)
            : await deleteFingerprintSupabase(accountId);
    } catch (e: any) {
        logger.error(`[Fingerprint] Failed to delete fingerprint for ${accountId}: ${e.message}`);
        return false;
    }
}
