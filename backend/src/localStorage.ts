import fs from 'fs-extra';
import path from 'path';
import { DATA_DIR } from './config.js';
import { pushLocalStorage, fetchLocalStorage as fetchLocalStorageFromCloud } from './cloud_provider.js';

const STORAGE_DIR = path.join(DATA_DIR, 'storage');

export async function ensureStorageDir() {
    await fs.ensureDir(STORAGE_DIR);
}

export function getStorageFilePath(accountId: string, platform: string = 'flipkart') {
    const id = accountId.toLowerCase().trim();
    return path.join(STORAGE_DIR, `${id}_${platform}.json`);
}

/**
 * Save Local Storage data - saves to DB directly
 */
export async function saveLocalStorage(accountId: string, data: Record<string, string>, platform: string = 'flipkart') {
    // Save to cloud DB directly (Bypassing disk write)
    await pushLocalStorage(accountId, platform, data);
}

/**
 * Load Local Storage data from database ONLY (no file fallback)
 */
export async function loadLocalStorage(accountId: string, platform: string = 'flipkart'): Promise<Record<string, string> | null> {
    try {
        const data = await fetchLocalStorageFromCloud(accountId, platform);
        if (data) {
            console.log(`[LocalStorage] Loaded from DB for ${accountId} (${platform})`);
            return data;
        }
        console.log(`[LocalStorage] No data found in DB for ${accountId} (${platform})`);
        return null;
    } catch (e: any) {
        console.error(`[LocalStorage] DB fetch failed for ${accountId}: ${e.message}`);
        return null;
    }
}

