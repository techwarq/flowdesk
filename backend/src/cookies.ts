import { BrowserContext } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { DATA_DIR } from './config.js';
import { pushCookies, fetchCookiesFromCloud, saveCookies_DB, fetchAccountFromCloud, saveAccountsToDB } from './cloud_provider.js';
import logger from './log.js';


const COOKIES_DIR = path.join(DATA_DIR, 'cookies');

export async function ensureCookiesDir() {
    await fs.ensureDir(COOKIES_DIR);
}

/**
 * Get cookie file path
 */
export function getCookieFilePath(accountId: string, platform: string = 'flipkart') {
    const id = accountId.toLowerCase().trim();
    return path.join(COOKIES_DIR, `${id}_${platform}.json`);
}

/**
 * Load cookies from database ONLY (no file fallback)
 * This is the preferred method for loading cookies.
 * 
 * Note: Flipkart and Shopsy share authentication, so if Shopsy cookies are not found,
 * we fall back to Flipkart cookies (and vice versa).
 */
export async function loadCookiesFromDB(accountId: string, platform: string = 'flipkart') {
    // Try cloud database - NO FALLBACK to disk
    try {
        // First try to get cookies for the requested platform
        let dbCookies = await fetchCookiesFromCloud(accountId, platform);
        if (dbCookies && dbCookies.length > 0) {
            logger.debug(`[Cookies] Loaded ${dbCookies.length} cookies from DB for ${accountId} (${platform})`);
            return dbCookies;
        }

        // Flipkart and Shopsy share authentication - try the other platform as fallback
        if (platform === 'flipkart' || platform === 'shopsy') {
            const fallbackPlatform = platform === 'shopsy' ? 'flipkart' : 'shopsy';
            dbCookies = await fetchCookiesFromCloud(accountId, fallbackPlatform);
            if (dbCookies && dbCookies.length > 0) {
                logger.info(`[Cookies] Loaded ${dbCookies.length} cookies from DB for ${accountId} (fallback from ${fallbackPlatform})`);
                return dbCookies;
            }
        }

        logger.debug(`[Cookies] No cookies found in DB for ${accountId} (${platform})`);
        return [];
    } catch (e: any) {
        logger.error(`[Cookies] DB fetch failed for ${accountId}: ${e.message}`);
        return [];
    }
}

/**
 * Load cookies from disk and sanitize for Playwright
 */
export async function loadCookiesFromDisk(accountId: string, platform: string = 'flipkart') {
    const file = getCookieFilePath(accountId, platform);
    console.log(`[Cookies] loadCookiesFromDisk reading from: ${file}`);
    if (await fs.pathExists(file)) {
        const cookies = await fs.readJSON(file);
        console.log(`[Cookies] Read ${cookies.length} raw cookies from disk.`);
        // Sanitize cookies for Playwright - sameSite must be "Strict", "Lax", or "None"
        return cookies.map((c: any) => {
            const sanitized = { ...c };
            // Fix sameSite value
            // Fix sameSite value
            if (sanitized.sameSite === 'no_restriction') {
                sanitized.sameSite = 'None';
                sanitized.secure = true;
            } else if (sanitized.sameSite === 'None') {
                // Keep None, ensure Secure is true
                sanitized.secure = true;
            } else if (!sanitized.sameSite || !['Strict', 'Lax', 'None'].includes(sanitized.sameSite)) {
                sanitized.sameSite = 'Lax'; // Default to Lax if invalid
            }
            // Remove fields that Playwright doesn't accept
            delete sanitized.hostOnly;
            delete sanitized.session;
            delete sanitized.storeId;
            return sanitized;
        });
    }
    return [];
}

/**
 * Save cookies to disk
 */
export async function saveCookiesToDisk(accountId: string, cookies: any[], platform: string = 'flipkart') {
    await ensureCookiesDir();
    const file = getCookieFilePath(accountId, platform);
    await fs.writeJSON(file, cookies, { spaces: 2 });
    // Attempt cloud sync
    pushCookies(accountId, platform);
}

/**
 * Extracts cookies from the context and saves them directly to DB (DB-only)
 */
