import { BrowserContext } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { ACCOUNTS_FILE, DATA_DIR, PROFILES_DIR, ENCRYPTED_DIR } from './config.js';
import { pushAccounts, pushAccount, pushCookies, deleteCloudAccount, fetchAccountsFromCloud, fetchAccountFromCloud, deleteAccountFromCloud, saveAccountsToDB, fetchCookiesFromCloud, saveCookies_DB, updateAccountOwnershipInDB } from './cloud_provider.js';
import { deleteFingerprint } from './fingerprintDb.js';

const COOKIES_DIR = path.join(DATA_DIR, 'cookies');

export type Platform =
    | 'flipkart' | 'shopsy'
    | 'iqoo' | 'vivo' | 'oppo' | 'realme'
    | 'xiaomi' | 'redmi' | 'oneplus'
    | 'samsung' | 'amazon'
    | 'vijaysales' | 'reliancedigital';
export type LoginType = 'email' | 'mobile';
export type AccountStatus =
    | 'New'           // Not yet initialized
    | 'Healthy'       // Session is valid
    | 'NeedsRefresh'  // Session may be stale
    | 'OTPRequired'   // Re-login needed
    | 'Locked'        // Account locked/suspended
    | 'Error';        // Unknown error state

export interface Account {
    id: string;
    userId?: string;            // Added for user isolation
    platform: Platform;
    loginType: LoginType;
    identifier: string;         // email or mobile number
    status: AccountStatus;
    assignedTo?: string;        // operator name
    lastLoginAt?: string;       // ISO timestamp
    lastValidateAt?: string;    // ISO timestamp
    errorCode?: string;         // last error reason
    createdAt: string;          // ISO timestamp
    updatedAt: string;          // ISO timestamp
    // For automated recovery
    emailConfig?: {
        user: string;
        passEncrypted: string;
        host: string;
    };
    details?: {
        name?: string;
        mobile?: string;
        email?: string;
        superCoins?: string;
        isPlus?: boolean;
        gvBalance?: string;
        fingerprint?: any;
    };
    proxyOffset?: number; // Used for IP rotation
    proxy?: string; // Explicitly assigned proxy
    orders?: Order[];
}

export interface Order {
    orderId: string;
    productName: string;
    status: string; // e.g., 'Delivered', 'Cancelled', 'On the way'
    deliveryDate: string; // or expected date
    imageUrl?: string;
    price?: string;
    orderUrl: string;
    otp?: string;
    receiverName?: string;
    trackingId?: string;
    deliveryDetails?: string;
    address?: string;
    mobileLast4?: string;
    orderDate?: string;
    realtimeStatus?: string;
}

export interface AccountsData {
    accounts: Account[];
}

/**
 * Simple Promise-based queue to serialize database operations
 */
let saveQueue: Promise<void> = Promise.resolve();

/**
 * Load accounts from cloud database with optional user filtering
 */
export async function loadAccounts(userId?: string): Promise<AccountsData> {
    const operation = async () => {
        try {
            const dbAccounts = await fetchAccountsFromCloud(userId);
            return { accounts: dbAccounts || [] };
        } catch (error) {
            console.error('[Accounts] Failed to load accounts from cloud:', error);
            return { accounts: [] };
        }
    };
    const result = saveQueue.then(operation);
    saveQueue = result.then(() => { }, () => { });
    return result;
}

export async function saveAccounts(account: Account) {
    const operation = async () => {

        const cookies = await fetchCookiesFromCloud(account.id, account.platform);

        if (cookies && cookies.length > 0) {
            await saveAccountsToDB(account);
            await saveCookies_DB(account.id, account.platform, cookies);
        } else {
            // [MODIFIED] For persistent partitions (Oppo/Realme), we might not have cookies.
            // Log warning but allow saving account metadata.
            console.warn(`[Accounts] Warning: No cookies found for account ${account.id}. Saving metadata only.`);
            await saveAccountsToDB(account);
        }
    };
    saveQueue = saveQueue.then(operation).catch(err => {
        console.error('[Accounts] Critical error in save queue:', err);
    });
    return saveQueue;
}
export async function getAccount(accountId: string): Promise<Account | undefined> {
    const id = accountId.toLowerCase().trim();
    return fetchAccountFromCloud(id);
}
export async function upsertAccount(
    input: Partial<Account> & { id: string; platform: Platform }
): Promise<Account> {
    const id = input.id.toLowerCase().trim();
    const now = new Date().toISOString();

    // Load existing account from DB (cloud only) - OPTIMIZED: Fetch only one
    const existing = await fetchAccountFromCloud(id);

    let resultAccount: Account;

    if (existing) {
        // UPDATE
        resultAccount = {
            ...existing,
            ...input,
            updatedAt: now,
            userId: input.userId ?? existing.userId
        };
    } else {
        // CREATE (no session assumed)
        resultAccount = {
            id,
            platform: input.platform,
            loginType: input.loginType ?? 'mobile',
            identifier: input.identifier ?? '',
            status: 'New',              // always New at creation
            createdAt: now,
            updatedAt: now,
            userId: input.userId,
            proxyOffset: input.proxyOffset,
            proxy: input.proxy
        };
    }

    // 🔥 SAVE ONLY ACCOUNT METADATA TO DB
    await saveAccountsToDB(resultAccount);



    console.log(
        `[Accounts] ${existing ? 'Updated' : 'Created'} account ${id}`
    );

    return resultAccount;
}


