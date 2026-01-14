# Flipkart/Shopsy Multi-Account Auto-Login Automation

A robust Node.js + Playwright automation tool for managing multiple Flipkart and Shopsy accounts. It handles first-time headed logins (with OTP support), saves encrypted profiles, and enables silent auto-login for subsequent sessions.

## Features

- **Multi-Platform**: Support for both Flipkart (Desktop) and Shopsy (Mobile Emulation).
- **Persistent Sessions**: Saves `userDataDir` to avoid repeated logins.
- **Security**: AES-256-GCM encryption for profile backups. Passphrase required.
- **Device Fingerprinting**: Stable, per-account fingerprints (User-Agent, viewport, etc.) to reduce detection risk.
- **Health Checks**: Automated batch checking of session validity.
- **CLI Interface**: Easy-to-use commands for all operations.
- **Portable**: Data directory structure designed for easy backup and migration (e.g., to a future desktop app).

## Prerequisites

- Node.js (v18 or higher)
- npm

## Installation

1. Clone or download this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

## Usage

Run the CLI using `npm start` or directly via node.

### 1. Initialize an Account (First-time Login)
Opens a headed browser for you to enter the OTP.
```bash
npm start -- init --platform flipkart --account-id my_acc_1 --identifier 9876543210
# For Shopsy (Mobile Login)
npm start -- init --platform shopsy --account-id my_shopsy_1 --identifier 9876543210
```

### 2. Open a Session
Launches the browser with the saved, logged-in profile.
```bash
npm start -- open --account-id my_acc_1
```

### 3. Check Account Health
Checks if sessions are still valid without opening a visible browser (headless).
```bash
npm start -- check --batch all
# Or for a specific account
npm start -- check --account-id my_acc_1
```

### 4. Refresh Sessions
Attempts to refresh sessions. If a session is expired, it can silently falil or prompt for simple re-validation.
```bash
npm start -- refresh --batch all
```

### 5. Export Profile (Backup)
Encrypts the profile and saves it to `data/encrypted/`.
```bash
npm start -- export --account-id my_acc_1
```

### 6. Import Profile
Restores a profile from an encrypted backup.
```bash
npm start -- import --account-id my_acc_1 --platform flipkart
```

## Data Structure

All data is stored in the `./data` directory:
- `data/config.json`: Global settings.
- `data/accounts.json`: List of managed accounts and their status.
- `data/profiles/`: Active Playwright profile directories (do not touch manually).
- `data/encrypted/`: Encrypted ZIP backups of profiles.
- `data/logs/`: Activity logs per account.

## Risk Disclosure

> [!WARNING]
> **Use at your own risk.**
> Automating interactions with Flipkart and Shopsy may violate their Terms of Service. This tool is provided for educational and research purposes only.
> - Platforms may detect automation and lock accounts.
> - We implement stealth techniques (fingerprinting, jitter), but detection capability changes constantly.
> - Always perform critical actions manually if in doubt.

## Migration to Desktop App

This script is designed to be forward-compatible. The `data/` folder structure is self-contained. To migrate to the future Electron/Tauri app:
1. Copy the entire `data/` folder to the desktop app's storage location.
2. The desktop app will be able to read `accounts.json` and decrypt the profiles using your passphrase.
