import React, { useState } from 'react';
import { X, Clipboard, Trash2, Check, Minus, Plus } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onApply: (ids: string[], batchSize: number) => void;
    onClear: () => void;
    currentIds: string[];
}

export const BulkPasteModal: React.FC<Props> = ({ isOpen, onClose, onApply, onClear, currentIds }) => {
    const [text, setText] = useState(currentIds.join('\n'));
    const [batchSize, setBatchSize] = useState(10);

    if (!isOpen) return null;

    const handleApply = () => {
        const ids = text.split(/[\n,]+/).map(id => id.trim()).filter(id => id.length > 0);
        onApply(ids, batchSize);
        onClose();
    };

    const handleClear = () => {
        setText('');
        onClear();
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-bg-surface rounded-card shadow-float w-full max-w-lg p-0 overflow-hidden scale-100 animate-in zoom-in-95 duration-200 border border-border-subtle">
                <div className="px-6 py-5 border-b border-border-subtle flex items-center justify-between bg-bg-surface-hover">
                    <h2 className="text-lg font-black text-text-primary tracking-tight flex items-center gap-2">
                        <div className="w-1 h-5 bg-brand-primary rounded-full" />
                        BULK PASTE IDS
                    </h2>
                    <button onClick={onClose} className="p-2 text-text-tertiary hover:text-text-primary hover:bg-bg-canvas rounded-lg transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-text-tertiary uppercase tracking-wider flex items-center gap-1.5">
                            <Clipboard size={12} /> Paste Emails or Account IDs
                        </label>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Paste IDs here (one per line or comma separated)..."
                            className="w-full h-48 rounded-xl border-border-subtle bg-bg-canvas text-text-primary p-4 text-sm font-medium focus:ring-2 focus:ring-brand-primary outline-none transition-all placeholder:text-text-tertiary resize-none"
                        />
                        <p className="text-[10px] text-text-tertiary font-medium italic">
                            Tip: You can paste a list from Excel or a text file.
                        </p>
                    </div>

                    <div className="bg-bg-canvas/50 rounded-xl p-4 border border-border-subtle flex items-center justify-between">
                        <div className="space-y-0.5">
                            <p className="text-xs font-bold text-text-primary">Batch Refresh Size</p>
                            <p className="text-[10px] text-text-tertiary font-medium">Number of accounts to fetch in parallel.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <button 
                                onClick={() => setBatchSize(Math.max(1, batchSize - 1))}
                                className="w-8 h-8 rounded-lg bg-bg-surface border border-border-subtle flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
                            >
                                <Minus size={14} />
                            </button>
                            <input 
                                type="number" 
                                value={batchSize}
                                onChange={(e) => setBatchSize(parseInt(e.target.value) || 1)}
                                className="w-12 bg-transparent text-center text-sm font-black text-brand-primary border-none focus:ring-0 p-0"
                            />
                            <button 
                                onClick={() => setBatchSize(batchSize + 1)}
                                className="w-8 h-8 rounded-lg bg-bg-surface border border-border-subtle flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
                            >
                                <Plus size={14} />
                            </button>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={handleClear}
                            className="flex-1 py-3 bg-red-50 text-red-500 font-bold rounded-xl hover:bg-red-500 hover:text-white transition-all flex items-center justify-center gap-2 border border-red-100"
                        >
                            <Trash2 size={16} />
                            CLEAR ALL
                        </button>
                        <button
                            onClick={handleApply}
                            className="flex-[2] py-3 bg-brand-primary text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-lg shadow-brand-primary/20 flex items-center justify-center gap-2"
                        >
                            <Check size={18} />
                            APPLY FILTERS
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
