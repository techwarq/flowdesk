import { useState, useRef, useCallback } from 'react';
import { api } from '../api/client';
import { Account, Order } from '../types';

export interface FetchState {
    status: 'idle' | 'fetching' | 'done' | 'error';
    error?: string;
}

export interface DataFetcherResult {
    // Orders data keyed by account ID
    ordersData: Record<string, Order[]>;
    // GV balance data keyed by account ID
    gvData: Record<string, string>;

    // Per-account fetch states
    orderStates: Record<string, FetchState>;
    gvStates: Record<string, FetchState>;

    // Overall fetching status
    isOrdersFetching: boolean;
    isGVFetching: boolean;

    // Current account being fetched (for UI display)
    currentOrderAccountId: string | null;
    currentGVAccountId: string | null;

    // Trigger functions
    triggerOrdersFetch: (accounts: Account[], onComplete?: () => void) => void;
    triggerGVFetch: (accounts: Account[], batchSize?: number) => void;

    // Cancel functions
    cancelOrdersFetch: () => void;
    cancelGVFetch: () => void;
}

export function useDataFetcher(): DataFetcherResult {
    // Data stores
    const [ordersData, _setOrdersData] = useState<Record<string, Order[]>>({});
    const [gvData, setGvData] = useState<Record<string, string>>({});

    // Per-account states
    const [orderStates, setOrderStates] = useState<Record<string, FetchState>>({});
    const [gvStates, setGvStates] = useState<Record<string, FetchState>>({});

    // Overall status
    const [isOrdersFetching, setIsOrdersFetching] = useState(false);
    const [isGVFetching, setIsGVFetching] = useState(false);

    // Current account being fetched
    const [currentOrderAccountId, setCurrentOrderAccountId] = useState<string | null>(null);
    const [currentGVAccountId, setCurrentGVAccountId] = useState<string | null>(null);

    // Race condition prevention - increment to cancel previous fetches
    const ordersFetchId = useRef(0);
    const gvFetchId = useRef(0);

    // Cancel flags
    const cancelOrdersRef = useRef(false);
    const cancelGVRef = useRef(false);

    const triggerOrdersFetch = useCallback(async (accounts: Account[], onComplete?: () => void) => {
        if (accounts.length === 0) return;

        const currentFetchId = ++ordersFetchId.current;
        cancelOrdersRef.current = false;

        setIsOrdersFetching(true);
        setOrderStates({});

        // Initialize all accounts as idle
        const initialStates: Record<string, FetchState> = {};
        accounts.forEach(acc => {
            initialStates[acc.id] = { status: 'idle' };
        });
        setOrderStates(initialStates);

        try {
            // Start multi-platform batch job
            const batchResult = await api.startMultiPlatformBatch(
                accounts.map(a => ({ accountId: a.id, platform: a.platform }))
            );

            if (!batchResult.success) {
                throw new Error('Failed to start batch fetch');
            }

            const { jobId } = batchResult;

            // Polling loop
            const poll = async () => {
                if (cancelOrdersRef.current || currentFetchId !== ordersFetchId.current) {
                    return;
                }

                try {
                    const status = await api.getMultiPlatformBatchStatus(jobId);
                    if (!status.success || !status.job) {
                        setTimeout(poll, 2000);
                        return;
                    }

                    const { job } = status;
                    const newStates: Record<string, FetchState> = { ...initialStates };

                    // Update successful
                    job.successful.forEach((res: any) => {
                        newStates[res.accountId] = { status: 'done' };
                    });

                    // Update failed
                    job.failed.forEach((err: any) => {
                        newStates[err.accountId] = { status: 'error', error: err.error };
                    });

                    // If job is still running, check who's idle and mark as fetching
                    if (!job.stats.endTime) {
                        accounts.forEach(acc => {
                            if (!newStates[acc.id] || newStates[acc.id].status === 'idle') {
                                newStates[acc.id] = { status: 'fetching' };
                            }
                        });
                        setOrderStates(newStates);
                        setTimeout(poll, 2000);
                    } else {
                        // Job complete
                        setOrderStates(newStates);
                        setIsOrdersFetching(false);
                        setCurrentOrderAccountId(null);
                        if (onComplete) onComplete();
                    }
                } catch (err) {
                    console.error('Polling error:', err);
                    setTimeout(poll, 5000);
                }
            };

            poll();

        } catch (err: any) {
            setIsOrdersFetching(false);
            setOrderStates(prev => {
                const updated = { ...prev };
                accounts.forEach(acc => {
                    if (updated[acc.id]?.status !== 'done') {
                        updated[acc.id] = { status: 'error', error: err.message };
                    }
                });
                return updated;
            });
        }
    }, []);

    const triggerGVFetch = useCallback(async (accounts: Account[], batchSize: number = 1) => {
        if (accounts.length === 0) return;

        // Increment fetch ID to invalidate any previous fetch
        const currentFetchId = ++gvFetchId.current;
        cancelGVRef.current = false;

        // Reset states
        setIsGVFetching(true);
        // Do not reset gvData here, just update what we fetch
        setGvStates({});

        // Initialize all accounts as idle
        const initialStates: Record<string, FetchState> = {};
        accounts.forEach(acc => {
            initialStates[acc.id] = { status: 'idle' };
        });
        setGvStates(initialStates);

        // Process in batches
        const processBatch = async (batch: Account[]) => {
            await Promise.all(batch.map(async (account) => {
                if (cancelGVRef.current || currentFetchId !== gvFetchId.current) return;

                setGvStates(prev => ({
                    ...prev,
                    [account.id]: { status: 'fetching' }
                }));

                try {
                    const result = await api.fetchGVBalance(account.id, account.platform);

                    if (cancelGVRef.current || currentFetchId !== gvFetchId.current) return;

                    if (result.success && result.gvBalance) {
                        setGvData(prev => ({
                            ...prev,
                            [account.id]: result.gvBalance
                        }));
                        setGvStates(prev => ({
                            ...prev,
                            [account.id]: { status: 'done' }
                        }));
                    } else {
                        setGvStates(prev => ({
                            ...prev,
                            [account.id]: {
                                status: 'error',
                                error: result.message || 'Failed'
                            }
                        }));
                    }
                } catch (err: any) {
                    if (currentFetchId === gvFetchId.current && !cancelGVRef.current) {
                        setGvStates(prev => ({
                            ...prev,
                            [account.id]: {
                                status: 'error',
                                error: err.message || 'Network error'
                            }
                        }));
                    }
                }
            }));
        };

        // Split accounts into batches
        for (let i = 0; i < accounts.length; i += batchSize) {
            if (cancelGVRef.current || currentFetchId !== gvFetchId.current) break;
            const batch = accounts.slice(i, i + batchSize);
            await processBatch(batch);
        }

        // Only update if this is still the current fetch
        if (currentFetchId === gvFetchId.current) {
            setIsGVFetching(false);
            setCurrentGVAccountId(null);
        }
    }, []);

    const cancelOrdersFetch = useCallback(() => {
        cancelOrdersRef.current = true;
        setIsOrdersFetching(false);
        setCurrentOrderAccountId(null);
    }, []);

    const cancelGVFetch = useCallback(() => {
        cancelGVRef.current = true;
        setIsGVFetching(false);
        setCurrentGVAccountId(null);
    }, []);

    return {
        ordersData,
        gvData,
        orderStates,
        gvStates,
        isOrdersFetching,
        isGVFetching,
        currentOrderAccountId,
        currentGVAccountId,
        triggerOrdersFetch,
        triggerGVFetch,
        cancelOrdersFetch,
        cancelGVFetch
    };
}
