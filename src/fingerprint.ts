import { webkit, devices } from 'playwright';

export interface Fingerprint {
    userAgent: string;
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    locale: string;
    timezoneId: string;
    hasTouch: boolean;
    isMobile: boolean;
    javaScriptEnabled: boolean;
}

const DESKTOP_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0"
];

// Shopsy is mobile-only, so we mostly need valid mobile configurations
const MOBILE_DEVICES = [
    devices['Pixel 5'],
    devices['Pixel 7'],
    devices['Samsung Galaxy S20 Ultra'],
    devices['iPhone 12'], // Careful with iPhone emulation on Chromium, usually fine for detection
];

export function generateFingerprint(platform: 'flipkart' | 'shopsy', seed: string): Fingerprint {
    // Simple deterministic generation based on seed string sum
    let sum = 0;
    for (let i = 0; i < seed.length; i++) {
        sum += seed.charCodeAt(i);
    }

    if (platform === 'shopsy') {
        const deviceIndex = sum % MOBILE_DEVICES.length;
        const device = MOBILE_DEVICES[deviceIndex];
        return {
            userAgent: device.userAgent,
            viewport: device.viewport,
            deviceScaleFactor: device.deviceScaleFactor,
            locale: 'en-IN', // Focus on India for Shopsy/Flipkart
            timezoneId: 'Asia/Kolkata',
            hasTouch: device.hasTouch,
            isMobile: device.isMobile,
            javaScriptEnabled: true
        };
    } else {
        // Flipkart Desktop
        const uaIndex = sum % DESKTOP_USER_AGENTS.length;
        return {
            userAgent: DESKTOP_USER_AGENTS[uaIndex],
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 1,
            locale: 'en-IN',
            timezoneId: 'Asia/Kolkata',
            hasTouch: false,
            isMobile: false,
            javaScriptEnabled: true
        };
    }
}
