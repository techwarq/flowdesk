#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { initDirs, loadConfig, OPERATORS_FILE } from './config.js';
import { loginFlipkart } from './login/flipkart.js';
import { loginShopsy } from './login/shopsy.js';
import { checkAccountHealth } from './check/health.js';
import { refreshSession } from './refresh/flow.js';
import { saveProfileToDisk, restoreProfileFromDisk, setGlobalPassphrase } from './profiles/store.js';
import { loadAccounts, upsertAccount, getAccount, type Platform, type LoginType } from './accounts.js';
import logger from './log.js';
import fs from 'fs-extra';

const program = new Command();

program
    .name('fsa')
    .description('Flipkart/Shopsy multi-account auto-login automation')
    .version('1.0.0');

// Initialize directories on startup
async function setup() {
    await initDirs();
    await loadConfig();
}

// Init command: First-time login with OTP
program
    .command('init')
    .description('Initialize a new account with headed login (OTP required)')
    .requiredOption('--platform <platform>', 'Platform: flipkart or shopsy')
    .requiredOption('--account-id <id>', 'Unique account identifier')
    .option('--identifier <value>', 'Phone number or email')
    .option('--login-type <type>', 'Login type: email or mobile', 'mobile')
    .action(async (options) => {
        await setup();

        const platform = options.platform as Platform;
        const accountId = options.accountId;
        let identifier = options.identifier;
        const loginType = options.loginType as LoginType;

        if (!['flipkart', 'shopsy'].includes(platform)) {
            console.log(chalk.red('Invalid platform. Use "flipkart" or "shopsy".'));
            process.exit(1);
        }

        if (platform === 'shopsy' && loginType === 'email') {
            console.log(chalk.yellow('Shopsy only supports mobile login.'));
        }

        // Prompt for identifier if not provided
        if (!identifier) {
            const answers = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'identifier',
                    message: `Enter ${loginType === 'email' ? 'email' : 'mobile number'}:`,
                },
            ]);
            identifier = answers.identifier;
        }

        // Prompt for passphrase for encryption
        const { passphrase } = await inquirer.prompt([
            {
                type: 'password',
                name: 'passphrase',
                message: 'Enter required encryption passphrase (for profile backup):',
                mask: '*',
            },
        ]);
        setGlobalPassphrase(passphrase);

        // Create/update account
        // For Shopsy, warn if matching Flipkart account is missing or unhealthy
        if (platform === 'shopsy') {
            const data = await loadAccounts();
            const flipkartAcc = data.accounts.find(
                a => a.platform === 'flipkart' && a.identifier === identifier
            );

            if (!flipkartAcc) {
                console.log(chalk.yellow('\n[!] Warning: No corresponding Flipkart account found for this identifier.'));
                console.log(chalk.yellow('    It is recommended to initialize the Flipkart account first as per platform rules.'));
                const { proceed } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'proceed',
                    message: 'Do you want to proceed anyway?',
                    default: true
                }]);
                if (!proceed) process.exit(0);
            } else if (flipkartAcc.status !== 'Healthy') {
                console.log(chalk.yellow(`\n[!] Warning: The corresponding Flipkart account (${flipkartAcc.id}) is not marked as Healthy.`));
                console.log(chalk.yellow('    Status: ' + flipkartAcc.status));
            }
        }

        await upsertAccount({
            id: accountId,
            platform,
            loginType: platform === 'shopsy' ? 'mobile' : loginType,
            identifier,
            status: 'New',
        });

        console.log(chalk.blue(`\nStarting ${platform} login for ${accountId}...`));
        console.log(chalk.yellow('A browser window will open. Please enter the OTP when prompted.\n'));

        try {
            let result;
            if (platform === 'flipkart') {
                result = await loginFlipkart({ accountId, identifier, headless: false });
            } else {
                result = await loginShopsy({ accountId, identifier, headless: false });
            }

            if (result.status === 'success') {
                console.log(chalk.green(`\n✓ ${result.message}`));
                console.log(chalk.gray('Profile saved and encrypted.'));
            } else {
                console.log(chalk.red(`\n✗ Login failed: ${result.message}`));
            }
        } catch (error) {
            console.log(chalk.red(`\n✗ Error: ${error}`));
            process.exit(1);
        }
    });

// Open command: Launch browser with saved session
program
    .command('open')
    .description('Open a browser with the saved profile (resume session)')
    .requiredOption('--account-id <id>', 'Account identifier')
    .action(async (options) => {
        await setup();

        const accountId = options.accountId;
        const account = await getAccount(accountId);

        if (!account) {
            console.log(chalk.red(`Account ${accountId} not found.`));
            process.exit(1);
        }

        console.log(chalk.blue(`Opening ${account.platform} session for ${accountId}...`));

        try {
            if (account.platform === 'flipkart') {
                await loginFlipkart({ accountId, identifier: account.identifier, headless: false });
            } else {
                await loginShopsy({ accountId, identifier: account.identifier, headless: false });
            }
        } catch (error) {
            console.log(chalk.red(`Error: ${error}`));
            process.exit(1);
        }
    });

