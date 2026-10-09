import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { X, Users, Activity, Trash2, Plus, Shield, UserPlus } from 'lucide-react';

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-bg-surface rounded-card shadow-float w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-border-subtle">
                {/* Header */}
                <div className="px-6 py-5 border-b border-border-subtle flex items-center justify-between bg-bg-surface-hover shrink-0">
                    <div className="flex items-center gap-4">
                        <h2 className="text-lg font-black text-text-primary tracking-tight flex items-center gap-2">
                            <div className="p-1.5 bg-brand-primary rounded-lg text-white">
                                <Shield size={18} />
                            </div>
                            ADMIN PORTAL
                        </h2>

                        <div className="flex bg-bg-canvas p-1 rounded-lg border border-border-subtle">
                            <button
                                onClick={() => setActiveTab('users')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold uppercase transition-all ${activeTab === 'users' ? 'bg-bg-surface text-text-primary shadow-sm border border-border-subtle' : 'text-text-tertiary hover:text-text-primary hover:bg-bg-surface-hover'}`}
                            >
                                <Users size={14} /> Users
                            </button>
                            <button
                                onClick={() => setActiveTab('activity')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold uppercase transition-all ${activeTab === 'activity' ? 'bg-bg-surface text-text-primary shadow-sm border border-border-subtle' : 'text-text-tertiary hover:text-text-primary hover:bg-bg-surface-hover'}`}
                            >
                                <Activity size={14} /> Activity
                            </button>
                        </div>
                    </div>

                    <button onClick={onClose} className="p-2 text-text-tertiary hover:text-text-primary hover:bg-bg-canvas rounded-lg transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden p-6 bg-bg-canvas">
                    {loading ? (
                        <div className="flex justify-center items-center h-full">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
                        </div>
                    ) : activeTab === 'users' ? (
                        <div className="h-full flex flex-col gap-6">
                            {/* User List */}
                            <div className="flex-1 bg-bg-surface rounded-card border border-border-subtle shadow-card overflow-hidden flex flex-col">
                                <div className="overflow-y-auto custom-scrollbar">
                                    <table className="min-w-full divide-y divide-border-subtle">
                                        <thead className="bg-bg-surface-hover sticky top-0 z-10">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-bold text-text-tertiary uppercase tracking-wider">Username</th>
                                                <th className="px-6 py-3 text-left text-xs font-bold text-text-tertiary uppercase tracking-wider">Role</th>
                                                <th className="px-6 py-3 text-left text-xs font-bold text-text-tertiary uppercase tracking-wider">Limit</th>
                                                <th className="px-6 py-3 text-right text-xs font-bold text-text-tertiary uppercase tracking-wider">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-bg-surface divide-y divide-border-subtle">
                                            {users.map((u: any) => (
                                                <tr key={u.username} className="hover:bg-bg-surface-hover transition-colors">
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-text-primary">{u.username}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-bold rounded-md uppercase ${u.role === 'admin' ? 'bg-brand-primary text-white' : 'bg-emerald-100 text-emerald-800'}`}>
                                                            {u.role}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-text-secondary">{u.allowedAccounts} Accounts</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                                                        <button
                                                            onClick={() => handleDeleteUser(u.username)}
                                                            className="text-text-tertiary hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition-all"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Add User Form */}
                            <div className="bg-bg-surface p-5 rounded-card border border-border-subtle shadow-card shrink-0">
                                <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
                                    <UserPlus size={16} className="text-brand-primary" />
                                    ADD NEW USER
                                </h3>
                                <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                                    <div>
                                        <label className="block text-xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">Username</label>
                                        <input required type="text" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                                            className="block w-full rounded-xl border-border-subtle shadow-sm focus:border-brand-primary focus:ring-brand-primary text-sm py-2 px-3 bg-bg-canvas text-text-primary placeholder:text-text-tertiary"
                                            placeholder="Enter username"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">Password</label>
                                        <input required type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                                            className="block w-full rounded-xl border-border-subtle shadow-sm focus:border-brand-primary focus:ring-brand-primary text-sm py-2 px-3 bg-bg-canvas text-text-primary placeholder:text-text-tertiary"
                                            placeholder="Enter password"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-text-tertiary uppercase tracking-wider mb-1.5">Role</label>
                                        <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                                            className="block w-full rounded-xl border-border-subtle shadow-sm focus:border-brand-primary focus:ring-brand-primary text-sm py-2 px-3 bg-bg-canvas cursor-pointer text-text-primary"
                                        >
                                            <option value="staff">Staff</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </div>
                                    <button type="submit" className="px-4 py-2 bg-brand-primary text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all shadow-lg shadow-brand-primary/20 flex items-center justify-center gap-2 h-[38px]">
                                        <Plus size={16} strokeWidth={3} /> ADD USER
                                    </button>
                                </form>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full overflow-hidden bg-slate-900 rounded-xl border border-slate-800 shadow-inner flex flex-col">
                            <div className="p-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
                                <span>TERMINAL_OUTPUT://LIVE_LOGS</span>
                                <div className="flex gap-1">
                                    <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
                                    <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                                    <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-2 custom-scrollbar">
                                {logs.length === 0 ? (
                                    <div className="text-center text-slate-600 py-20">_no_activity_detected</div>
                                ) : logs.map((log: any, i: number) => (
                                    <div key={i} className={`flex gap-3 hover:bg-white/5 p-1 rounded ${log.level === 'error' || log.type === 'error' ? 'text-red-400' : 'text-slate-300'}`}>
                                        <span className="text-slate-600 shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                        <span className={`font-bold uppercase px-1.5 rounded text-[10px] h-fit mt-0.5 ${log.level === 'error' || log.type === 'error' ? 'bg-red-900/40 text-red-200' : 'bg-slate-800 text-slate-300'
                                            }`}>
                                            {log.level || 'INFO'}
                                        </span>
                                        <span className="break-all">
                                            {log.message}
                                            {log.accountId && <span className="text-indigo-400 ml-2">[{log.accountId}]</span>}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
