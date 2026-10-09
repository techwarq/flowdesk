import { chromium, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { getAccountLogger } from '../log.js';
import { generateFingerprint } from '../fingerprint.js';
import { getUnifiedCookies } from '../cookies.js';
import { loadLocalStorage } from '../localStorage.js';
import { orderCache } from '../orderCache.js';
import { loadAccounts, upsertAccount } from '../accounts.js';
import { updateOrdersInContext } from '../chat.js';
import { humanDelay } from './common.js';
import { getChromiumPath } from '../utils/browserPath.js';

export async function fetchOppoOrders(accountId: string, existingContext?: BrowserContext) {
    const log = getAccountLogger(accountId);
    const platform = 'oppo';
    const fingerprint = generateFingerprint(platform, accountId);

    const cookies = await getUnifiedCookies(accountId, platform);
    const ls = await loadLocalStorage(accountId, platform);

    if (cookies.length === 0) {
        throw new Error('No saved cookies found. Please log in first.');
    }

    log.info(`[Orders] 🚀 Starting Oppo order fetch for ${accountId}`);

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
                viewport: fingerprint.viewport || { width: 1280, height: 720 },
                locale: fingerprint.locale,
                timezoneId: fingerprint.timezoneId
            });
        }

        if (ls) {
            log.info(`[Orders] Injecting localStorage items`);
            await context.addInitScript((data) => {
                for (const [key, value] of Object.entries(data)) {
                    window.localStorage.setItem(key, value as string);
                }
            }, ls);
        }

        log.info(`[Orders] Injecting ${cookies.length} cookies`);
        await context.addCookies(cookies);

        const page = await context.newPage();

        const ordersUrl = 'https://www.oppo.com/in/store/sales/order/history';
        log.info(`[Orders] Navigating to Oppo Order List: ${ordersUrl}`);
        await page.goto(ordersUrl, { waitUntil: 'networkidle', timeout: 30000 });

        await page.waitForTimeout(5000);

        const currentUrl = page.url();
        log.info(`[Orders] Current URL after navigation: ${currentUrl}`);

        if (currentUrl.includes('id.oppo.com/login') || currentUrl.includes('popper/login')) {
            log.error(`[Orders] ❌ Oppo session expired - redirected to login`);
            throw new Error('Oppo session expired. Please login again.');
        }

        log.info('[Orders] Waiting for order elements...');

        try {
            await page.waitForSelector('.order-item-list, .cart-empty, .empty-order', { timeout: 15000 });
            log.info('[Orders] ✅ Page content detected');
        } catch (e) {
            log.warn('[Orders] ⚠️ Timeout waiting for Oppo order content. Continuing to scrape current DOM.');
        }

        // Dump DOM for debugging if needed
        const debugPath = path.join(process.cwd(), `oppo_dom_dump_${accountId.replace(/[^a-zA-Z0-9]/g, '_')}.html`);
        const htmlContent = await page.content();
        await fs.writeFile(debugPath, htmlContent, 'utf-8');
        log.info(`[Orders] 📸 DUMPED DOM to ${debugPath}`);

        // Check for empty state explicitly
        const isEmpty = await page.evaluate(() => {
            const emptySelectors = ['.cart-empty', '.empty-order', '.no-order', '.empty-tip'];
            const hasEmptySelector = emptySelectors.some(s => document.querySelector(s) !== null);
            const hasEmptyText = document.body.innerText.includes("You don't have any orders yet") || 
                                document.body.innerText.includes("No orders found");
            
            // Only consider it empty if we DON'T see any order items
            const hasOrderItems = document.querySelectorAll('.order-item, .order-list-item, .order-card').length > 0;
            
            return (hasEmptySelector || hasEmptyText) && !hasOrderItems;
        });

        if (isEmpty) {
            log.info('[Orders] 📭 Account has no orders.');
            orderCache.set(accountId, 'oppo', []);
            await upsertAccount({ id: accountId, platform: 'oppo', orders: [] });
            return { success: true, count: 0, orders: [], lastUrl: page.url() };
        }

        const orders = await page.evaluate(() => {
            const items: any[] = [];
            const cards = Array.from(document.querySelectorAll('.order-item, .order-list-item, .order-card, .op-order-card'));

            cards.forEach((card, index) => {
                const statusEl = card.querySelector('.order-status, .status, [class*="status"]');
                const priceEl = card.querySelector('.price, .total-price, .amount, [class*="price"]');
                const imgEl = card.querySelector('.product-card__banner, img');
                const nameEl = card.querySelector('.info-name, .product-name, .name, [class*="name"]');
                const dateEl = card.querySelector('.order-item-time, .order-date, .time');

                const viewBtn = card.querySelector('.btn-view');
                // The URL is typically constructed or navigated to via JS, but if it has a href:
                let orderUrl = '';
                if (viewBtn && viewBtn.tagName === 'A') {
                    orderUrl = (viewBtn as HTMLAnchorElement).href;
                }

                items.push({
                    // Temporary ID since it's missing from list view
                    orderId: `OPPO_TEMP_${index}`,
                    productName: nameEl?.textContent?.trim() || 'Oppo Product',
                    status: statusEl?.textContent?.trim() || 'Ordered',
                    imageUrl: imgEl?.getAttribute('data-src') || imgEl?.getAttribute('src') || '',
                    price: priceEl?.textContent?.trim() || '',
                    orderUrl,
                    deliveryDate: dateEl?.textContent?.trim() || '',
                    // Store the index to potentially click it later
                    _cardIndex: index
                });
            });

            return items;
        });

        log.info(`[Orders] ✅ Scraped ${orders.length} orders from list view`);

        // Deep scrape all orders to get exact order IDs and tracking
        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];

            log.info(`[Orders] Deep scraping Oppo Order at index: ${i}`);
            try {
                // Oppo details are often achieved by clicking the "View order" button
                await page.goto('https://www.oppo.com/in/store/sales/order/history', { waitUntil: 'networkidle' });

                // Wait for list to load again
                await page.waitForSelector('.order-item');

                const buttons = await page.$$('.order-item .btn-view');
                if (buttons[i]) {

                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => { }),
                        buttons[i].click()
                    ]);

                    await humanDelay(page, 2000, 3000);

                    const details = await page.evaluate(() => {
                        const res: any = {};
                        const bodyText = document.body.innerText;

                        // Identify Order ID from the Details page
                        // Often format: "Order No.: xxxxxxx"
                        const idMatch = bodyText.match(/(?:Order No\.?|Order ID)[\s\S]*?([A-Z0-9]{12,})/i);
                        if (idMatch) {
                            res.orderId = idMatch[1];
                        } else {
                            // Try finding it by class explicitly
                            const idElements = Array.from(document.querySelectorAll('.value.font-body-2.font-medium'));
                            for (let el of idElements) {
                                if (el.textContent && el.textContent.trim().length >= 10 && !el.textContent.includes('₹')) {
                                    res.orderId = el.textContent.trim();
                                    break;
                                }
                            }
                        }

                        // Addresses and other info
                        // Oppo usually has an address block
                        const addrMatchers = ['.receiver-info', '.address-section', '.address-detail'];
                        for (const sel of addrMatchers) {
                            const addrEl = document.querySelector(sel);
                            if (addrEl && addrEl.textContent) {
                                res.address = (addrEl as HTMLElement).innerText.replace(/\n+/g, ', ').trim();
                                const phoneMatch = res.address.match(/\b\d{10}\b/);
                                if (phoneMatch) res.mobileLast4 = phoneMatch[0].slice(-4);
                                break;
                            }
                        }

                        const otpMatch = bodyText.match(/(?:OTP|delivery code|verification code|pin)\s*[:\-]?\s*(\d{4,6})/i);
                        if (otpMatch) res.otp = otpMatch[1];

                        const trackingMatch = bodyText.match(/(?:tracking|AWB|waybill|consignment)\s*(?:id|number)?[:\-]?\s*([A-Z0-9\-]{10,})/i);
                        if (trackingMatch) res.trackingId = trackingMatch[1];

                        const carrierKeywords = ['Shipped via', 'Courier', 'Delivery by', 'Carrier', 'Logistics'];
                        for (const kw of carrierKeywords) {
                            if (bodyText.includes(kw)) {
                                const match = bodyText.split(kw)[1]?.trim().split('\n')[0];
                                if (match && match.length < 30) res.carrier = match.trim();
                                break;
                            }
                        }

                        if (!res.carrier) {
                            const knownCarriers = ['Delhivery', 'Ecom Express', 'XpressBees', 'BlueDart', 'Ekart', 'Amazon Shipping', 'Shadowfax'];
                            for (const carrier of knownCarriers) {
                                if (bodyText.includes(carrier)) {
                                    res.carrier = carrier;
                                    break;
                                }
                            }
                        }

                        // Status might be more detailed here
                        const statusEl = document.querySelector('.status-text, .order-status');
                        if (statusEl?.textContent) res.status = statusEl.textContent.trim();

                        return res;
                    });

                    if (details.orderId) order.orderId = details.orderId;
                    if (details.address) order.address = details.address;
                    if (details.mobileLast4) order.mobileLast4 = details.mobileLast4;
                    
                    // Only update status if it's meaningful and not just the order number
                    if (details.status && !details.status.includes(order.orderId) && !details.status.match(/^[A-Z0-9]{12,}$/)) {
                         order.status = details.status;
                    }
                    
                    if (details.otp) order.otp = details.otp;
                    if (details.trackingId) order.trackingId = details.trackingId;
                    if (details.carrier) order.carrier = details.carrier;

                    order.orderUrl = page.url();

                    if (order.otp && order.status) {
                        const isInTransit = /transit|way|out for delivery|shipped|dispatched/i.test(order.status);
                        if (isInTransit) {
                            const { logActivity } = await import('../cloud_provider.js');
                            log.info(`[Orders] 🔔 OTP ALERT for Oppo ${order.orderId}: ${order.otp} `);
                            await logActivity('System', 'OTP_ALERT', {
                                platform: 'oppo',
                                accountId: accountId,
                                orderId: order.orderId,
                                otp: order.otp,
                                productName: order.productName,
                                status: order.status
                            }).catch(() => { });
                        }
                    }
                }
            } catch (e: any) {
                log.warn(`[Orders] Failed to deep scrape order at index ${i}: ${e.message} `);
            }
        }

        // Clean up temporary IDs if any weren't fully scraped
        orders.forEach((o, i) => {
            if (o.orderId.startsWith('OPPO_TEMP_')) {
                o.orderId = `OPPO_UNKNOWN_${Date.now()}_${i}`;
            }
            delete o._cardIndex;
        });

        orderCache.set(accountId, 'oppo', orders);

        const accs = await loadAccounts();
        const acc = accs.accounts.find(a => a.id === accountId);
        const chatUserId = acc?.userId || accountId;
        updateOrdersInContext(chatUserId, accountId, 'oppo', orders).catch(e => {
            log.warn(`[Orders] Failed to update chat context: ${e.message} `);
        });

        await upsertAccount({
            id: accountId,
            platform: 'oppo',
            orders: orders
        });

        return { success: true, count: orders.length, orders, lastUrl: page.url() };

    } catch (e: any) {
        log.error(`[Orders] ❌ Oppo fetch failed: ${e.message} `);
        throw e;
    } finally {
        if (browser) await browser.close();
        else if (context && !existingContext) await context.close();
    }
}
