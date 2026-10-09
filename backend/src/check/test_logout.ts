import { logoutFromAllDevices } from '../login/logout.js';
import { getAccount } from '../accounts.js';

// Usage: tsx src/check/test_logout.ts <accountId>

const main = async () => {
    const accountId = process.argv[2];
    if (!accountId) {
        console.error('Please provide an account ID');
        process.exit(1);
    }

    console.log(`Checking account ${accountId}...`);
    const account = await getAccount(accountId);
    if (!account) {
        console.error('Account not found');
        process.exit(1);
    }

    console.log(`Attempting to log out ${accountId} from all devices...`);
    try {
        const result = await logoutFromAllDevices(accountId);
        console.log('Result:', result);
    } catch (e) {
        console.error('Error:', e);
    }
};

main();
