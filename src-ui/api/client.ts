import { Account, Platform } from '../types';

const API_BASE = 'http://localhost:35412/api';

const getHeaders = () => {
    const headers: any = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('flowdesk_token');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
};

/** Safely parse a response as JSON, with clear error messages on failure */
async function safeJson(res: Response): Promise<any> {
    const contentType = res.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
        const text = await res.text();
        if (text.includes('<!DOCTYPE') || text.includes('<html')) {
            throw new Error('Backend server is not running. Please restart the app.');
        }
        throw new Error(`Unexpected response from server (${res.status})`);
    }

    return res.json();
}

/** Safely execute a fetch, catching network errors when backend is down */
async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
    try {
        return await fetch(url, init);
    } catch (e) {
        throw new Error('Cannot connect to backend server. Please restart the app.');
    }
}

export const api = {
    // Generic Helpers
    get: async <T>(url: string): Promise<{ data: T }> => {
        const res = await safeFetch(`${API_BASE}${url}`, { headers: getHeaders() });
        const data = await safeJson(res);
        return { data };
    },
    post: async <T>(url: string, body?: any): Promise<{ data: T }> => {
        const res = await safeFetch(`${API_BASE}${url}`, {
            method: 'POST',
            headers: getHeaders(),
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await safeJson(res);
        return { data };
    },

    // Auth
    signUp: async (username: string, password: string): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await safeJson(res);
        if (data.success && data.session?.access_token) {
            localStorage.setItem('flowdesk_token', data.session.access_token);
        }
        return data;
    },

    signIn: async (username: string, password: string): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/auth/signin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await safeJson(res);
        if (data.success && data.session?.access_token) {
            localStorage.setItem('flowdesk_token', data.session.access_token);
        }
        return data;
    },

    getMe: async (): Promise<any> => {
        const token = localStorage.getItem('flowdesk_token');
        if (!token) return { success: false, message: 'No token' };

        const res = await safeFetch(`${API_BASE}/auth/me`, {
            headers: getHeaders()
        });
        if (!res.ok) {
            localStorage.removeItem('flowdesk_token');
            throw new Error('Not authenticated');
        }
        return safeJson(res);
    },

    signOut: () => {
        localStorage.removeItem('flowdesk_token');
    },

    checkHealth: async (id: string): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/check/${encodeURIComponent(id)}`, {
            method: 'POST',
            headers: getHeaders()
        });
        return safeJson(res);
    },

    refreshSession: async (id: string): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/refresh/${encodeURIComponent(id)}`, {
            method: 'POST',
            headers: getHeaders()
        });
        return safeJson(res);
    },

    login: async (accountId: string, identifier: string, platform: Platform): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ accountId, identifier, platform })
        });
        return safeJson(res);
    },

    openSession: async (accountId: string, platform: Platform): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/session`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ accountId, platform })
        });
        return safeJson(res);
    },

    fetchOrders: async (accountId: string, platform: Platform): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/orders/${encodeURIComponent(accountId)}/fetch`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ platform })
        });
        return safeJson(res);
    },

    fetchGVBalance: async (accountId: string, platform: Platform): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/orders/${encodeURIComponent(accountId)}/fetch-gv`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ platform })
        });
        return safeJson(res);
    },

    // Batch order fetching for scalability
    batchFetchOrders: async (accountIds: string[], platform: Platform, concurrency: number = 5): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/orders/batch`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ accountIds, platform, concurrency, headless: true })
        });
        return safeJson(res);
    },

    getBatchJobStatus: async (jobId: string): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/orders/batch/${encodeURIComponent(jobId)}`, {
            headers: getHeaders()
        });
        return safeJson(res);
    },

    cancelBatchJob: async (jobId: string): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/orders/batch/${encodeURIComponent(jobId)}/cancel`, {
            method: 'POST',
            headers: getHeaders()
        });
        return safeJson(res);
    },

    pollOrders: async (accountIds: string[], platform: Platform): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/orders/poll`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ accountIds, platform })
        });
        return safeJson(res);
    },

    addAccount: async (data: any): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/accounts`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(data)
        });
        return safeJson(res);
    },

    deleteAccount: async (id: string): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        return safeJson(res);
    },

    deleteCookies: async (accountId: string, platform: Platform): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/${platform}/cookies`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        return safeJson(res);
    },

    saveCookies: async (accountId: string, platform: Platform, cookies: any[]): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/${platform}/cookies`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ cookies })
        });
        return safeJson(res);
    },

    getLocalStorage: async (id: string, platform: Platform): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/${platform}/localstorage`, {
            headers: getHeaders()
        });
        return safeJson(res);
    },

    saveLocalStorage: async (id: string, platform: Platform, data: any): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/${platform}/localstorage`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ data })
        });
        return safeJson(res);
    },

    updateAccount: async (id: string, updates: Partial<Account>): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/accounts`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ id, ...updates })
        });
        return safeJson(res);
    },

    getSettings: async (): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/settings`, { headers: getHeaders() });
        if (!res.ok) return {};
        return safeJson(res);
    },

    getProxies: async (): Promise<string[]> => {
        const res = await safeFetch(`${API_BASE}/proxies`, { headers: getHeaders() });
        if (!res.ok) return [];
        return safeJson(res);
    },

    saveProxies: async (proxies: string[]): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/proxies`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ proxies })
        });
        return safeJson(res);
    },

    startLoginSession: async (id: string, platform: Platform, headless: boolean = false): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/login-session`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ platform, headless })
        });
        return safeJson(res);
    },

    startPreLoginSession: async (id: string, platform: Platform, headless: boolean = false): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/accounts/pre-login-session`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ id, platform, headless })
        });
        return safeJson(res);
    },

    clearAccountErrors: async (): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/admin/accounts/clear-errors`, {
            method: 'POST',
            headers: getHeaders()
        });
        return safeJson(res);
    },

    resetAccount: async (id: string): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/admin/accounts/${encodeURIComponent(id)}/reset`, {
            method: 'POST',
            headers: getHeaders()
        });
        return safeJson(res);
    },

    saveSettings: async (settings: any): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(settings)
        });
        return safeJson(res);
    },

    terminateBrowsers: async (): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/terminate-all`, {
            method: 'POST',
            headers: getHeaders()
        });
        return safeJson(res);
    },

    getActivityLogs: async (): Promise<any[]> => {
        const res = await safeFetch(`${API_BASE}/logs/activity`, { headers: getHeaders() });
        if (!res.ok) return [];
        return safeJson(res);
    },

    // Accounts
    getAccounts: async (userId?: string): Promise<{ success: boolean; accounts: Account[], message?: string }> => {
        const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
        const res = await safeFetch(`${API_BASE}/accounts${query}`, { headers: getHeaders() });
        return safeJson(res);
    },

    getAppErrors: async (): Promise<any[]> => {
        const res = await safeFetch(`${API_BASE}/logs/errors`, { headers: getHeaders() });
        if (!res.ok) return [];
        return safeJson(res);
    },

    // Admin
    getAdminUsers: async (): Promise<any[]> => {
        const res = await safeFetch(`${API_BASE}/admin/users`, { headers: getHeaders() });
        return safeJson(res);
    },
    getAdminProfiles: async (): Promise<any[]> => {
        const res = await safeFetch(`${API_BASE}/admin/profiles`, { headers: getHeaders() });
        return safeJson(res);
    },

    upsertAdminUser: async (user: any): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/admin/users`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(user)
        });
        return safeJson(res);
    },

    deleteAdminUser: async (username: string): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/admin/users/${username}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        return safeJson(res);
    },

    moveAccounts: async (accountIds: string[], targetUserId: string): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/admin/move-accounts`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ accountIds, targetUserId })
        });
        return safeJson(res);
    },

    cloudSyncPull: async (): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/cloud/sync`, {
            method: 'POST',
            headers: getHeaders()
        });
        return safeJson(res);
    },


    getCookies: async (id: string, platform?: Platform): Promise<any[]> => {
        const url = platform
            ? `${API_BASE}/accounts/${encodeURIComponent(id)}/${platform}/cookies`
            : `${API_BASE}/accounts/${encodeURIComponent(id)}/cookies`;
        const res = await safeFetch(url, { headers: getHeaders() });
        if (!res.ok) return [];
        return safeJson(res);
    },

    // Chat
    syncChat: async (): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/chat/sync`, {
            method: 'POST',
            headers: getHeaders()
        });
        return safeJson(res);
    },

    askChat: async (query: string): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/chat/ask`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ query })
        });
        return safeJson(res);
    },

    // ============================================
    // QUEUE-BASED ORDER FETCHING (with caching)
    // ============================================

    // Queue-based single order fetch (uses cache + priority queue)
    queueFetchOrders: async (accountId: string, platform: Platform, forceRefresh = false): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/queue/orders/${encodeURIComponent(accountId)}/fetch`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ platform, forceRefresh })
        });
        return safeJson(res);
    },

    // Queue-based batch fetch with failure tracking
    queueBatchFetchOrders: async (
        accounts: Array<{ accountId: string; platform: string }>,
        forceRefresh = false
    ): Promise<{
        successful: Array<{ accountId: string; platform: string; orders: any[] }>;
        failed: Array<{ accountId: string; platform: string; reason: string; errorMessage: string; requiresRelogin: boolean }>;
        stats: { total: number; successful: number; failed: number; processingTimeMs: number };
    }> => {
        const res = await safeFetch(`${API_BASE}/queue/orders/batch`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ accounts, forceRefresh })
        });
        return safeJson(res);
    },

    // Multi-platform Interleaved Batch Fetching
    startMultiPlatformBatch: async (
        accounts: Array<{ accountId: string; platform: string }>,
        forceRefresh = false
    ): Promise<{ jobId: string; success: boolean; stats: { total: number } }> => {
        const res = await safeFetch(`${API_BASE}/queue/orders/batch-multi`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ accounts, forceRefresh })
        });
        return safeJson(res);
    },

    getMultiPlatformBatchStatus: async (jobId: string): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/queue/orders/batch-multi/${jobId}`, {
            headers: getHeaders()
        });
        return safeJson(res);
    },

    // Get queue statistics
    getQueueStats: async (): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/queue/stats`, { headers: getHeaders() });
        return safeJson(res);
    },

    // Get failed accounts that need re-login
    getFailedAccounts: async (): Promise<{
        accounts: Array<{ accountId: string; platform: string; reason: string; errorMessage: string; requiresRelogin: boolean }>;
        requiresRelogin: string[];
    }> => {
        const res = await safeFetch(`${API_BASE}/queue/failed`, { headers: getHeaders() });
        return safeJson(res);
    },

    // Clear failures (after user re-logs in)
    clearQueueFailures: async (): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/queue/clear-failures`, {
            method: 'POST',
            headers: getHeaders()
        });
        return safeJson(res);
    },

    // ============================================
    // FINGERPRINT (for iQOO session persistence)
    // ============================================

    getFingerprint: async (accountId: string): Promise<{
        userAgent: string | null;
        viewportWidth?: number;
        viewportHeight?: number;
        locale?: string;
        timezoneId?: string;
    }> => {
        const res = await safeFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/fingerprint`, {
            headers: getHeaders()
        });
        if (!res.ok) return { userAgent: null };
        return safeJson(res);
    },

    saveFingerprint: async (accountId: string, fingerprint: {
        userAgent: string;
        viewportWidth?: number;
        viewportHeight?: number;
        locale?: string;
        timezoneId?: string;
    }): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/fingerprint`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ fingerprint })
        });
        return safeJson(res);
    },

    // ============================================
    // BULK LOGOUT
    // ============================================

    logoutAllDevices: async (accountIds: string[]): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/accounts/logout-all`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ accountIds })
        });
        return safeJson(res);
    },

    getLogoutJobStatus: async (): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/logout/status`, { headers: getHeaders() });
        return safeJson(res);
    },
    
    // Notifications
    getNotifications: async (): Promise<any[]> => {
        const res = await safeFetch(`${API_BASE}/notifications`, { headers: getHeaders() });
        if (!res.ok) return [];
        return safeJson(res);
    },
    
    respondToNotification: async (id: string, action: 'allow' | 'deny'): Promise<any> => {
        const res = await safeFetch(`${API_BASE}/notifications/${encodeURIComponent(id)}/respond`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ action })
        });
        return safeJson(res);
    }
};

