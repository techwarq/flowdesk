import React, { useState, useMemo, useCallback } from 'react';
import {
    X,
    Plus,
    Minus,
    Link2,
    Trash2,
    Users,
    CheckSquare,
    Square,
    Play,
    RefreshCw,
    Monitor,
    Layers,
    AlertCircle,
    Loader2,
    ClipboardPaste,
    XCircle
} from 'lucide-react';
import { Account, Platform } from '../types';
import { PlatformIcon } from './Icons';

interface BulkUrlOpenerProps {
    savedAccounts: Account[];
    onClose: () => void;
    onOpenBulk: (config: BulkOpenConfig) => void;
}

export interface BulkOpenConfig {
    urls: string[];
    accountIds: string[];
    platform: Platform;
    browserType: 'browser_1' | 'browser_2';
    rotateIp: boolean;
}

interface ProgressState {
    isRunning: boolean;
    current: number;
    total: number;
    status: string;
}

// All platforms for the tab bar
const ALL_PLATFORMS: { value: Platform; label: string }[] = [
    { value: 'flipkart', label: 'Flipkart' },
    { value: 'shopsy', label: 'Shopsy' },
    { value: 'amazon', label: 'Amazon' },
    { value: 'blinkit', label: 'Blinkit' },
    { value: 'reliance', label: 'Reliance' },
    { value: 'reliancedigital', label: 'Rel. Digital' },
    { value: 'vivo', label: 'Vivo' },
    { value: 'oppo', label: 'Oppo' },
    { value: 'redmi', label: 'Redmi' },
    { value: 'realme', label: 'Realme' },
    { value: 'samsung', label: 'Samsung' },
    { value: 'vijaysales', label: 'Vijay Sales' },
    { value: 'oneplus', label: 'OnePlus' },
    { value: 'xiaomi', label: 'Xiaomi' },
    { value: 'iqoo', label: 'iQOO' },
];

// Validate any URL
const isValidProductUrl = (url: string): boolean => {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
};

// Detect platform from URL
const detectPlatform = (url: string): Platform | null => {
    if (url.includes('flipkart.com')) return 'flipkart';
    if (url.includes('shopsy.in')) return 'shopsy';
    if (url.includes('samsung.com')) return 'samsung';
    if (url.includes('amazon.in') || url.includes('amazon.com')) return 'amazon';
    return null;
};

// Group accounts by platform (keep Flipkart and Shopsy separate for independent selection)
const groupAccountsByPlatform = (accounts: Account[]) => {
    const grouped = accounts.reduce((acc, account) => {
        const p = account.platform;
        if (!acc[p]) acc[p] = [];
        acc[p].push(account);
        return acc;
    }, {} as Record<string, Account[]>);

    return grouped;
};

