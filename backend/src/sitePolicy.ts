/**
 * Site Policy Map - Central configuration for auth strategies per platform
 * 
 * Based on Real-World Auth Playbook:
 * 🔴 Bucket A (Persistent Browser) - BBK Group + Amazon - NO cookie replay
 * 🟢 Bucket B (Replayable) - Other sites - Playwright capture → Electron replay
 */

export type Platform =
    | 'flipkart' | 'shopsy'
    | 'iqoo' | 'vivo' | 'oppo' | 'realme'
    | 'xiaomi' | 'redmi' | 'oneplus'
    | 'samsung' | 'amazon'
    | 'vijaysales' | 'reliancedigital';

export type AuthStrategy =
    | 'electron-persistent'  // Login once in Electron, never export cookies
    | 'playwright-replay'    // Playwright capture → Electron replay (may expire)
    | 'simple-replay';       // Full cookie replay, minimal protection

export interface SitePolicy {
    strategy: AuthStrategy;
    name: string;
    url: string;
    loginUrl?: string;
    loginSelectors: {
        success: string[];      // Selectors that indicate logged-in state
        loginButton?: string;   // Selector for login button (if modal)
        otpInput?: string;      // Selector for OTP input field
    };
    cookieReplayAllowed: boolean;
    warmupRequired: boolean;           // Hidden origin warmup before webview
    localStorageRelevant: boolean;     // Is LS needed for auth?
    sessionExpiry?: string;            // "24h", "7d", "never"
    fingerprintCritical: boolean;      // UA mismatch = failure?
    bucket: 'A' | 'B';                 // A = Persistent, B = Replayable
}

/**
 * Master Policy Map for all supported platforms
 */
