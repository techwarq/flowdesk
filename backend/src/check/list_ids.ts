import { getAllAccountIds } from '../accounts.js';

const main = async () => {
    const ids = await getAllAccountIds();
    console.log('Account IDs:', ids);
};

main();
