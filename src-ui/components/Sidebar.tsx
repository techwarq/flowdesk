import React from 'react';
import { Account } from '../types';

interface NavItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    badge?: string;
}

interface SidebarProps {
    username: string;
    role: 'admin' | 'staff' | 'user';
    accounts: Account[];
    activeAccountId?: string;
    navItems: NavItem[];
    onSelectAccount: (accountId: string) => void;
    onRemoveAccount?: (accountId: string) => void;
    onSignOut: () => void;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    username,
    role,
    accounts,
    activeAccountId,
    navItems,
    onSelectAccount,
    onRemoveAccount,
    onSignOut,
    collapsed = false,
    onToggleCollapse
}) => {
    const isAdmin = role === 'admin';

    return (
        <aside className={`bg-slate-900 text-white flex flex-col h-full transition-all duration-300 ${collapsed ? 'w-16' : 'w-60'}`}>
            {/* Header / Logo */}
            <div className="px-4 py-5 border-b border-slate-700 flex items-center justify-between">
                {!collapsed && (
                    <div>
                        <h1 className="text-lg font-black tracking-tight">FLOWDESK</h1>
                        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            {isAdmin ? 'Admin Panel' : 'User Dashboard'}
                        </span>
                    </div>
                )}
                {collapsed && <span className="text-lg font-black">F</span>}
                {onToggleCollapse && (
                    <button
                        onClick={onToggleCollapse}
                        className="p-1 rounded hover:bg-slate-700 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d={collapsed ? "M13 5l7 7-7 7M5 5l7 7-7 7" : "M11 19l-7-7 7-7m8 14l-7-7 7-7"} />
                        </svg>
                    </button>
                )}
            </div>

            {/* User Profile */}
            <div className="px-4 py-4 border-b border-slate-700">
                <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold">
                        {username.charAt(0).toUpperCase()}
                    </div>
                    {!collapsed && (
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{username}</p>
                            <p className="text-[10px] text-slate-400 uppercase font-medium">{role}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Connected IDs (for non-admin users) */}
            {!isAdmin && accounts.length > 0 && (
                <div className="px-4 py-3 border-b border-slate-700">
                    {!collapsed && (
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                            Connected IDs
                        </p>
                    )}
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                        {accounts.map(acc => (
                            <div
                                key={acc.id}
                                className={`flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${activeAccountId === acc.id
                                    ? 'bg-indigo-600'
                                    : 'hover:bg-slate-700'
                                    }`}
                                onClick={() => onSelectAccount(acc.id)}
                            >
                                <div className="flex items-center space-x-2 min-w-0">
                                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${acc.platform === 'flipkart' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'
                                        }`}>
                                        {collapsed ? acc.platform.charAt(0).toUpperCase() : acc.platform.slice(0, 3).toUpperCase()}
                                    </span>
                                    {!collapsed && (
                                        <span className="text-xs truncate">{acc.identifier}</span>
                                    )}
                                </div>
                                {!collapsed && onRemoveAccount && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onRemoveAccount(acc.id); }}
                                        className="p-1 rounded hover:bg-red-500/30 text-slate-400 hover:text-red-400 transition-colors"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Navigation */}
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                {navItems.map(item => (
                    <button
                        key={item.id}
                        onClick={item.onClick}
                        disabled={item.disabled}
                        className={`w-full flex items-center px-3 py-2.5 rounded-lg transition-all text-left group ${item.active
                            ? 'bg-indigo-600 text-white'
                            : item.disabled
                                ? 'text-slate-500 cursor-not-allowed'
                                : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                            }`}
                    >
                        <span className="w-5 h-5 flex-shrink-0">{item.icon}</span>
                        {!collapsed && (
                            <>
                                <span className="ml-3 text-sm font-medium flex-1">{item.label}</span>
                                {item.badge && (
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${item.badge === 'In Process'
                                        ? 'bg-amber-500/20 text-amber-400'
                                        : 'bg-slate-600 text-slate-300'
                                        }`}>
                                        {item.badge}
                                    </span>
                                )}
                            </>
                        )}
                    </button>
                ))}
            </nav>

            {/* Sign Out */}
            <div className="px-3 py-4 border-t border-slate-700">
                <button
                    onClick={onSignOut}
                    className="w-full flex items-center px-3 py-2.5 rounded-lg text-slate-300 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    {!collapsed && <span className="ml-3 text-sm font-medium">Sign Out</span>}
                </button>
            </div>
        </aside>
    );
};
