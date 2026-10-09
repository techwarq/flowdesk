import { chromium, BrowserContext } from 'playwright';
import { getUnifiedCookies } from '../cookies.js';
import path from 'path';
import fs from 'fs-extra';
import { PROFILES_DIR } from '../config.js';
import { getAccountLogger } from '../log.js';
import { loadLocalStorage } from '../localStorage.js';
import { browsers } from '../browserManager.js';
import { getChromiumPath } from '../utils/browserPath.js';
import { upsertAccount, getAccount } from '../accounts.js';
import { updateOrdersInContext } from '../chat.js';
import { orderCache } from '../orderCache.js';

export async function fetchRedmiOrders(accountId: string): Promise<any> {
    const platform = 'xiaomi'; // Auth logic uses 'xiaomi'
    const log = getAccountLogger(accountId);

    const normalizedId = accountId.toLowerCase().trim();
    const profilePath = path.join(PROFILES_DIR, platform, normalizedId, 'temp_orders_capture');
    await fs.ensureDir(profilePath);

    log.info(`[Redmi/Xiaomi] Launching browser to fetch orders...`);
    const executablePath = getChromiumPath();

    const context = await chromium.launchPersistentContext(profilePath, {
        executablePath,
        headless: true, // We can run headless for order fetching
        viewport: null,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--window-size=1280,720',
        ]
    });

    browsers.register(`${accountId}-redmi-orders`, context);

    try {
        const savedCookies = await getUnifiedCookies(accountId, platform);
        if (savedCookies.length > 0) {
            await context.addCookies(savedCookies);
        }

        const savedLs = await loadLocalStorage(accountId, platform);
        if (savedLs) {
            await context.addInitScript((data) => {
                for (const [key, value] of Object.entries(data)) {
                    window.localStorage.setItem(key, value as string);
                }
            }, savedLs);
        }

        const page = await context.newPage();

        log.info(`[Redmi/Xiaomi] Navigating to My Orders...`);
        // We know from testing the URL is structure.mi.com or www.mi.com depending on the redirect, 
        // store.mi.com/in/user/order works based on the DOM dump
        await page.goto('https://store.mi.com/in/user/order/', { waitUntil: 'load', timeout: 30000 });

        // Wait for orders to load or empty state
        try {
            await page.waitForSelector('.order-list, .empty-data', { timeout: 15000 });
        } catch (e) {
            log.warn(`[Redmi/Xiaomi] Timeout waiting for order list. Proceeding to evaluate...`);
        }

        await page.waitForTimeout(3000); // Give React time to render

        const orders = await page.evaluate(() => {
            const items: any[] = [];

            // Look for order items in the list
            const orderNodes = document.querySelectorAll('.order-item');

            for (const orderEl of Array.from(orderNodes)) {
                try {
                    // Extract Order ID
                    const orderIdEl = orderEl.querySelector('.order-id-num');
                    const orderIdText = orderIdEl ? orderIdEl.textContent || '' : '';
                    const orderId = orderIdText.trim();

                    // Extract Date
                    const dateEl = orderEl.querySelector('.info-left_time');
                    const dateText = dateEl ? dateEl.textContent || '' : '';
                    let date = dateText.trim() || new Date().toISOString().split('T')[0];
                    if (dateText) {
                        // e.g., "28/01/2026 05:37 pm" -> split by space and take first part
                        date = dateText.split(' ')[0];
                    }

                    // Status
                    const statusEl = orderEl.querySelector('.order-item-header--title');
                    const statusText = statusEl ? statusEl.textContent || '' : '';
                    const status = statusText.trim() || 'Unknown';

                    // Price - Try to find the total for this order
                    const priceEl = orderEl.querySelector('.info-right-total__num strong');
                    const priceText = priceEl ? priceEl.textContent || '' : '0';
                    // Extract numbers strictly (e.g. ₹9,999 -> 9999)
                    const priceMatch = priceText.match(/[\\d,]+/);
                    const price = priceMatch ? priceMatch[0].replace(/,/g, '') : '0';

                    // Get Individual Products in this order block
                    // An order could have multiple products
                    const productInfos = orderEl.querySelectorAll('.goods-list-gooods-info');

                    if (productInfos.length > 0) {
                        for (const productInfo of Array.from(productInfos)) {
                            const titleEl = productInfo.querySelector('.goods-list-gooods-info__information div:first-child');
                            const titleText = titleEl ? titleEl.textContent || '' : '';
                            const product = titleText.trim();

                            // Get URL if available
                            const linkEl = productInfo.querySelector('a.normal-image-link');
                            let url = linkEl ? (linkEl as HTMLAnchorElement).href : `https://store.mi.com/in/user/order/`;

                            if (orderId && product) {
                                items.push({
                                    orderId,
                                    deliveryDate: date,
                                    productName: product,
                                    price, // Might be order total, not individual item price, but fine for basic tracking
                                    status,
                                    orderUrl: url
                                });
                            }
                        }
                    } else {
                        // Fallback if structure is slightly different
                        if (orderId) {
                            items.push({
                                orderId,
                                deliveryDate: date,
                                productName: 'Unknown Redmi Product',
                                price,
                                status,
                                orderUrl: `https://store.mi.com/in/user/order/`
                            });
                        }
                    }

                } catch (e) {
                    console.error('Error parsing individual Redmi order', e);
                }
            }

            return items;
        });

        log.info(`[Redmi/Xiaomi] Successfully parsed ${orders.length} orders. Starting deep scrape...`);

        // Deep scrape for tracking/carrier/address
        for (let i = 0; i < Math.min(orders.length, 10); i++) {
            const order = orders[i];
            if (order.orderUrl && order.orderUrl.includes('/order/view/')) {
                try {
                    log.info(`[Redmi/Xiaomi] Deep scraping Order: ${order.orderId}`);
                    await page.goto(order.orderUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                    await page.waitForTimeout(2000);

                    const details = await page.evaluate(() => {
                        const res: any = {};
                        const bodyText = document.body.innerText;

                        // Tracking ID
                        const trackingMatch = bodyText.match(/(?:tracking|AWB|waybill|consignment)\s*(?:id|number)?[:\-]?\s*([A-Z0-9\-]+)/i);
                        if (trackingMatch) res.trackingId = trackingMatch[1];

                        // Carrier
                        const carrierMatch = bodyText.match(/(?:shipped via|courier|carrier)[:\-]?\s*([A-Za-z0-9\s]+)/i);
                        if (carrierMatch) res.carrier = carrierMatch[1].trim();

                        // Address
                        const addrEl = document.querySelector('.address-info, .receiver-info, .delivery-address');
                        if (addrEl) {
                            res.address = (addrEl as HTMLElement).innerText.replace(/\n+/g, ', ').trim();
                            const phoneMatch = res.address.match(/\b\d{10}\b/);
                            if (phoneMatch) res.mobileLast4 = phoneMatch[0].slice(-4);
                        }

                        // Status
                        const statusEl = document.querySelector('.order-status, .current-status');
                        if (statusEl) res.status = statusEl.textContent?.trim();

                        return res;
                    });

                    if (details.trackingId) order.trackingId = details.trackingId;
                    if (details.carrier) order.carrier = details.carrier;
                    if (details.address) order.address = details.address;
                    if (details.mobileLast4) order.mobileLast4 = details.mobileLast4;
                    if (details.status) order.status = details.status;

                } catch (e: any) {
                    log.warn(`[Redmi/Xiaomi] Failed to deep scrape ${order.orderId}: ${e.message}`);
                }
            }
        }

        orderCache.set(accountId, platform, orders);

        const acc = await getAccount(accountId);
        const chatUserId = acc?.userId || accountId;
        updateOrdersInContext(chatUserId, accountId, platform, orders).catch(e => {
            log.warn(`[Redmi/Xiaomi] Failed to update chat context: ${e.message}`);
        });

        await upsertAccount({
            id: accountId,
            platform,
            orders
        });

        return { success: true, count: orders.length, orders, lastUrl: page.url() };

    } catch (err: any) {
        log.error(`[Redmi/Xiaomi] Failed to fetch orders: ${err.message}`);
        throw err;
    } finally {
        await context.close().catch(() => { });
    }
}
