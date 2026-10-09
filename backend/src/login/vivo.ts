import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { PROFILES_DIR } from '../config.js';
import { generateFingerprint, Fingerprint } from '../fingerprint.js';
import logger, { getAccountLogger } from '../log.js';
import { saveProfileToDisk } from '../profiles/store.js';
import { injectOverlay } from '../overlay.js';
import { extractAndSaveCookies, getUnifiedCookies } from '../cookies.js';
import { getAccount, updateLastLogin, updateAccountStatus, upsertAccount } from '../accounts.js';
import { browsers } from '../browserManager.js';
import { pushCookies, pushLocalStorage, saveCookies_DB } from '../cloud_provider.js';
import { saveLocalStorage, loadLocalStorage } from '../localStorage.js';
import { getChromiumPath } from '../utils/browserPath.js';

export interface LoginOptions {
    accountId: string;
    identifier: string;
    headless?: boolean;
    keepOpen?: boolean;
}

const activeContexts = new Map<string, BrowserContext>();

/**
 * Robust check if Vivo is logged in
 */
async function checkVivoLogin(page: Page, context: BrowserContext): Promise<boolean> {
    try {
        // Method 1: Check JS variable (most reliable for desktop)
        const jsLoginCheck = await page.evaluate(() => {
            return (window as any).vpgParam?.isUserLogin === 'true';
        }).catch(() => false);

        if (jsLoginCheck) return true;

        // Method 2: Check for "My Account" or "Logout" - handle both desktop/mobile selectors
        const checks = await Promise.all([
            page.locator('li.pc-account-item').first().isVisible().catch(() => false),
            page.locator('li.pc-logout-item').first().isVisible().catch(() => false),
            page.locator('text=My Account').first().isVisible().catch(() => false),
            page.locator('text=Logout').first().isVisible().catch(() => false),
            // Mobile specific selectors observed in screenshots
            page.locator('.userInfo img.nav-avatar').first().isVisible().catch(() => false),
        ]);

        if (checks.some(c => c === true)) return true;

        // Method 3: Auth Cookie Check
        const cookies = await context.cookies();
        if (cookies.some(c => c.name === 'vivo_account_cookie_iqoo_authtoken')) return true;

        // NEGATIVE CHECK: If "Sign in/Register" is explicitly visible, we are NOT logged in
        const guestVisible = await Promise.race([
            page.locator('text=Sign in/Register').first().isVisible().catch(() => false),
            page.locator('text=Login/Register').first().isVisible().catch(() => false),
        ]);

        if (guestVisible) return false;

    } catch (e) { }
    return false;
}

/**
 * Vivo Login Flow (BBK Group - same backend as iQOO)
 * 🔴 BUCKET A: Electron-Persistent - NO cookie replay allowed
 */
