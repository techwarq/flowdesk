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
 * Robust check if OnePlus is logged in
 */
async function checkOneplusLogin(page: Page, context: BrowserContext): Promise<boolean> {
    try {
        const url = page.url();
        const cookies = await context.cookies();
        
        // Method 1: Check for explicit Auth Cookies (Most definitive)
        const hasAuthCookie = cookies.some(c =>
            (c.name === 'accessToken' || c.name === 'acIdAuthSession' || c.name === 'OnePlusAccount' || c.name === 'acId') &&
            c.value && c.value.length > 5
        );

        // Try to hover over the user icon to reveal "Logout" etc if it's dynamic
        const profileIcon = page.locator('.user-pc, .account-info, .nav-item-user').first();
        if (await profileIcon.isVisible()) {
            await profileIcon.hover().catch(() => {});
            await page.waitForTimeout(500);
        }

        // Method 2: Check for explicit Logout/Signout or Account Links
        const loggedInChecks = await Promise.all([
            page.locator('a[href*="logout"], a[href*="signout"]').first().isVisible().catch(() => false),
            page.locator('a[href*="/customer/info"]').first().isVisible().catch(() => false),
            page.locator('a[href*="/sales/order/history"]').first().isVisible().catch(() => false),
            page.locator('text=Logout, text=Sign out').first().isVisible().catch(() => false),
            page.locator('.account-info, .user-pc .user, .user-pc .username, .nav-user-name').first().isVisible().catch(() => false),
        ]);

        const hasUIIndicator = loggedInChecks.some(c => c === true);

        // If we have both cookies AND UI indicator, or just a very strong cookie session on the main domain
        if (hasAuthCookie && hasUIIndicator) return true;
        
        // If we are on oneplus.in (not accounts) and we see logout, trust it
        if (url.includes('oneplus.in') && !url.includes('accounts.oneplus.com')) {
            if (loggedInChecks[0] || loggedInChecks[3]) return true; // Logout visible
        }

        // Method 3: Check for explicit auth on accounts domain
        if (url.includes('accounts.oneplus.com')) {
            // If we see a session cookie here, it might be enough if we are on the "My Account" landing
            if (hasAuthCookie && (url.includes('info') || url.includes('profile'))) return true;
            return false;
        }

        // NEGATIVE CHECK: If "Sign in" or "Sign up" is explicitly visible and Logout is NOT, we are NOT logged in
        const guestVisible = await Promise.race([
            page.locator('.user-pc .signIn').first().isVisible().catch(() => false),
            page.locator('text=Sign in').first().isVisible().catch(() => false),
        ]);

        if (guestVisible && !hasUIIndicator) return false;

    } catch (e) { }
    return false;
}

/**
 * OnePlus Login Flow
 * 🟢 BUCKET B: Playwright capture → Electron replay (similar to Xiaomi)
 */
export async function loginOneplus(options: LoginOptions) {
    const { accountId, identifier, headless = false, keepOpen = false } = options;
    const log = getAccountLogger(accountId);
    const platform = 'oneplus';

    if (activeContexts.has(accountId)) {
        const existingContext = activeContexts.get(accountId)!;
        if (existingContext.pages().length > 0 && !existingContext.pages()[0].isClosed()) {
            return { status: 'success', message: 'Browser already open' };
        }
        activeContexts.delete(accountId);
    }

    const normalizedId = accountId.toLowerCase().trim();
    const profilePath = path.join(PROFILES_DIR, platform, normalizedId, 'userDataDir');
    await fs.ensureDir(profilePath);

    const account = await getAccount(accountId);
    let fingerprint: Fingerprint;

    if (account?.details?.fingerprint) {
        fingerprint = account.details.fingerprint;
    } else {
        fingerprint = generateFingerprint(platform, accountId);
        await upsertAccount({
            id: accountId,
            platform,
            details: { ...(account?.details || {}), fingerprint }
        });
    }

    log.info(`Launching OnePlus browser (DIRECT)...`);
    const executablePath = getChromiumPath();

    const context = await chromium.launchPersistentContext(profilePath, {
        executablePath,
        headless: headless,
        viewport: null,
        userAgent: fingerprint.userAgent,
        locale: fingerprint.locale,
        timezoneId: fingerprint.timezoneId,
        permissions: ['geolocation', 'notifications'],
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--window-size=1280,720']
    });

    activeContexts.set(accountId, context);
    browsers.register(`${accountId}-oneplus-login`, context);

    try {
        // Inject LS
        const savedLs = await loadLocalStorage(accountId, platform);
        if (savedLs) {
            await context.addInitScript((data) => {
                for (const [key, value] of Object.entries(data)) {
                    window.localStorage.setItem(key, value as string);
                }
            }, savedLs);
        }

        // Inject cookies
        const savedCookies = await getUnifiedCookies(accountId, platform);
        if (savedCookies.length > 0) {
            log.info(`Injecting ${savedCookies.length} cookies...`);
            await context.addCookies(savedCookies);
        }

        const page = await context.newPage();
        await injectOverlay(page, platform);

        log.info('Navigating to OnePlus India...');
        await page.goto('https://www.oneplus.in', { waitUntil: 'domcontentloaded' });

        // Mandatory delay for page to settle and redirects to finish
        await page.waitForTimeout(4000);

        let isLoggedIn = await checkOneplusLogin(page, context);
        log.info(`Initial login check: ${isLoggedIn}`);

        if (isLoggedIn) {
            log.info('Session verified. User is already logged in.');
        } else {
            log.info('Manual login required. Please login in the browser window.');

            try {
                log.info('Waiting for manual login...');
                const startTime = Date.now();
                const timeout = keepOpen ? 0 : 300000; // 5 mins

                while (!isLoggedIn) {
                    if (timeout !== 0 && Date.now() - startTime > timeout) {
                        throw new Error('Login timed out.');
                    }

                    if (page.isClosed()) throw new Error('Browser closed by user.');

                    isLoggedIn = await checkOneplusLogin(page, context);
                    if (isLoggedIn) break;

                    await page.waitForTimeout(2000); // Poll every 2 seconds
                }
                log.info('Login detected!');
            } catch (e: any) {
                log.error(`Login detection failed: ${e.message}`);
                throw e;
            }
        }

        if (isLoggedIn) {
            log.info('Settle time for session capture (5s)...');
            await page.waitForTimeout(5000);

            const cookies = await extractAndSaveCookies(context, accountId, platform);
            
            // STRICT PRE-LOGIN GUARD: Ensure we actually got the auth token
            const hasAuthToken = cookies.some((c: any) => 
                (c.name === 'accessToken' || c.name === 'acIdAuthSession' || c.name === 'OnePlusAccount') && 
                c.value && c.value.length > 10
            );
            
            if (!hasAuthToken) {
                log.error('❌ Login appeared successful but authentication tokens are missing. Aborting save.');
                throw new Error('Incomplete login: Auth tokens missing');
            }

            const httpOnlyCookies = cookies.filter((c: any) => c.httpOnly);
            log.info(`[CAPTURE] ✅ Saved ${cookies.length} cookies | HttpOnly: ${httpOnlyCookies.length}`);
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
            await context.close();
            await saveProfileToDisk(platform, accountId);
        }

        await updateLastLogin(accountId);
        return { status: 'success', message: 'OnePlus Session Ready' };

    } catch (err: any) {
        log.error(`OnePlus login failed: ${err.message}`);
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
            const isLoggedIn = await checkOneplusLogin(page, context);
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
