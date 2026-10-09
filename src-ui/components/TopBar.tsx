import React from 'react';
import { Account } from '../types';
import { Plus } from 'lucide-react';

interface TopBarProps {
    accounts: Account[];
    activeAccountId?: string;
    onSelectAccount: (accountId: string) => void;
    onAddAccount: () => void;
    onRefresh: () => void;
    isAdmin?: boolean;
    showAccountSelector?: boolean;
    showSearch?: boolean;
    showAddButton?: boolean;
    onSearch?: (query: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
    onAddAccount,
    showSearch = true,
    showAddButton = true,
    onSearch
}) => {
    // If no search and no add button (or if add button is hidden because search is shown? No, add button logic is handled below),
    // strictly speaking: Search is visible if showSearch. Add Button is visible if showAddButton AND !showSearch.
    // So if !showSearch AND !(showAddButton && !showSearch) -> then nothing is valid.
    // Which simplifies to: !showSearch && !showAddButton (since if !showSearch is true, the second term becomes !showAddButton).
    if (!showSearch && !showAddButton) {
        return null;
    }

    return (
        <header className="bg-bg-surface border-b border-border-subtle px-6 py-4 flex items-center justify-between shrink-0 h-20 z-20">
            {/* Search Bar - Global Search */}
            <div className={`flex-1 max-w-2xl relative mx-auto ${!showSearch ? 'hidden' : ''}`}>
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.3-4.3" />
                    </svg>
                </div>
                <input
                    type="text"
                    placeholder="Search for IDs, orders, settings..."
                    className="w-full pl-12 pr-4 py-3 bg-bg-canvas border border-border-subtle rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary/20 focus:bg-bg-surface transition-all text-sm font-medium text-text-primary placeholder:text-text-tertiary"
                    onChange={(e) => onSearch?.(e.target.value)}
                />
            </div>

            <div className="flex items-center gap-3 ml-6">
                {/* Add New ID Button - Only show if Search exists AND explicitly requested, OR if Search is hidden (Wait, user said: remove add id option from top bar where search bar is there) */}
                {/* So: if showSearch is true, DO NOT SHOW Add ID. */}
                {showAddButton && !showSearch && (
                    <button
                        onClick={onAddAccount}
                        className="flex items-center gap-2 px-4 py-2.5 bg-brand-primary text-white text-xs font-bold uppercase tracking-wider rounded-xl hover:opacity-90 transition-all shadow-sm hover:shadow-md transform active:scale-95"
                    >
                        <Plus size={16} strokeWidth={3} />
                        <span>Add ID</span>
                    </button>
                )}
            </div>
        </header>
    );
};
