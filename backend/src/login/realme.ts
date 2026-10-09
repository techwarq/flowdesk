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
 * Robust check if Realme is logged in
 */
async function checkRealmeLogin(page: Page, context: BrowserContext): Promise<boolean> {
    try {
        // 1. Check for user name text
        const userNameText = await page.locator('.user-name label').first().textContent().catch(() => '');
        if (userNameText && userNameText.trim().length > 0) return true;

        // 2. Auth Cookie Check (Best for headless/background)
        const cookies = await context.cookies();
        if (cookies.some(c => (c.name === 'accessToken' || c.name === 'acIdAuthSession') && c.value.length > 20)) return true;

        // 3. UI Selectors (wait for them briefly as SPA might render late)
        const checks = await Promise.all([
            page.locator('.user-name label').first().isVisible().catch(() => false),
            page.locator('.head-item-logout').first().isVisible().catch(() => false),
            page.locator('.header-account.plus .user-name').first().isVisible().catch(() => false),
        ]);

        return checks.some(c => c === true);
    } catch (e) {
        return false;
    }
}

export async function loginRealme(options: LoginOptions) {
    const { accountId, identifier, headless = false, keepOpen = false } = options;
    const log = getAccountLogger(accountId);
    const platform = 'realme';

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

    log.info(`Launching Realme browser (DIRECT - no proxy for speed)...`);
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
    browsers.register(`${accountId}-realme-login`, context);

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

        const savedCookies = await getUnifiedCookies(accountId, platform);
        if (savedCookies.length > 0) {
            log.info(`Injecting ${savedCookies.length} cookies before navigation...`);
            await context.addCookies(savedCookies);
        }

        const page = await context.newPage();
        await injectOverlay(page, platform);

        log.info('Navigating to Realme India Homepage...');
        await page.goto('https://www.realme.com/in', { waitUntil: 'domcontentloaded' });

        // Wait for page to settle, let the SPA load the header
        await page.waitForTimeout(5000);

        // Check if we got redirected to login (if someone tried accessing a restricted page)
        if (page.url().includes('login') || page.url().includes('passport')) {
            log.info('Redirected to login/passport page. Waiting for network to settle...');
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
        }

        // Check if logged in 
        let isLoggedIn = await checkRealmeLogin(page, context);
        log.info(`Initial login check: ${isLoggedIn}`);

        if (isLoggedIn) {
            log.info('Session verified. User is already logged in.');
        } else {
            log.info('Manual login required. Please login in the browser window.');

            try {
                // Use explicit long timeout (24h) instead of 0 to avoid default timeout issues
                const longTimeout = keepOpen ? 86400000 : 300000;

                log.info('Waiting for login... (Cookies or URL change)');

                await Promise.race([
                    // 1. Check for URL Changes
                    page.waitForURL(/.*realme\.com\/in\/(member|account|my|profile).*/, { timeout: longTimeout }),

                    // 2. Check for Cookies (Best indicator)
                    new Promise<void>(resolve => {
                        const checkCookie = async () => {
                            if (page.isClosed()) return;
                            try {
                                const cookies = await context.cookies();
                                if (cookies.some(c => c.name === 'accessToken')) {
                                    log.info('Access Token cookie found via polling!');
                                    resolve();
                                    return;
                                }
                            } catch (e) { }
                            setTimeout(checkCookie, 2000); // Check every 2s
                        };
                        checkCookie();
                    }),

                    // 4. Check for disappearance of Login Button
                    page.waitForSelector('#plus-accountLogin', { state: 'hidden', timeout: longTimeout })
                ]);

                log.info('Login detected successfully!');
                isLoggedIn = true;
            } catch (e: any) {
                log.warn(`Login race interrupted: ${e.message}`);
                isLoggedIn = await checkRealmeLogin(page, context);
                if (isLoggedIn) {
                    log.info('Login confirmed despite race error.');
                } else if (!keepOpen) {
                    throw new Error('Login timed out or failed.');
                } else {
                    log.info('Detection failed or timed out, but keepOpen is true. Waiting indefinitely for user...');
                }
            }
        }

        if (isLoggedIn) {
            log.info('Waiting for auth cookies (accessToken, acIdAuthSession) to be set...');

            // Wait specifically for the accessToken cookie
            // Increased timeout to 5 minutes to ensure we capture deferred cookies
            let authCookieFound = false;
            const maxAttempts = keepOpen ? 300 : 30; // 5 minutes vs 30s

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                if (page.isClosed()) break;

                // Fast-check: Just get cookies
                const currentCookies = await context.cookies();
                const accessToken = currentCookies.find((c: any) => c.name === 'accessToken');
                const acIdAuth = currentCookies.find((c: any) => c.name === 'acIdAuthSession');

                if (accessToken || acIdAuth) {
                    log.info(`[AUTH] ✅ Found auth cookies on attempt ${attempt + 1}: accessToken=${!!accessToken}, acIdAuthSession=${!!acIdAuth}`);
                    authCookieFound = true;
                    break;
                }

                if (attempt % 5 === 0) {
                    log.info(`[AUTH] Waiting for auth cookies... attempt ${attempt + 1}/${maxAttempts}`);
                }
                await page.waitForTimeout(1000);
            }

            if (!authCookieFound) {
                log.warn(`[AUTH] ⚠️ Auth cookies not found after ${maxAttempts}s. Capturing anyway...`);
            }

            log.info('Capturing cookies NOW...');
            const cookies = await extractAndSaveCookies(context, accountId, platform);

            // Verify auth cookies were captured
            const authCookies = cookies.filter((c: any) =>
                ['accessToken', 'acIdAuthSession', 'RMID', 'nickname'].includes(c.name)
            );
            const httpOnlyCookies = cookies.filter((c: any) => c.httpOnly);

            log.info(`[CAPTURE] ✅ Saved ${cookies.length} cookies | Auth: ${authCookies.length} | HttpOnly: ${httpOnlyCookies.length}`);
            if (authCookies.length > 0) {
                log.info(`[CAPTURE] Auth cookies: ${authCookies.map((c: any) => c.name).join(', ')}`);
            } else {
                log.warn('[CAPTURE] ⚠️ No auth cookies captured! User may need to login again.');
            }

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

        log.info('Realme session initialization complete.');

        if (!keepOpen) {
            await context.close();
            await saveProfileToDisk(platform, accountId);
            log.info('Profile saved and browser closed.');
        }

        if (isLoggedIn) {
            await updateLastLogin(accountId);
        } else {
            log.info(`Account ${accountId} left in Pre-Login (New) state. User must complete login.`);
        }
        
        return { status: 'success', message: 'Realme Session Ready' };

    } catch (err: any) {
        log.error(`Realme login flow failed: ${err.message}`);
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
            const isLoggedIn = await checkRealmeLogin(page, context);
            if (!isLoggedIn) {
                // If we are on a login page, definitely don't sync
                if (page.url().includes('login') || page.url().includes('passport')) return;
                // Otherwise, wait and see
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
