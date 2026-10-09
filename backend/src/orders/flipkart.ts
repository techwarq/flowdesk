import { chromium, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { PROJECT_ROOT } from '../config.js';
import { generateFingerprint } from '../fingerprint.js';
import { getAccountLogger } from '../log.js';
import { getUnifiedCookies } from '../cookies.js';
import { upsertAccount, getAccount } from '../accounts.js';
import { updateOrdersInContext } from '../chat.js';
import { orderCache } from '../orderCache.js';
import { scrapeGVBalance, scrapeDetails, humanDelay } from './common.js';
import { getChromiumPath } from '../utils/browserPath.js';

export async function fetchGiftCardBalance(accountId: string, existingContext?: BrowserContext) {
    const log = getAccountLogger(accountId);
    const platform = 'flipkart';
    const fingerprint = generateFingerprint(platform, accountId);

    log.info(`[GV] Starting GV Fetch for ${accountId}`);

    const cookies = await getUnifiedCookies(accountId, platform);
    if (cookies.length === 0) {
        throw new Error('No saved cookies found. Please log in first.');
    }

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
                userAgent: fingerprint.userAgent,
                locale: fingerprint.locale,
                timezoneId: fingerprint.timezoneId,
                viewport: { width: 1280, height: 720 }
            });
            await context.addCookies(cookies);
        }

        const page = await context.newPage();

        await page.goto('https://www.flipkart.com/account/giftcard', { waitUntil: 'domcontentloaded', timeout: 30000 });

        const gvBalance = await scrapeGVBalance(page);

        if (gvBalance) {
            log.info(`[GV] Balance found: ${gvBalance}`);
            const acc = await getAccount(accountId);
            if (acc) {
                await upsertAccount({
                    id: accountId,
                    platform: platform,
                    details: { ...acc.details, gvBalance }
                });
            }
        } else {
            log.info('[GV] No confirmed balance found.');
        }

        await page.close();
        return { success: true, balance: gvBalance };

    } catch (e: any) {
        log.error(`[GV] Error: ${e.message}`);
        throw e;
    } finally {
        if (browser) await browser.close();
        else if (context && !existingContext) await context.close();
    }
}

