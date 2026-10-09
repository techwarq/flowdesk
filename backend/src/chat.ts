
import OpenAI from 'openai';
import { getVectorStoreForUser, VectorDocument } from './vector_store.js';
import { loadAccounts } from './accounts.js';
import { orderCache } from './orderCache.js';

// Ensure API Key is present in .env
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

/**
 * Ingest all orders for a user into their vector store
 */
export async function ingestOrdersForUser(userId: string) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is missing in .env');
    }

    const vectorStore = getVectorStoreForUser(userId);
    const data = await loadAccounts(userId);
    // Enrich with cached orders (most recent data might not be in DB yet)
    const userAccounts = data.accounts.map(acc => {
        const cached = orderCache.get(acc.id, acc.platform);
        if (cached && cached.length > 0) {
            return { ...acc, orders: cached };
        }
        return acc;
    });

    const docs: VectorDocument[] = [];
    let processedCount = 0;
    const orderItems: any[] = [];
    const accountItems: any[] = [];

    for (const acc of userAccounts) {
        if (acc.orders && acc.orders.length > 0) {
            for (const order of acc.orders) {
                // Construct a rich text representation for embedding
                const text = `
IDENTIFIER: ${acc.id} ${acc.details?.email || ''} ${acc.details?.mobile || ''}
Order: ${order.productName}
Price: ${order.price || 'N/A'}
Status: ${order.status}
Delivery Details: ${order.deliveryDetails || 'N/A'}
Delivery Date: ${order.deliveryDate || 'N/A'}
Receiver: ${order.receiverName || 'N/A'}
OTP: ${order.otp || 'N/A'}
Order ID: ${order.orderId}
Tracking ID: ${order.trackingId || 'N/A'}
Account: ${acc.id}
Platform: ${acc.platform}
Order Date: ${order.orderDate || 'N/A'}
Address: ${order.address || 'N/A'}
Mobile Last 4: ${order.mobileLast4 || 'N/A'}
Realtime Status: ${order.realtimeStatus || 'N/A'}
URL: ${order.orderUrl || ''}
`.trim();

                const item = { order, text, acc };
                orderItems.push(item);
            }
        }

        const accountText = `
Account ID: ${acc.id}
Platform: ${acc.platform}
Status: ${acc.status || 'Unknown'}
Name: ${acc.details?.name || 'N/A'}
GV Balance: ${acc.details?.gvBalance || 'N/A'}
Orders Count: ${acc.orders?.length || 0}
`.trim();
        accountItems.push({ acc, text: accountText });
    }

    // Parallel Processing with Concurrency Limit
    const CONCURRENCY = 10;
    
    // Process Orders
    for (let i = 0; i < orderItems.length; i += CONCURRENCY) {
        const batch = orderItems.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async ({ order, text, acc }) => {
            try {
                const embResponse = await openai.embeddings.create({
                    input: text,
                    model: 'text-embedding-3-small'
                });

                docs.push({
                    id: order.orderId,
                    text,
                    metadata: {
                        ...order,
                        accountId: acc.id,
                        platform: acc.platform
                    },
                    embedding: embResponse.data[0].embedding
                });
                processedCount++;
            } catch (e) {
                console.error(`[Chat] Failed to embed order ${order.orderId}:`, e);
            }
        }));
    }

    // Process Accounts
    for (let i = 0; i < accountItems.length; i += CONCURRENCY) {
        const batch = accountItems.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async ({ acc, text }) => {
            try {
                const embResponse = await openai.embeddings.create({
                    input: text,
                    model: 'text-embedding-3-small'
                });

                docs.push({
                    id: `account_${acc.id}`,
                    text,
                    metadata: {
                        type: 'account',
                        accountId: acc.id,
                        platform: acc.platform,
                        status: acc.status,
                        details: acc.details
                    },
                    embedding: embResponse.data[0].embedding
                });
            } catch (e) {
                console.error(`[Chat] Failed to embed account ${acc.id}:`, e);
            }
        }));
    }

    if (docs.length > 0) {
        await vectorStore.addDocuments(docs);
    }

    // Merge from per-account fallback vector stores (populated when userId was not set during order fetch)
    for (const acc of userAccounts) {
        if (acc.id !== userId) {
            try {
                const accStore = getVectorStoreForUser(acc.id);
                await accStore.load();
                const count = await accStore.getDocumentCount();
                if (count > 0) {
                    const accDocs = accStore.getAllDocuments();
                    await vectorStore.addDocuments(accDocs);
                    console.log(`[Chat] Merged ${accDocs.length} docs from account store ${acc.id} into user store ${userId}`);
                }
            } catch (e) {
                // Ignore missing account stores
            }
        }
    }

    console.log(`[Chat] Ingested ${processedCount} orders and ${userAccounts.length} accounts for user ${userId}`);
    return { count: processedCount, orderIds: docs.map(d => d.id) };
}