export async function extractAndSaveCookies(context: BrowserContext, accountId: string, platform: string = 'flipkart') {
    const id = accountId.toLowerCase().trim();

    let cookies: any[] = [];
    // Retry up to 5 times with a 1s delay
    for (let i = 0; i < 5; i++) {
        cookies = await context.cookies();
        // Look for common auth cookies
        if (cookies.length > 5) {
            console.log(`[Cookies] [${platform}] Found ${cookies.length} cookies on attempt ${i + 1}`);
            break;
        }
        console.log(`[Cookies] [${platform}] Attempt ${i + 1}: Only ${cookies.length} cookies found. Retrying...`);
        await new Promise(r => setTimeout(r, 1000));
    }

    if (cookies.length === 0) {
        throw new Error(`No cookies found in browser context for ${id} on ${platform}.`);
    }

    // Push directly to DB
    try {
        // Ensure account exists to satisfy foreign key constraint (using cloud.ts directly)
        const existingAccount = await fetchAccountFromCloud(id);
        if (!existingAccount) {
            console.log(`[Cookies] Account ${id} not found in DB. Creating placeholder before saving cookies...`);
            await saveAccountsToDB({
                id: id,
                platform: platform,
                identifier: id,
                status: 'New'
            });
        }

        await saveCookies_DB(id, platform, cookies);
        console.log(`[Cookies] Saved ${cookies.length} cookies to Cloud DB for ${id} (${platform})`);
    } catch (e: any) {
        console.error(`[Cookies] Cloud save failed for ${id}: ${e.message}`);
        throw e; // Re-throw to ensure caller knows save failed
    }

    return cookies;
}

/**
 * Loads Flipkart cookies, adapts them for Shopsy, and injects them.
 */
export async function injectFlipkartCookiesIntoShopsy(context: BrowserContext, accountId: string) {
    // Load from DB instead of disk
    const flipkartCookies = await loadCookiesFromDB(accountId, 'flipkart');
    if (!flipkartCookies || flipkartCookies.length === 0) return false;

    const shopsyCookies = adaptCookiesForShopsy(flipkartCookies);
    await context.addCookies(shopsyCookies);
    return true;
}

/**
 * Adapt cookies from flipkart.com to shopsy.in
 */
export function adaptCookiesForShopsy(cookies: any[]) {
    return cookies.map((c: any) => {
        const newCookie = { ...c };
        delete newCookie.hostOnly;
        delete newCookie.session;

        // Convert flipkart domains to shopsy
        if (c.domain.includes('flipkart.com')) {
            newCookie.domain = '.shopsy.in';
        }

        // Shopsy mobile web often requires Secure/None for session cookies to work across domains/subdomains
        if (['at', 'S', 'SN', 'T'].includes(c.name)) {
            newCookie.secure = true;
            newCookie.sameSite = 'None';
        }

        return newCookie;
    });
}

/**
 * Adapt cookies from shopsy.in to flipkart.com
 */
export function adaptCookiesForFlipkart(cookies: any[]) {
    return cookies.map((c: any) => {
        const newCookie = { ...c };
        delete newCookie.hostOnly;
        delete newCookie.session;

        // Convert shopsy domains to flipkart
        if (c.domain.includes('shopsy.in')) {
            newCookie.domain = '.flipkart.com';
        }

        // Auth cookies
        if (['at', 'S', 'SN', 'T'].includes(c.name)) {
            newCookie.secure = true;
            newCookie.sameSite = 'None';
        }

        return newCookie;
    });
}

/**
 * Get a unified set of cookies for both Flipkart and Shopsy.
 * This ensures that a login on one platform is reflected on the other.
 */
export async function getUnifiedCookies(accountId: string, platformHint?: string) {
    try {
        // For non-Flipkart/Shopsy platforms, just fetch that platform's cookies (AND SANITIZE)
        if (platformHint && platformHint !== 'flipkart' && platformHint !== 'shopsy') {
            const platformCookies = await fetchCookiesFromCloud(accountId, platformHint);
            logger.info(`[Cookies] Loaded ${platformCookies.length} cookies for ${accountId} (${platformHint})`);
            return sanitizeCookies(platformCookies, platformHint);
        }

        // 1. Fetch from BOTH buckets (Flipkart/Shopsy)
        const [fkCookies, shCookies] = await Promise.all([
            fetchCookiesFromCloud(accountId, 'flipkart'),
            fetchCookiesFromCloud(accountId, 'shopsy')
        ]);

        const allCookies: any[] = [];
        const seen = new Set<string>();

        const addUnique = (cookies: any[]) => {
            cookies.forEach(c => {
                const key = `${c.domain}|${c.path}|${c.name}`;
                if (!seen.has(key)) {
                    allCookies.push(c);
                    seen.add(key);
                }
            });
        };

        // 2. Add original Flipkart cookies and their Shopsy adaptations
        if (fkCookies && fkCookies.length > 0) {
            addUnique(fkCookies);
            addUnique(adaptCookiesForShopsy(fkCookies));
        }

        // 3. Add original Shopsy cookies and their Flipkart adaptations
        if (shCookies && shCookies.length > 0) {
            addUnique(shCookies);
            addUnique(adaptCookiesForFlipkart(shCookies));
        }

        logger.info(`[Cookies] Unified ${allCookies.length} cookies for ${accountId} (FK: ${fkCookies?.length || 0}, SH: ${shCookies?.length || 0})`);
        return sanitizeCookies(allCookies, 'flipkart'); // Use flipkart/shopsy logic (mostly same)
    } catch (e: any) {
        logger.error(`[Cookies] Unified fetch failed for ${accountId}: ${e.message}`);
        // Fallback to simpler load if unified fails
        const fallback = await loadCookiesFromDB(accountId, platformHint || 'flipkart');
        return sanitizeCookies(fallback, platformHint || 'flipkart');
    }
}

