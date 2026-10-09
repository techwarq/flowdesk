import React from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Chatbot } from './Chatbot';
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
    showSearch?: boolean;
    showAddButton?: boolean;
    showAccountSelector?: boolean;
    onSearch?: (query: string) => void;
    fullScreen?: boolean;
    onSwitchToUser?: () => void; // Optional for Admin only
    onSwitchToAdmin?: () => void;
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
    showAccountSelector = true,
    showSearch = true,
    showAddButton = true,
    onSearch,
    fullScreen = false,
    onSwitchToUser,
    onSwitchToAdmin
}) => {
    const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
    const isAdmin = role === 'admin';

    // If fullScreen, we remove main layout padding/gap
    const mainContainerClasses = fullScreen
        ? "h-screen w-screen flex overflow-hidden bg-bg-canvas"
        : "h-screen w-screen flex overflow-hidden bg-bg-canvas p-4 gap-4";

    return (
        <div className={mainContainerClasses}>
            {/* Left Sidebar - Detached */}
            <Sidebar
                username={username}
                role={role}
                accounts={accounts}
                activeAccountId={activeAccountId}
                navItems={navItems}
                onSelectAccount={onSelectAccount}
                onRemoveAccount={onRemoveAccount}
                onSignOut={onSignOut}
                collapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                onSwitchToUser={onSwitchToUser}
                onSwitchToAdmin={onSwitchToAdmin}
            />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 rounded-2xl overflow-hidden relative">
                {/* Top Bar */}
                {/* Top Bar - Hidden in fullScreen mode */}
                {!fullScreen && (
                    <TopBar
                        accounts={accounts}
                        activeAccountId={activeAccountId}
                        onSelectAccount={onSelectAccount}
                        onAddAccount={onAddAccount}
                        onRefresh={onRefresh}
                        isAdmin={isAdmin}
                        showAccountSelector={showAccountSelector && !isAdmin}
                        showSearch={showSearch}
                        showAddButton={showAddButton}
                        onSearch={onSearch}
                    />
                )}

                {/* Content */}
                <main className="flex-1 overflow-y-auto scrollbar-hide">
                    {children}
                </main>

                {/* Aastha Chatbot - Global */}
                <Chatbot />
            </div>
        </div>
    );
};
