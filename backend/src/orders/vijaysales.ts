import { chromium, BrowserContext } from 'playwright';
import { getUnifiedCookies } from '../cookies.js';
import { upsertAccount, getAccount } from '../accounts.js';
import { updateOrdersInContext } from '../chat.js';
import { orderCache } from '../orderCache.js';
import { loadLocalStorage } from '../localStorage.js';
import { getChromiumPath } from '../utils/browserPath.js';

export async function fetchVijaysalesOrders(accountId: string, existingContext?: BrowserContext) {
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

        // Injected LS is crucial for Vijay Sales session
        const savedLs = await loadLocalStorage(accountId, 'vijaysales');
        if (savedLs) {
            await context.addInitScript((data) => {
                for (const [key, value] of Object.entries(data)) {
                    window.localStorage.setItem(key, value as string);
                }
            }, savedLs);
        }

        const savedCookies = await getUnifiedCookies(accountId, 'vijaysales');
        if (savedCookies.length > 0) {
            await context.addCookies(savedCookies);
        }

        const page = await context.newPage();

        // Go directly to the My Orders page
        await page.goto('https://www.vijaysales.com/profile-page/my-order', { waitUntil: 'load', timeout: 60000 });

        // Wait for either the order container or the empty state
        await page.waitForSelector('.order-delievey-status-details, .myorder_div_box, .searchItemError, .myorders-wrapper', { timeout: 20000 }).catch(() => { });

        // Wait a small amount for JS framework to render any API responses
        await page.waitForTimeout(5000);

        const orders = await page.evaluate(() => {
            const items: any[] = [];

            // Vijay Sales specific order layout
            const cards = Array.from(document.querySelectorAll('.myorder_div_box'));
            console.log(`Found ${cards.length} cards`);

            for (const card of cards) {
                // Extract Order ID
                const orderIdEl = card.querySelector('.myorder_div_box_order_id strong') || card.querySelector('.myorder_div_box_order_id') || card.querySelector('.order-id-txt strong');
                let orderId = orderIdEl ? (orderIdEl as HTMLElement).textContent?.trim() : null;
                console.log(`Raw OrderID: ${orderId}`);
                
                if (orderId) {
                    orderId = orderId.replace('Order#', '').trim().split(/\s+/)[0];
                }

                if (!orderId || orderId === '8908-89308') {
                    console.log('Skipping card due to invalid/dummy OrderID');
                    continue; 
                }

                // Status usually in .order-delievey-status-details or .d-green or .delivery-status_txt
                const statusEl = card.querySelector('.order-delievey-status-details') || card.querySelector('.d-green') || card.querySelector('.delivery-status_txt') || card.querySelector('.order_delivery-status');
                let status = 'Processing';
                if (statusEl) {
                    const attrStatus = (statusEl as HTMLElement).getAttribute('order-status');
                    status = attrStatus || (statusEl as HTMLElement).textContent?.trim() || 'Processing';
                }

                // Delivery date/info
                const statusDetails = card.querySelector('.order-delievey-status-details');
                let date = new Date().toISOString().split('T')[0];
                if (statusDetails) {
                    const attrDate = (statusDetails as HTMLElement).getAttribute('order-date');
                    if (attrDate) {
                        date = attrDate;
                    } else {
                        // Sometimes the date is in a <p> tag within the status details
                        const pTags = Array.from(statusDetails.querySelectorAll('p'));
                        const dateP = pTags.find(p => p.textContent?.match(/\d{4}/)); // Find <p> with a year
                        if (dateP) date = dateP.textContent?.trim() || date;
                    }
                } else {
                    const confirmTime = card.querySelector('.order_delivery-confirmTime');
                    if (confirmTime) date = confirmTime.textContent?.trim() || date;
                }

                // Iterate over products in this order
                const productNodes = Array.from(card.querySelectorAll('.myorder_comp-card'));
                const fallbackNodes = productNodes.length === 0 ? Array.from(card.querySelectorAll('.order_delivery-product')) : productNodes;
                
                console.log(`Found ${fallbackNodes.length} products for OrderID ${orderId}`);

                for (const prodNode of fallbackNodes) {
                    const titleEl = prodNode.querySelector('.data-txt') || prodNode.querySelector('.delivery-data-txt') || prodNode;
                    const priceEl = prodNode.querySelector('.delivery-data_price');
                    const imgEl = prodNode.querySelector('img') || card.querySelector('.order_delivery-img img');
                    
                    const title = titleEl ? (titleEl as HTMLElement).textContent?.trim() || '' : 'Unknown Product';
                    console.log(`Product Title: ${title}`);
                    if (!title || title === 'Unknown Product' || title === 'Invoice') continue;

                    const priceText = priceEl ? (priceEl as HTMLElement).textContent?.trim() || '' : '';
                    const priceMatch = priceText.match(/([0-9,]+(?:\.[0-9]{2})?)/);
                    const price = priceMatch ? priceMatch[1] : '0';

                    const aNode = prodNode.closest('a') || card.querySelector('a');
                    const orderUrl = aNode ? (aNode as HTMLAnchorElement).href : `https://www.vijaysales.com/profile-page/my-order`;

                    // Extra status info sometimes available in the product card itself
                    const productStatusEl = prodNode.querySelector('.delivery-status_txt');
                    const finalStatus = productStatusEl ? productStatusEl.textContent?.trim() || status : status;

                    items.push({
                        orderId,
                        deliveryDate: date,
                        productName: title,
                        imageUrl: imgEl ? (imgEl as HTMLImageElement).src : '',
                        price,
                        status: finalStatus.replace(/[\n\r]/g, ' ').trim(),
                        orderUrl
                    });
                }
            }
            return items;
        });

        console.log(`[Vijay Sales] Found ${orders.length} orders for account ${accountId}`);

        if (!existingContext) {
            await browser?.close();
        }

        if (orders.length > 0) {
            await upsertAccount({
                id: accountId,
                platform: 'vijaysales',
                orders: orders
            });

            const acc = await getAccount(accountId);
            const chatUserId = acc?.userId || accountId;
            updateOrdersInContext(chatUserId, accountId, 'vijaysales', orders).catch(e => {
                console.warn(`[Orders] Vijay Sales chat update failed: ${e.message}`);
            });
        }
        orderCache.set(accountId, 'vijaysales', orders);

        return orders;

    } catch (error: any) {
        console.error(`[Vijay Sales] Error fetching orders for ${accountId}:`, error.message);
        if (!existingContext) {
            await browser?.close();
        }
        throw error;
    }
}
