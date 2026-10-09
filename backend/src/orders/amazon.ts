import { chromium, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { getAccountLogger } from '../log.js';
import { loadCookiesFromDB } from '../cookies.js';
import { orderCache } from '../orderCache.js';
import { loadAccounts, upsertAccount } from '../accounts.js';
import { updateOrdersInContext } from '../chat.js';
import { humanDelay } from './common.js';
import { getChromiumPath } from '../utils/browserPath.js';

export async function fetchAmazonOrders(accountId: string, existingContext?: BrowserContext) {
    const log = getAccountLogger(accountId);
    const platform = 'amazon';

    log.info(`[Orders] 🚀 Starting Amazon order fetch for ${accountId}`);

    let browser = null;
    let context = existingContext;

    // INJECT COOKIES FROM DB
    const cookies = await loadCookiesFromDB(accountId, 'amazon');
    if (!cookies || cookies.length === 0) {
        log.warn(`[Orders] ⚠️ No cookies found in DB for ${accountId}. This will likely fail.`);
    }

    try {
        if (!context) {
            browser = await chromium.launch({
                headless: true,
                executablePath: getChromiumPath(),
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-features=Autofill,PasswordManager'
                ]
            });

            // Create fresh context
            context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
        }

        if (cookies && cookies.length > 0) {
            log.info(`[Orders] 🍪 Injecting ${cookies.length} cookies from DB`);

            const playwrightCookies = cookies.map((c: any) => {
                const cookie: any = {
                    name: c.name,
                    value: c.value,
                    domain: c.domain || '.amazon.in',
                    path: c.path || '/',
                    secure: c.secure ?? true,
                    httpOnly: c.httpOnly ?? false,
                };

                if (c.expirationDate) {
                    cookie.expires = c.expirationDate;
                } else if (c.expires && c.expires !== -1) {
                    cookie.expires = c.expires;
                }

                if (c.sameSite) {
                    const sameSiteMap: Record<string, 'Strict' | 'Lax' | 'None'> = {
                        'strict': 'Strict',
                        'lax': 'Lax',
                        'no_restriction': 'None',
                        'none': 'None'
                    };
                    cookie.sameSite = sameSiteMap[c.sameSite.toLowerCase()] || 'Lax';
                }

                return cookie;
            });

            await context.addCookies(playwrightCookies);
            log.info(`[Orders] ✅ Cookies injected successfully`);
        }

        log.info('[Orders] Creating new page...');
        const page = await context.newPage();

        log.info('[Orders] Navigating to Amazon Order History...');
        await page.goto('https://www.amazon.in/gp/your-account/order-history', { waitUntil: 'networkidle', timeout: 30000 });

        log.info('[Orders] Waiting for page to fully load...');
        await page.waitForTimeout(3000);

        const currentUrl = page.url();
        log.info(`[Orders] Current URL: ${currentUrl}`);

        if (currentUrl.includes('ap/signin') || currentUrl.includes('ap/ap_signin') || currentUrl.includes('/login')) {
            log.error('[Orders] ❌ Redirected to login page - session expired');
            throw new Error('Amazon session expired. Please login again.');
        }

        const hasLoginForm = await page.evaluate(() => {
            return document.querySelector('#ap_email') !== null ||
                document.querySelector('#ap_password') !== null ||
                document.querySelector('input[name="email"]') !== null;
        });

        if (hasLoginForm) {
            log.error('[Orders] ❌ Login form detected on page - session expired');
            throw new Error('Amazon session expired. Please login again.');
        }

        log.info('[Orders] ✅ Login check passed - session is valid');

        log.info('[Orders] Waiting for order cards...');
        await humanDelay(page, 2000, 4000);

        try {
            await page.waitForSelector('.js-order-card', { timeout: 10000 });
        } catch (e) {
            log.warn('[Orders] No order cards found after wait. Account might be empty or layout changed.');
        }

        const debugHtml = await page.content();
        const dumpPath = path.join(process.cwd(), `amazon_dom_dump_${accountId}.html`);
        await fs.writeFile(dumpPath, debugHtml);
        log.info(`[Orders] 📸 DUMPED FULL DOM to ${dumpPath} - Check this file to see class names!`);

        const orders = await page.evaluate(() => {
            const items: any[] = [];
            let cards = Array.from(document.querySelectorAll('.js-order-card'));
            if (cards.length === 0) cards = Array.from(document.querySelectorAll('.yohtmlc-order-card'));
            if (cards.length === 0) cards = Array.from(document.querySelectorAll('div[id^="order-info"]'));
            if (cards.length === 0) cards = Array.from(document.querySelectorAll('.order-card'));

            console.log(`[Browser] Found ${cards.length} order cards`);

            cards.forEach(card => {
                const orderIdEl = card.querySelector('bdi[dir="ltr"]') || card.querySelector('span[dir="ltr"]') || card.querySelector('.value');
                const linkEl = card.querySelector('a.a-link-normal[href*="order-details"]');
                const statusEl = card.querySelector('.js-shipment-status-text, .shipment-status, .yohtmlc-shipment-status-primary-text, .delivery-box__primary-text');
                const imgEl = card.querySelector('img.yo-critical-feature-faceout-image, img');

                const orderId = orderIdEl?.textContent?.trim() || '';
                if (!orderId || orderId.length < 5) return;

                const link = linkEl?.getAttribute('href') || '';
                const fullUrl = link ? window.location.origin + link : '';

                items.push({
                    orderId,
                    productName: imgEl?.getAttribute('alt') || 'Amazon Order',
                    status: statusEl?.textContent?.trim() || 'Ordered',
                    deliveryDate: '',
                    imageUrl: imgEl?.getAttribute('src') || '',
                    orderUrl: fullUrl,
                    price: ''
                });
            });
            return items;
        });

        if (orders.length === 0) {
            log.warn('[Orders] 0 orders found. Dumping HTML for debugging...');
            const html = await page.content();
            const debugPath = path.join(process.cwd(), `amazon_debug_${accountId}_${Date.now()}.html`);
            await fs.writeFile(debugPath, html);
            log.info(`[Orders] Saved debug HTML to ${debugPath}`);
        } else {
            log.info(`[Orders] Successfully scraped ${orders.length} orders.`);
        }

        for (let i = 0; i < Math.min(orders.length, 5); i++) {
            const order = orders[i];
            if (order.orderUrl) {
                log.info(`[Orders] Deep scraping Amazon Order: ${order.orderId}`);
                await page.goto(order.orderUrl, { waitUntil: 'domcontentloaded' });

                const details = await page.evaluate(() => {
                    const res: any = {};
                    const addressContainer = Array.from(document.querySelectorAll('.displayAddressUl, .displayAddressDiv')).find(el => el.textContent);
                    if (addressContainer) {
                        res.address = (addressContainer as HTMLElement).innerText.replace(/\n+/g, ', ').trim();
                        const phoneMatch = res.address.match(/\d{10}/);
                        if (phoneMatch) res.mobileLast4 = phoneMatch[0].slice(-4);
                    } else {
                        const addrHeader = Array.from(document.querySelectorAll('h3, div')).find(el => el.textContent?.trim() === 'Shipping Address');
                        if (addrHeader) {
                            const addrBody = addrHeader.parentElement?.querySelector('.a-row.a-spacing-none, .a-row.address');
                            if (addrBody) {
                                res.address = (addrBody as HTMLElement).innerText.replace(/\n+/g, ', ').trim();
                            }
                        }
                    }

                    const statusHeader = document.querySelector('.js-shipment-status-text, div[class*="shipment-status"]');
                    if (statusHeader) res.status = statusHeader.textContent?.trim();

                    const trackLink = document.querySelector('a[href*="ship-track"]');
                    if (trackLink) res.trackingUrl = (trackLink as HTMLElement).getAttribute('href');

                    const dateHeader = document.querySelector('.order-date-invoice-item');
                    if (dateHeader) {
                        const txt = dateHeader.textContent || '';
                        if (txt.includes('Ordered on')) {
                            res.deliveryDate = txt.split('Ordered on')[1].trim();
                        }
                    }

                    const bodyText = document.body.innerText;
                    const otpMatch = bodyText.match(/OTP\s*[:\-]?\s*(\d{6})/i);
                    if (otpMatch) res.otp = otpMatch[1];

                    return res;
                });

                if (details.address) order.address = details.address;
                if (details.mobileLast4) order.mobileLast4 = details.mobileLast4;
                if (details.status) order.status = details.status;
                if (details.deliveryDate) order.deliveryDate = details.deliveryDate;
                if (details.otp) order.otp = details.otp;

                if (details.trackingUrl) {
                    try {
                        const trackUrl = details.trackingUrl.startsWith('http')
                            ? details.trackingUrl
                            : `https://www.amazon.in${details.trackingUrl}`;

                        log.info(`[Orders] Navigating to Track Package: ${trackUrl}`);
                        await page.goto(trackUrl, { waitUntil: 'domcontentloaded' });
                        await page.waitForTimeout(2000);

                        const trackDetails = await page.evaluate(() => {
                            const res: any = {};
                            const bodyText = document.body.innerText;
                            const otpMatch = bodyText.match(/(?:OTP|delivery code|verification code)\s*[:\-]?\s*(\d{4,6})/i);
                            if (otpMatch) res.otp = otpMatch[1];

                            const carrierMatch = bodyText.match(/(?:shipped via|carrier|courier)\s*[:\-]?\s*([A-Za-z0-9\s]+)/i);
                            if (carrierMatch) res.carrier = carrierMatch[1].trim();

                            const trackingIdMatch = bodyText.match(/(?:tracking id|AWB|tracking number|waybill)[: ]*\s*([A-Z0-9]+)/i);
                            if (trackingIdMatch) res.trackingId = trackingIdMatch[1].trim();

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

                            const statusEl = document.querySelector('.a-size-medium.milestone-primaryMessage, .pt-status-title, [data-testid="shipment-status"]');
                            if (statusEl) res.status = statusEl.textContent?.trim();

                            const addressEl = document.querySelector('.pt-delivery-slot-info, .delivery-address, .pt-addr');
                            if (addressEl) res.address = (addressEl as HTMLElement).innerText.replace(/\n+/g, ', ').trim();

                            const mobileMatch = bodyText.match(/\b(\d{10})\b/);
                            if (mobileMatch) res.mobileLast4 = mobileMatch[1].slice(-4);

                            return res;
                        });

                        if (trackDetails.otp && !order.otp) order.otp = trackDetails.otp;
                        if (trackDetails.carrier) order.carrier = trackDetails.carrier;
                        if (trackDetails.trackingId && !order.trackingId) order.trackingId = trackDetails.trackingId;
                        if (trackDetails.status) order.status = trackDetails.status;
                        if (trackDetails.address && !order.address) order.address = trackDetails.address;
                        if (trackDetails.mobileLast4 && !order.mobileLast4) order.mobileLast4 = trackDetails.mobileLast4;

                    } catch (trackErr: any) {
                        log.warn(`[Orders] Failed to scrape Track Package page: ${trackErr.message}`);
                    }
                }

                if (order.otp && order.status) {
                    const isInTransit = /transit|way|out for delivery|shipped|arriving/i.test(order.status);
                    if (isInTransit) {
                        const { logActivity } = await import('../cloud_provider.js');
                        log.info(`[Orders] 🔔 OTP ALERT for ${order.orderId}: ${order.otp}`);
                        await logActivity('System', 'OTP_ALERT', {
                            platform: 'amazon',
                            accountId: accountId,
                            orderId: order.orderId,
                            otp: order.otp,
                            productName: order.productName,
                            status: order.status
                        });
                    }
                }
            }
        }

        orderCache.set(accountId, 'amazon', orders);

        const acc = (await loadAccounts()).accounts.find(a => a.id === accountId);
        const chatUserId = acc?.userId || accountId;
        updateOrdersInContext(chatUserId, accountId, 'amazon', orders).catch(e => {
            log.warn(`[Orders] Failed to update chat context: ${e.message}`);
        });

        await upsertAccount({
            id: accountId,
            platform: 'amazon',
            orders: orders
        });

        return { success: true, count: orders.length, orders, lastUrl: page.url() };

    } catch (e: any) {
        log.error(`[Orders] Amazon fetch failed: ${e.message}`);
        throw e;
    } finally {
        if (browser) await browser.close();
        else if (context && !existingContext) await context.close();
    }
}