/**
 * Sanitize cookies for injection (Force Secure, Wildcard Domains)
 * This prevents "EXCLUDE_OVERWRITE_SECURE" errors and ensures session persistence.
 */
/**
 * Sanitize cookies for injection (Force Secure, Wildcard Domains)
 * This prevents "EXCLUDE_OVERWRITE_SECURE" errors and ensures session persistence.
 */
export function sanitizeCookies(cookies: any[], platform: string) {
    if (!cookies || !Array.isArray(cookies)) return [];

    let filteredCookies = cookies;
    if (platform === 'realme') {
        const allowed = ['accessToken', 'acIdAuthSession', 'hadViewApp', 'nickname', 'RMID'];
        filteredCookies = cookies.filter(c => allowed.includes(c.name));
    }

    return filteredCookies.map(c => {
        const clean = { ...c };

        // Normalize sameSite values from various sources
        if (clean.sameSite === 'no_restriction' || clean.sameSite === 'None') {
            clean.sameSite = 'None';
        } else if (clean.sameSite === 'lax' || clean.sameSite === 'Lax') {
            clean.sameSite = 'Lax';
        } else if (clean.sameSite === 'strict' || clean.sameSite === 'Strict') {
            clean.sameSite = 'Strict';
        }

        // 1. Force Secure ONLY if specifically needed (e.g. SameSite=None)
        // Otherwise trust the cookie source (most are already secure)
        if (clean.sameSite === 'None') {
            clean.secure = true;
        }

        // 2. Platform Specific Domain Fixes
        if (platform === 'xiaomi') {
            if (clean.domain && (clean.domain.includes('mi.com') || clean.domain.includes('xiaomi.com'))) {
                if (clean.domain === 'mi.com') clean.domain = '.mi.com';
                if (clean.domain === 'xiaomi.com') clean.domain = '.xiaomi.com';
            }
        } else if (platform === 'iqoo') {
            if (clean.domain === 'iqoo.com') clean.domain = '.iqoo.com';
        } else if (platform === 'vivo') {
            if (clean.domain === 'vivo.com') clean.domain = '.vivo.com';
        } else if (platform === 'realme') {
            if (clean.domain && clean.domain.includes('realme.com') && !clean.domain.startsWith('.')) clean.domain = '.realme.com';

            // Repair corrupted cookies dynamically
            if (clean.name === 'accessToken') {
                clean.httpOnly = true;
                clean.secure = false;
                clean.sameSite = 'Lax';
            } else if (clean.name === 'acIdAuthSession') {
                clean.httpOnly = true;
                clean.secure = true;
                clean.sameSite = 'None';
            } else if (clean.name === 'nickname' || clean.name === 'RMID') {
                clean.httpOnly = false;
                clean.secure = true;
                clean.sameSite = 'Lax';
            }
        } else if (platform === 'oppo') {
            if (clean.domain === 'oppo.com') clean.domain = '.oppo.com';
        } else if (platform === 'oneplus') {
            if (clean.domain === 'oneplus.com') clean.domain = '.oneplus.com';
            if (clean.domain === 'oneplus.in') clean.domain = '.oneplus.in';
        } else if (platform === 'flipkart' || platform === 'shopsy') {
            if (clean.domain === 'www.flipkart.com') clean.domain = '.flipkart.com';
        }

        // 3. Forced Persistence Hack: 90 days
        const now = Date.now() / 1000;
        const currentExpiry = typeof clean.expires === 'number' ? clean.expires : clean.expirationDate;

        // If it's a session cookie or expiring soon, push it forward
        if (!currentExpiry || currentExpiry < now + (86400 * 30)) {
            // Only push forward if it's NOT already expired (security check)
            if (!currentExpiry || currentExpiry > now - 3600) {
                clean.expires = now + (86400 * 90);
            }
        }

        // 4. Remove incompatible fields
        delete clean.hostOnly;
        delete clean.session;
        delete clean.storeId;

        return clean;
    });
}
