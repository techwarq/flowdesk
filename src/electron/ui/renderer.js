// --- Elements & Helpers ---
const $ = (id) => document.getElementById(id);

const toastContainer = $('toast-container');
const loginScreen = $('login-screen');
const dashboard = $('dashboard');
const adminPanel = $('admin-panel');
const loginForm = $('login-form');
const logoutBtn = $('logout-btn');
const loginError = $('login-error');
const userInfo = $('user-info');
const adminPanelBtn = $('admin-panel-btn');
const closeAdminBtn = $('close-admin-btn');

const accountsTableBody = $('accounts-table-body');
const totalCountEl = $('total-count');
const healthyCountEl = $('healthy-count');
const actionCountEl = $('action-count');
const addModal = $('add-account-modal');
const addBtn = $('add-account-btn');
const cancelAddBtn = $('cancel-add-btn');
const addForm = $('add-account-form');
const refreshAllBtn = $('refresh-all-btn');
const searchBox = $('search-box');
const platformTabs = $('platform-tabs');

const browserContainer = $('browser-container');
const browserBackBtn = $('browser-back-btn');
const browserReloadBtn = $('browser-reload-btn');
const browserAutoOtpBtn = $('auto-otp-btn');
const browserTitleBar = $('browser-title-bar');
const webviewWrapper = $('webview-wrapper');

const settingsBtn = $('settings-btn');
const settingsModal = $('settings-modal');
const settingsForm = $('settings-form');
const closeSettingsBtn = $('close-settings-btn');
const terminateBrowsersBtn = $('terminate-browsers-btn');

const usersTableBody = $('users-table-body');
const createUserForm = $('create-user-form');
const manualSyncBtn = $('manual-sync-btn');

// --- state ---
let currentUser = null;
let allAccounts = [];
let activePlatformFilter = 'all';
let currentBrowserId = null;
let currentBrowserPlatform = null;

// --- Global Error Handler ---
window.onerror = (message, source, lineno, colno, error) => {
    showToast(`App Error: ${message}`, 'error');
    console.error(error);
    window.api.reportError(message, error?.stack, { source, lineno, colno });
};

// --- Toast System ---
function showToast(message, type = 'primary') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- Initialization ---
function hideAll() {
    loginScreen.classList.add('hidden');
    dashboard.classList.add('hidden');
    browserContainer.classList.add('hidden');
    adminPanel.classList.add('hidden');
    settingsModal.classList.add('hidden');
    addModal.classList.add('hidden');
}

async function init() {
    hideAll();
    try {
        currentUser = await window.api.getSession();
        if (currentUser) showDashboard();
        else showLogin();
    } catch (e) {
        console.error("Init error", e);
        showLogin();
    }
}

function showLogin() {
    loginScreen.classList.remove('hidden');
    dashboard.classList.add('hidden');
}

function showDashboard() {
    loginScreen.classList.add('hidden');
    dashboard.classList.remove('hidden');
    userInfo.textContent = `Hi, ${currentUser.username}`;

    if (currentUser.role !== 'admin') {
        addBtn.classList.add('hidden');
        settingsBtn.classList.add('hidden');
        adminPanelBtn.classList.add('hidden');
    } else {
        addBtn.classList.remove('hidden');
        settingsBtn.classList.remove('hidden');
    }

    // Triple click for admin panel
    let clicks = 0;
    userInfo.onclick = () => {
        clicks++;
        if (clicks === 5 && currentUser.role === 'admin') {
            adminPanelBtn.classList.remove('hidden');
            showToast('Admin Panel Enabled', 'success');
            clicks = 0;
        }
    };

    loadAccounts();
}

// --- Auth ---
loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(loginForm).entries());
    try {
        const res = await window.api.login(data);
        if (res.success) {
            currentUser = res.session;
            showDashboard();
            showToast(`Welcome back, ${currentUser.username}!`, 'success');
        } else {
            loginError.textContent = res.message || 'Login failed';
        }
    } catch (err) { loginError.textContent = 'Error: ' + err; }
};

