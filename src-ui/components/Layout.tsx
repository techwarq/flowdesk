import React from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
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

interface LayoutProps {
    username: string;
    role: 'admin' | 'staff' | 'user';
    accounts: Account[];
    activeAccountId?: string;
    navItems: NavItem[];
    onSelectAccount: (accountId: string) => void;
    onRemoveAccount?: (accountId: string) => void;
    onAddAccount: () => void;
    onRefresh: () => void;
    onSignOut: () => void;
    children: React.ReactNode;
    showAccountSelector?: boolean;
}

export const Layout: React.FC<LayoutProps> = ({
    username,
    role,
    accounts,
    activeAccountId,
    navItems,
    onSelectAccount,
    onRemoveAccount,
    onAddAccount,
    onRefresh,
    onSignOut,
    children,
    showAccountSelector = true
}) => {
    const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
    const isAdmin = role === 'admin';

    return (
        <div className="h-screen w-screen flex overflow-hidden bg-slate-50">
            {/* Left Sidebar */}
            <Sidebar
                username={username}
                role={role}
                accounts={accounts}
                activeAccountId={activeAccountId}
                navItems={navItems}
                onSelectAccount={onSelectAccount}
                onRemoveAccount={onRemoveAccount}
                onSignOut={onSignOut}
                collapsed={sidebarCollapsed}
                onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Top Bar */}
                <TopBar
                    accounts={accounts}
                    activeAccountId={activeAccountId}
                    onSelectAccount={onSelectAccount}
                    onAddAccount={onAddAccount}
                    onRefresh={onRefresh}
                    isAdmin={isAdmin}
                    showAccountSelector={showAccountSelector && !isAdmin}
                />

                {/* Content */}
                <main className="flex-1 overflow-y-auto">
                    {children}
                </main>
            </div>
        </div>
    );
};
