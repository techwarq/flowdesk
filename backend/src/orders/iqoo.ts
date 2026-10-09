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
import { getChromiumPath } from '../utils/browserPath.js';

export async function fetchIqooOrders(accountId: string, existingContext?: BrowserContext) {
    const log = getAccountLogger(accountId);
    const platform = 'iqoo';
    const fingerprint = generateFingerprint(platform, accountId);

    const cookies = await getUnifiedCookies(accountId, platform);
    const ls = await loadLocalStorage(accountId, platform);

    if (cookies.length === 0) {
        throw new Error('No saved cookies found. Please log in first.');
    }

    log.info(`[Orders] 🚀 Starting iQOO order fetch for ${accountId}`);
    log.info(`[Orders] Loaded ${cookies.length} cookies and ${ls ? Object.keys(ls).length : 0} localStorage items`);

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
                viewport: fingerprint.viewport
            });
        }

        if (ls) {
            log.info(`[Orders] Injecting ${Object.keys(ls).length} localStorage items`);
            await context.addInitScript((data) => {
                for (const [key, value] of Object.entries(data)) {
                    window.localStorage.setItem(key, value as string);
                }
            }, ls);
        }

        log.info(`[Orders] Injecting ${cookies.length} cookies`);
        await context.addCookies(cookies);

        const page = await context.newPage();

        const ordersUrl = 'https://shop.iqoo.com/in/person/order/list';
        log.info(`[Orders] Navigating to iQOO Order List: ${ordersUrl}`);
        await page.goto(ordersUrl, { waitUntil: 'networkidle', timeout: 30000 });

        await page.waitForTimeout(3000);

        const currentUrl = page.url();
        log.info(`[Orders] Current URL after navigation: ${currentUrl}`);

        if (currentUrl.includes('login') || currentUrl.includes('signin')) {
            log.error(`[Orders] ❌ iQOO session expired - redirected to login`);
            throw new Error('iQOO session expired. Please login again.');
        }

        log.info('[Orders] Waiting for order list elements...');
        try {
            await page.waitForSelector('.order-list-item, .no-order, .order-item, .empty-order', { timeout: 15000 });
            log.info('[Orders] ✅ Order list elements found');
        } catch (e) {
            log.warn('[Orders] ⚠️ Timeout waiting for iQOO order list. Dumping debug file...');
        }

        const debugPath = path.join(process.cwd(), `iqoo_dom_dump_${accountId.replace(/[^a-zA-Z0-9]/g, '_')}.html`);
        const htmlContent = await page.content();
        await fs.writeFile(debugPath, htmlContent, 'utf-8');
        log.info(`[Orders] 📸 DUMPED FULL DOM to ${debugPath} - Check this file to see iQOO class names!`);

        const orders = await page.evaluate(() => {
            interface IqooOrder {
                orderId: string;
                productName: string;
                status: string;
                imageUrl: string;
                price: string;
                orderUrl: string;
                deliveryDate: string;
                needsDetailClick: boolean;
                itemIndex: number;
                mobileLast4?: string;
                address?: string;
                otp?: string;
                trackingId?: string;
                carrier?: string;
            }

            const items: IqooOrder[] = [];

            // 1. Try extracting from NUXT state (most reliable)
            try {
                const nuxt: any = (window as any).__NUXT__;
                if (nuxt && nuxt.data && nuxt.data[0] && nuxt.data[0].userInfo && nuxt.data[0].userInfo.recentOrderList) {
                    const nuxtOrders = nuxt.data[0].userInfo.recentOrderList;
                    nuxtOrders.forEach((o: any, index: number) => {
                        const firstItem = (o.itemList && o.itemList[0]) || {};
                        items.push({
                            orderId: o.orderNo || `PENDING_${index}`,
                            productName: firstItem.name || 'iQOO Product',
                            status: o.orderStatus || 'Ordered',
                            imageUrl: firstItem.picUrl || '',
                            price: o.moneyInfo?.payAmt ? `₹${o.moneyInfo.payAmt}` : '',
                            orderUrl: '',
                            deliveryDate: o.createTime || '',
                            needsDetailClick: true,
                            itemIndex: index
                        });
                    });
                    if (items.length > 0) return items;
                }
            } catch (e) {
                console.error('Failed to parse NUXT state', e);
            }

            // 2. Fallback to DOM scraping
            const orderElements = Array.from(document.querySelectorAll('.order-item'));
            orderElements.forEach((el, index) => {
                const idSelectors = ['.order-number span:last-child', '.order-id', '[class*="order-number"]', '[class*="order-sn"]'];
                let orderId = '';
                for (const sel of idSelectors) {
                    const idEl = el.querySelector(sel);
                    if (idEl?.textContent?.trim()) {
                        orderId = idEl.textContent.trim();
                        break;
                    }
                }

                const statusSelectors = ['.status-name .name', '.order-status', '[class*="status"]', '.state'];
                let status = 'Ordered';
                for (const sel of statusSelectors) {
                    const statusEl = el.querySelector(sel);
                    if (statusEl?.textContent?.trim()) {
                        status = statusEl.textContent.trim();
                        break;
                    }
                }

                const nameSelectors = ['.name.thick-font.line-clamp-1', '.sku-name', '.product-name', '[class*="goods-name"]', '.item-name'];
                let productName = 'iQOO Product';
                for (const sel of nameSelectors) {
                    const nameEl = el.querySelector(sel);
                    if (nameEl?.textContent?.trim()) {
                        productName = nameEl.textContent.trim();
                        break;
                    }
                }

                const imgSelectors = ['.goods-img', '.sku-img img', '.product-img img', 'img[src*="iqoo"]', 'img'];
                let imageUrl = '';
                for (const sel of imgSelectors) {
                    const imgEl = el.querySelector(sel);
                    if (imgEl?.getAttribute('src')) {
                        imageUrl = imgEl.getAttribute('src') || '';
                        if (imageUrl.startsWith('data:image')) {
                             imageUrl = imgEl.getAttribute('data-src') || imageUrl;
                        }
                        break;
                    }
                }

                const priceSelectors = ['.price.red-price', '.real-pay', '.total-price', '[class*="price"]', '.amount'];
                let price = '';
                for (const sel of priceSelectors) {
                    const priceEl = el.querySelector(sel);
                    if (priceEl?.textContent?.trim()) {
                        price = priceEl.textContent.replace(/[^\d.,₹]/g, '').trim();
                        break;
                    }
                }

                const detailLink = el.querySelector('a[href*="/order/detail"], a[href*="orderId"]');
                const orderUrl = detailLink ? window.location.origin + detailLink.getAttribute('href') : '';
                const detailButton = el.querySelector('.btn-detail');

                items.push({
                    orderId: orderId || `PENDING_${index}`,
                    productName,
                    status,
                    imageUrl,
                    price: price ? (price.includes('₹') ? price : `₹${price}`) : '',
                    orderUrl,
                    deliveryDate: '',
                    needsDetailClick: !orderUrl && !!detailButton,
                    itemIndex: index
                });
            });

            return items;
        });

        log.info(`[Orders] ✅ Found ${orders.length} iQOO items in list. Starting depth extraction...`);

        const finalOrders: any[] = [];

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            try {
                if (order.needsDetailClick) {
                    log.info(`[Orders] Clicking detail button for order at index ${order.itemIndex}`);
                    await page.click(`.order-item:nth-child(${order.itemIndex + 1}) .btn-detail`, { timeout: 10000 });
                    await page.waitForTimeout(4000);
                } else if (order.orderUrl) {
                    log.info(`[Orders] Navigating to detail URL for order ${order.orderId}`);
                    await page.goto(order.orderUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                    await page.waitForTimeout(2000);
                } else if (!order.orderId.startsWith('PENDING_')) {
                    // Already have everything we need? (Nuxt case but might still want deep data)
                    // Continue to deep scrape for address/OTP
                } else {
                    continue;
                }

                const details = await page.evaluate(() => {
                    const res: any = {};
                    const bodyText = document.body.innerText;
                    
                    // Extract Order ID from detail page
                    const idMatch = bodyText.match(/Order No[:.\s]+(\d+)/i) || 
                                  bodyText.match(/Order Number[:.\s]+(\d+)/i) ||
                                  bodyText.match(/Order ID[:.\s]+(\d+)/i) ||
                                  bodyText.match(/ID[:.\s]*(\d{10,})/i) ||
                                  bodyText.match(/IN\d+/i);
                                  
                    if (idMatch) res.orderId = idMatch[1] || idMatch[0];

                    const addrSelectors = ['.address-info', '.delivery-address', '[class*="address"]', '.personal-info'];
                    for (const sel of addrSelectors) {
                        const addrEl = document.querySelector(sel);
                        if (addrEl) {
                            const fullText = addrEl.textContent?.trim() || '';
                            const innerText = (addrEl as HTMLElement).innerText || fullText;
                            
                            // 1. Better Phone Extraction
                            // Look for labels first
                            const phoneMatch = innerText.match(/(?:Tel|Mobile|Phone|Contact)[:\s]*([\d\s*xX-]{8,})/i);
                            if (phoneMatch) {
                                const digits = phoneMatch[1].replace(/[^\d]/g, '');
                                if (digits.length >= 4) {
                                    res.mobileLast4 = digits.slice(-4);
                                }
                            }
                            
                            if (!res.mobileLast4) {
                                // Fallback: find all digit sequences, but avoid 6-digit sequences if a shorter/longer one exists near "Tel"
                                const matches = fullText.match(/\d{4,}/g) || [];
                                // If we have multiple matches, the phone number is usually NOT the 6-digit one if it's near the start/middle
                                // In the observed case, Pincode 110083 is at the end of the address block, and Tel is above it.
                                // Let's try to find the one that looks most like a phone number (10 digits or masked 10)
                                const phoneCandidate = matches.find(m => m.length === 10) || 
                                                       matches.find(m => m.length === 4 && (fullText.includes(m) && !fullText.includes('1100' + m))) ||
                                                       matches[0]; // Default to first if we can't decide
                                
                                if (phoneCandidate) res.mobileLast4 = phoneCandidate.slice(-4);
                            }

                            // 2. Full Address Extraction
                            // Instead of a specific sub-selector, let's take the longest block or the one containing 'Delhi' or pincodes
                            const addressEl = addrEl.querySelector('.address-detail, [class*="detail"], .info-content, .address-text');
                            if (addressEl) {
                                res.address = addressEl.textContent?.trim();
                            } else {
                                // Fallback to whole block but try to remove name if it's separate
                                res.address = innerText.replace(/Name:.*|Tel:.*|Order ID:.*|Order Time:.*/gi, '').trim();
                            }
                            break;
                        }
                    }

                    const stepSelectors = ['.step-item.active .step-title', '.current-step', '[class*="status-active"]', '.status-name'];
                    for (const sel of stepSelectors) {
                        const stepEl = document.querySelector(sel);
                        if (stepEl?.textContent?.trim()) {
                            res.status = stepEl.textContent.trim();
                            break;
                        }
                    }

                    const dateSelectors = ['.create-time', '.order-time', '[class*="time"]'];
                    for (const sel of dateSelectors) {
                        const dateEl = document.querySelector(sel);
                        if (dateEl?.textContent?.trim()) {
                            res.deliveryDate = dateEl.textContent.replace(/Order Time:|Created:|Date:/gi, '').trim();
                            break;
                        }
                    }

                    const otpMatch = bodyText.match(/OTP\s*[:\-]?\s*(\d{4,6})/i);
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

                if (details.orderId) order.orderId = details.orderId;
                if (details.mobileLast4) order.mobileLast4 = details.mobileLast4;
                if (details.address) order.address = details.address;
                if (details.status) order.status = details.status;
                if (details.deliveryDate) order.deliveryDate = details.deliveryDate;
                if (details.otp) order.otp = details.otp;
                if (details.trackingId) order.trackingId = details.trackingId;
                if (details.carrier) order.carrier = details.carrier;

                if (order.otp && order.status) {
                    const isInTransit = /transit|way|out for delivery|shipped|arriving|dispatched/i.test(order.status);
                    if (isInTransit) {
                        const { logActivity } = await import('../cloud_provider.js');
                        log.info(`[Orders] 🔔 OTP ALERT for iQOO ${order.orderId}: ${order.otp}`);
                        await logActivity('System', 'OTP_ALERT', {
                            platform,
                            accountId,
                            orderId: order.orderId,
                            otp: order.otp,
                            productName: order.productName,
                            status: order.status
                        });
                    }
                }

                // Push to final set even if incomplete
                finalOrders.push({
                    orderId: order.orderId,
                    productName: order.productName,
                    status: order.status,
                    imageUrl: order.imageUrl,
                    price: order.price,
                    orderUrl: order.orderUrl,
                    deliveryDate: order.deliveryDate,
                    mobileLast4: order.mobileLast4,
                    address: order.address,
                    otp: order.otp,
                    trackingId: order.trackingId,
                    carrier: order.carrier
                });

                // Go back to order list
                log.info(`[Orders] Returning to list...`);
                await page.goto(ordersUrl, { waitUntil: 'networkidle' });
                await page.waitForTimeout(3000);
            } catch (e: any) {
                log.error(`[Orders] Failed to get details for order at index ${order.itemIndex}: ${e.message}`);
                // Still add to final if it has basic info from Nuxt
                if (order.orderId && !order.orderId.startsWith('PENDING_')) {
                    finalOrders.push({
                        orderId: order.orderId,
                        productName: order.productName,
                        status: order.status,
                        imageUrl: order.imageUrl,
                        price: order.price,
                        orderUrl: order.orderUrl || '',
                        deliveryDate: order.deliveryDate || ''
                    });
                }
                await page.goto(ordersUrl, { waitUntil: 'networkidle' }).catch(() => {});
            }
        }

        const validOrders = finalOrders.filter(o => o.orderId && !o.orderId.startsWith('PENDING_'));
        log.info(`[Orders] ✅ Scraped ${validOrders.length} valid orders for ${accountId}`);

        orderCache.set(accountId, platform, validOrders);

        const acc = (await loadAccounts()).accounts.find(a => a.id === accountId);
        const chatUserId = acc?.userId || accountId;
        updateOrdersInContext(chatUserId, accountId, platform, validOrders).catch(e => {
            log.warn(`[Orders] Failed to update chat context: ${e.message}`);
        });

        await upsertAccount({
            id: accountId,
            platform,
            orders: validOrders
        });

        return { success: true, count: validOrders.length, orders: validOrders, lastUrl: page.url() };

    } catch (e: any) {
        log.error(`[Orders] ❌ iQOO fetch failed: ${e.message}`);
        throw e;
    } finally {
        if (browser) await browser.close();
        else if (context && !existingContext) await context.close();
    }
}
