import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';
import {
    X,
    Plus,
    RefreshCw,
    ArrowLeft,
    ArrowRight,
    Shield,
    Globe,
    LogOut,
    Wifi,
    Search,
    ChevronDown,
    LayoutGrid,
    Copy,
    Layers
} from 'lucide-react';
import { Account, Platform } from '../types';
import { GenericPlatformIcon } from './Icons';
import { BulkOpenConfig } from './BulkUrlOpener';

interface BrowserTab {
    id: string;
    title: string;
    url: string;
    loading: boolean;
    partition?: string;
    accountId?: string;
    platform?: Platform;
    actualIp?: string;
    initialUrl: string;
    localStorageData?: any;
    isSessionInitializing?: boolean; // CRITICAL: Prevents cookie/LS sync during session injection
}

interface InAppBrowserProps {
    savedAccounts: Account[];
    onClose: () => void;
    onAddAccount?: () => void;
    launchTarget?: { accountId: string; platforms: Platform[]; targetBrowser?: string } | null;
    bulkOpenTarget?: BulkOpenConfig | null;
    onBulkProgress?: (current: number, total: number, status: string) => void;
    // New Props for Smart Routing
    browserId?: string;
    onTabCountChange?: (count: number) => void;
}

const START_URL = 'about:blank';

// === PERFORMANCE: Freeze/Unfreeze webviews ===
function freezeWebview(wv: any) {
    // Only execute if webview is ready
    if (!wv || !(wv as any).__domReady) return;
    try {
        wv.setAudioMuted(true);
        wv.executeJavaScript(`
            document.hidden = true;
            document.dispatchEvent(new Event('visibilitychange'));
        `).catch(() => { });
    } catch (e) { /* ignore */ }
}

function unfreezeWebview(wv: any) {
    // Only execute if webview is ready
    if (!wv || !(wv as any).__domReady) return;
    try {
        wv.setAudioMuted(false);
        wv.executeJavaScript(`
            document.hidden = false;
            document.dispatchEvent(new Event('visibilitychange'));
        `).catch(() => { });
    } catch (e) { /* ignore */ }
}

// === PERFORMANCE: One-time event binding helper ===
function bindWebviewEvents(
    tab: BrowserTab,
    wv: any,
    updateTab: (id: string, updates: Partial<BrowserTab>) => void,
    setTabs: React.Dispatch<React.SetStateAction<BrowserTab[]>>,
    setActiveTabId: React.Dispatch<React.SetStateAction<string>>
) {
    if (wv.__eventsBound) return;
    wv.__eventsBound = true;

    // Use setMaxListeners to avoid warnings in a multi-tab environment
    // Though usually it's per WebContents, let's be safe.
    try {
        if (wv.getWebContents) {
            const wc = wv.getWebContents();
            if (wc && wc.setMaxListeners) wc.setMaxListeners(20);
        }
    } catch (e) { }

    wv.addEventListener('console-message', (e: any) => {
        console.log(`%c[Webview:${tab.id}] ${e.message}`, 'color: gray');
    });

    wv.addEventListener('did-start-loading', () => {
        updateTab(tab.id, { loading: true });
    });

    // Mark webview as ready for freeze/unfreeze operations
    wv.addEventListener('dom-ready', () => {
        wv.__domReady = true;

        // Debugging session
        wv.executeJavaScript(`
            console.log('[WebviewDebug] URL:', window.location.href);
            console.log('[WebviewDebug] Cookies:', document.cookie.split(';').length);
            console.log('[WebviewDebug] LS Keys:', Object.keys(localStorage).length, 'names:', Object.keys(localStorage).join(', '));
            
            // PATCH: Prevent Realme's premature profile clicks from redirecting to login
            if (window.location.hostname.includes('realme.com')) {
                setInterval(() => {
                    if (document.cookie.includes('accessToken')) {
                        document.querySelectorAll('a[href*="/login"]').forEach(el => {
                            if (!el.dataset.patched) {
                                el.addEventListener('click', (e) => {
                                    // Let Realme's React code handle the drop down, but stop the raw HTML redirect
                                    e.preventDefault(); 
                                    console.log('[WebviewDebug] Patched Realme profile click');
                                });
                                el.dataset.patched = 'true';
                            }
                        });
                    }
                }, 1000);
            }
        `).catch(() => { });
    });

    // Debounce timer for URL bar updates to prevent flickering during SSO redirect chains
    let urlUpdateTimer: ReturnType<typeof setTimeout> | null = null;

    wv.addEventListener('did-stop-loading', () => {
        // Debounce URL bar updates: wait 500ms for redirects to settle
        // This prevents visible flickering during SSO redirect chains (e.g., Realme orders)
        if (urlUpdateTimer) clearTimeout(urlUpdateTimer);
        urlUpdateTimer = setTimeout(() => {
            const url = wv.getURL();
            updateTab(tab.id, {
                loading: false,
                title: wv.getTitle() || tab.title,
                url: url,
                isSessionInitializing: false
            });
        }, 500);
    });

    // Handle new window requests (target="_blank" links)
    wv.addEventListener('new-window', (e: any) => {
        e.preventDefault();
        const newUrl = e.url;
        if (newUrl && newUrl !== 'about:blank') {
            const newTabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const newTab: BrowserTab = {
                id: newTabId,
                title: 'Loading...',
                url: newUrl,
                initialUrl: newUrl,
                loading: true,
                partition: tab.partition,
                accountId: tab.accountId,
                platform: tab.platform,
                actualIp: tab.actualIp
            };
            setTabs(prev => [...prev, newTab]);
            setActiveTabId(newTabId);
        }
    });

    // Handle loading errors gracefully
    wv.addEventListener('did-fail-load', (e: any) => {
        if (e.errorCode !== -3 && e.errorCode !== 0) {
            console.warn(`[Webview] Load failed for ${tab.id}: ${e.errorDescription} (${e.errorCode})`);
        }
        updateTab(tab.id, { loading: false });
    });
}

// Grouping saved accounts by Platform for the "Tree View" effect
// Flipkart and Shopsy share same auth, so show accounts under both platforms
const groupAccountsByPlatform = (accounts: Account[]) => {
    const grouped = accounts.reduce((acc, account) => {
        const p = account.platform;
        if (!acc[p]) acc[p] = [];
        acc[p].push(account);
        return acc;
    }, {} as Record<string, Account[]>);

    // Flipkart and Shopsy share authentication - merge them
    const flipkartAccounts = grouped['flipkart'] || [];
    const shopsyAccounts = grouped['shopsy'] || [];

    // Add Flipkart accounts to Shopsy (if they don't exist)
    if (flipkartAccounts.length > 0) {
        if (!grouped['shopsy']) grouped['shopsy'] = [];
        flipkartAccounts.forEach(acc => {
            if (!grouped['shopsy'].find(s => s.id === acc.id)) {
                grouped['shopsy'].push({ ...acc, platform: 'shopsy' as Platform });
            }
        });
    }

    // Add Shopsy accounts to Flipkart (if they don't exist)
    if (shopsyAccounts.length > 0) {
        if (!grouped['flipkart']) grouped['flipkart'] = [];
        shopsyAccounts.forEach(acc => {
            if (!grouped['flipkart'].find(s => s.id === acc.id)) {
                grouped['flipkart'].push({ ...acc, platform: 'flipkart' as Platform });
            }
        });
    }

    return grouped;
};

