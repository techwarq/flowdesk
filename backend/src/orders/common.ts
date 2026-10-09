import path from 'path';
import fs from 'fs-extra';

/**
 * Helper for human-like pauses
 */
export const humanDelay = async (page: any, min = 1000, max = 3000) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await page.waitForTimeout(delay);
};

/**
 * Shared scraping logic for Gift Card balance
 */
export async function scrapeGVBalance(page: any): Promise<string> {
    // Wait for any likely content
    await page.waitForTimeout(3000);

    // DEBUG: Save HTML to file to inspect structure
    try {
        const content = await page.content();
        const debugPath = path.resolve(process.cwd(), 'gv_debug.html');
        await fs.writeFile(debugPath, content);
        console.log(`[GV DEBUG] Saved HTML to ${debugPath}`);
    } catch (err) {
        console.error('[GV DEBUG] Failed to save HTML:', err);
    }

    let gvBalance = '';

    // Targeted Selectors based on gv_debug.html analysis:

    // 1. Sidebar: "Gift Cards ... ₹50"
    // HTML: <div class="aHEnsO POpXL2">Gift Cards<span class="lOBLTK">₹50</span></div>
    const sidebarBalance = await page.$eval('.aHEnsO.POpXL2 .lOBLTK', (el: any) => el.innerText).catch(() => null);
    if (sidebarBalance) {
        gvBalance = sidebarBalance;
    }

    // 2. Main Card: "1 ACTIVE GIFT CARD ... ₹50"
    // HTML: <div class="JPsLgX">...<div class="fxwOp_">₹50</div></div>
    if (!gvBalance) {
        const mainCardBalance = await page.$eval('.JPsLgX .fxwOp_', (el: any) => el.innerText).catch(() => null);
        if (mainCardBalance) {
            gvBalance = mainCardBalance;
        }
    }

    // Fallback: Generic active card search (slightly refined)
    if (!gvBalance) {
        const activeCardBalance = await page.evaluate(() => {
            const allDivs = Array.from(document.querySelectorAll('div'));
            // Look for "ACTIVE GIFT CARD" text specifically in the card header format
            const activeHeader = allDivs.find(d => d.innerText && d.innerText.includes('ACTIVE GIFT CARD'));

            if (activeHeader) {
                // The price class in the dump is 'fxwOp_' which is a sibling of the cloud icon inside 'JPsLgX'
                // Let's traverse up to the common container 'JPsLgX' or 'DDZB8E's parent
                const container = activeHeader.closest('.JPsLgX') || activeHeader.parentElement?.parentElement;
                if (container) {
                    // Try to find the price div which often has a currency symbol
                    const priceDiv = Array.from(container.querySelectorAll('div')).find(el => (el as HTMLElement).innerText.match(/^₹[\d,]+$/));
                    if (priceDiv) return (priceDiv as HTMLElement).innerText;
                }
            }
            return null;
        });

        if (activeCardBalance) {
            gvBalance = activeCardBalance;
        }
    }

    // Final clean up
    if (gvBalance) {
        gvBalance = gvBalance.trim();
        // Ensure it starts with ₹ if it's just a number (though likely it has it)
        if (!gvBalance.startsWith('₹') && /^\d/.test(gvBalance)) {
            gvBalance = '₹' + gvBalance;
        }
    }

    return gvBalance;
}

/**
 * Helper to scrape details from the current page (Details View)
 */