/**
 * Update chat context with newly fetched orders (called at runtime)
 */
export async function updateOrdersInContext(userId: string, accountId: string, platform: string, orders: any[]) {
    if (!process.env.OPENAI_API_KEY || orders.length === 0) {
        return { updated: 0 };
    }

    const vectorStore = getVectorStoreForUser(userId);
    const docs: VectorDocument[] = [];

    for (const order of orders) {
        // Skip if already indexed (optimization)
        if (vectorStore.hasDocument(order.orderId)) {
            continue;
        }

        const text = `
IDENTIFIER: ${accountId}
Order: ${order.productName}
Price: ${order.price || 'N/A'}
Status: ${order.status}
Delivery Details: ${order.deliveryDetails || 'N/A'}
Delivery Date: ${order.deliveryDate || 'N/A'}
Receiver: ${order.receiverName || 'N/A'}
OTP: ${order.otp || 'N/A'}
Order ID: ${order.orderId}
Tracking ID: ${order.trackingId || 'N/A'}
Account: ${accountId}
Platform: ${platform}
Order Date: ${order.orderDate || 'N/A'}
Address: ${order.address || 'N/A'}
Mobile Last 4: ${order.mobileLast4 || 'N/A'}
Realtime Status: ${order.realtimeStatus || 'N/A'}
URL: ${order.orderUrl || ''}
`.trim();

        try {
            const embResponse = await openai.embeddings.create({
                input: text,
                model: 'text-embedding-3-small'
            });

            docs.push({
                id: order.orderId,
                text,
                metadata: {
                    ...order,
                    accountId,
                    platform
                },
                embedding: embResponse.data[0].embedding
            });
        } catch (e) {
            console.error(`[Chat] Failed to embed order ${order.orderId}:`, e);
        }
    }

    if (docs.length > 0) {
        await vectorStore.addDocuments(docs);
        console.log(`[Chat] Runtime update: Added ${docs.length} new orders to context for user ${userId}`);
    }

    return { updated: docs.length };
}

/**
 * Update chat context when a new account is added
 */
export async function updateAccountInContext(userId: string, account: any) {
    if (!process.env.OPENAI_API_KEY) {
        return { updated: false };
    }

    const vectorStore = getVectorStoreForUser(userId);

    const accountText = `
Account ID: ${account.id}
Platform: ${account.platform}
Status: ${account.status || 'Unknown'}
Name: ${account.details?.name || 'N/A'}
GV Balance: ${account.details?.gvBalance || 'N/A'}
Orders Count: ${account.orders?.length || 0}
`.trim();

    try {
        const embResponse = await openai.embeddings.create({
            input: accountText,
            model: 'text-embedding-3-small'
        });

        await vectorStore.addDocuments([{
            id: `account_${account.id}`,
            text: accountText,
            metadata: {
                type: 'account',
                accountId: account.id,
                platform: account.platform,
                status: account.status,
                details: account.details
            },
            embedding: embResponse.data[0].embedding
        }]);

        console.log(`[Chat] Runtime update: Added account ${account.id} to context for user ${userId}`);
        return { updated: true };
    } catch (e) {
        console.error(`[Chat] Failed to embed account ${account.id}:`, e);
        return { updated: false };
    }
}

/**
 * Chat with context (main chat function)
 */