export const BulkUrlOpener: React.FC<BulkUrlOpenerProps> = ({
    savedAccounts,
    onClose,
    onOpenBulk
}) => {
    // URL Management
    const [urlInput, setUrlInput] = useState('');
    const [urls, setUrls] = useState<string[]>([]);
    const [urlError, setUrlError] = useState<string | null>(null);

    // Account Selection - Using Set for O(1) operations
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Paste IDs
    const [pasteText, setPasteText] = useState('');
    const [invalidIds, setInvalidIds] = useState<string[]>([]);

    // Configuration
    const [browserType, setBrowserType] = useState<'browser_1' | 'browser_2'>('browser_1');
    const [rotateIp, setRotateIp] = useState(false);
    const [selectedPlatform, setSelectedPlatform] = useState<Platform>('flipkart');
    const [accountLimit, setAccountLimit] = useState(15);

    // Progress (read-only, updates come from parent via callback)
    const progress: ProgressState = {
        isRunning: false,
        current: 0,
        total: 0,
        status: ''
    };

    // Group accounts
    const groupedAccounts = useMemo(() => groupAccountsByPlatform(savedAccounts), [savedAccounts]);

    // Accounts currently visible based on selected platform
    const visibleAccounts = useMemo(() => {
        if (selectedPlatform === 'flipkart' || selectedPlatform === 'shopsy') {
            return [
                ...(groupedAccounts['flipkart'] || []),
                ...(groupedAccounts['shopsy'] || [])
            ];
        }
        return groupedAccounts[selectedPlatform] || [];
    }, [groupedAccounts, selectedPlatform]);

    // Add URL handler
    const handleAddUrl = useCallback(() => {
        const trimmedUrl = urlInput.trim();

        if (!trimmedUrl) {
            setUrlError('Please enter a URL');
            return;
        }

        // Add https if missing
        let processedUrl = trimmedUrl;
        if (!processedUrl.startsWith('http')) {
            processedUrl = 'https://' + processedUrl;
        }

        if (!isValidProductUrl(processedUrl)) {
            setUrlError('Please enter a valid URL');
            return;
        }

        if (urls.includes(processedUrl)) {
            setUrlError('URL already added');
            return;
        }

        setUrls(prev => [...prev, processedUrl]);

        // Auto-detect and set platform if it's the first URL
        const platform = detectPlatform(processedUrl);
        if (platform) {
            setSelectedPlatform(platform);
        }

        setUrlInput('');
        setUrlError(null);
    }, [urlInput, urls]);

    // Remove URL
    const handleRemoveUrl = useCallback((index: number) => {
        setUrls(prev => prev.filter((_, i) => i !== index));
    }, []);

    // Toggle account selection
    const toggleAccount = useCallback((id: string) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                if (newSet.size >= accountLimit) {
                    setUrlError(`Limit reached: You can select up to ${accountLimit} accounts`);
                    return prev;
                }
                newSet.add(id);
                setUrlError(null);
            }
            return newSet;
        });
    }, [accountLimit]);

    // Select/Deselect all for the currently visible accounts
    const toggleSelectAll = useCallback(() => {
        const allSelected = visibleAccounts.every((acc: Account) => selectedIds.has(acc.id));

        setSelectedIds(prev => {
            if (allSelected) {
                // Deselect only visible accounts
                const newSet = new Set(prev);
                visibleAccounts.forEach((acc: Account) => newSet.delete(acc.id));
                return newSet;
            } else {
                // Select up to limit
                const newSet = new Set(prev);
                for (const acc of visibleAccounts) {
                    if (newSet.size >= accountLimit) break;
                    newSet.add(acc.id);
                }
                if (newSet.size < prev.size + visibleAccounts.filter(a => !prev.has(a.id)).length && newSet.size === accountLimit) {
                    setUrlError(`Limit reached: Selected top ${accountLimit} accounts`);
                }
                return newSet;
            }
        });
    }, [visibleAccounts, selectedIds, accountLimit]);

    // Handle paste IDs validation
    const handleValidatePastedIds = useCallback(() => {
        if (!pasteText.trim()) return;

        // Split by newlines, commas, spaces, or tabs
        const rawIds = pasteText
            .split(/[\n,\t\s]+/)
            .map(s => s.trim())
            .filter(Boolean);

        const newInvalid: string[] = [];
        const newSelected = new Set(selectedIds);

        for (const rawId of rawIds) {
            // Case-insensitive match against visible accounts
            const match = visibleAccounts.find(
                (acc: Account) => acc.identifier.toLowerCase() === rawId.toLowerCase()
            );

            if (match) {
                if (newSelected.size < accountLimit) {
                    newSelected.add(match.id);
                }
            } else {
                // Check if it's already in invalid list
                if (!newInvalid.some(id => id.toLowerCase() === rawId.toLowerCase())) {
                    newInvalid.push(rawId);
                }
            }
        }

        setSelectedIds(newSelected);
        setInvalidIds(newInvalid);
        setPasteText('');
    }, [pasteText, visibleAccounts, selectedIds, accountLimit]);

    // Remove a single invalid ID chip
    const removeInvalidId = useCallback((id: string) => {
        setInvalidIds(prev => prev.filter(i => i !== id));
    }, []);

    // Clear all invalid IDs
    const clearAllInvalid = useCallback(() => {
        setInvalidIds([]);
    }, []);

    // Handle bulk open
    const handleOpenAll = useCallback(() => {
        if (urls.length === 0) {
            setUrlError('Add at least one URL');
            return;
        }

        if (selectedIds.size === 0) {
            setUrlError('Select at least one account');
            return;
        }

        const config: BulkOpenConfig = {
            urls,
            accountIds: Array.from(selectedIds),
            platform: selectedPlatform,
            browserType,
            rotateIp
        };

        onOpenBulk(config);
    }, [urls, selectedIds, selectedPlatform, browserType, rotateIp, onOpenBulk]);

    // Count selected for currently visible accounts
    const getSelectedCount = useCallback(() => {
        return visibleAccounts.filter((acc: Account) => selectedIds.has(acc.id)).length;
    }, [visibleAccounts, selectedIds]);

    // Count how many platforms have accounts
    const platformCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const p of ALL_PLATFORMS) {
            if (p.value === 'flipkart' || p.value === 'shopsy') {
                counts[p.value] = (groupedAccounts['flipkart']?.length || 0) + (groupedAccounts['shopsy']?.length || 0);
            } else {
                counts[p.value] = groupedAccounts[p.value]?.length || 0;
            }
        }
        return counts;
    }, [groupedAccounts]);

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-purple-50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
                            <Layers className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900">Bulk URL Opener</h2>
                            <p className="text-xs text-slate-500">Open product links across multiple accounts</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/80 rounded-xl transition-colors text-slate-400 hover:text-slate-600"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {/* URL Input Section */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                            <Link2 size={16} className="text-indigo-500" />
                            Product URLs
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Paste any product URL..."
                                value={urlInput}
                                onChange={(e) => {
                                    setUrlInput(e.target.value);
                                    setUrlError(null);
                                }}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
                                className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                            />
                            <button
                                onClick={handleAddUrl}
                                className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-semibold text-sm transition-colors flex items-center gap-2 shadow-lg shadow-indigo-200"
                            >
                                <Plus size={16} />
                                Add
                            </button>
                        </div>

                        {urlError && (
                            <div className="flex items-center gap-2 text-red-500 text-xs">
                                <AlertCircle size={14} />
                                {urlError}
                            </div>
                        )}

                        {/* URL List */}
                        {urls.length > 0 && (
                            <div className="bg-slate-50 rounded-xl border border-slate-100 divide-y divide-slate-100">
                                {urls.map((url, idx) => (
                                    <div key={idx} className="px-4 py-2 flex items-center justify-between gap-3 group">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <PlatformIcon name={detectPlatform(url) || 'flipkart'} className="w-4 h-4 shrink-0" />
                                            <span className="text-sm text-slate-600 truncate">{url}</span>
                                        </div>
                                        <button
                                            onClick={() => handleRemoveUrl(idx)}
                                            className="p-1.5 hover:bg-red-50 text-slate-300 hover:text-red-500 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="text-xs text-slate-400">
                            {urls.length} URL{urls.length !== 1 ? 's' : ''} added
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-slate-100" />

                    {/* Platform Pill Tabs */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                            <CheckSquare size={16} className="text-indigo-500" />
                            Select Accounts
                            <span className="ml-1 px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded-full text-xs font-bold">{selectedIds.size} selected</span>
                            {invalidIds.length > 0 && (
                                <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-bold">{invalidIds.length} invalid</span>
                            )}
                        </label>

                        {/* Platform tabs */}
                        <div className="flex flex-wrap gap-1.5">
                            {ALL_PLATFORMS.map(p => (
                                <button
                                    key={p.value}
                                    onClick={() => {
                                        setSelectedPlatform(p.value);
                                        setInvalidIds([]);
                                    }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${selectedPlatform === p.value
                                        ? 'bg-indigo-500 text-white shadow-md shadow-indigo-200'
                                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                        }`}
                                >
                                    <PlatformIcon name={p.value} size={14} className={selectedPlatform === p.value ? "brightness-0 invert" : ""} />
                                    {p.label}
                                    <span className={`ml-0.5 px-1.5 py-0.5 rounded text-[10px] ${selectedPlatform === p.value
                                        ? 'bg-white/20 text-white'
                                        : 'bg-slate-200 text-slate-400'
                                        }`}>
                                        {platformCounts[p.value] || 0}
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* Limit control */}
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-slate-500 font-medium">Limit:</span>
                            <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden h-7 shadow-sm">
                                <button
                                    onClick={() => setAccountLimit(Math.max(1, accountLimit - 1))}
                                    className="p-1 px-2 hover:bg-slate-50 text-slate-400 border-r border-slate-100 transition-colors"
                                >
                                    <Minus size={12} strokeWidth={3} />
                                </button>
                                <input
                                    type="number"
                                    value={accountLimit}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val)) setAccountLimit(Math.min(15, Math.max(1, val)));
                                    }}
                                    className="w-10 text-center text-xs font-bold text-slate-700 outline-none h-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <button
                                    onClick={() => setAccountLimit(Math.min(15, accountLimit + 1))}
                                    className="p-1 px-2 hover:bg-slate-50 text-slate-400 border-l border-slate-100 transition-colors"
                                >
                                    <Plus size={12} strokeWidth={3} />
                                </button>
                            </div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase">(Max 15)</span>
                        </div>

                        {/* Two-column: Account List + Paste Box */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Left: Account checkbox list */}
                            <div className="bg-slate-50 rounded-xl border border-slate-100 max-h-56 overflow-y-auto">
                                {(() => {
                                    const accounts = visibleAccounts;

                                    if (accounts.length === 0) {
                                        return (
                                            <div className="p-8 text-center space-y-2">
                                                <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                                                    <Users size={18} />
                                                </div>
                                                <p className="text-sm text-slate-500 font-medium">No accounts for <span className="capitalize text-indigo-600 font-bold">{selectedPlatform}</span></p>
                                                <p className="text-xs text-slate-400">Switch platform above</p>
                                            </div>
                                        );
                                    }

                                    const selectedCount = getSelectedCount();
                                    const totalAccountsOnPlatform = accounts.length;
                                    const isAtLimit = selectedIds.size >= accountLimit;
                                    const allInitiallySelected = accounts.length > 0 && accounts.every((acc: Account) => selectedIds.has(acc.id));

                                    let selectButtonText = allInitiallySelected ? 'Deselect All' : 'Select All';
                                    if (!allInitiallySelected && totalAccountsOnPlatform > accountLimit) {
                                        selectButtonText = `Select Top ${accountLimit}`;
                                    }

                                    return (
                                        <div key={selectedPlatform}>
                                            {/* Platform Header */}
                                            <div className="flex items-center justify-between px-3 py-2.5 bg-white sticky top-0 border-b border-slate-100 z-10">
                                                <div className="flex items-center gap-2">
                                                    <PlatformIcon name={selectedPlatform} size={16} />
                                                    <span className="font-bold text-xs capitalize">{selectedPlatform === 'flipkart' || selectedPlatform === 'shopsy' ? 'Flipkart / Shopsy' : selectedPlatform}</span>
                                                    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${isAtLimit ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                                                        {selectedCount}/{Math.min(totalAccountsOnPlatform, accountLimit)}
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => toggleSelectAll()}
                                                    className={`text-[11px] font-bold transition-colors ${allInitiallySelected ? 'text-red-500 hover:text-red-700' : 'text-indigo-500 hover:text-indigo-700'}`}
                                                >
                                                    {selectButtonText}
                                                </button>
                                            </div>

                                            {/* Account List */}
                                            <div className="p-1.5 space-y-0.5">
                                                {accounts.map((acc: Account) => (
                                                    <button
                                                        key={acc.id}
                                                        onClick={() => toggleAccount(acc.id)}
                                                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-left ${selectedIds.has(acc.id)
                                                            ? 'bg-indigo-50 border border-indigo-200'
                                                            : 'bg-white border border-slate-100 hover:bg-slate-100'
                                                            }`}
                                                    >
                                                        {selectedIds.has(acc.id) ? (
                                                            <CheckSquare size={14} className="text-indigo-500 shrink-0" />
                                                        ) : (
                                                            <Square size={14} className="text-slate-300 shrink-0" />
                                                        )}
                                                        <span className={`text-xs flex-1 truncate ${selectedIds.has(acc.id) ? 'text-indigo-700 font-bold' : 'text-slate-600'}`}>
                                                            {acc.identifier}
                                                        </span>
                                                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${acc.status === 'Healthy' ? 'bg-emerald-50 text-emerald-600' :
                                                            acc.status === 'Error' ? 'bg-red-50 text-red-500' :
                                                                acc.status === 'New' ? 'bg-blue-50 text-blue-500' :
                                                                    'bg-amber-50 text-amber-600'
                                                            }`}>
                                                            {acc.status}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Right: Paste IDs box */}
                            <div className="space-y-3">
                                <div className="bg-slate-50 rounded-xl border border-slate-100 p-3 space-y-3">
                                    <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
                                        <ClipboardPaste size={14} className="text-indigo-500" />
                                        Paste Account IDs
                                    </div>
                                    <textarea
                                        value={pasteText}
                                        onChange={(e) => setPasteText(e.target.value)}
                                        placeholder={`Paste emails or phone numbers here\n(one per line, or comma-separated)\n\nExample:\nuser1@email.com\nuser2@email.com, user3@email.com`}
                                        className="w-full h-28 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 resize-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-300"
                                    />
                                    <button
                                        onClick={handleValidatePastedIds}
                                        disabled={!pasteText.trim()}
                                        className="w-full px-3 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg font-bold text-xs transition-colors flex items-center justify-center gap-2 shadow-sm"
                                    >
                                        <CheckSquare size={13} />
                                        Validate & Add
                                    </button>
                                </div>

                                {/* Invalid IDs chips */}
                                {invalidIds.length > 0 && (
                                    <div className="bg-red-50 rounded-xl border border-red-200 p-3 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-bold text-red-600 flex items-center gap-1.5">
                                                <AlertCircle size={13} />
                                                {invalidIds.length} ID{invalidIds.length !== 1 ? 's' : ''} not found
                                            </span>
                                            <button
                                                onClick={clearAllInvalid}
                                                className="text-[10px] text-red-400 hover:text-red-600 font-bold transition-colors"
                                            >
                                                Clear All
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {invalidIds.map((id, idx) => (
                                                <span
                                                    key={idx}
                                                    className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-md text-[11px] font-semibold border border-red-200"
                                                >
                                                    {id}
                                                    <button onClick={() => removeInvalidId(id)} className="hover:text-red-900 transition-colors">
                                                        <XCircle size={12} />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-slate-100" />

                    {/* Configuration */}
                    <div className="grid grid-cols-2 gap-4">
                        {/* Browser Type */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                <Monitor size={16} className="text-indigo-500" />
                                Browser Type
                            </label>
                            <select
                                value={browserType}
                                onChange={(e) => setBrowserType(e.target.value as 'browser_1' | 'browser_2')}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                            >
                                <option value="browser_1">Browser 1</option>
                                <option value="browser_2">Browser 2</option>
                            </select>
                        </div>

                        {/* IP Rotation */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                <RefreshCw size={16} className="text-indigo-500" />
                                IP Rotation
                            </label>
                            <button
                                onClick={() => setRotateIp(!rotateIp)}
                                className={`w-full px-4 py-2.5 border rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${rotateIp
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                                    }`}
                            >
                                {rotateIp ? (
                                    <>
                                        <CheckSquare size={16} />
                                        Rotation Enabled
                                    </>
                                ) : (
                                    <>
                                        <Square size={16} />
                                        Rotation Disabled
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Summary */}
                    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100">
                        <div className="text-sm text-slate-600">
                            <span className="font-bold text-indigo-600">{urls.length}</span> URL{urls.length !== 1 ? 's' : ''} will be opened in{' '}
                            <span className="font-bold text-indigo-600">{selectedIds.size}</span> account{selectedIds.size !== 1 ? 's' : ''} = {' '}
                            <span className="font-bold text-purple-600">{urls.length * selectedIds.size}</span> total tabs
                            {invalidIds.length > 0 && (
                                <span className="ml-2 text-red-500 font-semibold text-xs">
                                    ({invalidIds.length} pasted ID{invalidIds.length !== 1 ? 's' : ''} skipped — not found)
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-slate-500 hover:text-slate-700 font-medium text-sm transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleOpenAll}
                        disabled={urls.length === 0 || selectedIds.size === 0 || progress.isRunning}
                        className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white rounded-xl font-semibold text-sm transition-all flex items-center gap-2 shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {progress.isRunning ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Opening... ({progress.current}/{progress.total})
                            </>
                        ) : (
                            <>
                                <Play size={16} />
                                Open All ({urls.length * selectedIds.size} tabs)
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
