import React from 'react';
import { Account } from '../types';

interface TopBarProps {
    accounts: Account[];
    activeAccountId?: string;
    onSelectAccount: (accountId: string) => void;
    onAddAccount: () => void;
    onRefresh: () => void;
    isAdmin?: boolean;
    showAccountSelector?: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
    accounts,
    activeAccountId,
    onSelectAccount,
    onAddAccount,
    onRefresh,
    isAdmin = false,
    showAccountSelector = true
}) => {
    const activeAccount = accounts.find(a => a.id === activeAccountId);
    const [dropdownOpen, setDropdownOpen] = React.useState(false);

    const getStatusColor = (status?: string) => {
        switch (status) {
            case 'Healthy': return 'bg-green-500';
            case 'Error': return 'bg-red-500';
            case 'NeedsRefresh': return 'bg-yellow-500';
            default: return 'bg-slate-400';
        }
    };

    return (
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-4">
                {/* Active Account Selector */}
                {showAccountSelector && !isAdmin && accounts.length > 0 && (
                    <div className="relative">
                        <button
                            onClick={() => setDropdownOpen(!dropdownOpen)}
                            className="flex items-center space-x-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors min-w-[200px]"
                        >
                            {activeAccount ? (
                                <>
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${activeAccount.platform === 'flipkart'
                                        ? 'bg-yellow-100 text-yellow-700'
                                        : 'bg-green-100 text-green-700'
                                        }`}>
                                        {activeAccount.platform.slice(0, 3)}
                                    </span>
                                    <span className="text-sm font-medium text-slate-700 flex-1 text-left truncate">
                                        {activeAccount.identifier}
                                    </span>
                                    <span className={`w-2 h-2 rounded-full ${getStatusColor(activeAccount.status)}`} />
                                </>
                            ) : (
                                <span className="text-sm text-slate-500">Select Account</span>
                            )}
                            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {/* Dropdown */}
                        {dropdownOpen && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
                                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 max-h-60 overflow-y-auto">
                                    {accounts.map(acc => (
                                        <button
                                            key={acc.id}
                                            onClick={() => { onSelectAccount(acc.id); setDropdownOpen(false); }}
                                            className={`w-full flex items-center space-x-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors ${activeAccountId === acc.id ? 'bg-indigo-50' : ''
                                                }`}
                                        >
                                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${acc.platform === 'flipkart'
                                                ? 'bg-yellow-100 text-yellow-700'
                                                : 'bg-green-100 text-green-700'
                                                }`}>
                                                {acc.platform.slice(0, 3)}
                                            </span>
                                            <span className="text-sm text-slate-700 flex-1 truncate">{acc.identifier}</span>
                                            <span className={`w-2 h-2 rounded-full ${getStatusColor(acc.status)}`} />
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Status Indicator */}
                {activeAccount && !isAdmin && (
                    <div className="flex items-center space-x-2 text-xs text-slate-500">
                        <span className={`w-2 h-2 rounded-full ${getStatusColor(activeAccount.status)}`} />
                        <span className="font-medium">{activeAccount.status}</span>
                    </div>
                )}
            </div>

            <div className="flex items-center space-x-2">
                {/* Add New ID Button */}
                <button
                    onClick={onAddAccount}
                    className="flex items-center px-3 py-2 bg-indigo-600 text-white text-[11px] font-bold uppercase rounded-lg hover:bg-indigo-700 transition-colors"
                >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add ID
                </button>

                {/* Refresh Button */}
                <button
                    onClick={onRefresh}
                    className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    title="Refresh All"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                </button>
            </div>
        </header>
    );
};
