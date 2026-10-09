/**
 * auth_provider.ts — Auto-switching auth backend
 *
 * Same rule as cloud_provider.ts:
 *   - MONGODB_URI set → MongoDB auth (auth_mongo.ts)
 *   - MONGODB_URI absent → Supabase auth (auth_supabase.ts)
 */

const useMongo = !!process.env.MONGODB_URI;

export type { AuthResponse } from './auth_supabase.js';

async function mongo() {
    return import('./auth_mongo.js');
}

async function supa() {
    return import('./auth_supabase.js');
}

/** Sign up a new user */
export async function signUpSupabase(username: string, password: string) {
    return useMongo
        ? (await mongo()).signUpMongo(username, password)
        : (await supa()).signUpSupabase(username, password);
}

/** Sign in an existing user */
export async function signInSupabase(username: string, password: string) {
    return useMongo
        ? (await mongo()).signInMongo(username, password)
        : (await supa()).signInSupabase(username, password);
}

/** Verify a session token */
export async function verifySession(token: string) {
    // Both providers share the same in-memory session store via their own module,
    // so we route to whichever is active.
    return useMongo
        ? (await mongo()).verifySession(token)
        : (await supa()).verifySession(token);
}

/** List all users (admin) */
export async function listAllUsers() {
    return useMongo
        ? (await mongo()).listAllUsers()
        : (await supa()).listAllUsers();
}
