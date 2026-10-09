import React from 'react';
import { X, ShoppingBag, Truck, Info, Calendar, User, Smartphone, Package, Key, MapPin, ExternalLink } from 'lucide-react';
import { Order, Platform } from '../types';

interface OrderDetailModalProps {
    order: Order & { platform?: Platform };
    onClose: () => void;
}

export const OrderDetailModal: React.FC<OrderDetailModalProps> = ({ order, onClose }) => {
    return (
        <div className="absolute inset-0 z-[60] bg-white animate-in slide-in-from-right duration-300 flex flex-col">
            <div className="p-4 border-b border-border-subtle flex items-center justify-between bg-white shrink-0">
                <button 
                    onClick={onClose}
                    className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors flex items-center gap-2"
                >
                    <X size={20} />
                    <span className="text-sm font-bold">Details</span>
                </button>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full uppercase">
                        {order.platform || 'General'}
                    </span>
                </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {/* Product Header */}
                <div className="flex gap-4">
                    <div className="w-24 h-24 rounded-2xl bg-slate-50 border border-slate-100 flex-shrink-0 overflow-hidden shadow-sm">
                        {order.imageUrl ? (
                            <img src={order.imageUrl} alt={order.productName} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-300">
                                <ShoppingBag size={40} />
                            </div>
                        )}
                    </div>
                    <div className="flex-1 py-1">
                        <h3 className="text-sm font-black text-slate-900 leading-tight mb-2 line-clamp-3">{order.productName}</h3>
                        <div className="flex items-center gap-2">
                            <span className="text-lg font-black text-brand-primary">{order.price || 'N/A'}</span>
                        </div>
                    </div>
                </div>

                {/* Status Card */}
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Order Status</span>
                        <div className="px-3 py-1 bg-white rounded-full border border-slate-200 text-[10px] font-black text-brand-primary shadow-sm">
                            {order.status}
                        </div>
                    </div>
                    {order.realtimeStatus && (
                        <div className="flex items-center gap-3 text-sm font-bold text-slate-700">
                            <Truck size={18} className="text-blue-500" />
                            {order.realtimeStatus}
                        </div>
                    )}
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-1 gap-4">
                    <DetailItem icon={<Info size={16} />} label="Order ID" value={order.orderId} />
                    {order.orderDate && <DetailItem icon={<Calendar size={16} />} label="Order Date" value={order.orderDate} />}
                    {order.deliveryDate && <DetailItem icon={<Truck size={16} />} label="Delivery Date" value={order.deliveryDate} />}
                    {order.receiverName && <DetailItem icon={<User size={16} />} label="Receiver" value={order.receiverName} />}
                    {order.mobileLast4 && <DetailItem icon={<Smartphone size={16} />} label="Mobile (Last 4)" value={`xxxxxx${order.mobileLast4}`} />}
                    {order.trackingId && <DetailItem icon={<Package size={16} />} label="Tracking ID" value={order.trackingId} />}
                    {order.otp && (
                        <div className="flex items-center justify-between p-4 bg-brand-primary/5 rounded-2xl border border-brand-primary/10">
                            <div className="flex items-center gap-3">
                                <Key size={18} className="text-brand-primary" />
                                <span className="text-xs font-black text-brand-primary uppercase">Delivery OTP</span>
                            </div>
                            <span className="text-lg font-black text-brand-primary tracking-[0.2em]">{order.otp}</span>
                        </div>
                    )}
                </div>

                {/* Delivery details text if many detail scraped */}
                {order.deliveryDetails && (
                   <div className="space-y-2">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Raw Delivery Info</span>
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-[11px] text-slate-600 font-medium leading-relaxed whitespace-pre-wrap">
                            {order.deliveryDetails}
                        </div>
                   </div>
                )}

                {/* Address */}
                {order.address && (
                    <div className="space-y-2">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Delivery Address</span>
                        <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <MapPin size={18} className="text-slate-400 mt-0.5 shrink-0" />
                            <p className="text-xs text-slate-700 font-bold leading-normal">{order.address}</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border-subtle bg-slate-50 shrink-0">
                {order.orderUrl && order.platform !== 'flipkart' && (
                    <a 
                        href={order.orderUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="w-full flex items-center justify-center gap-3 py-4 bg-brand-primary text-white rounded-2xl font-black text-sm shadow-xl shadow-brand-primary/20 hover:opacity-90 active:scale-95 transition-all"
                    >
                        View on Portal
                        <ExternalLink size={18} />
                    </a>
                )}
            </div>
        </div>
    );
};

const DetailItem: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
    <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-border-subtle shadow-sm">
        <div className="flex items-center gap-3">
            <div className="text-slate-400">{icon}</div>
            <span className="text-xs font-black text-slate-400 uppercase tracking-tight">{label}</span>
        </div>
        <span className="text-xs font-bold text-slate-800 text-right max-w-[50%] truncate">{value}</span>
    </div>
);
