import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { PROFILES_DIR } from '../config.js';
import { getAccountLogger } from '../log.js';
import { getUnifiedCookies } from '../cookies.js';
import { loadLocalStorage } from '../localStorage.js';
import { browsers } from '../browserManager.js';
import { getChromiumPath } from '../utils/browserPath.js';
import { upsertAccount, getAccount } from '../accounts.js';
import { updateOrdersInContext } from '../chat.js';
import { orderCache } from '../orderCache.js';

export async function fetchVivoOrders(accountId: string): Promise<any[]> {
    const platform = 'vivo';
    const log = getAccountLogger(accountId);

    const normalizedId = accountId.toLowerCase().trim();
    const profilePath = path.join(PROFILES_DIR, platform, normalizedId, 'temp_orders_capture');
    await fs.ensureDir(profilePath);

    log.info(`[Vivo] Launching browser to fetch orders...`);
    const executablePath = getChromiumPath();

    const context = await chromium.launchPersistentContext(profilePath, {
        executablePath,
        headless: true,
        viewport: { width: 1280, height: 720 },
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
        ]
    });

    browsers.register(`${accountId}-vivo-orders`, context);

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

        // Navigate to the My Orders page
        log.info(`[Vivo] Navigating to My Orders...`);
        // Try multiple common BBK order URLs
        const possibleUrls = [
            'https://shop.vivo.com/in/person/order/list', // Standard BBK layout
            'https://shop.vivo.com/in/my/orders'          // Fallback
        ];

        let foundOrdersPage = false;
        let ordersUrl = 'https://shop.vivo.com/in/my/orders'; // Default fallback

        for (const url of possibleUrls) {
            log.info(`[Vivo] Trying URL: ${url}`);
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(3000);
            
            const content = await page.content();
            if (!content.includes('can’t find the page') && !content.includes('Oops')) {
                foundOrdersPage = true;
                ordersUrl = url;
                break;
            }
        }

        if (!foundOrdersPage) {
            log.warn(`[Vivo] Common URLs failed. Attempting to find 'My orders' link in current page...`);
            const myOrdersHref = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const myOrders = links.find(a => a.innerText.toLowerCase().includes('my orders'));
                return myOrders ? myOrders.href : null;
            });

            if (myOrdersHref) {
                log.info(`[Vivo] Found link: ${myOrdersHref}. Navigating...`);
                await page.goto(myOrdersHref, { waitUntil: 'networkidle' });
                ordersUrl = myOrdersHref;
            }
        }

        await page.waitForTimeout(5000);

        const currentUrl = page.url();
        const currentTitle = await page.title();
        log.info(`[Vivo] Current URL: ${currentUrl} | Title: ${currentTitle}`);

        if (currentUrl.includes('login') || currentUrl.includes('signin')) {
            log.error(`[Vivo] Session expired - redirected to login`);
            throw new Error('Vivo session expired. Please login again.');
        }

        // Wait for page to render (either empty state or order state)
        try {
            await page.waitForSelector('.order-item, .order-list-item, .empty-list, .no-order, .order-list-wrapper, .order-card, .order-info, [class*="order"]', { timeout: 15000 });
            log.info(`[Vivo] Wait for selector finished successfully.`);
        } catch (e) {
            log.warn(`[Vivo] Timeout waiting for order list elements. Proceeding with extraction anyway...`);
        }        const orders = await page.evaluate(() => {
            const items: any[] = [];

            // 1. Try extracting from NUXT state (most reliable)
            try {
                const nuxt: any = (window as any).__NUXT__;
                if (nuxt && nuxt.data) {
                    const findOrders = (obj: any, depth = 0): any[] | null => {
                        if (!obj || typeof obj !== 'object' || depth > 10) return null;
                        
                        // Check if this object is the order list
                        if (Array.isArray(obj)) {
                            if (obj.length > 0 && obj[0].orderNo) return obj;
                            for (const item of obj) {
                                const found = findOrders(item, depth + 1);
                                if (found) return found;
                            }
                        } else {
                            if (obj.recentOrderList && Array.isArray(obj.recentOrderList)) return obj.recentOrderList;
                            if (obj.orderList && Array.isArray(obj.orderList)) return obj.orderList;
                            
                            // Recursive search
                            for (const key in obj) {
                                const found = findOrders(obj[key], depth + 1);
                                if (found) return found;
                            }
                        }
                        return null;
                    };

                    const nuxtOrders = findOrders(nuxt.data);
                    if (nuxtOrders && Array.isArray(nuxtOrders)) {
                        nuxtOrders.forEach((o: any, idx: number) => {
                            const firstItem = (o.itemList && o.itemList[0]) || (o.skuList && o.skuList[0]) || o;
                            let name = firstItem.name || firstItem.skuName || 'Vivo Product';
                            // If name is an email, it's wrong - fall back to SKU info
                            if (name.includes('@')) {
                                name = firstItem.skuName || firstItem.goodsName || 'Vivo Product';
                            }
                            
                            items.push({
                                orderId: o.orderNo || o.orderId || `PENDING_${idx}`,
                                productName: name,
                                status: o.orderStatus || o.statusName || 'Ordered',
                                imageUrl: firstItem.picUrl || firstItem.skuPic || '',
                                // payAmt = final payable after discounts/coupons
                                price: o.moneyInfo?.payAmt ? `₹${o.moneyInfo.payAmt}` : (o.orderAmount ? `₹${o.orderAmount}` : ''),
                                orderUrl: `/in/person/order/detail?orderNo=${o.orderNo || o.orderId}`,
                                itemIndex: idx
                            });
                        });
                        if (items.length > 0) return items;
                    }
                }
            } catch (e) {}

            // 2. Fallback to DOM scraping (Verified selectors)
            const cards = Array.from(document.querySelectorAll('.goods-info.point, [class*="order-item"], [class*="order-card"]')) as HTMLElement[];
            cards.forEach((el, index) => {
                const text = el.innerText || '';
                
                // Status Blacklist to avoid picking up status as Name
                const statusBlacklist = ['To Receive', 'Completed', 'Canceled', 'To Ship', 'To Pay', 'In Transit', 'Returned', 'Refunded'];
                
                // Extract Name - Target the specific div structure found in research
                let productName = 'Vivo Product';
                const nameCandidates = Array.from(el.querySelectorAll('.name, .product-name, [class*="name"]'))
                    .map(e => e.textContent?.trim() || '')
                    .filter(t => t.length > 3 && 
                                !statusBlacklist.some(s => t.includes(s)) && 
                                !t.includes('₹') && 
                                !t.includes('Order') && 
                                !t.includes('@') // EXCLUDE EMAILS
                            );
                
                if (nameCandidates.length > 0) {
                    productName = nameCandidates[0];
                } else {
                    // Regex fallback for name in card
                    const nameMatch = text.match(/Product Detail\n([^\n]+)/) || text.match(/([A-Z][A-Z0-9\s-]{3,30})/);
                    if (nameMatch && !nameMatch[1].includes('@')) productName = nameMatch[1].trim();
                }

                // Extract Price - Target the final payable amount in footer
                const priceEl = el.closest('[class*="order"]')?.querySelector('.item-footer .total-price .amount-num, .price, .real-pay');
                let price = priceEl?.textContent?.trim() || '';
                if (!price) {
                   const priceMatch = text.match(/₹[\d,.]+/);
                   if (priceMatch) price = priceMatch[0];
                }

                // Extract Order ID (Aggressive strings)
                let orderId = '';
                const idMatch = text.match(/26\d{16,20}/) || text.match(/\d{18,22}/);
                if (idMatch) orderId = idMatch[0];

                // Extract Status
                const statusEl = el.querySelector('.status, .status-name, .state');
                const status = statusEl?.textContent?.trim() || 'Ordered';

                // Detail Button
                const detailBtn = el.closest('div')?.parentElement?.querySelector('.btn-detail, [aria-label*="Order detail"]');
                const detailLink = el.querySelector('a[href*="detail"]');

                items.push({
                    orderId: orderId || `PENDING_${index}`,
                    productName,
                    price: price.includes('₹') ? price : `₹${price}`,
                    status,
                    imageUrl: (el.querySelector('img') as HTMLImageElement)?.src || '',
                    orderUrl: detailLink?.getAttribute('href') || '',
                    needsClick: !detailLink && !!detailBtn,
                    itemIndex: index
                });
            });

            return items;
        });

        log.info(`[Orders] ✅ Found ${orders.length} Vivo items in list. Starting depth extraction...`);

        const finalOrders: any[] = [];

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            try {
                if (order.needsClick || order.orderUrl) {
                    if (order.orderUrl) {
                        const fullUrl = order.orderUrl.startsWith('http') ? order.orderUrl : `https://shop.vivo.com${order.orderUrl}`;
                        await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30000 });
                    } else {
                        log.info(`[Vivo] Clicking detail button for order ${order.orderId}`);
                        await page.click('.btn-detail, [aria-label*="Order detail"]', { timeout: 10000 });
                        await page.waitForTimeout(4000);
                    }
                    const details = await page.evaluate(async () => {
                        const res: any = {};
                        
                        // 1. Try NUXT extraction (Highest Fidelity)
                        try {
                            const nuxt: any = (window as any).__NUXT__;
                            if (nuxt && nuxt.data) {
                                // Nuxt data is often an array [userInfo, orderDetails]
                                const data = Array.isArray(nuxt.data) ? nuxt.data : [nuxt.data];
                                
                                // Look for order details in any array element
                                let nuxtData: any = null;
                                for (const d of data) {
                                    if (d.orderInfo) { nuxtData = d.orderInfo; break; }
                                    if (d.orderNo || d.orderId) { nuxtData = d; break; }
                                }

                                if (nuxtData) {
                                    const firstItem = (nuxtData.itemList && nuxtData.itemList[0]) || (nuxtData.skuList && nuxtData.skuList[0]) || nuxtData;
                                    res.orderId = nuxtData.orderNo || nuxtData.orderId;
                                    res.productName = firstItem.name || firstItem.skuName;
                                    if (res.productName && res.productName.includes('@')) {
                                        res.productName = firstItem.skuName || firstItem.goodsName;
                                    }
                                    
                                    res.status = nuxtData.orderStatus || nuxtData.statusName;
                                    res.price = nuxtData.moneyInfo?.payAmt || nuxtData.orderAmount;
                                    
                                    const delivery = nuxtData.deliveryInfo || nuxtData.billingInfo;
                                    if (delivery) {
                                        res.address = delivery.address || `${delivery.street || ''} ${delivery.city || ''} ${delivery.state || ''} ${delivery.pinCode || ''}`.trim();
                                        res.mobileLast4 = (delivery.receiverPhoneMasked || delivery.receiverPhone || '').slice(-4);
                                    }
                                }
                            }
                        } catch (e) {}

                        // 2. DOM Fallback (Only if NUXT failed or for confirmation)
                        const bodyText = (document.body as HTMLElement).innerText || '';

                        // Order ID
                        if (!res.orderId) {
                            const idMatch = bodyText.match(/26\d{16,20}/) || bodyText.match(/\d{18,22}/);
                            if (idMatch) res.orderId = idMatch[0];
                        }

                        // Product Name
                        if (!res.productName || res.productName.includes('@')) {
                            const nameEl = document.querySelector('.name-box .name, .name.thick-font, .goods-info .name, .product-name');
                            const domName = nameEl?.textContent?.trim();
                            if (domName && !domName.includes('@')) {
                                res.productName = domName;
                            } else {
                                // Regex fallback from body text
                                const detailMatch = bodyText.match(/Product Detail\s*\n\s*([^\n]+)/i);
                                if (detailMatch && !detailMatch[1].includes('@')) res.productName = detailMatch[1].trim();
                            }
                        }

                        // Price
                        if (!res.price) {
                            const priceEl = document.querySelector('.amount.thick-font .value, .pay-amount .value, .payable .value, .amount-num');
                            if (priceEl) res.price = priceEl.textContent?.trim();
                        }

                        // Address & Phone - FIND SMALLEST CONTAINER
                        if (!res.address || !res.mobileLast4) {
                            const allEls = Array.from(document.querySelectorAll('div, p, span, li')) as HTMLElement[];
                            
                            // Find elements containing both keywords and pick the one with most specific (shortest) text
                            const billingContainers = allEls.filter(e => 
                                e.textContent?.includes('Tel:') && 
                                e.textContent?.includes('Address:') &&
                                !e.textContent?.includes('@')
                            ).sort((a, b) => (a.innerText?.length || 0) - (b.innerText?.length || 0));
                            
                            const billingSection = billingContainers[0];
                            
                            if (billingSection) {
                                if (!res.address) res.address = billingSection.innerText.trim();
                                if (!res.mobileLast4) {
                                    const maskedMatch = billingSection.innerText.match(/\d+\*+(\d{4})/);
                                    if (maskedMatch) res.mobileLast4 = maskedMatch[1];
                                }
                            }
                        }

                        // Status
                        if (!res.status) {
                            const statusEl = document.querySelector('.current-state, .status-name, .step-item.active');
                            if (statusEl) res.status = statusEl.textContent?.trim();
                        }

                        return res;
                    });

                    // Open Logistics Modal if present
                    try {
                        const logisticsBtn = await page.$('.btn-logistics');
                        if (logisticsBtn) {
                            log.info(`[Vivo] Opening logistics modal for tracking...`);
                            await logisticsBtn.click();
                            await page.waitForTimeout(3000);
                            
                            const trackingData = await page.evaluate(() => {
                                const modal = document.querySelector('.el-dialog');
                                if (!modal) return null;
                                const text = (modal as HTMLElement).innerText;
                                
                                const waybillMatch = text.match(/(?:Waybill|AWB|Tracking|Number)[:\s]+([A-Z0-9]+)/i) || text.match(/(\d{10,15})/);
                                const carrierMatch = text.match(/(?:Logistics|Carrier|Company)[:\s]+([A-Za-z\s]+)/i);
                                
                                const knownCarriers = ['Delhivery', 'Ecom Express', 'XpressBees', 'Blue Dart', 'BlueDart', 'Ekart', 'Shadowfax'];
                                let carrier = carrierMatch ? carrierMatch[1].trim() : '';
                                if (!carrier) {
                                    carrier = knownCarriers.find(c => text.includes(c)) || '';
                                }

                                return {
                                    trackingId: waybillMatch ? waybillMatch[1] || waybillMatch[0] : '',
                                    carrier
                                };
                            });

                            if (trackingData) {
                                order.trackingId = trackingData.trackingId;
                                order.carrier = trackingData.carrier;
                                log.info(`[Vivo] Found tracking: ${order.trackingId} via ${order.carrier}`);
                            }
                            
                            // Close modal
                            await page.click('.el-dialog__close, .btn-close').catch(() => {});
                        }
                    } catch (e) {}

                    if (details.orderId) order.orderId = details.orderId;
                    if (details.status) order.status = details.status;
                    if (details.address) order.address = details.address;
                    if (details.mobileLast4) order.mobileLast4 = details.mobileLast4;
                    if (details.productName) order.productName = details.productName;
                    if (details.price) {
                        order.price = details.price.includes('₹') ? details.price : `₹${details.price}`;
                    }

                    await page.goto(ordersUrl, { waitUntil: 'networkidle' }).catch(() => {});
                    await page.waitForTimeout(2000);
                }

                if (order.orderId && !order.orderId.startsWith('PENDING_')) {
                    finalOrders.push(order);
                }
            } catch (e: any) {
                log.error(`[Vivo] Scraping failed for ${order.orderId}: ${e.message}`);
                if (order.orderId && !order.orderId.startsWith('PENDING_')) finalOrders.push(order);
                await page.goto(ordersUrl, { waitUntil: 'networkidle' }).catch(() => {});
            }
        }

        const validOrders = finalOrders;
        log.info(`[Vivo] Scraped ${validOrders.length} valid orders for ${accountId}`);

        if (validOrders.length > 0) {
            await upsertAccount({
                id: accountId,
                platform,
                orders: validOrders
            });

            const acc = await getAccount(accountId);
            const chatUserId = acc?.userId || accountId;
            updateOrdersInContext(chatUserId, accountId, platform, validOrders).catch(e => {
                log.warn(`[Orders] Chat update failed: ${e.message}`);
            });
        }
        orderCache.set(accountId, platform, validOrders);

        return validOrders;

    } catch (err: any) {
        log.error(`[Vivo] Fetch failed: ${err.message}`);
        throw err;
    } finally {
        await context.close().catch(() => { });
    }
}