export async function loginVivo(options: LoginOptions) {
    const { accountId, identifier, headless = false, keepOpen = false } = options;
    const log = getAccountLogger(accountId);
    const platform = 'vivo';

    if (activeContexts.has(accountId)) {
        const existingContext = activeContexts.get(accountId)!;
        if (existingContext.pages().length > 0 && !existingContext.pages()[0].isClosed()) {
            log.info('Browser already open for this account. Reusing/Ignoring launch.');
            return { status: 'success', message: 'Browser already open' };
        }
        activeContexts.delete(accountId);
    }

    const normalizedId = accountId.toLowerCase().trim();
    const profilePath = path.join(PROFILES_DIR, platform, normalizedId, 'userDataDir');
    await fs.ensureDir(profilePath);

    // Manage Fingerprint
    const account = await getAccount(accountId);
    let fingerprint: Fingerprint;

    if (account?.details?.fingerprint) {
        log.info('Reusing existing fingerprint from DB.');
        fingerprint = account.details.fingerprint;
    } else {
        log.info('No fingerprint found. Generating and locking new fingerprint.');
        fingerprint = generateFingerprint(platform, accountId);
        await upsertAccount({
            id: accountId,
            platform,
            details: { ...(account?.details || {}), fingerprint }
        });
    }

    // NO PROXY for login - direct connection for speed
    log.info(`Launching Vivo browser (DIRECT - no proxy for speed)...`);
    const executablePath = getChromiumPath();

    const context = await chromium.launchPersistentContext(profilePath, {
        executablePath,
        headless: headless,
        viewport: null,
        userAgent: fingerprint.userAgent,
        locale: fingerprint.locale,
        timezoneId: fingerprint.timezoneId,
        permissions: ['geolocation', 'notifications'],
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--window-size=1280,720',
            '--disable-features=Autofill,PasswordManager',
            '--disable-save-password-bubble'
        ]
    });

    activeContexts.set(accountId, context);
    browsers.register(`${accountId}-vivo-login`, context);

    try {
        // Inject LocalStorage BEFORE page runs
        const savedLs = await loadLocalStorage(accountId, platform);
        if (savedLs) {
            log.info('Injecting LocalStorage before JS execution...');
            await context.addInitScript((data) => {
                for (const [key, value] of Object.entries(data)) {
                    window.localStorage.setItem(key, value as string);
                }
            }, savedLs);
        }

        // Inject Cookies BEFORE page loads
        const savedCookies = await getUnifiedCookies(accountId, platform);
        if (savedCookies.length > 0) {
            log.info(`Injecting ${savedCookies.length} cookies before navigation...`);
            await context.addCookies(savedCookies);
        }

        const page = await context.newPage();
        await injectOverlay(page, platform);

        log.info('Navigating to Vivo India...');
        await page.goto('https://www.vivo.com/in', { waitUntil: 'domcontentloaded' });

        let isLoggedIn = await checkVivoLogin(page, context);
        log.info(`Initial login check: ${isLoggedIn}`);

        if (isLoggedIn) {
            log.info('Session verified. User is already logged in.');
        } else {
            log.info('Manual login required. Please login in the browser window.');
            log.info('>>> Click on person icon -> Sign in/Register -> Complete login');

            // Wait for login detection using polling
            const startTime = Date.now();
            const timeout = keepOpen ? 0 : 300000; // 5 mins

            while (!isLoggedIn) {
                if (timeout !== 0 && Date.now() - startTime > timeout) {
                    throw new Error('Login timed out.');
                }

                if (page.isClosed()) throw new Error('Browser closed by user.');

                isLoggedIn = await checkVivoLogin(page, context);
                if (isLoggedIn) break;

                await page.waitForTimeout(3000); // Poll every 3 seconds
            }
            log.info('Login detected!');
        }

        // Capture cookies and LS after login
        if (isLoggedIn) {
            log.info('Waiting for auth API calls and settlement (10s)...');
            await page.waitForTimeout(10000);

            log.info('Capturing cookies NOW...');
            const cookies = await extractAndSaveCookies(context, accountId, platform);
            
            // STRICT PRE-LOGIN GUARD:
            // Ensure we actually got the main authentication token before saving anything to the cloud.
            // If we didn't, it means it's a false positive or partial login.
            const hasAuthToken = cookies.some((c: any) => c.name === 'vivo_account_cookie_iqoo_authtoken');
            if (!hasAuthToken) {
                 log.error('❌ Login appeared successful but main auto token is missing. Aborting save.');
                 throw new Error('Incomplete login: Auth token missing');
            }

            const httpOnlyCookies = cookies.filter((c: any) => c.httpOnly);
            log.info(`[CAPTURE] ✅ Saved ${cookies.length} cookies | HttpOnly: ${httpOnlyCookies.length}`);
            await pushCookies(accountId, platform);

            try {
                const ls = await page.evaluate(() => JSON.stringify(window.localStorage));
                if (ls && ls !== '{}') {
                    await saveLocalStorage(accountId, JSON.parse(ls), platform);
                    await pushLocalStorage(accountId, platform);
                    log.info('LocalStorage captured and synced.');
                }
            } catch (e: any) {
                log.warn(`LS capture failed: ${e.message}`);
            }

            setupBackgroundSync(page, context, accountId, platform, log);
        }

        log.info('Vivo session initialization complete.');

        if (!keepOpen) {
            await context.close();
            await saveProfileToDisk(platform, accountId);
            log.info('Profile saved and browser closed.');
        }

        await updateLastLogin(accountId);
        return { status: 'success', message: 'Vivo Session Ready' };

    } catch (err: any) {
        log.error(`Vivo login flow failed: ${err.message}`);
        await updateAccountStatus(accountId, 'Error', String(err.message));
        if (!keepOpen) await context.close().catch(() => { });
        throw err;
    }
}

function setupBackgroundSync(page: Page, context: BrowserContext, accountId: string, platform: string, log: any) {
    let lastCookieHash = '';
    let lastLsHash = '';

    const syncInterval = setInterval(async () => {
        try {
            if (page.isClosed()) {
                clearInterval(syncInterval);
                return;
            }

            // LOGIN GUARD: Only sync if we are still logged in
            const isLoggedIn = await checkVivoLogin(page, context);
            if (!isLoggedIn) {
                if (page.url().includes('login') || page.url().includes('passport')) return;
                return;
            }

            const ls = await page.evaluate(() => JSON.stringify(window.localStorage));
            if (ls && ls !== '{}') {
                const lsHash = Buffer.from(ls).toString('base64').slice(0, 50);
                if (lsHash !== lastLsHash) {
                    lastLsHash = lsHash;
                    await saveLocalStorage(accountId, JSON.parse(ls), platform);
                    await pushLocalStorage(accountId, platform);
                }
            }

            const cookies = await context.cookies();
            const cookieStr = cookies.map(c => `${c.name}=${c.value}`).sort().join('|');
            const cookieHash = Buffer.from(cookieStr).toString('base64').slice(0, 50);

            if (cookieHash !== lastCookieHash) {
                lastCookieHash = cookieHash;
                await saveCookies_DB(accountId, platform, cookies);
            }
        } catch (e) { }
    }, 10000);

    context.on('close', () => clearInterval(syncInterval));
}
