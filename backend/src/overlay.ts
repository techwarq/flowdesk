import { Page } from 'playwright';

/**
 * Injects a floating navigation overlay into the page.
 * Allows quick switching between Flipkart and Shopsy.
 */
export async function injectOverlay(page: Page, currentPlatform: string) {
    await page.addInitScript(({ platform }) => {
        // Create container
        const container = document.createElement('div');
        container.id = 'fsa-overlay';
        Object.assign(container.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: '2147483647', // Max z-index
            display: 'flex',
            gap: '10px',
            fontFamily: 'system-ui, sans-serif',
            pointerEvents: 'none', // Allow clicking through the container area
        });

        // Helper to create button
        const createBtn = (text: string, url: string, color: string) => {
            const btn = document.createElement('a');
            btn.href = url;
            btn.target = '_blank'; // Open in new tab to preserve current session context
            btn.textContent = text;
            Object.assign(btn.style, {
                display: 'inline-block',
                padding: '8px 16px',
                backgroundColor: color,
                color: 'white',
                textDecoration: 'none',
                borderRadius: '20px',
                fontSize: '14px',
                fontWeight: 'bold',
                boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                cursor: 'pointer',
                pointerEvents: 'auto', // Re-enable clicks for buttons
                transition: 'transform 0.2s',
            });

            btn.onmouseover = () => { btn.style.transform = 'scale(1.05)'; };
            btn.onmouseout = () => { btn.style.transform = 'scale(1)'; };

            return btn;
        };

        // Add buttons based on context
        if (platform === 'shopsy') {
            const btn = createBtn('Open Flipkart', 'https://www.flipkart.com', '#2874f0'); // Flipkart Blue
            container.appendChild(btn);
        } else {
            const btn = createBtn('Open Shopsy', 'https://www.shopsy.in', '#d32f2f'); // Shopsy Red-ish
            container.appendChild(btn);
        }

        // Change IP Button
        const ipBtn = createBtn('Change IP', '#', '#4caf50'); // Green
        ipBtn.onclick = async (e) => {
            e.preventDefault();
            ipBtn.textContent = 'Rotating...';
            ipBtn.style.backgroundColor = '#9e9e9e';

            // Identify Account ID (Extract from URL or Local Storage if possible, or assume context)
            // Best to rely on backend session context, but we are inside browser.
            // We can check URL or just ask user to close/reopen? 
            // Actually, we can trigger the backend command via fetch. The backend knows which account belongs to this session 
            // IF we pass some identifier. 
            // However, strictly speaking, this overlay is plain JS.

            // Simplification: We assume the backend is running on localhost:3001 (default). 
            // Ideally we inject the port via addInitScript args.

            try {
                // Try to guess Account ID from URL (e.g. profile path) OR inject it. 
                // We need to pass accountId to injectOverlay!
                // For now, let's use a prompt or assume we can find it.
                // BETTER: The overlay injection should have received the accountId.

                // Since we didn't inject accountID in prev step, let's just alert for now 
                // and say "Go to dashboard to rotate". 
                // OR fix injectOverlay to accept accountId.

                alert('To rotate IP, please use the "Rotate IP" button in the main FlowDesk dashboard.');
                ipBtn.textContent = 'Change IP';
                ipBtn.style.backgroundColor = '#4caf50';
            } catch (err) {
                alert('Error rotating IP');
            }
        };
        // container.appendChild(ipBtn); // Disabled until we wire up AccountID passing


        // Add to DOM when body is ready
        const init = () => {
            if (document.body) {
                document.body.appendChild(container); // Append
            } else {
                setTimeout(init, 100);
            }
        };
        init();

    }, { platform: currentPlatform });
}