logoutBtn.onclick = async () => {
    await window.api.logout();
    currentUser = null;
    showLogin();
};

// --- Dashboard Logic ---
async function loadAccounts() {
    try {
        allAccounts = await window.api.getAccounts();
        applyFilters();
        updateStats();
    } catch (err) { showToast('Failed to load accounts', 'error'); }
}

function updateStats() {
    totalCountEl.textContent = allAccounts.length;
    healthyCountEl.textContent = allAccounts.filter(a => a.status === 'Healthy' || a.status === 'Working').length;
    actionCountEl.textContent = allAccounts.filter(a => a.status !== 'Healthy' && a.status !== 'Working' && a.status !== 'New').length;
}

function applyFilters() {
    const query = searchBox.value.toLowerCase();
    const filtered = allAccounts.filter(acc => {
        const matchPlatform = activePlatformFilter === 'all' || acc.platform === activePlatformFilter;
        const matchSearch = String(acc.id).toLowerCase().includes(query) ||
            String(acc.identifier).toLowerCase().includes(query) ||
            (acc.displayName && acc.displayName.toLowerCase().includes(query));
        return matchPlatform && matchSearch;
    });
    renderTable(filtered);
}

function renderTable(accounts) {
    accountsTableBody.innerHTML = '';
    if (accounts.length === 0) {
        accountsTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-muted)">No accounts match your criteria.</td></tr>';
        return;
    }

    accounts.forEach(acc => {
        const tr = document.createElement('tr');
        const isHealthy = acc.status === 'Healthy' || acc.status === 'Working';
        const displayStatus = isHealthy ? 'WORKING' : acc.status.toUpperCase();
        const statusClass = isHealthy ? 'Working' : acc.status.replace(' ', '');
        const tooltip = acc.errorCode ? `Reason: ${acc.errorCode}` : (isHealthy ? 'Session is valid' : 'Attention needed');

        tr.innerHTML = `
            <td><span class="platform-badge">${acc.platform}</span></td>
            <td style="font-weight:600">${acc.id}</td>
            <td>${acc.displayName || '<span style="color:var(--text-muted)">-</span>'}</td>
            <td>${acc.identifier}</td>
            <td><span class="status-badge status-${statusClass}" title="${tooltip}">${displayStatus}</span></td>
            <td style="font-size:12px; color:var(--text-muted)">${formatRelativeTime(acc.lastValidateAt || acc.lastLoginAt)}</td>
            <td style="text-align:right; white-space:nowrap;">
                <button class="btn secondary-btn" onclick="openAccount('${acc.id}', 'flipkart')" style="padding:6px 12px; margin-right:4px;">Flipkart</button>
                <button class="btn primary-btn" style="padding:6px 12px; margin-right:4px;" onclick="openAccount('${acc.id}', 'shopsy')">Shopsy</button>
                <button class="btn secondary-btn" onclick="checkHealth('${acc.id}')" style="padding:6px 12px; margin-right:4px;">REFRESH</button>
                <button class="btn secondary-btn" onclick="deleteAccount('${acc.id}')" style="padding:6px 12px; border-color:#e0e0e0; color:#999;">✕</button>
            </td>
        `;
        accountsTableBody.appendChild(tr);
    });
}

function formatRelativeTime(dateStr) {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
}

searchBox.oninput = applyFilters;

[...platformTabs.children].forEach(tab => {
    tab.onclick = () => {
        [...platformTabs.children].forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activePlatformFilter = tab.dataset.platform;
        applyFilters();
    };
});

refreshAllBtn.onclick = async () => {
    refreshAllBtn.disabled = true;
    const oldText = refreshAllBtn.textContent;
    refreshAllBtn.textContent = 'Checking...';
    try {
        await window.api.checkAllHealth();
        showToast('Health check completed', 'success');
        await loadAccounts();
    } catch (e) { showToast('Check failed', 'error'); }
    refreshAllBtn.disabled = false;
    refreshAllBtn.textContent = oldText;
};

