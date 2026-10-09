import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { PROFILES_DIR, getProfileDir } from '../config.js';
import { generateFingerprint, Fingerprint } from '../fingerprint.js';
import logger, { getAccountLogger } from '../log.js';
import { saveProfileToDisk } from '../profiles/store.js';
import { injectOverlay } from '../overlay.js';
import { extractAndSaveCookies, loadCookiesFromDB, getUnifiedCookies } from '../cookies.js';
import { getAccount, updateLastLogin, updateAccountStatus, upsertAccount } from '../accounts.js';
import { browsers } from '../browserManager.js';
import { pushCookies, pushLocalStorage, saveCookies_DB } from '../cloud_provider.js';
import { saveLocalStorage, loadLocalStorage } from '../localStorage.js';
import { getProxyForAccount } from '../proxy.js';
import { getChromiumPath } from '../utils/browserPath.js';

export interface LoginOptions {
    accountId: string;
    identifier: string; // Phone or Email
    headless?: boolean;
    keepOpen?: boolean;
    forceFresh?: boolean;
}

const activeContexts = new Map<string, BrowserContext>();

/**
 * Robust check if iQOO is logged in
 */
async function checkIqooLogin(page: Page, context: BrowserContext): Promise<boolean> {
    try {
        // 1. Auth Cookie - The MOST reliable indicator
        const cookies = await context.cookies();
        if (cookies.some(c => c.name === 'vivo_account_cookie_iqoo_authtoken')) {
            return true;
        }

        // 2. Hover to reveal menu (Best effort for UI check)
        const profileIcon = page.locator('.vep-pc-account-image-box').first();
        if (await profileIcon.isVisible()) {
            await profileIcon.hover().catch(() => {});
            await page.waitForTimeout(800);
        }

        // 3. NEGATIVE CHECK: If "Sign in/Register" is visible, we are definitely NOT logged in
        const signInLink = page.locator('text=Sign in/Register').first();
        if (await signInLink.isVisible()) {
            return false;
        }

        // 4. POSITIVE CHECK: Look for "Logout" which is a strong UI indicator
        const logoutLink = page.locator('text=Logout').first();
        if (await logoutLink.isVisible()) {
            return true;
        }

    } catch (e) { }
    return false;
}

/**
 * iQOO Login Flow following strict checklist for session persistence.
 */
