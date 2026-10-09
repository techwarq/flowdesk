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
 * Robust check if Samsung is logged in
 */
async function checkSamsungLogin(page: Page, context: BrowserContext): Promise<boolean> {
    try {
        // Method 1: UI Selectors (Most reliable)
        const checks = await Promise.all([
            // Samsung specific: User icon exists but does NOT have 'before-login' or 'loginBtn' class
            page.locator('.nv00-gnb-v4__utility-user:not(.before-login):not(.loginBtn)').first().isVisible().catch(() => false),
            // Standard checks
            page.locator('a[href*="logout"], a[href*="signout"]').first().isVisible().catch(() => false),
            // Fallbacks
            page.locator('.profile-icon, .user-name').first().isVisible().catch(() => false),
        ]);

        if (checks.some(c => c === true)) return true;

        // Method 2: Cookie Check
        const cookies = await context.cookies();
        // Samsung often uses 'session_id' or 'samsung_account_cookie'
        if (cookies.some(c => (c.name.includes('sams') || c.name.includes('SESSION')) && c.value.length > 20)) return true;

    } catch (e) { }
    return false;
}

/**
 * Samsung Login Flow
 * 🟢 BUCKET B: Playwright capture → Electron replay
 * ⚠️ UA mismatch = silent failure, Region binding important
 */
export async function loginSamsung(options: LoginOptions) {
    const { accountId, identifier, headless = false, keepOpen = false } = options;
    const log = getAccountLogger(accountId);
    const platform = 'samsung';

    if (activeContexts.has(accountId)) {
        const existingContext = activeContexts.get(accountId)!;
        if (existingContext.pages().length > 0 && !existingContext.pages()[0].isClosed()) {
            log.info('Browser already open for this account.');
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
        log.info('Reusing existing fingerprint from DB.');
        fingerprint = account.details.fingerprint;
    } else {
        log.info('No fingerprint found. Generating new fingerprint.');
        fingerprint = generateFingerprint(platform, accountId);
        await upsertAccount({
            id: accountId,
            platform,
            details: { ...(account?.details || {}), fingerprint }
        });
    }

    log.info(`Launching Samsung browser (DIRECT - no proxy)...`);
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
            '--window-size=1280,720'
        ]
    });

    activeContexts.set(accountId, context);
    browsers.register(`${accountId}-samsung-login`, context);

    try {
        const savedLs = await loadLocalStorage(accountId, platform);
        if (savedLs) {
            await context.addInitScript((data) => {
                for (const [key, value] of Object.entries(data)) {
                    window.localStorage.setItem(key, value as string);
                }
            }, savedLs);
        }

        const savedCookies = await getUnifiedCookies(accountId, platform);
        if (savedCookies.length > 0) {
            log.info(`Injecting ${savedCookies.length} cookies before navigation...`);
            await context.addCookies(savedCookies);
        }

        const page = await context.newPage();
        await injectOverlay(page, platform);

        log.info('Navigating to Samsung India...');
        await page.goto('https://www.samsung.com/in', { waitUntil: 'domcontentloaded' });

        let isLoggedIn = await checkSamsungLogin(page, context);
        log.info(`Initial login check: ${isLoggedIn}`);

        if (isLoggedIn) {
            log.info('Session verified. User is already logged in.');
        } else {
            log.info('Manual login required. Please login in the browser window.');

            try {
                await Promise.race([
                    page.waitForURL(/.*samsung\.com\/in\/(account|mypage|profile).*/, { timeout: keepOpen ? 0 : 300000 }),
                    // Wait for the user icon to lose the 'before-login' class
                    page.waitForSelector('.nv00-gnb-v4__utility-user:not(.before-login)', { timeout: keepOpen ? 0 : 300000 }),
                    page.waitForSelector('a[href*="logout"]', { timeout: keepOpen ? 0 : 300000 }),
                ]);
                log.info('Login detected!');
                isLoggedIn = true;
            } catch (e) {
                if (!keepOpen) throw new Error('Login timed out or failed.');
                isLoggedIn = true; // Still capture cookies
            }
        }

        if (isLoggedIn) {
            await page.waitForTimeout(5000);

            log.info('Capturing cookies NOW...');
            const cookies = await extractAndSaveCookies(context, accountId, platform);
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

        log.info('Samsung session initialization complete.');

        if (!keepOpen) {
            await context.close();
            await saveProfileToDisk(platform, accountId);
        }

        await updateLastLogin(accountId);
        return { status: 'success', message: 'Samsung Session Ready' };

    } catch (err: any) {
        log.error(`Samsung login failed: ${err.message}`);
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
            const isLoggedIn = await checkSamsungLogin(page, context);
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