window.api.onCheckAllProgress((data) => {
    refreshAllBtn.textContent = `Checking ${data.current}/${data.total}...`;
});

// --- Browser Logic ---
window.openAccount = async (rawId, platform) => {
    const id = rawId.toLowerCase().trim();
    // 1. Initial UI Setup
    browserTitleBar.textContent = `Preparing ${platform.toUpperCase()} session...`;
    dashboard.classList.add('hidden');
    browserContainer.classList.remove('hidden');
    webviewWrapper.innerHTML = `
        <div class="fatal-error-container">
            <p style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:var(--text-muted)">
                Initializing Secure Session Component...
            </p>
        </div>
    `;

    try {
        // 2. Prepare Session (Background Login / Cookie Sync)
        await window.api.prepareBrowserSession({ accountId: id, platform });
        await window.api.logActivity('OPEN_BROWSER', { accountId: id, platform });

        // 3. Success: Create and Configure Webview
        webviewWrapper.innerHTML = '';
        const webview = document.createElement('webview');
        webview.id = 'active-webview';
        webview.setAttribute('partition', `persist:${id}`);
        webview.setAttribute('useragent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        webview.setAttribute('allowpopups', 'true');
        webview.style.width = '100%';
        webview.style.height = '100%';

        // Final UI feedback
        browserTitleBar.textContent = `Loading ${platform.toUpperCase()}: ${id}...`;
        webview.src = platform === 'shopsy' ? 'https://www.shopsy.in/' : 'https://www.flipkart.com/';

        const account = await window.api.getAccount(id);

        webview.addEventListener('dom-ready', () => {
            browserTitleBar.textContent = `${platform.toUpperCase()}: ${id}`;

            // Show/Hide OTP button based on URL
            const url = webview.getURL().toLowerCase();
            const isLoginUrl = url.includes('login') || url.includes('otp') || url.includes('authenticate');
            if (isLoginUrl) browserAutoOtpBtn.classList.remove('hidden');
            else browserAutoOtpBtn.classList.add('hidden');

            // 1. Auto-Fill Phone if we are on login screen
            if (account && account.identifier) {
                webview.executeJavaScript(`
                    (function() {
                        const input = document.querySelector('input[type="text"]') || document.querySelector('input[type="tel"]');
                        if (input && !input.value) {
                            input.value = '${account.identifier}';
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            // Try to find and click the 'Continue' or 'Request OTP' button
                            const btn = Array.from(document.querySelectorAll('button')).find(b => 
                                b.innerText.includes('CONTINUE') || b.innerText.includes('Request OTP')
                            );
                            if (btn) btn.click();
                        }
                    })()
                `);
            }

            // 2. Detect Success and Sync
            if (platform === 'flipkart') {
                webview.executeJavaScript(`
                    (function() {
                        const profileEl = document.querySelector('._28p97w') || document.querySelector('.ExFOUT') || 
                                          Array.from(document.querySelectorAll('div')).find(d => d.innerText.includes('My Profile'));
                        return profileEl ? profileEl.innerText : null;
                    })()
                `).then(async (name) => {
                    if (name) {
                        window.api.updateAccount({ id, displayName: name });
                        showToast(`Login Verified for ${id}`, 'success');

                        // Automatically save session and switch to Shopsy if this is a fresh setup
                        await window.api.saveBrowserSession({ accountId: id, platform: 'flipkart' });

                        // Small delay before transition
                        setTimeout(() => {
                            if (currentBrowserPlatform === 'flipkart') {
                                showToast('Syncing to Shopsy...', 'info');
                                openAccount(id, 'shopsy');
                            }
                        }, 2000);
                    }
                });
            } else if (platform === 'shopsy') {
                webview.executeJavaScript(`
                    (function() {
                        return document.body.innerText.includes('My Orders') || document.body.innerText.includes('Account');
                    })()
                `).then(success => {
                    if (success) showToast(`Shopsy Sync Complete! ${id} is ready.`, 'success');
                });
            }
        });

        webviewWrapper.appendChild(webview);
        currentBrowserId = id;
        currentBrowserPlatform = platform;

    } catch (e) {
        // 4. Error State: Show clear technical feedback
        browserTitleBar.textContent = `ERROR: ${platform.toUpperCase()} INITIALIZATION FAILED`;
        webviewWrapper.innerHTML = `
            <div class="fatal-error-container">
                <div class="fatal-error-card">
                    <h1>Session Initialization Failed</h1>
                    <p>There was a problem preparing the background session for <b>${id}</b>. This usually happens if the account needs manual re-login or the OTP fetcher timed out.</p>
                    <span class="error-code">REASON: ${e.message || 'Unknown technical error'}</span>
                    <button class="btn primary-btn" onclick="openAccount('${id}', '${platform}')">Try Again</button>
                    <button class="btn secondary-btn" onclick="browserBackBtn.onclick()">Back to Dashboard</button>
                </div>
            </div>
        `;
        showToast('Session Preparation Failed', 'error');
    }
};

browserBackBtn.onclick = async () => {
    if (currentBrowserId) {
        await window.api.saveBrowserSession({ accountId: currentBrowserId, platform: currentBrowserPlatform });
        // Run a quick health check and refresh the list
        try {
            await window.api.checkHealth(currentBrowserId);
        } catch (e) { /* ignore */ }
    }
    webviewWrapper.innerHTML = '';
    browserContainer.classList.add('hidden');
    await loadAccounts(); // Refresh the account list immediately
    showDashboard();
};

browserReloadBtn.onclick = () => {
    const wv = $('active-webview');
    if (wv) wv.reload();
};

browserAutoOtpBtn.onclick = async () => {
    browserAutoOtpBtn.textContent = 'Fetching...';
    try {
        const otp = await window.api.fetchMasterOtp();
        if (otp) {
            browserAutoOtpBtn.textContent = `OTP: ${otp}`;
            const wv = $('active-webview');
            if (wv) {
                wv.executeJavaScript(`
                    (function() {
                        const inputs = document.querySelectorAll('input');
                        let filled = false;
                        inputs.forEach(i => {
                            if (i.maxLength === 6 && !i.value) { i.value = '${otp}'; i.dispatchEvent(new Event('input', { bubbles: true })); filled = true; }
                        });
                        return filled;
                    })()
                `).then(filled => {
                    if (!filled) showToast(`OTP Found: ${otp}`, 'primary');
                    else showToast('OTP Auto-Filled!', 'success');
                });
            }
        } else showToast('No OTP found in email', 'warning');
    } catch (e) { showToast('OTP Fetch Error', 'error'); }
    setTimeout(() => browserAutoOtpBtn.textContent = '✨ Auto-Fill OTP', 5000);
};

// --- Actions ---
window.checkHealth = async (id) => {
    showToast(`Refreshing ${id}...`, 'info');
    try {
        await window.api.checkHealth(id);
        await window.api.logActivity('CHECK_HEALTH', { accountId: id });
        await loadAccounts();
        showToast(`Status updated for ${id}`, 'success');
    } catch (e) { showToast('Health check failed', 'error'); }
};

window.deleteAccount = async (id) => {
    if (!confirm(`Are you sure you want to remove account: ${id}?`)) return;
    try {
        const success = await window.api.deleteAccount(id);
        if (success) {
            showToast(`Account ${id} removed`, 'success');
            await loadAccounts();
        } else {
            showToast('Failed to remove account', 'error');
        }
    } catch (e) { showToast(e.message, 'error'); }
};

// --- Modals ---
addBtn.onclick = () => addModal.classList.remove('hidden');
cancelAddBtn.onclick = () => addModal.classList.add('hidden');
addForm.onsubmit = async (e) => {
    e.preventDefault();
    const raw = Object.fromEntries(new FormData(addForm).entries());
    const data = {
        ...raw,
        accountId: raw.accountId.toLowerCase().trim(),
        identifier: raw.identifier.trim()
    };
    try {
        showToast('Adding Account...', 'info');
        await window.api.addAccount(data);
        addModal.classList.add('hidden');
        addForm.reset();

        showToast('Initial Setup Complete. Opening Flipkart for Login...', 'success');

        // Automatically trigger Flipkart login first
        setTimeout(async () => {
            try {
                await openAccount(data.accountId, 'flipkart');
            } catch (e) {
                showToast('Failed to initiate login.', 'error');
            }
        }, 1000);

    } catch (e) { showToast(e.message, 'error'); }
};

settingsBtn.onclick = async () => {
    const s = await window.api.getSettings();
    if (s.masterEmail) {
        settingsForm.masterUser.value = s.masterEmail.user || '';
        settingsForm.masterHost.value = s.masterEmail.host || 'imap.gmail.com';
    }
    if (s.cloudConfig) {
        settingsForm.cloudEnabled.checked = s.cloudConfig.enabled || false;
        settingsForm.cloudUrl.value = s.cloudConfig.url || '';
        settingsForm.cloudKey.value = s.cloudConfig.key || '';
    }
    settingsModal.classList.remove('hidden');
};
closeSettingsBtn.onclick = () => settingsModal.classList.add('hidden');
settingsForm.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(settingsForm).entries());
    const s = {
        masterEmail: { user: data.masterUser, passEncrypted: btoa(data.masterPass), host: data.masterHost },
        cloudConfig: {
            enabled: settingsForm.cloudEnabled.checked,
            url: data.cloudUrl,
            key: data.cloudKey
        }
    };
    await window.api.saveSettings(s);
    settingsModal.classList.add('hidden');
    showToast('Settings Saved', 'success');
};

