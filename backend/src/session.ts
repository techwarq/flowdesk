import { chromium, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs-extra';
import { PROFILES_DIR } from './config.js';
import { generateFingerprint } from './fingerprint.js';
import { saveFingerprint } from './fingerprintDb.js';
import logger, { getAccountLogger } from './log.js';
import { loadCookiesFromDB, extractAndSaveCookies, adaptCookiesForShopsy, sanitizeCookies } from './cookies.js';
import { browsers } from './browserManager.js';
import { pushCookies, fetchCookiesFromCloud, fetchLocalStorage, pushLocalStorage, getSupabase } from './cloud_provider.js';
import { loadLocalStorage, saveLocalStorage } from './localStorage.js';
import { upsertAccount } from './accounts.js';
import { getProxyForAccount } from './proxy.js';
import { injectOverlay } from './overlay.js';

export interface SessionOptions {
    accountId: string;
    platform: string;
    skipProxy?: boolean;
}

/**
 * Opens a browser session with pre-injected cookies for viewing logged-in state.
 * For Shopsy, uses Flipkart cookies adapted to shopsy.in domain.
 */
export async function openSession(options: SessionOptions) {
    const { accountId, platform, skipProxy } = options;
    const log = getAccountLogger(accountId);

    const startUrlMap: Record<string, string> = {
        flipkart: 'https://www.flipkart.com',
        shopsy: 'https://www.shopsy.in',
        iqoo: 'https://www.iqoo.com/in',
        vivo: 'https://www.vivo.com/in',
        oppo: 'https://www.oppo.com/in',
        realme: 'https://www.realme.com/in',
        xiaomi: 'https://www.mi.com/in',
        redmi: 'https://www.mi.com/in',
        samsung: 'https://www.samsung.com/in',
        oneplus: 'https://www.oneplus.in',
        vijaysales: 'https://www.vijaysales.com',
        reliancedigital: 'https://www.reliancedigital.in',
        amazon: 'https://www.amazon.in'
    };
    const startUrl = startUrlMap[platform] || 'https://www.flipkart.com';
    const platformDomains: Record<string, string[]> = {
        flipkart: ['flipkart.com'],
        shopsy: ['shopsy.in'],
        iqoo: ['iqoo.com'],
        vivo: ['vivo.com'],
        oppo: ['oppo.com'],
        realme: ['realme.com'],
        xiaomi: ['mi.com', 'xiaomi.com'],
        redmi: ['mi.com', 'xiaomi.com'],
        samsung: ['samsung.com'],
        oneplus: ['oneplus.in', 'oneplus.com'],
        vijaysales: ['vijaysales.com'],
        reliancedigital: ['reliancedigital.in'],
        amazon: ['amazon.in']
    };
    const allowedDomains = platformDomains[platform] || [new URL(startUrl).hostname];
    const skipCookieReplay = platform === 'amazon';
    const skipStorageReplay = platform === 'amazon';

    // Normalize to lowercase for consistent profile paths (macOS is case-insensitive)
    const normalizedId = accountId.toLowerCase().trim();
    const profilePath = path.join(PROFILES_DIR, platform, normalizedId, 'userDataDir');
    const fingerprint = generateFingerprint(platform, accountId);

    // Save fingerprint to DB for in-app browser to use later
    try {
        await saveFingerprint(accountId, {
            userAgent: fingerprint.userAgent,
            viewportWidth: fingerprint.viewport?.width || 1920,
            viewportHeight: fingerprint.viewport?.height || 1080,
            locale: fingerprint.locale,
            timezoneId: fingerprint.timezoneId
        });
        log.info(`[Session] Fingerprint saved to DB for ${accountId}`);
    } catch (fpErr: any) {
        log.warn(`[Session] Failed to save fingerprint: ${fpErr.message}`);
    }

    const lockFile = path.join(profilePath, 'SingletonLock');

    console.log(`[Session] Opening ${platform} for ${accountId}`);
    console.log(`[Session] Profile path: ${profilePath}`);
    console.log(`[Session] Active browsers: ${browsers.isActive(accountId) ? 'Yes' : 'No'}`);

    log.info(`Opening ${platform} session for ${accountId}`);

    // Proactive unlock
    try {
        if (await fs.pathExists(lockFile)) {
            console.log(`[Session] Removing stale lock file: ${lockFile}`);
            await fs.remove(lockFile);
        }
    } catch (err) {
        console.log(`[Session] Could not remove lock file:`, err);
    }

    // FORCE FRESH PROFILE for debugging:
    // This ensures we are testing the JSON cookies purely, without interference from stale browser cache.
    // if (await fs.pathExists(profilePath)) {
    //    await fs.emptyDir(profilePath);
    //    log.info('[DEBUG-ANTIGRAVITY] cleared profile directory for fresh cookie test.');
    // }

    let context: BrowserContext;

    // PROXY DISABLED BY DEFAULT - only enabled during IP rotation
    // Proxy was causing slow page loads. Now we skip proxy unless explicitly requested.
    let proxyConfig: any = undefined;
    // skipProxy defaults to true (no proxy). Only use proxy if skipProxy is explicitly false.
    if (skipProxy === false) {
        proxyConfig = await getProxyForAccount(accountId);
        if (proxyConfig) {
            log.info(`Using proxy for session ${accountId}: ${proxyConfig.server}`);
            console.log(`[Session] Using proxy: ${proxyConfig.server}`);
        }
    } else {
        log.info(`[Session] DIRECT connection for ${accountId} (no proxy - faster)`);
    }

    try {
        log.info(`[DEBUG-ANTIGRAVITY] Launching with UA: ${fingerprint.userAgent}`);

        // For BOTH Flipkart and Shopsy, use null viewport + fixed window size for consistent Desktop experience.
        const viewport = null;

        context = await chromium.launchPersistentContext(profilePath, {
            headless: false,
            viewport: viewport,
            userAgent: fingerprint.userAgent, // Ensure this is a Desktop UA from fingerprint.ts
            locale: fingerprint.locale,
            timezoneId: fingerprint.timezoneId,
            proxy: proxyConfig, // Inject Proxy
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                // Fixed window size for all platforms
                '--window-size=1280,720',
                '--window-position=50,50'
            ]
        });
    } catch (e: any) {
        const errorMsg = String(e.message || e);
        if (errorMsg.includes('ProcessSingleton') || errorMsg.includes('SingletonLock')) {
            try {
                if (await fs.pathExists(lockFile)) {
                    await fs.remove(lockFile);
                }
            } catch (err) { }

            const viewport = null;

            context = await chromium.launchPersistentContext(profilePath, {
                headless: false,
                viewport: viewport,
                userAgent: fingerprint.userAgent,
                locale: fingerprint.locale,
                timezoneId: fingerprint.timezoneId,
                proxy: proxyConfig, // Inject Proxy
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--window-size=1280,720',
                    '--window-position=50,50'
                ]
            });
        } else {
            throw e;
        }
    }

    browsers.register(`${accountId}-${platform}-session`, context);

    // Load and inject cookies - try cloud DB first, then local disk
    try {
        let cookies: any[] = [];

        if (platform === 'shopsy') {
            // For Shopsy: First try cloud DB
            cookies = await fetchCookiesFromCloud(accountId, 'shopsy');

            if (cookies.length === 0) {
                // Try local disk
                cookies = await loadCookiesFromDB(accountId, 'shopsy');
            }

            if (cookies.length === 0) {
                // Fallback: Try adapting Flipkart cookies from cloud
                const flipkartCookies = await fetchCookiesFromCloud(accountId, 'flipkart');
                if (flipkartCookies.length > 0) {
                    cookies = adaptCookiesForShopsy(flipkartCookies);
                    log.info(`Adapted ${cookies.length} Flipkart cookies from cloud for Shopsy`);
                } else {
                    // Final fallback: local Flipkart cookies
                    const localFlipkart = await loadCookiesFromDB(accountId, 'flipkart');
                    if (localFlipkart.length > 0) {
                        cookies = adaptCookiesForShopsy(localFlipkart);
                        log.info(`Adapted ${cookies.length} local Flipkart cookies for Shopsy`);
                    }
                }
            } else {
                log.info(`Found ${cookies.length} Shopsy cookies`);
            }
        } else {
            // For Flipkart, iQOO, Vivo, Redmi: Try cloud DB first
            if (getSupabase()) {
                cookies = await fetchCookiesFromCloud(accountId, platform);
            }

            if (cookies.length === 0) {
                // Fallback to local disk
                cookies = await loadCookiesFromDB(accountId, platform);
                log.info(`Loaded ${cookies.length} ${platform} cookies from local disk (backend/data)`);
            } else {
                log.info(`Loaded ${cookies.length} ${platform} cookies from cloud DB`);
            }
        }

        if (cookies.length > 0 && !skipCookieReplay) {
            // Sanitize cookies for safe injection and forced persistence
            const cleanCookies = sanitizeCookies(cookies, platform);

            // Critical Debug: Log auth cookies specifically
            const authCookies = cleanCookies.filter(c => ['at', 'S', 'SN', 'serviceToken', 'userId', 'xm_user_id', 'c_userId', 'passToken'].includes(c.name));
            log.info(`DEBUG AUTH COOKIES (Fixed): ${JSON.stringify(authCookies)}`);

            // Log summary of all cookies
            const summary = cleanCookies.map(c => `${c.name} (exp: ${c.expires}, sec: ${c.secure}, ss: ${c.sameSite}, dom: ${c.domain})`).join(', ');
            log.info(`DEBUG ALL COOKIES: ${summary}`);

            // XIAOMI DIAGNOSTIC: Log unique cookie domains
            if (platform === 'xiaomi') {
                const domains = cleanCookies.map(c => c.domain).filter((v, i, a) => a.indexOf(v) === i);
                log.info(`[XIAOMI DEBUG] Unique Cookie Domains: ${domains.join(', ')}`);
                log.info(`[XIAOMI DEBUG] Total cookies: ${cleanCookies.length}, Domains: ${domains.length}`);
            }


            await context.addCookies(cleanCookies);
            log.info(`Injected ${cleanCookies.length} sanitized cookies`);

            console.log(`[DEBUG-ANTIGRAVITY] session.ts: Injected ${cleanCookies.length} cookies.`);
            const ctxCookies = await context.cookies();
            console.log(`[DEBUG-ANTIGRAVITY] session.ts: Verification in context: ${ctxCookies.length} cookies found.`);
            console.log(`[DEBUG-ANTIGRAVITY] session.ts: Context Cookie Names: ${ctxCookies.map(c => c.name).join(', ')}`);
        } else if (skipCookieReplay) {
            log.info(`[Session] Skipping cookie replay for ${platform}; relying on persistent profile.`);
        } else {
            log.warn('No saved cookies found. Session may not be logged in.');
            console.log('[DEBUG-ANTIGRAVITY] session.ts: No saved cookies found to inject.');
        }
    } catch (e: any) {
        log.warn(`Failed to load/inject cookies: ${e.message}`);
    }

    // INJECT LOCAL STORAGE (New)
    try {
        let lsData = null;
        if (getSupabase()) {
            lsData = await fetchLocalStorage(accountId, platform);
        }

        if (!lsData) {
            lsData = await loadLocalStorage(accountId, platform);
        }

        // Shopsy Fallback: if no Shopsy LS, try Flipkart LS
        if (!lsData && platform === 'shopsy') {
            log.info(`No Shopsy Local Storage found for ${accountId}, attempting Flipkart LS fallback...`);
            if (getSupabase()) {
                lsData = await fetchLocalStorage(accountId, 'flipkart');
            }
            if (!lsData) {
                lsData = await loadLocalStorage(accountId, 'flipkart');
            }
            if (lsData) log.info('Using Flipkart Local Storage for Shopsy session.');
        }

        if (lsData && !skipStorageReplay) {
            log.info(`Injecting Local Storage data for ${accountId}...`);
            await context.addInitScript(({ data, domains, isRealme }) => {
                const hostname = window.location.hostname;
                console.log(`[ANTIGRAVITY-BROWSER] InitScript running on: ${hostname} (href: ${window.location.href})`);

                const isAllowed = domains.some((d: string) => hostname === d || hostname.endsWith(`.${d}`));

                // Specific realme logic:
                // Realme heavily relies on LS in multiple subdomains (buy.realme.com, store.realme.com)
                // to instantly show "logged in" state before API calls finish.
                if (isAllowed || (isRealme && (hostname.includes('buy.realme.com') || hostname.includes('store.realme.com') || hostname === 'www.realme.com'))) {
                    console.log(`[ANTIGRAVITY-BROWSER] Creating localStorage entries: ${Object.keys(data).length}`);
                    for (const [key, value] of Object.entries(data)) {
                        // Skip explicit logged-out state to allow cookies to rebuild it
                        if (key === 'isLoggedIn' && value === 'false') {
                            console.log('[ANTIGRAVITY-BROWSER] Skipping isLoggedIn: false from LS injection');
                            continue;
                        }
                        window.localStorage.setItem(key, value as string);
                    }
                } else {
                    console.log('[ANTIGRAVITY-BROWSER] Hostname not in allowlist. Skipping LS injection.');
                }
            }, { data: lsData, domains: allowedDomains, isRealme: platform === 'realme' });
        } else if (skipStorageReplay) {
            log.info(`[Session] Skipping Local Storage replay for ${platform}; relying on persistent profile.`);
        }
    } catch (e: any) {
        log.warn(`[Session] LS injection failed: ${e.message}`);
    }

    // Inject Overlay for IP Rotation (Context-wide)
    // We rewrite injectOverlay logic here for Context since original tool takes Page
    await context.addInitScript(({ platform, id }) => {
        const initOverlay = () => {
            const container = document.createElement('div');
            container.id = 'fsa-overlay-ctx';
            Object.assign(container.style, {
                position: 'fixed', top: '10px', right: '10px', zIndex: '2147483647',
                display: 'flex', gap: '10px', fontFamily: 'system-ui, sans-serif',
                pointerEvents: 'none', width: 'auto', height: 'auto', backgroundColor: 'transparent'
            });

            const createBtn = (text: string, url: string, color: string) => {
                const btn = document.createElement('a');
                btn.href = url;
                btn.target = '_blank';
                btn.textContent = text;
                Object.assign(btn.style, {
                    display: 'inline-block', padding: '8px 16px', backgroundColor: color, color: 'white',
                    textDecoration: 'none', borderRadius: '20px', fontSize: '14px', fontWeight: 'bold',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.2)', cursor: 'pointer', pointerEvents: 'auto', transition: 'transform 0.2s'
                });
                btn.onmouseover = () => { btn.style.transform = 'scale(1.05)'; };
                btn.onmouseout = () => { btn.style.transform = 'scale(1)'; };
                return btn;
            };

            if (platform === 'shopsy') {
                container.appendChild(createBtn('Open Flipkart', 'https://www.flipkart.com', '#2874f0'));
            } else if (platform === 'flipkart') {
                container.appendChild(createBtn('Open Shopsy', 'https://www.shopsy.in', '#d32f2f'));
            }
            // Add other cross-links if needed, or generic home link

            const ipBtn = createBtn('Change IP', '#', '#4caf50');
            ipBtn.onclick = async (e) => {
                e.preventDefault();
                if (!confirm('Restart browser to rotate IP?')) return;
                ipBtn.textContent = 'Rotating...';
                ipBtn.style.backgroundColor = '#9e9e9e';
                ipBtn.style.pointerEvents = 'none';
                try {
                    const res = await fetch(`http://localhost:3001/api/accounts/${id}/rotate-ip`, { method: 'POST' });
                    const d = await res.json();
                    if (d.success) alert('IP Rotated! Browser restarting...');
                    else { alert('Failed: ' + d.message); ipBtn.textContent = 'Change IP'; ipBtn.style.backgroundColor = '#4caf50'; ipBtn.style.pointerEvents = 'auto'; }
                } catch (err) { alert('Error contacting backend.'); ipBtn.textContent = 'Change IP'; ipBtn.style.backgroundColor = '#4caf50'; ipBtn.style.pointerEvents = 'auto'; }
            };
            container.appendChild(ipBtn);

            if (document.body) document.body.appendChild(container);
            else setTimeout(initOverlay, 100);
        };
        initOverlay();
    }, { platform, id: accountId });



    // Navigate to platform
    const page = await context.newPage();

    // Diagnostic: Log requests to see if cookies are being sent
    await page.route('**/*', async (route) => {
        const request = route.request();
        if (request.isNavigationRequest()) {
            const domain = new URL(request.url()).hostname;
            const headers = await request.allHeaders();
            const hasCookie = !!headers['cookie'];
            console.log(`[DEBUG-ANTIGRAVITY] Navigation Request to: ${request.url()} | Has Cookie Header: ${hasCookie}`);
        }
        await route.continue();
    });

    page.on('console', msg => {
        if (msg.type() === 'log' || msg.type() === 'debug') {
            const text = msg.text();
            if (text.includes('[ANTIGRAVITY-BROWSER]')) {
                console.log(text);
            }
        }
    });

    log.info(`Navigating to ${startUrl}...`);
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

    // Settle time
    await page.waitForTimeout(2000);

    // If we land on login page, try one refresh just in case cookies were slow to register
    if (page.url().includes('/login')) {
        log.info('[DEBUG-ANTIGRAVITY] Landed on login page. Attempting one refresh for cookie settlement...');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
    }

    log.info(`${platform} session opened. Browser will stay open for use.`);

    // VERIFY LOGIN STATE
    const cookiesAfter = await context.cookies();
    const authNames = cookiesAfter.map(c => c.name).filter(n => ['at', 'S', 'SN', 'T'].includes(n));
    log.info(`[DEBUG-ANTIGRAVITY] Context Auth Cookies after nav: ${authNames.join(', ')}`);

    const finalLoggedIn = await Promise.race([
        page.waitForSelector('text=My Profile', { timeout: 3000 }).then(() => true).catch(() => false),
        page.waitForSelector('text=Logout', { timeout: 3000 }).then(() => true).catch(() => false),
        page.waitForSelector('text=Orders', { timeout: 3000 }).then(() => true).catch(() => false),
        page.waitForSelector('._28p97w', { timeout: 3000 }).then(() => true).catch(() => false),
        new Promise(r => setTimeout(() => r(false), 3500))
    ]);

    if (finalLoggedIn && !page.url().includes('/login')) {
        log.info(`[DEBUG-ANTIGRAVITY] PAGE STATE: LOGGED IN (Selector matched and URL=${page.url()})`);

        // SCRAPE DETAILS
        try {
            log.info('Scraping account details...');
            const details: any = {};

            // 1. Try Header Name (Works on any page)
            const headerName = await page.locator('._28p97w, ._10Ermr, .exehdJ').first().textContent().catch(() => null);
            if (headerName) details.name = headerName.trim();

            // 2. If on Account Page, try inputs
            if (page.url().includes('/account')) {
                const fname = await page.inputValue('input[name="firstName"]').catch(() => '');
                const lname = await page.inputValue('input[name="lastName"]').catch(() => '');
                if (fname) details.name = `${fname} ${lname}`.trim();

                const mobile = await page.inputValue('input[name="mobileNumber"]').catch(() => '');
                if (mobile) details.mobile = mobile;

                const email = await page.inputValue('input[name="email"]').catch(() => '');
                if (email) details.email = email;
            }

            // 3. Scrape Orders (Flipkart/Shopsy ONLY)
            if (platform === 'flipkart' || platform === 'shopsy') {
                try {
                    log.info('Starting background order scrape...');
                    const orderPage = await context.newPage();
                    const ordersUrl = platform === 'shopsy' ? 'https://www.shopsy.in/mobile-view-page?url=%2Frv%2Forders' : 'https://www.flipkart.com/account/orders';
                    await orderPage.goto(ordersUrl, { waitUntil: 'domcontentloaded' });

                    // Wait for order list
                    try {
                        await orderPage.waitForSelector('.AO0Ooo, ._2aFisS, .OhP-7q', { timeout: 5000 });
                    } catch (e) {
                        log.info('No orders found or timeout waiting for selector');
                    }

                    // Scrape logic
                    const orders = await orderPage.evaluate(() => {
                        const items = document.querySelectorAll('a._2aFisS, div.AO0Ooo a, a.OhP-7q'); // Common order item selectors
                        const results: any[] = [];

                        items.forEach((item) => {
                            // Attempt to find fields
                            const nameEl = item.querySelector('.KzDlHZ, ._213eRC, div[class*="product-name"]');
                            const priceEl = item.querySelector('._30jeq3, div[class*="price"]');
                            const statusEl = item.querySelector('.d-qwWO, ._35O681, div[class*="status"]'); // Status text
                            const imgEl = item.querySelector('img');

                            // Order ID often in URL or difficult to find in list view, might need to parse href
                            const href = item.getAttribute('href') || '';
                            const urlParams = new URLSearchParams(href.split('?')[1]);
                            const orderId = urlParams.get('order_id') || href.split('order_id=')[1]?.split('&')[0] || '';

                            if (nameEl) {
                                results.push({
                                    orderId: orderId,
                                    productName: nameEl.textContent?.trim() || '',
                                    price: priceEl?.textContent?.trim() || '',
                                    status: statusEl?.textContent?.trim() || '',
                                    deliveryDate: '', // detailed status usually has date
                                    imageUrl: imgEl?.src || '',
                                    orderUrl: href.startsWith('/') ? (window.location.origin + href) : href
                                });
                            }
                        });
                        return results.slice(0, 10); // Limit to last 10
                    });

                    log.info(`Scraped ${orders.length} orders.`);
                    if (orders.length > 0) {
                        details.orders = orders;
                    }

                    await orderPage.close();
                } catch (e: any) {
                    log.warn(`Failed to scrape orders: ${e.message}`);
                    // Try to close if open
                    try { (await context.pages().find(p => p.url().includes('orders')))?.close(); } catch { }
                }
            } else {
                log.info(`Skipping order scrape for ${platform} (Not implemented)`);
            }

            if (Object.keys(details).length > 0) {
                log.info(`Scraped details with orders: ${JSON.stringify(details).substring(0, 100)}...`);
                // Update Account
                await upsertAccount({
                    id: accountId,
                    platform: platform as any,
                    details: details,
                    orders: details.orders // Save explicitly
                });
            }
        } catch (e: any) {
            log.warn(`Failed to scrape details: ${e.message}`);
        }
    } else {
        log.info(`[DEBUG-ANTIGRAVITY] PAGE STATE: LOGGED OUT (URL=${page.url()})`);

        // Check for Login button
        const loginBtn = await page.getByRole('link', { name: 'Login' }).first().isVisible().catch(() => false);
        log.info(`[DEBUG-ANTIGRAVITY] Login Button Visible: ${loginBtn}`);
    }

    // PERIODIC SAVE (LS & Cookies) - Optimized to only save when changed
    let lastCookieHash = '';
    let lastLsHash = '';

    // Accumulate LS keys across subdomains (e.g. passport -> www) to prevent overwriting auth tokens
    const existingLS = await loadLocalStorage(accountId, platform) || {};
    const accumulatedLS: Record<string, string> = { ...existingLS };

    // Aggressive Capture Helper
    const captureSessionState = async (trigger: string) => {
        try {
            if (page.isClosed()) return;
            const url = page.url();

            // 1. Local Storage Capture
            const ls = await page.evaluate(() => JSON.stringify(window.localStorage));
            const lsObj = JSON.parse(ls || '{}');
            const lsKeys = Object.keys(lsObj);

            if (lsKeys.length > 0) {
                // Merge into accumulator
                let hasNewData = false;
                for (const [key, value] of Object.entries(lsObj)) {
                    if (accumulatedLS[key] !== value) {
                        accumulatedLS[key] = value as string;
                        hasNewData = true;
                    }
                }

                if (hasNewData) {
                    const mergedLSStr = JSON.stringify(accumulatedLS);
                    const lsHash = Buffer.from(mergedLSStr).toString('base64').slice(0, 50);

                    if (lsHash !== lastLsHash) {
                        lastLsHash = lsHash;
                        await saveLocalStorage(accountId, accumulatedLS, platform);
                        await pushLocalStorage(accountId, platform);
                        log.info(`[${trigger}] LS merged & synced. Keys: ${Object.keys(accumulatedLS).length}`);
                    }
                }
            }

            // 2. Cookie Capture
            if (!url.includes('/login') && !url.includes('/logout')) {
                const cookies = await context.cookies();
                let shouldSave = false;

                if (platform === 'flipkart' || platform === 'shopsy') {
                    const snCookie = cookies.find(c => c.name === 'SN');
                    const isLO = snCookie?.value.endsWith('.LO') || false;
                    if (snCookie && !isLO) shouldSave = true;
                } else {
                    if (cookies.length > 5) shouldSave = true;
                }

                if (shouldSave) {
                    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).sort().join('|');
                    const cookieHash = Buffer.from(cookieStr).toString('base64').slice(0, 50);

                    if (cookieHash !== lastCookieHash) {
                        lastCookieHash = cookieHash;
                        await extractAndSaveCookies(context, accountId, platform);
                        await pushCookies(accountId, platform);
                        log.info(`[${trigger}] Cookies synced.`);
                    }
                }
            }
        } catch (e) {
            // Ignore error
        }
    };

    // Trigger on Interval (Backup)
    const saveInterval = setInterval(() => captureSessionState('Interval'), 2000);

    // Trigger on Navigation (Crucial for capturing redirect data like passport -> www)
    page.on('load', () => captureSessionState('Load'));
    page.on('framenavigated', () => captureSessionState('Nav'));

    log.info(`${platform} session opened. Browser will stay open for use.`);
    context.on('close', async () => {
        clearInterval(saveInterval); // Stop polling
        log.info('Session browser closed.');
    });

    return { status: 'success', message: `${platform} session opened with saved cookies` };
}
