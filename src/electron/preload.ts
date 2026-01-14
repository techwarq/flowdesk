import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    // Auth
    login: (creds: any) => ipcRenderer.invoke('auth-login', creds),
    logout: () => ipcRenderer.invoke('auth-logout'),
    getSession: () => ipcRenderer.invoke('auth-get-session'),

    // Admin
    adminGetUsers: () => ipcRenderer.invoke('admin-get-users'),
    adminCreateUser: (user: any) => ipcRenderer.invoke('admin-create-user', user),

    // Automation
    prepareBrowserSession: (data: any) => ipcRenderer.invoke('prepare-browser-session', data),
    saveBrowserSession: (data: any) => ipcRenderer.invoke('save-browser-session', data),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (s: any) => ipcRenderer.invoke('save-settings', s),
    fetchMasterOtp: () => ipcRenderer.invoke('fetch-master-otp'),

    getAccounts: () => ipcRenderer.invoke('get-accounts'),
    addAccount: (data: any) => ipcRenderer.invoke('add-account', data),
    updateAccount: (data: any) => ipcRenderer.invoke('update-account', data),
    openAccount: (id: string) => ipcRenderer.invoke('open-account', id),
    checkHealth: (id: string) => ipcRenderer.invoke('check-health', id),
    checkAllHealth: () => ipcRenderer.invoke('check-all-health'),
    onCheckAllProgress: (callback: any) => ipcRenderer.on('check-all-progress', (event, data) => callback(data)),
    onUpdateStatus: (callback: any) => ipcRenderer.on('update-status', (event, data) => callback(data)),
    terminateAllBrowsers: () => ipcRenderer.invoke('terminate-all-browsers'),
    refreshSession: (id: string) => ipcRenderer.invoke('refresh-session', id),
    exportProfile: (id: string) => ipcRenderer.invoke('export-profile', id),
    deleteAccount: (id: string) => ipcRenderer.invoke('delete-account', id),
    getAccount: (id: string) => ipcRenderer.invoke('get-account', id),
    cloudSyncPull: () => ipcRenderer.invoke('cloud-sync-pull'),
    logActivity: (action: string, data?: any) => ipcRenderer.invoke('log-activity', { action, data }),
    reportError: (message: string, stack?: string, context?: any) => ipcRenderer.invoke('report-error', { message, stack, context }),
    getCloudUsers: () => ipcRenderer.invoke('get-cloud-users'),
    upsertCloudUser: (user: any) => ipcRenderer.invoke('upsert-cloud-user', user),
    deleteCloudUser: (username: string) => ipcRenderer.invoke('delete-cloud-user', username),
    getActivityLogs: () => ipcRenderer.invoke('get-activity-logs'),
    getAppErrors: () => ipcRenderer.invoke('get-app-errors'),
});