export async function scrapeDetails(page: any, order: any, log?: any) {
    // Wait for the page to contain the Order ID to ensure AJAX content is loaded
    try {
        await page.waitForFunction((id: string) => document.body.innerText.includes(id), { timeout: 10000 }, order.orderId);
    } catch (e) {
        if (log) log.warn(`[Orders] Timeout waiting for Order ID ${order.orderId} in page content`);
    }
    
    // Initial wait for page settle
    await humanDelay(page, 1000, 2000);
    const details = await page.evaluate(() => {
        const result: any = { htmlDump: document.documentElement.outerHTML };

        // 1. Order ID
        const idLabel = Array.from(document.querySelectorAll('div, span, p')).find(el => 
            el.textContent?.trim() === 'Order Id' || 
            el.textContent?.trim() === 'Order ID' ||
            el.textContent?.trim().startsWith('Order ID:')
        );
        if (idLabel) {
            const val = idLabel.nextElementSibling?.textContent?.trim() || 
                        idLabel.parentElement?.textContent?.replace(/Order I[Dd][: ]*/, '').trim();
            if (val) result.orderId = val;
        }

        // 2. OTP - Aggressive Search
        const bodyText = document.body.innerText;
        let foundOtp = null;
        const otpMatch = bodyText.match(/OTP\s*[:\-]?\s*(\d{4,6})/i);
        if (otpMatch) {
            foundOtp = otpMatch[1];
        } else {
            const allElements = Array.from(document.querySelectorAll('div, span, p, b, strong'));
            for (const el of allElements) {
                const content = el.textContent?.trim() || '';
                if (/(OTP|Delivery Code|Verification Code)/i.test(content)) {
                    const m = content.match(/(\d{4,6})/);
                    if (m) { foundOtp = m[1]; break; }
                    const nextM = el.nextElementSibling?.textContent?.match(/(\d{4,6})/);
                    if (nextM) { foundOtp = nextM[1]; break; }
                    const parentM = el.parentElement?.textContent?.match(/OTP\s*[:\-]?\s*(\d{4,6})/i);
                    if (parentM) { foundOtp = parentM[1]; break; }
                }
            }
        }
        result.otp = foundOtp;

        // 3. Status & Delivery Date
        const statusEl = document.querySelector('._2U7eD9, ._2sKzGF, ._30jeq3, [class*="status"]');
        if (statusEl) {
            const statusTxt = (statusEl as HTMLElement).innerText;
            result.status = statusTxt.trim();
            const dateMatch = statusTxt.match(/(?:on|by|at|Arriving|Expected|Today)\s+([A-Za-z0-9, ]+)/i);
            if (dateMatch) result.deliveryDate = dateMatch[0].trim();
        }

        // 4. Receiver Name & Address
        const deliveryHeader = Array.from(document.querySelectorAll('div, span, h3')).find(el => 
            el.textContent?.trim().toLowerCase() === 'delivery details' || 
            el.textContent?.trim().toLowerCase() === 'delivery address'
        );
        if (deliveryHeader) {
            const container = deliveryHeader.closest('div[class*="row"]')?.parentElement || deliveryHeader.parentElement?.parentElement;
            if (container) {
                const fullAddress = (container as HTMLElement).innerText.replace('Delivery Address', '').replace('Delivery Details', '').trim();
                const texts = fullAddress.split('\n').filter(l => l.trim());
                result.address = fullAddress.replace(/\n+/g, ', ');

                if (texts.length > 0) {
                    const nameLine = texts[0];
                    const phoneMatch = fullAddress.match(/\b\d{10}\b/);
                    if (phoneMatch) {
                        result.mobileLast4 = phoneMatch[0].slice(-4);
                        if (!result.receiverName) result.receiverName = nameLine.replace(phoneMatch[0], '').trim();
                    } else {
                        if (!result.receiverName) result.receiverName = nameLine;
                    }
                }
            }
        }

        // 5. Tracking ID & Carrier
        const flipMatch = bodyText.match(/(FMPC|FMPP)[a-zA-Z0-9]+/);
        result.trackingId = flipMatch ? flipMatch[0] : (bodyText.match(/(?:ID|AWB|Waybill|Tracking)[: ]*\s*([A-Z0-9\-]{8,})/i)?.[1] || null);

        const carriers = ['Delhivery', 'Ecom Express', 'XpressBees', 'BlueDart', 'Ekart', 'Amazon Shipping', 'Shadowfax'];
        let foundCarrier = null;
        for (const c of carriers) {
            if (bodyText.includes(c)) { foundCarrier = c; break; }
        }
        if (!foundCarrier) {
            const cMatch = bodyText.match(/(?:Shipped via|Courier|Delivery by)[: ]*\s*([A-Za-z0-9 ]+)/i);
            if (cMatch && cMatch[1].length < 30) foundCarrier = cMatch[1].trim();
        }
        result.carrier = foundCarrier;
        result.deliveryDetails = bodyText;

        return result;
    });

    // 6. DEBUG: SAVE HTML DUMP
    if (details.htmlDump) {
        try {
            const logDir = path.join(process.cwd(), 'data', 'logs');
            await fs.ensureDir(logDir);
            const debugFile = path.join(logDir, `order_debug_${order.orderId || Date.now()}.html`);
            await fs.writeFile(debugFile, details.htmlDump);
            if (log) log.info(`[Orders DEBUG] Tracking debug HTML saved to: ${debugFile}`);
        } catch (err) {
            if (log) log.warn(`[Orders] Failed to save debug HTML: ${err}`);
        }
    }

    // 7. CLICK "See All Updates" for detailed timeline and hidden tracking ID
    try {
        const seeUpdatesBtn = await page.$('div:has-text("See All Updates"), span:has-text("See All Updates"), a:has-text("See All Updates")');
        if (seeUpdatesBtn) {
            if (log) log.info(`[Orders] Clicking 'See All Updates' for tracking ID...`);
            await seeUpdatesBtn.click();
            await page.waitForTimeout(2000); // 2s wait for modal

            const modalScrape = await page.evaluate(() => {
                const modals = Array.from(document.querySelectorAll('div[role="dialog"], ._3MAXQU, ._10YZ-w'));
                const modal = modals.find(m => (m as HTMLElement).innerText.includes('Order') || (m as HTMLElement).innerText.includes('Shipped'));

                if (modal) {
                    const mText = (modal as HTMLElement).innerText;
                    
                    // Re-run tracking ID extraction on modal text
                    const flipMatch = mText.match(/(FMPC|FMPP)[a-zA-Z0-9]+/);
                    const genMatch = mText.match(/(?:ID|AWB|Waybill|Tracking)[: ]*\s*([A-Z0-9\-]{8,})/i);
                    const trackingId = flipMatch ? flipMatch[0] : (genMatch ? genMatch[1] : null);

                    const lines = mText.split('\n').filter((line: string) =>
                        line.trim().length > 0 && !line.includes('See All Updates') && !line.includes('Cancel')
                    );
                    
                    return { trackingId, timeline: lines.slice(0, 10).join(' | ') };
                }
                return null;
            });

            if (modalScrape) {
                if (modalScrape.trackingId) order.trackingId = modalScrape.trackingId;
                if (modalScrape.timeline) {
                    details.deliveryDetails += ` [Updates: ${modalScrape.timeline}]`;
                }
            }
        }
    } catch (e: any) {
        if (log) log.warn(`[Orders] Failed to click 'See All Updates': ${e.message}`);
    }

    if (details.orderId) order.orderId = details.orderId;
    if (details.otp) order.otp = details.otp;
    if (details.receiverName) order.receiverName = details.receiverName;
    if (details.trackingId && !order.trackingId) order.trackingId = details.trackingId;
    if (details.carrier) order.carrier = details.carrier;
    if (details.deliveryDetails) order.deliveryDetails = details.deliveryDetails;
    if (details.address) order.address = details.address;
    if (details.mobileLast4) order.mobileLast4 = details.mobileLast4;
    if (details.orderDate) order.orderDate = details.orderDate;
    if (details.deliveryDate) order.deliveryDate = details.deliveryDate;
    if (details.realtimeStatus) order.realtimeStatus = details.realtimeStatus;
}
