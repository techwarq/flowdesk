import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { PROFILES_DIR, getProfileDir, loadConfig, randomJitter } from '../config.js';
import { generateFingerprint } from '../fingerprint.js';
import logger, { getAccountLogger } from '../log.js';
import { saveProfileToDisk } from '../profiles/store.js';
import { injectOverlay } from '../overlay.js';
import { extractAndSaveCookies, loadCookiesFromDisk } from '../cookies.js';
import { fetchFlipkartOtp } from '../email.js';
import { getAccount, updateLastLogin, updateAccountStatus } from '../accounts.js';
import { getSettings } from '../settings.js';
import { browsers } from '../browserManager.js';

export interface LoginOptions {
    accountId: string;
    identifier: string; // Phone or Email
    headless?: boolean;
    keepOpen?: boolean; // New flag
}

// Singleton map to track active contexts
const activeContexts = new Map<string, BrowserContext>();

export async function loginFlipkart(options: LoginOptions) {
    const { accountId, identifier, headless = false, keepOpen = false } = options;
    const log = getAccountLogger(accountId);
    const platform = 'flipkart';

    // Check if valid context already exists
    if (activeContexts.has(accountId)) {
        const existingContext = activeContexts.get(accountId)!;
        if (existingContext.pages().length > 0 && !existingContext.pages()[0].isClosed()) {
            log.info('Browser already open for this account. Reusing/Ignoring launch.');
            // Ideally bring to front, but Playwright limitation.
            return { status: 'success', message: 'Browser already open' };
        } else {
            // Stale context
            activeContexts.delete(accountId);
        }
    }

    const profilePath = path.join(PROFILES_DIR, platform, accountId, 'userDataDir');
    const fingerprint = generateFingerprint(platform, accountId); // Stable fingerprint based on ID

    log.info(`Starting Flipkart login flow for ${accountId}`);

    const context = await chromium.launchPersistentContext(profilePath, {
        headless: headless,
        viewport: fingerprint.viewport,
        userAgent: fingerprint.userAgent,
        locale: fingerprint.locale,
        timezoneId: fingerprint.timezoneId,
        permissions: ['geolocation', 'notifications'],
        args: [
            '--disable-blink-features=AutomationControlled', // Try to hide automation
        ]
    });

    // Register context
    activeContexts.set(accountId, context);
    browsers.register(`${accountId}-flipkart-login`, context);
    context.on('close', () => {
        log.info('Browser context closed. Removing from active list.');
        activeContexts.delete(accountId);
    });

    // Strategy: Inject cookies from JSON if available to sync with In-App Browser
    try {
        const cookies = await loadCookiesFromDisk(accountId, platform);
        if (cookies.length > 0) {
            log.info(`Injecting ${cookies.length} cookies from storage...`);
            await context.addCookies(cookies);
        }
    } catch (e) {
        log.warn('Failed to inject cookies', e);
    }

    try {
        const page = await context.newPage();
        await injectOverlay(page, 'flipkart');
        await page.goto('https://www.flipkart.com/', { waitUntil: 'domcontentloaded' });

        // Check if already logged in via simple selector check
        const isLoggedIn = await Promise.race([
            page.waitForSelector('text=My Profile', { timeout: 3000 }).then(() => true).catch(() => false),
            page.waitForSelector('text=Logout', { timeout: 3000 }).then(() => true).catch(() => false),
            page.waitForSelector('text=Orders', { timeout: 3000 }).then(() => true).catch(() => false),
            page.waitForSelector('._28p97w', { timeout: 3000 }).then(() => true).catch(() => false), // Class for header user name
            new Promise(r => setTimeout(() => r(false), 3500))
        ]);

        if (isLoggedIn) {
            log.info('Session is valid. No login required.');
            if (!keepOpen) await context.close();
            return { status: 'success', message: 'Already logged in' };
        }

        log.info('Session invalid or expired. Initiating login flow...');

        // Click Login button if visible
        try {
            const loginBtn = page.getByRole('link', { name: 'Login' }).first();
            if (await loginBtn.isVisible()) {
                await loginBtn.click();
            }
        } catch (e) {
            log.debug('Login button interaction skipped or failed', e);
        }

        // Enter Identifier
        try {
            log.info(`Auto-filling identifier: ${identifier}`);
            // Various selectors for the input
            const input = await page.waitForSelector('input[type="text"], input[type="tel"], ._2IX_2-', { timeout: 10000 });
            await input.fill(identifier);

            // Various selectors for the button
            const requestOtpBtn = page.locator('button:has-text("Request OTP"), button:has-text("CONTINUE"), ._2KpZ6l._2HKl97._3AWRsL').first();
            if (await requestOtpBtn.isVisible()) {
                log.info('Clicking Request OTP / Continue...');
                await requestOtpBtn.click();
            }
        } catch (e) {
            log.warn('Could not auto-fill identifier. User interaction might be required.', e);
        }

        log.info('Waiting for OTP entry...');

        // Automated Email OTP Logic
        const accountData = await getAccount(accountId);
        const settings = getSettings();
        const hasEmailConfig = accountData?.emailConfig?.passEncrypted || settings.masterEmail;

        if (hasEmailConfig) {
            log.info('Automated Email Recovery Enabled. Attempting to fetch OTP...');

            await page.waitForTimeout(10000);

            let otpFound = false;
            for (let i = 0; i < 3; i++) {
                log.info(`Checking email for OTP (Attempt ${i + 1}/3)...`);

                let otp = null;

                // Try Account-Specific Email
                if (accountData?.emailConfig?.passEncrypted) {
                    const pass = Buffer.from(accountData.emailConfig.passEncrypted, 'base64').toString('utf-8');
                    otp = await fetchFlipkartOtp({
                        user: accountData.emailConfig.user,
                        password: pass,
                        host: accountData.emailConfig.host,
                        port: 993,
                        tls: true
                    });
                }

                if (!otp) {
                    // Try Master Email Fallback
                    const settings = getSettings();
                    if (settings.masterEmail) {
                        log.info('Checking Master Email for OTP...');
                        const mPass = Buffer.from(settings.masterEmail.passEncrypted, 'base64').toString('utf-8');
                        otp = await fetchFlipkartOtp({
                            user: settings.masterEmail.user,
                            password: mPass,
                            host: settings.masterEmail.host,
                            port: 993,
                            tls: true
                        });
                    }
                }

                if (otp) {
                    log.info(`OTP Found: ${otp}. Entering...`);
                    try {
                        const otpInput = page.locator('input[maxlength="6"]').first();
                        if (await otpInput.isVisible()) {
                            await otpInput.fill(otp);
                        } else {
                            await page.keyboard.type(otp);
                        }

                        const verifyBtn = page.locator('button:has-text("Verify")').first();
                        if (await verifyBtn.isVisible()) await verifyBtn.click();

                        otpFound = true;
                        break;
                    } catch (e) {
                        log.error('Failed to enter OTP', e);
                    }
                } else {
                    log.info('No OTP found yet. Waiting...');
                    await page.waitForTimeout(15000);
                }
            }

            if (!otpFound && !keepOpen) {
                throw new Error("OTP Fetching Failed: Exhausted all attempts to retrieve/enter OTP from email.");
            }
        } else if (!keepOpen) {
            // If headless but no email config, we can't do anything
            throw new Error("Configuration Missing: Headless login requested but no Recovery Email or Master Email configured.");
        }

        // Wait for user or automation to complete login
        try {
            await Promise.race([
                page.waitForSelector('text=My Profile', { timeout: keepOpen ? 0 : 60000 }),
                page.waitForSelector('div._28p97w', { timeout: keepOpen ? 0 : 60000 }),
                page.waitForSelector('text=Logout', { timeout: keepOpen ? 0 : 60000 }),
                page.waitForSelector('text=Account', { timeout: keepOpen ? 0 : 60000 })
            ]);

            log.info('Login detected successfully! Waiting for session to settle...');
        } catch (e: any) {
            if (keepOpen && (e.name === 'TimeoutError' || e.message.includes('timeout'))) {
                log.warn('Login detection timed out/deferred, attempting cookie extraction anyway...');
            } else {
                throw e;
            }
        }

        // Mandatory settle and capture
        await page.waitForTimeout(3000);
        log.info('Extracting cookies for persistence...');
        try {
            const cookies = await extractAndSaveCookies(context, accountId, 'flipkart');
            log.info(`Captured ${cookies.length} cookies.`);
        } catch (err: any) {
            log.error(`Cookie capture failed: ${err.message}`);
            if (!keepOpen) throw err; // Only throw if we weren't expecting manual intervention
        }

        log.info('Login completed. Finalizing session store...');
        await context.close();
        await saveProfileToDisk(platform, accountId);
        log.info('Profile saved and encrypted.');

        // Update Account Status in DB
        await updateLastLogin(accountId);
        log.info('Account status updated to Healthy.');

        return { status: 'success', message: 'Login completed' };

    } catch (err: any) {
        // Handle "Browser closed by user"
        if (err.message.includes('closed') || err.message.includes('browser has been closed')) {
            log.warn('Browser closed by user or crashed.');
            try { await context.close(); } catch { }
            return { status: 'cancelled', message: 'Browser closed by user' };
        }

        log.error(`Login flow failed: ${err}`);
        await updateAccountStatus(accountId, 'Error', String(err));
        try { await context.close(); } catch { }
        throw err;
    }
}
