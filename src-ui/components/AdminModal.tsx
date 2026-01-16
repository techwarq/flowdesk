
import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

export const AdminModal: React.FC<Props> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState<'users' | 'activity'>('users');
    const [loading, setLoading] = useState(false);
    const [users, setUsers] = useState<any[]>([]);
    const [logs, setLogs] = useState<any[]>([]);

    // User Form
    const [newUser, setNewUser] = useState({ username: '', password: '', role: 'staff', allowedAccounts: 10 });

    useEffect(() => {
        if (isOpen) {
            loadData();
        }
    }, [isOpen, activeTab]);

    const loadData = async () => {
        setLoading(true);
        try {
            if (activeTab === 'users') {
                const data = await api.getAdminUsers();
                if (Array.isArray(data)) {
                    setUsers(data);
                } else {
                    console.warn('API returned non-array for users:', data);
                    setUsers([]);
                }
            } else {
                const [activity, errors] = await Promise.all([
                    api.getActivityLogs(),
                    api.getAppErrors()
                ]);
                // Combine and sort
                const combined = [
                    ...activity.map((l: any) => ({ ...l, type: 'activity' })),
                    ...errors.map((l: any) => ({ ...l, type: 'error' }))
                ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                setLogs(combined);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.upsertAdminUser({
                ...newUser,
                createdAt: new Date().toISOString()
            });
            setNewUser({ username: '', password: '', role: 'staff', allowedAccounts: 10 });
            loadData();
            alert('User added');
        } catch (e) {
            alert('Failed to add user');
        }
    };

    const handleDeleteUser = async (username: string) => {
        if (!confirm(`Delete ${username}?`)) return;
        await api.deleteAdminUser(username);
        loadData();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl p-6 h-[80vh] flex flex-col">
                <div className="flex justify-between items-center mb-6 border-b pb-4">
                    <h2 className="text-xl font-bold text-slate-900">Admin Portal</h2>
                    <div className="flex space-x-2">
                        <button
                            onClick={() => setActiveTab('users')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'users' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Users
                        </button>
                        <button
                            onClick={() => setActiveTab('activity')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'activity' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Live Activity
                        </button>
                        <button onClick={onClose} className="ml-4 text-slate-400 hover:text-slate-600">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-hidden">
                    {loading ? (
                        <div className="flex justify-center items-center h-full">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                        </div>
                    ) : activeTab === 'users' ? (
                        <div className="h-full flex flex-col">
                            <div className="flex-1 overflow-y-auto mb-4">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Username</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Limit</th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {users.map((u: any) => (
                                            <tr key={u.username}>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{u.username}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                                                        {u.role}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{u.allowedAccounts}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                    <button onClick={() => handleDeleteUser(u.username)} className="text-red-600 hover:text-red-900">Delete</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                                <h3 className="text-sm font-medium text-slate-700 mb-3">Add New User</h3>
                                <form onSubmit={handleAddUser} className="flex gap-4 items-end">
                                    <div className="flex-1">
                                        <label className="block text-xs text-slate-500">Username</label>
                                        <input required type="text" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
                                    </div>
                                    <div className="flex-1">
                                        <label className="block text-xs text-slate-500">Password</label>
                                        <input required type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
                                    </div>
                                    <div className="w-24">
                                        <label className="block text-xs text-slate-500">Role</label>
                                        <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })} className="mt-1 block w-full rounded border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border">
                                            <option value="staff">Staff</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </div>
                                    <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700">Add</button>
                                </form>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full overflow-y-auto bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300">
                            {logs.length === 0 ? (
                                <div className="text-center text-slate-500 py-8">No recent activity</div>
                            ) : logs.map((log: any, i: number) => (
                                <div key={i} className={`mb-1 ${log.level === 'error' || log.type === 'error' ? 'text-red-400' : 'text-slate-300'}`}>
                                    <span className="text-slate-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                    {' '}
                                    <span className="font-bold text-slate-100 uppercase">{log.level || 'INFO'}</span>
                                    {' '}
                                    {log.message}
                                    {log.accountId && <span className="text-indigo-400 ml-2">[{log.accountId}]</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
