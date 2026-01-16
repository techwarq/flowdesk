import React, { useState } from 'react';
import { api } from '../api/client';
import { Platform, LoginType } from '../types';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export const AddAccountModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
    const [platform, setPlatform] = useState<Platform>('flipkart');
    const [loginType, setLoginType] = useState<LoginType>('mobile');
    const [accountId, setAccountId] = useState('');
    const [identifier, setIdentifier] = useState('');
    const [profileName, setProfileName] = useState('');
    const [loading, setLoading] = useState(false);
    const [statusText, setStatusText] = useState('');

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setStatusText('Saving account...');
        try {
            await api.addAccount({
                id: accountId,
                platform,
                loginType,
                identifier: identifier,
                assignedTo: profileName,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                status: 'New'
            });

            onSuccess(); // Refresh list

            setStatusText('Opening browser...');

            // Auto-launch login - THIS WAITS FOR LOGIN TO COMPLETE
            try {
                setStatusText('🌐 Browser open - Complete login manually...');
                const res = await api.login(accountId, identifier, platform);

                if (res && res.status === 'error') {
                    throw new Error(res.message || 'Unknown backend error');
                }

                if (res && res.status === 'success') {
                    setStatusText('✓ Login complete! Synced to cloud.');
                } else if (res && res.status === 'cancelled') {
                    setStatusText('Browser closed by user.');
                } else if (res && res.status === 'warning') {
                    setStatusText('⚠ ' + res.message);
                }

                // Refresh account list again after login
                onSuccess();

            } catch (loginErr: any) {
                console.error('Login failed:', loginErr);
                setStatusText('⚠ ' + (loginErr.message || 'Login failed'));
            }

            // Short delay to let user see status then close
            setTimeout(() => {
                setLoading(false);
                onClose();
            }, 2000);

        } catch (err) {
            alert('Failed to add account');
            console.error(err);
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                <h2 className="text-xl font-bold text-slate-900 mb-4">ADD ACCOUNT</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700">PLATFORM</label>
                            <select
                                value={platform}
                                onChange={e => setPlatform(e.target.value as Platform)}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                            >
                                <option value="flipkart">Flipkart</option>
                                <option value="shopsy">Shopsy</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700">LOGIN TYPE</label>
                            <select
                                value={loginType}
                                onChange={e => setLoginType(e.target.value as LoginType)}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                            >
                                <option value="mobile">Mobile</option>
                                <option value="email">Email</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700">ACCOUNT ID</label>
                        <input
                            type="text"
                            required
                            value={accountId}
                            onChange={e => setAccountId(e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                            placeholder="e.g. rohan_flipkart"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700">PROFILE NAME</label>
                        <input
                            type="text"
                            value={profileName}
                            onChange={e => setProfileName(e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                            placeholder="e.g. Rohan Agarwal"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700">
                            {loginType === 'mobile' ? 'PHONE NUMBER' : 'EMAIL ADDRESS'}
                        </label>
                        <input
                            type="text"
                            required
                            value={identifier}
                            onChange={e => setIdentifier(e.target.value)}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                            placeholder={loginType === 'mobile' ? "e.g. 9876543210" : "e.g. name@example.com"}
                        />
                    </div>

                    {statusText && (
                        <div className="text-center py-3 px-4 rounded-lg bg-blue-50 border border-blue-200">
                            <div className="flex items-center justify-center space-x-2">
                                {loading && !statusText.includes('✓') && !statusText.includes('⚠') && (
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                                )}
                                <span className={`text-sm font-medium ${statusText.includes('✓') ? 'text-green-600' : statusText.includes('⚠') ? 'text-orange-600' : 'text-blue-600'}`}>
                                    {statusText}
                                </span>
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end space-x-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                            CANCEL
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-4 py-2 text-sm font-bold text-white bg-black border border-transparent rounded-md hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
                        >
                            {loading ? 'INITIALIZING...' : 'INITIALIZE'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
