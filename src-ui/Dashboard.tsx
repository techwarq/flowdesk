import React, { useEffect, useState } from 'react';
import { api } from './api/client';
import { Account } from './types';
import { Layout } from './components/Layout';
import { AccountTable } from './components/AccountTable';
import { AddAccountModal } from './components/AddAccountModal';
import { SettingsModal } from './components/SettingsModal';
import { AdminModal } from './components/AdminModal';

// Icons for navigation
const DashboardIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
);

const UsersIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
);

const AccountsIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
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

const AllocateIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
);

const AccessIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
    </svg>
);

interface Props {
    username?: string;
    onLogout?: () => void;
}

type AdminView = 'dashboard' | 'users' | 'accounts' | 'activity' | 'settings' | 'allocation' | 'access';

export const Dashboard: React.FC<Props> = ({ username = 'Admin', onLogout }) => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [platformFilter, setPlatformFilter] = useState<'all' | 'flipkart' | 'shopsy'>('all');
    const [currentView, setCurrentView] = useState<AdminView>('dashboard');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isAdminOpen, setIsAdminOpen] = useState(false);
    const [adminUsers, setAdminUsers] = useState<any[]>([]);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getAccounts();
            setAccounts(data.accounts || []);
            // Also load users for stats
            const users = await api.getAdminUsers();
            if (Array.isArray(users)) {
                setAdminUsers(users);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const filteredAccounts = accounts.filter(a => {
        const matchesSearch = search === '' ||
            a.id.toLowerCase().includes(search.toLowerCase()) ||
            a.identifier.toLowerCase().includes(search.toLowerCase()) ||
            (a.assignedTo && a.assignedTo.toLowerCase().includes(search.toLowerCase()));
        const matchesPlatform = platformFilter === 'all' || a.platform === platformFilter;
        return matchesSearch && matchesPlatform;
    });

    const stats = {
        totalAccounts: accounts.length,
        healthyAccounts: accounts.filter(a => a.status === 'Healthy').length,
        errorAccounts: accounts.filter(a => a.status === 'Error').length,
        newAccounts: accounts.filter(a => a.status === 'New').length,
        totalUsers: adminUsers.length,
        activeUsers: adminUsers.filter((u: any) => u.role !== 'disabled').length,
        flipkartAccounts: accounts.filter(a => a.platform === 'flipkart').length,
        shopsyAccounts: accounts.filter(a => a.platform === 'shopsy').length
    };

    const handleSignOut = () => {
        api.signOut();
        if (onLogout) onLogout();
        else window.location.reload();
    };

    const navItems = [
        {
            id: 'dashboard',
            label: 'Dashboard',
            icon: <DashboardIcon />,
            onClick: () => setCurrentView('dashboard'),
            active: currentView === 'dashboard'
        },
        {
            id: 'users',
            label: 'Users',
            icon: <UsersIcon />,
            onClick: () => { setCurrentView('users'); setIsAdminOpen(true); },
            active: currentView === 'users'
        },
        {
            id: 'accounts',
            label: 'IDs / Accounts',
            icon: <AccountsIcon />,
            onClick: () => setCurrentView('accounts'),
            active: currentView === 'accounts'
        },
        {
            id: 'activity',
            label: 'Activity Logs',
            icon: <ActivityIcon />,
            onClick: () => { setCurrentView('activity'); setIsAdminOpen(true); },
            active: currentView === 'activity'
        },
        {
            id: 'allocation',
            label: 'ID Allocation',
            icon: <AllocateIcon />,
            onClick: () => { },
            disabled: true,
            badge: 'In Process'
        },
        {
            id: 'access',
            label: 'Access Control',
            icon: <AccessIcon />,
            onClick: () => { },
            disabled: true,
            badge: 'In Process'
        },
        {
            id: 'settings',
            label: 'Settings',
            icon: <SettingsIcon />,
            onClick: () => { setCurrentView('settings'); setIsSettingsOpen(true); },
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
            case 'accounts':
                return renderAccountsView();
            default:
                return renderDashboardView();
        }
    };

    const renderDashboardView = () => (
        <div className="p-6 space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Users</div>
                    <div className="text-2xl font-black text-slate-900">{stats.totalUsers}</div>
                    <div className="text-xs text-slate-500 mt-1">{stats.activeUsers} active</div>
                </div>
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">Total IDs</div>
                    <div className="text-2xl font-black text-indigo-600">{stats.totalAccounts}</div>
                    <div className="text-xs text-slate-500 mt-1">
                        {stats.flipkartAccounts} Flipkart, {stats.shopsyAccounts} Shopsy
                    </div>
                </div>
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="text-[10px] font-bold text-green-500 uppercase tracking-wider">Healthy Sessions</div>
                    <div className="text-2xl font-black text-green-600">{stats.healthyAccounts}</div>
                </div>
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Needs Attention</div>
                    <div className="text-2xl font-black text-red-600">{stats.errorAccounts}</div>
                    <div className="text-xs text-slate-500 mt-1">{stats.newAccounts} new</div>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Recent Accounts */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                        <h3 className="font-bold text-slate-900">Recent Accounts</h3>
                        <button
                            onClick={() => setCurrentView('accounts')}
                            className="text-xs text-indigo-600 font-medium hover:text-indigo-700"
                        >
                            View All →
                        </button>
                    </div>
                    <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                        {accounts.slice(0, 5).map(acc => (
                            <div key={acc.id} className="px-4 py-3 flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${acc.platform === 'flipkart'
                                            ? 'bg-yellow-100 text-yellow-700'
                                            : 'bg-green-100 text-green-700'
                                        }`}>
                                        {acc.platform.slice(0, 3)}
                                    </span>
                                    <span className="text-sm font-medium text-slate-900">{acc.identifier}</span>
                                </div>
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${acc.status === 'Healthy' ? 'bg-green-100 text-green-700' :
                                        acc.status === 'Error' ? 'bg-red-100 text-red-700' :
                                            'bg-slate-100 text-slate-600'
                                    }`}>
                                    {acc.status}
                                </span>
                            </div>
                        ))}
                        {accounts.length === 0 && (
                            <div className="px-4 py-8 text-center text-slate-400 text-sm">
                                No accounts yet
                            </div>
                        )}
                    </div>
                </div>

                {/* Warnings */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200">
                        <h3 className="font-bold text-slate-900">Warnings</h3>
                    </div>
                    <div className="p-4 space-y-3">
                        {stats.errorAccounts > 0 && (
                            <div className="flex items-start space-x-3 p-3 bg-red-50 rounded-lg">
                                <span className="text-red-500">⚠️</span>
                                <div>
                                    <p className="text-sm font-medium text-red-700">
                                        {stats.errorAccounts} account(s) with errors
                                    </p>
                                    <p className="text-xs text-red-600">Session may be expired or blocked</p>
                                </div>
                            </div>
                        )}
                        {stats.newAccounts > 0 && (
                            <div className="flex items-start space-x-3 p-3 bg-blue-50 rounded-lg">
                                <span className="text-blue-500">ℹ️</span>
                                <div>
                                    <p className="text-sm font-medium text-blue-700">
                                        {stats.newAccounts} new account(s)
                                    </p>
                                    <p className="text-xs text-blue-600">Pending first login</p>
                                </div>
                            </div>
                        )}
                        {stats.errorAccounts === 0 && stats.newAccounts === 0 && (
                            <div className="flex items-center justify-center py-6 text-slate-400 text-sm">
                                ✅ All systems operational
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Future Features */}
            <div className="bg-slate-100 rounded-xl p-6 border border-slate-200">
                <div className="flex items-center space-x-2 mb-2">
                    <span className="text-[10px] font-bold uppercase px-2 py-1 bg-amber-100 text-amber-600 rounded">
                        In Process
                    </span>
                </div>
                <h3 className="text-lg font-bold text-slate-600 mb-2">Coming Soon</h3>
                <p className="text-slate-500 text-sm">
                    Advanced features like ID allocation per user, detailed access control, admin impersonation mode, and comprehensive session monitoring will be available soon.
                </p>
            </div>
        </div>
    );

    const renderAccountsView = () => (
        <div className="p-6 space-y-6">
            {/* Filters */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between space-y-4 lg:space-y-0">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-3 sm:space-y-0 sm:space-x-4">
                    <input
                        type="text"
                        placeholder="Search accounts..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="px-4 py-2 border border-slate-300 rounded-lg text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="flex border border-slate-300 rounded-lg overflow-hidden shrink-0">
                        {['all', 'flipkart', 'shopsy'].map(p => (
                            <button
                                key={p}
                                onClick={() => setPlatformFilter(p as any)}
                                className={`flex-1 px-4 py-2 text-[11px] font-bold uppercase transition-colors ${platformFilter === p ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 text-white font-bold text-[11px] rounded uppercase hover:bg-indigo-700 transition-colors"
                    >
                        + Add Account
                    </button>
                    <button
                        onClick={load}
                        className="flex-1 sm:flex-none px-4 py-2 text-[11px] font-bold border border-slate-300 rounded hover:bg-slate-50 transition-colors uppercase"
                    >
                        Refresh All
                    </button>
                </div>
            </div>

            {/* Account Table */}
            <AccountTable accounts={filteredAccounts} onRefresh={load} />
        </div>
    );

    return (
        <>
            <Layout
                username={username}
                role="admin"
                accounts={accounts}
                navItems={navItems}
                onSelectAccount={() => { }}
                onAddAccount={() => setIsAddModalOpen(true)}
                onRefresh={load}
                onSignOut={handleSignOut}
                showAccountSelector={false}
            >
                {renderContent()}
            </Layout>

            <AddAccountModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSuccess={load}
            />

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />

            <AdminModal
                isOpen={isAdminOpen}
                onClose={() => setIsAdminOpen(false)}
            />
        </>
    );
};
