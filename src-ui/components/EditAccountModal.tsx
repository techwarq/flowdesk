import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Account } from '../types';
import { X, Smartphone, Mail, User, Globe, Loader2, Save } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    account: Account;
}

export const EditAccountModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, account }) => {
    const [identifier, setIdentifier] = useState(account.identifier);
    const [profileName, setProfileName] = useState(account.assignedTo || '');
    const [proxy, setProxy] = useState(account.proxy || '');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setIdentifier(account.identifier);
        setProfileName(account.assignedTo || '');
        setProxy(account.proxy || '');
    }, [account]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await api.updateAccount(account.id, {
                identifier,
                assignedTo: profileName,
                proxy
            });
            onSuccess();
            onClose();
        } catch (err: any) {
            alert(`Failed to update account: ${err.message || err}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-bg-surface rounded-card shadow-float w-full max-w-md p-0 overflow-hidden scale-100 animate-in zoom-in-95 duration-200 border border-border-subtle">
                <div className="px-6 py-5 border-b border-border-subtle flex items-center justify-between bg-bg-surface-hover">
                    <h2 className="text-lg font-black text-text-primary tracking-tight flex items-center gap-2">
                        <div className="w-1 h-5 bg-brand-primary rounded-full" />
                        EDIT ACCOUNT: {account.id}
                    </h2>
                    <button onClick={onClose} className="p-2 text-text-tertiary hover:text-text-primary hover:bg-bg-canvas rounded-lg transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-text-tertiary uppercase tracking-wider flex items-center gap-1.5">
                            <User size={12} /> Profile Name
                        </label>
                        <input
                            type="text"
                            value={profileName}
                            onChange={e => setProfileName(e.target.value)}
                            className="block w-full rounded-xl border-border-subtle shadow-sm focus:border-brand-primary focus:ring-brand-primary text-sm py-2.5 px-4 font-medium placeholder:text-text-tertiary transition-shadow bg-bg-canvas text-text-primary"
                            placeholder="e.g. Rohan Agarwal"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-text-tertiary uppercase tracking-wider flex items-center gap-1.5">
                            {account.loginType === 'mobile' ? <Smartphone size={12} /> : <Mail size={12} />}
                            {account.loginType === 'mobile' ? 'Mobile Number' : 'Email Address'}
                        </label>
                        <input
                            type="text"
                            required
                            value={identifier}
                            onChange={e => setIdentifier(e.target.value)}
                            className="block w-full rounded-xl border-border-subtle shadow-sm focus:border-brand-primary focus:ring-brand-primary text-sm py-2.5 px-4 font-medium placeholder:text-text-tertiary transition-shadow bg-bg-canvas text-text-primary"
                            placeholder={account.loginType === 'mobile' ? "e.g. 9876543210" : "e.g. name@example.com"}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-text-tertiary uppercase tracking-wider flex items-center gap-1.5">
                            <Globe size={12} /> Specific Proxy (Optional)
                        </label>
                        <input
                            type="text"
                            value={proxy}
                            onChange={e => setProxy(e.target.value)}
                            className="block w-full rounded-xl border-border-subtle shadow-sm focus:border-brand-primary focus:ring-brand-primary text-sm py-2.5 px-4 font-medium placeholder:text-text-tertiary transition-shadow bg-bg-canvas text-text-primary"
                            placeholder="http://user:pass@host:port"
                        />
                        <p className="text-[10px] text-text-tertiary">If empty, a proxy from the global pool will be used.</p>
                    </div>

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3.5 bg-brand-primary text-white font-bold rounded-xl hover:opacity-90 transition-all transform active:scale-[0.99] disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-brand-primary/20 flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <Loader2 size={18} className="animate-spin" />
                            ) : (
                                <Save size={18} />
                            )}
                            <span>{loading ? 'SAVING...' : 'SAVE CHANGES'}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
