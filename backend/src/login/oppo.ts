import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { PROFILES_DIR } from '../config.js';
import { generateFingerprint, Fingerprint } from '../fingerprint.js';
import logger, { getAccountLogger } from '../log.js';
import { saveProfileToDisk } from '../profiles/store.js';
import { injectOverlay } from '../overlay.js';
import { extractAndSaveCookies } from '../cookies.js';
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
 * Robust check if Oppo is logged in
 */
async function checkOppoLogin(page: Page, context: BrowserContext): Promise<boolean> {
    try {
        const url = page.url();
        const cookies = await context.cookies();
        
        // Method 1: Auth Cookie Check (Primary)
        // 'nickname', 'token' or 'accessToken' are key for Oppo.
        // acIdAuthSession is the primary persistent login cookie from HeyTap SSO.
        const hasAuthCookie = cookies.some(c =>
            (c.name === 'token' || c.name === 'accessToken' || c.name === 'nickname' || c.name === 'acIdAuthSession' || c.name === 'OnePlusAccount') &&
            c.value && c.value.length > 5
        );

        // Method 2: Check for explicit logged-in UI
        const loggedInChecks = await Promise.all([
            page.locator('a.log-out, .logout, .signout').first().isVisible().catch(() => false),
            page.locator('a[href*="logout"], a[href*="signout"]').first().isVisible().catch(() => false),
            page.locator('.userInfo img.nav-avatar, .user-avatar, .avatar-container').first().isVisible().catch(() => false),
            page.locator('text=Log out, text=Sign out').first().isVisible().catch(() => false)
        ]);

        const hasUIIndicator = loggedInChecks.some(c => c === true);

        // If we have both cookies AND UI indicator, or just a very strong cookie session
        if (hasAuthCookie && hasUIIndicator) return true;
        
        // On account/profile pages, stay stricter
        if (url.includes('oppo.com/in/account') || url.includes('profile')) {
            return hasAuthCookie;
        }

        // NEGATIVE CHECK: If "Sign in/Register" is explicitly visible, we are NOT logged in
        const guestVisible = await Promise.race([
            page.locator('a.sign-in, a.sign-up').first().isVisible().catch(() => false),
            page.locator('.nav-user-login, .login-btn').first().isVisible().catch(() => false),
            page.locator('text=Sign in, text=Register').first().isVisible().catch(() => false),
        ]);

        if (guestVisible && !hasUIIndicator) return false;

    } catch (e) { }
    return false;
}

/**
 * Oppo Login Flow (Refactored for Persistence)
 * 🟢 STRATEGY: Persistent Partition + Cookie/LS Capture for replay in in-app browser.
 */
