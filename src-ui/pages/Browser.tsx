import React from 'react';
import { Globe, Shield, RefreshCw, Maximize2 } from 'lucide-react';

export const Browser: React.FC = () => {
    return (
        <div className="h-full flex flex-col p-4 gap-4">
            {/* Browser Header */}
            <div className="flex items-center justify-between px-2">
                <div>
                    <h2 className="text-xl font-bold text-text-primary">Secure Browser</h2>
                    <p className="text-xs text-text-tertiary flex items-center gap-1.5">
                        <Shield size={12} className="text-emerald-500" />
                        Using Isolated Session Profile
                    </p>
                </div>
            </div>

            {/* Split View Container */}
            <div className="flex-1 grid grid-cols-2 gap-4">
                {/* Browser 1 */}
                <div className="bg-bg-surface rounded-card shadow-card flex flex-col overflow-hidden border-2 border-transparent focus-within:border-brand-primary/20 transition-all">
                    <div className="bg-bg-surface-hover border-b border-border-subtle p-2 flex items-center gap-2">
                        <div className="flex gap-1.5 px-2">
                            <div className="w-2.5 h-2.5 rounded-full bg-red-400/50" />
                            <div className="w-2.5 h-2.5 rounded-full bg-amber-400/50" />
                            <div className="w-2.5 h-2.5 rounded-full bg-green-400/50" />
                        </div>
                        <div className="flex-1 bg-bg-surface h-8 rounded-lg border border-border-subtle shadow-sm flex items-center px-3 text-xs text-text-secondary">
                            <Globe size={12} className="mr-2 opacity-50" />
                            flipkart.com
                        </div>
                        <button className="p-1.5 hover:bg-bg-surface rounded-md text-text-tertiary hover:text-text-primary transition-colors">
                            <RefreshCw size={14} />
                        </button>
                    </div>
                    <div className="flex-1 bg-bg-surface relative group cursor-pointer">
                        <div className="absolute inset-0 flex items-center justify-center text-text-tertiary group-hover:text-brand-primary/50 transition-colors">
                            <Globe size={48} className="opacity-20" />
                        </div>
                    </div>
                </div>

                {/* Browser 2 */}
                <div className="bg-bg-surface rounded-card shadow-card flex flex-col overflow-hidden border-2 border-transparent focus-within:border-brand-primary/20 transition-all">
                    <div className="bg-bg-surface-hover border-b border-border-subtle p-2 flex items-center gap-2">
                        <div className="flex gap-1.5 px-2">
                            <div className="w-2.5 h-2.5 rounded-full bg-red-400/50" />
                            <div className="w-2.5 h-2.5 rounded-full bg-amber-400/50" />
                            <div className="w-2.5 h-2.5 rounded-full bg-green-400/50" />
                        </div>
                        <div className="flex-1 bg-bg-surface h-8 rounded-lg border border-border-subtle shadow-sm flex items-center px-3 text-xs text-text-secondary">
                            <Globe size={12} className="mr-2 opacity-50" />
                            shopsy.in
                        </div>
                        <button className="p-1.5 hover:bg-bg-surface rounded-md text-text-tertiary hover:text-text-primary transition-colors">
                            <Maximize2 size={14} />
                        </button>
                    </div>
                    <div className="flex-1 bg-bg-surface relative group cursor-pointer">
                        <div className="absolute inset-0 flex items-center justify-center text-text-tertiary group-hover:text-brand-primary/50 transition-colors">
                            <Globe size={48} className="opacity-20" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
