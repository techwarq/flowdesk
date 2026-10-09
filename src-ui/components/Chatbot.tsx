import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Bot, Minimize2, Paperclip, ShoppingBag, Key, ChevronRight, Truck } from 'lucide-react';
import { api } from '../api/client';
import { OrderDetailModal } from './OrderDetailModal';
import { Order, Platform } from '../types';

// Use the common Order type, adding optional platform for UI
export interface OrderItem extends Order {
    platform?: Platform;
}

// OrderDetailModal removed - now using shared component

const OrderCard: React.FC<{ order: OrderItem; onClick: (order: OrderItem) => void }> = ({ order, onClick }) => {
    const getStatusColor = (status: string = '') => {
        const s = status.toLowerCase();
        if (s.includes('delivered')) return 'text-emerald-500 bg-emerald-50 border-emerald-100';
        if (s.includes('transit') || s.includes('out')) return 'text-blue-500 bg-blue-50 border-blue-100';
        if (s.includes('cancelled')) return 'text-rose-500 bg-rose-50 border-rose-100';
        return 'text-slate-500 bg-slate-50 border-slate-100';
    };

    return (
        <div 
            onClick={() => onClick(order)}
            className="bg-white rounded-2xl border border-border-subtle overflow-hidden shadow-sm hover:shadow-md hover:border-brand-primary/20 transition-all duration-300 group cursor-pointer active:scale-[0.98]"
        >
            <div className="p-3 flex gap-3">
                <div className="w-16 h-16 rounded-xl bg-slate-50 flex-shrink-0 overflow-hidden border border-slate-100 group-hover:scale-105 transition-transform">
                    {order.imageUrl ? (
                        <img src={order.imageUrl} alt={order.productName} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400">
                            <ShoppingBag size={24} />
                        </div>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${getStatusColor(order.status)}`}>
                            {order.status}
                        </span>
                        <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-slate-400 font-medium">#{order.orderId.slice(-8)}</span>
                            <ChevronRight size={12} className="text-slate-300 group-hover:text-brand-primary transition-colors" />
                        </div>
                    </div>
                    <h4 className="text-xs font-black text-slate-800 truncate mb-1">{order.productName}</h4>
                    <p className="text-[11px] text-slate-500 font-bold">{order.price || 'N/A'}</p>
                </div>
            </div>
            
            <div className="px-3 pb-3 pt-0 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {order.otp && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-brand-primary/5 rounded-lg border border-brand-primary/10">
                            <Key size={10} className="text-brand-primary" />
                            <span className="text-[9px] font-black text-brand-primary tracking-widest">{order.otp}</span>
                        </div>
                    )}
                    {order.realtimeStatus && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 rounded-lg border border-blue-100">
                            <Truck size={10} className="text-blue-500" />
                            <span className="text-[9px] font-bold text-blue-600 truncate max-w-[80px]">{order.realtimeStatus}</span>
                        </div>
                    )}
                </div>
                <span className="text-[9px] font-black text-slate-300 uppercase tracking-tighter">{order.platform}</span>
            </div>
        </div>
    );
};

const OrderGrid: React.FC<{ items: OrderItem[]; onSelect: (order: OrderItem) => void }> = ({ items, onSelect }) => {
    return (
        <div className="grid grid-cols-1 gap-3 w-full mt-2">
            {items.map((item, idx) => (
                <OrderCard key={item.orderId || idx} order={item} onClick={onSelect} />
            ))}
        </div>
    );
};

export const Chatbot: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<OrderItem | null>(null);
    const [messages, setMessages] = useState<{ id: string, text: string, sender: 'user' | 'bot', data?: any }[]>([
        { id: '1', text: "Hello! I'm Aastha, your Shopping Assistant. How can I help you track your purchases today?", sender: 'bot' }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMsg = input;
        setMessages(prev => [...prev, { id: Date.now().toString(), text: userMsg, sender: 'user' }]);
        setInput('');
        setIsLoading(true);

        try {
            const response = await api.askChat(userMsg);
            
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                text: response.answer,
                data: response.data,
                sender: 'bot'
            }]);
        } catch (error: any) {
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                text: "I'm having trouble connecting right now. Please try again later.",
                sender: 'bot'
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end font-sans">
            {/* Chat Window */}
            {isOpen && (
                <div className="mb-4 w-[380px] h-[600px] bg-bg-surface rounded-[2rem] shadow-float flex flex-col overflow-hidden border border-border-subtle animate-in slide-in-from-bottom-5 duration-300 relative">
                    {/* Detail View Layer */}
                    {selectedOrder && (
                        <OrderDetailModal 
                            order={selectedOrder} 
                            onClose={() => setSelectedOrder(null)} 
                        />
                    )}

                    {/* Header */}
                    <div className="p-5 bg-white flex items-center justify-between shrink-0 border-b border-border-subtle z-10">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                                <Bot size={24} />
                            </div>
                            <div>
                                <h3 className="font-bold text-sm text-slate-900 leading-none mb-1">Aastha AI</h3>
                                <p className="text-[10px] text-slate-500 font-bold flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                    Active Now
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-600 transition-colors"
                            >
                                <Minimize2 size={20} />
                            </button>
                        </div>
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-slate-50/50">
                        {messages.map(msg => (
                            <div
                                key={msg.id}
                                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div className={`max-w-[85%] space-y-2`}>
                                    <div className={`p-4 rounded-[1.5rem] rounded-tl-none text-sm leading-relaxed shadow-sm font-bold ${msg.sender === 'user'
                                        ? 'bg-brand-primary text-white rounded-tr-none rounded-tl-[1.5rem]'
                                        : 'bg-white text-slate-800 border border-border-subtle'
                                        }`}>
                                        {msg.text}
                                    </div>
                                    
                                    {msg.data?.type === 'orders' && msg.data.items && (
                                        <OrderGrid items={msg.data.items} onSelect={setSelectedOrder} />
                                    )}
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-white p-4 rounded-[1.5rem] rounded-tl-none border border-border-subtle shadow-sm flex gap-1.5">
                                    <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                    <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <form onSubmit={handleSend} className="p-4 bg-white border-t border-border-subtle z-10">
                        <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl border border-transparent focus-within:border-brand-primary/20 focus-within:bg-white transition-all">
                            <button type="button" className="p-2 text-slate-400 hover:text-brand-primary transition-colors">
                                <Paperclip size={20} />
                            </button>
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="Ask about your orders..."
                                className="flex-1 bg-transparent border-0 px-2 py-2 text-sm focus:ring-0 outline-none placeholder:text-slate-400 font-bold text-slate-800"
                            />
                            <button
                                type="submit"
                                disabled={!input.trim() || isLoading}
                                className="p-2.5 bg-brand-primary text-white rounded-[1rem] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-brand-primary/20"
                            >
                                <Send size={18} />
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-14 h-14 rounded-2xl shadow-float flex items-center justify-center transition-all duration-500 hover:scale-105 active:scale-95 z-50 ${isOpen
                    ? 'bg-white text-brand-primary rotate-90 border border-border-subtle'
                    : 'bg-brand-primary text-white shadow-brand-primary/30'
                    }`}
            >
                {isOpen ? <X size={24} /> : <MessageSquare size={24} fill="currentColor" />}
            </button>
        </div>
    );
};
