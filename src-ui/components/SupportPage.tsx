import React, { useState } from 'react';
import { ArrowLeft, Send, CheckCircle2, Ticket } from 'lucide-react';
import { ConnectivityBackground } from './ConnectivityBackground';

interface SupportPageProps {
    onBack: () => void;
}

export const SupportPage: React.FC<SupportPageProps> = ({ onBack }) => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        subject: '',
        description: '',
        priority: 'medium'
    });
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        // Simulate API call
        setTimeout(() => {
            setSubmitting(false);
            setSubmitted(true);
        }, 1500);
    };

    if (submitted) {
        return (
            <div className="min-h-screen w-full flex items-center justify-center p-4 font-sans relative">
                <ConnectivityBackground />
                <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 z-10 border border-slate-200 text-center animate-in fade-in zoom-in-95 duration-300">
                    <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 size={40} />
                    </div>
                    <h2 className="text-2xl font-black text-slate-900 mb-2">Ticket Submitted!</h2>
                    <p className="text-slate-500 mb-8">
                        Your support request has been received. Ticket ID: <span className="font-mono font-bold text-slate-900">#TK-{Math.floor(Math.random() * 10000)}</span>.
                        <br />We'll reach out to <strong>{formData.email}</strong> shortly.
                    </p>
                    <button
                        onClick={onBack}
                        className="w-full py-3.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-black transition-all"
                    >
                        Return to Login
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full flex items-center justify-center p-4 font-sans relative">
            <ConnectivityBackground />

            <div className="w-full max-w-2xl bg-white rounded-[2rem] overflow-hidden shadow-2xl flex flex-col z-10 border border-slate-200 animate-in slide-in-from-bottom-5 duration-500">
                {/* Header */}
                <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 flex items-center gap-3">
                            <Ticket className="text-slate-900" />
                            Submit a Ticket
                        </h1>
                        <p className="text-slate-500 text-sm mt-1">Describe your issue and we'll help you resolve it.</p>
                    </div>
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500 hover:text-slate-900"
                        title="Back to Login"
                    >
                        <ArrowLeft size={20} />
                    </button>
                </div>

                {/* Form */}
                <div className="p-8 bg-white">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Full Name</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-900 focus:bg-white transition-all outline-none font-medium"
                                    placeholder="John Doe"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Email Address</label>
                                <input
                                    type="email"
                                    required
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-900 focus:bg-white transition-all outline-none font-medium"
                                    placeholder="john@example.com"
                                    value={formData.email}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Subject</label>
                            <input
                                type="text"
                                required
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-900 focus:bg-white transition-all outline-none font-medium"
                                placeholder="I can't access my buyer account..."
                                value={formData.subject}
                                onChange={e => setFormData({ ...formData, subject: e.target.value })}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Issue Type & Priority</label>
                            <div className="flex gap-4">
                                <select
                                    className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-900 focus:bg-white transition-all outline-none font-medium appearance-none"
                                    value={formData.priority}
                                    onChange={e => setFormData({ ...formData, priority: e.target.value })}
                                >
                                    <option value="low">Low Priority - General Question</option>
                                    <option value="medium">Medium Priority - Feature Issue</option>
                                    <option value="high">High Priority - System Outage</option>
                                    <option value="urgent">Urgent - Account Access</option>
                                </select>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">Description</label>
                            <textarea
                                required
                                rows={4}
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-1 focus:ring-slate-900 focus:bg-white transition-all outline-none font-medium resize-none"
                                placeholder="Please provide details about the issue..."
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                            />
                        </div>

                        <div className="pt-2">
                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full py-4 bg-slate-900 text-white font-bold rounded-xl hover:bg-black transition-all shadow-xl shadow-slate-900/10 flex items-center justify-center gap-2 disabled:opacity-70"
                            >
                                {submitting ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Submitting Ticket...
                                    </>
                                ) : (
                                    <>
                                        <div className="bg-white/20 p-1 rounded-md">
                                            <Send size={16} strokeWidth={2.5} />
                                        </div>
                                        Submit Support Ticket
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};