manualSyncBtn.onclick = async () => {
    manualSyncBtn.disabled = true;
    manualSyncBtn.textContent = '☁️ Pulling Data...';
    try {
        const res = await window.api.cloudSyncPull();
        if (res.success) {
            showToast('Cloud Sync Successful! Restored all accounts.', 'success');
            await loadAccounts();
        } else {
            showToast(`Sync Failed: ${res.error}`, 'error');
        }
    } catch (e) { showToast('Cloud Sync Error', 'error'); }
    manualSyncBtn.disabled = false;
    manualSyncBtn.textContent = '☁️ Pull All Data from Cloud';
};

// --- Admin Portal Logic ---
const adminTabBtns = document.querySelectorAll('.admin-tab-btn');
const adminSections = document.querySelectorAll('.admin-modal-section');
const activityFeedContainer = $('activity-feed-container');
const refreshFeedBtn = $('refresh-feed-btn');

adminTabBtns.forEach(btn => {
    btn.onclick = () => {
        adminTabBtns.forEach(b => b.classList.remove('active'));
        adminSections.forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        $(btn.dataset.target).classList.add('active');
        if (btn.dataset.target === 'admin-feed-sec') refreshAdminFeed();
    };
});

async function refreshAdminFeed() {
    activityFeedContainer.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px;">Fetching logs...</div>';
    try {
        const [logs, errors] = await Promise.all([
            window.api.getActivityLogs(),
            window.api.getAppErrors()
        ]);

        const allEvents = [
            ...logs.map(l => ({ ...l, type: 'activity' })),
            ...errors.map(e => ({ ...e, type: 'error', action: `ERROR: ${e.message}` }))
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (allEvents.length === 0) {
            activityFeedContainer.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px;">No recent activity found.</div>';
            return;
        }

        activityFeedContainer.innerHTML = allEvents.map(ev => `
            <div class="feed-item ${ev.type === 'error' ? 'error' : ''}">
                <div class="feed-timestamp">${new Date(ev.timestamp).toLocaleString()}</div>
                <div class="feed-user">${ev.username.toUpperCase()}</div>
                <div class="feed-action">
                    ${ev.action}
                    ${ev.platform ? ` <span class="platform-badge" style="font-size:9px">${ev.platform}</span>` : ''}
                    ${ev.account_id ? ` <span style="color:var(--text-muted); font-size:10px">[ID: ${ev.account_id}]</span>` : ''}
                </div>
            </div>
        `).join('');
    } catch (e) {
        activityFeedContainer.innerHTML = `<div style="color:var(--vibrant-error); text-align:center; padding:20px;">Failed to fetch feed: ${e.message}</div>`;
    }
}

if (refreshFeedBtn) refreshFeedBtn.onclick = refreshAdminFeed;

adminPanelBtn.onclick = async () => {
    adminPanel.classList.remove('hidden');
    loadAdminUsers();
};

async function loadAdminUsers() {
    try {
        const users = await window.api.getCloudUsers() || await window.api.adminGetUsers();
        usersTableBody.innerHTML = users.map(u => `
            <tr>
                <td>${u.username}</td>
                <td><span class="platform-badge" style="background:#eee">${u.role}</span></td>
                <td>${u.allowedAccounts || u.id_limit || 5}</td>
                <td style="text-align:right">
                    <button class="btn secondary-btn" onclick="deleteUser('${u.username}')" style="padding:4px 8px; color:var(--vibrant-error)">✕</button>
                </td>
            </tr>
        `).join('');
    } catch (e) { showToast('Failed to load users', 'error'); }
}

window.deleteUser = async (username) => {
    if (!confirm(`Delete user ${username}?`)) return;
    try {
        await window.api.deleteCloudUser(username);
        showToast('User Deleted', 'success');
        loadAdminUsers();
    } catch (e) { showToast('Delete failed', 'error'); }
};

closeAdminBtn.onclick = () => adminPanel.classList.add('hidden');

createUserForm.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(createUserForm).entries());
    data.allowedAccounts = parseInt(data.allowedAccounts);
    try {
        await window.api.upsertCloudUser(data);
        showToast('User Added to Cloud', 'success');
        createUserForm.reset();
        loadAdminUsers();
    } catch (e) {
        // Fallback or local
        try {
            await window.api.adminCreateUser(data);
            showToast('User Added Locally', 'success');
            loadAdminUsers();
        } catch (e2) { showToast('Failed to create user', 'error'); }
    }
};

