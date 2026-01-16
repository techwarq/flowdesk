import React, { useState } from 'react';
import { Account } from '../types';
import { AccountRow } from './AccountRow';
import { api } from '../api/client';

interface Props {
    accounts: Account[];
    onRefresh: () => void;
}

export const AccountTable: React.FC<Props> = ({ accounts, onRefresh }) => {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);

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
            const idsToDelete = Array.from(selectedIds);
            console.log('[UI] Deleting accounts:', idsToDelete);

            for (const id of idsToDelete) {
                console.log('[UI] Deleting:', id);
                await api.deleteAccount(id);
            }

            console.log('[UI] All deletions complete');
            setSelectedIds(new Set());
            onRefresh();
        } catch (e) {
            console.error('Bulk delete error:', e);
            alert('Some deletions may have failed');
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Bulk Actions Bar */}
            {selectedIds.size > 0 && (
                <div className="bg-indigo-50 border-b border-indigo-200 px-4 py-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-indigo-700">
                        {selectedIds.size} account(s) selected
                    </span>
                    <button
                        onClick={handleBulkDelete}
                        disabled={deleting}
                        className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center space-x-2"
                    >
                        {deleting ? (
                            <>
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span>Deleting...</span>
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                <span>Delete Selected</span>
                            </>
                        )}
                    </button>
                </div>
            )}

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="py-3 px-4 w-10">
                                <input
                                    type="checkbox"
                                    checked={accounts.length > 0 && selectedIds.size === accounts.length}
                                    onChange={toggleSelectAll}
                                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                            </th>
                            <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Platform</th>
                            <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Account ID</th>
                            <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Profile Name</th>
                            <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Identifier</th>
                            <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-center">Status</th>
                            <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Last Login</th>
                            <th className="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
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
                                <td colSpan={8} className="py-12 text-center text-slate-400 italic">
                                    No accounts matching your filters
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
