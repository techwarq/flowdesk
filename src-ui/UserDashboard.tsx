import React, { useEffect, useState, useMemo } from 'react';
import { useDataFetcher } from './hooks/useDataFetcher';
import { api } from './api/client';
import { Account, Platform } from './types';
import { Layout } from './components/Layout';
import { AddAccountModal } from './components/AddAccountModal';
import {
    Activity,
    AlertTriangle,
    Bell,
    CheckCircle2,
    ChevronDown,
    Globe,
    Info,
    LayoutDashboard,
    Monitor,
    Search,
    Settings,
    ShoppingBag,
    Trash2
} from 'lucide-react';
import { Support } from './pages/Support';
import {
    FlipkartIcon, ShopsyIcon,
    PlatformIcon
} from './components/Icons';
import { Orders } from './pages/Orders';
import { Wallet } from './pages/Wallet';
import { InAppBrowser } from './components/InAppBrowser';
import { ChatWidget } from './components/ChatWidget';
import { BulkUrlOpener, BulkOpenConfig } from './components/BulkUrlOpener';

import { Layers } from 'lucide-react';

interface Props {
    username: string;
    onLogout: () => void;
    isAdmin?: boolean;
    onSwitchToAdmin?: () => void;
}

type ViewMode = 'dashboard' | 'browse' | 'id_portal' | 'orders' | 'wallet' | 'settings' | 'browser_1' | 'browser_2' | 'notifications' | 'support';

