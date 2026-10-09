// ═══════════════════════════════════════════════════════════════════
// ORDER CACHE WITH TTL (Memoization / Time-based invalidation)
// ═══════════════════════════════════════════════════════════════════
import { CacheEntry } from './orderTypes.js';
/**
 * DSA Concept: HashMap + TTL (Time-based cache invalidation)
 * 
 * Purpose:
 * - Show cached orders IMMEDIATELY (no wait)
 * - Refresh in background
 * - Avoid redundant scraping
 */
class OrderCache {
    // Map<accountId+platform, CacheEntry>
    private cache: Map<string, CacheEntry> = new Map();

    // Default TTL: 5 minutes (orders don't change that fast)
    private DEFAULT_TTL_MS = 5 * 60 * 1000;

    /**
     * Generate cache key from account + platform
     */
    private getCacheKey(accountId: string, platform: string): string {
        return `${accountId.toLowerCase()}:${platform}`;
    }

    /**
     * Get cached orders if valid (not expired)
     * Returns null if cache miss or expired
     */
    get(accountId: string, platform: string): any[] | null {
        const key = this.getCacheKey(accountId, platform);
        const entry = this.cache.get(key);

        if (!entry) {
            console.log(`[Cache] MISS - No cache for ${key}`);
            return null;
        }

        const now = Date.now();
        const age = now - entry.timestamp;

        if (age > entry.ttlMs) {
            console.log(`[Cache] EXPIRED - ${key} (age: ${age}ms, ttl: ${entry.ttlMs}ms)`);
            this.cache.delete(key);
            return null;
        }

        console.log(`[Cache] HIT - ${key} (age: ${age}ms)`);
        return entry.orders;
    }

    /**
     * Store orders in cache with TTL
     */
    set(accountId: string, platform: string, orders: any[], ttlMs?: number): void {
        const key = this.getCacheKey(accountId, platform);

        const entry: CacheEntry = {
            orders,
            timestamp: Date.now(),
            ttlMs: ttlMs ?? this.DEFAULT_TTL_MS,
            accountId,
            platform
        };

        this.cache.set(key, entry);
        console.log(`[Cache] SET - ${key} (${orders.length} orders, ttl: ${entry.ttlMs}ms)`);
    }

    /**
     * Invalidate (delete) cache for a specific account+platform
     * Call this when user explicitly requests refresh
     */
    invalidate(accountId: string, platform: string): void {
        const key = this.getCacheKey(accountId, platform);
        const deleted = this.cache.delete(key);
        console.log(`[Cache] INVALIDATE - ${key} (found: ${deleted})`);
    }

    /**
     * Clear all cache entries
     */
    clear(): void {
        const size = this.cache.size;
        this.cache.clear();
        console.log(`[Cache] CLEARED - ${size} entries removed`);
    }

    /**
     * Get cache stats (for debugging/monitoring)
     */
    getStats(): { size: number; keys: string[] } {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }

    /**
     * Check if data is stale (but still return it)
     * Useful for deciding if background refresh is needed
     */
    isStale(accountId: string, platform: string, staleThresholdMs: number = 2 * 60 * 1000): boolean {
        const key = this.getCacheKey(accountId, platform);
        const entry = this.cache.get(key);

        if (!entry) return true;

        const age = Date.now() - entry.timestamp;
        return age > staleThresholdMs;
    }
}
// Export singleton instance
export const orderCache = new OrderCache();