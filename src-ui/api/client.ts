import { Account, Platform } from '../types';

const API_BASE = 'http://localhost:3001/api';

const getHeaders = () => {
    const headers: any = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('flowdesk_token');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
};

export const api = {
    // Auth
    signUp: async (username: string, password: string): Promise<any> => {
        const res = await fetch(`${API_BASE}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        return res.json();
    },

    signIn: async (username: string, password: string): Promise<any> => {
        const res = await fetch(`${API_BASE}/auth/signin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success && data.session?.access_token) {
            localStorage.setItem('flowdesk_token', data.session.access_token);
        }
        return data;
    },

    getMe: async (): Promise<any> => {
        const token = localStorage.getItem('flowdesk_token');
        if (!token) return { success: false, message: 'No token' };

        const res = await fetch(`${API_BASE}/auth/me`, {
            headers: getHeaders()
        });
        if (!res.ok) {
            localStorage.removeItem('flowdesk_token');
            throw new Error('Not authenticated');
        }
        return res.json();
    },

    signOut: () => {
        localStorage.removeItem('flowdesk_token');
    },

    getAccounts: async (): Promise<{ accounts: Account[] }> => {
        const res = await fetch(`${API_BASE}/accounts`, { headers: getHeaders() });
        if (!res.ok) throw new Error('Failed to fetch accounts');
        return res.json();
    },

    checkHealth: async (id: string): Promise<any> => {
        const res = await fetch(`${API_BASE}/check/${encodeURIComponent(id)}`, {
            method: 'POST',
            headers: getHeaders()
        });
        return res.json();
    },

    refreshSession: async (id: string): Promise<any> => {
        const res = await fetch(`${API_BASE}/refresh/${encodeURIComponent(id)}`, {
            method: 'POST',
            headers: getHeaders()
        });
        return res.json();
    },

    login: async (accountId: string, identifier: string, platform: Platform): Promise<any> => {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ accountId, identifier, platform })
        });
        return res.json();
    },

    openSession: async (accountId: string, platform: Platform): Promise<any> => {
        const res = await fetch(`${API_BASE}/session`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ accountId, platform })
        });
        return res.json();
    },

    addAccount: async (data: any): Promise<any> => {
        const res = await fetch(`${API_BASE}/accounts`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(data)
        });
        return res.json();
    },

    deleteAccount: async (id: string): Promise<any> => {
        const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        return res.json();
    },

    getSettings: async (): Promise<any> => {
        const res = await fetch(`${API_BASE}/settings`, { headers: getHeaders() });
        if (!res.ok) return {};
        return res.json();
    },

    saveSettings: async (settings: any): Promise<any> => {
        const res = await fetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(settings)
        });
        return res.json();
    },

    terminateBrowsers: async (): Promise<any> => {
        const res = await fetch(`${API_BASE}/terminate-all`, {
            method: 'POST',
            headers: getHeaders()
        });
        return res.json();
    },

    getActivityLogs: async (): Promise<any[]> => {
        const res = await fetch(`${API_BASE}/logs/activity`, { headers: getHeaders() });
        if (!res.ok) return [];
        return res.json();
    },

    getAppErrors: async (): Promise<any[]> => {
        const res = await fetch(`${API_BASE}/logs/errors`, { headers: getHeaders() });
        if (!res.ok) return [];
        return res.json();
    },

    getAdminUsers: async (): Promise<any[]> => {
        const res = await fetch(`${API_BASE}/admin/users`, { headers: getHeaders() });
        if (!res.ok) return [];
        return res.json();
    },

    upsertAdminUser: async (user: any): Promise<any> => {
        const res = await fetch(`${API_BASE}/admin/users`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(user)
        });
        return res.json();
    },

    deleteAdminUser: async (username: string): Promise<any> => {
        const res = await fetch(`${API_BASE}/admin/users/${username}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        return res.json();
    },

    cloudSyncPull: async (): Promise<any> => {
        const res = await fetch(`${API_BASE}/cloud/sync`, {
            method: 'POST',
            headers: getHeaders()
        });
        return res.json();
    },

    getCookies: async (id: string, platform: Platform): Promise<any[]> => {
        const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/${platform}/cookies`, {
            headers: getHeaders()
        });
        if (!res.ok) return [];
        return res.json();
    }
};
