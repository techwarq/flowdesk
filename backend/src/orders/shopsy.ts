import { BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { PROJECT_ROOT } from '../config.js';
import { getAccountLogger } from '../log.js';
import { getUnifiedCookies } from '../cookies.js';
import { upsertAccount, getAccount } from '../accounts.js';
import { updateOrdersInContext } from '../chat.js';
import { orderCache } from '../orderCache.js';
import { fetchGiftCardBalance as fetchFlipkartGV } from './flipkart.js';
import { scrapeGVBalance, scrapeDetails, humanDelay } from './common.js';
import { getChromiumPath } from '../utils/browserPath.js';

export async function fetchShopsyOrders(accountId: string, platform: string, context: BrowserContext) {
    const log = getAccountLogger(accountId);

    // 1. Fetch GV Balance
    try {
        const gvPage = await context.newPage();
        log.info('[Orders] Checking Shopsy GV Balance...');
        // Shopsy giftcard URL usually redirects to mobile view or similar
        await gvPage.goto('https://www.shopsy.in/account/giftcard', { waitUntil: 'domcontentloaded', timeout: 30000 });

        const gvBalance = await scrapeGVBalance(gvPage);

        if (gvBalance) {
            log.info(`[Orders] Shopsy GV Balance found: ${gvBalance}`);
            const acc = await getAccount(accountId);
            if (acc) {
                await upsertAccount({
                    id: accountId,
                    platform: platform as any,
                    details: { ...acc.details, gvBalance }
                });
            }
        }
        await gvPage.close();
    } catch (e: any) {
        log.warn(`[Orders] Failed to fetch Shopsy GV Balance: ${e.message}`);
    }

    // Note: Shopsy often shares cookies with Flipkart in this system
    const page = await context.newPage();
    log.info('[Orders] Navigating to Shopsy orders page...');

    const ordersUrl = 'https://www.shopsy.in/mobile-view-page?url=%2Frv%2Forders';
    await page.goto(ordersUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForTimeout(2000);

    let lastUrl = page.url();
    log.info(`[Orders] Current URL: ${lastUrl}`);

    if (lastUrl.includes('/login')) {
        const errorHtml = await page.content();
        const errorPath = path.join(PROJECT_ROOT, 'shopsy_failure_debug.html');
        await fs.writeFile(errorPath, errorHtml);
        log.error(`[Orders] Session expired or redirected to login. URL: ${lastUrl}`);
        throw new Error('Cookies expired. Please log in again.');
    }

    // Shopsy uses similar layout to Flipkart mobile
    let orders: any[] = [];

    log.info('[Orders] Scrolling to load Shopsy items...');
    try {
        let previousHeight = 0;
        let sameHeightCount = 0;
        while (sameHeightCount < 3) {
            const currentHeight = await page.evaluate(() => document.body.scrollHeight);
            if (currentHeight === previousHeight) {
                sameHeightCount++;
            } else {
                sameHeightCount = 0;
                previousHeight = currentHeight;
            }
            await page.mouse.wheel(0, 600);
            await humanDelay(page, 500, 1500);
        }
    } catch (e) {
        log.warn('[Orders] Shopsy scrolling error: ' + e);
    }

    try {
        await page.waitForSelector('.ZcgLRi, .kok32b, .Ao4Ooo, ._2aFisS, a[href*="order_details"], [class*="order"]', { timeout: 15000 });
    } catch (e) {
        log.info('[Orders] Waiting additional time for Shopsy page...');
        await page.waitForTimeout(3000);
    }

    orders = await page.evaluate(() => {
        const results: any[] = [];
        const cards = Array.from(document.querySelectorAll('.ZcgLRi, .kok32b, ._2aFisS, a[href*="order_details"]'));
        const processed = new Set();

        const baseOrigin = 'https://www.shopsy.in';

        cards.forEach(card => {
            const cardEl = card as HTMLElement;
            if (processed.has(cardEl)) return;
            processed.add(cardEl);

            let href = '';
            if (cardEl.tagName === 'A') {
                href = cardEl.getAttribute('href') || '';
            } else {
                const parentA = cardEl.closest('a');
                if (parentA) href = parentA.getAttribute('href') || '';
                else {
                    const childA = cardEl.querySelector('a');
                    if (childA) href = childA.getAttribute('href') || '';
                }
            }

            const fullUrl = href && href !== '' ? (href.startsWith('/') ? `${baseOrigin}${href}` : href) : '';

            let orderId = '';
            if (fullUrl) {
                try {
                    const urlObj = new URL(fullUrl);
                    orderId = urlObj.searchParams.get('order_id') || '';
                } catch (e) { }
            }

            if (!orderId) {
                const idMatch = cardEl.innerText.match(/OD\d{16,}/);
                if (idMatch) orderId = idMatch[0];
            }

            const textLines = cardEl.innerText.split('\n').filter(s => s.trim());
            let price = '';
            let name = '';
            let status = '';

            const priceMatch = textLines.find(s => s.includes('₹'));
            if (priceMatch) price = priceMatch;

            const statusMatch = textLines.find(s => /(Delivered|Cancelled|Returned|Shipped|Out for delivery|Arriving|Expected)/i.test(s));
            if (statusMatch) status = statusMatch;

            const nameCandidates = textLines.filter(s => s !== price && s !== status && !s.includes('Exchange'));
            if (nameCandidates.length > 0) name = nameCandidates[0];

            if (!orderId && name) {
                const safeName = name.replace(/[^a-z0-9]/gi, '_');
                const safePrice = price.replace(/[^0-9]/g, '');
                orderId = `gen_${safeName}_${safePrice}_${status}`;
            }

            if (orderId) {
                if (results.find(r => r.orderId === orderId)) return;
                results.push({
                    orderId: orderId,
                    productName: name || 'Unknown Shopsy Product',
                    price: price,
                    status: status || 'Ordered',
                    imageUrl: cardEl.querySelector('img')?.src || '',
                    orderUrl: fullUrl || 'https://www.shopsy.in',
                });
            }
        });
        return results.slice(0, 15);
    });

    log.info(`[Orders] Shopsy found ${orders.length} items. Deep scraping...`);

    const inTransitStatuses = ['ordered', 'shipped', 'out for delivery', 'arriving', 'processing', 'delivered'];
    const ordersToDeepScrape = orders.filter(o => {
        const statusLower = (o.status || '').toLowerCase();
        return inTransitStatuses.some(s => statusLower.includes(s)) && !o.orderId.startsWith('gen_');
    }).slice(0, 10);

    for (let i = 0; i < ordersToDeepScrape.length; i++) {
        const order = ordersToDeepScrape[i];
        if (i > 0) await humanDelay(page, 1500, 2500);

        if (order.orderUrl && !order.orderUrl.includes('rv/orders')) {
            try {
                await page.goto(order.orderUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await scrapeDetails(page, order, log);
            } catch (e: any) {
                log.warn(`[Orders] Shopsy deep scrape failed for ${order.orderId}: ${e.message}`);
            }
        }
    }

    if (orders.length > 0) {
        await upsertAccount({
            id: accountId,
            platform: platform as any,
            orders: orders
        });

        const acc = await getAccount(accountId);
        const chatUserId = acc?.userId || accountId;
        updateOrdersInContext(chatUserId, accountId, platform, orders).catch(e => {
            log.warn(`[Orders] Shopsy chat update failed: ${e.message}`);
        });
    }

    // Save to in-memory cache so API can return it immediately
    orderCache.set(accountId, platform, orders);

    return { success: true, count: orders.length, orders, lastUrl };
}

export async function fetchShopsyGiftCardBalance(accountId: string, existingContext?: BrowserContext) {
    // Shopsy GV balance fetching is almost identical to Flipkart, but on Shopsy domain
    const log = getAccountLogger(accountId);
    const platform = 'shopsy';
    // We can reuse the flipkart GV fetcher logic but with shopsy URLs if needed, 
    // or just implement it here for clarity.
    
    // For now, let's implement a wrapper or direct call
    // Since common.scrapeGVBalance is already domain-agnostic (mostly), it should work.
    
    // Actually, Shopsy and Flipkart share the same backend for GV usually.
    // Let's just implement it here for Shopsy specifically.
    
    // 1. Fetch GV Balance
    log.info(`[GV] Starting Shopsy GV Fetch for ${accountId}`);
    const cookies = await getUnifiedCookies(accountId, 'flipkart'); // Shopsy uses flipkart cookies
    
    if (cookies.length === 0) {
        throw new Error('No saved cookies found. Please log in first.');
    }

    const { chromium } = await import('playwright');
    let browser = null;
    let context = existingContext;

    try {
        if (!context) {
            browser = await chromium.launch({
                headless: true,
                executablePath: getChromiumPath(),
                args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
            });

            context = await browser.newContext({
                viewport: { width: 1280, height: 720 }
            });
            await context.addCookies(cookies);
        }

        const page = await context.newPage();
        await page.goto('https://www.shopsy.in/account/giftcard', { waitUntil: 'domcontentloaded', timeout: 30000 });

        const gvBalance = await scrapeGVBalance(page);

        if (gvBalance) {
            log.info(`[GV] Shopsy Balance found: ${gvBalance}`);
            const acc = await getAccount(accountId);
            if (acc) {
                await upsertAccount({
                    id: accountId,
                    platform: platform,
                    details: { ...acc.details, gvBalance }
                });
            }
        }

        await page.close();
        return { success: true, balance: gvBalance };

    } catch (e: any) {
        log.error(`[GV] Shopsy Error: ${e.message}`);
        throw e;
    } finally {
        if (browser) await browser.close();
        else if (context && !existingContext) await context.close();
    }
}
