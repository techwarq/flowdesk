import React from 'react';

export type Platform =
    | 'flipkart'
    | 'shopsy'
    | 'amazon'
    | 'blinkit'
    | 'reliance'
    | 'reliancedigital'
    | 'vivo'
    | 'oppo'
    | 'redmi'
    | 'realme'
    | 'samsung'
    | 'zepto'
    | 'vijaysales'
    | 'oneplus'
    | 'xiaomi'
    | 'iqoo';
export type LoginType = 'email' | 'mobile';
export type AccountStatus =
    | 'New'
    | 'Healthy'
    | 'NeedsRefresh'
    | 'OTPRequired'
    | 'Locked'
    | 'Error';

export type UserRole = 'admin' | 'staff' | 'user';

export interface Order {
    orderId: string;
    productName: string;
    status: string;
    deliveryDate: string;
    imageUrl?: string;
    price?: string;
    orderUrl: string;
    otp?: string;
    receiverName?: string;
    trackingId?: string;
    deliveryDetails?: string;
    address?: string;
    mobileLast4?: string;
    carrier?: string;
    orderDate?: string;
    realtimeStatus?: string;
}

export interface Account {
    id: string;
    userId?: string;
    platform: Platform;
    loginType: LoginType;
    identifier: string;
    status: AccountStatus;
    assignedTo?: string;
    lastLoginAt?: string;
    lastValidateAt?: string;
    errorCode?: string;
    createdAt: string;
    updatedAt: string;
    orders?: Order[];
    details?: {
        gvBalance?: string;
        [key: string]: any;
    };
    proxy?: string;
}

export interface UserProfile {
    id: string;
    username: string;
    role: UserRole;
    allowedAccounts?: number;
    createdAt?: string;
}

export interface NavItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    badge?: string;
}