export const InAppBrowser: React.FC<InAppBrowserProps> = ({ savedAccounts, onClose, launchTarget, bulkOpenTarget, onBulkProgress, browserId, onTabCountChange }) => {

    const [tabs, setTabs] = useState<BrowserTab[]>([
        { id: 'start', title: 'New Tab', url: START_URL, initialUrl: START_URL, loading: false }
    ]);
    const [activeTabId, setActiveTabId] = useState<string>('start');
    const [urlInput, setUrlInput] = useState('');

    // === DUPLICATE TAB FEATURE ===
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
    const [showDuplicateModal, setShowDuplicateModal] = useState(false);
    const [duplicateCount, setDuplicateCount] = useState(1);
    const [targetDuplicateTabId, setTargetDuplicateTabId] = useState<string | null>(null);

    // Close context menu on click elsewhere
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
        e.preventDefault();
        // Don't show for Start Page
        if (tabId === 'start') return;

        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            tabId
        });
        setTargetDuplicateTabId(tabId);
    };

    const duplicateTab = (tabId: string, count: number = 1) => {
        const tabToClone = tabs.find(t => t.id === tabId);
        if (!tabToClone) return;

        const newTabs: BrowserTab[] = [];
        for (let i = 0; i < count; i++) {
            const newTabId = `tab-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 5)}`;
            newTabs.push({
                ...tabToClone,
                id: newTabId,
                title: tabToClone.title, // Title might be updated by webview later
                loading: true,
                // Ensure unique key for React lists if needed, but ID is unique
            });
        }

        setTabs(prev => [...prev, ...newTabs]);
        // Switch to the last created duplicate
        setActiveTabId(newTabs[newTabs.length - 1].id);
        setShowDuplicateModal(false);
    };


    // PERFORMANCE: Ref to access tabs in event listeners without stale closures
    const tabsRef = useRef(tabs);
    useEffect(() => {
        tabsRef.current = tabs;
        // Notify parent of tab count changes
        onTabCountChange?.(tabs.length);
    }, [tabs, onTabCountChange]);

    // PERFORMANCE: Batch updates to reduce re-renders
    const pendingUpdates = useRef<Record<string, Partial<BrowserTab>>>({});

    const updateTab = useCallback((id: string, updates: Partial<BrowserTab>) => {
        // Queue the update
        pendingUpdates.current[id] = {
            ...(pendingUpdates.current[id] || {}),
            ...updates
        };
    }, []);

    // Flush pending updates periodically (200ms = 5fps for status updates, sufficient and smooth)
    useEffect(() => {
        const interval = setInterval(() => {
            if (Object.keys(pendingUpdates.current).length > 0) {
                setTabs(prev => {
                    // Check if any updates actually change data to avoid renders? 
                    // React does this cheaply, but map is O(N).
                    // For 100 tabs, O(N) is fine if N=100.
                    const updates = pendingUpdates.current;
                    pendingUpdates.current = {}; // Clear immediately

                    return prev.map(t => {
                        if (updates[t.id]) {
                            return { ...t, ...updates[t.id] };
                        }
                        return t;
                    });
                });
            }
        }, 200);
        return () => clearInterval(interval);
    }, []);

    // Handle Launch Target (Auto-open tab)
    useEffect(() => {
        if (launchTarget) {
            // Filter by browserId if specified. If not specified, any browser picks it up (default behavior, though usually we specify)
            // Ideally, we ALWAYS specify browserId in launchTarget coming from Dashboard
            if (launchTarget.targetBrowser && launchTarget.targetBrowser !== browserId) {
                return;
            }

            const acc = savedAccounts.find(a => a.id === launchTarget.accountId);
            if (acc) {
                // Support launching multiple platforms at once
                launchTarget.platforms.forEach(p => createNewTab(acc, p));
            }
        }
    }, [launchTarget, browserId]);

    // UI State for New Tab Page
    const [expandedPlatforms, setExpandedPlatforms] = useState<Record<string, boolean>>({});
    const [searchTerm, setSearchTerm] = useState('');

    const webviewRefs = useRef<{ [key: string]: any }>({});
    const ipCache = useRef<Record<string, string>>({}); // PERFORMANCE: Cache IP results
    const activeTab = tabs.find(t => t.id === activeTabId);

    const groupedAccounts = groupAccountsByPlatform(savedAccounts);
    const platforms = Object.keys(groupedAccounts);

    const togglePlatform = (p: string) => {
        setExpandedPlatforms(prev => ({
            ...prev,
            [p]: !prev[p]
        }));
    };

    useEffect(() => {
        if (activeTab) {
            setUrlInput(activeTab.url === START_URL ? '' : activeTab.url);
        }
    }, [activeTabId, tabs]);

    // Keyboard Shortcuts for Tab Navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Check for Ctrl+Tab (Next) or Ctrl+Shift+Tab (Prev)
            // Also support Ctrl+Arrow keys
            if (e.ctrlKey) {
                if (e.key === 'Tab' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        // Previous Tab
                        switchTab('prev');
                    } else {
                        // Next Tab
                        switchTab('next');
                    }
                } else if (e.key === 'ArrowLeft') {
                    // Previous Tab (Ctrl+Left)
                    e.preventDefault();
                    switchTab('prev');
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [tabs, activeTabId]);

    const switchTab = (direction: 'next' | 'prev') => {
        const currentIndex = tabs.findIndex(t => t.id === activeTabId);
        if (currentIndex === -1) return;

        let newIndex;
        if (direction === 'next') {
            newIndex = (currentIndex + 1) % tabs.length;
        } else {
            newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        }

        setActiveTabId(tabs[newIndex].id);
    };

    // === PERFORMANCE: Freeze/unfreeze inactive webviews ===
    useEffect(() => {
        tabs.forEach(tab => {
            const wv = webviewRefs.current[tab.id];
            if (!wv || tab.url === START_URL) return;

            if (tab.id === activeTabId) {
                unfreezeWebview(wv);
            } else {
                freezeWebview(wv);
            }
        });
    }, [activeTabId]);

    const checkIP = async (tabId: string, forceCheck = false) => {
        const tab = tabs.find(t => t.id === tabId);
        if (!tab || !tab.accountId || !tab.partition) return;

        // PERFORMANCE: Return cached IP if available (unless forced)
        if (!forceCheck && ipCache.current[tab.partition]) {
            // updateTab(tabId, { actualIp: ipCache.current[tab.partition] }); // Let batched update handle it
            // Immediate update for better UX on cached hits? No, consistency is better.
            updateTab(tabId, { actualIp: ipCache.current[tab.partition] });
            return;
        }

        updateTab(tabId, { actualIp: 'Checking...' });

        // Timeout check: If IP isn't found in 10s, mark as failed
        const timeoutId = setTimeout(() => {
            const currentTab = tabs.find(t => t.id === tabId);
            if (currentTab && currentTab.actualIp === 'Checking...') {
                updateTab(tabId, { actualIp: 'Timeout' });
            }
        }, 10000);

        // Request IP check from Main process
        if ((window as any).electron && (window as any).electron.getIpInfo) {
            (window as any).electron.getIpInfo(tab.partition);
        } else {
            console.log('[InAppBrowser] Electron not found, using fallback');
            // Fallback
            try {
                const response = await fetch('https://api.ipify.org?format=json');
                const data = await response.json();
                clearTimeout(timeoutId);
                const ip = data.ip + ' (Local)';
                ipCache.current[tab.partition] = ip;
                updateTab(tabId, { actualIp: ip });
            } catch (e) {
                clearTimeout(timeoutId);
                updateTab(tabId, { actualIp: 'Check Failed' });
            }
        }
    };

    // Listen for IP Code Result
    useEffect(() => {
        if (!(window as any).electron) return;

        const handleIpResult = (_: any, data: { partition: string, ip?: string, error?: string }) => {
            // Perform lookup using ref to assume latest state availability logic if needed,
            // but for mapping partition -> ID we need to scan.
            // Since we receive partition, we can find the tab(s) with that partition.

            const targetTabs = tabsRef.current.filter(t => t.partition === data.partition);
            if (targetTabs.length === 0) return;

            // PERFORMANCE: Cache the IP result
            if (data.ip && data.partition) {
                ipCache.current[data.partition] = data.ip;
            }

            const newIp = data.error ? 'Failed' : (data.ip || 'Error');

            targetTabs.forEach(t => {
                updateTab(t.id, { actualIp: newIp });
            });
        };

        const removeListener = (window as any).electron.on('ip-info-result', handleIpResult);
        return () => { if (removeListener) removeListener(); };
    }, []); // Empty dependency array to prevent listener flapping

    // Listen for open-url-in-tab from main process (intercepted window.open / target="_blank")
    useEffect(() => {
        if (!(window as any).electron) return;

        const handleOpenUrl = (_: any, data: { url: string }) => {
            console.log(`[InAppBrowser] Received open-url-in-tab:`, data.url);

            // Find active tab to inherit partition (session)
            const currentTab = tabs.find(t => t.id === activeTabId);

            if (data.url && data.url !== 'about:blank') {
                const newTabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const newTab: BrowserTab = {
                    id: newTabId,
                    title: 'Loading...',
                    url: data.url,
                    initialUrl: data.url,
                    loading: true,
                    partition: currentTab?.partition, // Inherit session from current tab
                    accountId: currentTab?.accountId,
                    platform: currentTab?.platform,
                    actualIp: currentTab?.actualIp
                };
                setTabs(prev => [...prev, newTab]);
                setActiveTabId(newTabId);
            }
        };

        const removeListener = (window as any).electron.on('open-url-in-tab', handleOpenUrl);
        return () => { if (removeListener) removeListener(); };
    }, [tabs, activeTabId]);

    // Listen for Cookie Sync Results from Electron and save to database
    const cookieHashCache = useRef<Record<string, string>>({});

    useEffect(() => {
        if (!(window as any).electron) return;

        const handleCookies = async (_: any, data: { partition: string, cookies: any[], error?: string }) => {
            if (data.error || !data.cookies?.length) return;

            // DEBUG: List captured cookies
            const names = data.cookies.map((c: any) => c.name).join(', ');
            console.log(`%c[CookieSync] Captured ${data.cookies.length} raw cookies from Electron: ${names}`, 'color: gray');

            const tab = tabsRef.current.find(t => t.partition === data.partition);

            // CRITICAL: Skip sync if tab is still initializing session (prevents overwriting injected cookies)
            if (tab?.isSessionInitializing) {
                console.log(`%c[CookieSync] ⏸️ Skipped - Session still initializing for ${tab.accountId}`, 'color: orange');
                return;
            }

            if (tab?.accountId && tab?.platform) {
                // Hash check to avoid duplicate saves
                const cookieStr = data.cookies.map((c: any) => `${c.name}=${c.value}`).sort().join('|');
                const cookieHash = btoa(cookieStr).slice(0, 50);

                if (cookieHashCache.current[tab.partition!] === cookieHash) {
                    return; // No change, skip save
                }
                
                // If this is an iQOO, Vivo, Oppo, or Realme tab, we MUST NOT save the cookies back to the DB 
                // unless the user has actually logged in (indicated by the auth token).
                // Otherwise, the frontend will aggressively save the "ghost" pre-login session over the real one.
                if (tab.platform === 'iqoo' || tab.platform === 'vivo') {
                     const hasAuthToken = data.cookies.some((c: any) => c.name === 'vivo_account_cookie_iqoo_authtoken');
                     if (!hasAuthToken) {
                         console.log(`%c[CookieSync] 🛑 Dropped sync for ${tab.accountId} (Auth token missing - likely iQOO/Vivo pre-login state)`, 'color: orange');
                         return;
                     }
                } else if (tab.platform === 'oppo' || tab.platform === 'realme') {
                     // Oppo and Realme use HeyTap SSO which aggressively sets guest JWT-TOKEN cookies.
                     // A real login always contains an explicit 'token' or 'accessToken'.
                     const hasAuthToken = data.cookies.some((c: any) => c.name === 'token' || c.name === 'accessToken');
                     if (!hasAuthToken) {
                         console.log(`%c[CookieSync] 🛑 Dropped sync for ${tab.accountId} (Auth token missing - likely Oppo/Realme pre-login state)`, 'color: orange');
                         return;
                     }
                }
                
                cookieHashCache.current[tab.partition!] = cookieHash;

                try {
                    await api.saveCookies(tab.accountId, tab.platform, data.cookies);
                    console.log(`%c[CookieSync] ✅ Synced ${data.cookies.length} cookies for ${tab.accountId}`, 'color: #10b981; font-weight: bold');
                } catch (e) {
                    console.error('[CookieSync] Save failed:', e);
                }
            }
        };

        const removeListener = (window as any).electron.on('cookies-retrieved', handleCookies);
        return () => { if (removeListener) removeListener(); };
    }, []);

    // === PERIODIC COOKIE & LS SYNC (every 30s) ===
    // Syncs cookies/LS for all open tabs with account sessions in background
    const lsHashCache = useRef<Record<string, string>>({});

    useEffect(() => {
        if (!(window as any).electron?.getCookies) return;

        const syncInterval = setInterval(() => {
            // Get unique partitions from open tabs (that have accounts)
            const seenPartitions = new Set<string>();

            tabsRef.current.forEach(tab => {
                // CRITICAL: Skip sync for tabs that are still initializing (prevents overwriting injected session)
                if (tab.isSessionInitializing) {
                    return;
                }

                if (tab.partition && tab.accountId && tab.url !== 'about:blank' && !tab.url.includes('/login')) {

                    // 1. Cookie Sync (Once per partition)
                    if (!seenPartitions.has(tab.partition)) {
                        seenPartitions.add(tab.partition);
                        // This triggers 'cookies-retrieved' event which handles the save
                        (window as any).electron.getCookies(tab.partition);
                    }

                    // 2. Local Storage Sync (Per Tab/Webview)
                    const wv = webviewRefs.current[tab.id];
                    // Check if webview is ready and not strictly loading (though LS might exist while loading)
                    if (wv && (wv as any).__domReady) {
                        wv.executeJavaScript('JSON.stringify(window.localStorage)').then(async (ls: string) => {
                            if (ls && ls !== '{}' && tab.accountId && tab.platform) {
                                const lsHash = btoa(ls).slice(0, 50);
                                const key = `${tab.partition}_ls`;

                                if (lsHashCache.current[key] !== lsHash) {
                                    lsHashCache.current[key] = lsHash;

                                    const parsedLS = JSON.parse(ls);

                                    // CRITICAL PRE-LOGIN GUARD (For periodic background syncs)
                                    // Make sure we don't save a pre-login LocalStorage state that blows away the real one
                                    let shouldSave = true;
                                    if (tab.platform === 'iqoo' || tab.platform === 'vivo' || tab.platform === 'oppo' || tab.platform === 'realme') {
                                         // We can't easily check cookies here since this is LS, but we can check if 
                                         // the cookie sync has recently seen the auth token for this partition.
                                         // If there's 1-5 keys, it's almost certainly a "ghost" session.
                                         if (Object.keys(parsedLS).length <= 5) {
                                             shouldSave = false;
                                             console.log(`%c[LSSync] 🛑 Dropped sync for ${tab.accountId} (BBK pre-login state detected - only ${Object.keys(parsedLS).length} keys)`, 'color: orange');
                                         }
                                     }

                                    if (shouldSave && Object.keys(parsedLS).length > 2) {
                                        try {
                                            await api.saveLocalStorage(tab.accountId, tab.platform, parsedLS);
                                            console.log(`%c[LSSync] ✅ Synced LS for ${tab.accountId} (${(ls.length / 1024).toFixed(1)} KB)`, 'color: #10b981');
                                        } catch (e) {
                                            console.error('[LSSync] Failed to save LS:', e);
                                        }
                                    } else if (!shouldSave) {
                                        // Already logged
                                    } else {
                                        console.log(`%c[LSSync] ⚠️ Skipped saving LS (Only ${Object.keys(parsedLS).length} keys, likely logged out)`, 'color: orange');
                                    }
                                }
                            }
                        }).catch(() => { });
                    }
                }
            });
        }, 10000); // Increased frequency to 10s for faster capture during login

        return () => clearInterval(syncInterval);
    }, []);

    const createNewTab = async (account?: Account, platform?: Platform) => {
        const newTabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const isSpecificSession = !!account;
        let partition: string | undefined = undefined;
        let tabLocalStorage = undefined;

        if (isSpecificSession && account) {
            partition = `persist:${account.id}`;

            // NO PROXY on initial load for faster browsing
            // User can enable proxy by clicking "Rotate IP" button

            // Inject session data (no proxy)
            if ((window as any).electron && platform) {
                try {
                    // Clear any existing proxy for direct connection
                    (window as any).electron.setProxy(partition, "");
                    console.log(`%c[InAppBrowser] 🚀 Session: ${partition}`, 'color: lime; font-weight: bold');

                    // 1. Fetch Cookies, LS, and Fingerprint in parallel for speed
                    const [cookies, lsResponse, fpResponse] = await Promise.all([
                        api.getCookies(account.id, platform),
                        api.getLocalStorage(account.id, platform),
                        api.getFingerprint(account.id)
                    ]);

                    console.log(`[DEBUG-ANTIGRAVITY] getLocalStorage Response for ${platform}:`, lsResponse);
                    const lsData = lsResponse;

                    // === INJECTION ORDER: fingerprint → preload LS → cookies → webview ===
                    // This order is CRITICAL for iQOO, Xiaomi, and similar sites

                    // STEP 1️⃣: FINGERPRINT FIRST (before any navigation)
                    // Use DB fingerprint if available, otherwise use default
                    const fingerprint = fpResponse?.userAgent ? {
                        userAgent: fpResponse.userAgent,
                        viewport: {
                            width: fpResponse.viewportWidth || 1920,
                            height: fpResponse.viewportHeight || 1080
                        },
                        locale: fpResponse.locale || 'en-IN',
                        timezoneId: fpResponse.timezoneId || 'Asia/Kolkata',
                    } : {
                        // Default fingerprint if none saved
                        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        viewport: { width: 1920, height: 1080 },
                        locale: 'en-IN',
                        timezoneId: 'Asia/Kolkata',
                    };

                    if ((window as any).electron.setFingerprint) {
                        await (window as any).electron.setFingerprint(partition, fingerprint);
                        console.log(`%c[InAppBrowser] 🎭 Step 1: Fingerprint set for ${partition}`, 'color: magenta; font-weight: bold');
                    }

                    // STEP 2️⃣: PRELOAD LS (BEFORE page load)
                    if (lsData && Object.keys(lsData).length > 0 && (window as any).electron.setPreloadLS) {
                        await (window as any).electron.setPreloadLS(partition, lsData);
                        console.log(`%c[InAppBrowser] 📦 Step 2: Preload LS set for ${partition}`, 'color: orange; font-weight: bold');
                        tabLocalStorage = lsData;
                    }

                    // STEP 3️⃣: COOKIES (BEFORE page load)
                    if (cookies && cookies.length > 0) {
                        // CRITICAL: Clear all existing cookies first to prevent HttpOnly overwrite errors.
                        // Chromium refuses to overwrite an HttpOnly cookie with a non-HttpOnly one,
                        // so if a previous warmup/sync set wrong flags, the bad cookie persists.
                        if ((window as any).electron.clearCookies) {
                            await (window as any).electron.clearCookies(partition);
                            console.log(`%c[InAppBrowser] 🧹 Step 3a: Cleared stale cookies for ${partition}`, 'color: orange; font-weight: bold');
                        }

                        let filteredCookies = cookies;
                        if (platform === 'realme') {
                            const allowed = ['accessToken', 'acIdAuthSession', 'hadViewApp', 'nickname', 'RMID'];
                            filteredCookies = cookies.filter((c: any) => allowed.includes(c.name));
                        } else if (platform === 'iqoo' || platform === 'vivo') {
                            const allowed = [
                                'brand',
                                'fw_se',
                                'fw_uid',
                                'SESSION',
                                'iqoo_portal_sessionid',
                                'vivo_portal_sessionid', // vivo specific
                                'vivo_passport_token', // vivo specific
                                'official_site_cookie_id',
                                'official_site_csrf_token',
                                'openid_sign',
                                'org.springframework.web.servlet.i18n.CookieLocaleResolver.LOCALE',
                                'shop_avatar_big',
                                'shop_avatar_small',
                                'shop_cnum',
                                'shop_name',
                                'shop_sessionid',
                                'vivo_account_cookie_client_type',
                                'vivo_account_cookie_iqoo_authtoken',
                                'vivo_account_cookie_iqoo_checksum',
                                'vivo_account_cookie_iqoo_deviceid',
                                'vivo_account_cookie_iqoo_openid',
                                'vivo_account_cookie_iqoo_regioncode',
                                'vivo_account_cookie_iqoo_vivotoken'
                            ];
                            
                            // CRITICAL PRE-LOGIN FIX:
                            // If we don't have the main authtoken, we shouldn't inject ANY of these 
                            // because it will cause the site to get confused and create a ghost session
                            // that blocks the actual login flow.
                            const hasAuthToken = cookies.some((c: any) => c.name === 'vivo_account_cookie_iqoo_authtoken');
                            
                            if (hasAuthToken) {
                                filteredCookies = cookies.filter((c: any) => allowed.includes(c.name));
                            } else {
                                filteredCookies = [];
                            }
                        }

                        // SANITIZATION: Minimal touch to ensure acceptance
                        const sanitizedCookies = filteredCookies.map((c: any) => {
                            const clean = { ...c };

                            // Domain Fixes ONLY (Essential for subdomains)
                            if (clean.domain) {
                                if (platform === 'flipkart' && clean.domain === 'www.flipkart.com') clean.domain = '.flipkart.com';
                                else if (platform === 'shopsy' && clean.domain.includes('shopsy.in') && !clean.domain.startsWith('.')) clean.domain = '.shopsy.in';
                                else if (platform === 'iqoo' && clean.domain.includes('iqoo.com') && !clean.domain.startsWith('.')) clean.domain = '.iqoo.com';
                                else if (platform === 'vivo' && clean.domain.includes('vivo.com') && !clean.domain.startsWith('.')) clean.domain = '.vivo.com';
                                else if (platform === 'oppo' && clean.domain.includes('oppo.com') && !clean.domain.startsWith('.')) clean.domain = '.oppo.com';
                                else if (platform === 'realme' && clean.domain.includes('realme.com') && !clean.domain.startsWith('.')) clean.domain = '.realme.com';
                                else if ((platform === 'xiaomi' || platform === 'redmi') && (clean.domain.includes('mi.com') || clean.domain.includes('xiaomi.com'))) {
                                    if (clean.domain.includes('mi.com') && !clean.domain.startsWith('.')) clean.domain = '.mi.com';
                                    else if (clean.domain.includes('xiaomi.com') && !clean.domain.startsWith('.')) clean.domain = '.xiaomi.com';
                                }
                                else if (platform === 'oneplus' && clean.domain.includes('oneplus.in') && !clean.domain.startsWith('.')) clean.domain = '.oneplus.in';
                                else if (platform === 'samsung' && clean.domain.includes('samsung.com') && !clean.domain.startsWith('.')) clean.domain = '.samsung.com';
                                else if (platform === 'amazon' && clean.domain.includes('amazon.in') && !clean.domain.startsWith('.')) clean.domain = '.amazon.in';
                                else if (platform === 'vijaysales' && clean.domain.includes('vijaysales.com') && !clean.domain.startsWith('.')) clean.domain = '.vijaysales.com';
                                else if (platform === 'reliancedigital' && clean.domain.includes('reliancedigital.in') && !clean.domain.startsWith('.')) clean.domain = '.reliancedigital.in';
                            }

                            // Remove hostOnly as it conflicts with explicit domain
                            delete clean.hostOnly;

                            // SAMESITE NORMALIZATION: Ensure correct format for Electron's cookie API
                            // DB may store 'no_restriction' (Playwright internal) or 'None' (browser format)
                            // Electron's setCookies in main.cjs expects 'None', 'Lax', or 'Strict'
                            if (clean.sameSite === 'no_restriction' || clean.sameSite === 'None') {
                                clean.sameSite = 'None';
                            } else if (clean.sameSite === 'lax' || clean.sameSite === 'Lax') {
                                clean.sameSite = 'Lax';
                            } else if (clean.sameSite === 'strict' || clean.sameSite === 'Strict') {
                                clean.sameSite = 'Strict';
                            } else {
                                clean.sameSite = 'Lax'; // Default: missing/unknown sameSite → Lax (browser default)
                            }

                            // SameSite=None requires Secure=true per Chromium policy
                            if (clean.sameSite === 'None') {
                                clean.secure = true;
                            }

                            if (platform === 'realme') {
                                if (clean.name === 'accessToken') {
                                    clean.httpOnly = true;
                                    clean.secure = false;
                                    clean.sameSite = 'Lax';
                                } else if (clean.name === 'acIdAuthSession') {
                                    clean.httpOnly = true;
                                    clean.secure = true;
                                    clean.sameSite = 'None';
                                } else if (clean.name === 'nickname' || clean.name === 'RMID') {
                                    clean.httpOnly = false;
                                    clean.secure = true;
                                    clean.sameSite = 'Lax';
                                }
                            }

                            // EXPIRATION FIX: Force extend expiration to prevent "Ghost Session"
                            // FORCED PERSISTENCE HACK: Ensure all cookies live for at least 90 days
                            const now = Date.now() / 1000;
                            if (clean.expirationDate && clean.expirationDate < now + (86400 * 60)) {
                                clean.expirationDate = now + (86400 * 90); // Force to 90 days if expiring in less than 60 days
                            } else if (!clean.expirationDate) {
                                clean.expirationDate = now + (86400 * 90); // Convert session cookies to persistent (90 days)
                            }

                            return clean;
                        });

                        console.log(`%c[InAppBrowser] 🍪 Step 3: Injecting cookies for ${partition}`, 'font-weight: bold');

                        await (window as any).electron.setCookies(partition, sanitizedCookies);
                        console.log(`[InAppBrowser] ✅ Cookies set confirmation received for ${partition}`);

                        // AUDIT: Verify immediately
                        (window as any).electron.getCookies(partition);

                        // Wait for audit result
                        await new Promise<void>(resolve => {
                            let cleanup: (() => void) | undefined;

                            const handler = (_: any, data: any) => {
                                if (data.partition === partition) {
                                    const readBackCookies = data.cookies || [];
                                    console.log(`%c[CookieAudit] READ BACK ${readBackCookies.length} cookies from Electron storage!`, 'background: blue; color: white');

                                    const injectedNames = sanitizedCookies.map((c: any) => c.name);
                                    const readBackNames = readBackCookies.map((c: any) => c.name);
                                    const missing = injectedNames.filter((n: string) => !readBackNames.includes(n));

                                    if (missing.length > 0) {
                                        console.error(`%c[CookieAudit] ❌ MISSING ${missing.length} COOKIES: ${missing.join(', ')}`, 'color: red; font-weight: bold');
                                    } else {
                                        console.log('%c[CookieAudit] ✅ All cookies persisted successfully.', 'color: green');
                                    }

                                    resolve();
                                    if (cleanup) cleanup();
                                }
                            };

                            cleanup = (window as any).electron.on('cookies-retrieved', handler);

                            setTimeout(() => {
                                if (cleanup) cleanup();
                                resolve();
                            }, 2000);
                        });

                        // Small extra buffer for settlement
                        await new Promise(r => setTimeout(r, 100));
                    }

                    // STEP 3.5️⃣: HIDDEN ORIGIN WARMUP (Critical for BBK Group sites)
                    // This pre-establishes sessions by making a background HTTP request,
                    // so when the webview loads, connections are warm and sessions exist.
                    const bbkSites = ['iqoo', 'vivo', 'oppo', 'realme'];
                    if (bbkSites.includes(platform) && (window as any).electron.warmupOrigin) {
                        console.log(`%c[InAppBrowser] 🔥 Step 3.5: Hidden Origin Warmup for ${platform}...`, 'color: yellow; font-weight: bold; background: black');

                        const mainUrl = getPlatformUrl(platform);
                        const warmupUrls = [mainUrl];

                        // Add specific subdomains that handle auth/orders
                        if (platform === 'realme') {
                            warmupUrls.push('https://buy.realme.com/in/');
                            warmupUrls.push('https://store.realme.com/in/');
                        } else if (platform === 'iqoo') {
                            warmupUrls.push('https://shop.iqoo.com/in/');
                        } else if (platform === 'vivo') {
                            warmupUrls.push('https://shop.vivo.com/in/');
                        }

                        for (const url of warmupUrls) {
                            console.log(`[InAppBrowser] Warming up: ${url}`);
                            const warmupResult = await (window as any).electron.warmupOrigin(
                                partition,
                                url,
                                fingerprint.userAgent
                            );

                            if (warmupResult.success) {
                                console.log(`%c[InAppBrowser] ✅ Warmup complete for ${url}`, 'color: lime');
                            } else {
                                console.warn(`[InAppBrowser] ⚠️ Warmup failed for ${url}:`, warmupResult.error);
                            }
                        }

                    }

                    // STEP 4️⃣: WEBVIEW CREATION (happens after this block when tab is added)
                    console.log(`%c[InAppBrowser] 🎯 Session injection complete for ${partition}. Order: fingerprint → LS → cookies → warmup → webview`, 'color: cyan; font-weight: bold');

                } catch (e) {
                    console.error('[InAppBrowser] Failed to inject session data:', e);
                }
            }
        }

        // === CRITICAL: ALL SESSION DATA MUST BE SET BEFORE THIS POINT ===
        // The webview is created by React when this tab is added to the state.
        // Any session data applied AFTER this point is too late.
        console.log(`%c[InAppBrowser] 🚧 BARRIER: About to create tab. Session for ${partition} must be fully settled by now.`, 'background: red; color: white; font-weight: bold');

        const newTab: BrowserTab = {
            id: newTabId,
            title: isSpecificSession ? `${platform} - ${account.identifier}` : 'New Tab',
            url: isSpecificSession ? getPlatformUrl(platform!) : START_URL,
            initialUrl: isSpecificSession ? getPlatformUrl(platform!) : START_URL,
            loading: true,
            partition: partition,
            accountId: account?.id,
            platform: platform,
            actualIp: 'Direct',
            localStorageData: tabLocalStorage,
            isSessionInitializing: isSpecificSession // CRITICAL: Prevents sync during replay
        };

        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newTabId);
        // No IP check needed - using direct connection
    };

    // === BULK TAB CREATION ===
    // Optimized batch processing with cookie pre-fetching
    const BULK_BATCH_SIZE = 5; // REDUCED from 25 to 5 to prevent Main Process hanging

    const createBulkTabs = async (config: BulkOpenConfig) => {
        const { urls, accountIds, platform, rotateIp } = config;
        const total = urls.length * accountIds.length;
        let current = 0;

        console.log(`%c[BulkOpen] Starting bulk open: ${urls.length} URLs × ${accountIds.length} accounts = ${total} tabs`, 'color: magenta; font-weight: bold');
        onBulkProgress?.(0, total, 'Pre-fetching cookies...');

        // Step 1: Pre-fetch all cookies using Map for O(1) lookup
        const cookieCache = new Map<string, any[]>();

        await Promise.all(accountIds.map(async (id) => {
            try {
                const cookies = await api.getCookies(id, platform);
                cookieCache.set(id, cookies || []);
            } catch (e) {
                console.warn(`[BulkOpen] Failed to fetch cookies for ${id}:`, e);
                cookieCache.set(id, []);
            }
        }));

        console.log(`[BulkOpen] Pre-fetched cookies for ${cookieCache.size} accounts`);
        onBulkProgress?.(0, total, 'Cookies ready. Opening tabs...');

        // Step 2: Optionally rotate IPs before opening
        if (rotateIp) {
            onBulkProgress?.(0, total, 'Rotating IPs...');
            await Promise.allSettled(accountIds.map(async (id) => {
                try {
                    await api.post(`/accounts/${id}/rotate-ip`, { skipLaunch: true });
                    console.log(`[BulkOpen] Rotated IP for ${id}`);
                } catch (e) {
                    console.warn(`[BulkOpen] Failed to rotate IP for ${id}:`, e);
                }
            }));
        }

        // Step 3: Create all tab configurations
        type TabConfig = { accountId: string; url: string; account: Account };
        const tabConfigs: TabConfig[] = [];

        for (const accountId of accountIds) {
            const account = savedAccounts.find(a => a.id === accountId);
            if (!account) continue;

            for (const url of urls) {
                tabConfigs.push({ accountId, url, account });
            }
        }

        // Step 4: Process in batches using chunked Promise.allSettled
        const newTabs: BrowserTab[] = [];

        for (let i = 0; i < tabConfigs.length; i += BULK_BATCH_SIZE) {
            const batch = tabConfigs.slice(i, i + BULK_BATCH_SIZE);

            await Promise.allSettled(batch.map(async ({ accountId, url, account }) => {
                const tabId = `bulk-${Date.now()}-${accountId}-${Math.random().toString(36).substr(2, 5)}`;
                const partition = `persist:${accountId}`;

                let finalDisplayIp = rotateIp ? 'Rotating...' : 'Direct';

                // Inject cookies from cache (already pre-fetched)
                if ((window as any).electron) {
                    const cookies = cookieCache.get(accountId) || [];

                    // Set proxy - OPTIMIZED: Use single call if possible, otherwise rely on backend rotation response
                    if (rotateIp) {
                        try {
                            // OPTIMIZATION: rotate-ip now returns the proxy! We should change how we call it.
                            // However, strictly adhering to the "Bulk Open" flow often calls rotate-ip SEPARATELY before this loop (lines 547).
                            // Let's optimize: IF specific proxy info was cached from step 2, use it.

                            // Since we didn't refactor Step 2 to store results yet, we will fetch proxy here but using the new efficient endpoint if we wanted, 
                            // OR we rely on standard GET /proxy which is fast enough if offset is already updated.
                            // BUT, let's keep it robust: standard GET /proxy is fine here because rotation already happened in Step 2.

                            const proxyRes = await api.get<{ success: boolean; proxy: string | null }>(`/accounts/${accountId}/proxy`);
                            if (proxyRes.data.success && proxyRes.data.proxy) {
                                (window as any).electron.setProxy(partition, proxyRes.data.proxy);

                                // Optimistic IP extraction
                                const ipMatch = proxyRes.data.proxy.match(/(?:\d{1,3}\.){3}\d{1,3}/);
                                if (ipMatch) {
                                    finalDisplayIp = ipMatch[0];
                                } else {
                                    finalDisplayIp = 'Verifying...';
                                }
                            } else {
                                (window as any).electron.setProxy(partition, "");
                                finalDisplayIp = 'Direct';
                            }
                        } catch {
                            (window as any).electron.setProxy(partition, "");
                            finalDisplayIp = 'Direct';
                        }
                    } else {
                        (window as any).electron.setProxy(partition, "");
                    }

                    // Inject cookies
                    if (cookies.length > 0) {
                        (window as any).electron.setCookies(partition, cookies);
                    }
                }

                const newTab: BrowserTab = {
                    id: tabId,
                    title: `${platform} - ${account.identifier}`,
                    url: url,
                    initialUrl: url,
                    loading: true,
                    partition: partition,
                    accountId: accountId,
                    platform: platform,
                    actualIp: finalDisplayIp
                };

                newTabs.push(newTab);
                current++;
                onBulkProgress?.(current, total, `Opening tab ${current}/${total}`);
            }));

            // Small delay between batches to prevent UI freeze
            if (i + BULK_BATCH_SIZE < tabConfigs.length) {
                await new Promise(r => setTimeout(r, 50));
            }
        }

        // Step 5: Add all tabs at once (more efficient than one-by-one)
        setTabs(prev => [...prev, ...newTabs]);

        // Switch to first new tab
        if (newTabs.length > 0) {
            setActiveTabId(newTabs[0].id);
        }

        console.log(`%c[BulkOpen] Completed: ${newTabs.length} tabs created`, 'color: lime; font-weight: bold');
        onBulkProgress?.(total, total, 'Complete!');

        // Step 6: Check IPs only for tabs that need verification (skip optimistic matches)
        if (rotateIp) {
            // Only check tabs that don't have a valid IP yet
            const tabsToVerify = newTabs.filter(t => !t.actualIp?.match(/(?:\d{1,3}\.){3}\d{1,3}/));

            if (tabsToVerify.length > 0) {
                onBulkProgress?.(total, total, 'Verifying remaining IPs...');
                setTimeout(() => {
                    tabsToVerify.forEach((tab, idx) => {
                        // Stagger IP checks tightly for speed
                        setTimeout(() => {
                            if (tab.partition && (window as any).electron?.getIpInfo) {
                                (window as any).electron.getIpInfo(tab.partition);
                            }
                        }, idx * 50); // 50ms delay (4x faster)
                    });
                }, 1000); // Wait 1s for webviews to be ready
            }
        }
    };

    // Handle bulk open target
    useEffect(() => {
        if (bulkOpenTarget && bulkOpenTarget.urls.length > 0 && bulkOpenTarget.accountIds.length > 0) {
            createBulkTabs(bulkOpenTarget);
        }
    }, [bulkOpenTarget]);


    const closeTab = (e: React.MouseEvent, tabId: string) => {
        e.stopPropagation();
        const newTabs = tabs.filter(t => t.id !== tabId);
        if (newTabs.length === 0) {
            const newId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            setTabs([{ id: newId, title: 'New Tab', url: START_URL, initialUrl: START_URL, loading: false }]);
            setActiveTabId(newId);
        } else {
            setTabs(newTabs);
            if (activeTabId === tabId) {
                setActiveTabId(newTabs[newTabs.length - 1].id);
            }
        }
    };



    const handleNavigate = (e: React.FormEvent) => {
        e.preventDefault();
        let url = urlInput;
        // Simple valid check
        if (!url.includes('.') && !url.includes(':')) {
            // Search
            url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
        } else if (!url.startsWith('http')) {
            url = 'https://' + url;
        }

        if (webviewRefs.current[activeTabId]) {
            webviewRefs.current[activeTabId].loadURL(url);
        }
    };

    const getPlatformUrl = (p: Platform) => {
        switch (p) {
            case 'flipkart': return 'https://www.flipkart.com/';
            case 'shopsy': return 'https://www.shopsy.in/';
            case 'amazon': return 'https://www.amazon.in/';
            case 'blinkit': return 'https://blinkit.com/';
            case 'zepto': return 'https://zeptonow.com/';
            case 'reliance': return 'https://www.reliancedigital.in/';
            case 'samsung': return 'https://www.samsung.com/in/';
            case 'oneplus': return 'https://www.oneplus.in/';
            case 'vivo': return 'https://www.vivo.com/in/';
            case 'oppo': return 'https://www.oppo.com/in/';
            case 'realme': return 'https://www.realme.com/in/';
            case 'redmi': return 'https://www.mi.com/in/';
            case 'xiaomi': return 'https://www.mi.com/in/';
            case 'iqoo': return 'https://www.iqoo.com/in/';
            case 'vijaysales': return 'https://www.vijaysales.com/';
            case 'reliancedigital': return 'https://www.reliancedigital.in/';
            default: return `https://www.google.com/search?q=${p}`;
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 relative overflow-hidden rounded-[1.5rem] border border-slate-200 shadow-2xl">
            {/* Minimal Header */}
            <div className="bg-white px-4 py-3 flex items-center gap-4 border-b border-slate-100 z-20 shadow-sm shrink-0">
                <div className="flex gap-1.5 p-1 bg-slate-50 rounded-lg border border-slate-100 shrink-0">
                    <button onClick={() => webviewRefs.current[activeTabId]?.goBack()} className="p-1.5 hover:bg-white hover:shadow-sm rounded-md text-slate-400 hover:text-slate-900 transition-all"><ArrowLeft size={16} /></button>
                    <button onClick={() => webviewRefs.current[activeTabId]?.goForward()} className="p-1.5 hover:bg-white hover:shadow-sm rounded-md text-slate-400 hover:text-slate-900 transition-all"><ArrowRight size={16} /></button>
                    <button onClick={() => webviewRefs.current[activeTabId]?.reload()} className="p-1.5 hover:bg-white hover:shadow-sm rounded-md text-slate-400 hover:text-slate-900 transition-all"><RefreshCw size={16} /></button>
                </div>

                {/* Integrated Address Bar */}
                <form onSubmit={handleNavigate} className="flex-1 max-w-2xl mx-auto flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 focus-within:ring-2 focus-within:ring-indigo-500/10 focus-within:border-indigo-500/20 transition-all">
                    <div className="text-slate-400">
                        {activeTab?.url.includes('https') ? <Shield size={14} className="text-emerald-500" /> : <Globe size={14} />}
                    </div>
                    <input
                        className="flex-1 bg-transparent border-none outline-none text-sm font-medium text-slate-700 placeholder:text-slate-400 min-w-0"
                        placeholder="Search or enter website..."
                        value={urlInput}
                        onChange={e => setUrlInput(e.target.value)}
                        onFocus={(e) => e.target.select()}
                    />
                </form>

                <div className="flex items-center gap-3 shrink-0">
                    {activeTab?.actualIp && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100 shadow-sm">
                            <Wifi size={12} />
                            <span className="text-[10px] font-bold font-mono">{activeTab.actualIp}</span>
                        </div>
                    )}

                    {/* Rotate IP Button */}
                    {activeTab?.accountId && (
                        <button
                            onClick={async () => {
                                try {
                                    console.log('%c[InAppBrowser] 🔄 Rotating IP...', 'color: magenta; font-weight: bold');

                                    // 1. Rotate Offset AND Get Proxy (One shot)
                                    const rotateRes = await api.post<{ success: boolean; proxy: string | null }>(`/accounts/${activeTab.accountId}/rotate-ip`, { skipLaunch: true });

                                    // 2. Set New Proxy immediately
                                    if ((window as any).electron && activeTab.partition) {
                                        const newProxy = rotateRes.data.proxy;
                                        if (rotateRes.data.success && newProxy) {
                                            const proxyHost = newProxy.split('@')[1] || newProxy;
                                            console.log(`%c[InAppBrowser] 🌐 NEW PROXY: ${proxyHost}`, 'color: lime; font-weight: bold; font-size: 14px');
                                            (window as any).electron.setProxy(activeTab.partition, newProxy);
                                        } else {
                                            console.log('%c[InAppBrowser] ⚠️ No proxy - using direct connection', 'color: orange');
                                            (window as any).electron.setProxy(activeTab.partition, "");
                                        }
                                    }

                                    // 3. Reload
                                    // PERFORMANCE: Use cache-ignoring reload for faster IP switch
                                    webviewRefs.current[activeTabId]?.reloadIgnoringCache();

                                    // 4. Check IP again
                                    updateTab(activeTabId, { actualIp: 'Rotating...' });
                                    const partition = activeTab.partition;
                                    // PERFORMANCE: Clear cached IP and force a new check
                                    if (partition) {
                                        delete ipCache.current[partition];
                                    }
                                    setTimeout(() => {
                                        checkIP(activeTabId, true); // Force check after rotation
                                    }, 3000);

                                } catch (e) {
                                    console.error('[InAppBrowser] Rotation failed:', e);
                                }
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors font-semibold text-xs"
                            title="Rotate to a new IP address"
                        >
                            <RefreshCw size={14} />
                            <span>Rotate IP</span>
                        </button>
                    )}

                    <button onClick={onClose} className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg transition-colors"><LogOut size={18} /></button>
                </div>
            </div>

            {/* Tab Strip - Separated Below Header */}
            <div className="bg-slate-50/50 px-4 py-1.5 flex items-center gap-1.5 border-b border-slate-200/60 overflow-x-auto no-scrollbar">
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        onClick={() => setActiveTabId(tab.id)}
                        onContextMenu={(e) => handleContextMenu(e, tab.id)}
                        className={`
                            flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all border shrink-0
                            ${activeTabId === tab.id
                                ? 'bg-white text-slate-900 border-slate-200 shadow-sm ring-1 ring-slate-200'
                                : 'bg-transparent text-slate-500 border-transparent hover:bg-white/50 hover:text-slate-700'
                            }
                        `}
                    >
                        <span className="truncate max-w-[150px]">{tab.title}</span>
                        <button
                            onClick={(e) => closeTab(e, tab.id)}
                            className={`rounded p-0.5 transition-colors ${activeTabId === tab.id ? 'hover:bg-slate-100 text-slate-400 hover:text-red-500' : 'hover:bg-slate-200 text-transparent group-hover:text-slate-400'}`}
                        >
                            <X size={12} />
                        </button>
                    </div>
                ))}
                <button onClick={() => createNewTab()} className="p-1.5 bg-slate-200/50 text-slate-500 rounded-lg hover:bg-slate-200 transition-colors"><Plus size={14} /></button>
            </div>


            {/* Content Area */}
            <div className="flex-1 relative bg-white">
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        className={`absolute inset-0 w-full h-full bg-white ${activeTabId === tab.id ? 'z-10 visible' : 'z-0 invisible pointer-events-none'}`}
                    >
                        {tab.url === START_URL ? (
                            // NEW TAB PAGE (Reference Style)
                            <div className="h-full w-full flex flex-col items-center pt-24 pb-12 overflow-y-auto">
                                <div className="w-full max-w-2xl px-6">
                                    {/* Search Header */}
                                    <div className="mb-8 text-center">
                                        <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm">
                                            <LayoutGrid size={32} className="text-slate-900" />
                                        </div>
                                        <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-2">Workspace Browser</h2>
                                        <p className="text-slate-500">Select an account to launch a secure session.</p>
                                    </div>

                                    {/* Search Input */}
                                    <div className="relative mb-8 group">
                                        <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors" />
                                        <input
                                            type="text"
                                            placeholder="Search accounts..."
                                            className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl shadow-sm text-slate-900 font-medium focus:ring-4 focus:ring-slate-100 focus:border-slate-300 outline-none transition-all placeholder:text-slate-400"
                                            value={searchTerm}
                                            onChange={e => setSearchTerm(e.target.value)}
                                        />
                                    </div>

                                    {/* Accounts List (Tree View style) */}
                                    <div className="bg-white border border-slate-100 rounded-3xl shadow-float overflow-hidden">
                                        {platforms.map(platform => {
                                            // Filter accounts by search term
                                            const filteredAccounts = groupedAccounts[platform].filter(acc =>
                                                searchTerm.trim() === '' ||
                                                acc.identifier.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                                acc.id.toLowerCase().includes(searchTerm.toLowerCase())
                                            );

                                            // Don't show platform if no matching accounts
                                            if (filteredAccounts.length === 0) return null;

                                            return (
                                                <div key={platform} className="border-b border-slate-50 last:border-none">
                                                    <button
                                                        onClick={() => togglePlatform(platform)}
                                                        className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors text-left"
                                                    >
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center border border-slate-100">
                                                                <GenericPlatformIcon name={platform} className="w-5 h-5" />
                                                            </div>
                                                            <span className="font-bold text-slate-900 capitalize">{platform}</span>
                                                            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-md">{filteredAccounts.length}</span>
                                                        </div>
                                                        <ChevronDown size={16} className={`text-slate-400 transition-transform ${expandedPlatforms[platform] ? 'rotate-180' : ''}`} />
                                                    </button>

                                                    {/* Accounts Inside */}
                                                    {expandedPlatforms[platform] && (
                                                        <div className="bg-slate-50/50 px-6 py-2 space-y-1 border-t border-slate-50">
                                                            {filteredAccounts.map(acc => (
                                                                <button
                                                                    key={acc.id}
                                                                    onClick={() => createNewTab(acc, acc.platform)}
                                                                    className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-100 transition-all text-left group"
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                                                                        <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">{acc.identifier}</span>
                                                                    </div>
                                                                    <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-900 opacity-0 group-hover:opacity-100 transition-all" />
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}

                                        {savedAccounts.length === 0 && (
                                            <div className="p-8 text-center text-slate-400 text-sm">No accounts found. Add one from the Dashboard.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <webview
                                ref={el => {
                                    if (el) {
                                        webviewRefs.current[tab.id] = el;
                                        // PERFORMANCE: Bind events only once per webview
                                        bindWebviewEvents(tab, el, updateTab, setTabs, setActiveTabId);
                                    }
                                }}
                                src={tab.initialUrl}
                                partition={tab.partition}
                                className="w-full h-full"
                                // @ts-ignore - Electron webview attribute
                                allowpopups="true"
                                // @ts-ignore - Disable web security for speed and CSP bypass
                                webpreferences="webSecurity=no"
                                // @ts-ignore - Prevent detection of automated environment
                                disableblinkfeatures="AutomationControlled"
                            />
                        )}
                    </div>
                ))}
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-50 bg-white rounded-xl shadow-xl border border-slate-100 p-1.5 min-w-[200px]"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => {
                            duplicateTab(contextMenu.tabId, 1);
                            setContextMenu(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-indigo-600 rounded-lg transition-colors text-left"
                    >
                        <Copy size={16} />
                        Duplicate
                    </button>
                    <button
                        onClick={() => {
                            setDuplicateCount(1);
                            setShowDuplicateModal(true);
                            setContextMenu(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-indigo-600 rounded-lg transition-colors text-left"
                    >
                        <Layers size={16} />
                        Duplicate Multiple...
                    </button>
                </div>
            )}

            {/* Duplicate Modal */}
            {showDuplicateModal && targetDuplicateTabId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-slate-900 mb-4">Duplicate Tab</h3>
                        <p className="text-sm text-slate-500 mb-4">
                            How many copies of this tab do you want to create?
                        </p>

                        <div className="mb-6">
                            <label className="text-xs font-bold text-slate-700 uppercase mb-2 block">Number of Copies</label>
                            <input
                                type="number"
                                min="1"
                                max="50"
                                value={duplicateCount}
                                onChange={(e) => setDuplicateCount(parseInt(e.target.value) || 1)}
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-bold text-center focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowDuplicateModal(false)}
                                className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-600 font-semibold rounded-xl hover:bg-slate-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => duplicateTab(targetDuplicateTabId, duplicateCount)}
                                className="flex-1 px-4 py-2.5 bg-indigo-500 text-white font-semibold rounded-xl hover:bg-indigo-600 transition-colors shadow-lg shadow-indigo-200"
                            >
                                Duplicate {duplicateCount} Tabs
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Add logging to track webview mounting
// And use useEffect to bind events if refs are available
// Since tabs map renders webviews, we can't easily use one top-level useEffect for all
// unless we iterate refs.
// Better approach: A wrapper component for the Webview?
// For now, simpler: Just remove the event props that might be causing React errors.
// The loading state is nice but if it breaks the app, remove it or implement safer.
// I will keep the event listeners in a useEffect hook watching 'tabs'.
