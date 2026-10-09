import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { X, Mail, Lock, Server, Cloud, Database, Key, Save, RefreshCw, Loader2, Globe } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
    const [loading, setLoading] = useState(false);
    const [masterUser, setMasterUser] = useState('');
    const [masterPass, setMasterPass] = useState('');
    const [masterHost, setMasterHost] = useState('imap.gmail.com');
    const [cloudEnabled, setCloudEnabled] = useState(false);
    const [cloudUrl, setCloudUrl] = useState('');
    const [cloudKey, setCloudKey] = useState('');
    const [proxies, setProxies] = useState('');

    useEffect(() => {
        if (isOpen) {
            loadSettings();
            loadProxies();
        }
    }, [isOpen]);

    const loadProxies = async () => {
        try {
            const list = await api.getProxies();
            if (Array.isArray(list)) {
                setProxies(list.join('\n'));
            }
        } catch (e) { console.error('Failed to load proxies', e); }
    };

    const loadSettings = async () => {
        try {
            const s = await api.getSettings();
            if (s.masterEmail) {
                setMasterUser(s.masterEmail.user || '');
                setMasterHost(s.masterEmail.host || 'imap.gmail.com');
                setMasterPass('********');
            }
            if (s.cloudConfig) {
                setCloudEnabled(s.cloudConfig.enabled || false);
                setCloudUrl(s.cloudConfig.url || '');
                setCloudKey(s.cloudConfig.key || '');
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            // Save Settings
            const current = await api.getSettings();
            const finalMasterEmail = {
                ...current.masterEmail,
                user: masterUser,
                host: masterHost,
            };
            if (masterPass !== '********') {
                finalMasterEmail.passEncrypted = btoa(masterPass);
            }

            const finalSettings = {
                masterEmail: finalMasterEmail,
                cloudConfig: {
                    enabled: cloudEnabled,
                    url: cloudUrl,
                    key: cloudKey
                }
            };

            await api.saveSettings(finalSettings);

            // Save Proxies
            const proxyList = proxies.split('\n').map(p => p.trim()).filter(p => p.length > 0);
            await api.saveProxies(proxyList);

            onClose();
            // TODO: Use a proper toast notification system instead of alert
            alert('Settings & Proxies Saved');
        } catch (err) {
            console.error(err);
            alert('Failed to save settings');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-bg-surface rounded-card shadow-float w-full max-w-2xl p-0 overflow-hidden scale-100 animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col border border-border-subtle">
                {/* Header */}
                <div className="px-6 py-5 border-b border-border-subtle flex items-center justify-between bg-bg-surface-hover shrink-0">
                    <h2 className="text-lg font-black text-text-primary tracking-tight flex items-center gap-2">
                        <div className="p-1.5 bg-bg-canvas rounded-lg text-text-secondary">
                            <Server size={18} />
                        </div>
                        APP SETTINGS
                    </h2>
                    <button onClick={onClose} className="p-2 text-text-tertiary hover:text-text-primary hover:bg-bg-canvas rounded-lg transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                    <form id="settings-form" onSubmit={handleSubmit} className="space-y-8">
                        {/* Section 1: Master OTP */}
                        <section className="space-y-4">
                            <div>
                                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                                    <Mail size={16} className="text-brand-accent" />
                                    MASTER OTP CONFIGURATION
                                </h3>
                                <p className="text-xs text-text-secondary mt-1 ml-6">Configure the master email account to automatically fetch OTPs.</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-6">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-text-tertiary uppercase tracking-wider">Email Address</label>
                                    <input
                                        type="email"
                                        value={masterUser}
                                        onChange={e => setMasterUser(e.target.value)}
                                        className="block w-full rounded-xl border-border-subtle shadow-sm focus:border-brand-primary focus:ring-brand-primary text-sm py-2 px-3 transition-shadow bg-bg-canvas text-text-primary"
                                        placeholder="master@example.com"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-text-tertiary uppercase tracking-wider">App Password</label>
                                    <div className="relative">
                                        <input
                                            type="password"
                                            value={masterPass}
                                            onChange={e => setMasterPass(e.target.value)}
                                            placeholder="Enter App Password"
                                            className="block w-full rounded-xl border-border-subtle shadow-sm focus:border-brand-primary focus:ring-brand-primary text-sm py-2 px-3 transition-shadow pr-10 bg-bg-canvas text-text-primary"
                                        />
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary">
                                            <Lock size={14} />
                                        </div>
                                    </div>
                                </div>
                                <div className="md:col-span-2 space-y-1.5">
                                    <label className="text-xs font-bold text-text-tertiary uppercase tracking-wider">Email Provider</label>
                                    <select
                                        value={masterHost}
                                        onChange={e => setMasterHost(e.target.value)}
                                        className="block w-full rounded-xl border-border-subtle shadow-sm focus:border-brand-primary focus:ring-brand-primary text-sm py-2 px-3 bg-bg-canvas cursor-pointer text-text-primary"
                                    >
                                        <option value="imap.gmail.com">Gmail (imap.gmail.com)</option>
                                        <option value="outlook.office365.com">Outlook / Hotmail</option>
                                    </select>
                                </div>
                            </div>
                        </section>

                        <div className="border-t border-border-subtle" />

                        {/* Section 2: Proxy Configuration */}
                        <section className="space-y-4">
                            <div>
                                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                                    <Globe size={16} className="text-emerald-500" />
                                    PROXY CONFIGURATION
                                </h3>
                                <p className="text-xs text-text-secondary mt-1 ml-6">Manage your rotating proxy pool. Enter one proxy per line.</p>
                                <p className="text-[10px] text-text-tertiary ml-6 font-mono">Format: http://user:pass@host:port</p>
                            </div>

                            <div className="ml-6 space-y-1.5">
                                <textarea
                                    value={proxies}
                                    onChange={e => setProxies(e.target.value)}
                                    placeholder={`http://user:pass@host:port\nhttp://host:port`}
                                    className="block w-full h-32 rounded-xl border-border-subtle shadow-sm focus:border-brand-primary focus:ring-brand-primary text-xs font-mono py-3 px-3 transition-shadow bg-bg-canvas text-text-primary resize-none"
                                />
                                <div className="text-[10px] text-text-tertiary flex justify-between">
                                    <span>Supports HTTP/HTTPS proxies.</span>
                                    <span>{proxies.split('\n').filter(p => p.trim()).length} proxies loaded</span>
                                </div>
                            </div>
                        </section>

                        <div className="border-t border-border-subtle" />

                        {/* Section 3: Cloud Sync */}
                        <section className="space-y-4">
                            <div>
                                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                                    <Cloud size={16} className="text-blue-500" />
                                    CLOUD SYNCHRONIZATION
                                </h3>
                                <p className="text-xs text-text-secondary mt-1 ml-6">Sync accounts and sessions across devices.</p>
                            </div>

                            <div className="ml-6 flex items-center mb-4">
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" checked={cloudEnabled} onChange={e => setCloudEnabled(e.target.checked)} className="sr-only peer" />
                                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-primary"></div>
                                    <span className="ml-3 text-sm font-medium text-text-primary">Enable Cloud Sync</span>
                                </label>
                            </div>

                            <div className={`space-y-4 ml-6 transition-opacity ${cloudEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-text-tertiary uppercase tracking-wider flex items-center gap-1.5">
                                        <Database size={12} /> Cloud Database URL
                                    </label>
                                    <input
                                        type="text"
                                        value={cloudUrl}
                                        onChange={e => setCloudUrl(e.target.value)}
                                        placeholder="https://xxx.supabase.co"
                                        className="block w-full rounded-xl border-border-subtle shadow-sm focus:border-brand-primary focus:ring-brand-primary text-sm py-2 px-3 font-mono text-text-secondary bg-bg-canvas"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-text-tertiary uppercase tracking-wider flex items-center gap-1.5">
                                        <Key size={12} /> Service Role Key
                                    </label>
                                    <input
                                        type="password"
                                        value={cloudKey}
                                        onChange={e => setCloudKey(e.target.value)}
                                        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                                        className="block w-full rounded-xl border-border-subtle shadow-sm focus:border-brand-primary focus:ring-brand-primary text-sm py-2 px-3 font-mono text-text-secondary bg-bg-canvas"
                                    />
                                </div>

                                {cloudEnabled && (
                                    <div className="pt-2">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                if (confirm('Pull all data from Cloud? This might overwrite local changes.')) {
                                                    setLoading(true);
                                                    try {
                                                        const res = await api.cloudSyncPull();
                                                        if (res.success) alert('Sync Complete!');
                                                        else alert('Sync Failed: ' + res.error);
                                                    } catch (e) { alert('Sync Error'); }
                                                    finally { setLoading(false); }
                                                }
                                            }}
                                            className="text-xs font-bold text-brand-primary hover:text-indigo-800 bg-indigo-50 hover:bg-brand-primary/10 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 w-fit border border-brand-primary/20"
                                        >
                                            <RefreshCw size={14} />
                                            PULL DATA FROM CLOUD
                                        </button>
                                    </div>
                                )}
                            </div>
                        </section>
                    </form>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-border-subtle bg-bg-canvas flex justify-end gap-3 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2.5 text-xs font-bold text-text-secondary bg-bg-surface border border-border-subtle rounded-xl hover:bg-bg-surface-hover transition-colors"
                    >
                        CANCEL
                    </button>
                    <button
                        type="submit"
                        form="settings-form"
                        disabled={loading}
                        className="px-6 py-2.5 text-xs font-bold text-white bg-brand-primary rounded-xl hover:opacity-90 transition-colors shadow-lg shadow-brand-primary/20 flex items-center gap-2"
                    >
                        {loading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        {loading ? 'SAVING...' : 'SAVE SETTINGS'}
                    </button>
                </div>
            </div>
        </div>
    );
};
