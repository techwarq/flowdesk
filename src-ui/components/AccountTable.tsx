import React, { useState } from 'react';
import { Account } from '../types';
import { AccountRow } from './AccountRow';
import { api } from '../api/client';
import { Share, Trash2, RefreshCw, Smartphone } from 'lucide-react';

interface Props {
    accounts: Account[];
    onRefresh: () => void;
}

export const AccountTable: React.FC<Props> = ({ accounts, onRefresh }) => {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);
    const [transferring, setTransferring] = useState(false);
    const [targetUser, setTargetUser] = useState('');
    const [users, setUsers] = useState<any[]>([]);

    React.useEffect(() => {
        api.getAdminProfiles().then(setUsers).catch(console.error);
    }, []);

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === accounts.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(accounts.map(a => a.id)));
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;

        console.log('[UI] Bulk delete triggered for', selectedIds.size, 'accounts');

        setDeleting(true);
        try {
            for (const id of Array.from(selectedIds)) {
                await api.deleteAccount(id);
            }
            setSelectedIds(new Set());
            onRefresh();
        } catch (e) {
            console.error('Bulk delete error:', e);
        } finally {
            setDeleting(false);
        }
    };

    const handleBulkTransfer = async () => {
        if (selectedIds.size === 0 || !targetUser) return;
        
        setTransferring(true);
        try {
            const ids = Array.from(selectedIds);
            const res = await api.moveAccounts(ids, targetUser);
            if (res.success) {
                alert(`Successfully moved ${res.count} accounts.`);
                setSelectedIds(new Set());
                onRefresh();
            } else {
                alert(`Transfer failed: ${res.message}`);
            }
        } catch (e) {
            console.error('Bulk transfer error:', e);
            alert('Transfer failed');
        } finally {
            setTransferring(false);
        }
    };

    return (
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-500 h-full flex flex-col">
            {/* Bulk Actions Bar */}
            {selectedIds.size > 0 && (
                <div className="bg-slate-900 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
                        <span className="text-sm font-black text-white uppercase tracking-wider">
                            {selectedIds.size} Identifiers Selected
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center bg-white/10 rounded-2xl overflow-hidden h-12 p-1 border border-white/10">
                            <select
                                value={targetUser}
                                onChange={(e) => setTargetUser(e.target.value)}
                                className="px-4 py-1 text-xs bg-transparent outline-none border-none text-white font-bold min-w-[180px] appearance-none"
                            >
                                <option value="" className="text-slate-900">Choose Receiver...</option>
                                {users.map((u, i) => (
                                    <option key={i} value={u.id || u.username} className="text-slate-900">{u.username}</option>
                                ))}
                            </select>
                            <button
                                onClick={handleBulkTransfer}
                                disabled={transferring || !targetUser}
                                className="px-6 h-full bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-30 transition-all flex items-center gap-2 rounded-xl"
                            >
                                {transferring ? <RefreshCw className="animate-spin" size={12} /> : <Share size={12} />}
                                DEPLOY TRANSFER
                            </button>
                        </div>
                        <div className="w-[1px] h-6 bg-white/10 mx-1" />
                        <button
                            onClick={handleBulkDelete}
                            disabled={deleting}
                            className="w-12 h-12 flex items-center justify-center bg-red-500/10 text-red-400 rounded-2xl hover:bg-red-500 hover:text-white disabled:opacity-30 transition-all border border-red-500/20"
                            title="Purge Selected"
                        >
                            {deleting ? (
                                <RefreshCw className="animate-spin" size={18} />
                            ) : (
                                <Trash2 size={18} />
                            )}
                        </button>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-auto scrollbar-hide">
                <table className="w-full text-left border-collapse min-w-[1000px]">
                    <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-100">
                            <th className="py-5 px-6 w-12">
                                <input
                                    type="checkbox"
                                    checked={accounts.length > 0 && selectedIds.size === accounts.length}
                                    onChange={toggleSelectAll}
                                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                            </th>
                            <th className="py-5 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Platform</th>
                            <th className="py-5 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Identifier</th>
                            <th className="py-5 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Assignee</th>
                            <th className="py-5 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Status</th>
                            <th className="py-5 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Sync Time</th>
                            <th className="py-5 px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Operations</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {accounts.length > 0 ? (
                            accounts.map(acc => (
                                <AccountRow
                                    key={acc.id}
                                    account={acc}
                                    onRefresh={onRefresh}
                                    selected={selectedIds.has(acc.id)}
                                    onToggleSelect={() => toggleSelect(acc.id)}
                                />
                            ))
                        ) : (
                            <tr>
                                <td colSpan={8} className="py-20 text-center text-slate-400 italic font-medium">
                                    <div className="flex flex-col items-center gap-2 opacity-50">
                                        <Smartphone size={32} />
                                        <span>No active identifiers found in this view</span>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
