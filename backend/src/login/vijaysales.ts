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
 * Robust check if Vijay Sales is logged in
 */
async function checkVijaysalesLogin(page: Page, context: BrowserContext): Promise<boolean> {
    try {
        // Method 1: UI Selectors (Most reliable)
        const checks = await Promise.all([
            page.locator('.vs-head-pri-profile-post-login-username').first().isVisible().catch(() => false),
            page.locator('.vs-head-pri-profile-post-login-wrapper').first().isVisible().catch(() => false),
            page.locator('a[href*="logout"]').first().isVisible().catch(() => false),
        ]);

        if (checks.some(c => c === true)) return true;

        // Method 2: Cookie Check
        const cookies = await context.cookies();
        // Check for specific session/auth cookies if known
        if (cookies.some(c => (c.name.includes('User') || c.name.includes('Auth')) && c.value.length > 10)) return true;

    } catch (e) { }
    return false;
}

/**
 * Vijay Sales Login Flow
 * 🟢 BUCKET B: Cookie/LS replay + persistent profile
 */
export async function loginVijaysales(options: LoginOptions) {
    const { accountId, identifier, headless = false, keepOpen = false } = options;
    const log = getAccountLogger(accountId);
    const platform = 'vijaysales';

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

    log.info(`Launching Vijay Sales browser (DIRECT)...`);
    const executablePath = getChromiumPath();

    const context = await chromium.launchPersistentContext(profilePath, {
        executablePath,
        headless: headless,
        viewport: null,
        userAgent: fingerprint.userAgent,
        locale: fingerprint.locale,
        timezoneId: fingerprint.timezoneId,
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--window-size=1280,720']
    });

    activeContexts.set(accountId, context);
    browsers.register(`${accountId}-vijaysales-login`, context);

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

        log.info('Navigating to Vijay Sales...');
        await page.goto('https://www.vijaysales.com', { waitUntil: 'domcontentloaded' });

        let isLoggedIn = await checkVijaysalesLogin(page, context);
        log.info(`Initial login check: ${isLoggedIn}`);

        if (isLoggedIn) {
            log.info('Session verified. User is already logged in (Persistent Session).');
            await updateLastLogin(accountId);
        } else {
            log.info('Manual login required. Please login in the browser window.');

            try {
                await Promise.race([
                    page.waitForSelector('.vs-head-pri-profile-post-login-username', { timeout: keepOpen ? 0 : 300000 }),
                    page.waitForSelector('.vs-head-pri-profile-post-login-wrapper', { timeout: keepOpen ? 0 : 300000 }),
                    page.waitForSelector('a[href*="logout"]', { timeout: keepOpen ? 0 : 300000 }),
                ]);
                log.info('Login detected!');
                isLoggedIn = true;
            } catch (e) {
                if (!keepOpen) throw new Error('Login timed out or failed.');
                log.warn('Login detection timed out, but keepOpen is true. Session saving via persistence.');
                isLoggedIn = true;
            }
        }

        if (isLoggedIn) {
            await page.waitForTimeout(3000);

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

        return { status: 'success', message: 'Vijay Sales Session Ready (Persistent)' };

    } catch (err: any) {
        log.error(`Vijay Sales login failed: ${err.message}`);
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
            const isLoggedIn = await checkVijaysalesLogin(page, context);
            if (!isLoggedIn) {
                if (page.url().includes('login') || page.url().includes('account/login')) return;
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