export const SITE_POLICIES: Record<Platform, SitePolicy> = {
    // ============================================
    // 🔴 BUCKET A — Persistent Browser (NO Replay)
    // ============================================

    iqoo: {
        strategy: 'electron-persistent',
        name: 'iQOO',
        url: 'https://www.iqoo.com/in',
        loginUrl: 'https://www.iqoo.com/in',
        loginSelectors: {
            success: ['text=My Account', 'text=Logout', '.user-name'],
            loginButton: '.member-icon, text=Login, .icon-user',
        },
        cookieReplayAllowed: false,
        warmupRequired: false, // Electron persistent = no replay
        localStorageRelevant: false,
        sessionExpiry: 'never', // Session lives with partition
        fingerprintCritical: true,
        bucket: 'A',
    },

    vivo: {
        strategy: 'electron-persistent',
        name: 'Vivo',
        url: 'https://www.vivo.com/in',
        loginUrl: 'https://www.vivo.com/in',
        loginSelectors: {
            success: ['text=My Account', 'text=Logout', '.user-name', '.my-account'],
            loginButton: '.member-icon, text=Login',
        },
        cookieReplayAllowed: false,
        warmupRequired: false,
        localStorageRelevant: false,
        sessionExpiry: 'never',
        fingerprintCritical: true,
        bucket: 'A',
    },

    oppo: {
        strategy: 'electron-persistent',
        name: 'Oppo',
        url: 'https://www.oppo.com/in',
        loginUrl: 'https://www.oppo.com/in',
        loginSelectors: {
            success: ['text=My Account', 'text=Logout', '.user-info'],
            loginButton: '.login-btn, text=Login',
        },
        cookieReplayAllowed: false,
        warmupRequired: false,
        localStorageRelevant: false,
        sessionExpiry: 'never',
        fingerprintCritical: true,
        bucket: 'A',
    },

    realme: {
        strategy: 'electron-persistent',
        name: 'Realme',
        url: 'https://www.realme.com/in',
        loginUrl: 'https://www.realme.com/in',
        loginSelectors: {
            success: ['text=My Account', 'text=Logout', '.user-name'],
            loginButton: '.login-icon, text=Login',
        },
        cookieReplayAllowed: false,
        warmupRequired: false,
        localStorageRelevant: false,
        sessionExpiry: 'never',
        fingerprintCritical: true,
        bucket: 'A',
    },

    amazon: {
        strategy: 'electron-persistent',
        name: 'Amazon',
        url: 'https://www.amazon.in',
        loginUrl: 'https://www.amazon.in/ap/signin',
        loginSelectors: {
            success: ['#nav-link-accountList-nav-line-1[data-nav-ref="nav_youraccount_btn"]', 'text=Your Account', '#nav-orders'],
            loginButton: '#nav-link-accountList',
        },
        cookieReplayAllowed: false, // Amazon detects "cookie teleportation"
        warmupRequired: false,
        localStorageRelevant: false,
        sessionExpiry: 'never',
        fingerprintCritical: true,
        bucket: 'A',
    },

    // ============================================
    // 🟢 BUCKET B — Replayable Accounts
    // ============================================

    flipkart: {
        strategy: 'playwright-replay',
        name: 'Flipkart',
        url: 'https://www.flipkart.com',
        loginUrl: 'https://www.flipkart.com/account/login',
        loginSelectors: {
            success: ['text=My Profile', 'text=Logout', 'text=Orders', '._28p97w'],
            loginButton: 'text=Login',
            otpInput: 'input[type="text"], input[type="tel"]',
        },
        cookieReplayAllowed: true,
        warmupRequired: true,
        localStorageRelevant: true,
        sessionExpiry: '7d',
        fingerprintCritical: true,
        bucket: 'B',
    },

    shopsy: {
        strategy: 'playwright-replay',
        name: 'Shopsy',
        url: 'https://www.shopsy.in',
        loginUrl: 'https://www.shopsy.in',
        loginSelectors: {
            success: ['text=Account', 'text=My Orders', 'a[href*="/account"]'],
            loginButton: 'text=Login',
        },
        cookieReplayAllowed: true,
        warmupRequired: true,
        localStorageRelevant: true,
        sessionExpiry: '7d',
        fingerprintCritical: true,
        bucket: 'B',
    },

    xiaomi: {
        strategy: 'playwright-replay',
        name: 'Xiaomi (Redmi)',
        url: 'https://www.mi.com/in',
        loginUrl: 'https://account.xiaomi.com/pass/serviceLogin',
        loginSelectors: {
            success: ['text=My Account', '.user-info', '.account-info'],
            loginButton: 'text=Sign In, text=Login',
        },
        cookieReplayAllowed: true,
        warmupRequired: true,
        localStorageRelevant: true,
        sessionExpiry: '48h', // Short-lived!
        fingerprintCritical: true,
        bucket: 'B',
    },

    redmi: {
        strategy: 'playwright-replay',
        name: 'Redmi',
        url: 'https://www.mi.com/in',
        loginUrl: 'https://account.xiaomi.com/pass/serviceLogin',
        loginSelectors: {
            success: ['text=My Account', '.user-info', '.account-info'],
            loginButton: 'text=Sign In, text=Login',
        },
        cookieReplayAllowed: true,
        warmupRequired: true,
        localStorageRelevant: true,
        sessionExpiry: '48h',
        fingerprintCritical: true,
        bucket: 'B',
    },

    oneplus: {
        strategy: 'playwright-replay',
        name: 'OnePlus',
        url: 'https://www.oneplus.in',
        loginUrl: 'https://www.oneplus.in/login',
        loginSelectors: {
            success: ['text=My Account', '.user-dropdown', '.account-menu'],
            loginButton: 'text=Sign In, text=Login',
        },
        cookieReplayAllowed: true,
        warmupRequired: true,
        localStorageRelevant: true,
        sessionExpiry: '48h',
        fingerprintCritical: true,
        bucket: 'B',
    },

    samsung: {
        strategy: 'playwright-replay',
        name: 'Samsung',
        url: 'https://www.samsung.com/in',
        loginUrl: 'https://account.samsung.com/accounts/v1/SAMSUNG_IN/signIn',
        loginSelectors: {
            success: ['text=My Account', '.profile-icon', '.user-name'],
            loginButton: 'text=Sign In, text=Login',
        },
        cookieReplayAllowed: true,
        warmupRequired: true,
        localStorageRelevant: false,
        sessionExpiry: '7d',
        fingerprintCritical: true, // UA mismatch = silent failure
        bucket: 'B',
    },

    vijaysales: {
        strategy: 'simple-replay',
        name: 'Vijay Sales',
        url: 'https://www.vijaysales.com',
        loginUrl: 'https://www.vijaysales.com/customer/account/login',
        loginSelectors: {
            success: ['text=My Account', 'text=Logout', '.customer-welcome'],
            loginButton: 'text=Sign In',
        },
        cookieReplayAllowed: true,
        warmupRequired: false, // Simple site, no warmup needed
        localStorageRelevant: false,
        sessionExpiry: '7d',
        fingerprintCritical: false,
        bucket: 'B',
    },

    reliancedigital: {
        strategy: 'simple-replay',
        name: 'Reliance Digital',
        url: 'https://www.reliancedigital.in',
        loginUrl: 'https://www.reliancedigital.in/customer/account/login',
        loginSelectors: {
            success: ['text=My Account', 'text=Logout', '.user-dropdown'],
            loginButton: 'text=Login',
        },
        cookieReplayAllowed: true,
        warmupRequired: false,
        localStorageRelevant: true, // Session ID sometimes in LS
        sessionExpiry: '7d',
        fingerprintCritical: false,
        bucket: 'B',
    },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get policy for a platform
 */
export function getSitePolicy(platform: string): SitePolicy | undefined {
    return SITE_POLICIES[platform as Platform];
}

/**
 * Check if platform supports cookie replay
 */
export function canReplayCookies(platform: string): boolean {
    const policy = getSitePolicy(platform);
    return policy?.cookieReplayAllowed ?? false;
}

/**
 * Check if platform needs hidden origin warmup
 */
export function needsWarmup(platform: string): boolean {
    const policy = getSitePolicy(platform);
    return policy?.warmupRequired ?? false;
}

/**
 * Check if platform is BBK Group (iQOO/Vivo/Oppo/Realme)
 */
export function isBBKSite(platform: string): boolean {
    return ['iqoo', 'vivo', 'oppo', 'realme'].includes(platform.toLowerCase());
}

/**
 * Check if platform requires Electron-only login (no replay)
 */
export function requiresElectronLogin(platform: string): boolean {
    const policy = getSitePolicy(platform);
    return policy?.strategy === 'electron-persistent';
}

/**
 * Get all platforms in Bucket A (Persistent)
 */
export function getBucketAPlatforms(): Platform[] {
    return Object.entries(SITE_POLICIES)
        .filter(([_, policy]) => policy.bucket === 'A')
        .map(([platform]) => platform as Platform);
}

/**
 * Get all platforms in Bucket B (Replayable)
 */
export function getBucketBPlatforms(): Platform[] {
    return Object.entries(SITE_POLICIES)
        .filter(([_, policy]) => policy.bucket === 'B')
        .map(([platform]) => platform as Platform);
}
