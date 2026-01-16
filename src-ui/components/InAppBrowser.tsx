import React from 'react';
import { Platform } from '../types';

interface Props {
    accountId: string;
    identifier: string;
    platform: Platform;
    onBack: () => void;
}

export const InAppBrowser: React.FC<Props> = ({ identifier, platform, onBack }) => {
    const url = platform === 'flipkart' ? 'https://www.flipkart.com' : 'https://www.shopsy.in';

    return (
        <div className="flex flex-col h-screen w-screen bg-slate-100">
            {/* Header */}
            <header className="flex items-center px-4 py-2 bg-white border-b border-slate-200 shadow-sm shrink-0">
                <button
                    onClick={onBack}
                    className="flex items-center px-3 py-1.5 text-[11px] font-bold border border-slate-300 rounded hover:bg-slate-50 transition-colors uppercase tracking-tight"
                >
                    <span className="mr-1.5">←</span> DASHBOARD
                </button>
                <div className="flex-1 text-center">
                    <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest leading-none">
                        {platform}: <span className="text-slate-900">{identifier.toUpperCase()}</span>
                    </span>
                </div>
                <button
                    onClick={() => {
                        const iframe = document.getElementById('embedded-browser') as HTMLIFrameElement;
                        if (iframe) iframe.src = iframe.src; // Refresh
                    }}
                    className="px-3 py-1.5 text-[11px] font-bold border border-slate-300 rounded hover:bg-slate-50 transition-colors uppercase"
                >
                    ↻ Refresh
                </button>
            </header>

            {/* Embedded Browser */}
            <div className="flex-1 relative">
                <iframe
                    id="embedded-browser"
                    src={url}
                    className="absolute inset-0 w-full h-full border-0"
                    title={`${platform} Browser`}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                />
            </div>
        </div>
    );
};
