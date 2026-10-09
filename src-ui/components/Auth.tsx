import React, { useState } from 'react';
import { api } from '../api/client';
import { Eye, EyeOff, LayoutDashboard, AlertCircle, CheckCircle2, UserPlus } from 'lucide-react';
import { ConnectivityBackground } from './ConnectivityBackground';

interface AuthProps {
    onSuccess: (profile: any) => void;
    onSupportClick: () => void;
}

export const Auth: React.FC<AuthProps> = ({ onSuccess, onSupportClick }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [isSignup, setIsSignup] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccessMsg('');

        try {
            if (isSignup) {
                // Signup Flow
                if (password !== confirmPassword) {
                    setError('Passwords do not match');
                    setLoading(false);
                    return;
                }
                if (password.length < 6) {
                    setError('Password must be at least 6 characters');
                    setLoading(false);
                    return;
                }
                const res = await api.signUp(username, password);
                if (res.success) {
                    setSuccessMsg('Account created! Signing you in...');
                    // Auto-login after signup (signUp already does this)
                    onSuccess(res.profile);
                } else {
                    setError(res.message || 'Signup failed');
                }
            } else {
                // Login Flow
                const res = await api.signIn(username, password);
                if (res.success) {
                    onSuccess(res.profile);
                } else {
                    setError(res.message || 'Login failed');
                }
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const toggleMode = () => {
        setIsSignup(!isSignup);
        setError('');
        setSuccessMsg('');
        setConfirmPassword('');
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center p-4 font-sans relative bg-bg-canvas">
            <ConnectivityBackground />

            {/* Main Card Container */}
            <div className="w-full max-w-5xl bg-bg-surface rounded-card overflow-hidden shadow-float flex flex-col md:flex-row min-h-[600px] border border-border-subtle z-10">

                {/* Left Visual Panel - Light & Clean */}
                <div className="relative w-full md:w-[45%] bg-bg-surface-hover p-12 flex flex-col justify-between overflow-hidden border-r border-border-subtle">
                    {/* Subtle colorful gloss */}
                    <div className="absolute inset-0 opacity-40 pointer-events-none">
                        <div className="absolute -top-40 -left-40 w-96 h-96 bg-brand-accent/5 rounded-full blur-[100px]" />
                        <div className="absolute bottom-0 right-0 w-64 h-64 bg-brand-primary/5 rounded-full blur-[80px]" />
                    </div>

                    <div className="relative z-10 mt-12 md:mt-24">
                        <h2 className="text-4xl md:text-5xl font-bold text-text-primary leading-[1.1] tracking-tight">
                            Streamline your<br />
                            E-commerce<br />
                            <span className="text-text-tertiary">Operations.</span>
                        </h2>
                        <p className="mt-6 text-text-secondary text-lg leading-relaxed max-w-sm">
                            Manage multiple accounts, track orders, and automate customer support from one powerful dashboard.
                        </p>
                    </div>

                    <div className="relative z-10">
                        <p className="text-text-tertiary text-xs font-semibold tracking-widest uppercase">Powered by ASTRA Engine</p>
                    </div>
                </div>

                {/* Right Form Panel */}
                <div className="w-full md:w-[55%] bg-bg-surface p-8 md:p-16 flex flex-col justify-center">
                    <div className="w-full max-w-md mx-auto">

                        {/* Header */}
                        <div className="mb-10">
                            <div className="w-14 h-14 mb-6 bg-bg-surface-hover rounded-2xl flex items-center justify-center text-text-primary shadow-sm border border-border-subtle">
                                {isSignup ? <UserPlus size={32} strokeWidth={1.5} /> : <LayoutDashboard size={32} strokeWidth={1.5} />}
                            </div>
                            <h1 className="text-3xl font-bold text-text-primary mb-2 tracking-tight">
                                {isSignup ? 'Create Account' : 'Welcome Back'}
                            </h1>
                            <p className="text-text-secondary text-sm">
                                {isSignup ? 'Set up your ASTRA workspace credentials.' : 'Sign in to access your ASTRA workspace.'}
                            </p>
                        </div>

                        {/* Form */}
                        <form onSubmit={handleSubmit} className="space-y-5">

                            {/* Username Input */}
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide">
                                    Username
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full px-4 py-3.5 bg-bg-canvas border border-border-subtle rounded-xl text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/5 transition-all font-medium hover:bg-bg-surface"
                                    placeholder="Enter your username"
                                />
                            </div>

                            {/* Password Input */}
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide">
                                    Password
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full px-4 py-3.5 bg-bg-canvas border border-border-subtle rounded-xl text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/5 transition-all font-medium hover:bg-bg-surface"
                                        placeholder="••••••••••••"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors p-1"
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            {/* Confirm Password (Signup only) */}
                            {isSignup && (
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wide">
                                        Confirm Password
                                    </label>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        required
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full px-4 py-3.5 bg-bg-canvas border border-border-subtle rounded-xl text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/5 transition-all font-medium hover:bg-bg-surface"
                                        placeholder="••••••••••••"
                                    />
                                </div>
                            )}

                            {/* Messages */}
                            {error && (
                                <div className="flex items-center gap-3 text-red-600 text-sm font-medium bg-red-50 p-4 rounded-xl border border-red-100">
                                    <AlertCircle size={18} className="shrink-0" />
                                    {error}
                                </div>
                            )}
                            {successMsg && (
                                <div className="flex items-center gap-3 text-emerald-600 text-sm font-medium bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                                    <CheckCircle2 size={18} className="shrink-0" />
                                    {successMsg}
                                </div>
                            )}

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-4 bg-brand-accent hover:opacity-90 text-white font-bold rounded-xl transition-all transform hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-brand-accent/25 mt-2"
                            >
                                {loading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Processing...
                                    </span>
                                ) : isSignup ? 'Create Account' : 'Sign In'}
                            </button>
                        </form>

                        {/* Toggle Login/Signup */}
                        <div className="mt-6 text-center">
                            <button
                                onClick={toggleMode}
                                className="text-sm text-text-tertiary hover:text-text-primary transition-colors"
                            >
                                {isSignup ? (
                                    <>Already have an account? <span className="font-semibold text-text-secondary">Sign In</span></>
                                ) : (
                                    <>Need an account? <span className="font-semibold text-text-secondary">Create</span></>
                                )}
                            </button>
                        </div>

                        {/* Footer Help */}
                        <div className="mt-4 text-center text-sm text-text-secondary">
                            Having trouble? <button onClick={onSupportClick} className="text-text-primary font-bold cursor-pointer hover:underline">Contact Support</button>
                        </div>

                    </div>
                </div>
            </div>
        </div >
    );
};