window.api.onUpdateStatus((data) => {
    showToast(`App Update: ${data}`, 'info');
});

// --- Background Refresh ---
async function startBackgroundHealthCheck() {
    // Only check if we are on the dashboard and not in the browser
    setInterval(async () => {
        if (!dashboard.classList.contains('hidden') && allAccounts.length > 0) {
            const stale = allAccounts.filter(a => {
                if (!a.lastValidateAt) return true;
                const hours = (Date.now() - new Date(a.lastValidateAt).getTime()) / (1000 * 3600);
                return hours > 2; // Check every 2 hours
            }).slice(0, 3); // Do max 3 at a time to avoid heavy load

            for (const acc of stale) {
                try {
                    await window.api.checkHealth(acc.id);
                } catch (e) { console.error(`Background check failed for ${acc.id}`, e); }
            }
            if (stale.length > 0) await loadAccounts();
        }
    }, 300000); // Check every 5 minutes
}

init().then(() => {
    startBackgroundHealthCheck();
});

terminateBrowsersBtn.onclick = async () => {
    terminateBrowsersBtn.disabled = true;
    terminateBrowsersBtn.textContent = '🛑 Killing...';
    try {
        await window.api.terminateAllBrowsers();
        showToast('All browser processes terminated.', 'success');
    } catch (e) { showToast('Cleanup failed', 'error'); }
    terminateBrowsersBtn.disabled = false;
    terminateBrowsersBtn.textContent = '🛑 Kill All';
};
