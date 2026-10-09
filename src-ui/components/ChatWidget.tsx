
import React, { useState, useRef, useEffect } from 'react';
import { api } from '../api/client';

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    data?: any; // For structured content (e.g. orders)
    timestamp: number;
}

interface ChatWidgetProps {
    onNavigate: (orderId: string) => void;
}

export const ChatWidget: React.FC<ChatWidgetProps> = ({ onNavigate }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { id: '1', role: 'assistant', content: 'Hi! I can help you find details about your orders. Ask me anything!', timestamp: Date.now() }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input.trim(),
            timestamp: Date.now()
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        try {
            const res = await api.askChat(userMsg.content);
            if (res.success) {
                // Parse potential JSON response from backend
                let content = res.answer;
                let data = res.data || null;

                // Fallback: If for some reason backend wrapped everything in answer (legacy/raw)
                if (typeof res.answer === 'string' && res.answer.startsWith('{')) {
                    try {
                        const parsed = JSON.parse(res.answer);
                        if (parsed && parsed.answer) {
                            content = parsed.answer;
                            data = parsed.data || data;
                        }
                    } catch (e) {}
                }

                const aiMsg: Message = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: content,
                    data: data,
                    timestamp: Date.now()
                };
                setMessages(prev => [...prev, aiMsg]);
            } else {
                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    content: 'Error: ' + (res.error || 'Failed to get response'),
                    timestamp: Date.now()
                }]);
            }
        } catch (e) {
            console.error(e);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                content: 'Error: Connection failed',
                timestamp: Date.now()
            }]);
        } finally {
            setIsLoading(false);
        }
    };


    const handleSync = async () => {
        setIsSyncing(true);
        try {
            const res = await api.syncChat();
            if (res.success) {
                const idList = res.orderIds && res.orderIds.length > 0
                    ? `\nIDs: ${res.orderIds.join(', ')}`
                    : '';
                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    content: `Synced ${res.count} orders. I'm now up to date!${idList}`,
                    timestamp: Date.now()
                }]);
            } else {
                setMessages(prev => [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    content: `Sync failed: ${res.error}`,
                    timestamp: Date.now()
                }]);
            }
        } catch (e) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                content: `Sync failed.`,
                timestamp: Date.now()
            }]);
        } finally {
            setIsSyncing(false);
        }
    };


    const renderOrderCard = (order: any) => (
        <div key={order.orderId} className="min-w-[200px] w-[200px] p-3 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col gap-2 flex-shrink-0">
            <div className="flex justify-between items-start">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${order.status.toLowerCase().includes('deliver') ? 'bg-green-100 text-green-700' :
                    order.status.toLowerCase().includes('cancel') ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                    }`}>
                    {order.status}
                </span>

                <span className="text-xs font-bold text-slate-700">{order.price}</span>
            </div>

            <div className="text-[10px] text-slate-400 font-mono">
                #{order.orderId}
            </div>

            <h4 className="text-sm font-medium text-slate-800 line-clamp-2 h-10 leading-tight" title={order.productName}>
                {order.productName}
            </h4>
            <div className="mt-auto pt-2">
                <button
                    onClick={() => onNavigate(order.orderId)}
                    className="w-full py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors flex items-center justify-center gap-1"
                >
                    View Details
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            </div>
        </div>
    );

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end pointer-events-none">
            {/* Chat Window */}
            {isOpen && (
                <div className="mb-4 w-80 md:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col pointer-events-auto animate-in fade-in slide-in-from-bottom-10 duration-200">
                    {/* Header */}
                    <div className="p-4 bg-indigo-600 text-white flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
                                ✨
                            </div>
                            <div>
                                <h3 className="font-bold text-sm">FlowDesk Assistant</h3>
                                <p className="text-[10px] opacity-80">Powered by OpenAI</p>
                            </div>
                        </div>
                        <button
                            onClick={handleSync}
                            disabled={isSyncing}
                            className={`p-1.5 rounded-lg hover:bg-white/10 transition-colors ${isSyncing ? 'animate-spin' : ''}`}
                            title="Sync recent orders"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="h-96 overflow-y-auto p-4 bg-slate-50 space-y-4">
                        {messages.map(msg => (
                            <div
                                key={msg.id}
                                className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                            >
                                <div
                                    className={`max-w-[85%] p-3 rounded-2xl text-sm ${msg.role === 'user'
                                        ? 'bg-indigo-600 text-white rounded-tr-none'
                                        : msg.role === 'system'
                                            ? 'bg-slate-200 text-slate-600 text-xs py-1 px-3 w-full text-center rounded-lg'
                                            : 'bg-white text-slate-800 border border-slate-100 shadow-sm rounded-tl-none'
                                        }`}
                                >
                                    {msg.content}
                                </div>
                                {msg.data && msg.data.type === 'orders' && (
                                    <div className="w-full max-w-[85%] overflow-x-auto pb-2 flex gap-3 snap-x">
                                        {msg.data.items.map((item: any) => renderOrderCard(item))}
                                    </div>
                                )}
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-white p-3 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm flex gap-1">
                                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></div>
                                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-100"></div>
                                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-200"></div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="p-3 bg-white border-t border-slate-100">
                        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
                            <input
                                type="text"
                                className="flex-1 bg-transparent border-none outline-none text-sm min-w-0"
                                placeholder="Ask about your orders..."
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSend()}
                                disabled={isLoading}
                            />
                            <button
                                onClick={handleSend}
                                disabled={!input.trim() || isLoading}
                                className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-14 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg shadow-indigo-500/30 flex items-center justify-center transition-all hover:scale-105 pointer-events-auto active:scale-95"
            >
                {isOpen ? (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                ) : (
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                )}
            </button>
        </div>
    );
};

