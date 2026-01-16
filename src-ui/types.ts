import React from 'react';

export type Platform = 'flipkart' | 'shopsy';
export type LoginType = 'email' | 'mobile';
export type AccountStatus =
    | 'New'
    | 'Healthy'
    | 'NeedsRefresh'
    | 'OTPRequired'
    | 'Locked'
    | 'Error';

export type UserRole = 'admin' | 'staff' | 'user';

export interface Account {
    id: string;
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

