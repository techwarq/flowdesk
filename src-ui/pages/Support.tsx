import React, { useState } from 'react';
import { Send, CheckCircle2, Ticket } from 'lucide-react';

export const Support: React.FC = () => {
    const [formData, setFormData] = useState({
        fullName: 'Himanshu',
        email: 'himanshu@flowdesk.in',
        subject: '',
        priority: 'Medium Priority - Feature Issue',
        description: ''
    });
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setTimeout(() => {
            setSubmitting(false);
            setSubmitted(true);
        }, 1500);
    };

    if (submitted) {
        return (
            <div className="p-8 max-w-3xl mx-auto h-full flex items-center justify-center">
                <div className="bg-white rounded-3xl p-12 text-center shadow-float border border-slate-100 w-full">
                    <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 size={40} />
                    </div>
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-2">Ticket Submitted</h2>
                    <p className="text-slate-500 mb-8 max-w-sm mx-auto">
                        We've received your request. Ticket <span className="font-mono font-bold text-slate-900">#TK-{Math.floor(Math.random() * 10000)}</span> has been created.
                    </p>
                    <button
                        onClick={() => { setSubmitted(false); setFormData(prev => ({ ...prev, subject: '', description: '' })); }}
                        className="w-full max-w-xs py-4 bg-[#0f172a] text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-lg shadow-slate-900/10"
                    >
                        Submit Another Ticket
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 md:p-12 max-w-4xl mx-auto flex items-center justify-center min-h-[80vh]">
            <div className="bg-white rounded-[2rem] p-8 md:p-12 shadow-float border border-slate-100 w-full relative">

                {/* Header */}
                <div className="flex items-center justify-between mb-10">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-white border border-slate-100 rounded-2xl shadow-sm">
                            <Ticket size={28} className="text-slate-900" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Submit a Ticket</h1>
                            <p className="text-slate-500 font-medium mt-1">Describe your issue and we'll help you resolve it.</p>
                        </div>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-8">
                    {/* Row 1: Name & Email */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-900 uppercase tracking-wider pl-1">Full Name</label>
                            <input
                                type="text"
                                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-medium focus:bg-white focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition-all outline-none"
                                value={formData.fullName}
                                onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-900 uppercase tracking-wider pl-1">Email Address</label>
                            <input
                                type="email"
                                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-medium focus:bg-white focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition-all outline-none"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                            />
                        </div>
                    </div>

                    {/* Subject */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-900 uppercase tracking-wider pl-1">Subject</label>
                        <input
                            type="text"
                            placeholder="I can't access my buyer account..."
                            className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-medium placeholder:text-slate-400 focus:bg-white focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition-all outline-none"
                            value={formData.subject}
                            onChange={e => setFormData({ ...formData, subject: e.target.value })}
                        />
                    </div>

                    {/* Issue Type */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-900 uppercase tracking-wider pl-1">Issue Type & Priority</label>
                        <div className="relative">
                            <select
                                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-medium appearance-none focus:bg-white focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition-all outline-none cursor-pointer"
                                value={formData.priority}
                                onChange={e => setFormData({ ...formData, priority: e.target.value })}
                            >
                                <option>Medium Priority - Feature Issue</option>
                                <option>High Priority - Bug Report</option>
                                <option>Low Priority - General Question</option>
                                <option>Urgent - Account Access</option>
                            </select>
                            <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </div>
                        </div>
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-900 uppercase tracking-wider pl-1">Description</label>
                        <textarea
                            rows={6}
                            placeholder="Please provide details about the issue..."
                            className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-medium placeholder:text-slate-400 resize-none focus:bg-white focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5 transition-all outline-none"
                            value={formData.description}
                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                        />
                    </div>

                    {/* Submit Button */}
                    <div className="pt-4">
                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full py-5 bg-[#0f172a] text-white font-bold text-lg rounded-2xl hover:opacity-90 transition-all shadow-xl shadow-slate-900/20 flex items-center justify-center gap-3 disabled:opacity-70"
                        >
                            {submitting ? (
                                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <Send size={20} />
                                    Submit Support Ticket
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
