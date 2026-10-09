import React, { useMemo, useState } from 'react';
import { Wallet as WalletIcon, RefreshCw, ArrowUpRight, ChevronRight, Loader, Clipboard, Check } from 'lucide-react';
import { Account, Platform } from '../types';
import { PlatformIcon } from '../components/Icons';
import { BulkPasteModal } from '../components/BulkPasteModal';

import { FetchState } from '../hooks/useDataFetcher';

interface WalletProps {
    accounts: Account[];
    onRefresh: (targetAccounts?: Account[], batchSize?: number) => void;
    isLoading?: boolean;
    fetchingAccountId?: string | null;
    gvStates?: Record<string, FetchState>;
}

export const Wallet: React.FC<WalletProps> = ({ accounts, onRefresh, isLoading, fetchingAccountId, gvStates }) => {
    const [refreshing] = useState(false);
    const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
    const [filteredIds, setFilteredIds] = useState<string[]>([]);
    const [batchSize, setBatchSize] = useState(10);

    // Aggregate Data Calculation
    const walletData = useMemo(() => {
        const platformBalances: Record<string, number> = {};
        const accountBalances: Array<{ id: string; identifier: string; platform: Platform; balance: number; fetchState?: FetchState }> = [];
        let total = 0;

        let gvAccounts = accounts.filter(acc => acc.platform === 'flipkart' || acc.platform === 'shopsy');

        if (filteredIds.length > 0) {
            gvAccounts = gvAccounts.filter(acc => 
                filteredIds.some((fid: string) => 
                    acc.identifier.toLowerCase().includes(fid.toLowerCase()) || 
                    acc.id.toLowerCase().includes(fid.toLowerCase())
                )
            );
        }

        gvAccounts.forEach(acc => {
            // Parse balance from string "₹500.00" or similar, or default to 0
            let bal = 0;
            if (acc.details?.gvBalance) {
                const numericString = acc.details.gvBalance.replace(/[^0-9.]/g, '');
                bal = parseFloat(numericString);
                if (isNaN(bal)) bal = 0;
            }
            total += bal;

            // Platform aggregation
            platformBalances[acc.platform] = (platformBalances[acc.platform] || 0) + bal;

            // Individual account data with fetch state
            accountBalances.push({
                id: acc.id,
                identifier: acc.identifier,
                platform: acc.platform,
                balance: bal,
                fetchState: gvStates?.[acc.id]
            });
        });

        return { total, platformBalances, accountBalances, filteredCount: gvAccounts.length };
    }, [accounts, gvStates, filteredIds]);

    // Calculate fetch progress
    const fetchProgress = useMemo(() => {
        if (!gvStates) return { done: 0, total: 0 };
        const total = Object.keys(gvStates).length;
        const done = Object.values(gvStates).filter(s => s.status === 'done' || s.status === 'error').length;
        return { done, total };
    }, [gvStates]);

    const currentAccount = accounts.find(a => a.id === fetchingAccountId);

    const handleRefresh = async () => {
        if (refreshing || isLoading) return;
        if (filteredIds.length > 0) {
            // Only refresh filtered accounts
            const targetAccounts = accounts.filter(acc => 
                walletData.accountBalances.some((wb: any) => wb.id === acc.id)
            );
            onRefresh(targetAccounts, batchSize);
        } else {
            onRefresh();
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0
        }).format(amount);
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            {/* Loading Banner */}
            {isLoading && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-center gap-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-emerald-500 border-t-transparent"></div>
                    <div className="flex-1">
                        <p className="text-sm font-bold text-text-primary">
                            Fetching GV balances... ({fetchProgress.done}/{fetchProgress.total} accounts)
                        </p>
                        {currentAccount && (
                            <p className="text-xs text-text-secondary mt-0.5">
                                Currently fetching: <span className="font-medium">{currentAccount.identifier}</span> ({currentAccount.platform})
                            </p>
                        )}
                    </div>
                    <div className="w-32 h-2 bg-bg-surface-hover rounded-full overflow-hidden">
                        <div
                            className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                            style={{ width: `${fetchProgress.total > 0 ? (fetchProgress.done / fetchProgress.total) * 100 : 0}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-text-primary tracking-tight">Wallet & GV</h2>
                    <p className="text-text-secondary text-sm mt-1">Aggregated Gift Voucher balances across {accounts.length} connected accounts.</p>
                </div>
                <div className="flex items-center gap-3">
                    {filteredIds.length > 0 && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-brand-primary/10 border border-brand-primary/20 rounded-xl text-[10px] font-black text-brand-primary uppercase tracking-wider">
                            <Check size={12} /> {walletData.filteredCount} Filtered
                        </div>
                    )}
                    <button
                        onClick={() => setIsPasteModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-bg-surface text-text-secondary border border-border-subtle rounded-xl text-xs font-bold hover:bg-bg-surface-hover transition-all shadow-sm"
                    >
                        <Clipboard size={14} />
                        Bulk Paste IDs
                    </button>
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing || isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white border border-transparent rounded-xl text-xs font-bold hover:opacity-90 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {(refreshing || isLoading) ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        {(refreshing || isLoading) ? 'Refreshing...' : filteredIds.length > 0 ? 'Refresh Selected' : 'Refresh Balances'}
                    </button>
                </div>
            </div>

            <BulkPasteModal 
                isOpen={isPasteModalOpen}
                onClose={() => setIsPasteModalOpen(false)}
                onApply={(ids, size) => {
                    setFilteredIds(ids);
                    setBatchSize(size);
                }}
                onClear={() => {
                    setFilteredIds([]);
                }}
                currentIds={filteredIds}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Col: Main Cards */}
                <div className="lg:col-span-2 space-y-8">

                    {/* Total Balance Card */}
                    <div className="bg-brand-primary rounded-card p-8 text-white relative overflow-hidden shadow-float">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />
                        <div className="relative z-10 flex flex-col justify-between h-40">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Total Consolidated Value</p>
                                    <h3 className="text-5xl font-black mt-3 tracking-tight">{formatCurrency(walletData.total)}</h3>
                                </div>
                                <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md border border-white/5">
                                    <WalletIcon size={24} className="text-indigo-400" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Platform Wise Breakdown */}
                    <div>
                        <h4 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
                            Platform Breakdown
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {Object.entries(walletData.platformBalances).map(([platform, amount]) => (
                                <div key={platform} className="bg-bg-surface p-5 rounded-card border border-border-subtle shadow-card flex flex-col justify-between h-32 hover:border-brand-primary/20 transition-colors">
                                    <div className="flex justify-between items-start">
                                        <PlatformIcon name={platform} size={24} />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-text-tertiary uppercase tracking-wider">{platform}</p>
                                        <p className="text-xl font-black text-text-primary mt-1">{formatCurrency(amount)}</p>
                                    </div>
                                </div>
                            ))}
                            {Object.keys(walletData.platformBalances).length === 0 && (
                                <div className="col-span-full py-8 text-center text-text-tertiary text-sm bg-bg-canvas rounded-card border border-dashed border-border-subtle">
                                    No platform data available. Add accounts to see breakdown.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* All Accounts Table */}
                    <div className="bg-bg-surface rounded-card border border-border-subtle shadow-card overflow-hidden">
                        <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center">
                            <h4 className="font-bold text-text-primary text-sm">Account-wise Balances</h4>
                            <button className="text-xs font-bold text-brand-accent hover:text-brand-primary border border-brand-accent/20 px-3 py-1.5 rounded-lg bg-brand-accent/5 hover:bg-brand-accent/10 transition-colors">Export CSV</button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-bg-surface-hover text-text-tertiary font-bold text-xs uppercase tracking-wider border-b border-border-subtle">
                                    <tr>
                                        <th className="px-6 py-3">Account ID</th>
                                        <th className="px-6 py-3">Platform</th>
                                        <th className="px-6 py-3 text-right">Available Balance</th>
                                        <th className="px-6 py-3 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border-subtle">
                                    {walletData.accountBalances.map((acc, i) => (
                                        <tr key={i} className="hover:bg-bg-surface-hover transition-colors">
                                            <td className="px-6 py-4 font-bold text-text-primary">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-8 h-8 rounded-full bg-bg-canvas flex items-center justify-center text-xs font-black text-text-secondary border border-border-subtle">
                                                        {acc.identifier.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    {acc.identifier}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 capitalize text-text-secondary font-medium">
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-bg-canvas text-text-secondary text-[10px] font-bold uppercase tracking-wide border border-border-subtle">
                                                    {acc.platform}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right font-bold text-emerald-600 font-mono text-base">
                                                {formatCurrency(acc.balance)}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button className="text-text-tertiary hover:text-brand-accent transition-colors">
                                                    <ChevronRight size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Right Sidebar: Recent Activity */}
                <div className="space-y-6">
                    <div className="bg-bg-surface rounded-card p-6 border border-border-subtle shadow-card h-full">
                        <div className="flex items-center justify-between mb-6">
                            <h4 className="font-bold text-text-primary">Recent Activity</h4>
                            <button className="text-xs font-bold text-brand-accent hover:underline">View All</button>
                        </div>
                        <div className="space-y-6 relative">
                            {/* Connector Line */}
                            <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-border-subtle -z-10"></div>

                            {(() => {
                                const allOrders = accounts.flatMap(a => (a.orders || []).map(o => ({ ...o, platform: a.platform })))
                                    .sort((a, b) => {
                                        // Simple string comparison for now if ISO-ish, or just rely on order
                                        return (b.deliveryDate || '').localeCompare(a.deliveryDate || '');
                                    })
                                    .slice(0, 5);

                                if (allOrders.length === 0) {
                                    return <div className="text-center text-text-tertiary text-xs py-10">No recent activity.</div>;
                                }

                                return allOrders.map((order, i) => (
                                    <div key={i} className="flex gap-4">
                                        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-4 border-bg-surface shadow-sm bg-red-50 text-red-500">
                                            <ArrowUpRight size={16} />
                                        </div>
                                        <div className="flex-1 pt-1">
                                            <div className="flex justify-between items-start">
                                                <p className="text-sm font-bold text-text-primary truncate max-w-[120px]" title={order.productName}>
                                                    {order.productName || 'Order Debit'}
                                                </p>
                                                <span className="text-xs font-black text-red-500 whitespace-nowrap">
                                                    -{order.price || '₹0'}
                                                </span>
                                            </div>
                                            <p className="text-xs text-text-tertiary mt-0.5 capitalize">
                                                {order.platform} • {order.status}
                                            </p>
                                        </div>
                                    </div>
                                ));
                            })()}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
