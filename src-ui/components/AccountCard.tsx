
import React, { useState } from 'react';
import { Account } from '../types';
import { api } from '../api/client';

interface Props {
    account: Account;
    onRefresh: () => void;
}

export const AccountCard: React.FC<Props> = ({ account, onRefresh }) => {
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string>('');

    const statusColor = {
        'Healthy': 'bg-green-100 text-green-800 border-green-200',
        'NeedsRefresh': 'bg-yellow-100 text-yellow-800 border-yellow-200',
        'OTPRequired': 'bg-amber-100 text-amber-800 border-amber-200',
        'Error': 'bg-red-100 text-red-800 border-red-200',
        'New': 'bg-blue-100 text-blue-800 border-blue-200',
        'Locked': 'bg-gray-100 text-gray-800 border-gray-200'
    };

    const handleCheck = async () => {
        setLoading(true);
        setMessage('Checking...');
        try {
            const res = await api.checkHealth(account.id);
            setMessage(`Result: ${res.status}`);
            onRefresh();
        } catch (e) {
            setMessage('Error checking health');
        } finally {
            setLoading(false);
        }
    };

    const aHandleLogin = async () => {
        setLoading(true);
        try {
            await api.login(account.id, account.identifier, account.platform);
            setMessage('Login started...');
        } catch (e) {
            console.error(e);
            setMessage('Login failed to start');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 transition hover:shadow-md">
            <div className="flex justify-between items-start mb-4">
                <div>
                    <h3 className="font-semibold text-lg text-slate-800">{account.id}</h3>
                    <p className="text-sm text-slate-500 capitalize">{account.platform}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium border ${
                    // Mask Error as NeedsRefresh visual
                    account.status === 'Error' ? statusColor['NeedsRefresh'] : (statusColor[account.status] || 'bg-gray-100')
                    }`}>
                    {account.status === 'Error' ? 'NeedsRefresh' : account.status}
                </span>
            </div>

            <div className="text-sm text-slate-600 space-y-2 mb-6">
                <div className="flex justify-between">
                    <span>Identifier:</span>
                    <span className="font-medium">{account.identifier}</span>
                </div>
                <div className="flex justify-between">
                    <span>Last Login:</span>
                    <span className="font-mono text-xs">{account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString() : '-'}</span>
                </div>
            </div>

            {message && <div className="mb-4 text-xs text-center text-slate-500 bg-slate-50 py-1 rounded">{message}</div>}

            <div className="grid grid-cols-2 gap-3">
                <button
                    onClick={handleCheck}
                    disabled={loading}
                    className="flex items-center justify-center px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                    Check Health
                </button>
                <button
                    onClick={aHandleLogin}
                    disabled={loading}
                    className="flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 shadow-sm"
                >
                    Launch Session
                </button>
            </div>
        </div>
    );
};
