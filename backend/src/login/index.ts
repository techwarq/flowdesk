/**
 * Login Module Index
 * Central export for all platform login functions
 */

// BBK Group (Bucket A - Electron Persistent)
export { loginIqoo } from './iqoo.js';
export { loginVivo } from './vivo.js';
export { loginOppo } from './oppo.js';
export { loginRealme } from './realme.js';
export { loginAmazon } from './amazon.js';

// Bucket B - Replayable
export { loginFlipkart } from './flipkart.js';
export { loginShopsy } from './shopsy.js';
export { loginXiaomi, loginRedmi } from './xiaomi.js';
export { loginSamsung } from './samsung.js';
export { loginOneplus } from './oneplus.js';
export { loginVijaysales } from './vijaysales.js';
export { loginReliancedigital } from './reliancedigital.js';

// Re-export login options interface
export type { LoginOptions } from './flipkart.js';

/**
 * Generic login function that routes to the correct platform
 */
export async function loginPlatform(platform: string, options: { accountId: string; identifier: string; headless?: boolean; keepOpen?: boolean; forceFresh?: boolean }) {
    const normalizedPlatform = platform.toLowerCase();

    switch (normalizedPlatform) {
        // BBK Group (Bucket A)
        case 'iqoo':
            return (await import('./iqoo.js')).loginIqoo(options);
        case 'vivo':
            return (await import('./vivo.js')).loginVivo(options);
        case 'oppo':
            return (await import('./oppo.js')).loginOppo(options);
        case 'realme':
            return (await import('./realme.js')).loginRealme(options);
        case 'amazon':
            return (await import('./amazon.js')).loginAmazon(options);

        // Bucket B - Replayable
        case 'flipkart':
            return (await import('./flipkart.js')).loginFlipkart(options);
        case 'shopsy':
            return (await import('./shopsy.js')).loginShopsy(options);
        case 'xiaomi':
        case 'redmi':
            return (await import('./xiaomi.js')).loginXiaomi(options);
        case 'samsung':
            return (await import('./samsung.js')).loginSamsung(options);
        case 'oneplus':
            return (await import('./oneplus.js')).loginOneplus(options);
        case 'vijaysales':
            return (await import('./vijaysales.js')).loginVijaysales(options);
        case 'reliancedigital':
            return (await import('./reliancedigital.js')).loginReliancedigital(options);

        default:
            throw new Error(`Unsupported platform: ${platform}. Supported platforms: flipkart, shopsy, iqoo, vivo, oppo, realme, xiaomi, redmi, samsung, oneplus, vijaysales, reliancedigital, amazon`);
    }
}
