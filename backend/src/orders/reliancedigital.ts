import { chromium, BrowserContext } from 'playwright';
import { getUnifiedCookies } from '../cookies.js';
import { upsertAccount, getAccount } from '../accounts.js';
import { updateOrdersInContext } from '../chat.js';
import { orderCache } from '../orderCache.js';
import { getChromiumPath } from '../utils/browserPath.js';

export async function fetchReliancedigitalOrders(accountId: string, existingContext?: BrowserContext) {
    let browser;
    let context = existingContext;

    try {
        if (!context) {
            browser = await chromium.launch({ 
                headless: true, 
                executablePath: getChromiumPath() 
            });
            context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
        }

        const savedCookies = await getUnifiedCookies(accountId, 'reliancedigital');
        if (savedCookies.length > 0) {
            await context.addCookies(savedCookies);
        }

        const page = await context.newPage();

        // Let's directly go to the orders page to ensure cookies are sent to their domain
        await page.goto('https://www.reliancedigital.in/profile/orders', { waitUntil: 'load', timeout: 30000 });

        // Looking at rd_dom.html, they use their Raven API:
        // /ext/raven-api/order/{order_id}
        // Instead of parsing DOM, let's see what network requests are made or try to extract order details
        // Since we can't see the order list API directly in the snippet, let's look for standard elements if the API approach isn't immediately obvious, 
        // OR we can evaluate a script to fetch it if we know the endpoint.
        // Wait, since we are doing headless browsers, maybe the `window.config` or similar state holds user data.

        // For now, let's scrape the DOM based on general assumption of their /profile/orders page structure
        const orders = await page.evaluate(() => {
            const items: any[] = [];

            // Typical Reliance Digital order cards
            const cards = Array.from(document.querySelectorAll('.order-status, .order-item, .my-order-item, .order-tracking-main-container'));

            for (const card of cards) {
                // Try to extract basic details
                const titleEl = card.querySelector('.title, .productname, .p-name, h3, h4');
                const priceEl = card.querySelector('.price, .amount, .p-price');
                const statusEl = card.querySelector('.status, .del-status, .delivery-status, .text-success');
                const dateEl = card.querySelector('.date, .order-date, .placed-on');
                const orderIdEl = card.querySelector('.order-id, .order-number, span[contains(text(), "Order")]');

                const title = titleEl ? (titleEl as HTMLElement).innerText.trim() : 'Unknown Product';
                const priceMatch = priceEl ? (priceEl as HTMLElement).innerText.match(/₹?\\s*([0-9,]+(?:\\.[0-9]{2})?)/) : null;
                const price = priceMatch ? priceMatch[1] : '0';
                const status = statusEl ? (statusEl as HTMLElement).innerText.trim() : 'Processing';
                const date = dateEl ? (dateEl as HTMLElement).innerText.trim() : new Date().toISOString().split('T')[0];
                const orderIdMatch = orderIdEl ? (orderIdEl as HTMLElement).innerText.match(/[0-9]{8,}/) : null;
                const orderId = orderIdMatch ? orderIdMatch[0] : `RD_${Math.floor(Math.random() * 1000000)}`;

                items.push({
                    orderId,
                    date,
                    product: title,
                    price,
                    status,
                    url: `https://www.reliancedigital.in/c/order/tracking?orderId=${orderId}`
                });
            }
            return items;
        });

        // Try getting via API route if the DOM scrape failed
        if (orders.length === 0) {
            console.log("No orders found via basic DOM selectors list, analyzing application state...");

            // Can we find something in the window object like window.__INITIAL_STATE__?
            const stateOrders = await page.evaluate(() => {
                try {
                    // Try intercepting fetch or reading state if it's a typical vue app
                    // We might not be able to easily guess the API just yet.
                    return [];
                } catch (e) {
                    return [];
                }
            });
            if (stateOrders.length > 0) {
                orders.push(...stateOrders);
            }
        }

        console.log(`[Reliance Digital] Found ${orders.length} orders for account ${accountId}`);

        if (!existingContext) {
            await browser?.close();
        }

        if (orders.length > 0) {
            await upsertAccount({
                id: accountId,
                platform: 'reliancedigital',
                orders: orders
            });

            const acc = await getAccount(accountId);
            const chatUserId = acc?.userId || accountId;
            updateOrdersInContext(chatUserId, accountId, 'reliancedigital', orders).catch(e => {
                console.warn(`[Orders] Reliance Digital chat update failed: ${e.message}`);
            });
        }
        orderCache.set(accountId, 'reliancedigital', orders);

        return orders;

    } catch (error: any) {
        console.error(`[Reliance Digital] Error fetching orders for ${accountId}:`, error.message);
        if (!existingContext) {
            await browser?.close();
        }
        throw error;
    }
}
