import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { PROFILES_DIR } from '../config.js';
import { generateFingerprint } from '../fingerprint.js';
import logger, { getAccountLogger } from '../log.js';
import { browsers } from '../browserManager.js';

export async function checkAccountHealth(platform: string, accountId: string) {
    const log = getAccountLogger(accountId);
    const profilePath = path.join(PROFILES_DIR, platform, accountId, 'userDataDir');

    // Check if this account is currently open in EITHER browser
    // This fixes the issue where opening Shopsy for a Flipkart account (or vice versa) 
    // caused the health check to fail because it looked for the wrong active key.
    const isFlipkartOpen = browsers.isActive(`flipkart-${accountId}`);
    const isShopsyOpen = browsers.isActive(`shopsy-${accountId}`);

    if (isFlipkartOpen || isShopsyOpen) {
        log.info('Health Check: Skipped (browser currently open)');
        return { status: 'Healthy', message: 'Browser session currently active' };
    }

    if (!await fs.pathExists(profilePath)) {
        return { status: 'MISSING_PROFILE', message: 'No local profile found' };
    }

    const fingerprint = generateFingerprint(platform, accountId);
    let context;

    try {

        try {
            // Launch headless for check
            context = await chromium.launchPersistentContext(profilePath, {
                headless: true,
                viewport: fingerprint.viewport,
                userAgent: fingerprint.userAgent,
                deviceScaleFactor: fingerprint.deviceScaleFactor,
                isMobile: fingerprint.isMobile,
                locale: fingerprint.locale,
                timezoneId: fingerprint.timezoneId
            });
        } catch (e: any) {
            const errorMsg = String(e.message || e);
            if (errorMsg.includes('ProcessSingleton') || errorMsg.includes('SingletonLock')) {
                log.warn('Health Check: Found stale lock file. Removing and retrying...');
                const lockFile = path.join(profilePath, 'SingletonLock');
                try {
                    if (await fs.pathExists(lockFile)) {
                        await fs.remove(lockFile);
                    }
                } catch (err) { }

                // Retry launch
                context = await chromium.launchPersistentContext(profilePath, {
                    headless: true,
                    viewport: fingerprint.viewport,
                    userAgent: fingerprint.userAgent,
                    deviceScaleFactor: fingerprint.deviceScaleFactor,
                    isMobile: fingerprint.isMobile,
                    locale: fingerprint.locale,
                    timezoneId: fingerprint.timezoneId
                });
            } else {
                throw e;
            }
        }

        browsers.register(`${platform}-${accountId}-health`, context);

        const page = await context.newPage();

        // Navigate to homepage instead of account page for faster, more reliable check
        let url = 'https://www.flipkart.com/';
        if (platform === 'shopsy') url = 'https://www.shopsy.in/';
        else if (platform === 'iqoo') url = 'https://www.iqoo.com/in';
        else if (platform === 'vivo') url = 'https://www.vivo.com/in';
        else if (platform === 'redmi' || platform === 'xiaomi') url = 'https://www.mi.com/in/';
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

        // Wait a bit for dynamic content
        await page.waitForTimeout(2000);

        const content = await page.content();
        let healthy = false;

        if (platform === 'flipkart') {
            // Logged-in users see "Account" dropdown, not "Login" button
            // Check for indicators of logged-in state
            const hasAccountMenu = content.includes('Account') && !content.includes('Login & Signup');
            const hasCartAccess = content.includes('Cart');
            const noLoginPrompt = !content.includes('Enter Email/Mobile');

            healthy = hasAccountMenu && hasCartAccess && noLoginPrompt;
        } else if (platform === 'shopsy') {
            // Shopsy: logged-in users see "You" instead of login prompt
            const hasYouMenu = content.includes('>You<') || content.includes('You</');
            const hasCartAccess = content.includes('Cart');
            const noLoginPrompt = !content.includes('Login') || content.includes('Logout');

            healthy = (hasYouMenu || hasCartAccess) && noLoginPrompt;
        } else {
            // Generic check for others: look for 'Logout' or 'Account' or 'Profile'
            const hasLogout = content.toLowerCase().includes('logout') || content.toLowerCase().includes('sign out');
            const hasProfile = content.toLowerCase().includes('profile') || content.toLowerCase().includes('account');
            const noLogin = !content.toLowerCase().includes('sign in') && !content.toLowerCase().includes('login');
            healthy = (hasLogout || hasProfile) && noLogin;
        }

        await context.close();

        if (healthy) {
            log.info('Health Check: HEALTHY');
            return { status: 'Healthy', message: 'Session valid' };
        } else {
            log.warn('Health Check: NEEDS_REFRESH');
            return { status: 'NeedsRefresh', message: 'Session may be expired' };
        }

    } catch (err) {
        log.error(`Health check failed: ${err}`);
        if (context) await context.close().catch(() => { });
        return { status: 'Error', message: `Check failed: ${err}` };
    }
}
