import React, { useEffect, useState } from 'react';
import { api } from './api/client';
import { Account } from './types';
import { Layout } from './components/Layout';
import { AccountTable } from './components/AccountTable';
import { AddAccountModal } from './components/AddAccountModal';
import { SettingsModal } from './components/SettingsModal';
import { AdminModal } from './components/AdminModal';
import { AllocationView } from './components/AllocationView';
import {
    LayoutDashboard,
    Users,
    Smartphone,
    Activity,
    Settings,
    Layers,
    ShieldCheck,
    Search,
    RefreshCw,
    Plus,
    CheckCircle2,
    ArrowRight
} from 'lucide-react';

interface Props {
    username: string;
    onLogout: () => void;
    onSwitchToUser: () => void;
}

type AdminView = 'dashboard' | 'users' | 'accounts' | 'activity' | 'settings' | 'allocation' | 'access';

export const Dashboard: React.FC<Props> = ({ username, onLogout, onSwitchToUser }) => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [platformFilter, setPlatformFilter] = useState<string>('all');
    const [currentView, setCurrentView] = useState<AdminView>('dashboard');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isAdminOpen, setIsAdminOpen] = useState(false);
    const [adminUsers, setAdminUsers] = useState<any[]>([]);
    const [activityLogs, setActivityLogs] = useState<any[]>([]);

    const load = async () => {
        setLoading(true);
        // Explicitly clear to show refresh effect if needed, though loading spinner handles it.
        // setAccounts([]); 
        try {
            // Force fetch recent data. Admin users get ALL accounts by default from server.
            const data = await api.getAccounts();
            setAccounts(data.accounts || []);

            // Also load users and logs
            const [users, logs] = await Promise.all([
                api.getAdminUsers(),
                api.getActivityLogs()
            ]);

            if (Array.isArray(users)) setAdminUsers(users);
            if (Array.isArray(logs)) setActivityLogs(logs);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const filteredAccounts = accounts.filter(a => {
        const matchesSearch = search === '' ||
            a.id.toLowerCase().includes(search.toLowerCase()) ||
            a.identifier.toLowerCase().includes(search.toLowerCase()) ||
            (a.assignedTo && a.assignedTo.toLowerCase().includes(search.toLowerCase()));
        const matchesPlatform = platformFilter === 'all' || a.platform === platformFilter;
        return matchesSearch && matchesPlatform;
    });

    const stats = {
        totalAccounts: accounts.length,
        healthyAccounts: accounts.filter(a => a.status === 'Healthy').length,
        errorAccounts: accounts.filter(a => a.status === 'Error').length,
        newAccounts: accounts.filter(a => a.status === 'New').length,
        totalUsers: adminUsers.length,
        activeUsers: adminUsers.filter((u: any) => u.role !== 'disabled').length,
        flipkartAccounts: accounts.filter(a => a.platform === 'flipkart').length,
        shopsyAccounts: accounts.filter(a => a.platform === 'shopsy').length
    };

    const handleSignOut = () => {
        api.signOut();
        if (onLogout) onLogout();
        else window.location.reload();
    };

    const navItems = [
        {
            id: 'dashboard',
            label: 'Dashboard',
            icon: <LayoutDashboard size={20} />,
            onClick: () => setCurrentView('dashboard'),
            active: currentView === 'dashboard'
        },
        {
            id: 'users',
            label: 'Users',
            icon: <Users size={20} />,
            onClick: () => setCurrentView('users'),
            active: currentView === 'users'
        },
        {
            id: 'accounts',
            label: 'IDs / Accounts',
            icon: <Smartphone size={20} />,
            onClick: () => setCurrentView('accounts'),
            active: currentView === 'accounts'
        },
        {
            id: 'activity',
            label: 'Activity Logs',
            icon: <Activity size={20} />,
            onClick: () => setCurrentView('activity'),
            active: currentView === 'activity'
        },
        {
            id: 'allocation',
            label: 'ID Allocation',
            icon: <Layers size={20} />,
            onClick: () => setCurrentView('allocation'),
            badge: 'Beta'
        },
        {
            id: 'access',
            label: 'Access Control',
            icon: <ShieldCheck size={20} />,
            onClick: () => setCurrentView('access'),
            badge: 'Beta'
        },
        {
            id: 'settings',
            label: 'Settings',
            icon: <Settings size={20} />,
            onClick: () => { setCurrentView('settings'); setIsSettingsOpen(true); },
            active: currentView === 'settings'
        }
    ];

    const renderContent = () => {
        if (loading) {
            return (
                <div className="flex items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
            );
        }

        switch (currentView) {
            case 'accounts':
                return renderAccountsView();
            case 'users':
                return renderUsersView();
            case 'activity':
                return renderActivityView();
            case 'allocation':
                return <AllocationView />;
            case 'access':
                return <div className="p-8"><h2 className="text-2xl font-bold">Access Control Coming Soon</h2></div>;
            case 'dashboard':
            default:
                return renderDashboardView();
        }
    };

    // function removed

    const renderDashboardView = () => (
        <div className="p-8 space-y-8 max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header Area */}
            <div className="flex items-end justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase rounded tracking-wider">System Live</span>
                    </div>
                    <h2 className="text-4xl font-black text-slate-900 tracking-tight">Admin Intelligence</h2>
                    <p className="text-slate-500 text-sm font-medium">Real-time health analytics and infrastructure overview.</p>
                </div>
                <div className="text-right">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Last Updated</div>
                    <div className="text-sm font-bold text-slate-900">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Total Users */}
                <div className="group bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm hover:shadow-xl hover:shadow-indigo-500/5 hover:-translate-y-1 transition-all duration-500 relative overflow-hidden">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600 group-hover:scale-110 transition-transform">
                            <Users size={24} strokeWidth={2.5} />
                        </div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Growth +2%</div>
                    </div>
                    <div className="text-5xl font-black text-slate-900 tracking-tighter mb-1">{stats.totalUsers}</div>
                    <div className="text-sm font-bold text-slate-500 uppercase tracking-tight">Platform Users</div>
                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-3xl rounded-full" />
                </div>

                {/* Total IDs */}
                <div className="group bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm hover:shadow-xl hover:shadow-yellow-500/5 hover:-translate-y-1 transition-all duration-500 relative overflow-hidden">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-yellow-50 rounded-2xl text-yellow-600 group-hover:scale-110 transition-transform">
                            <Smartphone size={24} strokeWidth={2.5} />
                        </div>
                        <div className="flex gap-1.5">
                            <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                        </div>
                    </div>
                    <div className="text-5xl font-black text-slate-900 tracking-tighter mb-1">{stats.totalAccounts}</div>
                    <div className="text-sm font-bold text-slate-500 uppercase tracking-tight">Active Identifiers</div>
                    <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 blur-3xl rounded-full" />
                </div>

                {/* Health Percent */}
                <div className="group bg-slate-900 rounded-[2rem] p-8 shadow-2xl shadow-slate-900/20 hover:-translate-y-1 transition-all duration-500 relative overflow-hidden">
                    <div className="flex items-center justify-between mb-4 relative z-10">
                        <div className="p-3 bg-white/10 backdrop-blur-md rounded-2xl text-emerald-400">
                            <CheckCircle2 size={24} strokeWidth={2.5} />
                        </div>
                        <div className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Optimized</div>
                    </div>
                    <div className="text-5xl font-black text-white tracking-tighter mb-1 relative z-10">
                        {stats.totalAccounts > 0 ? Math.round((stats.healthyAccounts / stats.totalAccounts) * 100) : 100}%
                    </div>
                    <div className="text-sm font-bold text-slate-400 uppercase tracking-tight relative z-10">Session Health</div>
                    <div className="absolute -right-4 -bottom-4 w-40 h-40 bg-emerald-500/10 blur-3xl rounded-full" />
                </div>

                {/* Quick Action Card */}
                <div className="group bg-indigo-600 rounded-[2rem] p-8 shadow-2xl shadow-indigo-600/30 hover:-translate-y-1 transition-all duration-500 relative overflow-hidden cursor-pointer" onClick={() => setCurrentView('accounts')}>
                    <div className="flex items-center justify-between mb-4 relative z-10">
                        <div className="p-3 bg-white/20 backdrop-blur-md rounded-2xl text-white">
                            <Plus size={24} strokeWidth={2.5} />
                        </div>
                    </div>
                    <div className="text-2xl font-black text-white leading-tight mb-2 relative z-10">Scale Your<br />Network Now</div>
                    <div className="flex items-center gap-2 text-indigo-100 font-bold text-sm group-hover:gap-3 transition-all relative z-10">
                        ADD NEW IDENTIFIER <ArrowRight size={16} strokeWidth={3} />
                    </div>
                    <div className="absolute top-0 right-0 w-full h-full bg-gradient-to-br from-white/10 to-transparent" />
                </div>
            </div>

            {/* Bottom Section: Logs & Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Visual List */}
                <div className="lg:col-span-8 bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                    <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Active Pipelines</h3>
                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Recently Synced Accounts</p>
                        </div>
                        <button onClick={() => setCurrentView('accounts')} className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-900 text-xs font-black rounded-xl transition-all uppercase tracking-tighter">View All Accounts</button>
                    </div>
                    <div className="divide-y divide-slate-50 flex-1">
                        {accounts.slice(0, 6).map(acc => (
                            <div key={acc.id} className="px-8 py-5 flex items-center justify-between hover:bg-slate-50/80 transition-all group">
                                <div className="flex items-center gap-6">
                                    <div className="relative">
                                        <div className={`w-3 h-3 rounded-full absolute -top-1 -right-1 border-2 border-white ${acc.status === 'Healthy' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                        <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-500 font-black text-xs uppercase group-hover:bg-white group-hover:shadow-sm transition-all tracking-tighter">
                                            {acc.platform.slice(0, 2)}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-sm font-black text-slate-900">{acc.identifier}</div>
                                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{acc.platform} • {acc.status}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="text-right hidden sm:block">
                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Activity</div>
                                        <div className="text-xs font-bold text-slate-900">{acc.lastLoginAt ? new Date(acc.lastLoginAt).toLocaleDateString() : '--'}</div>
                                    </div>
                                    <div className="w-1.5 h-1.5 bg-slate-200 rounded-full" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Sidebar Cards */}
                <div className="lg:col-span-4 space-y-6">
                    {/* Activity Feed Mini */}
                    <div className="bg-white rounded-[2.5rem] p-8 border border-slate-200 shadow-sm space-y-6">
                         <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Live Feed</h3>
                            <button onClick={() => setCurrentView('activity')} className="text-[10px] font-black text-indigo-600 uppercase hover:underline">Full Logs</button>
                        </div>
                        <div className="space-y-6">
                            {activityLogs.slice(0, 4).map((log: any, i) => (
                                <div key={i} className="flex gap-4">
                                    <div className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                                    <div>
                                        <p className="text-xs font-bold text-slate-700 leading-tight">{log.message}</p>
                                        <p className="text-[10px] font-medium text-slate-400 mt-1 uppercase leading-none">{new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Operational Status */}
                    <div className="bg-emerald-900 rounded-[2.5rem] p-8 text-white relative overflow-hidden shadow-2xl shadow-emerald-900/20">
                        <div className="relative z-10 space-y-4">
                             <div className="flex items-center gap-2">
                                <ShieldCheck size={18} className="text-emerald-400" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Security Core</span>
                             </div>
                             <div className="text-xl font-black leading-tight">All Node Clusters Operational</div>
                             <p className="text-[11px] text-emerald-400/80 font-medium leading-relaxed">
                                End-to-end encryption is active. No pending intrusions or unauthorized access detected in the last 24 hours.
                             </p>
                        </div>
                        <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-white/5 blur-3xl rounded-full" />
                    </div>
                </div>
            </div>
        </div>
    );
    const renderUsersView = () => (
        <div className="p-8 space-y-8 max-w-[1600px] mx-auto animate-in fade-in duration-500">
            <div className="flex items-end justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-black uppercase rounded tracking-wider">Access Control</span>
                    </div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight">User Management</h2>
                    <p className="text-slate-500 text-sm font-medium">Control platform access and manage administrator roles.</p>
                </div>
                <button
                    onClick={() => setIsAdminOpen(true)}
                    className="px-6 py-3 bg-indigo-600 text-white text-xs font-black rounded-xl hover:bg-indigo-700 transition-all uppercase tracking-widest shadow-lg shadow-indigo-600/20"
                >
                    Invite New Admin
                </button>
            </div>

            <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-50/50 border-b border-slate-100">
                        <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            <th className="px-8 py-5">User Profile</th>
                            <th className="px-6 py-5">Access Group</th>
                            <th className="px-6 py-5">Last Activity</th>
                            <th className="px-6 py-5">Status</th>
                            <th className="px-8 py-5 text-right">Operations</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {adminUsers.length > 0 ? (
                            adminUsers.map((user: any, i) => (
                                <tr key={i} className="hover:bg-indigo-50/30 transition-all group">
                                    <td className="px-8 py-5">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-500 font-bold overflow-hidden border border-slate-200 shadow-sm group-hover:scale-110 transition-transform">
                                                <img src={`https://api.dicebear.com/7.x/notionists/svg?seed=${user.username}`} alt="" />
                                            </div>
                                            <div className="text-sm font-black text-slate-900 tracking-tight">{user.username}</div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5">
                                        <span className="text-[10px] font-black uppercase px-2.5 py-1 bg-slate-100 rounded-lg text-slate-600">{user.role}</span>
                                    </td>
                                    <td className="px-6 py-5 text-[11px] font-bold text-slate-400 uppercase">Synchronizing...</td>
                                    <td className="px-6 py-5">
                                        <span className="px-3 py-1 rounded-full bg-emerald-100/50 text-emerald-600 text-[10px] font-black uppercase ring-1 ring-emerald-500/20">Operational</span>
                                    </td>
                                    <td className="px-8 py-5 text-right">
                                        <button className="text-indigo-600 font-black text-[11px] uppercase tracking-widest hover:underline px-4 py-2 rounded-xl hover:bg-indigo-50 transition-all">Adjust Control</button>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={5} className="px-8 py-20 text-center text-slate-400 font-medium">No administrators present in the workspace.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderActivityView = () => (
        <div className="p-8 space-y-8 max-w-[1200px] mx-auto animate-in fade-in duration-500">
            <div className="flex items-end justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-black uppercase rounded tracking-wider">System Audit</span>
                    </div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight">Intelligence Logs</h2>
                    <p className="text-slate-500 text-sm font-medium">Decentralized event tracking and synchronization status.</p>
                </div>
                <button className="px-6 py-3 bg-white border border-slate-200 text-slate-900 text-[10px] font-black rounded-xl hover:bg-slate-50 transition-all uppercase tracking-widest shadow-sm">Export Data Stack</button>
            </div>

            <div className="space-y-4">
                {activityLogs.length > 0 ? (
                    activityLogs.map((log: any, i) => (
                        <div key={i} className="group bg-white p-6 rounded-[2rem] border border-slate-200 flex items-center gap-6 shadow-sm hover:shadow-lg hover:shadow-indigo-500/5 transition-all">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 ${log.type === 'error' ? 'bg-red-50 text-red-500' : 'bg-indigo-50 text-indigo-500'}`}>
                                <Activity size={20} strokeWidth={2.5} />
                            </div>
                            <div className="flex-1">
                                <p className="text-[13px] font-black text-slate-900 tracking-tight">{log.message || 'Automated System Deployment Success'}</p>
                                <div className="flex items-center gap-3 mt-1.5">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">Global EventID: {i.toString().padStart(6, '0')}</p>
                                    <div className="w-1 h-1 bg-slate-200 rounded-full" />
                                    <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest leading-none">{new Date(log.timestamp).toLocaleTimeString()}</p>
                                </div>
                            </div>
                            <div className="text-right">
                               <span className="px-3 py-1 bg-slate-50 text-slate-400 text-[9px] font-black uppercase rounded-lg">Verified</span>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="text-center py-32 text-slate-400">
                        <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6">
                           <Activity size={32} className="opacity-20" />
                        </div>
                        <p className="text-sm font-black uppercase tracking-widest text-slate-300">Observation field clear</p>
                    </div>
                )}
            </div>
        </div>
    );

    const renderAccountsView = () => (
        <div className="p-8 space-y-8 max-w-[1600px] mx-auto min-h-full flex flex-col animate-in fade-in duration-500">
            <div className="flex items-end justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-black uppercase rounded tracking-wider">Asset Management</span>
                    </div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight">Active Identifiers</h2>
                    <p className="text-slate-500 text-sm font-medium">Monitoring and deployment control for all connected platform nodes.</p>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={load}
                        className="w-12 h-12 flex items-center justify-center bg-white border border-slate-200 text-slate-400 rounded-2xl hover:border-indigo-400 hover:text-indigo-600 transition-all shadow-sm"
                        title="Force Data Sync"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="px-6 py-3 bg-slate-900 text-white text-xs font-black rounded-2xl hover:bg-slate-800 transition-all uppercase tracking-widest shadow-xl flex items-center gap-2 active:scale-95 transition-transform"
                    >
                        <Plus size={16} strokeWidth={3} />
                        Register New ID
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex items-center justify-between bg-slate-100/50 p-2 rounded-[2rem] border border-slate-200">
                <div className="flex items-center gap-2">
                    <div className="relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-hover:text-indigo-500 transition-colors" size={16} />
                        <input
                            type="text"
                            placeholder="Filter by identifier, user, or platform ID..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-12 pr-6 py-3 bg-white border border-slate-200 rounded-[1.5rem] text-xs w-full sm:w-[400px] focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all font-bold uppercase tracking-tight"
                        />
                    </div>
                    <div className="w-[1px] h-8 bg-slate-200 mx-2 shrink-0" />
                    <div className="flex bg-white/50 p-1 rounded-2xl border border-slate-200/50 overflow-x-auto scrollbar-hide max-w-[800px]">
                        {['all', 'amazon', 'flipkart', 'iqoo', 'oneplus', 'oppo', 'realme', 'reliancedigital', 'samsung', 'shopsy', 'vijaysales', 'vivo', 'xiaomi'].map(p => (
                            <button
                                key={p}
                                onClick={() => setPlatformFilter(p)}
                                className={`px-6 py-2 text-[10px] font-black uppercase rounded-xl transition-all tracking-widest shrink-0 ${platformFilter === p
                                    ? 'bg-slate-900 text-white shadow-lg'
                                    : 'text-slate-400 hover:text-slate-900'}`}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="px-6">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Displaying {filteredAccounts.length} / {accounts.length} Nodes
                    </span>
                </div>
            </div>

            {/* Account Table */}
            <div className="flex-1 bg-white rounded-[2.5rem] overflow-hidden border border-slate-200 shadow-sm">
                <AccountTable accounts={filteredAccounts} onRefresh={load} />
            </div>
        </div>
    );

    return (
        <>
            <Layout
                username={username}
                role="admin"
                accounts={accounts}
                navItems={navItems}
                onSelectAccount={() => { }}
                onAddAccount={() => setIsAddModalOpen(true)}
                onRefresh={load}
                onSignOut={handleSignOut} // Use wrapper that resets profile
                showAccountSelector={false}
                onSwitchToUser={onSwitchToUser}
            >
                {renderContent()}
            </Layout>

            <AddAccountModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSuccess={load}
            />

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />

            <AdminModal
                isOpen={isAdminOpen}
                onClose={() => setIsAdminOpen(false)}
            />
        </>
    );
};
