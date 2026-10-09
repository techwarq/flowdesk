
export { };

declare global {
    interface Window {
        electron: {
            sendAppReady: () => void;
            setCookies: (partition: string, cookies: any[]) => void;
            setProxy: (partition: string, proxyRules: string) => void;
            getCookies: (partition: string) => void;
            getIpInfo: (partition: string) => void;

            // Session Injection (iQOO, Xiaomi, etc.)
            setFingerprint: (partition: string, fingerprint: {
                userAgent: string;
                viewport?: { width: number; height: number };
                locale?: string;
                timezoneId?: string;
            }) => Promise<{ success: boolean }>;

            setPreloadLS: (partition: string, data: Record<string, string>) => Promise<{ success: boolean }>;
            getPreloadLS: (partition: string) => Promise<Record<string, string> | null>;

            // Hidden Origin Warmup (Critical for BBK Group sites: iQOO, Vivo, Oppo, Realme)
            warmupOrigin: (partition: string, url: string, userAgent: string) => Promise<{ success: boolean; error?: string }>;

            on: (channel: string, func: (...args: any[]) => void) => () => void;
            removeListener: (channel: string, func: (...args: any[]) => void) => void;
        };
    }
}
