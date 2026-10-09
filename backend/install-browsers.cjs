const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

const browsersPath = path.resolve(__dirname, 'browsers');

// Ensure directory exists
if (!fs.existsSync(browsersPath)) {
    fs.mkdirSync(browsersPath, { recursive: true });
}

console.log(`Installing Playwright browsers to: ${browsersPath}`);

try {
    // Set the environment variable to force installation to our local directory
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

    // Support cross-platform builds (e.g., building Windows exe from macOS)
    const targetPlatform = process.env.BROWSER_PLATFORM || process.platform;
    console.log(`Target platform: ${targetPlatform}`);

    // === CRITICAL FIX for Cross-Platform Build (Mac -> Windows) ===
    // If we are defining BROWSER_PLATFORM='win32' but running on Mac/Linux,
    // 'npx playwright install' gave us the Mac/Linux binary despite the override.
    // We must manually swap it for the Windows binary using the direct URL.
    if (targetPlatform === 'win32' && process.platform !== 'win32') {
        console.log('Detected Cross-Platform Build: Manually downloading Windows Chromium...');

        // Hardcoded URL for Chrome 145.0.7632.6 (Playwright 1.57.0 / Chromium 1208)
        // See: https://cdn.playwright.dev/builds/cft/145.0.7632.6/win64/chrome-win64.zip
        const winChromeUrl = 'https://cdn.playwright.dev/builds/cft/145.0.7632.6/win64/chrome-win64.zip';
        const browserDir = path.join(browsersPath, 'chromium-1208'); // Ensure this matches the extracted folder name structure if possible, or we rename it
        // Actually, Playwright expects chromium-<revision>, so 1208 is likely correct for the folder name in older schemes, 
        // OR checks the version. 
        // The previous log showed "chromium-1208" was the directory created by Playwright on Mac.

        // We will create 'chromium-1208' if it doesn't exist, or empty it.
        // Wait, the zip might contain a 'chrome-win64' folder at the root.

        try {
            console.log('Cleaning up existing Mac binaries...');
            // Check if chromium-1208 exists from the mac install we just did (or previous runs)
            const existingDir = fs.readdirSync(browsersPath).find(d => d.startsWith('chromium-'));
            const targetDirName = existingDir || 'chromium-1208';
            const targetDir = path.join(browsersPath, targetDirName);

            fs.emptyDirSync(targetDir);

            const zipPath = path.join(targetDir, 'chromium-win64.zip');

            console.log(`Downloading Windows Chromium from ${winChromeUrl}...`);
            execSync(`curl -L -o "${zipPath}" "${winChromeUrl}"`, { stdio: 'inherit' });

            console.log('Extracting Windows binaries...');
            // Unzip
            try {
                // Try unzip command first as it's cleaner on Mac
                execSync(`unzip -o "${zipPath}" -d "${targetDir}"`, { stdio: 'inherit' });
            } catch (e) {
                console.log('unzip command failed, trying adm-zip...');
                const zip = new AdmZip(zipPath);
                zip.extractAllTo(targetDir, true);
            }

            // Cleanup zip
            fs.unlinkSync(zipPath);

            // Re-create Playwright marker files that were deleted by emptyDirSync
            fs.writeFileSync(path.join(targetDir, 'INSTALLATION_COMPLETE'), '');
            console.log('✅ Successfully replaced Mac Chromium with Windows Chromium and restored markers.');

            // Also need ffmpeg?
            // For now, let's just get Chrome working. 

        } catch (e) {
            console.error('Failed to manually download Windows Chromium:', e);
            throw e;
        }
    } else {
        // Standard install for current platform (or if already on Windows)
        console.log('Running Playwright install for chromium...');
        // We only need chromium for this app
        const installCmd = targetPlatform === 'win32'
            ? 'npx playwright install chromium --with-deps'
            : 'npx playwright install chromium';

        execSync(installCmd, {
            stdio: 'inherit',
            env: process.env,
            cwd: __dirname
        });
    }

    // Antigravity Fix: Delete setup.exe if it exists
    try {
        const chromiumDir = fs.readdirSync(browsersPath).find(d => d.startsWith('chromium-'));
        if (chromiumDir) {
            // Check both possible locations
            const setupPaths = [
                path.join(browsersPath, chromiumDir, 'chrome-win64', 'setup.exe'),
                path.join(browsersPath, chromiumDir, 'chrome-win', 'setup.exe')
            ];

            for (const setupPath of setupPaths) {
                if (fs.existsSync(setupPath)) {
                    console.log(`Removing ${setupPath} to prevent build conflicts...`);
                    fs.unlinkSync(setupPath);
                }
            }
        }
    } catch (e) {
        console.warn('Failed to cleanup setup.exe:', e);
    }

    console.log('Browser installation complete.');
} catch (error) {
    console.error('Failed to install browsers:', error);
    process.exit(1);
}