export async function loginIqoo(options: LoginOptions) {
    const { accountId, identifier, headless = false, keepOpen = false, forceFresh = false } = options;
    const log = getAccountLogger(accountId);
    const platform = 'iqoo';

    // Step 0: Check for active context
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

    if (forceFresh && await fs.pathExists(profilePath)) {
        log.info('Force fresh - clearing old iQOO profile...');
        await fs.remove(profilePath);
    }

    await fs.ensureDir(profilePath);

    // STEP 1 — Manage Fingerprint
    const account = await getAccount(accountId);
    let fingerprint: Fingerprint;

    if (account?.details?.fingerprint) {
        log.info('Reusing existing fingerprint from DB.');
        fingerprint = account.details.fingerprint;
    } else {
        log.info('No fingerprint found. Generating and locking new fingerprint.');
        fingerprint = generateFingerprint(platform, accountId);
        // Save fingerprint immediately to lock it to this account
        await upsertAccount({
            id: accountId,
            platform,
            details: {
                ...(account?.details || {}),
                fingerprint
            }
        });
    }

    log.info(`Launching iQOO browser (DIRECT - no proxy for speed)...`);
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
            '--disable-blink-features=AutomationControlled', // Critical for avoiding detection
            '--no-sandbox',
            '--window-size=1280,720',
            '--disable-features=Autofill,PasswordManager',
            '--disable-save-password-bubble'
        ]
    });

    activeContexts.set(accountId, context);
    browsers.register(`${accountId}-iqoo-login`, context);

    try {
        // STEP 9 — Inject LocalStorage BEFORE the page runs
        const savedLs = await loadLocalStorage(accountId, platform);
        if (savedLs) {
            log.info('Injecting LocalStorage...');
            await context.addInitScript((data) => {
                if (window.location.hostname.includes('iqoo.com')) {
                    for (const [key, value] of Object.entries(data)) {
                        window.localStorage.setItem(key, value as string);
                    }
                }
            }, savedLs);
        }

        // STEP 10 — Inject Cookies BEFORE the page loads
        const savedCookies = await getUnifiedCookies(accountId, platform);
        if (savedCookies.length > 0) {
            log.info(`Injecting ${savedCookies.length} cookies before navigation...`);
            await context.addCookies(savedCookies);
        }

        const page = await context.newPage();
        await injectOverlay(page, platform);

        // STEP 11 — Open the page
        log.info('Navigating to iQOO India...');
        await page.goto('https://www.iqoo.com/in', { waitUntil: 'domcontentloaded' });
        
        // Wait for page to settle and for possible redirects/JS execution
        await page.waitForTimeout(3000);

        // Initial check
        let isLoggedIn = await checkIqooLogin(page, context);

        if (isLoggedIn) {
            // Even if logged in, double check for token
            const cookies = await context.cookies();
            const hasAuthToken = cookies.some(c => c.name === 'vivo_account_cookie_iqoo_authtoken');
            if (hasAuthToken) {
                log.info('Session verified with Auth Token. User is already logged in.');
            } else {
                log.info('UI looks logged in but Auth Token missing. Treating as NOT logged in.');
                isLoggedIn = false;
            }
        }

        if (!isLoggedIn) {
            // STEP 3 — Let the user log in manually
            log.info('Manual login required. Waiting for user interaction...');

            // Clean up any existing "Sign in/Register" text to be sure
            // navigate to login page if we aren't there and dropdown is visible
            if (!page.url().includes('login') && !page.url().includes('passport')) {
                try {
                    const profileIcon = page.locator('.vep-pc-account-image-box').first();
                    if (await profileIcon.isVisible()) {
                        await profileIcon.hover();
                        await page.waitForTimeout(300);
                        const loginLink = page.locator('text=Sign in/Register').first();
                        if (await loginLink.isVisible()) {
                            await loginLink.click();
                        }
                    }
                } catch (e) { /* best effort navigation */ }
            }

            // Polling loop for login detection
            const startTime = Date.now();
            const timeout = keepOpen ? 0 : 300000; // 5 mins

            while (!isLoggedIn) {
                if (timeout !== 0 && Date.now() - startTime > timeout) {
                    throw new Error('Login timed out.');
                }

                if (page.isClosed()) throw new Error('Browser closed by user.');

                isLoggedIn = await checkIqooLogin(page, context);
                if (isLoggedIn) break;

                await page.waitForTimeout(2000); // Poll every 2 seconds
            }
            log.info('Login detected!');
        }

        // STEP 4 & 5 — Capture LocalStorage and Cookies AFTER login
        if (isLoggedIn) {
            log.info('Waiting for auth API calls to complete...');

            // Wait for profile/auth API call to ensure cookies are set
            try {
                await Promise.race([
                    page.waitForResponse(resp =>
                        resp.url().includes('/api/') &&
                        (resp.url().includes('user') || resp.url().includes('profile') || resp.url().includes('member')),
                    ),
                    page.waitForTimeout(5000) // Fallback timeout
                ]);
            } catch (e) {
                log.warn('Auth API call not detected, proceeding with capture...');
            }

            log.info('Settle time for session capture (5s)...');
            await page.waitForTimeout(5000);

            // === CRITICAL: SAVE COOKIES IMMEDIATELY (before any navigation that could fail) ===
            log.info('Capturing cookies NOW (before any risky operations)...');

            // Capture and save Cookies FIRST
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

            // Capture and save LS (current page)
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

            // Navigate to member page (OPTIONAL - may fail, but cookies already saved)
            try {
                log.info('Navigating to member page for additional cookies (optional)...');
                await page.goto('https://www.iqoo.com/in/member/index', { waitUntil: 'domcontentloaded', timeout: 10000 });
                await page.waitForTimeout(2000);

                // Capture any additional cookies from member page
                const memberCookies = await context.cookies();
                if (memberCookies.length > cookies.length) {
                    log.info(`Member page added ${memberCookies.length - cookies.length} more cookies. Saving...`);
                    await extractAndSaveCookies(context, accountId, platform);
                    await pushCookies(accountId, platform);
                }

                // Capture member page LS
                const memberLs = await page.evaluate(() => JSON.stringify(window.localStorage));
                if (memberLs && memberLs !== '{}') {
                    await saveLocalStorage(accountId, JSON.parse(memberLs), platform);
                    await pushLocalStorage(accountId, platform);
                }
            } catch (e: any) {
                log.warn(`Member page navigation failed (cookies already saved): ${e.message}`);
            }

            // STEP 13 — Background syncing
            setupBackgroundSync(page, context, accountId, platform, log);
        }

        // STEP 6 — Login phase is DONE
        log.info('iQOO session initialization complete.');

        if (!keepOpen) {
            await context.close();
            await saveProfileToDisk(platform, accountId);
            log.info('Profile saved and browser closed.');
        }

        await updateLastLogin(accountId);
        return { status: 'success', message: 'iQOO Session Ready' };

    } catch (err: any) {
        log.error(`iQOO login flow failed: ${err.message}`);
        await updateAccountStatus(accountId, 'Error', String(err.message));
        if (!keepOpen) await context.close().catch(() => { });
        throw err;
    }
}

/**
 * Periodically syncs LS and Cookies to DB while the browser is open.
 */
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
            const isLoggedIn = await checkIqooLogin(page, context);
            if (!isLoggedIn) {
                if (page.url().includes('login') || page.url().includes('passport')) return;
                return;
            }

            // 1. Sync LocalStorage
            const ls = await page.evaluate(() => JSON.stringify(window.localStorage));
            if (ls && ls !== '{}') {
                const lsHash = Buffer.from(ls).toString('base64').slice(0, 50);
                if (lsHash !== lastLsHash) {
                    lastLsHash = lsHash;
                    await saveLocalStorage(accountId, JSON.parse(ls), platform);
                    await pushLocalStorage(accountId, platform);
                }
            }

            // 2. Sync Cookies
            const cookies = await context.cookies();
            const cookieStr = cookies.map(c => `${c.name}=${c.value}`).sort().join('|');
            const cookieHash = Buffer.from(cookieStr).toString('base64').slice(0, 50);

            if (cookieHash !== lastCookieHash) {
                lastCookieHash = cookieHash;
                await saveCookies_DB(accountId, platform, cookies);
            }
        } catch (e) {
            // Background errors are silent
        }
    }, 10000); // Every 10 seconds

    context.on('close', () => clearInterval(syncInterval));
}