// Check command: Health check for accounts
program
    .command('check')
    .description('Check session health for accounts')
    .option('--account-id <id>', 'Single account to check')
    .option('--batch <list>', 'Comma-separated account IDs or "all"')
    .option('--limit <n>', 'Limit number of accounts to check', parseInt)
    .action(async (options) => {
        await setup();

        let accountIds: string[] = [];

        if (options.accountId) {
            accountIds = [options.accountId];
        } else if (options.batch) {
            if (options.batch === 'all') {
                const data = await loadAccounts();
                accountIds = data.accounts.map(a => a.id);
            } else {
                accountIds = options.batch.split(',').map((s: string) => s.trim());
            }
        } else {
            console.log(chalk.yellow('Specify --account-id or --batch'));
            process.exit(1);
        }

        if (options.limit) {
            accountIds = accountIds.slice(0, options.limit);
        }

        console.log(chalk.blue(`Checking ${accountIds.length} account(s)...\n`));

        const results = [];
        for (const id of accountIds) {
            const account = await getAccount(id);
            if (!account) {
                console.log(chalk.red(`  ✗ ${id}: Account not found`));
                continue;
            }

            try {
                const health = await checkAccountHealth(account.platform, id);
                const icon = health.status === 'HEALTHY' ? chalk.green('✓') : chalk.yellow('!');
                console.log(`  ${icon} ${id}: ${health.status} - ${health.message}`);
                results.push({ id, ...health });
            } catch (error) {
                console.log(chalk.red(`  ✗ ${id}: Error - ${error}`));
                results.push({ id, status: 'ERROR', message: String(error) });
            }
        }

        console.log(chalk.gray(`\nTotal: ${results.length} checked`));
        const healthy = results.filter(r => r.status === 'HEALTHY').length;
        const needsRefresh = results.filter(r => r.status === 'NEEDS_REFRESH').length;
        console.log(chalk.gray(`  Healthy: ${healthy}, Needs Refresh: ${needsRefresh}, Error: ${results.length - healthy - needsRefresh}`));
    });

// Refresh command: Attempt to refresh sessions
program
    .command('refresh')
    .description('Refresh sessions (re-login if needed)')
    .option('--account-id <id>', 'Single account to refresh')
    .option('--batch <list>', 'Comma-separated account IDs or "all"')
    .option('--limit <n>', 'Limit number of accounts', parseInt)
    .action(async (options) => {
        await setup();

        let accountIds: string[] = [];

        if (options.accountId) {
            accountIds = [options.accountId];
        } else if (options.batch) {
            if (options.batch === 'all') {
                const data = await loadAccounts();
                accountIds = data.accounts.map(a => a.id);
            } else {
                accountIds = options.batch.split(',').map((s: string) => s.trim());
            }
        } else {
            console.log(chalk.yellow('Specify --account-id or --batch'));
            process.exit(1);
        }

        if (options.limit) {
            accountIds = accountIds.slice(0, options.limit);
        }

        console.log(chalk.blue(`Refreshing ${accountIds.length} account(s)...\n`));

        for (const id of accountIds) {
            const account = await getAccount(id);
            if (!account) {
                console.log(chalk.red(`  ✗ ${id}: Account not found`));
                continue;
            }

            console.log(chalk.blue(`  Refreshing ${id}... (browser will open if OTP needed)`));

            try {
                const result = await refreshSession(account.platform, id, account.identifier);
                // refreshSession in flow.ts returns void/promise and logs/throws? 
                // Wait, flow.ts implementation was: returns loginFlipkart result.
                // loginFlipkart returns { status: 'success', message: ... }

                if (result && result.status === 'success') {
                    console.log(chalk.green(`  ✓ ${id}: ${result.message}`));
                } else {
                    console.log(chalk.yellow(`  ! ${id}: ${result?.message || 'Check logs'}`));
                }
            } catch (error) {
                console.log(chalk.red(`  ✗ ${id}: Error - ${error}`));
            }
        }
    });

// Assign command: Assign operator to account
program
    .command('assign')
    .description('Assign an operator to an account')
    .requiredOption('--account-id <id>', 'Account identifier')
    .requiredOption('--operator <name>', 'Operator name')
    .action(async (options) => {
        await setup();

        const accountId = options.accountId;
        const operator = options.operator;

        const account = await getAccount(accountId);
        if (!account) {
            console.log(chalk.red(`Account ${accountId} not found.`));
            process.exit(1);
        }

        // Update account
        await upsertAccount({
            id: accountId,
            platform: account.platform,
            assignedTo: operator,
        });

        // Also update operators.json
        let operators: Record<string, string[]> = {};
        if (await fs.pathExists(OPERATORS_FILE)) {
            operators = await fs.readJSON(OPERATORS_FILE);
        }

        if (!operators[operator]) {
            operators[operator] = [];
        }
        if (!operators[operator].includes(accountId)) {
            operators[operator].push(accountId);
        }

        await fs.writeJSON(OPERATORS_FILE, operators, { spaces: 2 });

        console.log(chalk.green(`✓ Assigned ${accountId} to operator: ${operator}`));
    });

