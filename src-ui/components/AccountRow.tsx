import React, { useState } from 'react';
import { Account, Platform } from '../types';
import { api } from '../api/client';

interface Props {
    account: Account;
    onRefresh: () => void;
    selected?: boolean;
    onToggleSelect?: () => void;
}

export const AccountRow: React.FC<Props> = ({ account, onRefresh, selected = false, onToggleSelect }) => {
    const [loading, setLoading] = useState(false);
    const [actionStatus, setActionStatus] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

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
        if (!showConfirm) {
            console.log(`[UI] Showing confirmation for ${account.id}`);
            setShowConfirm(true);
            // Auto-cancel after 3 seconds if not confirmed
            setTimeout(() => setShowConfirm(false), 3000);
            return;
        }

        console.log(`[UI] Deletion confirmed for: ${account.id}`);
        setLoading(true);
        try {
            console.log(`[UI] Calling delete API for ${account.id}`);
            const result = await api.deleteAccount(account.id);
            console.log(`[UI] Delete API result for ${account.id}:`, result);
            onRefresh();
        } catch (e) {
            console.error(`[UI] Failed to delete account ${account.id}:`, e);
            alert('Failed to delete');
            setShowConfirm(false);
        } finally {
            setLoading(false);
        }
    };

    const statusStyles = {
        'Healthy': 'bg-green-100 text-green-700',
        'New': 'bg-blue-100 text-blue-700',
        'Error': 'bg-red-100 text-red-700',
        'OTPRequired': 'bg-orange-100 text-orange-700',
        'NeedsRefresh': 'bg-yellow-100 text-yellow-700',
        'Locked': 'bg-slate-100 text-slate-700'
    };

    return (
        <tr className={`border-b border-slate-100 hover:bg-slate-50 transition-colors group ${selected ? 'bg-indigo-50' : ''}`}>
            <td className="py-4 px-4">
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={onToggleSelect}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
            </td>
            <td className="py-4 px-4 text-xs font-bold text-slate-500 uppercase">
                {account.platform}
            </td>
            <td className="py-4 px-4">
                <div className="font-medium text-slate-900">{account.id}</div>
            </td>
            <td className="py-4 px-4 text-slate-600 text-sm">
                {account.assignedTo || '-'}
            </td>
            <td className="py-4 px-4 text-slate-600 font-mono text-sm">
                {account.identifier}
            </td>
            <td className="py-4 px-4 text-center">
                {actionStatus ? (
                    <span className="text-xs font-bold text-indigo-600 animate-pulse">{actionStatus}</span>
                ) : (
                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${statusStyles[account.status] || 'bg-slate-100'}`}>
                        {account.status}
                    </span>
                )}
            </td>
            <td className="py-4 px-4 text-slate-500 text-xs">
                {account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString() : 'Never'}
            </td>
            <td className="py-4 px-4">
                <div className="flex items-center justify-end space-x-2">
                    <button
                        onClick={() => handleOpenPlatform('flipkart')}
                        disabled={loading}
                        className="px-3 py-1.5 text-[11px] font-bold border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
                    >
                        FLIPKART
                    </button>
                    <button
                        onClick={() => handleOpenPlatform('shopsy')}
                        disabled={loading}
                        className="px-3 py-1.5 text-[11px] font-bold bg-black text-white rounded hover:bg-slate-800 disabled:opacity-50"
                    >
                        SHOPSY
                    </button>
                    <button
                        onClick={handleRefresh}
                        disabled={loading}
                        className="px-3 py-1.5 text-[11px] font-bold border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
                    >
                        REFRESH
                    </button>
                    <button
                        onClick={handleDelete}
                        disabled={loading}
                        className={`flex items-center space-x-1 px-2 py-1.5 transition-all duration-200 rounded-lg border ${showConfirm
                            ? 'bg-red-600 text-white border-transparent'
                            : 'bg-slate-50 text-slate-400 hover:text-red-600 border-slate-200 hover:border-red-100'
                            }`}
                        title={showConfirm ? "Confirm Deletion" : "Delete Account"}
                    >
                        {showConfirm ? (
                            <span className="text-[10px] font-bold uppercase">Confirm?</span>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        )}
                    </button>
                </div>
            </td>
        </tr>
    );
};
