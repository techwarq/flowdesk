/**
 * cloud_provider.ts — Auto-switching cloud backend
 *
 * Priority:
 *   1. If MONGODB_URI is set → use MongoDB (cloud_mongo.ts)
 *   2. Otherwise            → use Supabase (cloud.ts)
 */

import * as supaModule from './cloud.js';

const useMongo = !!process.env.MONGODB_URI;

if (useMongo) {
    console.log('[Provider] Using MongoDB as cloud backend');
} else {
    console.log('[Provider] Using Supabase as cloud backend');
}

// ─── Dynamic import helper for Mongo ──────────────────────────────────────────
async function mongo() {
    return import('./cloud_mongo.js');
}

// ─── Exported functions (same signatures as cloud.ts / cloud_mongo.ts) ─────────

export async function checkCloudConnection() {
    return useMongo ? (await mongo()).checkCloudConnection() : supaModule.checkCloudConnection();
}

export async function pushAccount(acc: any) {
    return useMongo ? (await mongo()).pushAccount(acc) : supaModule.pushAccount(acc);
}

export async function fetchAccountsFromCloud(userId?: string) {
    return useMongo ? (await mongo()).fetchAccountsFromCloud(userId) : supaModule.fetchAccountsFromCloud(userId);
}

export async function fetchAccountFromCloud(accountId: string) {
    return useMongo ? (await mongo()).fetchAccountFromCloud(accountId) : supaModule.fetchAccountFromCloud(accountId);
}

export async function deleteAccountFromCloud(accountId: string) {
    return useMongo ? (await mongo()).deleteAccountFromCloud(accountId) : supaModule.deleteAccountFromCloud(accountId);
}

export async function saveAccountsToDB(data: any) {
    return useMongo ? (await mongo()).saveAccountsToDB(data) : supaModule.saveAccountsToDB(data);
}

export async function saveCookies_DB(accountId: string, platform: string, cookies: any[]) {
    return useMongo ? (await mongo()).saveCookies_DB(accountId, platform, cookies) : supaModule.saveCookies_DB(accountId, platform, cookies);
}

export async function pushCookies(accountId: string, platform: string, directCookies?: any[]) {
    return useMongo ? (await mongo()).pushCookies(accountId, platform, directCookies) : supaModule.pushCookies(accountId, platform, directCookies);
}

export async function pushLocalStorage(accountId: string, platform: string, directData?: Record<string, any>) {
    return useMongo ? (await mongo()).pushLocalStorage(accountId, platform, directData) : supaModule.pushLocalStorage(accountId, platform, directData);
}

export async function fetchLocalStorage(accountId: string, platform: string) {
    return useMongo ? (await mongo()).fetchLocalStorage(accountId, platform) : supaModule.fetchLocalStorage(accountId, platform);
}

export async function fetchCookiesFromCloud(accountId: string, platform: string) {
    return useMongo ? (await mongo()).fetchCookiesFromCloud(accountId, platform) : supaModule.fetchCookiesFromCloud(accountId, platform);
}

export async function pullSyncData() {
    return useMongo ? (await mongo()).pullSyncData() : supaModule.pullSyncData();
}

export async function logActivity(username: string, action: string, data: any = {}) {
    return useMongo ? (await mongo()).logActivity(username, action, data) : supaModule.logActivity(username, action, data);
}

export async function reportError(username: string, message: string, stack?: string, context: any = {}) {
    return useMongo ? (await mongo()).reportError(username, message, stack, context) : supaModule.reportError(username, message, stack, context);
}

export async function fetchCloudUsers() {
    return useMongo ? (await mongo()).fetchCloudUsers() : supaModule.fetchCloudUsers();
}

export async function upsertCloudUser(user: any) {
    return useMongo ? (await mongo()).upsertCloudUser(user) : supaModule.upsertCloudUser(user);
}

export async function deleteCloudUser(username: string) {
    return useMongo ? (await mongo()).deleteCloudUser(username) : supaModule.deleteCloudUser(username);
}

export async function fetchActivityLogs() {
    return useMongo ? (await mongo()).fetchActivityLogs() : supaModule.fetchActivityLogs();
}

export async function fetchAppErrors() {
    return useMongo ? (await mongo()).fetchAppErrors() : supaModule.fetchAppErrors();
}

export async function deleteCloudAccount(accountId: string) {
    return useMongo ? (await mongo()).deleteCloudAccount(accountId) : supaModule.deleteCloudAccount(accountId);
}

export async function updateAccountOwnershipInDB(accountIds: string[], targetUserId: string) {
    return useMongo ? (await mongo()).updateAccountOwnershipInDB(accountIds, targetUserId) : supaModule.updateAccountOwnershipInDB(accountIds, targetUserId);
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function listNotifications(userId?: string) {
    return useMongo ? (await mongo()).listNotifications(userId) : supaModule.listNotifications?.(userId);
}

export async function createNotification(n: any) {
    return useMongo ? (await mongo()).createNotification(n) : supaModule.createNotification?.(n);
}

export async function updateNotificationStatus(id: string, status: string) {
    return useMongo ? (await mongo()).updateNotificationStatus(id, status) : supaModule.updateNotificationStatus?.(id, status);
}

export async function getNotification(id: string) {
    return useMongo ? (await mongo()).getNotification(id) : supaModule.getNotification?.(id);
}

// ─── Supabase-specific compat shims ───────────────────────────────────────────

export function getSupabase() {
    if (useMongo) {
        return { _provider: 'mongodb' };
    }
    return supaModule.getSupabase();
}

export function getSupabaseClient() {
    if (useMongo) return null;
    return supaModule.getSupabaseClient();
}

export function getSupabaseAdminClient() {
    if (useMongo) return null;
    return supaModule.getSupabaseAdminClient();
}

// pushAccounts — Supabase only, no-op in Mongo
export async function pushAccounts() {
    if (useMongo) return;
    return supaModule.pushAccounts?.();
}

// pushAllCookies — Supabase only, no-op in Mongo
export async function pushAllCookies() {
    if (useMongo) return;
    return supaModule.pushAllCookies?.();
}
