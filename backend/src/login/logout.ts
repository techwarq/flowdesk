import { chromium, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { PROFILES_DIR } from '../config.js';
import { generateFingerprint } from '../fingerprint.js';
import { getAccountLogger } from '../log.js';
import { loadCookiesFromDB } from '../cookies.js';
import { browsers } from '../browserManager.js';

export async function logoutFromAllDevices(accountId: string): Promise<{ success: boolean; message: string }> {
    const log = getAccountLogger(accountId);
    const platform = 'flipkart';
    const normalizedId = accountId.toLowerCase().trim();
    const profilePath = path.join(PROFILES_DIR, platform, normalizedId, 'userDataDir');
    const fingerprint = generateFingerprint(platform, accountId);

    log.info(`Starting 'Logout from all devices' flow for ${accountId}`);

    let context: BrowserContext | null = null;
    let ownContext = false;

    try {
        // 1. Check if browser is already open
        const existingContext = browsers.get(`${accountId}-flipkart-orders`) || browsers.get(`${accountId}-flipkart-login`);

        if (existingContext) {
            log.info('Reusing existing browser context for logout...');
            context = existingContext;
        } else {
            log.info('Launching new headless browser for logout...');
            await fs.ensureDir(profilePath);

            // Mobile Emulation Settings (iPhone 12/13/14 Pro style)
            const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

            context = await chromium.launchPersistentContext(profilePath, {
                headless: true,
                userAgent: mobileUA, // Force Mobile UA
                viewport: { width: 390, height: 844 },
                isMobile: true,      // Critical for mobile view
                hasTouch: true,      // Critical for mobile view
                deviceScaleFactor: 3,
                locale: fingerprint.locale,
                timezoneId: fingerprint.timezoneId,
                permissions: ['geolocation', 'notifications'],
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-features=Autofill,PasswordManager',
                ]
            });
            ownContext = true;
        }

        if (!context) {
            throw new Error('Failed to initialize browser context');
        }

        // 2. Inject Cookies if launching fresh
        if (ownContext) {
            const cookies = await loadCookiesFromDB(accountId, platform);
            if (cookies.length > 0) {
                await context.addCookies(cookies);
                log.info(`Injected ${cookies.length} cookies.`);
            } else {
                log.warn('No cookies found. Login might fail, but proceeding...');
            }
        }

        // 3. Automation Flow
        const page = await context.newPage();

        // Ensure headers are cleared/reset if reusing context? 
        // No, persistent context keeps them. We just rely on the launch options for new context.


        // Emulate Mobile Device (Critical for detecting "Logout from all devices" option)
        await page.setViewportSize({ width: 390, height: 844 }); // iPhone 12/13/14

        // 4. Navigate directly to My Account (Works with strict mobile emulation)
        log.info('Navigating to My Account...');
        await page.goto('https://www.flipkart.com/my-account', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);

        // Check if redirected to login (Session invalid)
        if (page.url().includes('/login') || await page.locator('text=Enter Email/Mobile number').isVisible()) {
            throw new Error('Account is not logged in. Redirected to login page.');
        }

        // 5. Logout logic (Scroll to bottom)
        log.info('Looking for Logout options...');

        // Scroll to the very bottom
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);

        const logoutSelectors = [
            'text=Log out from all devices',
            'text=Log Out', // Matches user screenshot
            'text=Logout',
            'div:has-text("Log Out")',
            'div:has-text("Logout")'
        ];

        let foundBtn = null;
        for (const sel of logoutSelectors) {
            const el = page.locator(sel).last();
            if (await el.isVisible()) {
                foundBtn = el;
                log.info(`Found logout button: ${sel}`);
                break;
            }
        }

        if (foundBtn) {
            await foundBtn.click();
            await page.waitForTimeout(1000);

            // Handle "Logout from all devices" Popup/Option
            // Sometimes clicking "Logout" shows a popup with "Logout" and "Logout from all devices"

            const allDevicesOption = page.locator('text=Log out from all devices').first();
            if (await allDevicesOption.isVisible()) {
                log.info('Found "Log out from all devices" option. Clicking...');
                await allDevicesOption.click();
            } else {
                // Check if we just need to confirm a generic logout
                const confirmBtn = page.locator('button:has-text("Yes"), button:has-text("Confirm"), div:has-text("Yes")').first();
                if (await confirmBtn.isVisible()) {
                    await confirmBtn.click();
                }
            }

        } else {
            throw new Error('Logout button not found. You might not be on the Account page.');
        }

        log.info('Logout action performed.');
        await page.waitForTimeout(2000);
        await page.close();

        return { success: true, message: 'Logged out successfully' };

    } catch (error: any) {
        log.error(`Logout failed: ${error.message}`);
        return { success: false, message: error.message };
    } finally {
        if (ownContext && context) {
            await context.close();
        }
    }
}
