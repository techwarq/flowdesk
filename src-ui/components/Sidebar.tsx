import React from 'react';
import { Account } from '../types';
import {
    ChevronLeft,
    ChevronRight,
    LogOut,
    LayoutDashboard,
    Shield
} from 'lucide-react';

interface NavItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    badge?: string;
    section?: string;
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
    onSwitchToUser?: () => void;
    onSwitchToAdmin?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    username,
    role,
    navItems,
    onSignOut,
    collapsed = false,
    onToggleCollapse,
    onSwitchToUser,
    onSwitchToAdmin
}) => {

    return (
        <aside className={`bg-bg-surface text-text-primary flex flex-col h-full transition-all duration-300 border-r border-border-subtle ${collapsed ? 'w-20' : 'w-72'}`}>
            {/* Header / Logo */}
            <div className="px-6 py-6 border-b border-border-subtle flex items-center justify-between h-20">
                {!collapsed && (
                    <div>
                        <h1 className="text-xl font-black tracking-tighter text-text-primary">ASTRA</h1>
                        <p className="text-[10px] font-bold text-text-tertiary tracking-widest uppercase">Workspace</p>
                    </div>
                )}
                <button
                    onClick={onToggleCollapse}
                    className="p-1.5 rounded-lg text-text-tertiary hover:bg-bg-surface-hover hover:text-text-primary transition-colors"
                >
                    {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
                {navItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={item.onClick}
                        disabled={item.disabled}
                        className={`w-full flex items-center px-3 py-2.5 rounded-xl transition-all duration-200 group relative ${item.active
                            ? 'bg-brand-primary text-white shadow-md shadow-brand-primary/25'
                            : 'text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary'
                            } ${item.disabled ? 'opacity-50 cursor-not-allowed hidden' : ''}`}
                    >
                        <div className={`flex items-center justify-center ${collapsed ? 'w-full' : ''}`}>
                            {item.icon}
                        </div>

                        {!collapsed && (
                            <span className="ml-3 text-sm font-medium tracking-tight flex-1 text-left">{item.label}</span>
                        )}

                        {!collapsed && item.badge && (
                            <span className="ml-auto bg-brand-secondary text-brand-primary text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                                {item.badge}
                            </span>
                        )}

                        {/* Tooltip for collapsed state */}
                        {collapsed && (
                            <div className="absolute left-full ml-4 px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl">
                                {item.label}
                            </div>
                        )}
                    </button>
                ))}
            </nav>

            {/* User Profile */}
            <div className={`px-4 py-4 border-t border-border-subtle ${collapsed ? 'flex justify-center' : ''}`}>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-200 overflow-hidden shrink-0 border-2 border-white shadow-sm">
                        <img
                            src={`https://api.dicebear.com/7.x/notionists/svg?seed=${username}`}
                            alt="Avatar"
                            className="w-full h-full object-cover"
                        />
                    </div>
                    {!collapsed && (
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-text-primary truncate">{username}</p>
                            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">{role}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Sign Out & Switch View */}
            <div className={`p-4 border-t border-border-subtle ${collapsed ? 'flex flex-col items-center' : ''}`}>
                {role === 'admin' && onSwitchToUser && (
                    <button
                        onClick={onSwitchToUser}
                        title={collapsed ? "Switch to User View" : ""}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 mb-2 rounded-xl text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary transition-all group ${collapsed ? 'justify-center' : ''}`}
                    >
                        <LayoutDashboard size={20} />
                        {!collapsed && <span className="text-sm font-medium">User View</span>}
                    </button>
                )}

                {onSwitchToAdmin && (
                    <button
                        onClick={onSwitchToAdmin}
                        title={collapsed ? "Switch to Admin Dashboard" : ""}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 mb-2 rounded-xl text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary transition-all group ${collapsed ? 'justify-center' : ''}`}
                    >
                        <Shield size={20} className="text-brand-accent" />
                        {!collapsed && <span className="text-sm font-medium">Admin Dashboard</span>}
                    </button>
                )}

                <button
                    onClick={onSignOut}
                    className="w-full flex items-center px-4 py-3 rounded-xl text-slate-400 hover:bg-slate-50 hover:text-slate-900 transition-all group"
                >
                    <LogOut size={20} className="group-hover:stroke-slate-900" />
                    {!collapsed && <span className="ml-3 text-sm font-medium">Sign Out</span>}
                </button>
            </div>
        </aside>
    );
};
