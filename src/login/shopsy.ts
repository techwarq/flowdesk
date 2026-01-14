import { chromium } from 'playwright';
import path from 'path';
import { PROFILES_DIR, getProfileDir, loadConfig, randomJitter } from '../config.js';
import { generateFingerprint } from '../fingerprint.js';
import logger, { getAccountLogger } from '../log.js';
import { saveProfileToDisk } from '../profiles/store.js';
import { injectOverlay } from '../overlay.js';
import { injectFlipkartCookiesIntoShopsy } from '../cookies.js';
import { updateLastLogin, updateAccountStatus } from '../accounts.js';
import { browsers } from '../browserManager.js';

export interface LoginOptions {
    accountId: string;
    identifier: string; // Phone
    headless?: boolean;
}

export async function loginShopsy(options: LoginOptions) {
    const { accountId, identifier, headless = false } = options;
    const log = getAccountLogger(accountId);
    const platform = 'shopsy';

    const profilePath = path.join(PROFILES_DIR, platform, accountId, 'userDataDir');
    const fingerprint = generateFingerprint(platform, accountId);

    log.info(`Starting Shopsy login flow for ${accountId} (Mobile Emulation)`);

    // Shopsy is mobile-focused
    const context = await chromium.launchPersistentContext(profilePath, {
        headless: headless,
        viewport: fingerprint.viewport,
        userAgent: fingerprint.userAgent,
        deviceScaleFactor: fingerprint.deviceScaleFactor,
        hasTouch: fingerprint.hasTouch,
        isMobile: fingerprint.isMobile,
        locale: fingerprint.locale,
        timezoneId: fingerprint.timezoneId,
        permissions: ['geolocation', 'notifications'],
        args: ['--disable-blink-features=AutomationControlled']
    });

    browsers.register(`${accountId}-shopsy-login`, context);

    try {
        const page = await context.newPage();

        // Try to inject cookies from Flipkart (if available)
        await injectFlipkartCookiesIntoShopsy(context, accountId);

        await injectOverlay(page, 'shopsy');
        await page.goto('https://www.shopsy.in/', { waitUntil: 'domcontentloaded' });

        // Basic check for logged in state
        const isLoggedIn = await Promise.race([
            page.waitForSelector('text=Account', { timeout: 3000 }).then(() => true), // Assuming mobile menu
            // Shopsy web might redirect to login if not authenticated on some routes?
            // Checking for a known "logged in" element.
            // On mobile web, usually there is a bottom nav or hamburger menu.
            new Promise(r => setTimeout(() => r(false), 3500))
        ]);

        if (isLoggedIn) {
            // Deep check to see if really logged in?
            // For now assume if we don't see "Login" buttons we might be good.
            // But Shopsy mobile web often pushes for App install.
        }

        // Since Shopsy web is limited, we might just be logging into Flipkart Mobile Web which Shopsy uses?
        // Actually Shopsy has its own domain now.
        // If Shopsy Web login is identical to Flipkart, we adapt.

        log.info('Instructions: Please log in using the mobile web interface shown.');

        // We rely on the user to interact since it's headed for first login.
        // Wait for a success indicator.
        await page.waitForTimeout(5000); // Wait for load

        const loginButtons = await page.getByText('Login').all();
        if (loginButtons.length > 0) {
            log.info('Login button found, attempting click...');
            try { await loginButtons[0].click(); } catch { }
        }

        try {
            const input = page.locator('input[type="tel"]').first();
            await input.fill(identifier);
            // Trigger OTP logic if button exists
        } catch { }

        log.info('Waiting for manual Login completion...');

        // Wait for typical "My Account" or "Profile" indicator on mobile
        await Promise.race([
            page.waitForURL(/.*\/account.*/, { timeout: 180000 }), // Navigate to account page
            page.waitForSelector('text=My Orders', { timeout: 180000 })
        ]);

        log.info('Login detected successfully!');
        await page.waitForTimeout(3000);

        try {
            const { extractAndSaveCookies } = await import('../cookies.js');
            await extractAndSaveCookies(context, accountId, 'shopsy');
        } catch (e: any) {
            log.warn(`Cookie extraction skipped for shopsy: ${e.message}`);
        }

        await context.close();
        await saveProfileToDisk(platform, accountId);
        log.info('Profile saved and encrypted.');

        // Update Account Status in DB
        await updateLastLogin(accountId);
        log.info('Account status updated to Healthy.');

        return { status: 'success', message: 'Login completed and profile saved' };

    } catch (err: any) {
        log.error(`Shopsy Login flow failed: ${err}`);
        await updateAccountStatus(accountId, 'Error', String(err));
        await context.close();
        throw err;
    }
}
