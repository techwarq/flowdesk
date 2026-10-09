
import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { PROJECT_ROOT } from './config.js';

const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const COOKIES_DIR = path.join(DATA_DIR, 'cookies');

// Ensure directories exist
fs.ensureDirSync(COOKIES_DIR);

const PLATFORMS: Record<string, string> = {
    'iqoo': 'https://www.iqoo.com/in',
    'vivo': 'https://www.vivo.com/in',
    'redmi': 'https://www.mi.com/in/',
    'xiaomi': 'https://www.mi.com/in/',
    'flipkart': 'https://www.flipkart.com/account/login',
    'shopsy': 'https://www.shopsy.in/'
};

async function main() {
    const args = process.argv.slice(2);
    const platform = args[0]?.toLowerCase();
    const isFresh = args.includes('--fresh') || args.includes('-f');

    if (!platform || !PLATFORMS[platform]) {
        console.error('Usage: npx tsx backend/src/manual_login_tool.ts <platform> [--fresh]');
        console.error('Available platforms:', Object.keys(PLATFORMS).join(', '));
        process.exit(1);
    }

    const url = PLATFORMS[platform];
    const userDataDir = path.join(DATA_DIR, 'profiles', 'manual_tool', platform);

    // Ensure clean start if requested
    if (isFresh && await fs.pathExists(userDataDir)) {
        console.log(`[Tool] Clearing existing profile for ${platform}...`);
        await fs.remove(userDataDir);
    }
    
    await fs.ensureDir(userDataDir);

    console.log(`[Tool] Launching browser for ${platform}...`);
    console.log(`[Tool] URL: ${url}`);
    console.log(`[Tool] User Data Dir: ${userDataDir}`);
    if (isFresh) console.log(`[Tool] Fresh session requested.`);

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: null, // Maximize/Default
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    await page.goto(url);

    console.log('\n==================================================');
    console.log(`  Please LOG IN manually in the opened browser window.`);
    console.log(`  When you are done and see your account page:`);
    console.log(`  Press ENTER in this terminal to capture cookies.`);
    console.log('==================================================\n');

    // Wait for user input
    await new Promise<void>(resolve => {
        process.stdin.once('data', () => {
            resolve();
        });
    });

    console.log('Capturing cookies...');

    // Get Cookies
    const cookies = await context.cookies();
    const cookieFile = path.join(COOKIES_DIR, `manual_${platform}.json`);

    await fs.writeJSON(cookieFile, cookies, { spaces: 2 });

    console.log(`Saved ${cookies.length} cookies to: ${cookieFile}`);

    // Filter for important ones
    const authCookies = cookies.filter(c => ['token', 'session', 'auth', 'at', 'S', 'SN', 'userId', 'passToken'].some(k => c.name.toLowerCase().includes(k)));
    console.log('Potentially interesting auth cookies found:', authCookies.map(c => c.name).join(', '));

    console.log('Closing browser...');
    await context.close();
    process.exit(0);
}

main().catch(console.error);
