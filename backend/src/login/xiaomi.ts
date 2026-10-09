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
 * Robust check if Xiaomi is logged in
 */
async function checkXiaomiLogin(page: Page, context: BrowserContext): Promise<boolean> {
    try {
        // 1. Auth Cookies - The MOST reliable indicator
        const cookies = await context.cookies();
        const hasServiceToken = cookies.some(c => c.name === 'serviceToken');
        const hasUserId = cookies.some(c => c.name === 'userId');
        
        if (hasServiceToken && hasUserId) {
            return true;
        }

        // 2. UI Checks (Fallback)
        const checks = await Promise.all([
            page.locator('.user-info, .account-info').first().isVisible().catch(() => false),
            page.locator('a[href*="logout"], a[href*="signout"]').first().isVisible().catch(() => false),
            page.locator('.header-user-info, .mi-account').first().isVisible().catch(() => false),
        ]);
        
        // Only return true from UI if Logout is visible, as other things might be false positives
        if (checks[1]) return true;

    } catch (e) { }
    return false;
}

/**
 * Xiaomi/Redmi Login Flow
 * 🟢 BUCKET B: Playwright capture → Electron replay
 * ⚠️ Session may expire in 24-48 hours
 */
export async function loginXiaomi(options: LoginOptions) {
    const { accountId, identifier, headless = false, keepOpen = false } = options;
    const log = getAccountLogger(accountId);
    const platform = 'xiaomi';

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

    log.info(`Launching Xiaomi browser (DIRECT - no proxy)...`);
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
            '--disable-features=Autofill,PasswordManager'
        ]
    });

    activeContexts.set(accountId, context);
    browsers.register(`${accountId}-xiaomi-login`, context);

    try {
        // Inject saved LS
        const savedLs = await loadLocalStorage(accountId, platform);
        if (savedLs) {
            log.info('Injecting LocalStorage before JS execution...');
            await context.addInitScript((data) => {
                for (const [key, value] of Object.entries(data)) {
                    window.localStorage.setItem(key, value as string);
                }
            }, savedLs);
        }

        // Inject saved cookies
        const savedCookies = await getUnifiedCookies(accountId, platform);
        if (savedCookies.length > 0) {
            log.info(`Injecting ${savedCookies.length} cookies before navigation...`);
            await context.addCookies(savedCookies);
        }

        const page = await context.newPage();
        await injectOverlay(page, platform);

        log.info('Navigating to Mi Store India...');
        await page.goto('https://www.mi.com/in', { waitUntil: 'domcontentloaded' });

        // Wait for page to settle
        await page.waitForTimeout(3000);

        // Check if logged in
        let isLoggedIn = await checkXiaomiLogin(page, context);

        if (isLoggedIn) {
            log.info('Session verified. User is already logged in.');
        } else {
            log.info('Manual login required. Waiting for user interaction...');

            // Polling loop for login detection
            const startTime = Date.now();
            const timeout = keepOpen ? 0 : 300000; // 5 mins

            while (!isLoggedIn) {
                if (timeout !== 0 && Date.now() - startTime > timeout) {
                    throw new Error('Login timed out.');
                }

                if (page.isClosed()) throw new Error('Browser closed by user.');

                isLoggedIn = await checkXiaomiLogin(page, context);
                if (isLoggedIn) break;

                await page.waitForTimeout(2000); // Poll every 2 seconds
            }
            log.info('Login detected!');
        }

        if (isLoggedIn) {
            // CRITICAL: Wait for auth API calls to complete for HttpOnly cookies
            log.info('Waiting for auth API calls to complete...');

            try {
                await Promise.race([
                    page.waitForResponse(resp =>
                        resp.url().includes('/user') ||
                        resp.url().includes('/profile') ||
                        resp.url().includes('/order'),
                    ),
                    page.waitForTimeout(5000)
                ]);
            } catch (e) {
                log.warn('Auth API wait skipped...');
            }

            await page.waitForTimeout(5000);

            // Capture cookies IMMEDIATELY
            log.info('Capturing cookies NOW...');
            const cookies = await extractAndSaveCookies(context, accountId, platform);
            const httpOnlyCookies = cookies.filter((c: any) => c.httpOnly);
            log.info(`[CAPTURE] ✅ Saved ${cookies.length} cookies | HttpOnly: ${httpOnlyCookies.length}`);
            httpOnlyCookies.forEach((c: any) => {
                log.info(`[CAPTURE] HttpOnly: ${c.name} | domain: ${c.domain}`);
            });
            await pushCookies(accountId, platform);

            // Capture LS
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

        log.info('Xiaomi session initialization complete.');

        if (!keepOpen) {
            await context.close();
            await saveProfileToDisk(platform, accountId);
            log.info('Profile saved and browser closed.');
        }

        await updateLastLogin(accountId);
        return { status: 'success', message: 'Xiaomi Session Ready' };

    } catch (err: any) {
        log.error(`Xiaomi login flow failed: ${err.message}`);
        await updateAccountStatus(accountId, 'Error', String(err.message));
        if (!keepOpen) await context.close().catch(() => { });
        throw err;
    }
}

// Re-export as loginRedmi for convenience
export const loginRedmi = loginXiaomi;

function setupBackgroundSync(page: Page, context: BrowserContext, accountId: string, platform: string, log: any) {
    let lastCookieHash = '';
    let lastLsHash = '';

    const syncInterval = setInterval(async () => {
        try {
            if (page.isClosed()) {
                clearInterval(syncInterval);
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
