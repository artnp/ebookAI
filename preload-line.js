
const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
    console.log('LINE VOOM Automation Active');

    let status = null;

    function setStatus(msg) {
        if (status) {
            status.innerHTML = `⚡ LINE Automation: ${msg}`;
        }
        console.log('[Bot]', msg);
    }

    async function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function findElement(selector, textContent = null, timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
                if (!textContent || el.textContent.includes(textContent)) {
                    if (el.offsetParent !== null) return el; // Must be visible
                }
            }
            await wait(200); // Faster polling (was 500)
        }
        return null;
    }

    async function run() {
        try {
            const automationData = await ipcRenderer.invoke('get-automation-data');
            if (!automationData || !automationData.active) {
                console.log('No active LINE VOOM automation requested. Skipping.');
                return;
            }

            status = document.createElement('div');
            status.style.cssText = 'position:fixed; top:10px; left:10px; background:rgba(0,199,85,0.9); color:white; padding:10px; z-index:999999; font-size:12px; border-radius:5px; font-family: sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,0.2); transition: opacity 0.3s;';
            status.innerHTML = '⚡ LINE Automation: Starting...';
            document.body.appendChild(status);
            const automationText = automationData ? automationData.text : '';
            console.log('Automation Data retrieved:', automationData);

            // 1. Wait for "เขียนโพสต์"
            setStatus('Searching for "เขียนโพสต์" button...');
            let writeBtn = await findElement('button', 'เขียนโพสต์');
            if (!writeBtn) writeBtn = await findElement('button span', 'เขียนโพสต์');
            if (!writeBtn) writeBtn = await findElement('button', 'Create Post');

            if (!writeBtn) {
                setStatus('❌ Could not find "เขียนโพสต์" button.');
                return;
            }

            setStatus('Clicking "เขียนโพสต์"...');
            writeBtn.scrollIntoView({ block: 'center' });
            await wait(500);
            writeBtn.click();

            // 2. Wait for the Writer Modal
            setStatus('Waiting for post writer modal...');
            await wait(1000);

            let modalContainer = null;
            for (let i = 0; i < 30; i++) {
                modalContainer = document.querySelector('#modalPortal .vw_post_writer') ||
                    document.querySelector('div[role="dialog"] .vw_post_writer') ||
                    document.querySelector('.vw_post_writer') ||
                    document.querySelector('[class*="post_writer"]');
                if (modalContainer) break;
                await wait(300);
            }

            if (!modalContainer) {
                setStatus('❌ Post Writer Modal not found');
                return;
            }

            // 2.5 Paste Text if available
            if (automationText) {
                setStatus('Updating post text...');

                let editor = null;
                for (let i = 0; i < 20; i++) {
                    editor = modalContainer.querySelector('div[contenteditable="true"], textarea');
                    if (editor) break;
                    await wait(300);
                }

                if (editor) {
                    editor.focus();
                    await wait(200);

                    try {
                        document.execCommand('selectAll', false, null);
                        document.execCommand('delete', false, null);
                        document.execCommand('insertText', false, automationText);
                    } catch (e) {
                        editor.innerText = automationText;
                    }
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                    setStatus('✅ Text updated');
                    await wait(500);
                }
            }

            // 3. Find Upload Button
            setStatus('Scanning for image/video upload button...');
            let uploadTarget = null;

            for (let i = 0; i < 30; i++) {
                // Try multiple common titles/labels
                uploadTarget = modalContainer.querySelector('label[title*="โพสต์"], label[title*="Post"], button[aria-label*="รูป"], button[aria-label*="Photo"], button[aria-label*="Video"]');

                if (!uploadTarget) {
                    const fileInput = modalContainer.querySelector('input[type="file"]');
                    if (fileInput) uploadTarget = fileInput;
                }

                if (uploadTarget) break;
                await wait(300);
            }

            if (uploadTarget) {
                setStatus('🚀 Triggering file selection...');
                ipcRenderer.send('trigger-line-upload-manual');
                await wait(1000);
            } else {
                setStatus('❌ Upload button not found');
                return;
            }

            // 4. Wait for upload completion (optimized polling)
            setStatus('Waiting for upload to complete...');

            let submitBtn = null;
            let retries = 0;
            const maxRetries = 400;

            while (retries < maxRetries) {
                const allButtons = Array.from(modalContainer.querySelectorAll('button'));
                submitBtn = allButtons.find(b => {
                    const txt = b.innerText.trim().toLowerCase();
                    return (txt.includes('โพสต์') || txt.includes('post') || txt.includes('publish')) &&
                        b.offsetParent !== null;
                });

                if (submitBtn) {
                    const isButtonDisabled = submitBtn.disabled ||
                        submitBtn.classList.contains('disabled') ||
                        submitBtn.getAttribute('aria-disabled') === 'true' ||
                        submitBtn.getAttribute('disabled') !== null;

                    // Check for active uploads or processing
                    const loading = modalContainer.querySelector('[class*="loading"], [class*="progress"], [role="progressbar"]');
                    const isUploading = modalContainer.innerText.includes('กำลังอัปโหลด') ||
                        modalContainer.innerText.includes('Uploading') ||
                        modalContainer.innerText.includes('กำลังประมวลผล');

                    if (!isButtonDisabled && !loading && !isUploading) {
                        setStatus('🚀 Post button is READY!');
                        break;
                    }

                    if (loading || isUploading) {
                        setStatus(`Waiting for upload/processing... ${Math.round(retries / 10)}s`);
                    } else if (isButtonDisabled) {
                        setStatus(`Waiting for button to enable... ${Math.round(retries / 10)}s`);
                    }
                }

                await wait(150);
                retries++;
            }

            if (!submitBtn) {
                setStatus('❌ Submit button not found');
                return;
            }

            // BLAST OFF!
            setStatus('🚀 CLICKING POST!');

            // Try standard click first
            submitBtn.focus();
            await wait(200);
            submitBtn.click();

            // If still visible after a short wait, try a more aggressive click simulation
            await wait(1000);
            if (submitBtn && submitBtn.offsetParent !== null) {
                setStatus('⚠️ Standard click failed, trying simulation...');
                const rect = submitBtn.getBoundingClientRect();
                const x = Math.round(rect.left + rect.width / 2);
                const y = Math.round(rect.top + rect.height / 2);
                ipcRenderer.send('simulate-click', { x, y });
            }

            setStatus('✨ Done! Closing in 1s...');
            await wait(1000);
            ipcRenderer.send('close-line-window');

        } catch (err) {
            setStatus(`❌ Error: ${err.message}`);
        }
    }

    run();
});
