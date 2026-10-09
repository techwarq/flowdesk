import bcrypt from 'bcryptjs';
import { getMongoDb } from './cloud_mongo.js';
import logger from './log.js';
import { randomUUID } from 'crypto';

export interface AuthResponse {
    success: boolean;
    session?: any;
    user?: any;
    profile?: any;
    message?: string;
}

// In-memory session store (Consistent with auth_supabase.ts for now)
const sessionStore = new Map<string, any>();

/**
 * Sign up a new user in MongoDB
 */
export async function signUpMongo(username: string, password: string): Promise<AuthResponse> {
    const db = await getMongoDb();
    if (!db) return { success: false, message: 'Database not configured.' };

    username = username?.trim().toLowerCase() || '';
    password = password?.trim() || '';

    if (!username || !password) {
        return { success: false, message: 'Username and password are required.' };
    }

    try {
        const existing = await db.collection('profiles').findOne({ username });
        if (existing) {
            return { success: false, message: 'Username already taken.' };
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        const newUser = {
            id: randomUUID(),
            username: username,
            password_hash: password_hash,
            role: 'user',
            created_at: new Date().toISOString()
        };

        await db.collection('profiles').insertOne(newUser);
        logger.info(`[Auth-Mongo] User created: ${username}`);

        return signInMongo(username, password);
    } catch (e: any) {
        logger.error(`[Auth-Mongo] Signup failed: ${e.message}`);
        return { success: false, message: e.message };
    }
}

/**
 * Sign in existing user in MongoDB
 */
export async function signInMongo(username: string, password: string): Promise<AuthResponse> {
    const db = await getMongoDb();
    
    // Admin bypass (Consistent with auth_supabase.ts)
    if (username === 'admin' && password === 'admin123') {
        const sessionToken = randomUUID();
        const adminUser = { id: 'admin-bypass-id', username: 'admin', role: 'admin' };
        sessionStore.set(sessionToken, adminUser);
        return {
            success: true,
            user: { id: adminUser.id, username: adminUser.username },
            profile: adminUser,
            session: { access_token: sessionToken, user_id: adminUser.id },
            message: 'Admin Access Granted (Dev Mode)'
        };
    }

    if (!db) return { success: false, message: 'Database not configured.' };

    username = username?.trim().toLowerCase() || '';
    password = password?.trim() || '';

    try {
        const profile = await db.collection('profiles').findOne({ username });
        if (!profile) {
            return { success: false, message: 'Invalid username or password.' };
        }

        const validPassword = await bcrypt.compare(password, profile.password_hash);
        if (!validPassword) {
            return { success: false, message: 'Invalid username or password.' };
        }

        const sessionToken = randomUUID();
        const sessionUser = { id: profile.id, username: profile.username, role: profile.role };
        sessionStore.set(sessionToken, sessionUser);

        logger.info(`[Auth-Mongo] Sign-in successful for: ${username}`);
        return {
            success: true,
            user: { id: profile.id, username: profile.username },
            profile: { id: profile.id, username: profile.username, role: profile.role },
            session: { access_token: sessionToken, user_id: profile.id },
            message: 'Sign-in successful.'
        };
    } catch (e: any) {
        logger.error(`[Auth-Mongo] Sign-in failed: ${e.message}`);
        return { success: false, message: e.message };
    }
}

export async function verifySession(token: string) {
    if (!token) return null;
    return sessionStore.get(token) || null;
}

/**
 * List all users from MongoDB
 */
export async function listAllUsers() {
    const db = await getMongoDb();
    if (!db) return [];

    try {
        const profiles = await db.collection('profiles')
            .find({}, { projection: { password_hash: 0 } })
            .sort({ username: 1 })
            .toArray();
        return profiles.map(p => ({
            id: p.id,
            username: p.username,
            role: p.role,
            created_at: p.created_at
        }));
    } catch (e: any) {
        logger.error(`[Auth-Mongo] List users error: ${e.message}`);
        return [];
    }
}
