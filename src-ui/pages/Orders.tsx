import React, { useState, useMemo } from 'react';
import { Search, Filter, ArrowUpRight, Copy, Truck, ShoppingBag, Clock, Check, RefreshCw, Loader, ChevronDown } from 'lucide-react';
import { Account, Platform, Order } from '../types';
import { PlatformIcon } from '../components/Icons';
import { FetchState } from '../hooks/useDataFetcher';
import { OrderDetailModal } from '../components/OrderDetailModal';

interface OrdersProps {
    accounts: Account[];
    isLoading?: boolean;
    fetchingAccountId?: string | null;
    orderStates?: Record<string, FetchState>;
    onFetchOrders?: (countOrIds?: number | string[]) => void;
}

// Extended Order type for UI display with Account info
interface DisplayOrder extends Order {
    accountIdentifier: string;
    platform: Platform;
}

export const Orders: React.FC<OrdersProps> = ({ accounts, isLoading, fetchingAccountId, orderStates, onFetchOrders }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [viewPlatform, setViewPlatform] = useState<string>('all');
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [fetchCount, setFetchCount] = useState<number>(10);
    const [selectedOrder, setSelectedOrder] = useState<DisplayOrder | null>(null);

    // Filter Selection Config
    const [fetchFilterMode, setFetchFilterMode] = useState<'count' | 'filter'>('count');
    const [selectedFetchPlatform, setSelectedFetchPlatform] = useState<string>('all');
    const [selectedFetchUser, setSelectedFetchUser] = useState<string>('all');
    const [targetedIdsText, setTargetedIdsText] = useState('');
    // Derived available options
    const availablePlatforms = useMemo(() => Array.from(new Set(accounts.map(a => a.platform))), [accounts]);
    const availableUsers = useMemo(() => {
        const users = new Set<string>();
        accounts.forEach(a => {
            if (a.assignedTo) users.add(a.assignedTo);
        });
        return Array.from(users);
    }, [accounts]);
    const availablePlatformAccountsCount = useMemo(() => {
        return selectedFetchPlatform === 'all'
            ? accounts.length
            : accounts.filter(a => a.platform === selectedFetchPlatform).length;
    }, [accounts, selectedFetchPlatform]);

    // Ensure fetchCount stays within bounds
    React.useEffect(() => {
        if (fetchCount > availablePlatformAccountsCount && availablePlatformAccountsCount > 0) {
            setFetchCount(availablePlatformAccountsCount);
        } else if (fetchCount === 0 && availablePlatformAccountsCount > 0) {
            setFetchCount(1);
        }
    }, [availablePlatformAccountsCount, fetchCount]);

    // Calculate targeted accounts based on selection
    const targetedAccounts = useMemo(() => {
        if (fetchFilterMode === 'count') {
            const platformFiltered = selectedFetchPlatform === 'all'
                ? accounts
                : accounts.filter(a => a.platform === selectedFetchPlatform);
            return platformFiltered.slice(0, fetchCount);
        }
        let filtered = accounts.filter(a => {
            const matchesPlatform = selectedFetchPlatform === 'all' || a.platform === selectedFetchPlatform;
            const matchesUser = selectedFetchUser === 'all' || (a.assignedTo === selectedFetchUser);
            return matchesPlatform && matchesUser;
        });

        if (targetedIdsText.trim()) {
            const pastedList = targetedIdsText.split(/[\n,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
            filtered = filtered.filter(a => pastedList.includes(a.id.toLowerCase()) || pastedList.includes(a.identifier.toLowerCase()));
        }

        return filtered;
    }, [accounts, fetchCount, fetchFilterMode, selectedFetchPlatform, selectedFetchUser, targetedIdsText]);

    const handleFetchClick = () => {
        if (!onFetchOrders) return;
        const ids = targetedAccounts.map(a => a.id);
        (onFetchOrders as any)(ids);
    }


    const allOrders: DisplayOrder[] = useMemo(() => {
        return accounts.flatMap(acc => (acc.orders || []).map(o => ({
            ...o,
            accountIdentifier: acc.identifier,
            platform: acc.platform
        })));
    }, [accounts]);

    // Stats calculation
    const stats = useMemo(() => {
        return {
            pending: allOrders.filter(o => o.status?.toLowerCase().includes('processing') || o.status?.toLowerCase().includes('ordered')).length,
            ready: allOrders.filter(o => o.status?.toLowerCase().includes('packed') || o.status?.toLowerCase().includes('shipping')).length,
            shipped: allOrders.filter(o => o.status?.toLowerCase().includes('shipped') || o.status?.toLowerCase().includes('delivery')).length,
            returns: allOrders.filter(o => o.status?.toLowerCase().includes('return') || o.status?.toLowerCase().includes('cancel')).length
        };
    }, [allOrders]);

    // Calculate fetch progress
    const fetchProgress = useMemo(() => {
        if (!orderStates) return { done: 0, total: 0 };
        const total = Object.keys(orderStates).length;
        const done = Object.values(orderStates).filter(s => s.status === 'done' || s.status === 'error').length;
        return { done, total };
    }, [orderStates]);

    const currentAccount = accounts.find(a => a.id === fetchingAccountId);

    const filteredOrders = allOrders.filter(order => {
        // Text Search
        const matchesSearch = order.orderId.toLowerCase().includes(searchQuery.toLowerCase()) ||
            order.productName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (order.trackingId && order.trackingId.toLowerCase().includes(searchQuery.toLowerCase()));

        // Status Filter
        let matchesFilter = true;
        if (filterStatus !== 'all') {
            const status = (order.status || '').toLowerCase();
            if (filterStatus === 'processing') {
                matchesFilter = status.includes('processing') || status.includes('ordered') || status.includes('confirmed') || status.includes('approval');
            } else if (filterStatus === 'shipped') {
                matchesFilter = status.includes('shipped') || status.includes('ready') || status.includes('out for delivery') || status.includes('arriving') || status.includes('expected') || status.includes('transit') || status.includes('way');
            } else if (filterStatus === 'delivered') {
                matchesFilter = status.includes('delivered');
            } else if (filterStatus === 'cancelled') {
                matchesFilter = status.includes('cancel') || status.includes('return') || status.includes('refund');
            }
        }

        return matchesSearch && matchesFilter;
    });

    const finalFilteredOrders = useMemo(() => {
        if (viewPlatform === 'all') return filteredOrders;
        return filteredOrders.filter(o => o.platform === viewPlatform);
    }, [filteredOrders, viewPlatform]);

    const handleExportCSV = () => {
        const headers = [
            'Order ID', 
            'Product Name', 
            'Status', 
            'Price', 
            'Delivery Date', 
            'Order Date',
            'Tracking ID', 
            'Carrier',
            'OTP',
            'Mobile (Last 4)',
            'Address',
            'Receiver Name',
            'Account Identifier', 
            'Platform'
        ];

        const escapeCSV = (val: string | undefined | null) => {
            if (val === undefined || val === null) return '""';
            const s = String(val).replace(/"/g, '""');
            return `"${s}"`;
        };

        const csvContent = [
            headers.join(','),
            ...finalFilteredOrders.map(o => [
                escapeCSV(o.orderId),
                escapeCSV(o.productName),
                escapeCSV(o.status),
                escapeCSV(o.price),
                escapeCSV(o.deliveryDate),
                escapeCSV(o.orderDate),
                escapeCSV(o.trackingId),
                escapeCSV(o.carrier),
                escapeCSV(o.otp),
                o.mobileLast4 ? escapeCSV(`****${o.mobileLast4}`) : '""',
                escapeCSV(o.address),
                escapeCSV(o.receiverName),
                escapeCSV(o.accountIdentifier),
                escapeCSV(o.platform)
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `orders_export_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            {/* Loading Banner */}
            {isLoading && (
                <div className="bg-brand-primary/10 border border-brand-primary/20 rounded-xl p-4 flex items-center gap-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-brand-primary border-t-transparent"></div>
                    <div className="flex-1">
                        <p className="text-sm font-bold text-text-primary">
                            Fetching orders... ({fetchProgress.done}/{fetchProgress.total} accounts)
                        </p>
                        {currentAccount && (
                            <p className="text-xs text-text-secondary mt-0.5">
                                Currently fetching: <span className="font-medium">{currentAccount.identifier}</span> ({currentAccount.platform})
                            </p>
                        )}
                    </div>
                    <div className="w-32 h-2 bg-bg-surface-hover rounded-full overflow-hidden">
                        <div
                            className="h-full bg-brand-primary transition-all duration-300 rounded-full"
                            style={{ width: `${fetchProgress.total > 0 ? (fetchProgress.done / fetchProgress.total) * 100 : 0}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-text-primary tracking-tight">Order Management</h2>
                    <p className="text-text-secondary text-sm mt-1">Track and process orders across {accounts.length} connected accounts.</p>
                </div>
                <div className="flex gap-3 relative">
                    {/* SMART FETCH CONTROLS */}
                    <div className="flex items-center glass border border-border-subtle rounded-2xl p-1.5 gap-1.5 shadow-float transition-all hover:shadow-lg hover:border-brand-primary/20">
                        {/* Mode Switcher */}
                        <div className="flex bg-slate-100/50 rounded-xl p-1">
                            <button
                                onClick={() => setFetchFilterMode('count')}
                                className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all duration-300 ${fetchFilterMode === 'count' ? 'bg-white shadow-sm text-brand-primary scale-105' : 'text-text-tertiary hover:text-text-secondary hover:bg-white/50'}`}
                            >
                                Batch
                            </button>
                            <button
                                onClick={() => setFetchFilterMode('filter')}
                                className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all duration-300 ${fetchFilterMode === 'filter' ? 'bg-white shadow-sm text-brand-primary scale-105' : 'text-text-tertiary hover:text-text-secondary hover:bg-white/50'}`}
                            >
                                Targeted
                            </button>
                        </div>

                        {fetchFilterMode === 'count' ? (
                            <div className="flex items-center px-2 gap-2">
                                {/* Platform Selector in Batch mode */}
                                <div className="relative group mr-2">
                                    <select
                                        value={selectedFetchPlatform}
                                        onChange={(e) => {
                                            const newPlatform = e.target.value;
                                            setSelectedFetchPlatform(newPlatform);
                                            // Set count to min(10, available accounts for this platform)
                                            const availableCount = newPlatform === 'all'
                                                ? accounts.length
                                                : accounts.filter(a => a.platform === newPlatform).length;
                                            setFetchCount(Math.min(10, availableCount));
                                        }}
                                        className="appearance-none bg-transparent text-[11px] font-bold text-text-primary pr-4 cursor-pointer focus:outline-none"
                                    >
                                        <option value="all">Any Platform</option>
                                        {availablePlatforms.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                                    </select>
                                    <ChevronDown size={10} className="absolute right-0 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                                </div>
                                <div className="h-5 w-px bg-border-subtle/50" />
                                
                                <div className="flex items-center bg-white/50 rounded-lg px-1 border border-transparent hover:border-brand-primary/10 transition-colors">
                                    <button
                                        onClick={() => setFetchCount(c => Math.max(1, c - 1))}
                                        disabled={isLoading || fetchCount <= 1}
                                        className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-brand-primary disabled:opacity-30 transition-colors"
                                    >
                                        <span className="text-lg leading-none">−</span>
                                    </button>
                                    <input
                                        type="number"
                                        value={fetchCount}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            if (!isNaN(val)) {
                                                setFetchCount(Math.min(availablePlatformAccountsCount, Math.max(0, val)));
                                            } else if (e.target.value === '') {
                                                setFetchCount(0);
                                            }
                                        }}
                                        onBlur={() => {
                                            if (fetchCount === 0) setFetchCount(Math.min(10, availablePlatformAccountsCount || 1));
                                        }}
                                        className="w-10 text-center text-sm font-black text-brand-primary bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                    <button
                                        onClick={() => {
                                            setFetchCount(c => Math.min(availablePlatformAccountsCount, c + 1));
                                        }}
                                        disabled={isLoading || fetchCount >= availablePlatformAccountsCount}
                                        className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-brand-primary disabled:opacity-30 transition-colors"
                                    >
                                        <span className="text-lg leading-none">+</span>
                                    </button>
                                </div>
                                <span className="text-[10px] font-bold text-text-tertiary bg-slate-100 px-1.5 py-0.5 rounded-md min-w-[32px] text-center">
                                    / {availablePlatformAccountsCount}
                                </span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 px-2">
                                {/* Platform Dropdown */}
                                <div className="relative group">
                                    <select
                                        value={selectedFetchPlatform}
                                        onChange={(e) => setSelectedFetchPlatform(e.target.value)}
                                        className="appearance-none bg-transparent text-xs font-bold text-text-primary pr-4 cursor-pointer focus:outline-none"
                                    >
                                        <option value="all">All Platforms</option>
                                        {availablePlatforms.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                                    </select>
                                    <ChevronDown size={12} className="absolute right-0 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                                </div>
                                <div className="h-4 w-px bg-border-subtle" />
                                {/* User Dropdown (if any users defined) */}
                                {availableUsers.length > 0 && (
                                    <div className="relative group">
                                        <select
                                            value={selectedFetchUser}
                                            onChange={(e) => setSelectedFetchUser(e.target.value)}
                                            className="appearance-none bg-transparent text-xs font-bold text-text-primary pr-4 cursor-pointer focus:outline-none"
                                        >
                                            <option value="all">All Users</option>
                                            {availableUsers.map(u => <option key={u} value={u}>{u}</option>)}
                                        </select>
                                        <ChevronDown size={12} className="absolute right-0 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                                    </div>
                                )}
                                <div className="h-4 w-px bg-border-subtle" />
                                <input
                                    type="text"
                                    placeholder="Paste comma/space separated IDs..."
                                    value={targetedIdsText}
                                    onChange={e => setTargetedIdsText(e.target.value)}
                                    className="bg-transparent text-[11px] font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none w-48 border-b border-dashed border-border-subtle focus:border-brand-primary pb-0.5"
                                />
                            </div>
                        )}

                        <button
                            onClick={handleFetchClick}
                            disabled={isLoading || !onFetchOrders || targetedAccounts.length === 0}
                            className="ml-2 px-6 py-2.5 bg-gradient-to-r from-brand-primary to-indigo-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:opacity-90 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-primary/20"
                        >
                            {isLoading ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} className="animate-pulse" />}
                            {isLoading ? 'FETCHING...' : `FETCH ${targetedAccounts.length} ORDERS`}
                        </button>
                    </div>

                    <div className="relative">
                        <button
                            onClick={() => setIsFilterOpen(!isFilterOpen)}
                            className={`px-4 py-2.5 border text-xs font-bold rounded-xl flex items-center gap-2 transition-colors ${filterStatus !== 'all'
                                ? 'bg-brand-primary text-white border-brand-primary'
                                : 'bg-bg-surface border-border-subtle text-text-secondary hover:bg-bg-surface-hover'
                                }`}
                        >
                            <Filter size={14} />
                            FILTER {filterStatus !== 'all' && `(${filterStatus})`}
                        </button>

                        {/* Filter Dropdown */}
                        {isFilterOpen && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setIsFilterOpen(false)} />
                                <div className="absolute right-0 top-full mt-2 w-48 bg-bg-surface rounded-xl shadow-xl border border-border-subtle z-20 overflow-hidden py-1">
                                    {[
                                        { id: 'all', label: 'All Orders' },
                                        { id: 'processing', label: 'Processing' },
                                        { id: 'shipped', label: 'Shipped / In Transit' },
                                        { id: 'delivered', label: 'Delivered' },
                                        { id: 'cancelled', label: 'Cancelled / Returns' }
                                    ].map(option => (
                                        <button
                                            key={option.id}
                                            onClick={() => {
                                                setFilterStatus(option.id);
                                                setIsFilterOpen(false);
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-bg-surface-hover flex items-center justify-between text-text-secondary hover:text-text-primary"
                                        >
                                            {option.label}
                                            {filterStatus === option.id && <Check size={14} className="text-brand-primary" />}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    <button
                        onClick={handleExportCSV}
                        className="px-4 py-2.5 bg-brand-accent text-white font-bold text-xs rounded-xl hover:opacity-90 transition-colors shadow-lg shadow-brand-accent/20 flex items-center gap-2"
                    >
                        <ArrowUpRight size={16} />
                        EXPORT CSV
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-bg-surface p-6 rounded-card shadow-card border border-border-subtle">
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-500 mb-1">Processing</p>
                    <p className="text-3xl font-black text-text-primary">{stats.pending}</p>
                </div>
                <div className="bg-bg-surface p-6 rounded-card shadow-card border border-border-subtle">
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-500 mb-1">Ready / Shipped</p>
                    <p className="text-3xl font-black text-text-primary">{stats.ready + stats.shipped}</p>
                </div>
                <div className="bg-bg-surface p-6 rounded-card shadow-card border border-border-subtle">
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-500 mb-1">Total Found</p>
                    <p className="text-3xl font-black text-text-primary">{allOrders.length}</p>
                </div>
                <div className="bg-bg-surface p-6 rounded-card shadow-card border border-border-subtle">
                    <p className="text-xs font-bold uppercase tracking-wider text-red-500 mb-1">Returns / Cancelled</p>
                    <p className="text-3xl font-black text-text-primary">{stats.returns}</p>
                </div>
            </div>

            {/* Table Area */}
            <div className="bg-bg-surface rounded-card shadow-card overflow-hidden flex flex-col min-h-[400px] border border-border-subtle">
                {/* Toolbar */}
                <div className="p-4 border-b border-border-subtle flex items-center justify-between gap-4 bg-bg-surface-hover/30">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" size={16} />
                        <input
                            type="text"
                            placeholder="Search by Order ID, Tracking ID, or Product..."
                            className="w-full pl-10 pr-4 py-2.5 bg-bg-surface border border-border-subtle rounded-xl text-sm focus:border-brand-primary outline-none transition-all placeholder:text-text-tertiary text-text-primary shadow-sm"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-text-tertiary uppercase tracking-wider mr-1">View Info:</span>
                        <div className="relative">
                            <select
                                value={viewPlatform}
                                onChange={(e) => setViewPlatform(e.target.value)}
                                className={`appearance-none pl-4 pr-10 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer outline-none ${viewPlatform !== 'all' ? 'bg-brand-primary/10 border-brand-primary text-brand-primary' : 'bg-bg-surface border-border-subtle text-text-secondary'
                                    }`}
                            >
                                <option value="all">All Platforms</option>
                                {availablePlatforms.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50" />
                        </div>
                    </div>
                </div>

                {/* Table */}
                {finalFilteredOrders.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="text-text-tertiary font-bold text-[10px] uppercase tracking-widest border-b border-border-subtle bg-bg-surface-hover/20">
                                <tr>
                                    <th className="px-6 py-4 font-medium">Order Details</th>
                                    <th className="px-6 py-4 font-medium">Product</th>
                                    <th className="px-6 py-4 font-medium">Status</th>
                                    <th className="px-6 py-4 font-medium">Price</th>
                                    <th className="px-6 py-4 font-medium">Delivery Info</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border-subtle">
                                {finalFilteredOrders.map(order => (
                                    <tr 
                                        key={order.orderId} 
                                        onClick={() => setSelectedOrder(order)}
                                        className="hover:bg-bg-surface-hover transition-colors group cursor-pointer active:bg-bg-surface-hover/50"
                                    >
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-bg-canvas flex items-center justify-center shrink-0 border border-border-subtle">
                                                    <PlatformIcon name={order.platform} size={20} />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-text-primary text-sm">{order.orderId}</p>
                                                    <p className="text-xs text-text-tertiary mt-0.5">{order.accountIdentifier} ({order.platform})</p>
                                                    {order.otp && (
                                                        <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 bg-yellow-100 text-yellow-800 text-[10px] font-bold rounded-md border border-yellow-200">
                                                            OTP: {order.otp} <Copy size={10} />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 max-w-xs">
                                            <div className="flex items-center gap-3">
                                                {order.imageUrl && (
                                                    <img src={order.imageUrl} alt="Product" className="w-8 h-8 rounded-md object-cover border border-border-subtle" />
                                                )}
                                                <p className="font-semibold text-text-primary text-sm truncate" title={order.productName}>{order.productName}</p>
                                            </div>
                                            {order.receiverName && (
                                                <p className="text-xs text-text-secondary mt-1">To: {order.receiverName}</p>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border ${order.status?.includes('Delivered') ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                                order.status?.includes('Shipp') ? 'bg-blue-50 text-blue-700 border-blue-100' :
                                                    order.status?.includes('Cancel') ? 'bg-red-50 text-red-700 border-red-100' :
                                                        'bg-amber-50 text-amber-700 border-amber-100'
                                                }`}>
                                                {order.status?.includes('Delivered') && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2"></span>}
                                                {order.status}
                                            </span>
                                            {order.trackingId && (
                                                <div className="flex items-center gap-1 mt-2 text-[10px] text-text-tertiary font-mono">
                                                    <Truck size={10} />
                                                    {order.trackingId}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="font-bold text-text-primary text-base">{order.price}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2 text-xs text-text-secondary font-medium">
                                                    <Clock size={14} className="text-text-tertiary" />
                                                    {order.deliveryDate || 'No date'}
                                                </div>
                                                {order.carrier && (
                                                    <div className="flex items-center gap-1 text-[10px] text-text-tertiary">
                                                        <Truck size={10} />
                                                        {order.carrier}
                                                    </div>
                                                )}
                                                {order.address && (
                                                    <p className="text-[10px] text-text-tertiary truncate max-w-[150px]" title={order.address}>
                                                        📍 {order.address}
                                                    </p>
                                                )}
                                                {order.mobileLast4 && (
                                                    <p className="text-[10px] text-text-tertiary">
                                                        📱 ****{order.mobileLast4}
                                                    </p>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary py-20">
                        <div className="w-16 h-16 bg-bg-canvas rounded-full flex items-center justify-center mb-4">
                            <ShoppingBag size={24} className="opacity-50" />
                        </div>
                        <p className="font-medium text-text-secondary">No orders found</p>
                        <p className="text-sm">Connect accounts and fetch orders to see them here.</p>
                    </div>
                )}
            </div>

            {/* Maximized Detail View */}
            {selectedOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-10 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-2xl h-[80vh] rounded-[2.5rem] shadow-2xl relative overflow-hidden border border-slate-200">
                        <OrderDetailModal 
                            order={selectedOrder} 
                            onClose={() => setSelectedOrder(null)} 
                        />
                    </div>
                </div>
            )}
        </div>
    );
};
