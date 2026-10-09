import React, { useState } from 'react';
import { Account, Platform } from '../types';
import { api } from '../api/client';
import { EditAccountModal } from './EditAccountModal';
import { Edit2, Smartphone, Layers, RefreshCw, Trash2 } from 'lucide-react';

interface Props {
    account: Account;
    onRefresh: () => void;
    selected?: boolean;
    onToggleSelect?: () => void;
}

export const AccountRow: React.FC<Props> = ({ account, onRefresh, selected = false, onToggleSelect }) => {
    const [loading, setLoading] = useState(false);
    const [actionStatus, setActionStatus] = useState<string | null>(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    const handleOpenPlatform = async (platform: Platform) => {
        // Opens Playwright browser with saved cookies
        setLoading(true);
        setActionStatus(`Opening ${platform}...`);
        try {
            const res = await api.openSession(account.id, platform);
            if (res?.status === 'error') {
                throw new Error(res.message);
            }
            setActionStatus('Browser opened');
            setTimeout(() => setActionStatus(null), 2000);
        } catch (e: any) {
            setActionStatus('Failed');
            console.error(`Failed to open ${platform}:`, e);
            alert(`Failed to open ${platform}: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleRefresh = async () => {
        setLoading(true);
        setActionStatus('Refreshing...');
        try {
            await api.checkHealth(account.id);
            onRefresh();
            setActionStatus('Healthy');
            setTimeout(() => setActionStatus(null), 3000);
        } catch (e) {
            setActionStatus('Error');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        console.log(`[UI] Deletion initiated for: ${account.id}`);
        setLoading(true);
        try {
            console.log(`[UI] Calling delete API for ${account.id}`);
            const result = await api.deleteAccount(account.id);
            console.log(`[UI] Delete API result for ${account.id}:`, result);
            onRefresh();
        } catch (e) {
            console.error(`[UI] Failed to delete account ${account.id}:`, e);
            alert('Failed to delete');
        } finally {
            setLoading(false);
        }
    };


    const statusStyles = {
        'Healthy': 'bg-emerald-100/50 text-emerald-700 ring-1 ring-emerald-500/20',
        'New': 'bg-blue-100/50 text-blue-700 ring-1 ring-blue-500/20',
        'Error': 'bg-amber-100/50 text-amber-700 ring-1 ring-amber-500/20', // Masked as NeedsRefresh in UI
        'OTPRequired': 'bg-indigo-100/50 text-indigo-700 ring-1 ring-indigo-500/20',
        'NeedsRefresh': 'bg-amber-100/50 text-amber-700 ring-1 ring-amber-500/20',
        'Locked': 'bg-slate-100/50 text-slate-700 ring-1 ring-slate-500/20'
    };

    return (
        <tr className={`border-b border-slate-50 hover:bg-indigo-50/30 transition-all group ${selected ? 'bg-indigo-50/60' : ''}`}>
            <td className="py-5 px-6">
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={onToggleSelect}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
            </td>
            <td className="py-5 px-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <span className={`px-2 py-1 rounded-lg ${account.platform === 'flipkart' ? 'bg-yellow-100 text-yellow-800' : 'bg-emerald-100 text-emerald-800'}`}>
                    {account.platform}
                </span>
            </td>
            <td className="py-5 px-4">
                <div className="font-black text-slate-900 text-sm tracking-tight">{account.identifier}</div>
                <div className="text-[10px] font-bold text-slate-400 font-mono tracking-tighter uppercase">{account.id.slice(0, 8)}...</div>
            </td>
            <td className="py-5 px-4 text-slate-500 text-xs font-bold uppercase tracking-tight">
                {account.assignedTo || 'Unassigned'}
            </td>
            <td className="py-5 px-4 text-center">
                {actionStatus ? (
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest animate-pulse">{actionStatus}</span>
                ) : (
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                        account.status === 'Error' ? statusStyles['NeedsRefresh'] : (statusStyles[account.status] || 'bg-slate-100')
                        }`}>
                        {account.status === 'Error' ? 'Needs Refresh' : account.status}
                    </span>
                 )}
            </td>
            <td className="py-5 px-4 text-slate-400 text-[11px] font-bold">
                {account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'NEVER SYNCED'}
            </td>
            <td className="py-5 px-6">
                <div className="flex items-center justify-end gap-2 translate-x-2 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
                    <button
                        onClick={() => handleOpenPlatform('flipkart')}
                        disabled={loading}
                        className="p-2.5 bg-white border border-slate-200 rounded-xl hover:border-yellow-400 hover:text-yellow-600 transition-all shadow-sm"
                        title="Open Flipkart"
                    >
                         <Smartphone size={16} />
                    </button>
                    <button
                        onClick={() => handleOpenPlatform('shopsy')}
                        disabled={loading}
                        className="p-2.5 bg-slate-900 text-white rounded-xl hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-600/20"
                        title="Open Shopsy"
                    >
                         <Layers size={16} />
                    </button>
                    <button
                        onClick={handleRefresh}
                        disabled={loading}
                        className="p-2.5 bg-white border border-slate-200 rounded-xl hover:border-indigo-400 hover:text-indigo-600 transition-all shadow-sm"
                        title="Sync Health"
                    >
                        <RefreshCw className={loading ? 'animate-spin' : ''} size={16} />
                    </button>
                    <div className="w-[1px] h-6 bg-slate-100 mx-1" />
                    <button
                        onClick={() => setIsEditModalOpen(true)}
                        disabled={loading}
                        className="p-2.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                    >
                        <Edit2 size={16} />
                    </button>
                    <button
                        onClick={handleDelete}
                        disabled={loading}
                        className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                        title="Purge Identifier"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>

                <EditAccountModal
                    isOpen={isEditModalOpen}
                    onClose={() => setIsEditModalOpen(false)}
                    onSuccess={onRefresh}
                    account={account}
                />
            </td>
        </tr>
    );
};
