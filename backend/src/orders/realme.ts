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

export async function fetchRealmeOrders(accountId: string, existingContext?: BrowserContext) {
    const log = getAccountLogger(accountId);
    const platform = 'realme';
    const fingerprint = generateFingerprint(platform, accountId);

    const cookies = await getUnifiedCookies(accountId, platform);
    const ls = await loadLocalStorage(accountId, platform);

    if (cookies.length === 0) {
        throw new Error('No saved cookies found. Please log in first.');
    }

    log.info(`[Orders] 🚀 Starting Realme order fetch for ${accountId}`);

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

        log.info(`[Orders] Navigating to Realme Homepage to stabilize session...`);
        await page.goto('https://www.realme.com/in', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000); // Give the SPA/Auth time to recognize the cookies

        const ordersUrl = 'https://buy.realme.com/in/orders';
        log.info(`[Orders] Now navigating to Realme Order List: ${ordersUrl}`);
        await page.goto(ordersUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });

        // Wait for page to settle (passport redirects can be slow)
        await page.waitForTimeout(5000);

        let currentUrl = page.url();
        log.info(`[Orders] Current URL after initial navigation: ${currentUrl}`);

        if (currentUrl.includes('login') || currentUrl.includes('passport')) {
            log.info('[Orders] Redirected to login. Waiting for network to settle in case of auto-login...');
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
            await page.waitForTimeout(3000);
            currentUrl = page.url();
        }

        if (currentUrl.includes('id.realme.com') || currentUrl.includes('login') || currentUrl.includes('passport')) {
            log.error(`[Orders] ❌ Realme session expired - stuck on login page: ${currentUrl}`);
            throw new Error('Realme session expired. Please login again.');
        }

        log.info('[Orders] Waiting for order elements...');

        try {
            await page.waitForSelector('.user-center-order, .no-data, .empty, .empty-order', { timeout: 15000 });
            log.info('[Orders] ✅ Page content detected');
            // EXTRA SAFETY: Wait a bit more for any late redirects/SPA refreshes that cause context destruction
            await page.waitForTimeout(2000);
        } catch (e) {
            log.warn('[Orders] ⚠️ Timeout waiting for Realme order content. Continuing to scrape current DOM.');
        }

        // Use a wrapper to catch "Execution context was destroyed" and retry once
        const safeEvaluate = async <T>(fn: () => T | Promise<T>): Promise<T> => {
            try {
                return await page.evaluate(fn);
            } catch (err: any) {
                if (err.message.includes('context was destroyed') || err.message.includes('Execution context was destroyed')) {
                    log.info('[Orders] Context destroyed, retrying evaluation after delay...');
                    await page.waitForTimeout(3000);
                    return await page.evaluate(fn);
                }
                throw err;
            }
        };

        const isEmpty = await safeEvaluate(() => {
            return document.querySelector('.user-center-order') === null;
        });

        if (isEmpty) {
            log.info('[Orders] 📭 Account has no orders.');
            orderCache.set(accountId, 'realme', []);
            await upsertAccount({ id: accountId, platform: 'realme', orders: [] });
            return { success: true, count: 0, orders: [], lastUrl: page.url() };
        }

        // Dump DOM for debugging if needed
        const debugPath = path.join(process.cwd(), `realme_dom_dump_${accountId.replace(/[^a-zA-Z0-9]/g, '_')}.html`);
        const htmlContent = await page.content();
        await fs.writeFile(debugPath, htmlContent, 'utf-8');
        log.info(`[Orders] 📸 DUMPED DOM to ${debugPath}`);

        const orders = await safeEvaluate(() => {
            const items: any[] = [];
            const cards = Array.from(document.querySelectorAll('.user-center-order'));

            cards.forEach((card, index) => {
                const idEl = card.querySelector('.orderNo');
                const statusEl = card.querySelector('.user-order-status');
                const priceEl = card.querySelector('.user-footer-info li:last-child span > span');
                const imgEl = card.querySelector('.item-left img.img');
                const nameEl = card.querySelector('.item-product-detail .product-name');
                const dateEl = card.querySelector('.user-order-info > span:last-child');
                const expectedDateEl = card.querySelector('.expectDate > p');

                const linkEl = card.querySelector('.user-order-info a');
                let orderUrl = '';
                if (linkEl && linkEl.tagName === 'A') {
                    orderUrl = (linkEl as HTMLAnchorElement).href;
                }

                items.push({
                    orderId: idEl?.textContent?.trim() || `REALME_TEMP_${index}`,
                    productName: nameEl?.textContent?.trim() || 'Realme Product',
                    status: statusEl?.textContent?.trim() || 'Ordered',
                    imageUrl: imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || '',
                    price: priceEl?.textContent?.trim() || '',
                    orderUrl,
                    deliveryDate: expectedDateEl?.textContent?.replace('It is estimated to be delivered by', '').trim() || '',
                    orderDate: dateEl?.textContent?.replace('Order On:', '').trim() || '',
                    _cardIndex: index
                });
            });

            return items;
        });

        log.info(`[Orders] ✅ Scraped ${orders.length} orders from list view`);

        // Deep scrape first few orders to get details like tracking, OTP, etc.
        for (let i = 0; i < Math.min(orders.length, 3); i++) {
            const order = orders[i];

            if (!order.orderUrl || order.orderUrl === '') continue;

            log.info(`[Orders] Deep scraping Realme Order: ${order.orderId}`);
            try {
                await page.goto(order.orderUrl, { waitUntil: 'domcontentloaded' });
                await humanDelay(page, 3000, 4000);

                    const details = await page.evaluate(() => {
                        const res: any = {};
                        const bodyText = document.body.innerText;

                        // Address blocks
                        const addrMatchers = ['.address-info', '.delivery-address', '.receiver-info'];
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

                        return res;
                    });

                if (details.address) order.address = details.address;
                if (details.mobileLast4) order.mobileLast4 = details.mobileLast4;
                if (details.otp) order.otp = details.otp;
                if (details.trackingId) order.trackingId = details.trackingId;
                if (details.carrier) order.carrier = details.carrier;

                if (order.otp && order.status) {
                    const isInTransit = /transit|way|out for delivery|shipped|dispatched/i.test(order.status);
                    if (isInTransit) {
                        const { logActivity } = await import('../cloud_provider.js');
                        log.info(`[Orders] 🔔 OTP ALERT for Realme ${order.orderId}: ${order.otp} `);
                        await logActivity('System', 'OTP_ALERT', {
                            platform: 'realme',
                            accountId: accountId,
                            orderId: order.orderId,
                            otp: order.otp,
                            productName: order.productName,
                            status: order.status
                        }).catch(() => { });
                    }
                }
            } catch (e: any) {
                log.warn(`[Orders] Failed to deep scrape Realme order ${order.orderId}: ${e.message} `);
            }
        }

        orders.forEach((o: any) => {
            delete o._cardIndex;
        });

        orderCache.set(accountId, 'realme', orders);

        const accs = await loadAccounts();
        const acc = accs.accounts.find(a => a.id === accountId);
        const chatUserId = acc?.userId || accountId;
        updateOrdersInContext(chatUserId, accountId, 'realme', orders).catch(e => {
            log.warn(`[Orders] Failed to update chat context: ${e.message} `);
        });

        await upsertAccount({
            id: accountId,
            platform: 'realme',
            orders: orders
        });

        return { success: true, count: orders.length, orders, lastUrl: page.url() };

    } catch (e: any) {
        log.error(`[Orders] ❌ Realme fetch failed: ${e.message} `);
        throw e;
    } finally {
        if (browser) await browser.close();
        else if (context && !existingContext) await context.close();
    }
}
