import { chromium, BrowserContext } from 'playwright';
import { getAccountLogger } from '../log.js';
import { generateFingerprint } from '../fingerprint.js';
import { getUnifiedCookies } from '../cookies.js';
import { getChromiumPath } from '../utils/browserPath.js';

// Platform imports
import { fetchFlipkartOrders, fetchGiftCardBalance as fetchFlipkartGV } from './flipkart.js';
import { fetchAmazonOrders } from './amazon.js';
import { fetchIqooOrders } from './iqoo.js';
import { fetchShopsyOrders, fetchShopsyGiftCardBalance } from './shopsy.js';
import { fetchOneplusOrders } from './oneplus.js';
import { fetchOppoOrders } from './oppo.js';
import { fetchRealmeOrders } from './realme.js';
import { fetchReliancedigitalOrders } from './reliancedigital.js';
import { fetchVijaysalesOrders } from './vijaysales.js';
import { fetchVivoOrders } from './vivo.js';
import { fetchRedmiOrders } from './redmi.js';

export async function fetchGiftCardBalance(accountId: string, platform: string, existingContext?: BrowserContext) {
    const normalizedPlatform = platform.toLowerCase().trim();
    if (normalizedPlatform === 'shopsy') {
        return fetchShopsyGiftCardBalance(accountId, existingContext);
    }
    return fetchFlipkartGV(accountId, existingContext);
}

/**
 * Primary entry point for on-demand order fetching across all platforms
 */
export async function fetchOrders(accountId: string, platform: string, existingContext?: BrowserContext) {
    const normalizedPlatform = platform.toLowerCase().trim();

    // Direct routing for specific complex logic or if context management is handled within the platform module
    if (normalizedPlatform === 'amazon') {
        return fetchAmazonOrders(accountId, existingContext);
    }
    if (normalizedPlatform === 'iqoo') {
        return fetchIqooOrders(accountId, existingContext);
    }
    if (normalizedPlatform === 'oneplus') {
        return fetchOneplusOrders(accountId, existingContext);
    }
    if (normalizedPlatform === 'oppo') {
        return fetchOppoOrders(accountId, existingContext);
    }
    if (normalizedPlatform === 'realme') {
        return fetchRealmeOrders(accountId, existingContext);
    }
    if (normalizedPlatform === 'reliancedigital') {
        return fetchReliancedigitalOrders(accountId, existingContext);
    }
    if (normalizedPlatform === 'vijaysales') {
        return fetchVijaysalesOrders(accountId, existingContext);
    }
    if (normalizedPlatform === 'vivo') {
        return fetchVivoOrders(accountId);
    }
    if (normalizedPlatform === 'redmi' || normalizedPlatform === 'xiaomi') {
        return fetchRedmiOrders(accountId);
    }

    // Default context setup for Flipkart-family (Flipkart, Shopsy)
    const log = getAccountLogger(accountId);
    const fingerprint = generateFingerprint(platform, accountId);

    log.info(`[Orders] Starting on-demand fetch for ${accountId} on ${platform}`);

    let browser = null;
    let context = existingContext;

    // Flipkart-family platforms often use the same session pool in this system
    const cookiePlatform = (normalizedPlatform === 'shopsy') ? 'flipkart' : normalizedPlatform;
    const cookies = await getUnifiedCookies(accountId, cookiePlatform);

    if (cookies.length === 0) {
        throw new Error(`No saved cookies found for ${normalizedPlatform}. Please log in first.`);
    }

    try {
        if (!context) {
            browser = await chromium.launch({
                headless: true,
                executablePath: getChromiumPath(),
                args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
            });

            context = await browser.newContext({
                userAgent: fingerprint.userAgent,
                locale: fingerprint.locale,
                timezoneId: fingerprint.timezoneId,
                viewport: { width: 1280, height: 720 }
            });
        }

        // Inject cookies
        await context.addCookies(cookies);

        // Dispatch based on platform
        switch (normalizedPlatform) {
            case 'flipkart':
                return await fetchFlipkartOrders(accountId, platform, context);
            case 'shopsy':
                return await fetchShopsyOrders(accountId, platform, context);
            default:
                throw new Error(`Unsupported order-fetching platform: ${platform}`);
        }

    } catch (e: any) {
        log.error(`[Orders] ${platform} fetch failed: ${e.message}`);
        return { success: false as const, error: e.message, lastUrl: undefined };
    } finally {
        if (browser) await browser.close();
        else if (context && !existingContext) await context.close();
    }
}