export async function loginOppo(options: LoginOptions) {
    const { accountId, identifier, headless = false, keepOpen = false } = options;
    const log = getAccountLogger(accountId);
    const platform = 'oppo';

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

    const account = await getAccount(accountId);
    let fingerprint: Fingerprint;

    // We still generate/store a fingerprint to ensure consistent UA/Viewport across launches
    if (account) {
        if (account.details?.fingerprint) {
            log.info('Reusing existing fingerprint from DB.');
            fingerprint = account.details.fingerprint;
        } else {
            log.info('No fingerprint found. Generating and locking new fingerprint.');
            fingerprint = generateFingerprint(platform, accountId);
            await upsertAccount({
                id: accountId,
                platform,
                details: { ...(account.details || {}), fingerprint }
            });
        }
    } else {
        log.info('No account found. Generating temporary fingerprint in-memory.');
        fingerprint = generateFingerprint(platform, accountId);
    }

    const executablePath = getChromiumPath();
    log.info(`Launching Oppo browser (PERSISTENT - No Replay)... Executable: ${executablePath || 'DEFAULT'}`);

    const context = await chromium.launchPersistentContext(profilePath, {
        executablePath, // Explicitly set executable path
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
    browsers.register(`${accountId}-oppo-login`, context);

    try {
        const savedLs = await loadLocalStorage(accountId, platform);
        if (savedLs) {
            log.info('Injecting LocalStorage before JS execution...');
            await context.addInitScript((data) => {
                for (const [key, value] of Object.entries(data)) {
                    window.localStorage.setItem(key, value as string);
                }
            }, savedLs);
        }

        const page = await context.newPage();
        await injectOverlay(page, platform);

        log.info('Navigating to Oppo India...');
        await page.goto('https://www.oppo.com/in', { waitUntil: 'domcontentloaded' });

        // Mandatory delay for page to settle
        await page.waitForTimeout(4000);

        // For brand-new accounts (no previous login), always require manual login
        // even if persistent profile has stale session data
        const isNewAccount = !account || !account.lastLoginAt;

        let isLoggedIn = await checkOppoLogin(page, context);
        log.info(`Initial login check: ${isLoggedIn} | isNewAccount: ${isNewAccount}`);

        if (isLoggedIn && !isNewAccount) {
            log.info('Session verified. User is already logged in.');
        } else {
            if (isNewAccount && isLoggedIn) {
                log.info('New account detected with stale session. Clearing cookies and requiring fresh login...');
                await context.clearCookies();
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(4000);
            }
            log.info('Waiting for manual login...');
            const startTime = Date.now();
            const timeout = keepOpen ? 24 * 60 * 60 * 1000 : 300000; // 5 mins default

            while (!isLoggedIn) {
                if (page.isClosed()) throw new Error('Browser window closed by user');
                if (Date.now() - startTime > timeout) break;

                isLoggedIn = await checkOppoLogin(page, context);
                if (isLoggedIn) {
                    log.info('Login detected!');
                    break;
                }
                await page.waitForTimeout(2000);
            }

            if (!isLoggedIn && !keepOpen) {
                throw new Error('Login timed out. Please try again.');
            }

            // Waiting for redirection/session to stabilize
            await page.waitForTimeout(3000);
            
            // Re-verify after stabilization
            const cookies = await context.cookies();
            const hasAuthToken = cookies.some((c: any) => 
                (c.name === 'token' || c.name === 'accessToken' || c.name === 'acIdAuthSession' || c.name === 'nickname') && 
                c.value && c.value.length > 5
            );
            
            if (!hasAuthToken) {
                log.error('Post-login verification failed: No auth tokens found');
                if (!keepOpen) throw new Error('Authentication failed (missing tokens)');
                isLoggedIn = false;
            }
        }

        if (isLoggedIn) {
            await page.waitForTimeout(5000);

            log.info('Capturing cookies NOW...');
            const cookies = await extractAndSaveCookies(context, accountId, platform);
            log.info(`[CAPTURE] ✅ Saved ${cookies.length} cookies`);
            await pushCookies(accountId, platform);

            try {
                const ls = await page.evaluate(() => JSON.stringify(window.localStorage));
                if (ls && ls !== '{}') {
                    await saveLocalStorage(accountId, JSON.parse(ls), platform);
                    await pushLocalStorage(accountId, platform);
                }
            } catch (e) { }

            setupBackgroundSync(page, context, accountId, platform, log);
        }

        if (!keepOpen) {
            log.info('Closing browser (Persistence ensures session is saved to disk).');
            await context.close();
        } else {
            log.info('Browser left open for manual interaction.');
        }

        if (isLoggedIn) {
            await upsertAccount({
                id: accountId,
                platform,
                details: { fingerprint },
                status: 'Healthy'
            });
            await updateLastLogin(accountId);
        } else {
            log.info(`Account ${accountId} left in Pre-Login (New) state. User must complete login.`);
        }
        
        return { status: 'success', message: 'Oppo Session Ready (Persistent)' };

    } catch (err: any) {
        log.error(`Oppo login flow failed: ${err.message}`);
        await updateAccountStatus(accountId, 'Error', String(err.message));
        if (context && !keepOpen) await context.close().catch(() => { });
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
            const isLoggedIn = await checkOppoLogin(page, context);
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
