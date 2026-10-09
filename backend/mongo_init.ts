/**
 * mongo_init.ts — One-time MongoDB collection + index setup
 *
 * ALIGNED 1:1 WITH SUPABASE SCHEMA:
 *   - Snake_case field names (account_id, user_id, created_at, etc.)
 *   - Row-based cookies (one document per cookie, matching Supabase tables)
 */

import 'dotenv/config';
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI!;
const DB_NAME = process.env.MONGODB_DB_NAME || 'flowdesk';

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI is not set in .env');
    process.exit(1);
}

async function run() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);

    async function ensureCollection(name: string) {
        const existing = await db.listCollections({ name }).toArray();
        if (existing.length === 0) {
            await db.createCollection(name);
            console.log(`  📦 Created collection: ${name}`);
        } else {
            console.log(`  ✔  Collection already exists: ${name}`);
        }
        return db.collection(name);
    }

    console.log('\n── Creating collections (Snake_Case / Supabase Parity) ──────');

    // ── accounts ───────────────────────────────────────────────────────────────
    const accounts = await ensureCollection('accounts');
    await accounts.createIndex({ id: 1 }, { unique: true, name: 'idx_accounts_id' });
    await accounts.createIndex({ user_id: 1 }, { name: 'idx_accounts_user_id' });
    await accounts.createIndex({ platform: 1 }, { name: 'idx_accounts_platform' });
    console.log('     Indexes: id (unique), user_id, platform');

    // ── activity_logs ──────────────────────────────────────────────────────────
    const actLogs = await ensureCollection('activity_logs');
    await actLogs.createIndex({ username: 1 }, { name: 'idx_actlogs_username' });
    await actLogs.createIndex({ created_at: -1 }, { name: 'idx_actlogs_created_at' });
    console.log('     Indexes: username, created_at');

    // ── app_errors ─────────────────────────────────────────────────────────────
    const appErrors = await ensureCollection('app_errors');
    await appErrors.createIndex({ username: 1 }, { name: 'idx_apperrors_username' });
    await appErrors.createIndex({ created_at: -1 }, { name: 'idx_apperrors_created_at' });
    console.log('     Indexes: username, created_at');

    // ── app_users ──────────────────────────────────────────────────────────────
    const appUsers = await ensureCollection('app_users');
    await appUsers.createIndex({ username: 1 }, { unique: true, name: 'idx_appusers_username' });
    console.log('     Indexes: username (unique)');

    // ── cookies ────────────────────────────────────────────────────────────────
    // ROW-BASED: Matching Supabase 'cookies' table. 
    // This index must NOT be unique because an account+platform has MANY cookies.
    const cookies = await ensureCollection('cookies');
    try { await cookies.dropIndex('idx_cookies_account_platform'); } catch (e) {} 
    await cookies.createIndex({ account_id: 1, platform: 1 }, { name: 'idx_cookies_account_platform' });
    console.log('     Indexes: account_id + platform (non-unique, row-based)');

    // ── fingerprints ───────────────────────────────────────────────────────────
    const fingerprints = await ensureCollection('fingerprints');
    await fingerprints.createIndex({ account_id: 1 }, { unique: true, name: 'idx_fingerprints_account_id' });
    console.log('     Indexes: account_id (unique)');

    // ── local_storage ──────────────────────────────────────────────────────────
    const localStorage = await ensureCollection('local_storage');
    await localStorage.createIndex({ account_id: 1, platform: 1 }, { unique: true, name: 'idx_ls_account_platform' });
    console.log('     Indexes: account_id + platform (unique compound)');

    // ── notifications ─────────────────────────────────────────────────────────
    const notifications = await ensureCollection('notifications');
    await notifications.createIndex({ user_id: 1 }, { name: 'idx_notifications_user_id' });
    await notifications.createIndex({ status: 1 }, { name: 'idx_notifications_status' });
    await notifications.createIndex({ account_id: 1 }, { name: 'idx_notifications_account_id' });
    console.log('     Indexes: user_id, status, account_id');

    // ── profiles ───────────────────────────────────────────────────────────────
    const profiles = await ensureCollection('profiles');
    await profiles.createIndex({ username: 1 }, { unique: true, name: 'idx_profiles_username' });
    console.log('     Indexes: username (unique)');

    // ── proxies ────────────────────────────────────────────────────────────────
    const proxies = await ensureCollection('proxies');
    await proxies.createIndex({ account_id: 1 }, { name: 'idx_proxies_account_id' });
    console.log('     Indexes: account_id');

    console.log('\n✅ MongoDB initialization complete!');
    console.log(`   Schema is now 1:1 with Supabase (Snake_Case)`);
    console.log(`   Cookies are now row-based (one doc per cookie).\n`);

    await client.close();
}

run().catch(e => {
    console.error('❌ Init failed:', e.message);
    process.exit(1);
});
