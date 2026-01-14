import { chromium, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { PROFILES_DIR } from './config.js';
import { generateFingerprint } from './fingerprint.js';
import logger, { getAccountLogger } from './log.js';
import { loadCookiesFromDisk, extractAndSaveCookies, adaptCookiesForShopsy } from './cookies.js';
import { browsers } from './browserManager.js';
import { pushCookies, fetchCookiesFromCloud, fetchLocalStorage } from './cloud.js';
import { loadLocalStorage, saveLocalStorage } from './localStorage.js';

export interface SessionOptions {
    accountId: string;
    platform: 'flipkart' | 'shopsy';
}

/**
 * Opens a browser session with pre-injected cookies for viewing logged-in state.
 * For Shopsy, uses Flipkart cookies adapted to shopsy.in domain.
 */
export async function openSession(options: SessionOptions) {
    const { accountId, platform } = options;
    const log = getAccountLogger(accountId);

    const url = platform === 'flipkart'
        ? 'https://www.flipkart.com'
        : 'https://www.shopsy.in';

    // Normalize to lowercase for consistent profile paths (macOS is case-insensitive)
    const normalizedId = accountId.toLowerCase().trim();
    const profilePath = path.join(PROFILES_DIR, platform, normalizedId, 'userDataDir');
    const fingerprint = generateFingerprint(platform, accountId);
    const lockFile = path.join(profilePath, 'SingletonLock');

    log.info(`Opening ${platform} session for ${accountId}`);

    // Proactive unlock
    try {
        if (await fs.pathExists(lockFile)) {
            await fs.remove(lockFile);
        }
    } catch (err) { }

    // FORCE FRESH PROFILE for debugging:
    // This ensures we are testing the JSON cookies purely, without interference from stale browser cache.
    if (await fs.pathExists(profilePath)) {
        await fs.emptyDir(profilePath);
        log.info('[DEBUG-ANTIGRAVITY] cleared profile directory for fresh cookie test.');
    }

    let context: BrowserContext;

    try {
        log.info(`[DEBUG-ANTIGRAVITY] Launching with UA: ${fingerprint.userAgent}`);
        context = await chromium.launchPersistentContext(profilePath, {
            headless: false,
            viewport: fingerprint.viewport,
            userAgent: fingerprint.userAgent,
            locale: fingerprint.locale,
            timezoneId: fingerprint.timezoneId,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox'
            ]
        });
    } catch (e: any) {
        const errorMsg = String(e.message || e);
        if (errorMsg.includes('ProcessSingleton') || errorMsg.includes('SingletonLock')) {
            try {
                if (await fs.pathExists(lockFile)) {
                    await fs.remove(lockFile);
                }
            } catch (err) { }

            context = await chromium.launchPersistentContext(profilePath, {
                headless: false,
                viewport: fingerprint.viewport,
                userAgent: fingerprint.userAgent,
                locale: fingerprint.locale,
                timezoneId: fingerprint.timezoneId,
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox'
                ]
            });
        } else {
            throw e;
        }
    }

    browsers.register(`${accountId}-${platform}-session`, context);

    // Load and inject cookies - try cloud DB first, then local disk
    try {
        let cookies: any[] = [];

        if (platform === 'shopsy') {
            // For Shopsy: First try cloud DB
            cookies = await fetchCookiesFromCloud(accountId, 'shopsy');

            if (cookies.length === 0) {
                // Try local disk
                cookies = await loadCookiesFromDisk(accountId, 'shopsy');
            }

            if (cookies.length === 0) {
                // Fallback: Try adapting Flipkart cookies from cloud
                const flipkartCookies = await fetchCookiesFromCloud(accountId, 'flipkart');
                if (flipkartCookies.length > 0) {
                    cookies = adaptCookiesForShopsy(flipkartCookies);
                    log.info(`Adapted ${cookies.length} Flipkart cookies from cloud for Shopsy`);
                } else {
                    // Final fallback: local Flipkart cookies
                    const localFlipkart = await loadCookiesFromDisk(accountId, 'flipkart');
                    if (localFlipkart.length > 0) {
                        cookies = adaptCookiesForShopsy(localFlipkart);
                        log.info(`Adapted ${cookies.length} local Flipkart cookies for Shopsy`);
                    }
                }
            } else {
                log.info(`Found ${cookies.length} Shopsy cookies`);
            }
        } else {
            // For Flipkart: Try cloud DB first (User Request)
            cookies = await fetchCookiesFromCloud(accountId, 'flipkart');

            if (cookies.length === 0) {
                // Fallback to local disk
                cookies = await loadCookiesFromDisk(accountId, 'flipkart');
                log.info(`Loaded ${cookies.length} Flipkart cookies from local disk`);
            } else {
                log.info(`Loaded ${cookies.length} Flipkart cookies from cloud DB`);
            }
        }

        if (cookies.length > 0) {
            // Sanitize cookies and FORCE correct security attributes for critical auth cookies
            const cleanCookies = cookies.map(c => {
                const clean = { ...c };
                // Ensure domain starts with dot 
                if (clean.domain === 'www.flipkart.com') clean.domain = '.flipkart.com';

                // Force secure authentication cookies - REMOVED: Trusting origin attributes
                // Flipkart's 'at', 'SN', 'S' cookies MUST be strict/secure to work properly
                // if (['at', 'SN', 'S', 'T'].includes(clean.name)) {
                //    clean.secure = true;
                //    // 'None' is often required for these, but 'Lax' might work. 
                //    // Matching the working 'sonalinayak' profile which has 'None'.
                //    clean.sameSite = 'None';
                // }
                return clean;
            });

            // Critical Debug: Log auth cookies specifically
            const authCookies = cleanCookies.filter(c => ['at', 'S', 'SN'].includes(c.name));
            log.info(`DEBUG AUTH COOKIES (Fixed): ${JSON.stringify(authCookies)}`);

            // Log summary of all cookies
            const summary = cleanCookies.map(c => `${c.name} (exp: ${c.expires}, sec: ${c.secure}, ss: ${c.sameSite}, dom: ${c.domain})`).join(', ');
            log.info(`DEBUG ALL COOKIES: ${summary}`);

            await context.addCookies(cleanCookies);
            log.info(`Injected ${cleanCookies.length} sanitized cookies`);

            console.log(`[DEBUG-ANTIGRAVITY] session.ts: Injected ${cleanCookies.length} cookies.`);
            const ctxCookies = await context.cookies();
            console.log(`[DEBUG-ANTIGRAVITY] session.ts: Verification in context: ${ctxCookies.length} cookies found.`);
            console.log(`[DEBUG-ANTIGRAVITY] session.ts: Context Cookie Names: ${ctxCookies.map(c => c.name).join(', ')}`);
        } else {
            log.warn('No saved cookies found. Session may not be logged in.');
            console.log('[DEBUG-ANTIGRAVITY] session.ts: No saved cookies found to inject.');
        }
    } catch (e: any) {
        log.warn(`Failed to load/inject cookies: ${e.message}`);
    }

    // INJECT LOCAL STORAGE (New)
    try {
        let lsData = await loadLocalStorage(accountId, platform);
        if (!lsData) {
            log.info(`[Session] Local Storage not found on disk, fetching from cloud...`);
            lsData = await fetchLocalStorage(accountId, platform);
        }

        if (lsData) {
            log.info(`Injecting Local Storage data for ${accountId}...`);
            await context.addInitScript((data) => {
                const hostname = window.location.hostname;
                console.log(`[ANTIGRAVITY-BROWSER] InitScript running on: ${hostname} (href: ${window.location.href})`);

                if (hostname.includes('flipkart') || hostname.includes('shopsy')) {
                    console.log(`[ANTIGRAVITY-BROWSER] Creating localStorage entries: ${Object.keys(data).length}`);
                    for (const [key, value] of Object.entries(data)) {
                        window.localStorage.setItem(key, value as string);
                    }
                } else {
                    console.log('[ANTIGRAVITY-BROWSER] Hostname specific check failed. Skipping LS injection.');
                }
            }, lsData);
        }
    } catch (e: any) {
        log.warn(`Failed to inject Local Storage: ${e.message}`);
    }

    // Navigate to platform
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    log.info(`${platform} session opened. Browser will stay open for use.`);

    // VERIFY LOGIN STATE
    const isLoggedIn = await Promise.race([
        page.waitForSelector('text=My Profile', { timeout: 3000 }).then(() => true).catch(() => false),
        page.waitForSelector('text=Logout', { timeout: 3000 }).then(() => true).catch(() => false),
        page.waitForSelector('text=Orders', { timeout: 3000 }).then(() => true).catch(() => false),
        page.waitForSelector('._28p97w', { timeout: 3000 }).then(() => true).catch(() => false),
        new Promise(r => setTimeout(() => r(false), 3500))
    ]);

    if (isLoggedIn) {
        log.info('[DEBUG-ANTIGRAVITY] PAGE STATE: LOGGED IN (Selector matched)');
    } else {
        log.info('[DEBUG-ANTIGRAVITY] PAGE STATE: LOGGED OUT (No text="My Profile" etc found)');

        // Check for Login button
        const loginBtn = await page.getByRole('link', { name: 'Login' }).first().isVisible().catch(() => false);
        log.info(`[DEBUG-ANTIGRAVITY] Login Button Visible: ${loginBtn}`);
    }

    // PERIODIC LOCAL STORAGE SAVE (New)
    // Save every 5 seconds to ensure we capture session tokens
    const saveInterval = setInterval(async () => {
        try {
            if (page.isClosed()) return;
            const ls = await page.evaluate(() => JSON.stringify(window.localStorage));
            if (ls && ls !== '{}') {
                await saveLocalStorage(accountId, JSON.parse(ls), platform);
            }
        } catch (e) {
            // Ignore errors (page might be closing)
        }
    }, 5000);

    log.info(`${platform} session opened. Browser will stay open for use.`);
    context.on('close', async () => {
        clearInterval(saveInterval); // Stop polling
        log.info('Session browser closed. Attempting to save cookies & local storage...');
        try {
            // Save cookies
            await extractAndSaveCookies(context, accountId, platform);
            await pushCookies(accountId, platform);

            // Save Local Storage (New)
            // We need to have kept a reference to the page, or we need to be careful.
            // Actually, if context is closed, we can't get LS. 
            // We need to capture LS *before* close or periodically.
            // But since this event implies it's already closed/closing, we might miss it if we don't have an open page.
            // The `close` event happens when the user closes the window. Playwright might still have access if it's the `browser` closing vs `context`. 
            // PersistentContext 'close' means it's gone.

            // BETTER STRATEGY: We can't get LS after close.
            // We rely on the user manually triggering a "Save" or we just hope cookies are enough?
            // NO, we need to save.

            // Allow manual save via a specific call? Or maybe we can attach a listener to 'page' close?
            // For now, let's just log that we saved cookies. 
            // Realistically, to save LS, we need to poll or have a specific "Save Session" button in UI.
            // OR we can try to get it if there are any pages left? No, close means 0 pages.

            log.info('Cookies re-saved on session close.');
        } catch (e: any) {
            log.warn(`Could not re-save cookies: ${e.message}`);
        }
    });

    return { status: 'success', message: `${platform} session opened with saved cookies` };
}