export const UserDashboard: React.FC<Props> = ({ username, onLogout, isAdmin: _isAdmin, onSwitchToAdmin }) => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [activeAccountId, setActiveAccountId] = useState<string | undefined>();
    const [loading, setLoading] = useState(true);
    const [currentView, setCurrentView] = useState<ViewMode>('dashboard');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedAvatar, setSelectedAvatar] = useState<string>('Default');
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [isBulkOpenerOpen, setIsBulkOpenerOpen] = useState(false);
    const [bulkOpenConfig, setBulkOpenConfig] = useState<BulkOpenConfig | null>(null);
    const [logoutAccountIds, setLogoutAccountIds] = useState<Set<string>>(new Set());
    const [logoutSearch, setLogoutSearch] = useState('');
    const [isBulkPasteOpen, setIsBulkPasteOpen] = useState(false);
    const [bulkPasteInput, setBulkPasteInput] = useState('');

    const [notifications, setNotifications] = useState<any[]>([]);
    const [isResponding, setIsResponding] = useState<string | null>(null);

    // Async data fetcher for orders and GV balance
    const {
        ordersData,
        gvData,
        orderStates,
        gvStates,
        isOrdersFetching,
        isGVFetching,
        currentOrderAccountId,
        currentGVAccountId,
        triggerOrdersFetch,
        triggerGVFetch
    } = useDataFetcher();

    const AVATARS = [
        { id: 'Default', icon: <div className="w-full h-full bg-brand-primary text-white flex items-center justify-center font-bold text-3xl">{username.charAt(0).toUpperCase()}</div> },
        { id: 'Robot', icon: <div className="w-full h-full bg-slate-900 text-white flex items-center justify-center"><Monitor size={32} /></div> },
        { id: 'Smile', icon: <div className="w-full h-full bg-yellow-400 text-black flex items-center justify-center"><div className="text-3xl font-bold">☺</div></div> },
        { id: 'Ghost', icon: <div className="w-full h-full bg-purple-600 text-white flex items-center justify-center"><div className="text-3xl font-bold">👻</div></div> },
        { id: 'Ninja', icon: <div className="w-full h-full bg-red-600 text-white flex items-center justify-center"><div className="text-3xl font-bold">🐱</div></div> },
    ];

    // Enriched accounts with fetched orders and GV data
    const enrichedAccounts = useMemo(() => {
        return accounts.map(acc => ({
            ...acc,
            orders: ordersData[acc.id] || acc.orders || [],
            details: {
                ...acc.details,
                gvBalance: gvData[acc.id] || acc.details?.gvBalance
            }
        }));
    }, [accounts, ordersData, gvData]);

    const platformCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        accounts.forEach(a => {
            counts[a.platform] = (counts[a.platform] || 0) + 1;
        });
        return counts;
    }, [accounts]);

    const totalAccounts = accounts.length;

    const platformSplit = useMemo(() => {
        if (totalAccounts === 0) return [];
        return Object.entries(platformCounts).map(([platform, count]) => ({
            platform,
            count,
            percentage: (count / totalAccounts) * 100
        })).sort((a, b) => b.count - a.count);
    }, [platformCounts, totalAccounts]);

    const filteredAccounts = accounts.filter(acc =>
        acc.identifier.toLowerCase().includes(searchQuery.toLowerCase()) ||
        acc.platform.toLowerCase().includes(searchQuery.toLowerCase())
    );

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

    const loadNotifications = async () => {
        try {
            const data = await api.getNotifications();
            setNotifications(data || []);
        } catch (e) {
            console.error('Failed to load notifications:', e);
        }
    };

    useEffect(() => {
        loadAccounts();
        loadNotifications();

        // Refresh notifications every minute
        const interval = setInterval(loadNotifications, 60000);
        return () => clearInterval(interval);
    }, []);

    // Ref to prevent re-triggering fetch on HMR or re-renders
    // const hasFetchedRef = useRef(false);

    // Trigger data fetching when accounts are loaded (only once per session)
    // COMMENTED OUT: Auto-fetch on login disabled - use buttons on Orders/Wallet pages instead
    // useEffect(() => {
    //     if (accounts.length > 0 && !loading && !hasFetchedRef.current) {
    //         hasFetchedRef.current = true;
    //         triggerOrdersFetch(accounts);
    //         triggerGVFetch(accounts);
    //     }
    // }, [accounts, loading]);

    const handleNotificationAction = async (id: string, action: 'allow' | 'deny') => {
        setIsResponding(id);
        try {
            const res = await api.respondToNotification(id, action);
            if (res.success) {
                setNotifications(prev => prev.filter(n => n._id !== id));
                if (action === 'allow') {
                    loadAccounts(); // Refresh list if account was deleted
                }
            } else {
                alert('Action failed: ' + res.message);
            }
        } catch (e) {
            console.error('Failed to respond to notification:', e);
        } finally {
            setIsResponding(null);
        }
    };

    const [launchTarget, setLaunchTarget] = useState<{ accountId: string; platforms: Platform[]; targetBrowser: 'browser_1' | 'browser_2' } | null>(null);
    const [browser1TabCount, setBrowser1TabCount] = useState(0);
    const [browser2TabCount, setBrowser2TabCount] = useState(0);

    // ...

    const handleOpenBrowser = async (platform: Platform | 'both', explicitAccountId?: string) => {
        // CRITICAL: Use explicit ID to avoid race condition with async setState
        const accountId = explicitAccountId || activeAccountId;

        if (!accountId) {
            alert('Please select an account first');
            return;
        }

        const platforms: Platform[] = platform === 'both' ? ['flipkart', 'shopsy'] : [platform];

        // Smart Routing Limit
        const TAB_LIMIT = 100;
        let target: 'browser_1' | 'browser_2' = 'browser_1';

        if (browser1TabCount >= TAB_LIMIT) {
            target = 'browser_2';
            console.log(`[Dashboard] Browser 1 full (${browser1TabCount}), routing to Browser 2`);
        }

        // Launch Internal Browser - using explicit accountId to prevent session mixup
        setLaunchTarget({ accountId, platforms, targetBrowser: target });
        setCurrentView(target);
    };

    const handleRemoveAccount = async (accountId: string) => {
        if (!confirm('Are you sure you want to remove this account?')) return;

        // Optimistic UI update
        const previousAccounts = [...accounts];
        setAccounts(current => current.filter(a => a.id !== accountId));
        if (activeAccountId === accountId) {
            setActiveAccountId(undefined);
        }

        try {
            await api.deleteAccount(accountId);
            // Re-fetch just to be safe and ensure everything is in sync
            loadAccounts();
        } catch (e) {
            console.error('Failed to remove account:', e);
            alert('Failed to remove account. Reverting...');
            // Rollback on failure
            setAccounts(previousAccounts);
        }
    };

    const handleApplyBulkSelection = () => {
        if (!bulkPasteInput.trim()) return;
        
        // Split by newlines, commas, or spaces
        const idsToSelect = bulkPasteInput.split(/[\n,\s]+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
        
        const newSelection = new Set(logoutAccountIds);
        let matchCount = 0;
        
        accounts.forEach(acc => {
            if (idsToSelect.includes(acc.identifier.toLowerCase()) || idsToSelect.includes(acc.id.toLowerCase())) {
                newSelection.add(acc.id);
                matchCount++;
            }
        });
        
        setLogoutAccountIds(newSelection);
        setBulkPasteInput('');
        setIsBulkPasteOpen(false);
        console.log(`Matched ${matchCount} accounts for logout.`);
    };

    const handleInitializeNewAccount = (newAccount: Account) => {
        // Refresh account list
        loadAccounts();

        // AUTO-LAUNCH LOGIC:
        // 1. Set this new account as active
        setActiveAccountId(newAccount.id);

        // 2. Launch Session internally
        setLaunchTarget({ accountId: newAccount.id, platforms: [newAccount.platform], targetBrowser: 'browser_1' });
        setCurrentView('browser_1');
    };

    const toggleLogoutSelection = (id: string) => {
        const newSet = new Set(logoutAccountIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setLogoutAccountIds(newSet);
    };

    const selectAllLogout = (select: boolean) => {
        if (select) {
            setLogoutAccountIds(new Set(accounts.map(a => a.id)));
        } else {
            setLogoutAccountIds(new Set());
        }
    };

    const handleBulkLogout = async () => {
        if (logoutAccountIds.size === 0) return;
        if (!confirm(`Are you sure you want to log out ${logoutAccountIds.size} accounts from ALL devices?`)) return;

        try {
            const res = await api.logoutAllDevices(Array.from(logoutAccountIds));
            if (res.success) {
                alert('Logout process started.');
                setLogoutAccountIds(new Set());
            } else {
                alert('Failed: ' + res.message);
            }
        } catch (e) {
            alert('Error starting logout process');
        }
    };

    const activeAccount = accounts.find(a => a.id === activeAccountId);

    const navItems = [
        {
            id: 'dashboard',
            label: 'Dashboard',
            icon: <LayoutDashboard size={20} />,
            onClick: () => setCurrentView('dashboard'),
            active: currentView === 'dashboard'
        },
        {
            id: 'id_portal',
            label: 'ID Portal',
            icon: <Globe size={20} />,
            onClick: () => setCurrentView('id_portal'),
            active: currentView === 'id_portal'
        },
        {
            id: 'orders',
            label: 'Orders',
            icon: <ShoppingBag size={20} />,
            onClick: () => setCurrentView('orders'),
            active: currentView === 'orders'
        },
        {
            id: 'wallet',
            label: 'Wallet & GV',
            icon: <Activity size={20} />,
            onClick: () => setCurrentView('wallet'),
            active: currentView === 'wallet'
        },
        {
            id: 'settings',
            label: 'Settings',
            icon: <Settings size={20} />,
            onClick: () => setCurrentView('settings'),
            active: currentView === 'settings'
        },
        {
            id: 'browser_1',
            label: 'Browser 1',
            icon: <Monitor size={20} />,
            onClick: () => setCurrentView('browser_1'),
            active: currentView === 'browser_1',
            section: 'Browsers',
            badge: browser1TabCount > 0 ? `${browser1TabCount}` : undefined
        },
        {
            id: 'browser_2',
            label: 'Browser 2',
            icon: <Monitor size={20} />,
            onClick: () => setCurrentView('browser_2'),
            section: 'Browsers',
            badge: browser2TabCount > 0 ? `${browser2TabCount}` : undefined
        },
        {
            id: 'notifications',
            label: 'Notifications',
            icon: <Bell size={20} />,
            onClick: () => setCurrentView('notifications'),
            active: currentView === 'notifications',
            section: 'System'
        },
        {
            id: 'bulk_opener',
            label: 'Bulk URL Opener',
            icon: <Layers size={20} />,
            onClick: () => setIsBulkOpenerOpen(true),
            section: 'Tools'
        }
    ];

    const renderContent = () => {
        if (loading) {
            return (
                <div className="flex items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-accent"></div>
                </div>
            );
        }

        switch (currentView) {
            case 'browse':
                return renderBrowseView();
            case 'id_portal':
                return renderIDPortalView();
            case 'orders': {
                const fetchableAccounts = enrichedAccounts.filter(a =>
                    ['flipkart', 'shopsy', 'amazon', 'iqoo', 'oneplus', 'oppo', 'realme', 'reliancedigital', 'vijaysales', 'vivo', 'xiaomi', 'samsung'].includes(a.platform.toLowerCase())
                );
                return <Orders
                    accounts={fetchableAccounts}
                    isLoading={isOrdersFetching}
                    fetchingAccountId={currentOrderAccountId}
                    orderStates={orderStates}
                    onFetchOrders={(countOrIds) => {
                        if (typeof countOrIds === 'number') {
                            triggerOrdersFetch(fetchableAccounts.slice(0, countOrIds), loadAccounts);
                        } else if (Array.isArray(countOrIds)) {
                            const targets = fetchableAccounts.filter(a => countOrIds.includes(a.id));
                            if (targets.length > 0) triggerOrdersFetch(targets, loadAccounts);
                        }
                    }}
                />;
            }
            case 'wallet':
                return <Wallet
                    accounts={enrichedAccounts}
                    onRefresh={(targetAccounts?: Account[], batchSize?: number) => {
                        loadAccounts();
                        triggerGVFetch(targetAccounts || accounts, batchSize);
                    }}
                    isLoading={isGVFetching}
                    fetchingAccountId={currentGVAccountId}
                    gvStates={gvStates}
                />;
            case 'support':
                return <Support />;
            case 'settings':
                return renderSettingsView();
            case 'browser_1':
            case 'browser_2':
                // Browsers are rendered separately to preserve state - this just returns null
                return null;
            case 'notifications':
                return renderNotificationsView();
            default:
                return renderDashboardView();
        }
    };



    const renderIDPortalView = () => {
        const platforms = Array.from(new Set(filteredAccounts.map(a => a.platform)));

        return (
            <div className="p-8 space-y-8 max-w-6xl mx-auto">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <h3 className="text-3xl font-bold text-text-primary tracking-tight">ID Portal</h3>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" size={18} />
                            <input
                                type="text"
                                placeholder="Search IDs..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 pr-4 py-2.5 bg-bg-surface border border-border-subtle rounded-button text-sm font-bold text-text-primary focus:ring-2 focus:ring-brand-primary outline-none w-64 shadow-sm transition-all hover:border-text-tertiary"
                            />
                        </div>
                    </div>
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="px-6 py-3 bg-brand-primary text-white rounded-button hover:opacity-90 font-bold transition-all shadow-lg shadow-brand-primary/10 flex items-center gap-2"
                    >
                        + Add New ID
                    </button>
                </div>

                {platforms.length === 0 ? (
                    <div className="text-center py-20 bg-bg-surface rounded-card border border-border-subtle border-dashed">
                        <div className="w-20 h-20 bg-bg-surface-hover rounded-full flex items-center justify-center mx-auto mb-6">
                            <Globe size={32} className="text-text-tertiary" />
                        </div>
                        <h4 className="text-xl font-bold text-text-primary mb-2">No Buyer Accounts Connected</h4>
                        <p className="text-text-secondary max-w-sm mx-auto">Add your first buyer account to get started with the workspace.</p>
                    </div>
                ) : (
                    <div className="space-y-8">
                        {platforms.map(platform => {
                            const platformAccounts = filteredAccounts.filter(a => a.platform === platform);
                            return (
                                <div key={platform} className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 flex items-center justify-center">
                                            <PlatformIcon name={platform} size={32} />
                                        </div>
                                        <h4 className="text-lg font-black uppercase text-text-primary tracking-wider">
                                            {platform}
                                            <span className="ml-3 text-xs bg-bg-surface-hover text-text-secondary px-2 py-1 rounded-full border border-border-subtle">{platformAccounts.length}</span>
                                        </h4>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {platformAccounts.map(acc => (
                                            <div key={acc.id} className="bg-bg-surface p-5 rounded-card border border-border-subtle hover:border-brand-primary/20 transition-all shadow-card group relative">
                                                <div className="flex justify-between items-start mb-4">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-bold text-text-primary truncate">{acc.identifier}</p>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <div className={`w-2 h-2 rounded-full ${acc.status === 'Healthy' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                                            <p className="text-xs text-text-secondary font-medium">{acc.status || 'Unknown'}</p>
                                                        </div>
                                                    </div>
                                                    {acc.status !== 'Healthy' && (
                                                        <div className="p-2 text-amber-500 bg-amber-50 rounded-lg" title="Account needs attention">
                                                            <AlertTriangle size={16} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1 mt-4 pt-4 border-t border-border-subtle font-sans">
                                                    <div className="flex-1 flex gap-1">
                                                        {acc.platform === 'flipkart' || acc.platform === 'shopsy' ? (
                                                            <>
                                                                <button
                                                                    onClick={() => {
                                                                        setActiveAccountId(acc.id);
                                                                        handleOpenBrowser('flipkart', acc.id);
                                                                    }}
                                                                    className="flex-1 py-2 bg-[#fff700] text-[#2874f0] text-[10px] font-black uppercase rounded-l-lg hover:opacity-90 transition-all border border-transparent shadow-sm"
                                                                >
                                                                    Flipkart
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        setActiveAccountId(acc.id);
                                                                        handleOpenBrowser('shopsy', acc.id);
                                                                    }}
                                                                    className="flex-1 py-2 bg-[#00E065] text-white text-[10px] font-black uppercase hover:opacity-90 transition-all border border-transparent shadow-sm"
                                                                >
                                                                    Shopsy
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        setActiveAccountId(acc.id);
                                                                        handleOpenBrowser('both', acc.id);
                                                                    }}
                                                                    className="px-2 py-2 bg-slate-800 text-white text-[10px] font-black uppercase rounded-r-lg hover:bg-slate-900 transition-all border border-transparent shadow-sm"
                                                                    title="Launch Both"
                                                                >
                                                                    Both
                                                                </button>
                                                            </>
                                                        ) : acc.platform === 'realme' ? (
                                                            <button
                                                                onClick={async () => {
                                                                    setActiveAccountId(acc.id);
                                                                    try {
                                                                        await api.openSession(acc.id, 'realme');
                                                                    } catch (e) {
                                                                        alert('Failed to launch Playwright: ' + e);
                                                                    }
                                                                }}
                                                                className="flex-1 py-2 bg-brand-primary text-white text-[10px] font-black uppercase rounded-lg hover:opacity-90 transition-all border border-transparent shadow-sm flex items-center justify-center gap-2"
                                                            >
                                                                Open {acc.platform} (PW)
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => {
                                                                    setActiveAccountId(acc.id);
                                                                    handleOpenBrowser(acc.platform, acc.id);
                                                                }}
                                                                className="flex-1 py-2 bg-brand-primary text-white text-[10px] font-black uppercase rounded-lg hover:opacity-90 transition-all border border-transparent shadow-sm flex items-center justify-center gap-2"
                                                            >
                                                                Open {acc.platform}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={() => handleRemoveAccount(acc.id)}
                                                        className="py-2 px-2 bg-red-50 text-red-500 text-[10px] font-bold uppercase rounded-lg hover:bg-red-500 hover:text-white transition-all border border-red-200 hover:border-transparent flex items-center gap-1"
                                                    >
                                                        <Trash2 size={14} />
                                                        Delete
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                        }
                                    </div >
                                </div >
                            );
                        })}
                    </div >
                )}
            </div >
        );
    };

    const renderDashboardView = () => {
        const healthyCount = accounts.filter(a => a.status === 'Healthy').length;
        const attentionCount = accounts.filter(a => a.status === 'Error' || a.status === 'NeedsRefresh').length;

        return (
            <div className="p-8 space-y-8 max-w-7xl mx-auto font-sans">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-3xl font-bold text-text-primary tracking-tight">Welcome Back, {username}!</h2>
                        <p className="text-text-secondary font-medium mt-1">
                            You have <span className="text-text-primary font-bold">{accounts.length} linked accounts</span> today — keep it up!
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button className="p-2.5 bg-bg-surface border border-border-subtle rounded-button text-text-tertiary hover:text-text-primary transition-all shadow-sm">
                            <Info size={18} />
                        </button>
                        <button onClick={loadAccounts} className="flex items-center gap-2 px-4 py-2.5 bg-bg-surface border border-border-subtle rounded-button text-xs font-bold text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary transition-all shadow-sm">
                            <Activity size={16} className="text-text-tertiary" />
                            Refresh Data
                        </button>
                    </div>
                </div>

                {/* Highlights Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {/* Stat Can: Total IDs */}
                    <div className="bg-bg-surface rounded-card p-6 shadow-card border border-border-subtle flex flex-col justify-between h-32 relative overflow-hidden group cursor-pointer hover:shadow-float transition-all" onClick={() => setCurrentView('id_portal')}>
                        <div className="flex justify-between items-start z-10">
                            <div>
                                <p className="text-xs font-bold text-text-tertiary uppercase tracking-widest flex items-center gap-2">
                                    <Globe size={14} /> Total IDs
                                </p>
                                <h3 className="text-4xl font-black text-text-primary mt-2">{totalAccounts}</h3>
                            </div>
                            <span className="bg-emerald-50 text-emerald-600 text-[10px] font-bold px-2 py-1 rounded-full border border-emerald-100">+12%</span>
                        </div>
                        {/* Decorative Sparkline (CSS) */}
                        <div className="absolute bottom-0 left-0 right-0 h-10 w-full opacity-20 group-hover:opacity-30 transition-opacity">
                            <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-full text-brand-accent fill-current">
                                <path d="M0,20 L0,10 Q25,18 50,5 T100,0 L100,20 Z" />
                            </svg>
                        </div>
                    </div>

                    {/* Stat Card: Active Sessions */}
                    <div className="bg-bg-surface rounded-card p-6 shadow-card border border-border-subtle flex flex-col justify-between h-32 hover:shadow-float transition-all duration-300">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-xs font-bold text-text-tertiary uppercase tracking-widest flex items-center gap-2">
                                    <CheckCircle2 size={14} /> Active
                                </p>
                                <h3 className="text-4xl font-black text-text-primary mt-2">{healthyCount}</h3>
                            </div>
                            <span className="bg-emerald-50 text-emerald-600 text-[10px] font-bold px-2 py-1 rounded-full border border-emerald-100">Healthy</span>
                        </div>
                        <div className="w-full bg-bg-surface-hover h-1 rounded-full mt-auto overflow-hidden">
                            <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${(healthyCount / (totalAccounts || 1)) * 100}%` }}></div>
                        </div>
                    </div>

                    {/* Stat Card: Issues */}
                    <div className="bg-bg-surface rounded-card p-6 shadow-card border border-border-subtle flex flex-col justify-between h-32 hover:shadow-float transition-all duration-300">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-xs font-bold text-text-tertiary uppercase tracking-widest flex items-center gap-2">
                                    <AlertTriangle size={14} /> Issues
                                </p>
                                <h3 className="text-4xl font-black text-text-primary mt-2">{attentionCount}</h3>
                            </div>
                            {attentionCount > 0 ? (
                                <span className="bg-amber-50 text-amber-600 text-[10px] font-bold px-2 py-1 rounded-full border border-amber-100">Action Req.</span>
                            ) : (
                                <span className="bg-bg-surface-hover text-text-tertiary text-[10px] font-bold px-2 py-1 rounded-full border border-border-subtle">Good</span>
                            )}
                        </div>
                        <div className="w-full bg-bg-surface-hover h-1 rounded-full mt-auto overflow-hidden">
                            <div className="bg-amber-500 h-full rounded-full" style={{ width: `${(attentionCount / (totalAccounts || 1)) * 100}%` }}></div>
                        </div>
                    </div>

                    {/* Stat Card: Platform Split (Mini) */}
                    <div className="bg-bg-surface rounded-card p-6 shadow-card border border-border-subtle flex flex-col justify-between h-32 hover:shadow-float transition-all duration-300">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-xs font-bold text-text-tertiary uppercase tracking-widest flex items-center gap-2">
                                    <LayoutDashboard size={14} /> Platforms
                                </p>
                                <div className="flex -space-x-1.5 mt-3">
                                    {platformSplit.slice(0, 3).map((item, i) => (
                                        <div key={item.platform} className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center bg-bg-canvas shadow-sm" style={{ zIndex: 10 - i }}>
                                            <PlatformIcon name={item.platform} size={16} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-0.5">
                                {platformSplit.slice(0, 2).map(item => (
                                    <span key={item.platform} className="text-[10px] font-bold text-text-primary uppercase tracking-tighter">
                                        {item.count} {item.platform.charAt(0)}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Col: Account Status Table */}
                    <div className="lg:col-span-2 bg-bg-surface rounded-card p-8 shadow-card border border-border-subtle">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-text-primary flex items-center gap-2">
                                <Activity size={18} className="text-text-tertiary" />
                                Account Status
                            </h3>
                            <div className="flex gap-2">
                                <button className="px-3 py-1.5 rounded-lg border border-border-subtle text-xs font-bold text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary transition-colors">Filter</button>
                                <button className="px-3 py-1.5 rounded-lg border border-border-subtle text-xs font-bold text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary transition-colors">Sort</button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr>
                                        <th className="pb-4 text-xs font-bold text-text-tertiary uppercase tracking-wider pl-2">Account ID</th>
                                        <th className="pb-4 text-xs font-bold text-text-tertiary uppercase tracking-wider">Platform</th>
                                        <th className="pb-4 text-xs font-bold text-text-tertiary uppercase tracking-wider">Status</th>
                                        <th className="pb-4 text-xs font-bold text-text-tertiary uppercase tracking-wider text-right pr-2">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="text-sm">
                                    {filteredAccounts.slice(0, 5).map(acc => (
                                        <tr key={acc.id} className="border-t border-border-subtle hover:bg-bg-surface-hover transition-colors group">
                                            <td className="py-4 pl-2 font-bold text-text-primary flex items-center gap-3">
                                                <div className={`w-2 h-2 rounded-full ${acc.status === 'Healthy' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                                {acc.identifier}
                                            </td>
                                            <td className="py-4">
                                                {acc.platform === 'flipkart' ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#fff700]/10 text-[#2874f0] text-[10px] font-bold uppercase tracking-wide border border-[#fff700]/20">
                                                        Flipkart
                                                    </span>
                                                ) : acc.platform === 'shopsy' ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#00E065]/10 text-[#00E065] text-[10px] font-bold uppercase tracking-wide border border-[#00E065]/20">
                                                        Shopsy
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-brand-primary/10 text-brand-primary text-[10px] font-bold uppercase tracking-wide border border-brand-primary/20">
                                                        {acc.platform}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-4">
                                                <span className={`text-xs font-bold ${acc.status === 'Healthy' ? 'text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100' :
                                                    acc.status === 'Error' ? 'text-red-600 bg-red-50 px-2 py-1 rounded-lg border border-red-100' :
                                                        'text-amber-600 bg-amber-50 px-2 py-1 rounded-lg border border-amber-100'
                                                    }`}>
                                                    {acc.status}
                                                </span>
                                            </td>
                                            <td className="py-4 text-right pr-2">
                                                <button
                                                    onClick={() => { setActiveAccountId(acc.id); handleOpenBrowser(acc.platform, acc.id); }}
                                                    className="px-3 py-1.5 bg-brand-primary text-white text-[10px] font-bold rounded-lg hover:opacity-90 transition-all opacity-0 group-hover:opacity-100 shadow-sm"
                                                >
                                                    Launch
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {accounts.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="py-8 text-center text-text-tertiary italic">No accounts connected yet.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Right Col: Platform Split & Quick Review */}
                    <div className="space-y-8">
                        {/* Platform Split Donut */}
                        <div className="bg-bg-surface rounded-card p-8 shadow-card border border-border-subtle flex flex-col items-center justify-center text-center">
                            <h3 className="text-sm font-bold text-text-primary mb-6 w-full text-left flex items-center gap-2">
                                <LayoutDashboard size={18} className="text-text-tertiary" />
                                Platform Distribution
                            </h3>
                            <div className="relative w-40 h-40 mb-6">
                                <svg viewBox="0 0 36 36" className="w-full h-full rotate-[-90deg]">
                                    {/* Background Circle */}
                                    <path className="text-bg-surface-hover" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3.5" />
                                    {/* Dynamic Segments */}
                                    {platformSplit.reduce((acc: any[], item) => {
                                        const offset = acc.reduce((sum, prev) => sum + prev.percentage, 0);
                                        const colors: Record<string, string> = {
                                            flipkart: 'text-[#fff700]',
                                            shopsy: 'text-[#00E065]',
                                            amazon: 'text-amber-600',
                                            iqoo: 'text-blue-600',
                                            realme: 'text-amber-500',
                                            oppo: 'text-emerald-500',
                                            oneplus: 'text-red-600',
                                            vivo: 'text-blue-500',
                                            samsung: 'text-blue-700'
                                        };
                                        acc.push({
                                            ...item,
                                            offset: -offset,
                                            color: colors[item.platform] || 'text-brand-primary'
                                        });
                                        return acc;
                                    }, []).map(seg => (
                                        <path
                                            key={seg.platform}
                                            className={seg.color}
                                            strokeDasharray={`${seg.percentage}, 100`}
                                            strokeDashoffset={seg.offset}
                                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="3.5"
                                        />
                                    ))}
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center flex-col">
                                    <span className="text-3xl font-black text-text-primary">{totalAccounts}</span>
                                    <span className="text-[10px] font-bold text-text-tertiary uppercase">Total</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 text-[10px] font-bold w-full justify-center flex-wrap">
                                {platformSplit.slice(0, 4).map(item => {
                                    const colors: Record<string, string> = {
                                        flipkart: 'bg-[#fff700]',
                                        shopsy: 'bg-[#00E065]',
                                        amazon: 'bg-amber-600',
                                        iqoo: 'bg-blue-600',
                                        realme: 'bg-amber-500',
                                        oppo: 'bg-emerald-500',
                                        oneplus: 'bg-red-600',
                                        vivo: 'bg-blue-500',
                                        samsung: 'bg-blue-700'
                                    };
                                    return (
                                        <div key={item.platform} className="flex items-center gap-1.5 capitalize">
                                            <div className={`w-2 h-2 rounded-full ${colors[item.platform] || 'bg-brand-primary'}`} />
                                            {item.platform}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Quick Review */}
                        <div className="bg-bg-surface rounded-card p-8 shadow-card border border-border-subtle">
                            <h3 className="text-sm font-bold text-text-primary mb-2">Quick Access</h3>
                            <p className="text-xs text-text-tertiary mb-6">Jump to frequently used tools.</p>

                            <div className="space-y-3">
                                <button onClick={() => setCurrentView('id_portal')} className="w-full flex items-center gap-3 p-3 rounded-card bg-bg-surface-hover hover:bg-bg-surface hover:shadow-card hover:border-border-subtle transition-all group border border-transparent">
                                    <div className="w-8 h-8 rounded-lg bg-bg-surface shadow-sm flex items-center justify-center text-text-secondary group-hover:text-brand-accent">
                                        <Globe size={16} />
                                    </div>
                                    <span className="text-xs font-bold text-text-primary">Manage IDs</span>
                                    <ChevronDown size={14} className="ml-auto -rotate-90 text-text-tertiary" />
                                </button>
                                <button onClick={() => setCurrentView('orders')} className="w-full flex items-center gap-3 p-3 rounded-card bg-bg-surface-hover hover:bg-bg-surface hover:shadow-card hover:border-border-subtle transition-all group border border-transparent">
                                    <div className="w-8 h-8 rounded-lg bg-bg-surface shadow-sm flex items-center justify-center text-text-secondary group-hover:text-brand-accent">
                                        <ShoppingBag size={16} />
                                    </div>
                                    <span className="text-xs font-bold text-text-primary">Process Orders</span>
                                    <ChevronDown size={14} className="ml-auto -rotate-90 text-text-tertiary" />
                                </button>
                            </div>

                            <button onClick={() => setIsAddModalOpen(true)} className="w-full mt-6 py-3 bg-brand-primary text-white rounded-button text-xs font-bold hover:opacity-90 transition-all shadow-md shadow-brand-primary/10 flex items-center justify-center gap-2">
                                Add New Account <ChevronDown size={14} className="-rotate-90" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderBrowseView = () => {
        if (!activeAccount) {
            return (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center max-w-md mx-auto">
                    <div className="w-20 h-20 bg-bg-surface-hover rounded-3xl flex items-center justify-center mb-8 shadow-inner">
                        <Globe size={40} className="text-brand-accent" />
                    </div>
                    <h3 className="text-2xl font-bold text-text-primary mb-3 tracking-tight">No Account Selected</h3>
                    <p className="text-text-secondary mb-8 leading-relaxed">Please select an account from the top bar to start a secure browsing session.</p>
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="px-8 py-4 bg-brand-accent text-white rounded-button hover:bg-brand-accent/90 font-bold shadow-lg shadow-brand-accent/20 transition-all hover:-translate-y-0.5"
                    >
                        + Add Account
                    </button>
                </div>
            );
        }

        return (
            <div className="p-8 space-y-8 max-w-6xl mx-auto">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-3xl font-bold text-text-primary tracking-tight">Browse Session</h3>
                        <p className="text-sm text-text-secondary mt-2 flex items-center gap-2">
                            Active Session:
                            <span className="font-bold text-brand-accent bg-brand-accent/5 px-2.5 py-0.5 rounded-md border border-brand-accent/10">
                                {activeAccount.identifier}
                            </span>
                        </p>
                    </div>
                    <button
                        onClick={() => setCurrentView('dashboard')}
                        className="px-4 py-2 text-sm font-bold text-text-secondary hover:text-text-primary bg-bg-surface hover:bg-bg-surface-hover border border-border-subtle rounded-button transition-all"
                    >
                        Esc / Back
                    </button>
                </div>

                <div className="bg-bg-surface rounded-card p-10 border border-border-subtle shadow-card">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <button
                            onClick={() => handleOpenBrowser('flipkart')}
                            className="flex flex-col items-center justify-center p-12 bg-bg-surface hover:bg-bg-surface-hover border-2 border-border-subtle rounded-card hover:border-yellow-400/50 hover:shadow-float transition-all hover:-translate-y-1 group relative overflow-hidden"
                        >
                            <div className="w-24 h-24 bg-[#fff700] rounded-3xl shadow-sm flex items-center justify-center mb-8 group-hover:scale-105 transition-transform duration-300">
                                <FlipkartIcon size={48} className="text-[#2874f0]" />
                            </div>
                            <h4 className="text-2xl font-black text-text-primary mb-3">Open Flipkart</h4>
                            <p className="text-text-tertiary text-center font-medium">Go to Homepage</p>
                        </button>

                        <button
                            onClick={() => handleOpenBrowser('shopsy')}
                            className="flex flex-col items-center justify-center p-12 bg-bg-surface hover:bg-bg-surface-hover border-2 border-border-subtle rounded-card hover:border-green-400/50 hover:shadow-float transition-all hover:-translate-y-1 group relative overflow-hidden"
                        >
                            <div className="w-24 h-24 bg-[#00E065] rounded-3xl shadow-sm flex items-center justify-center mb-8 group-hover:scale-105 transition-transform duration-300">
                                <ShopsyIcon size={48} className="text-[#00E065]" />
                            </div>
                            <h4 className="text-2xl font-black text-text-primary mb-3">Open Shopsy</h4>
                            <p className="text-text-tertiary text-center font-medium">Go to Homepage</p>
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderSettingsView = () => (
        <div className="p-8 max-w-4xl mx-auto space-y-8">
            <h3 className="text-3xl font-bold text-text-primary tracking-tight">Settings</h3>

            {/* Profile Section */}
            <div className="bg-bg-surface rounded-card p-8 border border-border-subtle shadow-card">
                <div className="flex items-start justify-between mb-6 border-b border-border-subtle pb-4">
                    <h4 className="text-xs font-black text-text-tertiary uppercase tracking-widest">Profile Information</h4>
                    {!isEditingProfile && (
                        <button onClick={() => setIsEditingProfile(true)} className="text-xs font-bold text-brand-primary hover:text-brand-accent transition-colors">
                            Edit Profile
                        </button>
                    )}
                </div>

                <div className="flex flex-col md:flex-row gap-8">
                    {/* Avatar Display / Selection */}
                    <div className="flex flex-col items-center gap-4">
                        <div className="w-24 h-24 rounded-3xl overflow-hidden shadow-inner ring-4 ring-bg-surface border border-border-subtle relative group">
                            {AVATARS.find(a => a.id === selectedAvatar)?.icon}
                            {isEditingProfile && (
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                    Change
                                </div>
                            )}
                        </div>
                        {isEditingProfile && (
                            <div className="grid grid-cols-5 gap-2 bg-bg-canvas p-2 rounded-xl">
                                {AVATARS.map(avatar => (
                                    <button
                                        key={avatar.id}
                                        onClick={() => setSelectedAvatar(avatar.id)}
                                        className={`w-8 h-8 rounded-lg overflow-hidden border-2 transition-all ${selectedAvatar === avatar.id ? 'border-brand-primary scale-110 shadow-sm' : 'border-transparent hover:border-border-subtle'}`}
                                    >
                                        {avatar.icon}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 space-y-4">
                        {isEditingProfile ? (
                            <div className="space-y-4 max-w-sm">
                                <div>
                                    <label className="text-xs font-bold text-text-tertiary mb-1 block">Username</label>
                                    <input type="text" value={username} disabled className="w-full px-4 py-2 bg-bg-canvas border border-border-subtle rounded-lg text-text-secondary font-medium cursor-not-allowed" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-text-tertiary mb-1 block">Current Plan</label>
                                    <select className="w-full px-4 py-2 bg-bg-canvas border border-border-subtle rounded-lg text-text-primary font-bold focus:ring-2 focus:ring-brand-primary outline-none">
                                        <option>Standard User Plan</option>
                                        <option>Pro User Plan</option>
                                    </select>
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button onClick={() => setIsEditingProfile(false)} className="px-4 py-2 bg-brand-primary text-white text-xs font-bold rounded-lg hover:opacity-90 transition-opacity">Save Changes</button>
                                    <button onClick={() => setIsEditingProfile(false)} className="px-4 py-2 bg-bg-surface border border-border-subtle text-text-secondary text-xs font-bold rounded-lg hover:bg-bg-surface-hover">Cancel</button>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <h2 className="text-2xl font-black text-text-primary mb-1">{username}</h2>
                                <div className="flex items-center gap-2 mb-4">
                                    <span className="px-2 py-0.5 bg-brand-primary text-white text-[10px] font-bold uppercase tracking-wider rounded-md">User</span>
                                    <span className="px-2 py-0.5 bg-bg-surface-hover text-text-secondary text-[10px] font-bold uppercase tracking-wider rounded-md border border-border-subtle">Standard Plan</span>
                                </div>
                                <p className="text-sm text-text-secondary">Manage your personal details and account settings here.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* General Settings */}
                <div className="bg-bg-surface rounded-card p-8 border border-border-subtle shadow-card">
                    <h4 className="text-xs font-black text-text-tertiary uppercase tracking-widest mb-6 border-b border-border-subtle pb-2">General Preferences</h4>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between group cursor-pointer">
                            <span className="text-sm font-bold text-text-secondary group-hover:text-text-primary transition-colors">Dark Mode</span>
                            <div className="w-12 h-7 bg-bg-canvas border border-border-subtle rounded-full relative transition-colors">
                                <div className="absolute left-1 top-1 w-5 h-5 bg-text-tertiary rounded-full shadow-sm transition-transform"></div>
                            </div>
                        </div>
                        <div className="flex items-center justify-between group cursor-pointer">
                            <span className="text-sm font-bold text-text-secondary group-hover:text-text-primary transition-colors">Notifications</span>
                            <div className="w-12 h-7 bg-brand-primary rounded-full relative transition-colors">
                                <div className="absolute right-1 top-1 w-5 h-5 bg-white rounded-full shadow-sm"></div>
                            </div>
                        </div>
                        <div className="flex items-center justify-between group cursor-pointer">
                            <span className="text-sm font-bold text-text-secondary group-hover:text-text-primary transition-colors">Auto-Launch Browsers</span>
                            <div className="w-12 h-7 bg-bg-canvas border border-border-subtle rounded-full relative transition-colors">
                                <div className="absolute left-1 top-1 w-5 h-5 bg-text-tertiary rounded-full shadow-sm transition-transform"></div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Security */}
                <div className="bg-bg-surface rounded-card p-8 border border-border-subtle shadow-card">
                    <h4 className="text-xs font-black text-text-tertiary uppercase tracking-widest mb-6 border-b border-border-subtle pb-2">Security</h4>
                    <div className="space-y-3">
                        <button className="w-full text-left px-5 py-4 bg-bg-canvas hover:bg-bg-surface-hover rounded-xl border border-border-subtle font-bold text-text-primary text-sm transition-all flex justify-between items-center group shadow-sm hover:shadow-md">
                            Change Password
                            <ChevronDown size={16} className="-rotate-90 text-text-tertiary group-hover:text-brand-primary transition-colors" />
                        </button>
                        <button className="w-full text-left px-5 py-4 bg-bg-canvas hover:bg-bg-surface-hover rounded-xl border border-border-subtle font-bold text-text-primary text-sm transition-all flex justify-between items-center group shadow-sm hover:shadow-md">
                            Two-Factor Authentication
                            <ChevronDown size={16} className="-rotate-90 text-text-tertiary group-hover:text-brand-primary transition-colors" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Bulk Logout Section */}
            <div className="bg-bg-surface rounded-card p-8 border border-border-subtle shadow-card">
                <h4 className="text-xs font-black text-text-tertiary uppercase tracking-widest mb-6 border-b border-border-subtle pb-2">Bulk Actions</h4>
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h5 className="font-bold text-text-primary">Log out from all devices</h5>
                        <div className="flex items-center gap-4">
                            <button 
                                onClick={() => setIsBulkPasteOpen(!isBulkPasteOpen)} 
                                className={`text-xs font-bold transition-colors ${isBulkPasteOpen ? 'text-brand-accent' : 'text-text-tertiary hover:text-brand-primary'}`}
                            >
                                {isBulkPasteOpen ? "Hide Paste" : "Bulk Select (Paste ID)"}
                            </button>
                            <div className="w-px h-3 bg-border-subtle" />
                            <button onClick={() => selectAllLogout(true)} className="text-xs font-bold text-brand-primary hover:underline">Select All</button>
                            <button onClick={() => selectAllLogout(false)} className="text-xs font-bold text-text-tertiary hover:underline">Clear</button>
                        </div>
                    </div>

                    {/* Bulk Paste Area */}
                    {isBulkPasteOpen && (
                        <div className="space-y-3 bg-bg-canvas p-4 rounded-xl border border-border-subtle animate-in slide-in-from-top-2 duration-200">
                            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Paste Email IDs (Separated by Newline or Comma)</p>
                            <textarea
                                value={bulkPasteInput}
                                onChange={(e) => setBulkPasteInput(e.target.value)}
                                placeholder="abc@gmail.com&#10;xyz@gmail.com"
                                className="w-full h-24 bg-bg-surface border border-border-subtle rounded-lg p-3 text-sm focus:ring-2 focus:ring-brand-primary outline-none transition-all font-mono"
                            />
                            <div className="flex justify-end gap-2">
                                <button onClick={() => setIsBulkPasteOpen(false)} className="px-3 py-1.5 text-xs text-text-secondary font-bold hover:bg-bg-surface-hover rounded-lg">Cancel</button>
                                <button onClick={handleApplyBulkSelection} className="px-4 py-1.5 bg-brand-primary text-white text-xs font-bold rounded-lg hover:opacity-90 shadow-sm">Select Matching Accounts</button>
                            </div>
                        </div>
                    )}

                    {/* Search Field */}
                    <div className="relative group">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-brand-primary transition-colors" />
                        <input
                            type="text"
                            placeholder="Search IDs to select..."
                            value={logoutSearch}
                            onChange={(e) => setLogoutSearch(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 bg-bg-canvas border border-border-subtle rounded-lg text-sm text-text-primary focus:ring-2 focus:ring-brand-primary outline-none transition-all placeholder:text-text-disabled"
                        />
                    </div>

                    <div className="max-h-60 overflow-y-auto border border-border-subtle rounded-lg p-2 space-y-2">
                        {accounts
                            .filter(acc => acc.platform === 'flipkart') // Assuming user wants flipkart based on screenshot, but could be all
                            .filter(acc => acc.identifier.toLowerCase().includes(logoutSearch.toLowerCase()))
                            .map(acc => (
                                <div key={acc.id} className="flex items-center gap-3 p-2 hover:bg-bg-surface-hover rounded-md group/item">
                                <input
                                    type="checkbox"
                                    checked={logoutAccountIds.has(acc.id)}
                                    onChange={() => toggleLogoutSelection(acc.id)}
                                    className="w-4 h-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary"
                                />
                                <div className="flex-1">
                                    <div className="text-sm font-bold text-text-primary">{acc.identifier}</div>
                                    <div className="text-[10px] text-text-tertiary uppercase">{acc.platform}</div>
                                </div>
                                <div className={`w-2 h-2 rounded-full ${acc.status === 'Healthy' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={handleBulkLogout}
                        disabled={logoutAccountIds.size === 0}
                        className={`w-full py-3 rounded-button font-bold text-sm transition-all ${logoutAccountIds.size > 0 ? 'bg-red-500 text-white hover:bg-red-600 shadow-md' : 'bg-bg-canvas text-text-disabled cursor-not-allowed'}`}
                    >
                        Log out {logoutAccountIds.size} Accounts from All Devices
                    </button>
                </div>
            </div>

            {/* App Info */}
            <div className="bg-bg-canvas rounded-card p-8 border border-border-subtle border-dashed text-center opacity-70 hover:opacity-100 transition-opacity">
                <div className="flex justify-center gap-12">
                    <div>
                        <p className="text-4xl font-black text-text-primary tracking-tighter">{accounts.length}</p>
                        <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mt-1">Connected IDs</p>
                    </div>
                    <div className="w-px bg-border-subtle h-12 self-center"></div>
                    <div>
                        <p className="text-4xl font-black text-text-primary tracking-tighter">1.2.0</p>
                        <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mt-1">Version</p>
                    </div>
                </div>
            </div>
        </div>
    );

    const [activityLogs, setActivityLogs] = useState<any[]>([]);

    useEffect(() => {
        if (currentView === 'notifications') {
            api.getActivityLogs().then(logs => setActivityLogs(logs));
        }
    }, [currentView]);

    const renderNotificationsView = () => (
        <div className="p-8 max-w-4xl mx-auto space-y-8">
            <h3 className="text-3xl font-bold text-text-primary tracking-tight">Notifications</h3>

            {(activityLogs.length === 0 && notifications.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-20 bg-bg-surface rounded-card border border-border-subtle shadow-sm">
                    <div className="w-16 h-16 bg-bg-surface-hover rounded-full flex items-center justify-center mb-4 text-text-tertiary">
                        <Bell size={24} />
                    </div>
                    <h4 className="text-lg font-bold text-text-primary">No new notifications</h4>
                    <p className="text-text-secondary mt-1">We'll let you know when something important happens.</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Pending Action Notifications */}
                    {notifications.length > 0 && (
                        <div className="space-y-4">
                            <h4 className="text-sm font-semibold text-text-tertiary uppercase tracking-wider flex items-center gap-2">
                                <AlertTriangle size={16} className="text-amber-500" />
                                Action Required
                            </h4>
                            {notifications.map((n) => (
                                <div key={n._id} className="bg-bg-surface p-6 rounded-2xl border-2 border-amber-500/20 shadow-lg shadow-amber-500/5 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:border-amber-500/40 transition-all">
                                    <div className="flex items-start gap-4">
                                        <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                                            <Trash2 size={24} className="text-amber-500" />
                                        </div>
                                        <div>
                                            <h4 className="text-lg font-bold text-text-primary">{n.title}</h4>
                                            <p className="text-text-secondary mt-1">{n.message}</p>
                                            <div className="flex gap-4 mt-3 text-xs font-medium">
                                                <span className="bg-bg-canvas px-2.5 py-1 rounded text-text-tertiary border border-border-subtle">
                                                    Account: <span className="text-text-secondary">{n.account_id}</span>
                                                </span>
                                                <span className="bg-bg-canvas px-2.5 py-1 rounded text-text-tertiary border border-border-subtle">
                                                    Platform: <span className="text-text-secondary">{n.platform}</span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <button
                                            onClick={() => handleNotificationAction(n._id, 'deny')}
                                            disabled={isResponding === n._id}
                                            className="px-5 py-2.5 rounded-xl font-bold text-text-secondary hover:bg-bg-surface-hover border border-border-subtle transition-all disabled:opacity-50"
                                        >
                                            Ignore
                                        </button>
                                        <button
                                            onClick={() => handleNotificationAction(n._id, 'allow')}
                                            disabled={isResponding === n._id}
                                            className="px-5 py-2.5 rounded-xl font-bold bg-amber-500 text-white hover:bg-amber-600 shadow-md shadow-amber-500/20 transition-all disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {isResponding === n._id ? (
                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            ) : null}
                                            Allow Deletion
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Activity Logs (Standard Notifications) */}
                    {activityLogs.length > 0 && (
                        <div className="space-y-4 pt-4 border-t border-border-subtle">
                            <h4 className="text-sm font-semibold text-text-tertiary uppercase tracking-wider">Activity History</h4>
                            {activityLogs.map((log, index) => (
                                <div key={index} className="bg-bg-surface p-4 rounded-xl border border-border-subtle flex items-start gap-4 hover:bg-bg-surface-hover transition-colors">
                                    <div className="w-10 h-10 rounded-full bg-brand-primary/10 flex items-center justify-center shrink-0">
                                        <Info size={20} className="text-brand-primary" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-text-primary">{log.action}</h4>
                                        <p className="text-sm text-text-secondary mt-1">
                                            {log.username} - {new Date(log.timestamp).toLocaleString()}
                                        </p>
                                        {log.details && (
                                            <pre className="mt-2 text-xs bg-bg-canvas p-2 rounded text-text-tertiary overflow-x-auto max-w-full">
                                                {JSON.stringify(log.details, null, 2)}
                                            </pre>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
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
                showSearch={false}
                showAddButton={currentView === 'dashboard'}
                onSearch={setSearchQuery}
                onSwitchToAdmin={onSwitchToAdmin}
            >
                {renderContent()}

                {/* Persistent Browsers - Hidden when not active, preserves state */}
                <div className={`absolute inset-0 z-50 ${currentView === 'browser_1' ? 'block' : 'hidden'}`}>
                    <InAppBrowser
                        browserId="browser_1"
                        savedAccounts={accounts}
                        onClose={() => setCurrentView('dashboard')}
                        onAddAccount={() => setIsAddModalOpen(true)}
                        launchTarget={launchTarget}
                        onTabCountChange={setBrowser1TabCount}
                        bulkOpenTarget={bulkOpenConfig?.browserType === 'browser_1' ? bulkOpenConfig : null}
                        onBulkProgress={(current, total, status) => {
                            console.log(`[Browser1 BulkProgress] ${current}/${total}: ${status}`);
                        }}
                    />
                </div>
                <div className={`absolute inset-0 z-50 ${currentView === 'browser_2' ? 'block' : 'hidden'}`}>
                    <InAppBrowser
                        browserId="browser_2"
                        savedAccounts={accounts}
                        onClose={() => setCurrentView('dashboard')}
                        onAddAccount={() => setIsAddModalOpen(true)}
                        launchTarget={launchTarget}
                        onTabCountChange={setBrowser2TabCount}
                        bulkOpenTarget={bulkOpenConfig?.browserType === 'browser_2' ? bulkOpenConfig : null}
                        onBulkProgress={(current, total, status) => {
                            console.log(`[Browser2 BulkProgress] ${current}/${total}: ${status}`);
                        }}
                    />
                </div>
            </Layout>

            {/* Bulk URL Opener Modal */}
            {isBulkOpenerOpen && (
                <BulkUrlOpener
                    savedAccounts={accounts}
                    onClose={() => setIsBulkOpenerOpen(false)}
                    onOpenBulk={(config) => {
                        setBulkOpenConfig(config);
                        // Route to the selected browser
                        setCurrentView(config.browserType);
                        setIsBulkOpenerOpen(false);
                    }}
                />
            )}


            <ChatWidget onNavigate={(orderId) => {
                setCurrentView('orders');
                console.log('Navigate to order:', orderId);
            }} />

            <AddAccountModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSuccess={loadAccounts}
                onInitialize={handleInitializeNewAccount}
            />
        </>
    );
};
