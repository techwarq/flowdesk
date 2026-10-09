import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Account } from '../types';
import { Layers, ArrowRight, Search, RefreshCw } from 'lucide-react';

export const AllocationView: React.FC = () => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    // Filter States
    const [sourceUser, setSourceUser] = useState<string>('unassigned');
    const [search, setSearch] = useState('');
    const [platformFilter, setPlatformFilter] = useState<string>('all');
    const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());

    // Target State
    const [targetUser, setTargetUser] = useState<string>('');

    // Load Users
    const loadUsers = async () => {
        try {
            const profiles = await api.getAdminProfiles();
            setUsers(profiles || []);
        } catch (e) {
            console.error('Failed to load users', e);
        }
    };

    // Load Accounts
    const loadAccounts = async () => {
        setLoading(true);
        try {
            const userIdParam = sourceUser === 'unassigned' ? 'unassigned' : sourceUser;
            const res = await api.getAccounts(userIdParam);
            setAccounts(res.accounts || []);
        } catch (e) {
            console.error('Failed to load accounts', e);
            setAccounts([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadUsers(); }, []);
    useEffect(() => { loadAccounts(); }, [sourceUser]);

    const filteredAccounts = accounts.filter(acc => {
        const matchesSearch = search === '' || 
            acc.identifier.toLowerCase().includes(search.toLowerCase()) ||
            acc.id.toLowerCase().includes(search.toLowerCase());
        const matchesPlatform = platformFilter === 'all' || acc.platform === platformFilter;
        return matchesSearch && matchesPlatform;
    });

    const handleSelectAll = () => {
        if (selectedAccountIds.size === filteredAccounts.length) {
            setSelectedAccountIds(new Set());
        } else {
            setSelectedAccountIds(new Set(filteredAccounts.map(a => a.id)));
        }
    };

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedAccountIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedAccountIds(newSet);
    };

    const handleAllocate = async () => {
        if (!targetUser || selectedAccountIds.size === 0) return;
        setSubmitting(true);
        try {
            const ids = Array.from(selectedAccountIds);
            const result = await api.moveAccounts(ids, targetUser);
            if (result.success) {
                alert(`Successfully moved ${result.count} accounts.`);
                setSelectedAccountIds(new Set());
                loadAccounts();
            } else {
                alert(`Error: ${result.message || 'Transfer failed'}`);
            }
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        } finally {
            setSubmitting(false);
        }
    };

    const getTargetUsername = () => {
        const user = users.find(u => u.id === targetUser);
        return user ? user.username : '...';
    };

    return (
        <div className="p-8 max-w-[1600px] mx-auto h-full flex flex-col gap-6 animate-in fade-in duration-500">
            {/* Header Area */}
            <div className="flex items-end justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-black uppercase rounded tracking-wider">Allocation Engine</span>
                    </div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <Layers className="text-indigo-600" size={28} />
                        ID Distribution
                    </h2>
                    <p className="text-slate-500 text-sm font-medium">Reassign platform accounts between users with zero data loss.</p>
                </div>
                
                <div className="flex items-center gap-4 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="px-4 py-2 text-center border-r border-slate-100">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Available</div>
                        <div className="text-xl font-black text-slate-900">{accounts.length}</div>
                    </div>
                    <div className="px-4 py-2 text-center">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Selected</div>
                        <div className="text-xl font-black text-indigo-600">{selectedAccountIds.size}</div>
                    </div>
                </div>
            </div>

            {/* Main Layout Grid */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-8">
                
                {/* SOURCE COLUMN (LEFT) - 7 Cols */}
                <div className="lg:col-span-7 flex flex-col min-h-0 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-slate-100 space-y-4 bg-slate-50/50">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2 uppercase tracking-tight">
                                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
                                1. Select Source
                            </h3>
                            <div className="text-[11px] font-bold text-slate-400">Total Account Count: {accounts.length}</div>
                        </div>
                        
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase px-1">Source User</label>
                                    <select
                                        value={sourceUser}
                                        onChange={(e) => setSourceUser(e.target.value)}
                                        className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-sm"
                                    >
                                        <option value="unassigned">Unassigned Accounts</option>
                                        {users.map((u, i) => (
                                            <option key={i} value={u.id}>{u.username}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase px-1">Quick Search</label>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <input
                                            type="text"
                                            placeholder="Filter identifiers..."
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-sm"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex bg-white/50 p-1 rounded-2xl border border-slate-200/50 overflow-x-auto scrollbar-hide">
                                {['all', 'amazon', 'flipkart', 'iqoo', 'oneplus', 'oppo', 'realme', 'reliancedigital', 'samsung', 'shopsy', 'vijaysales', 'vivo', 'xiaomi'].map(p => (
                                    <button
                                        key={p}
                                        onClick={() => setPlatformFilter(p)}
                                        className={`px-4 py-1.5 text-[9px] font-black uppercase rounded-lg transition-all tracking-widest shrink-0 ${platformFilter === p
                                            ? 'bg-slate-900 text-white shadow-lg'
                                            : 'text-slate-400 hover:text-slate-900'}`}
                                    >
                                        {p}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Table List */}
                    <div className="flex-1 overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-white border-b border-slate-100 z-10">
                                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                    <th className="px-6 py-4 w-12">
                                        <input
                                            type="checkbox"
                                            checked={filteredAccounts.length > 0 && selectedAccountIds.size === filteredAccounts.length}
                                            onChange={handleSelectAll}
                                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                    </th>
                                    <th className="px-4 py-4">Account ID / Identifier</th>
                                    <th className="px-4 py-4">Platform</th>
                                    <th className="px-4 py-4 text-right">Last Active</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {loading ? (
                                    <tr><td colSpan={4} className="p-12 text-center text-slate-400 italic">Fetching from database...</td></tr>
                                ) : filteredAccounts.length > 0 ? (
                                    filteredAccounts.map(acc => (
                                        <tr 
                                            key={acc.id} 
                                            onClick={() => toggleSelection(acc.id)}
                                            className={`group hover:bg-indigo-50/30 transition-all cursor-pointer ${selectedAccountIds.has(acc.id) ? 'bg-indigo-50/60' : ''}`}
                                        >
                                            <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedAccountIds.has(acc.id)}
                                                    onChange={() => toggleSelection(acc.id)}
                                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="text-sm font-bold text-slate-900">{acc.identifier}</div>
                                                <div className="text-[10px] font-medium text-slate-400 font-mono">{acc.id}</div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-md ${acc.platform === 'flipkart' ? 'bg-yellow-100 text-yellow-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                                    {acc.platform}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-right text-[11px] font-bold text-slate-400 group-hover:text-slate-600 transition-colors">
                                                {acc.lastLoginAt ? new Date(acc.lastLoginAt).toLocaleDateString() : 'Never'}
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr><td colSpan={4} className="p-12 text-center text-slate-400">No accounts found.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* TARGET COLUMN (RIGHT) - 5 Cols */}
                <div className="lg:col-span-5 flex flex-col gap-6">
                    
                    {/* Destination Selection */}
                    <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                         <h3 className="text-sm font-black text-slate-900 flex items-center gap-2 uppercase tracking-tight mb-2">
                            <span className="w-2 h-2 bg-emerald-500 rounded-full" />
                            2. Choose Destination
                        </h3>
                        
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase px-1">Target Receiver</label>
                            <select
                                value={targetUser}
                                onChange={(e) => setTargetUser(e.target.value)}
                                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-base font-black text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                            >
                                <option value="">Select Target User...</option>
                                {users.filter(u => u.id !== sourceUser).map((u, i) => (
                                    <option key={i} value={u.id}>{u.username}</option>
                                ))}
                            </select>
                        </div>

                        {/* Summary Card */}
                        <div className="bg-slate-900 rounded-3xl p-6 text-white relative overflow-hidden">
                             <div className="relative z-10 space-y-4">
                                <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Transfer Summary</div>
                                <div className="flex flex-col gap-1">
                                    <div className="text-3xl font-black">{selectedAccountIds.size} <span className="text-slate-500 text-lg uppercase font-bold tracking-tight">IDs</span></div>
                                    <div className="flex items-center gap-2 text-slate-400 font-bold text-sm">
                                        TO USER: {targetUser ? <span className="text-emerald-400">{getTargetUsername()}</span> : 'Not Selected'}
                                    </div>
                                </div>
                                <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                                    Initiating this action will instantly re-bind all session data, cookies, and local storage to the target user. This cannot be undone automatically.
                                </p>
                             </div>
                             {/* Decorative Background Element */}
                             <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-indigo-500/10 blur-3xl rounded-full" />
                        </div>

                        <button
                            onClick={handleAllocate}
                            disabled={selectedAccountIds.size === 0 || !targetUser || submitting}
                            className={`w-full py-5 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all ${
                                selectedAccountIds.size === 0 || !targetUser
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-600/20 active:scale-95'
                            }`}
                        >
                            {submitting ? (
                                <RefreshCw className="animate-spin" size={20} />
                            ) : (
                                <ArrowRight size={20} strokeWidth={3} />
                            )}
                            {submitting ? 'PROCESSING...' : 'CONFIRM TRANSFER'}
                        </button>
                    </div>

                    {/* Quick Analytics Tip */}
                    <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 flex gap-4 items-start">
                        <div className="p-2 bg-white rounded-xl text-emerald-600 shadow-sm">
                            <Layers size={20} />
                        </div>
                        <div className="space-y-1">
                            <div className="text-xs font-black text-emerald-900 uppercase">Operational Tip</div>
                            <p className="text-[11px] text-emerald-700 font-medium leading-relaxed">
                                Moving accounts between users is optimized for high-volume transfers. You can move up to 1000 IDs in a single operation.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