export async function chatWithContext(userId: string, query: string) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is missing in .env');
    }

    const vectorStore = getVectorStoreForUser(userId);

    // 1. Embed query
    const embResponse = await openai.embeddings.create({
        input: query,
        model: 'text-embedding-3-small'
    });

    // 2. Search Vector Store (Retrieve more context for better LLM filtering)
    const results = await vectorStore.search(embResponse.data[0].embedding, 40);

    let context = "No specific order or account details found relative to this query.";
    if (results.length > 0) {
        context = results.map(r => `[ID: ${r.id}] ${r.text}`).join('\n\n');
    }

    // 3. Chat Completion with Tools
    const systemPrompt = `You are a helpful assistant for the user's shopping orders assistant 'FlowDesk'.
You have access to the user's order history and account information via the context below.

**SUPPORTED PLATFORMS:**
FlowDesk supports order tracking for: **Flipkart, Shopsy, iQOO, Vivo, Oppo, Realme, Xiaomi, Redmi, OnePlus, Samsung, Amazon, Vijay Sales, and Reliance Digital**. 
If a user asks about any of these platforms, use the context to find relevant accounts and orders.

**CRITICAL INSTRUCTION FOR LISTS:**
If the user asks to **list**, **show**, **find**, or **display** multiple orders (e.g. "show orders in transit", "list my orders"), you **MUST** use the 'show_orders' tool.
Do NOT write a text list of orders. The UI card is the required format.
Only write text if you are explaining a single order or if no tooling capability matches.

**FORMATTING RULES (for non-list responses):**
- Use **Markdown** for all lists.
- Use bullet points (-) for listing items, orders, or accounts.
- **NEVER** write a long paragraph for a list of items.
- Bold (**text**) key details like Order IDs, Account IDs, and Status.

Answer the user's question accurately based ONLY on the provided context.
If you find relevant accounts but the "Orders Count" is 0 or no specific orders are listed in context, tell the user that you found their accounts (mentioning the platform) but they haven't fetched any orders yet. Suggest they use the "Fetch Orders" feature on the Orders page.
Only call 'show_orders' if you actually see specific order details (like product name, price, orderId) in the context.
If no relevant orders or accounts are found for the specific request, say so.
Be concise and friendly.

CONTEXT:
${context}`;

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
        {
            type: 'function',
            function: {
                name: 'show_orders',
                description: 'Display a structured UI list of orders. Use this whenever the user asks to list/show multiple orders.',
                parameters: {
                    type: 'object',
                    properties: {
                        orderIds: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'List of Order IDs to show.'
                        }
                    },
                    required: ['orderIds']
                }
            }
        }
    ];

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query }
        ],
        tools: tools,
        tool_choice: 'auto'
    });

    const choice = completion.choices[0];
    const toolCall = choice.message.tool_calls?.[0];

    if (toolCall && toolCall.type === 'function' && toolCall.function.name === 'show_orders') {
        const args = JSON.parse(toolCall.function.arguments);
        const orderIds = args.orderIds as string[];

        console.log(`[Chat] AI requested show_orders for IDs:`, orderIds);
        console.log(`[Chat] Available result IDs in context:`, results.map(r => r.id));

        // Retrieve full order objects from metadata
        let richOrders = results
            .filter(r => orderIds.some(id => {
                const searchId = String(id).toLowerCase();
                const targetId = String(r.id).toLowerCase();
                return targetId.includes(searchId) || searchId.includes(targetId);
            }))
            .map(r => r.metadata);

        // Fallback: If AI requested specific orders but our filtering failed, 
        // and if those orders look like they came from our results, pull them anyway.
        if (richOrders.length === 0 && results.length > 0) {
            console.log(`[Chat] Filtered richOrders is empty, applying fallback logic...`);
            // If the query was specifically about orders, return non-account results as a last resort
            richOrders = results
                .filter(r => r.metadata.type !== 'account')
                .slice(0, 10)
                .map(r => r.metadata);
        }

        console.log(`[Chat] Returning ${richOrders.length} rich orders to UI`);

        return {
            answer: richOrders.length > 0 
                ? "Here are the orders you asked about:" 
                : "I found your accounts but couldn't retrieve the specific order details for the display. Please ensure your orders are fully fetched.",
            data: {
                type: 'orders',
                items: richOrders
            }
        };
    }

    // Standard text response
    return {
        answer: choice.message.content || "I couldn't find that.",
        data: null
    };
}
