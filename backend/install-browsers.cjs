const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { pipeline } = require('stream');

const browsersPath = path.resolve(__dirname, 'browsers');
const targetPlatform = process.env.BROWSER_PLATFORM || process.platform;

// Ensure directory exists
if (!fs.existsSync(browsersPath)) {
    fs.mkdirSync(browsersPath, { recursive: true });
}

console.log(`Preparing browsers for platform: ${targetPlatform} in ${browsersPath}`);

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
                console.log(`Redirecting to: ${response.headers.location}`);
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }

            const file = fs.createWriteStream(dest);
            pipeline(response, file, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        request.on('error', reject);
    });
}

async function installWindowsBrowsers() {
    // Hardcoded for Playwright 1.57.0 (Chromium Build 1200)
    const revision = '1200';
    const url = `https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/${revision}/chromium-win64.zip`;
    const zipPath = path.join(browsersPath, 'chromium-win64.zip');

    console.log(`Downloading Windows Chromium (Build ${revision}) from ${url}...`);
    await downloadFile(url, zipPath);

    console.log('Download complete. Extracting...');
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(browsersPath, true);

    // Cleanup
    fs.unlinkSync(zipPath);

    // Check extraction result
    const extractPath = path.join(browsersPath, 'chrome-win');
    const targetPath = path.join(browsersPath, `chromium-${revision}`);

    if (fs.existsSync(extractPath)) {
        if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true });
        // Rename with retry to avoid lock issues
        try {
            fs.renameSync(extractPath, targetPath);
        } catch (e) {
            // Wait and retry
            console.log('Rename failed, retrying in 1s...');
            await new Promise(r => setTimeout(r, 1000));
            fs.renameSync(extractPath, targetPath);
        }
        console.log(`Renamed ${extractPath} to ${targetPath}`);
    }
    console.log('Windows browser installed.');
}

if (targetPlatform === 'win32') {
    installWindowsBrowsers().catch(err => {
        console.error('Failed to install Windows browsers:', err);
        process.exit(1);
    });
} else {
    try {
        process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
        console.log('Running standard Playwright install for current OS...');
        execSync('npx playwright install chromium', {
            stdio: 'inherit',
            env: process.env
        });
    } catch (error) {
        console.error('Install failed:', error);
        process.exit(1);
    }
}
