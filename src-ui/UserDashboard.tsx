import React, { useEffect, useState } from 'react';
import { api } from './api/client';
import { Account, Platform } from './types';
import { Layout } from './components/Layout';
import { AddAccountModal } from './components/AddAccountModal';

// Icons for navigation
const DashboardIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
);

const BrowseIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
    </svg>
);

const OrdersIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
);

const ActivityIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
);

const SettingsIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
);

interface Props {
    username: string;
    onLogout: () => void;
}

type ViewMode = 'dashboard' | 'browse' | 'orders' | 'activity' | 'settings';

export const UserDashboard: React.FC<Props> = ({ username, onLogout }) => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [activeAccountId, setActiveAccountId] = useState<string | undefined>();
    const [loading, setLoading] = useState(true);
    const [currentView, setCurrentView] = useState<ViewMode>('dashboard');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [browserLoading, setBrowserLoading] = useState(false);

    const loadAccounts = async () => {
        setLoading(true);
        try {
            const data = await api.getAccounts();
            setAccounts(data.accounts || []);
            // Set first account as active if none selected
            if (!activeAccountId && data.accounts?.length > 0) {
                setActiveAccountId(data.accounts[0].id);
            }
        } catch (e) {
            console.error('Failed to load accounts:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAccounts();
    }, []);

    const handleOpenBrowser = async (platform: Platform) => {
        if (!activeAccountId) {
            alert('Please select an account first');
            return;
        }
        setBrowserLoading(true);
        try {
            const res = await api.openSession(activeAccountId, platform);
            if (res?.status === 'error') {
                throw new Error(res.message);
            }
            setCurrentView('browse');
        } catch (e: any) {
            console.error(`Failed to open ${platform}:`, e);
            alert(`Failed to open ${platform}: ${e.message}`);
        } finally {
            setBrowserLoading(false);
        }
    };

    const handleRemoveAccount = async (accountId: string) => {
        if (!confirm('Remove this account?')) return;
        try {
            await api.deleteAccount(accountId);
            loadAccounts();
            if (activeAccountId === accountId) {
                setActiveAccountId(undefined);
            }
        } catch (e) {
            alert('Failed to remove account');
        }
    };

    const activeAccount = accounts.find(a => a.id === activeAccountId);

    const navItems = [
        {
            id: 'dashboard',
            label: 'Dashboard',
            icon: <DashboardIcon />,
            onClick: () => setCurrentView('dashboard'),
            active: currentView === 'dashboard'
        },
        {
            id: 'browse',
            label: 'Browse Website',
            icon: <BrowseIcon />,
            onClick: () => setCurrentView('browse'),
            active: currentView === 'browse'
        },
        {
            id: 'orders',
            label: 'Orders',
            icon: <OrdersIcon />,
            onClick: () => { },
            disabled: true,
            badge: 'In Process'
        },
        {
            id: 'activity',
            label: 'Activity',
            icon: <ActivityIcon />,
            onClick: () => { },
            disabled: true,
            badge: 'In Process'
        },
        {
            id: 'settings',
            label: 'Settings',
            icon: <SettingsIcon />,
            onClick: () => setCurrentView('settings'),
            active: currentView === 'settings'
        }
    ];

    const renderContent = () => {
        if (loading) {
            return (
                <div className="flex items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
            );
        }

        switch (currentView) {
            case 'browse':
                return renderBrowseView();
            case 'settings':
                return renderSettingsView();
            default:
                return renderDashboardView();
        }
    };

    const renderDashboardView = () => (
        <div className="p-6 space-y-6">
            {/* Welcome Card */}
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white">
                <h2 className="text-2xl font-bold mb-2">Welcome back, {username}!</h2>
                <p className="text-indigo-100">
                    Manage your Flipkart & Shopsy accounts from one place.
                </p>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Connected IDs</div>
                    <div className="text-2xl font-black text-slate-900">{accounts.length}</div>
                </div>
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="text-[10px] font-bold text-green-500 uppercase tracking-wider">Active Sessions</div>
                    <div className="text-2xl font-black text-green-600">
                        {accounts.filter(a => a.status === 'Healthy').length}
                    </div>
                </div>
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Needs Attention</div>
                    <div className="text-2xl font-black text-amber-600">
                        {accounts.filter(a => a.status === 'Error' || a.status === 'NeedsRefresh').length}
                    </div>
                </div>
            </div>

            {/* Quick Actions */}
            {activeAccount && (
                <div className="bg-white rounded-xl p-6 border border-slate-200">
                    <h3 className="text-lg font-bold text-slate-900 mb-4">Quick Actions</h3>
                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={() => handleOpenBrowser('flipkart')}
                            disabled={browserLoading}
                            className="flex items-center px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-lg hover:bg-yellow-100 transition-colors disabled:opacity-50"
                        >
                            <span className="text-yellow-600 font-bold text-sm">🛒 Open Flipkart</span>
                        </button>
                        <button
                            onClick={() => handleOpenBrowser('shopsy')}
                            disabled={browserLoading}
                            className="flex items-center px-4 py-3 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50"
                        >
                            <span className="text-green-600 font-bold text-sm">🛍️ Open Shopsy</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Future Features Placeholder */}
            <div className="bg-slate-100 rounded-xl p-6 border border-slate-200">
                <div className="flex items-center space-x-2 mb-2">
                    <span className="text-[10px] font-bold uppercase px-2 py-1 bg-amber-100 text-amber-600 rounded">
                        In Process
                    </span>
                </div>
                <h3 className="text-lg font-bold text-slate-600 mb-2">Coming Soon</h3>
                <p className="text-slate-500 text-sm">
                    User activity, orders tracking, and detailed analytics will be available here once the full app is ready.
                </p>
            </div>
        </div>
    );

    const renderBrowseView = () => {
        if (!activeAccount) {
            return (
                <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                        <p className="text-slate-500 mb-4">No account selected</p>
                        <button
                            onClick={() => setIsAddModalOpen(true)}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                        >
                            Add Account
                        </button>
                    </div>
                </div>
            );
        }

        return (
            <div className="p-6 space-y-4">
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900">Browse with {activeAccount.identifier}</h3>
                            <p className="text-sm text-slate-500">Opens in a separate browser window with your saved session</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={() => handleOpenBrowser('flipkart')}
                            disabled={browserLoading}
                            className="flex-1 min-w-[150px] flex items-center justify-center px-6 py-4 bg-yellow-500 text-white rounded-xl hover:bg-yellow-600 transition-colors disabled:opacity-50 font-bold"
                        >
                            {browserLoading ? 'Opening...' : '🛒 Open Flipkart'}
                        </button>
                        <button
                            onClick={() => handleOpenBrowser('shopsy')}
                            disabled={browserLoading}
                            className="flex-1 min-w-[150px] flex items-center justify-center px-6 py-4 bg-green-500 text-white rounded-xl hover:bg-green-600 transition-colors disabled:opacity-50 font-bold"
                        >
                            {browserLoading ? 'Opening...' : '🛍️ Open Shopsy'}
                        </button>
                    </div>
                </div>

                {/* Info Card */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <p className="text-sm text-blue-700">
                        <strong>💡 Tip:</strong> Your session is automatically saved. No need to login again!
                    </p>
                </div>
            </div>
        );
    };

    const renderSettingsView = () => (
        <div className="p-6">
            <div className="bg-white rounded-xl p-6 border border-slate-200">
                <h3 className="text-lg font-bold text-slate-900 mb-4">User Settings</h3>
                <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-slate-100">
                        <div>
                            <p className="font-medium text-slate-900">Username</p>
                            <p className="text-sm text-slate-500">{username}</p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-slate-100">
                        <div>
                            <p className="font-medium text-slate-900">Connected Accounts</p>
                            <p className="text-sm text-slate-500">{accounts.length} account(s)</p>
                        </div>
                    </div>
                    <div className="pt-2">
                        <span className="text-[10px] font-bold uppercase px-2 py-1 bg-amber-100 text-amber-600 rounded">
                            In Process
                        </span>
                        <p className="text-sm text-slate-500 mt-2">
                            More settings options coming soon...
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <>
            <Layout
                username={username}
                role="user"
                accounts={accounts}
                activeAccountId={activeAccountId}
                navItems={navItems}
                onSelectAccount={setActiveAccountId}
                onRemoveAccount={handleRemoveAccount}
                onAddAccount={() => setIsAddModalOpen(true)}
                onRefresh={loadAccounts}
                onSignOut={() => { api.signOut(); onLogout(); }}
                showAccountSelector={true}
            >
                {renderContent()}
            </Layout>

            <AddAccountModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSuccess={loadAccounts}
            />
        </>
    );
};