export async function fetchFlipkartOrders(accountId: string, platform: string, context: BrowserContext) {
    const log = getAccountLogger(accountId);
    const baseDomain = 'https://www.flipkart.com';

    // 1. Fetch GV Balance (Quickly in separate tab)
    try {
        const gvPage = await context.newPage();
        log.info('[Orders] Checking GV Balance...');
        await gvPage.goto(`${baseDomain}/account/giftcard`, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const gvBalance = await scrapeGVBalance(gvPage);

        if (gvBalance) {
            log.info(`[Orders] GV Balance found: ${gvBalance}`);
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
        log.warn(`[Orders] Failed to fetch GV Balance: ${e.message}`);
    }

    const page = await context.newPage();
    log.info('[Orders] Navigating to orders page...');

    const ordersUrl = `${baseDomain}/account/orders`;
    await page.goto(ordersUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForTimeout(2000);

    let lastUrl = page.url();
    const currentTitle = await page.title();
    log.info(`[Orders] Current URL: ${lastUrl}`);
    log.info(`[Orders] Current Title: ${currentTitle}`);

    if (lastUrl.includes('/login') || lastUrl.includes('fromMyOrdersPage=true')) {
        const errorHtml = await page.content();
        const errorPath = path.join(PROJECT_ROOT, 'login_failure_debug.html');
        await fs.writeFile(errorPath, errorHtml);
        log.error(`[Orders] Session expired or redirected to login. URL: ${lastUrl}. Saved page to ${errorPath}`);
        throw new Error('Cookies expired. Please log in again.');
    }

    const isDetailsPage = lastUrl.includes('order_details') || lastUrl.includes('order_id');
    let orders: any[] = [];

    if (isDetailsPage) {
        log.info('[Orders] Detected Details Page. Scraping single order...');
        const order = await page.evaluate(() => {
            const urlParams = new URLSearchParams(window.location.search);
            const orderId = urlParams.get('order_id');
            if (!orderId) return null;

            const text = document.body.innerText;
            const priceMatch = text.match(/₹\d+(?:,\d+)*/);
            const price = priceMatch ? priceMatch[0] : '';
            const name = document.title.replace('Flipkart.com:', '').trim() || 'Order Details';
            const status = 'Ordered';

            let otp = '';
            const otpMatch = text.match(/OTP\s*[:\-]?\s*(\d{4,6})/i);
            if (otpMatch) otp = otpMatch[1];

            let receiverName = '';
            const addressHeader = Array.from(document.querySelectorAll('div, span')).find(el => el.textContent?.includes('Delivery Address'));
            if (addressHeader) {
                const container = addressHeader.closest('div[class*="row"]')?.parentElement;
                if (container) {
                    const lines = container.innerText.split('\n');
                    const addrIdx = lines.findIndex(l => l.includes('Delivery Address'));
                    if (addrIdx !== -1 && lines[addrIdx + 1]) receiverName = lines[addrIdx + 1];
                }
            }

            let trackingId = '';
            let carrier = '';
            const textContent = document.body.innerText;
            const flipMatch = textContent.match(/(FMPC|FMPP)[a-zA-Z0-9]+/);
            if (flipMatch) trackingId = flipMatch[0];

            if (!trackingId) {
                const items = Array.from(document.querySelectorAll('*'));
                const trackEl = items.find(el => el.textContent?.includes('Tracking ID') || el.textContent?.startsWith('FMPC') || el.textContent?.startsWith('FMPP'));
                if (trackEl) {
                    const match = trackEl.textContent?.match(/(FMPC|FMPP)\w+/);
                    if (match) trackingId = match[0];
                }
            }

            const carrierKeywords = ['Shipped via', 'Courier', 'Delivery by'];
            for (const kw of carrierKeywords) {
                if (textContent.includes(kw)) {
                    const match = textContent.split(kw)[1]?.trim().split('\n')[0];
                    if (match && match.length < 30) carrier = match;
                    break;
                }
            }

            return {
                orderId,
                productName: name,
                price: price,
                status: status,
                deliveryDate: '',
                imageUrl: '',
                orderUrl: window.location.href,
                otp,
                receiverName,
                trackingId,
                carrier
            };
        });
        if (order) orders.push(order);

    } else {
        log.info('[Orders] List page detected. Scrolling to load all items...');
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
            log.warn('[Orders] Scrolling error: ' + e);
        }

        const ordersHtml = await page.content();
        const ordersDebugPath = path.join(PROJECT_ROOT, 'orders_debug.html');
        await fs.writeFile(ordersDebugPath, ordersHtml);
        log.info(`[Orders DEBUG] Saved orders page HTML to ${ordersDebugPath}`);

        const hasNoOrders = await page.evaluate(() => {
            const noOrdersText = document.body.innerText.includes('You have no orders') ||
                document.body.innerText.includes('No orders found');
            return noOrdersText;
        });

        if (hasNoOrders) {
            log.info('[Orders] Account has no orders.');
        } else {
            try {
                await page.waitForSelector('.ZcgLRi, .kok32b, .Ao4Ooo, ._2aFisS, a[href*="order_details"], [class*="order"], [data-testid*="order"]', { timeout: 30000 });
            } catch (e) {
                log.info('[Orders] Waiting additional time for page to fully load...');
                await page.waitForTimeout(5000);
            }
        }

        orders = await page.evaluate(() => {
            const results: any[] = [];
            const cards = Array.from(document.querySelectorAll('.ZcgLRi, .kok32b, ._2aFisS, a[href*="order_details"]'));
            const processed = new Set();

            cards.forEach(card => {
                const cardEl = card as HTMLElement;
                if (processed.has(cardEl)) return;
                processed.add(cardEl);

                let href = '';
                if (cardEl.tagName === 'A') {
                    href = cardEl.getAttribute('href') || '';
                } else {
                    const parentA = cardEl.closest('a');
                    if (parentA) {
                        href = parentA.getAttribute('href') || '';
                    } else {
                        const childA = cardEl.querySelector('a');
                        if (childA) href = childA.getAttribute('href') || '';
                    }
                }

                const fullUrl = href && href !== '' ? (href.startsWith('/') ? `${window.location.origin}${href}` : href) : '';

                let orderId = '';
                if (fullUrl) {
                    try {
                        const urlObj = new URL(fullUrl);
                        orderId = urlObj.searchParams.get('order_id') || '';
                    } catch (e) {
                        if (href.includes('order_id=')) {
                            orderId = href.split('order_id=')[1]?.split('&')[0] || '';
                        }
                    }
                }

                if (!orderId) {
                    const idMatch = cardEl.innerText.match(/OD\d{16,}/);
                    if (idMatch) orderId = idMatch[0];
                }

                const textLines = cardEl.innerText.split('\n').filter(s => s.trim());
                let price = '';
                let name = '';
                let status = '';
                let otp = '';
                let deliveryDate = '';

                const priceMatch = textLines.find(s => s.includes('₹'));
                if (priceMatch) price = priceMatch;

                const statusMatch = textLines.find(s => /(Delivered|Cancelled|Returned|Shipped|Out for delivery|Arriving|Expected)/i.test(s));
                if (statusMatch) {
                    status = statusMatch;
                    const dateMatch = statusMatch.match(/(?:on|by|Arriving|Expected)\s+([A-Za-z]+\s+\d{1,2}(?:,?\s*\d{4})?)/i);
                    if (dateMatch) deliveryDate = dateMatch[1];
                }

                const otpMatch = cardEl.innerText.match(/OTP\s*[:\-]?\s*(\d{4,6})/i);
                if (otpMatch) otp = otpMatch[1];

                const nameCandidates = textLines.filter(s => s !== price && s !== status && !s.includes('Exchange') && !s.includes('more items'));
                if (nameCandidates.length > 0) name = nameCandidates[0];

                const explicitName = cardEl.querySelector('.KzDlHZ, ._213eRC, div[class*="product-name"]');
                if (explicitName) name = explicitName.textContent?.trim() || name;

                const promoKeywords = ['coupon', 'discount', 'off on', 'cashback', 'bonus', 'spotify', 'cleartrip', 'pharmeasy', 'ballebaazi', 'supercoins', 'premium at', 'free entry'];
                const isPromoItem = promoKeywords.some(kw => name.toLowerCase().includes(kw));
                if (isPromoItem && !orderId) return;

                if (!orderId) {
                    const safeName = (name || 'Order').replace(/[^a-z0-9]/gi, '_');
                    const safePrice = price.replace(/[^0-9]/g, '');
                    if (safeName === 'Order' && !safePrice) return;
                    orderId = `gen_${safeName}_${safePrice}_${status}`;
                }

                if (orderId) {
                    if (results.find(r => r.orderId === orderId)) return;
                    results.push({
                        orderId: orderId,
                        productName: name || 'Unknown Product',
                        price: price,
                        status: status || 'Ordered',
                        deliveryDate: deliveryDate,
                        imageUrl: cardEl.querySelector('img')?.src || '',
                        orderUrl: fullUrl || `https://www.flipkart.com/order_details?order_id=${orderId}`,
                        otp: otp,
                    });
                }
            });
            return results.slice(0, 20);
        });
    }

    log.info(`[Orders] List scraping done. Found ${orders.length} items. Starting deep scrape...`);

    const inTransitStatuses = ['ordered', 'shipped', 'out for delivery', 'arriving', 'processing', 'delivered'];
    const ordersToDeepScrape = orders.filter(o => {
        const statusLower = (o.status || '').toLowerCase();
        // Deep scrape all in-transit, and first few recent orders even if delivered
        return inTransitStatuses.some(s => statusLower.includes(s)) && !o.orderId.startsWith('gen_');
    }).slice(0, 10);

    log.info(`[Orders] Deep scraping ${ordersToDeepScrape.length} in-transit orders (skipping delivered/cancelled)`);

    for (let i = 0; i < ordersToDeepScrape.length; i++) {
        const order = ordersToDeepScrape[i];
        if (i > 0) await humanDelay(page, 1500, 3000);

        if (order.orderUrl && !order.orderUrl.includes('account/orders') && !order.orderId.startsWith('gen_')) {
            try {
            const scrapeUrl = order.orderUrl || `https://www.flipkart.com/order_details?order_id=${order.orderId}`;
            log.info(`[Orders] [${i + 1}/${ordersToDeepScrape.length}] Deep scraping Flipkart Order: ${order.orderId} at ${scrapeUrl}`);
            
            await page.goto(scrapeUrl, { waitUntil: 'networkidle', timeout: 60000 });
            // Wait for some common order detail elements to appear
            try {
                await page.waitForSelector('div, span, p', { timeout: 5000 });
            } catch (e) {}
            
            await scrapeDetails(page, order, log);
        } catch (e: any) {
                log.warn(`[Orders] Failed to deep scrape URL ${order.orderId}: ${e.message}`);
            }
        }
        else if (order.orderId.startsWith('gen_') || !order.orderUrl || order.orderUrl.includes('account/orders')) {
            try {
                log.info(`[Orders] Deep scraping CLICK order ${i + 1}/${orders.length}: ${order.productName}`);
                await page.goto(`${baseDomain}/account/orders`, { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(2000);

                let cardToClick = null;
                const targets = await page.$$('.ZcgLRi, .kok32b, ._2aFisS, a[href*="order_details"]');
                for (const target of targets) {
                    const tText = await target.innerText();
                    if (tText.includes(order.price) && (tText.includes(order.productName) || order.productName === 'Unknown Product' || order.productName.includes('More Items'))) {
                        cardToClick = target;
                        break;
                    }
                }

                if (cardToClick) {
                    await cardToClick.click();
                    await page.waitForTimeout(3000);
                    if (page.url().includes('order_details')) {
                        await scrapeDetails(page, order, log);
                    } else {
                        log.warn(`[Orders] Clicked but didn't navigate for ${order.orderId}`);
                    }
                } else {
                    log.warn(`[Orders] Could not find card to click for ${order.orderId}`);
                }
            } catch (e: any) {
                log.warn(`[Orders] Failed to click-scrape ${order.orderId}: ${e.message}`);
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
            log.warn(`[Orders] Failed to update chat context: ${e.message}`);
        });
    }

    // Save to in-memory cache so API can return it immediately
    orderCache.set(accountId, platform, orders);

    return { success: true, count: orders.length, orders, lastUrl };
}