// Export command: Export encrypted profile
program
    .command('export')
    .description('Export account profile (encrypted backup)')
    .requiredOption('--account-id <id>', 'Account identifier')
    .action(async (options) => {
        await setup();

        const accountId = options.accountId;
        const account = await getAccount(accountId);

        if (!account) {
            console.log(chalk.red(`Account ${accountId} not found.`));
            process.exit(1);
        }

        const { passphrase } = await inquirer.prompt([
            {
                type: 'password',
                name: 'passphrase',
                message: 'Enter encryption passphrase:',
                mask: '*',
            },
        ]);
        setGlobalPassphrase(passphrase);

        console.log(chalk.blue(`Exporting profile for ${accountId}...`));

        try {
            const encPath = await saveProfileToDisk(account.platform, accountId);
            console.log(chalk.green(`✓ Profile exported to: ${encPath}`));
        } catch (error) {
            console.log(chalk.red(`✗ Export failed: ${error}`));
            process.exit(1);
        }
    });

// Import command: Import encrypted profile
program
    .command('import')
    .description('Import account profile from encrypted backup')
    .requiredOption('--account-id <id>', 'Account identifier')
    .requiredOption('--platform <platform>', 'Platform: flipkart or shopsy')
    .action(async (options) => {
        await setup();

        const accountId = options.accountId;
        const platform = options.platform as Platform;

        const { passphrase } = await inquirer.prompt([
            {
                type: 'password',
                name: 'passphrase',
                message: 'Enter decryption passphrase:',
                mask: '*',
            },
        ]);
        setGlobalPassphrase(passphrase);

        console.log(chalk.blue(`Importing profile for ${accountId}...`));

        try {
            const profilePath = await restoreProfileFromDisk(platform, accountId);
            console.log(chalk.green(`✓ Profile imported to: ${profilePath}`));
        } catch (error) {
            console.log(chalk.red(`✗ Import failed: ${error}`));
            process.exit(1);
        }
    });

// Report command: Generate status report
program
    .command('report')
    .description('Generate account status report')
    .option('--summary', 'Show summary only')
    .option('--format <type>', 'Output format: json or csv', 'json')
    .action(async (options) => {
        await setup();

        const data = await loadAccounts();
        const accounts = data.accounts;

        if (options.summary) {
            const summary = {
                total: accounts.length,
                byStatus: {} as Record<string, number>,
                byPlatform: {} as Record<string, number>,
            };

            for (const acc of accounts) {
                summary.byStatus[acc.status] = (summary.byStatus[acc.status] || 0) + 1;
                summary.byPlatform[acc.platform] = (summary.byPlatform[acc.platform] || 0) + 1;
            }

            console.log(chalk.blue('\nAccount Summary\n'));
            console.log(`Total Accounts: ${summary.total}`);
            console.log('\nBy Status:');
            for (const [status, count] of Object.entries(summary.byStatus)) {
                console.log(`  ${status}: ${count}`);
            }
            console.log('\nBy Platform:');
            for (const [platform, count] of Object.entries(summary.byPlatform)) {
                console.log(`  ${platform}: ${count}`);
            }
        } else {
            if (options.format === 'csv') {
                console.log('id,platform,loginType,identifier,status,assignedTo,lastLoginAt,errorCode');
                for (const acc of accounts) {
                    console.log(`${acc.id},${acc.platform},${acc.loginType},${acc.identifier},${acc.status},${acc.assignedTo || ''},${acc.lastLoginAt || ''},${acc.errorCode || ''}`);
                }
            } else {
                console.log(JSON.stringify(data, null, 2));
            }
        }
    });

// List command: List all accounts
program
    .command('list')
    .description('List all accounts')
    .option('--platform <platform>', 'Filter by platform')
    .action(async (options) => {
        await setup();

        const data = await loadAccounts();
        let accounts = data.accounts;

        if (options.platform) {
            accounts = accounts.filter(a => a.platform === options.platform);
        }

        if (accounts.length === 0) {
            console.log(chalk.yellow('No accounts found.'));
            return;
        }

        console.log(chalk.blue(`\nAccounts (${accounts.length}):\n`));
        for (const acc of accounts) {
            const statusColor = acc.status === 'Healthy' ? chalk.green :
                acc.status === 'OTPRequired' ? chalk.yellow :
                    acc.status === 'Error' ? chalk.red : chalk.gray;
            console.log(`  ${acc.id} [${acc.platform}] - ${statusColor(acc.status)} ${acc.assignedTo ? `(${acc.assignedTo})` : ''}`);
        }
    });

program.parse();
