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
 * Reliance Digital Login Flow
 * 🟢 BUCKET B: Simple replay - works well
 */
export async function loginReliancedigital(options: LoginOptions) {
    const { accountId, identifier, headless = false, keepOpen = false } = options;
    const log = getAccountLogger(accountId);
    const platform = 'reliancedigital';

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

    log.info(`Launching Reliance Digital browser (DIRECT)...`);
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
    browsers.register(`${accountId}-reliancedigital-login`, context);

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

        log.info('Navigating to Reliance Digital...');
        await page.goto('https://www.reliancedigital.in', { waitUntil: 'domcontentloaded' });

        // Check if logged in
        let isLoggedIn = false;

        try {
            await page.waitForTimeout(3000);

            const loginIcon = page.locator('.nav-login-icon');
            const loginIconVisible = await loginIcon.isVisible().catch(() => false);
            let loginText = '';
            if (loginIconVisible) {
                loginText = await loginIcon.textContent().catch(() => '') || '';
            }

            const isLoginTextCheckPassed = loginIconVisible && loginText.trim().length > 0 && !loginText.toLowerCase().includes('login');

            const checks = await Promise.all([
                page.locator('.user-dropdown, .account-menu').first().isVisible().catch(() => false),
                page.locator('a[href*="logout"]').first().isVisible().catch(() => false),
            ]);

            isLoggedIn = checks.some(c => c === true) || isLoginTextCheckPassed;
            log.info(`Login checks: ${JSON.stringify(checks)} | TextCheck: ${isLoginTextCheckPassed} ('${loginText}') -> logged in: ${isLoggedIn}`);
        } catch (e) {
            log.warn('Login detection check failed');
        }

        if (isLoggedIn) {
            log.info('Session verified. User is already logged in.');
        } else {
            log.info('Manual login required. Please login in the browser window.');

            try {
                await Promise.race([
                    page.waitForURL(/.*reliancedigital\.in\/(account|my-account).*/, { timeout: keepOpen ? 0 : 300000 }),
                    // Wait for the login icon to change text (i.e. NOT contain "Login")
                    page.locator('.nav-login-icon').filter({ hasNotText: /Login/i }).waitFor({ timeout: keepOpen ? 0 : 300000 }),
                    page.waitForSelector('.user-dropdown', { timeout: keepOpen ? 0 : 300000 }),
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
        }

        if (!keepOpen) {
            await context.close();
            await saveProfileToDisk(platform, accountId);
        }

        await updateLastLogin(accountId);
        return { status: 'success', message: 'Reliance Digital Session Ready' };

    } catch (err: any) {
        log.error(`Reliance Digital login failed: ${err.message}`);
        await updateAccountStatus(accountId, 'Error', String(err.message));
        if (!keepOpen) await context.close().catch(() => { });
        throw err;
    }
}
