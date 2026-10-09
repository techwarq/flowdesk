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

export async function fetchOneplusOrders(accountId: string, existingContext?: BrowserContext) {
    const log = getAccountLogger(accountId);
    const platform = 'oneplus';
    const fingerprint = generateFingerprint(platform, accountId);

    const cookies = await getUnifiedCookies(accountId, platform);
    const ls = await loadLocalStorage(accountId, platform);

    if (cookies.length === 0) {
        throw new Error('No saved cookies found. Please log in first.');
    }

    log.info(`[Orders] 🚀 Starting OnePlus order fetch for ${accountId}`);

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

        const ordersUrl = 'https://www.oneplus.in/sales/order/history?from=head#/';
        log.info(`[Orders] Navigating to OnePlus Order List: ${ordersUrl}`);
        await page.goto(ordersUrl, { waitUntil: 'networkidle', timeout: 30000 });

        await page.waitForTimeout(5000); // OnePlus can be slow to render the React app

        const currentUrl = page.url();
        log.info(`[Orders] Current URL after navigation: ${currentUrl}`);

        if (currentUrl.includes('accounts.oneplus.com/login')) {
            log.error(`[Orders] ❌ OnePlus session expired - redirected to login`);
            throw new Error('OnePlus session expired. Please login again.');
        }

        log.info('[Orders] Waiting for order elements...');
        // Verified selectors for OnePlus orders
        // .order-list-container is the parent
        // .order-container or .detail-item are likely individual order cards
        const orderSelectors = [
            '.order-container',
            '.detail-item',
            '.order-list-item',
            '.order-item',
            '.op-order-card'
        ];

        try {
            await page.waitForSelector(orderSelectors.join(', ') + ', .empty-content, .empty-tip', { timeout: 15000 });
            log.info('[Orders] ✅ Page content detected');
        } catch (e) {
            log.warn('[Orders] ⚠️ Timeout waiting for OnePlus order content. Continuing to scrape current DOM.');
        }

        // Check for empty state explicitly
        const isEmpty = await page.evaluate(() => {
            return document.querySelector('.empty-content') !== null ||
                document.querySelector('.empty-tip') !== null ||
                document.body.innerText.includes("You don’t have any orders yet");
        });

        if (isEmpty) {
            log.info('[Orders] 📭 Account has no orders.');
            orderCache.set(accountId, 'oneplus', []);
            await upsertAccount({ id: accountId, platform: 'oneplus', orders: [] });
            return { success: true, count: 0, orders: [], lastUrl: page.url() };
        }

        // Dump DOM for debugging if needed
        const debugPath = path.join(process.cwd(), `oneplus_dom_dump_${accountId.replace(/[^a-zA-Z0-9]/g, '_')}.html`);
        const htmlContent = await page.content();
        await fs.writeFile(debugPath, htmlContent, 'utf-8');
        log.info(`[Orders] 📸 DUMPED DOM to ${debugPath}`);

        const orders = await page.evaluate(() => {
            const items: any[] = [];

            // Try different possible card containers
            let cards = Array.from(document.querySelectorAll('.order-container, .detail-item, .order-list-item, .order-item, .op-order-card'));

            // Fallback: If no cards found by class, look for elements that look like order IDs
            if (cards.length === 0) {
                const possibleIds = Array.from(document.querySelectorAll('*')).filter(el =>
                    el.textContent && /^(OP|11)\d{10,}/.test(el.textContent.trim())
                );
                // @ts-ignore
                cards = possibleIds.map(el => el.closest('div, li, section')).filter(Boolean);
                // Remove duplicates
                cards = Array.from(new Set(cards));
            }

            cards.forEach(card => {
                // OnePlus IDs usually start with OP or are 12+ digits
                // @ts-ignore
                const innerText = card.innerText || '';
                const idMatch = innerText.match(/(?:Order ID|Order No|No|Order Number)\.?\s*[:\-]?\s*([A-Z0-9]{10,})/i);
                let orderId = idMatch ? idMatch[1] : '';

                if (!orderId) {
                    // Try to find it in links
                    const detailLink = card.querySelector('a[href*="order/detail"], a[href*="orderId"], a[href*="#/detail/"]');
                    const linkMatch = detailLink?.getAttribute('href')?.match(/\/detail\/([A-Z0-9]+)/);
                    if (linkMatch) orderId = linkMatch[1];
                }

                if (!orderId) return;

                const statusEl = card.querySelector('.status, .order-status, .current-status, [class*="status"]');
                const priceEl = card.querySelector('.price, .total-price, .amount, [class*="price"]');
                const imgEl = card.querySelector('img');
                const nameEl = card.querySelector('.product-name, .name, .title, [class*="name"]');

                const detailLink = card.querySelector('a[href*="order/detail"], a[href*="orderId"], a[href*="#/detail/"]');
                const orderUrl = detailLink ? (detailLink as HTMLAnchorElement).href : '';

                items.push({
                    orderId,
                    productName: nameEl?.textContent?.trim() || 'OnePlus Product',
                    status: statusEl?.textContent?.trim() || 'Ordered',
                    imageUrl: imgEl?.src || '',
                    price: priceEl?.textContent?.trim() || '',
                    orderUrl,
                    deliveryDate: ''
                });
            });

            return items;
        });

        log.info(`[Orders] ✅ Scraped ${orders.length} orders from list view`);

        // Deep scrape first few orders
        for (let i = 0; i < Math.min(orders.length, 3); i++) {
            const order = orders[i];
            if (order.orderUrl) {
                log.info(`[Orders] Deep scraping OnePlus Order: ${order.orderId}`);
                try {
                    await page.goto(order.orderUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                    await humanDelay(page, 2000, 3000);

                    const details = await page.evaluate(() => {
                        const res: any = {};
                        const bodyText = document.body.innerText;

                        const addrSelectors = ['.address-info', '.delivery-address', '.shipping-address', '[class*="address"]'];
                        for (const sel of addrSelectors) {
                            const addrEl = document.querySelector(sel);
                            if (addrEl && addrEl.textContent) {
                                res.address = (addrEl as HTMLElement).innerText.replace(/\n+/g, ', ').trim();
                                const phoneMatch = res.address.match(/\b\d{10}\b/);
                                if (phoneMatch) res.mobileLast4 = phoneMatch[0].slice(-4);
                                break;
                            }
                        }

                        const statusEl = document.querySelector('.order-status, .current-status, [class*="status-text"]');
                        if (statusEl) res.status = statusEl.textContent?.trim();

                        const otpMatch = bodyText.match(/(?:OTP|delivery code|verification code)\s*[:\-]?\s*(\d{4,6})/i);
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

                        const dateMatch = bodyText.match(/(?:Ordered on|Order Date)[:\-]?\s*([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i);
                        if (dateMatch) res.deliveryDate = dateMatch[1];

                        return res;
                    });

                    if (details.address) order.address = details.address;
                    if (details.mobileLast4) order.mobileLast4 = details.mobileLast4;
                    if (details.status) order.status = details.status;
                    if (details.otp) order.otp = details.otp;
                    if (details.trackingId) order.trackingId = details.trackingId;
                    if (details.carrier) order.carrier = details.carrier;
                    if (details.deliveryDate) order.deliveryDate = details.deliveryDate;

                    if (order.otp && order.status) {
                        const isInTransit = /transit|way|out for delivery|shipped|dispatched/i.test(order.status);
                        if (isInTransit) {
                            const { logActivity } = await import('../cloud_provider.js');
                            log.info(`[Orders] 🔔 OTP ALERT for OnePlus ${order.orderId}: ${order.otp}`);
                            await logActivity('System', 'OTP_ALERT', {
                                platform: 'oneplus',
                                accountId: accountId,
                                orderId: order.orderId,
                                otp: order.otp,
                                productName: order.productName,
                                status: order.status
                            }).catch(() => { });
                        }
                    }
                } catch (e: any) {
                    log.warn(`[Orders] Failed to deep scrape ${order.orderId}: ${e.message}`);
                }
            }
        }

        orderCache.set(accountId, 'oneplus', orders);

        const accs = await loadAccounts();
        const acc = accs.accounts.find(a => a.id === accountId);
        const chatUserId = acc?.userId || accountId;
        updateOrdersInContext(chatUserId, accountId, 'oneplus', orders).catch(e => {
            log.warn(`[Orders] Failed to update chat context: ${e.message}`);
        });

        await upsertAccount({
            id: accountId,
            platform: 'oneplus',
            orders: orders
        });

        return { success: true, count: orders.length, orders, lastUrl: page.url() };

    } catch (e: any) {
        log.error(`[Orders] ❌ OnePlus fetch failed: ${e.message}`);
        throw e;
    } finally {
        if (browser) await browser.close();
        else if (context && !existingContext) await context.close();
    }
}