export async function updateAccountStatus(
    accountId: string,
    status: AccountStatus,
    errorCode?: string
): Promise<void> {
    const data = await loadAccounts();
    const id = accountId.toLowerCase().trim();
    const account = data.accounts.find(a => a.id.toLowerCase() === id);
    if (account) {
        account.status = status;
        account.updatedAt = new Date().toISOString();
        if (status === 'Healthy') {
            account.lastValidateAt = account.updatedAt;
            delete account.errorCode;
        } else if (errorCode) {
            account.errorCode = errorCode;
        }
        await saveAccounts(account);
        pushAccount(account).catch(e => console.error('[Accounts] Background status update failed:', e));
    }
}

export async function updateLastLogin(accountId: string): Promise<void> {
    const data = await loadAccounts();
    const id = accountId.toLowerCase().trim();
    const account = data.accounts.find(a => a.id.toLowerCase() === id);
    if (account) {
        account.lastLoginAt = new Date().toISOString();
        account.lastValidateAt = account.lastLoginAt;
        account.updatedAt = account.lastLoginAt;
        account.status = 'Healthy';
        delete account.errorCode;
        await saveAccounts(account);
        pushAccount(account).catch(e => console.error('[Accounts] Background login update failed:', e));
    }
}

export async function getAccountsByPlatform(platform: Platform): Promise<Account[]> {
    const data = await loadAccounts();
    return data.accounts.filter(a => a.platform === platform);
}

export async function getAllAccountIds(): Promise<string[]> {
    const data = await loadAccounts();
    return data.accounts.map(a => a.id);
}

export async function deleteAccount(accountId: string): Promise<boolean> {
    const id = accountId.toLowerCase().trim();
    const data = await loadAccounts();

    // Find the account first to get platform details for cleanup
    const account = data.accounts.find(a => a.id.toLowerCase() === id);

    if (!account) return false;

    // Remove from in-memory list
    data.accounts = data.accounts.filter(a => a.id.toLowerCase() !== id);

    // Cloud Delete (Background)
    // This deletes: accounts row, cookies row, local_storage row, fingerprints row
    deleteAccountFromCloud(id).catch(e => console.error('[Accounts] Background cloud delete failed:', e));

    // Local Cleanup
    try {
        // 0. Delete Fingerprint (Cloud/Local if applicable)
        deleteFingerprint(id).catch(e => console.error('[Accounts] Failed to delete fingerprint:', e));
        // 1. Delete Cookie File
        // Naming convention: {id}_{platform}.json
        if (account.platform) {
            const cookiePath = path.join(COOKIES_DIR, `${id}_${account.platform}.json`);
            if (await fs.pathExists(cookiePath)) {
                await fs.remove(cookiePath);
                console.log(`[Accounts] Deleted local cookie file: ${cookiePath}`);
            }
        }

        // 2. Delete Browser Profile Directory
        // Path: profiles/{platform}/{id}
        if (account.platform) {
            const profilePath = path.join(PROFILES_DIR, account.platform, id);
            if (await fs.pathExists(profilePath)) {
                await fs.remove(profilePath);
                console.log(`[Accounts] Deleted persistent profile directory: ${profilePath}`);
            }
        }

    } catch (e) {
        console.warn('Cleanup warning:', e);
    }

    console.log(`[Accounts] Deleted account ${id} (and associated data)`);
    return true;
}

export async function moveAccounts(accountIds: string[], targetUserId: string): Promise<number> {
    if (!accountIds || accountIds.length === 0) return 0;

    try {
        // Use bulk update for efficiency and data consistency
        await updateAccountOwnershipInDB(accountIds, targetUserId);
        return accountIds.length;
    } catch (e: any) {
        console.error('[Accounts] Failed to move accounts:', e);
        throw e;
    }
}
