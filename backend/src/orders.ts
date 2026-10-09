/**
 * Orders Module Dispatcher
 * This file now serves as a central export point for order fetching logic.
 * The implementation for each platform has been moved to the ./orders/ directory.
 */

export { fetchOrders, fetchGiftCardBalance } from './orders/index.js';
