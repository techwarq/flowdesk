
import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

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

    useEffect(() => {
        if (isOpen) {
            loadSettings();
        }
    }, [isOpen]);

    const loadSettings = async () => {
        try {
            const s = await api.getSettings();
            if (s.masterEmail) {
                setMasterUser(s.masterEmail.user || '');
                setMasterHost(s.masterEmail.host || 'imap.gmail.com');
                // Encrypted pass not shown fully, but we can't really decrypt it here easily without backend help or just rewriting it.
                // For security, usually we don't pre-fill password unless placeholder.
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

        // Logic: if password is '********', assume unchanged. Ideally backend handles this.
        // simpler: If user types new password, we send it (base64 encoded).
        // If it's the placeholder, we might need a flag or just send existing data logic?
        // Let's assume user re-enters password for now or we just send what we have.
        // BETTER: If pass is '********', don't send `passEncrypted` update? 
        // Actually, let's keep it simple: Just overwrite for now.

        // Note: We build finalSettings below after fetching current settings
        // to properly merge existing password if unchanged

        // If undefined pass, backend might wipe it? The backend logic `saveSettings` does spread merge 
        // `currentSettings = { ...currentSettings, ...settings }`.
        // But `settings` object structure here is nested. `...` merge is shallow.
        // We need to valid this. Backend logic:
        // export async function saveSettings(settings: AppSettings) {
        //    currentSettings = { ...currentSettings, ...settings };
        // }
        // Since `masterEmail` is a key, if we send { masterEmail: {...} }, it overwrites the whole object.
        // So we MUST send `passEncrypted` if we want to keep it.
        // We can fetch current first, merge locally, then send.

        try {
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
            onClose();
            alert('Settings Saved');
        } catch (err) {
            console.error(err);
            alert('Failed to save settings');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 overflow-y-auto max-h-[90vh]">
                <h2 className="text-xl font-bold text-slate-900 mb-6 border-b pb-2">App Settings</h2>
                <form onSubmit={handleSubmit} className="space-y-8">

                    {/* Section 1 */}
                    <section>
                        <h3 className="text-lg font-medium text-slate-800 mb-2">Master OTP Configuration</h3>
                        <p className="text-sm text-slate-500 mb-4">The app fetches OTPs from this email automatically for all accounts.</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700">Email Address</label>
                                <input
                                    type="email"
                                    value={masterUser}
                                    onChange={e => setMasterUser(e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2 text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700">App Password (16-char)</label>
                                <input
                                    type="password"
                                    value={masterPass}
                                    onChange={e => setMasterPass(e.target.value)}
                                    placeholder="Enter App Password"
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2 text-sm"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium text-slate-700">Email Provider</label>
                                <select
                                    value={masterHost}
                                    onChange={e => setMasterHost(e.target.value)}
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2 text-sm"
                                >
                                    <option value="imap.gmail.com">Gmail</option>
                                    <option value="outlook.office365.com">Outlook / Hotmail</option>
                                </select>
                            </div>
                        </div>
                    </section>

                    {/* Section 2 */}
                    <section>
                        <h3 className="text-lg font-medium text-slate-800 mb-2">Cloud Sync (Supabase)</h3>
                        <p className="text-sm text-slate-500 mb-4">Sync accounts & cookies across multiple devices.</p>

                        <div className="flex items-center mb-4">
                            <input
                                id="cloud-enabled"
                                type="checkbox"
                                checked={cloudEnabled}
                                onChange={e => setCloudEnabled(e.target.checked)}
                                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                            />
                            <label htmlFor="cloud-enabled" className="ml-2 block text-sm text-slate-900">Enable Cloud Sync</label>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700">Cloud Database URL</label>
                                <input
                                    type="text"
                                    value={cloudUrl}
                                    onChange={e => setCloudUrl(e.target.value)}
                                    placeholder="https://xxx.supabase.co"
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2 text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700">Service Role Key</label>
                                <input
                                    type="password"
                                    value={cloudKey}
                                    onChange={e => setCloudKey(e.target.value)}
                                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2 text-sm font-mono"
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
                                        className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                        </svg>
                                        Pull Data from Cloud
                                    </button>
                                </div>
                            )}
                        </div>
                    </section>

                    <div className="flex justify-end space-x-3 pt-4 border-t">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                        >
                            {loading ? 'Saving...' : 'Save Settings'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
