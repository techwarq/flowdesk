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
import { pushCookies, saveCookies_DB } from '../cloud_provider.js';
import { getChromiumPath } from '../utils/browserPath.js';

export interface LoginOptions {
    accountId: string;
    identifier: string;
    headless?: boolean;
    keepOpen?: boolean;
}

const activeContexts = new Map<string, BrowserContext>();

/**
 * Amazon Login Flow
 * 🔴 BUCKET A: Electron-Persistent - NO cookie replay allowed
 * ⚠️ CRITICAL: Amazon detects "cookie teleportation" - never export cookies
 */
export async function loginAmazon(options: LoginOptions) {
    const { accountId, identifier, headless = false, keepOpen = false } = options;
    const log = getAccountLogger(accountId);
    const platform = 'amazon';

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

    log.info(`Launching Amazon browser (DIRECT - no proxy)...`);
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
    browsers.register(`${accountId}-amazon-login`, context);

    try {
        // NOTE: Amazon is Bucket A - we DO NOT inject cookies from external sources
        // Session persists ONLY within this profile partition

        const page = await context.newPage();
        await injectOverlay(page, platform);

        log.info('Navigating to Amazon India...');
        await page.goto('https://www.amazon.in', { waitUntil: 'domcontentloaded' });

        // Check if logged in (look for account greeting)
        let isLoggedIn = false;

        try {
            await page.waitForTimeout(3000);

            // Check for the "Hello, sign in" element
            // If this element exists AND contains "sign in", we are NOT logged in.
            // If it exists but does NOT contain "sign in" (e.g. "Hello, Deepak"), we ARE logged in.

            const helloElement = page.locator('#nav-link-accountList-nav-line-1');
            const isHelloVisible = await helloElement.isVisible().catch(() => false);

            let helloText = '';
            if (isHelloVisible) {
                helloText = await helloElement.textContent().catch(() => '') || '';
            }

            // Explicit check: Must be visible AND NOT contain "sign in"
            const isLoggedInByText = isHelloVisible && !helloText.toLowerCase().includes('sign in');

            const checks = await Promise.all([
                // Fallback checks (less reliable but good to have)
                page.locator('.nav-line-1-container .nav-line-1:not(:has-text("Hello"))').first().isVisible().catch(() => false),
            ]);

            isLoggedIn = isLoggedInByText || checks.some(c => c === true);
            log.info(`Login checks: TextCheck: ${isLoggedInByText} ('${helloText}') | Others: ${JSON.stringify(checks)} -> logged in: ${isLoggedIn}`);
        } catch (e) {
            log.warn('Login detection check failed');
        }

        if (isLoggedIn) {
            log.info('Session verified. User is already logged in.');
        } else {
            log.info('Manual login required. Please login in the browser window.');

            // Click on sign in
            try {
                const signInLink = page.locator('#nav-link-accountList').first();
                if (await signInLink.isVisible()) await signInLink.click();
            } catch (e) { }

            // Fill email/phone if provided
            try {
                const emailInput = page.locator('#ap_email');
                if (await emailInput.isVisible()) {
                    await emailInput.fill(identifier);
                    const continueBtn = page.locator('#continue');
                    if (await continueBtn.isVisible()) await continueBtn.click();
                }
            } catch (e) { }

            // Wait for login completion
            try {
                await Promise.race([
                    // STRICTER check: Wait for the "Hello, sign in" to change to something else
                    // This is the most reliable check for "logged in" on any page
                    page.locator('#nav-link-accountList-nav-line-1').filter({ hasNotText: /sign in/i }).waitFor({ timeout: keepOpen ? 0 : 300000 }),

                    // Also accept if we land on the explicit "Your Account" page
                    page.waitForURL(/.*amazon\.in\/gp\/css\/homepage\.html.*/, { timeout: keepOpen ? 0 : 300000 })
                ]);
                log.info('Login detected!');
                isLoggedIn = true;
            } catch (e) {
                if (!keepOpen) throw new Error('Login timed out or failed.');
                // CRITICAL FIX: Do NOT set isLoggedIn = true here. If it failed, it failed.
                log.warn('Login timed out, but proceeding to close/cleanup based on keepOpen flag.');
                isLoggedIn = false;
            }
        }

        if (isLoggedIn) {
            await page.waitForTimeout(5000);

            // Save cookies LOCALLY only (not for replay, just for this profile)
            log.info('Saving session within persistent profile...');
            const cookies = await extractAndSaveCookies(context, accountId, platform);
            log.info(`[CAPTURE] ✅ Saved ${cookies.length} cookies to local profile`);

            // NOTE: pushCookies is optional for Amazon since we don't replay
            // But we keep DB in sync for reference
            await pushCookies(accountId, platform);

            setupBackgroundSync(page, context, accountId, platform, log);
        }

        log.info('Amazon session initialization complete.');
        log.warn('⚠️ REMEMBER: Amazon sessions are browser-instance bound. Never export cookies.');

        if (!keepOpen) {
            await context.close();
            await saveProfileToDisk(platform, accountId);
        }

        await updateLastLogin(accountId);
        return { status: 'success', message: 'Amazon Session Ready' };

    } catch (err: any) {
        log.error(`Amazon login flow failed: ${err.message}`);
        await updateAccountStatus(accountId, 'Error', String(err.message));
        if (!keepOpen) await context.close().catch(() => { });
        throw err;
    }
}

function setupBackgroundSync(page: Page, context: BrowserContext, accountId: string, platform: string, log: any) {
    let lastCookieHash = '';

    const syncInterval = setInterval(async () => {
        try {
            if (page.isClosed()) {
                clearInterval(syncInterval);
                return;
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
