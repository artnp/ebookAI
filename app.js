// PDF.js will be loaded from CDN
let pdfjsLib = null;

// State
let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let scale = 1.0;
let currentFilePath = '';
let currentFileName = '';
let isAutoSummarize = true;
let extractedPageText = '';
let lastPromptedText = '';
let debounceTimer = null;
let isProcessingPage = false;
let isGeminiResponding = false;
let batchSize = 1; // Offline mode and new documents summarize one page at a time by default
let isOfflineMode = false;
let offlineDocuments = {}; // Documents explicitly chosen for Offline mode
let pageTextMap = {}; // Map to store text content of each page for searching
// pageLayoutBlocks declared below with analyzePageLayout
let highlightContextRecursion = 0;
let suppressAutoSummarize = false;
let isScannedPdf = false;
let tesseractReady = false;

// Account Switching / Quota Management State
let detectedAccounts = [0];
let currentAccountIndex = 0;
let isAutoRotateAccounts = true;
window.isSwitchingPage = false;
window.pendingResetPrompt = false;


// DOM Elements
// GitHub Config
let GITHUB_TOKEN = '';
let GITHUB_USER = 'artnp';
let GITHUB_REPO = 'bigdata';
let GITHUB_FILE_BASE = 'bigdata'; // จะ auto ต่อเลข เช่น bigdata1.json, bigdata2.json
let GITHUB_FILE = 'bigdata1.json'; // ระบบ auto-rotate ไฟล์ ห้ามแก้เอง // default
let GITHUB_BRANCH = 'main';
const GITHUB_MAX_ITEMS = 3000; // สร้างไฟล์ใหม่เมื่อเกิน 3000 รายการ

// Screenshot Folder Auto-Rotation Config
let GITHUB_SCREENSHOT_FOLDER_BASE = 'pdf_screenshot';
let GITHUB_SCREENSHOT_MAX_ITEMS = 3000;
let currentScreenshotFolder = 'pdf_screenshot';

// --- SAVE QUEUE SYSTEM ---
const saveQueue = [];
let isProcessingSaveQueue = false;

function enqueueSaveTask(taskFn) {
    saveQueue.push(taskFn);
    processSaveQueue();
}

async function processSaveQueue() {
    if (isProcessingSaveQueue) return;
    isProcessingSaveQueue = true;
    while (saveQueue.length > 0) {
        const currentTask = saveQueue.shift();
        try {
            await currentTask();
        } catch (err) {
            console.error('[SaveQueue] Task execution error:', err);
        }
    }
    isProcessingSaveQueue = false;
}

async function findLatestScreenshotFolder() {
    let num = 1;
    let targetFolder = 'pdf_screenshot';
    while (true) {
        const folderName = num === 1 ? 'pdf_screenshot' : `pdf_screenshot${num}`;
        const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${folderName}`;
        let res;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                res = await fetch(url, {
                    headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
                });
                if (res.status === 502 || res.status === 503) {
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                    continue;
                }
                break;
            } catch (e) {
                if (attempt < 3) { await new Promise(r => setTimeout(r, 1000 * attempt)); continue; }
                console.error('findLatestScreenshotFolder error:', e);
                currentScreenshotFolder = targetFolder;
                return targetFolder;
            }
        }
        if (res.status === 404) {
            targetFolder = folderName;
            break;
        }
        if (!res.ok) {
            targetFolder = folderName;
            break;
        }
            const contents = await res.json();
            if (Array.isArray(contents)) {
                if (contents.length < GITHUB_SCREENSHOT_MAX_ITEMS) {
                    targetFolder = folderName;
                    break;
                }
            } else {
                targetFolder = folderName;
                break;
            }
        num++;
    }
    currentScreenshotFolder = targetFolder;
    return targetFolder;
}


const libraryBtn = document.getElementById('libraryBtn');
const libraryOverlay = document.getElementById('libraryOverlay');
const closeLibraryBtn = document.getElementById('closeLibraryBtn');
const addBookBtn = document.getElementById('addBookBtn');
const bookshelf = document.getElementById('bookshelf');
const fileName = document.getElementById('fileName');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageInput = document.getElementById('pageInput');
const totalPagesSpan = document.getElementById('totalPages');
const pdfCanvas = document.getElementById('pdfCanvas');
const pdfContainer = document.getElementById('pdfContainer');
const welcomeScreen = document.getElementById('welcomeScreen');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const zoomLevel = document.getElementById('zoomLevel');
let geminiWebview = document.getElementById('geminiWebviewA');
let prefetchWebview = document.getElementById('geminiWebviewB');

// Pre-fetch State Variables
let pendingNextBatchText = '';
let pendingNextBatchStart = 0;
let pendingNextBatchEnd = 0;
let pendingNextAccountIndex = 0;
let isPrefetchResponding = false;
let isPrefetchReady = false;
let nextPromptIdPrefetch = '';
const bigdataPopup = document.getElementById('bigdataPopup');
const bigdataPopupIframe = document.getElementById('bigdataPopupIframe');
const closeBigdataPopup = document.getElementById('closeBigdataPopup');
const resetGeminiBtn = document.getElementById('resetGemini');
const refreshGeminiBtn = document.getElementById('refreshGemini');
const debugGeminiBtn = document.getElementById('debugGemini');
const toggleExpandGeminiBtn = document.getElementById('toggleExpandGemini');
const extractedTextDiv = document.getElementById('extractedText');
const copyTextBtn = document.getElementById('copyText');
const panelResizer = document.getElementById('panelResizer');
const geminiPanel = document.getElementById('geminiPanel');
const toast = document.getElementById('toast');
const historyList = document.getElementById('historyList');
const readingHistory = document.getElementById('readingHistory');
const manualNextPageBtn = document.getElementById('manualNextPage');
const bottomNextPageBtn = document.getElementById('bottomNextPageBtn');
const finishBookBtn = document.getElementById('finishBookBtn');
const batchSizeInput = document.getElementById('batchSizeInput');
const accountSelect = document.getElementById('accountSelect');
const detectAccountsBtn = document.getElementById('detectAccountsBtn');
const autoRotateAccountsCheckbox = document.getElementById('autoRotateAccounts');

// Initialize PDF.js
async function initPDFJS() {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = () => {
            pdfjsLib = window.pdfjsLib;
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            console.log('PDF.js loaded successfully');
            resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// Initialize
async function init() {
    try {
        console.log('Initializing app...');
        // Load Github Token from secure local file D:\Github\token.ps1
        try {
            GITHUB_TOKEN = await window.electronAPI.getGithubToken();
            console.log('GitHub Token loaded:', GITHUB_TOKEN ? 'Success' : 'Failed');
        } catch (tokenErr) {
            console.error('Failed to load GitHub Token:', tokenErr);
        }

        await initPDFJS();
        await loadAppSettings();
        setupEventListeners();
        setupDragAndDrop();
        setupHandDragScroll();
        setupPdfTabControls();
        const validBooks = await loadReadingHistory();

        zoomLevel.textContent = `${Math.round(scale * 100)}%`;

        const args = await window.electronAPI.getArgs();
        let fileLoaded = false;
        for (let i = 1; i < args.length; i++) {
            const arg = args[i];
            if (arg && typeof arg === 'string') {
                const lower = arg.toLowerCase();
                if (lower.endsWith('.pdf')) {
                    const fileExists = await window.electronAPI.checkFileExists(arg);
                    if (fileExists) {
                        const fileData = await window.electronAPI.openFileDirect(arg);
                        if (fileData) { await loadPDF(fileData); fileLoaded = true; }
                        break;
                    }
                } else if (lower.endsWith('.epub')) {
                    const fileExists = await window.electronAPI.checkFileExists(arg);
                    if (fileExists) {
                        const fileData = await window.electronAPI.openFileDirect(arg);
                        if (fileData) { await openEPUB(fileData); fileLoaded = true; }
                        break;
                    }
                }
            }
        }

        if (!fileLoaded && validBooks.length > 0) {
            const unfinished = validBooks.filter(([filePath, data]) => data.currentPage < data.totalPages);
            if (unfinished.length > 0) {
                const [randomPath] = unfinished[Math.floor(Math.random() * unfinished.length)];
                const fileData = await window.electronAPI.openFileDirect(randomPath);
                if (fileData) await loadPDF(fileData);
            }
        }

    } catch (error) {
        console.error('Init Error:', error);
    }
}

// Event Listeners
function setupEventListeners() {
    const offlineModeToggle = document.getElementById('offlineModeToggle');
    const offlineModeLabel = document.getElementById('offlineModeLabel');
    if (offlineModeToggle) {
        offlineModeToggle.addEventListener('change', () => {
            isOfflineMode = offlineModeToggle.checked;
            if (currentFileName) {
                const key = `document:${currentFileName.toLowerCase()}`;
                if (isOfflineMode) offlineDocuments[key] = true;
                else delete offlineDocuments[key];
            }
            if (offlineModeLabel) offlineModeLabel.textContent = isOfflineMode ? 'Offline' : 'Online';
            if (isOfflineMode && batchSizeInput) {
                batchSize = 1;
                batchSizeInput.value = 1;
                if (pdfDoc) updateNavigation();
            }
            saveAppSettings();
            setOfflineModeForWebviews();
            showToast(isOfflineMode ? 'Offline: จะบันทึก PDF ที่ Desktop' : 'Online: จะบันทึกลง GitHub', 'info');
            if (isOfflineMode && pdfDoc) {
                // Start the current page immediately; subsequent pages are triggered after each PDF save.
                window.offlineAutoSaveTriggered = false;
                lastPromptedText = '';
                isProcessingPage = false;
                isGeminiResponding = false;
                extractTextBatch(currentPage, currentPage);
            }
        });
    }
    if (libraryBtn) libraryBtn.addEventListener('click', toggleLibrary);
    if (closeLibraryBtn) closeLibraryBtn.addEventListener('click', hideLibrary);
    if (addBookBtn) addBookBtn.addEventListener('click', () => { hideLibrary(); openFile(); });
    if (openFileBtn2) openFileBtn2.addEventListener('click', openFile);

    prevPageBtn.addEventListener('click', () => {
        if (window.isSwitchingPage) return;
        window.isSwitchingPage = true;
        setTimeout(() => { window.isSwitchingPage = false; }, 800);
        goToPage(currentPage - batchSize);
    });
    nextPageBtn.addEventListener('click', () => {
        if (window.isSwitchingPage) return;
        if (currentPage + batchSize - 1 >= totalPages) {
            finishAndDelete();
        } else {
            window.isSwitchingPage = true;
            setTimeout(() => { window.isSwitchingPage = false; }, 800);
            goToPage(currentPage + batchSize);
        }
    });

    pageInput.addEventListener('change', (e) => goToPage(parseInt(e.target.value)));
    pageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') goToPage(parseInt(e.target.value));
    });

    // Batch Size control
    if (batchSizeInput) {
        batchSizeInput.addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            if (val >= 1 && val <= 50) {
                batchSize = val;
                showToast(`เปลี่ยนเป็นสรุปทีละ ${batchSize} หน้า`, 'info');
                if (pdfDoc) {
                    updateNavigation();
                    renderKeysPages();
                    extractTextBatch(currentPage, Math.min(currentPage + batchSize - 1, totalPages));
                    saveProgress();
                }
            }
        });
    }

    document.addEventListener('keydown', handleKeyboard);
    zoomInBtn.addEventListener('click', () => zoom(0.1));
    zoomOutBtn.addEventListener('click', () => zoom(-0.1));

    if (resetGeminiBtn) {
        resetGeminiBtn.addEventListener('click', () => {
            showToast('กำลังรีตาร์ทระบบ AI...', 'warning');
            window.pendingResetPrompt = true;
            lastPromptedText = '';
            isGeminiResponding = false;
            isProcessingPage = false;
            window.lastPromptId = '';

            // Clear prefetch cache/timers on reset
            pendingNextBatchText = '';
            pendingNextBatchStart = 0;
            pendingNextBatchEnd = 0;
            isPrefetchResponding = false;
            isPrefetchReady = false;
            if (nextPreFetchTimer) {
                clearTimeout(nextPreFetchTimer);
                nextPreFetchTimer = null;
            }

            geminiWebview.reload();
        });
    }

    if (refreshGeminiBtn) refreshGeminiBtn.addEventListener('click', () => geminiWebview.reload());
    if (debugGeminiBtn) {
        debugGeminiBtn.addEventListener('click', () => {
            geminiWebview.isDevToolsOpened() ? geminiWebview.closeDevTools() : geminiWebview.openDevTools();
        });
    }
    if (copyTextBtn) copyTextBtn.addEventListener('click', copyExtractedText);

    function triggerNextPageBatch() {
        if (window.isSwitchingPage) {
            return;
        }
        const nextStart = currentPage + batchSize;
        if (nextStart > totalPages) {
            showToast('ถึงหน้าสุดท้ายของ PDF แล้ว', 'info');
            return;
        }
        window.isSwitchingPage = true;
        setTimeout(() => { window.isSwitchingPage = false; }, 800);
        goToPage(nextStart);
    }

    if (manualNextPageBtn) manualNextPageBtn.addEventListener('click', triggerNextPageBatch);
    if (bottomNextPageBtn) {
        bottomNextPageBtn.addEventListener('click', () => {
            if (pdfDoc && currentPage + batchSize - 1 >= totalPages && totalPages > 0) {
                confirmDeletePDF();
            } else {
                triggerNextPageBatch();
            }
        });
    }

    // Hover 1.5s auto-trigger สำหรับปุ่มหน้าถัดไป (trigger ครั้งเดียว ล็อค ปลดล็อคเมื่อเมาส์ออก)
    function addHoverAutoClick(btn) {
        if (!btn) return;
        var autoTimer = null;
        var locked = false;
        btn.addEventListener('mouseenter', function () {
            if (btn.disabled || locked) return;
            autoTimer = setTimeout(function () {
                if (btn.disabled) return;
                locked = true;
                btn.click();
            }, 500);
        });
        btn.addEventListener('mouseleave', function () {
            if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
            locked = false;
        });
    }
    addHoverAutoClick(nextPageBtn);
    addHoverAutoClick(bottomNextPageBtn);
    addHoverAutoClick(manualNextPageBtn);

    if (finishBookBtn) finishBookBtn.addEventListener('click', confirmDeletePDF);

    // Account Selector & Auto-Rotate Events
    if (accountSelect) {
        accountSelect.addEventListener('change', async (e) => {
            currentAccountIndex = parseInt(e.target.value);
            localStorage.setItem('currentAccountIndex', currentAccountIndex);
            saveAppSettings();
            showToast(`สลับไปบัญชี ${currentAccountIndex + 1}...`, 'info');
            geminiWebview.src = `https://gemini.google.com/u/${currentAccountIndex}/app`;
        });
    }

    if (detectAccountsBtn) {
        detectAccountsBtn.addEventListener('click', () => {
            detectGoogleAccounts();
        });
    }

    if (autoRotateAccountsCheckbox) {
        autoRotateAccountsCheckbox.addEventListener('change', (e) => {
            isAutoRotateAccounts = e.target.checked;
            localStorage.setItem('isAutoRotateAccounts', isAutoRotateAccounts);
            saveAppSettings();
            showToast(isAutoRotateAccounts ? 'เปิดการสลับบัญชีออโต้' : 'ปิดการสลับบัญชีออโต้', 'info');
        });
    }

    if (toggleExpandGeminiBtn) {
        toggleExpandGeminiBtn.addEventListener('click', () => {
            document.body.classList.toggle('gemini-full');
            if (pdfDoc) setTimeout(fitToPage, 100);
        });
    }

    // Close Bigdata Popup
    if (closeBigdataPopup) {
        closeBigdataPopup.addEventListener('click', () => {
            bigdataPopup.style.display = 'none';
            bigdataPopupIframe.src = 'about:blank';
            if (currentPopupQuery) {
                closedQueries.add(currentPopupQuery);
            }
        });
    }

    setupPanelResizer();
    window.addEventListener('resize', () => { if (pdfDoc) fitToPage(); });

    // Share Modal Events
    const shareModal = document.getElementById('shareModal');
    const cancelShareBtn = document.getElementById('cancelShareBtn');
    const confirmShareBtn = document.getElementById('confirmShareBtn');

    if (cancelShareBtn) {
        cancelShareBtn.addEventListener('click', () => {
            shareModal.classList.remove('show');
            setTimeout(() => shareModal.style.visibility = 'hidden', 200);
        });
    }

    if (confirmShareBtn) {
        confirmShareBtn.addEventListener('click', () => {
            const text = document.getElementById('shareText').value;
            if (isOfflineMode) enqueueSaveTask(() => saveOfflineSummary(text));
            else uploadScreenshotAndSave(text);
            shareModal.classList.remove('show');
            setTimeout(() => shareModal.style.visibility = 'hidden', 200);
        });
    }

    function setupWebviewListeners(webview, isPrefetchGetter) {
        let injectTimer = null;
        webview.addEventListener('dom-ready', () => {
            const isPrefetch = isPrefetchGetter();
            webview.executeJavaScript(`window.__ebookOfflineMode = ${isOfflineMode ? 'true' : 'false'};`).catch(() => {});
            console.log(`Gemini webview dom-ready (isPrefetch: ${isPrefetch})`);
            if (!isPrefetch) {
                if (!window.lastPromptId) {
                    isGeminiResponding = false;
                }
            }
        });
        // Gemini commonly redirects /app to an account-specific URL.  dom-ready
        // may fire for the short-lived redirect document, where executeJavaScript
        // produces Electron's harmless but noisy ERR_ABORTED (-3).  Wait for the
        // final navigation to stop before injecting the reading/TTS helper.
        webview.addEventListener('did-stop-loading', () => {
            if (injectTimer) clearTimeout(injectTimer);
            injectTimer = setTimeout(() => {
                let url = '';
                try { url = webview.getURL(); } catch (e) { return; }
                if (url.startsWith('https://gemini.google.com/')) injectGeminiScript(webview);
            }, 400);
        });

        function base64ToBlob(b64, mime) {
            var byteChars = atob(b64);
            var ab = new ArrayBuffer(byteChars.length);
            var ia = new Uint8Array(ab);
            for (var i = 0; i < byteChars.length; i++) { ia[i] = byteChars.charCodeAt(i); }
            return new Blob([ab], { type: mime });
        }
        webview.addEventListener('console-message', (e) => {
            const msg = e.message;
            const isPrefetch = isPrefetchGetter();

            if (msg === '__OFFLINE_LAST_LI_WHEEL__') {
                if (isOfflineMode && pdfDoc && currentPage + batchSize <= totalPages) {
                    goToPage(currentPage + batchSize);
                    showToast('เปลี่ยนหน้าถัดไป', 'info');
                }
            } else if (msg === '__OFFLINE_SEQUENCE_END__') {
                window.offlineSequenceEnded = true;
            } else if (msg.startsWith('__NEXT_PAGE__')) {
                if (isPrefetch) return;
                // Offline reading stays on the current page until the user changes it.
                if (isOfflineMode) return;
                const parts = msg.split(':');
                if (parts.length > 1) {
                    const range = parts[1].split('-');
                    const batchEnd = parseInt(range[1]);
                    if (currentPage > batchEnd + 1) {
                        console.log('Ignoring stale NEXT_PAGE signal');
                        return;
                    }
                }

                if (currentPage + batchSize - 1 >= totalPages && totalPages > 0) {
                    confirmDeletePDF();
                } else {
                    triggerNextPageBatch();
                }
            } else if (msg === '__GEMINI_DONE__') {
                console.log(`Gemini finished generating summary (isPrefetch: ${isPrefetch}).`);
                if (isPrefetch) {
                    isPrefetchResponding = false;
                    isPrefetchReady = true;
                } else {
                    isGeminiResponding = false;
                    isProcessingPage = false;
                    // In Offline mode save the focused first summary automatically. The save
                    // completion handler advances the document only after the PDF is written.
                    if (isOfflineMode && pdfDoc && !window.offlineAutoSaveTriggered) {
                        window.offlineAutoSaveTriggered = true;
                        window.offlineSequenceActive = true;
                        window.offlineSequenceEnded = false;
                        setTimeout(() => autoSaveOfflineCurrentResponse(), 1800);
                    }
                }
            } else if (msg.startsWith('__GITHUB_SAVE__:')) {
                if (isPrefetch) return;
                const text = msg.substring('__GITHUB_SAVE__:'.length);
                const cleanText = text.replace(/[*_]/g, '').trim();
                enqueueSaveTask(async () => {
                    if (isOfflineMode) {
                        await saveOfflineSummary(text);
                        return;
                    }
                    const saved = await uploadTextAndImageWithBlock(cleanText);
                    if (!saved) {
                        await saveTextToGitHubWithProgress(cleanText);
                    }
                });
            } else if (msg.startsWith('__SCREENSHOT_SAVE__:')) {
                if (isPrefetch) return;
                const shareText = msg.substring('__SCREENSHOT_SAVE__:'.length);
                enqueueSaveTask(async () => {
                    try {
                        if (window.lastHighlightPromise) {
                            await window.lastHighlightPromise;
                            window.lastHighlightPromise = null;
                        }
                        await new Promise(resolve => setTimeout(resolve, 300));
                    } catch (e) {
                        console.error('Highlight error before capture:', e);
                    }
                    if (isOfflineMode) await saveOfflineSummary(shareText);
                    else await uploadScreenshotAndSave(shareText);
                });
            } else if (msg.startsWith('__OPEN_URL__:')) {
                window.electronAPI.openExternal(msg.substring('__OPEN_URL__:'.length));
            } else if (msg.startsWith('__TOAST__:')) {
                showToast(msg.substring('__TOAST__:'.length), 'info');
            } else if (msg.startsWith('__HIGHLIGHT_ALL__:')) {
                if (isPrefetch) return;
                const terms = msg.substring('__HIGHLIGHT_ALL__:'.length).trim();
                if (terms.length > 2) {
                    clearTimeout(window.highlightDebounce);
                    window.highlightDebounce = setTimeout(() => highlightContextInPDF(terms), 200);
                }
            } else if (msg === '__TTS_STOP_EDGE__') {
                window.edgeTtsGeneration = (window.edgeTtsGeneration || 0) + 1;
                if (window.__edgeAudio) {
                    window.__edgeAudio.pause();
                    if (window.__edgeAudio._ebookUrl) URL.revokeObjectURL(window.__edgeAudio._ebookUrl);
                    window.__edgeAudio.remove();
                    window.__edgeAudio = null;
                }
                webview.executeJavaScript('window.__ttsStop && window.__ttsStop()');
            } else if (msg.startsWith('__TTS_CACHE__:')) {
                var cacheText = msg.substring('__TTS_CACHE__:'.length);
                if (!window.__ttsCache) window.__ttsCache = {};
                if (window.__ttsCache[cacheText]) return;
                window.electronAPI.edgeSpeak(cacheText).then(function(res) {
                    if (res && res.audio) {
                        window.__ttsCache[cacheText] = { audio: res.audio, duration: res.duration };
                    }
                }).catch(function() {});
            } else if (msg.startsWith('__TTS_EDGE__:')) {
                if (isPrefetch) return;
                var edgeText = msg.substring('__TTS_EDGE__:'.length);
                var ttsGeneration = (window.edgeTtsGeneration || 0) + 1;
                window.edgeTtsGeneration = ttsGeneration;
                if (!window.__ttsCache) window.__ttsCache = {};
                function playTTS(audioData, dur) {
                    // Ignore a response that arrived after the reader moved to another item/page.
                    if (ttsGeneration !== window.edgeTtsGeneration) return;
                    if (window.__edgeAudio) {
                        window.__edgeAudio.pause();
                        if (window.__edgeAudio._ebookUrl) URL.revokeObjectURL(window.__edgeAudio._ebookUrl);
                        window.__edgeAudio.remove();
                    }
                    try {
                        var audioBlob = base64ToBlob(audioData, 'audio/mpeg');
                        var audioUrl = URL.createObjectURL(audioBlob);
                        window.__edgeAudio = new Audio(audioUrl);
                        window.__edgeAudio._ebookUrl = audioUrl;
                        window.__edgeAudio.volume = 1;
                        window.__edgeAudio.play().catch(function(e) { console.error('EdgeTTS play error:', e); });
                        webview.executeJavaScript('window.__ttsStart && window.__ttsStart(' + dur + ')');
                        window.__edgeAudio.onended = function() {
                            URL.revokeObjectURL(audioUrl);
                            if (ttsGeneration !== window.edgeTtsGeneration) return;
                            webview.executeJavaScript('window.__ttsStop && window.__ttsStop()');
                        };
                    } catch(e) {
                        console.error('EdgeTTS audio error:', e);
                        showToast('TTS audio error', 'error');
                    }
                }
                var cached = window.__ttsCache[edgeText];
                if (cached) { playTTS(cached.audio, cached.duration); return; }
                window.electronAPI.edgeSpeak(edgeText).then(function(res) {
                    if (ttsGeneration !== window.edgeTtsGeneration) return;
                    if (res && res.error) {
                        console.error('EdgeTTS error:', res.error);
                        showToast('TTS ล้มเหลว ลองอีกครั้ง', 'error');
                        return;
                    }
                    window.__ttsCache[edgeText] = { audio: res.audio, duration: res.duration };
                    playTTS(res.audio, res.duration);
                });
            } else if (msg.startsWith('__HIGHLIGHT_NOW__:')) {
                if (isPrefetch) return;
                const terms = msg.substring('__HIGHLIGHT_NOW__:'.length).trim();
                if (terms.length > 2) {
                    clearTimeout(window.highlightDebounce);
                    window.lastHighlightPromise = highlightContextInPDF(terms);
                }
            } else if (msg.startsWith('__HIGHLIGHT__:')) {
                if (isPrefetch) return;
                const term = msg.substring('__HIGHLIGHT__:'.length).trim();
                if (term.length > 2) {
                    clearTimeout(window.highlightDebounce);
                    window.highlightDebounce = setTimeout(() => highlightTextInPDF(term), 200);
                }
            } else if (msg.startsWith('__OPEN_SHARE_MODAL__:')) {
                if (isPrefetch) return;
                const shareText = msg.substring('__OPEN_SHARE_MODAL__:'.length);
                enqueueSaveTask(async () => {
                    try {
                        if (window.lastHighlightPromise) {
                            await window.lastHighlightPromise;
                            window.lastHighlightPromise = null;
                        }
                        await new Promise(resolve => setTimeout(resolve, 300));
                    } catch (e) {
                        console.error('Highlight error before capture:', e);
                    }
                    if (isOfflineMode) await saveOfflineSummary(shareText);
                    else await uploadScreenshotAndSave(shareText);
                });
            }
        });
    }

    const webviewElementA = document.getElementById('geminiWebviewA');
    const webviewElementB = document.getElementById('geminiWebviewB');
    setupWebviewListeners(webviewElementA, () => webviewElementA === prefetchWebview);
    setupWebviewListeners(webviewElementB, () => webviewElementB === prefetchWebview);
}

async function confirmDeletePDF() {
    // Prevent double triggers
    if (window.isDeleting) return;

    // Check if we really are at the end
    if (confirm('คุณอ่านจบเล่มแล้ว! ต้องการลบไฟล์ PDF นี้ออกจากเครื่องเลยหรือไม่?')) {
        window.isDeleting = true;

        showToast('กำลังลบไฟล์...', 'warning');

        const success = await window.electronAPI.deleteFile(currentFilePath);
        if (success) {
            showToast('ลบไฟล์เรียบร้อยแล้ว', 'success');


            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } else {
            showToast('ลบไฟล์ไม่สำเร็จ', 'error');
            window.isDeleting = false;
        }
    }
}

function normalizeSearchText(text) {
    return (text || '')
        .toString()
        .toLowerCase()
        .replace(/[\s\n\r\t]+/g, ' ')
        .replace(/[^a-z0-9\u0E00-\u0E7F]/g, '');
}

function parseHighlightPayload(raw) {
    if (!raw) return { primary: '', keywords: [], text: '' };
    if (typeof raw === 'object') {
        return {
            primary: (raw.primary || '').toString().trim(),
            keywords: Array.isArray(raw.keywords) ? raw.keywords.map(v => (v || '').toString().trim()).filter(Boolean) : [],
            text: (raw.text || '').toString().trim()
        };
    }

    const text = String(raw).trim();
    if (!text) return { primary: '', keywords: [], text: '' };

    if (text.startsWith('{')) {
        try {
            const parsed = JSON.parse(text);
            return parseHighlightPayload(parsed);
        } catch (e) {
            // fallback below
        }
    }

    return {
        primary: text,
        keywords: [text],
        text
    };
}

function extractSearchTermsFromPayload(rawPayload) {
    const payload = parseHighlightPayload(rawPayload);
    const termMap = new Map();

    const STOPWORDS = new Set([
        'the', 'and', 'of', 'to', 'in', 'for', 'on', 'with', 'as', 'by', 'at', 'an', 'be',
        'this', 'that', 'from', 'or', 'is', 'it', 'are', 'was', 'were', 'been', 'has',
        'have', 'had', 'but', 'not', 'they', 'them', 'their', 'his', 'her', 'its', 'a',
        'about', 'also', 'can', 'each', 'more', 'some', 'than', 'then', 'when', 'which',
        'will', 'would', 'may', 'other', 'into', 'over', 'such', 'only', 'very', 'just',
        'any', 'these', 'those', 'all', 'both', 'few', 'many', 'much', 'no', 'nor', 'so',
        'up', 'down', 'out', 'if', 'after', 'before', 'between', 'through', 'during',
        'without', 'within', 'along', 'above', 'below', 'under', 'because', 'could',
        'should', 'while', 'where', 'there', 'here', 'why', 'how', 'what', 'who', 'whom'
    ]);

    function pushTerm(raw, weight = 1) {
        const text = (raw || '').toString().replace(/\s+/g, ' ').trim();
        if (!text || text.length < 2) return;
        const norm = normalizeSearchText(text);
        if (norm.length < 2) return;
        // Filter stopwords: single word match
        if (STOPWORDS.has(norm)) return;
        // Filter: if all individual words are stopwords (e.g. "the and of")
        const words = text.toLowerCase().split(/\s+/);
        if (words.every(function (w) { return STOPWORDS.has(w.replace(/[^a-z]/g, '')); })) return;
        const existing = termMap.get(norm);
        if (!existing || existing.weight < weight || existing.raw.length < text.length) {
            termMap.set(norm, { raw: text, norm, weight });
        }
    }

    pushTerm(payload.primary, 8);
    (payload.keywords || []).forEach(term => pushTerm(term, 6));

    const contextText = (payload.text || '').replace(/\s+/g, ' ').trim();
    if (contextText) {
        const fragments = contextText
            .split(/[•·\n,;:|]/)
            .map(part => part.trim())
            .filter(part => part.length >= 4 && part.length <= 60);
        fragments.slice(0, 8).forEach(fragment => pushTerm(fragment, 2));

        const parenMatches = contextText.match(/\(([^)]+)\)/g) || [];
        parenMatches.forEach(part => pushTerm(part.replace(/[()]/g, ''), 5));

        const englishPhrases = contextText.match(/\b[A-Za-z][A-Za-z0-9/-]*(?:\s+[A-Za-z0-9/-]{2,}){0,4}\b/g) || [];
        englishPhrases.forEach(phrase => pushTerm(phrase, 4));
    }

    return Array.from(termMap.values())
        .sort((a, b) => (b.weight - a.weight) || (b.norm.length - a.norm.length))
        .slice(0, 14);
}

function getRangeGap(startA, endA, startB, endB) {
    if (endA < startB) return startB - endA;
    if (endB < startA) return startA - endB;
    return 0;
}

function getRectGap(a, b) {
    return {
        x: getRangeGap(a.x, a.x + a.w, b.x, b.x + b.w),
        y: getRangeGap(a.y, a.y + a.h, b.y, b.y + b.h)
    };
}

function getOverlapArea(a, b) {
    const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return overlapX * overlapY;
}

function getRectCenter(rect) {
    return {
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h / 2
    };
}

function getTextItemRect(item, viewport) {
    const tx = item.transform || [1, 0, 0, 1, 0, 0];
    const fontHeight = Math.sqrt((tx[0] || 0) * (tx[0] || 0) + (tx[1] || 0) * (tx[1] || 0)) || item.height || 12;
    const x = tx[4] || 0;
    const y = tx[5] || 0;
    const w = item.width || Math.max(fontHeight * 0.6, 8);
    const h = item.height || fontHeight;

    const p1 = viewport.convertToViewportPoint(x, y);
    const p2 = viewport.convertToViewportPoint(x + w, y + h);

    return {
        x: Math.min(p1[0], p2[0]),
        y: Math.min(p1[1], p2[1]),
        w: Math.max(8, Math.abs(p2[0] - p1[0])),
        h: Math.max(8, Math.abs(p2[1] - p1[1]))
    };
}

function createUnionRect(rects) {
    if (!rects || rects.length === 0) return null;
    let minX = rects[0].x;
    let minY = rects[0].y;
    let maxX = rects[0].x + rects[0].w;
    let maxY = rects[0].y + rects[0].h;

    for (let i = 1; i < rects.length; i++) {
        const rect = rects[i];
        minX = Math.min(minX, rect.x);
        minY = Math.min(minY, rect.y);
        maxX = Math.max(maxX, rect.x + rect.w);
        maxY = Math.max(maxY, rect.y + rect.h);
    }

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function clampRegionToCanvas(region, canvasWidth, canvasHeight) {
    if (!region) return region;
    const x = Math.max(0, Math.min(region.x, canvasWidth));
    const y = Math.max(0, Math.min(region.y, canvasHeight));
    const right = Math.max(x, Math.min(region.x + region.w, canvasWidth));
    const bottom = Math.max(y, Math.min(region.y + region.h, canvasHeight));
    return {
        x,
        y,
        w: Math.max(1, right - x),
        h: Math.max(1, bottom - y)
    };
}

function getRegionAreaFraction(region, canvasWidth, canvasHeight) {
    const canvasArea = Math.max(1, canvasWidth * canvasHeight);
    return (region.w * region.h) / canvasArea;
}

function getPageLayoutBlocksAtScale(pageNum, targetScale) {
    const blocks = pageLayoutBlocks[pageNum] || [];
    return blocks.map(b => ({
        ...b,
        x: b.x * targetScale,
        y: b.y * targetScale,
        w: b.w * targetScale,
        h: b.h * targetScale
    }));
}

// ตรวจว่าบล็อกมี "ภาพจริง" ไม่ใช่พื้นที่กระดาษว่างที่เกิดจากการคำนวณกรอบขั้นต่ำ
// ใช้ข้อมูลพิกเซลของ canvas โดยตรง เพื่อให้ใช้ได้กับ PDF ที่ไม่มี image object ชัดเจน
// (เช่นภาพวาดสแกนหรือภาพที่ถูก flatten มาในหน้า PDF)
function getVisualEvidence(canvas, region) {
    if (!canvas || !region || region.w < 1 || region.h < 1) return { usable: false, inkRatio: 0, colorRatio: 0 };
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const x = Math.max(0, Math.floor(region.x));
    const y = Math.max(0, Math.floor(region.y));
    const w = Math.min(canvas.width - x, Math.ceil(region.w));
    const h = Math.min(canvas.height - y, Math.ceil(region.h));
    if (w < 24 || h < 24) return { usable: false, inkRatio: 0, colorRatio: 0 };

    let pixels;
    try { pixels = ctx.getImageData(x, y, w, h).data; } catch (_) { return { usable: false, inkRatio: 0, colorRatio: 0 }; }

    // PDF หนังสือส่วนใหญ่ใช้พื้นกระดาษโทนอ่อน จึงใช้ median-ish ของมุมเป็นพื้นหลัง
    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
    let bg = [0, 0, 0];
    corners.forEach(([cx, cy]) => {
        const i = (cy * w + cx) * 4;
        bg[0] += pixels[i]; bg[1] += pixels[i + 1]; bg[2] += pixels[i + 2];
    });
    bg = bg.map(v => v / corners.length);

    let total = 0, ink = 0, colorful = 0;
    const step = Math.max(2, Math.floor(Math.min(w, h) / 90));
    for (let py = 0; py < h; py += step) {
        for (let px = 0; px < w; px += step) {
            const i = (py * w + px) * 4;
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            const delta = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
            const chroma = Math.max(r, g, b) - Math.min(r, g, b);
            total++;
            if (delta > 54) ink++;
            if (chroma > 24 && delta > 28) colorful++;
        }
    }
    const inkRatio = total ? ink / total : 0;
    const colorRatio = total ? colorful / total : 0;
    // ภาพเส้นขาวดำอาจมีสีไม่มาก แต่ต้องมี ink หนาแน่นกว่าข้อความบรรทัดเดียวมาก
    return { usable: inkRatio >= 0.055 || (inkRatio >= 0.025 && colorRatio >= 0.018), inkRatio, colorRatio };
}

function getRenderedCanvas(pageNum) {
    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    return wrapper ? wrapper.querySelector('canvas') : null;
}

// เลือกภาพประกอบแบบ retry: เริ่มจากภาพที่อยู่ติด anchor มากที่สุด แล้วค่อยผ่อนระยะค้นหา
// จะคืนเฉพาะภาพที่มีหลักฐานพิกเซลจริงเท่านั้น จึงไม่ให้กรอบไปตกบนพื้นขาว
function findBestIllustrationWithRetries(pageNum, textRegion, canvasW, canvasH) {
    const blocks = getPageLayoutBlocksAtScale(pageNum, scale);
    const canvas = getRenderedCanvas(pageNum);
    if (!blocks.length || !canvas) return null;

    const pageArea = Math.max(1, canvasW * canvasH);
    const center = getRectCenter(textRegion);
    // Never allow a page/spread-sized region to masquerade as one illustration.
    // The fallback must be the article, not a screenshot of an entire page.
    const MAX_ILLUSTRATION_FRACTION = 0.26;
    // ขยายรัศมีเพียงเท่าที่ภาพยังนับว่าเป็นบริบทของย่อหน้า
    // ไม่ค้นข้ามไปเลือกภาพตกแต่ง/หัวข้ออื่นบนหน้าเดียวกัน
    const passes = [0.24, 0.38, 0.50];
    for (let pass = 0; pass < passes.length; pass++) {
        const maxDistance = canvasH * passes[pass];
        const candidates = blocks
            .filter(block => {
                const area = block.w * block.h;
                const ratio = block.w / Math.max(1, block.h);
                const areaFraction = area / pageArea;
                const pageSized = areaFraction > MAX_ILLUSTRATION_FRACTION ||
                    block.w > canvasW * 0.68 || block.h > canvasH * 0.78;
                return block.kind !== 'noise' && !pageSized &&
                    area >= Math.max(3500, pageArea * 0.004) && ratio >= 0.16 && ratio <= 6.2;
            })
            .map(block => {
                const c = getRectCenter(block);
                const dx = Math.abs(c.x - center.x), dy = Math.abs(c.y - center.y);
                const distance = Math.hypot(dx, dy);
                const overlap = getOverlapArea(textRegion, block);
                const evidence = getVisualEvidence(canvas, block);
                // PDF บางเล่มรวมภาพกับพื้นผิว/คำบรรยายจน layout detector เรียกว่า text
                // จึงใช้สีและขนาดของบล็อกเป็นสิทธิ์ผ่านเพิ่ม แต่ไม่รับ text ดำธรรมดา
                const areaFraction = (block.w * block.h) / pageArea;
                const imageClass = block.kind === 'image' || (block.kind === 'mixed' && block.textCoverage <= 0.25);
                const colorfulGraphic = evidence.colorRatio >= 0.018 && areaFraction >= 0.010 && areaFraction <= MAX_ILLUSTRATION_FRACTION;
                const largeGraphic = block.kind === 'text' && evidence.colorRatio >= 0.030 &&
                    block.h >= canvasH * 0.11 && block.w >= canvasW * 0.18;
                const isIllustration = imageClass || colorfulGraphic || largeGraphic;

                // ความสัมพันธ์ที่ต้องการที่สุด: ภาพติดใต้/ข้างย่อหน้าที่ Gemini เลือก
                const horizontalOverlap = Math.max(0, Math.min(textRegion.x + textRegion.w, block.x + block.w) - Math.max(textRegion.x, block.x));
                const verticalOverlap = Math.max(0, Math.min(textRegion.y + textRegion.h, block.y + block.h) - Math.max(textRegion.y, block.y));
                const gapBelow = Math.max(0, block.y - (textRegion.y + textRegion.h));
                const gapSide = Math.max(0, Math.max(textRegion.x, block.x) - Math.min(textRegion.x + textRegion.w, block.x + block.w));
                const adjacentBelow = horizontalOverlap >= Math.min(textRegion.w, block.w) * 0.18 && gapBelow <= canvasH * 0.30;
                const adjacentSide = verticalOverlap >= Math.min(textRegion.h, block.h) * 0.24 && gapSide <= canvasW * 0.22;
                // same column/row และภาพที่อยู่เหนือหัวข้อ (caption/heading) เป็นความสัมพันธ์รอง
                const aligned = dx <= Math.max(block.w * 0.85, canvasW * 0.20);
                const score = (overlap ? 100000 : 0) + (adjacentBelow ? 42000 : 0) +
                    (adjacentSide ? 27000 : 0) + (aligned ? 9000 : 0) +
                    (evidence.inkRatio * 24000) + (evidence.colorRatio * 16000) +
                    (block.w * block.h * 0.006) - distance * 13;
                return { block, distance, aligned, adjacentBelow, adjacentSide, isIllustration, evidence, score };
            })
            .filter(candidate => {
                if (!candidate.isIllustration || !candidate.evidence.usable) return false;
                // ต้องติดย่อหน้า หรืออย่างน้อยอยู่ใกล้และอยู่ในแนวเดียวกันจริง ๆ
                return candidate.adjacentBelow || candidate.adjacentSide ||
                    (candidate.aligned && candidate.distance <= maxDistance) ||
                    candidate.distance <= maxDistance * 0.62;
            })
            .sort((a, b) => b.score - a.score);

        if (candidates.length) {
            const best = candidates[0];
            console.log(`[Smart Crop] illustration retry ${pass + 1}/3 accepted`, {
                size: `${Math.round(best.block.w)}x${Math.round(best.block.h)}`,
                ink: best.evidence.inkRatio.toFixed(3), distance: Math.round(best.distance)
            });
            return best.block;
        }
        console.warn(`[Smart Crop] illustration retry ${pass + 1}/3 found no verified image`);
    }
    return null;
}

// เมื่อไม่มีภาพประกอบ ให้กรอบเป็น "ย่อหน้าบริบท" ทั้งบล็อก ไม่ใช่แค่หัวข้อ/หนึ่งบรรทัด
async function buildArticleContextRegion(pageNum, anchor, viewport) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const anchorCenter = getRectCenter(anchor);
    const maxColumnDistance = Math.max(viewport.width * 0.20, 190);
    const minY = Math.max(0, anchor.y - Math.max(28, anchor.h * 1.5));
    const maxY = Math.min(viewport.height, anchor.y + Math.max(viewport.height * 0.34, 260));
    const items = content.items.map(item => getTextItemRect(item, viewport)).filter(rect => {
        const c = getRectCenter(rect);
        // PDF บางไฟล์รวมทั้งบรรทัดเป็น text item เดียว จึงใช้การทับกับ lane ของคอลัมน์
        // แทนการใช้จุดกึ่งกลางอย่างเดียว (ซึ่งจะทิ้งบรรทัดเนื้อหาที่ยาว)
        const overlapsAnchorColumn = rect.x <= anchorCenter.x + maxColumnDistance &&
            rect.x + rect.w >= anchorCenter.x - maxColumnDistance;
        return c.y >= minY && c.y <= maxY && overlapsAnchorColumn;
    }).sort((a, b) => a.y - b.y || a.x - b.x);

    if (!items.length) return { ...anchor };
    // จำกัดถึงประมาณ 14 บรรทัดหรือจนถึงช่องว่างแนวตั้งใหญ่ ซึ่งมักเป็นหัวข้อถัดไป
    const selected = [];
    let previousY = null;
    for (const rect of items) {
        if (previousY !== null && rect.y - previousY > Math.max(55, anchor.h * 3) && selected.length >= 3) break;
        selected.push(rect);
        previousY = rect.y;
        if (selected.length >= 14) break;
    }
    let region = createUnionRect([anchor, ...selected]) || { ...anchor };
    const paddingX = 18, paddingY = 14;
    region = clampRegionToCanvas({ x: region.x - paddingX, y: region.y - paddingY, w: region.w + paddingX * 2, h: region.h + paddingY * 2 }, viewport.width, viewport.height);
    return region;
}

function expandRegionWithLayoutBlocks(pageNum, region, canvasWidth = 0, canvasHeight = 0) {
    const blocks = getPageLayoutBlocksAtScale(pageNum, scale);
    if (!region || blocks.length === 0) return region;

    const typedBlocks = blocks.map(block => ({
        ...block,
        kind: block.kind || 'mixed',
        textCoverage: block.textCoverage || 0,
        textItemCount: block.textItemCount || 0
    }));
    const seed = { ...region };
    const seedCenter = getRectCenter(seed);
    const pageArea = Math.max(1, canvasWidth * canvasHeight);

    // 1. หา image block ที่ดีที่สุด — เน้นภาพประกอบเป็นหลัก
    const MIN_IMAGE_AREA = Math.max(4000, pageArea * 0.006); // ขั้นต่ำ 0.6% ของหน้า
    const imageCandidates = typedBlocks
        .filter(b => {
            const bArea = b.w * b.h;
            if (bArea < MIN_IMAGE_AREA) return false; // ตัดภาพที่เล็กเกินออก
            if (b.kind === 'image') return true;
            // mixed: ต้องมีพื้นที่ >= 3% ของหน้า และ textCoverage ต่ำ (ไม่ใช่แค่ text)
            if (b.kind === 'mixed' && (b.areaFraction || 0) >= 0.03 && (b.textCoverage || 0) <= 0.25) return true;
            return false;
        })
        .map(b => {
            const bc = getRectCenter(b);
            const dist = Math.sqrt(
                Math.pow(bc.x - seedCenter.x, 2) +
                Math.pow(bc.y - seedCenter.y, 2)
            );
            const overlap = getOverlapArea(seed, b);
            const bArea = b.w * b.h;
            // Score: overlap ดีที่สุด → ระยะใกล้ → ขนาดใหญ่
            const score = (overlap > 0 ? 50000 : 0) + (10000 / (dist + 1)) + bArea * 0.01;
            return { block: b, dist, overlap, score, centerX: bc.x, centerY: bc.y };
        })
        .sort((a, b) => b.score - a.score);

    const bestImage = imageCandidates.length > 0 ? imageCandidates[0] : null;

    // 2. ถ้ามีภาพ + อยู่ในระยะสมเหตุสมผล (25% ของความสูงหน้า หรือ overlap)
    const imageDistThreshold = canvasHeight > 0 ? canvasHeight * 0.25 : 500;
    if (bestImage && (bestImage.overlap > 0 || bestImage.dist < imageDistThreshold)) {
        let region = createUnionRect([seed, bestImage.block]) || seed;
        const usedBlocks = new Set();
        usedBlocks.add(bestImage.block);

        // หา caption ที่ติดกับภาพนี้
        for (const b of typedBlocks) {
            if (b.kind !== 'caption') continue;
            const ctr = getRectCenter(b);
            if (Math.abs(ctr.x - bestImage.centerX) > bestImage.block.w * 1.2) continue;
            const gap = getRectGap(region, b);
            if (gap.y > 60 || gap.x > 60) continue;
            const candidate = createUnionRect([region, b]);
            if (!candidate) continue;
            if (getRegionAreaFraction(candidate, canvasWidth, canvasHeight) > 0.30) continue;
            region = candidate;
            usedBlocks.add(b);
        }

        // Padding รอบภาพ
        const p = 18;
        region = {
            x: Math.max(0, region.x - p),
            y: Math.max(0, region.y - p),
            w: Math.min(canvasWidth > 0 ? canvasWidth - Math.max(0, region.x - p) : region.w + p * 2, region.w + p * 2),
            h: Math.min(canvasHeight > 0 ? canvasHeight - Math.max(0, region.y - p) : region.h + p * 2, region.h + p * 2)
        };
        if (canvasWidth > 0) region = clampRegionToCanvas(region, canvasWidth, canvasHeight);

        // Max size limit
        const maxW = canvasWidth * 0.62;
        const maxH = canvasHeight * 0.58;
        if (canvasWidth > 0 && region.w > maxW) region.w = maxW;
        if (canvasHeight > 0 && region.h > maxH) region.h = maxH;
        if (canvasWidth > 0) region = clampRegionToCanvas(region, canvasWidth, canvasHeight);
        return region;
    }

    // 3. ไม่มีภาพ — ขยายอย่างระมัดระวัง เฉพาะเมื่อมีข้อความใกล้เคียง
    const textBlocks = typedBlocks
        .filter(b => b.kind === 'text' || b.kind === 'mixed')
        .sort((a, b) => {
            const da = getOverlapArea(seed, a);
            const db = getOverlapArea(seed, b);
            return db - da;
        });

    let bestRegion = seed;
    let hasReasonableExpansion = false;

    for (const t of textBlocks.slice(0, 2)) {
        const candidate = createUnionRect([seed, t]);
        if (!candidate) continue;
        const area = getRegionAreaFraction(candidate, canvasWidth, canvasHeight);

        if (area <= 0.15) {
            bestRegion = candidate;
            hasReasonableExpansion = true;
            break;
        } else if (area <= 0.25 && !hasReasonableExpansion) {
            bestRegion = candidate;
            hasReasonableExpansion = true;
        }
    }

    const padding = 6;
    let result = {
        x: Math.max(0, bestRegion.x - padding),
        y: Math.max(0, bestRegion.y - padding),
        w: bestRegion.w + padding * 2,
        h: bestRegion.h + padding * 2
    };

    if (canvasWidth > 0) result = clampRegionToCanvas(result, canvasWidth, canvasHeight);
    if (result.w < 100) result.w = Math.min(100, canvasWidth * 0.12);
    if (result.h < 80) result.h = Math.min(80, canvasHeight * 0.12);
    if (canvasWidth > 0) result = clampRegionToCanvas(result, canvasWidth, canvasHeight);

    return result;
}

/**
 * ค้นหา image block ที่ดีที่สุดสำหรับ text region ที่กำหนด
 * ภาพประกอบ (illustration) คือเป้าหมายหลักในการ crop
 * @param {number} pageNum
 * @param {object} textRegion {x,y,w,h} ใน canvas coordinates
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {object|null} image block หรือ null
 */
function findBestImageForRegion(pageNum, textRegion, canvasW, canvasH) {
    const blocks = getPageLayoutBlocksAtScale(pageNum, scale);
    if (!blocks || blocks.length === 0) return null;

    const pageArea = Math.max(1, canvasW * canvasH);
    // ต้องเป็นภาพที่มีขนาดพอสมควร: ขั้นต่ำ 0.8% ของหน้า หรือ 5000 px²
    const MIN_IMAGE_AREA = Math.max(5000, pageArea * 0.008);
    const seedCenter = getRectCenter(textRegion);

    const candidates = blocks
        .filter(b => {
            const bArea = b.w * b.h;
            if (bArea < MIN_IMAGE_AREA) return false;
            if (b.kind === 'image') return true;
            // mixed block: ต้องมีพื้นที่ >= 3% และ textCoverage ต่ำ
            if (b.kind === 'mixed' && (b.areaFraction || 0) >= 0.03 && (b.textCoverage || 0) <= 0.20) return true;
            return false;
        })
        .map(b => {
            const bc = getRectCenter(b);
            const dist = Math.sqrt(
                Math.pow(bc.x - seedCenter.x, 2) +
                Math.pow(bc.y - seedCenter.y, 2)
            );
            const overlap = getOverlapArea(textRegion, b);
            const bArea = b.w * b.h;
            // Score: overlap > proximity > size
            const score = (overlap > 0 ? 100000 : 0) + (10000 / (dist + 1)) + bArea * 0.005;
            return { block: b, dist, overlap, score };
        })
        .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) return null;

    const best = candidates[0];
    // ยอมรับเฉพาะภาพที่ overlap กับ seed หรืออยู่ในระยะ 30% ของความสูงหน้า
    const maxDist = canvasH > 0 ? canvasH * 0.30 : 400;
    if (best.overlap > 0 || best.dist <= maxDist) {
        return best.block;
    }
    return null;
}

function repositionOverlay(overlay, wrapper, region) {
    const canvas = wrapper.querySelector('canvas');
    if (!canvas) {
        overlay.style.left = region.x + 'px';
        overlay.style.top = region.y + 'px';
        overlay.style.width = region.w + 'px';
        overlay.style.height = region.h + 'px';
        return;
    }
    const scaleX = canvas.clientWidth / canvas.width;
    const scaleY = canvas.clientHeight / canvas.height;

    overlay.style.left = (canvas.offsetLeft + region.x * scaleX) + 'px';
    overlay.style.top = (canvas.offsetTop + region.y * scaleY) + 'px';
    overlay.style.width = (region.w * scaleX) + 'px';
    overlay.style.height = (region.h * scaleY) + 'px';
}

function drawContextHighlight(pageNum, region) {
    if (!region) return null;

    document.querySelectorAll('.highlight-overlay').forEach(el => el.remove());

    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    if (!wrapper) { syncOverlayFlagToWebview(); return null; }

    const canvas = wrapper.querySelector('canvas');
    if (!canvas) { syncOverlayFlagToWebview(); return null; }

    const overlay = document.createElement('div');
    overlay.className = 'highlight-overlay context-highlight';
    overlay.style.position = 'absolute';
    overlay.style.pointerEvents = 'none';

    // Scale initial sizes to screen pixels
    const scaleX = canvas.clientWidth ? (canvas.clientWidth / canvas.width) : 1;
    const scaleY = canvas.clientHeight ? (canvas.clientHeight / canvas.height) : 1;

    overlay.style.width = `${region.w * scaleX}px`;
    overlay.style.height = `${region.h * scaleY}px`;

    // กรอบแดงชัดเจน (ไม่ dim พื้นที่นอกกรอบ)
    overlay.style.border = '4px solid rgba(255, 44, 44, 0.96)';
    overlay.style.borderRadius = '14px';
    overlay.style.boxShadow = `
        0 0 0 2px rgba(255,255,255,0.20) inset,
        0 0 20px rgba(255, 44, 44, 0.5),
        0 4px 16px rgba(0, 0, 0, 0.25)
    `;
    overlay.style.background = 'rgba(255, 44, 44, 0.03)';
    overlay.style.zIndex = '10';
    overlay.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';

    wrapper.appendChild(overlay);
    // Position immediately (before layout settles)
    overlay.style.left = (canvas.offsetLeft + region.x * scaleX) + 'px';
    overlay.style.top = (canvas.offsetTop + region.y * scaleY) + 'px';

    // Re-position after a frame when layout is settled
    requestAnimationFrame(function () {
        repositionOverlay(overlay, wrapper, region);
    });
    syncOverlayFlagToWebview();
    return overlay;
}

function syncOverlayFlagToWebview() {
    if (!geminiWebview || !geminiWebview.executeJavaScript) return;
    const hasOverlay = document.querySelector('.highlight-overlay') !== null;
    geminiWebview.executeJavaScript('try{ if(window.updateSaveButtons){ window.updateSaveButtons(' + hasOverlay + '); } else { window.__hasOverlay__=' + hasOverlay + '; } }catch(e){}').catch(() => { });
}

function clusterMatches(matches) {
    if (!matches || matches.length === 0) return [];
    const clusters = [];
    const sorted = [...matches].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    for (const match of sorted) {
        let target = null;
        for (const c of clusters) {
            const gap = getRectGap(c.region, match.rect);
            const overlapW = Math.min(c.region.x + c.region.w, match.rect.x + match.rect.w) - Math.max(c.region.x, match.rect.x);
            if ((overlapW > -80 && gap.y < 150) || (gap.x < 80 && gap.y === 0)) {
                target = c; break;
            }
        }
        if (!target) {
            target = { region: { ...match.rect }, matches: [], termSet: new Set(), weightedHits: 0 };
            clusters.push(target);
        }
        target.matches.push(match);
        target.termSet.add(match.term.raw);
        target.weightedHits += match.term.weight;
        target.region = createUnionRect([target.region, match.rect]);
    }
    return clusters;
}

async function highlightContextInPDF(rawPayload) {
    if (!pdfDoc || !rawPayload) return null;

    try {
        const payload = parseHighlightPayload(rawPayload);
        const searchTerms = extractSearchTermsFromPayload(payload);
        if (searchTerms.length === 0) {
            return highlightTextInPDF(payload.primary || payload.text || '');
        }

        document.querySelectorAll('.highlight-overlay').forEach(el => el.remove());
        syncOverlayFlagToWebview();

        const startPage = currentPage;
        const endPage = Math.min(currentPage + batchSize - 1, totalPages);

        let bestPageNum = null;
        let bestPageScore = -1;
        let bestPageMatches = [];
        let bestPageViewport = null;

        for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
            const page = await pdfDoc.getPage(pageNum);
            const content = await page.getTextContent();
            const viewport = page.getViewport({ scale: scale });
            const pageMatches = [];

            for (const item of content.items) {
                const itemNorm = normalizeSearchText(item.str || '');
                if (itemNorm.length < 2) continue;

                // Skip matches inside noise layout blocks (like creases, header/footer line decorations)
                const itemRect = getTextItemRect(item, viewport);
                const blocks = getPageLayoutBlocksAtScale(pageNum, scale);
                let isInsideValidBlock = false;
                if (blocks.length > 0) {
                    for (const block of blocks) {
                        if (block.kind !== 'noise' && getOverlapArea(itemRect, block) > 0) {
                            isInsideValidBlock = true;
                            break;
                        }
                    }
                } else {
                    isInsideValidBlock = true;
                }

                if (!isInsideValidBlock) continue;

                for (const term of searchTerms) {
                    if (!term.norm || term.norm.length < 2) continue;
                    const exact = itemNorm === term.norm;
                    let contained = itemNorm.includes(term.norm);
                    if (!contained && term.norm.includes(itemNorm) && itemNorm.length >= 3) {
                        const termWords = term.raw.toLowerCase().split(/[^a-z0-9\u0E00-\u0E7F]+/).map(w => normalizeSearchText(w)).filter(w => w.length >= 2);
                        if (termWords.includes(itemNorm)) {
                            contained = true;
                        }
                    }

                    if (exact || contained) {
                        pageMatches.push({
                            rect: itemRect,
                            term,
                            exact
                        });
                        break;
                    }
                }
            }

            if (pageMatches.length === 0) continue;

            let sumWeight = 0;
            const uniqueTermsSet = new Set();
            let exactHits = 0;
            for (const m of pageMatches) {
                sumWeight += m.term.weight || 1;
                uniqueTermsSet.add(m.term.raw);
                if (m.exact) exactHits++;
            }
            const score = (sumWeight * 15) + (uniqueTermsSet.size * 25) + (exactHits * 10);

            if (score > bestPageScore) {
                bestPageScore = score;
                bestPageNum = pageNum;
                bestPageMatches = pageMatches;
                bestPageViewport = viewport;
            }
        }

        if (!bestPageNum) return highlightTextInPDF(payload.primary || searchTerms[0]?.raw || payload.text || '');

        // Determine effective column constraints
        const isSpread = bestPageViewport.width > bestPageViewport.height * 1.15;
        let colLeft = 0, colRight = bestPageViewport.width;
        if (isSpread) {
            const midX = bestPageViewport.width / 2;
            let leftW = 0, rightW = 0;
            for (const m of bestPageMatches) {
                if (m.rect.x + m.rect.w / 2 < midX) leftW += m.term.weight || 1;
                else rightW += m.term.weight || 1;
            }
            if (leftW >= rightW) colRight = midX;
            else colLeft = midX;
        }

        // Build base region from text by clustering matches to avoid giant boxes
        const matchRects = bestPageMatches.filter(m => {
            const cx = m.rect.x + m.rect.w / 2;
            return cx >= colLeft && cx <= colRight;
        });

        let regionToDraw = null;
        if (matchRects.length > 0) {
            // Group matches into clusters (horizontal gap < 120, vertical gap < 80)
            const clusters = [];
            for (const match of matchRects) {
                let added = false;
                for (const c of clusters) {
                    const gap = getRectGap(c.bounds, match.rect);
                    if (gap.x < 120 && gap.y < 80) {
                        c.matches.push(match);
                        c.bounds = createUnionRect([c.bounds, match.rect]) || c.bounds;
                        c.score += match.term.weight || 1;
                        added = true;
                        break;
                    }
                }
                if (!added) {
                    clusters.push({
                        matches: [match],
                        bounds: { ...match.rect },
                        score: match.term.weight || 1
                    });
                }
            }
            // Sort clusters by score descending and then by area ascending (prefer smaller, high-weight focus blocks)
            clusters.sort((a, b) => b.score - a.score || (a.bounds.w * a.bounds.h) - (b.bounds.w * b.bounds.h));
            regionToDraw = clusters[0]?.bounds || null;
        }

        if (!regionToDraw) {
            regionToDraw = createUnionRect(bestPageMatches.map(m => m.rect));
        }

        if (!regionToDraw) return highlightTextInPDF(payload.primary || searchTerms[0]?.raw || payload.text || '');

        // Image-first แบบยืนยันด้วยพิกเซลจริงและ retry หลายระยะค้นหา
        // ห้ามรวมพื้นที่ว่างระหว่างคำกับภาพ เพราะทำให้กรอบดูเหมือนไม่ติดภาพ
        const bestImageBlock = findBestIllustrationWithRetries(
            bestPageNum, regionToDraw,
            bestPageViewport.width, bestPageViewport.height
        );

        let expanded;
        if (bestImageBlock) {
            // ภาพประกอบเป็นเป้าหมายหลัก: วงเฉพาะภาพ + ขอบเล็กน้อย
            expanded = clampRegionToCanvas({
                x: bestImageBlock.x - 18,
                y: bestImageBlock.y - 18,
                w: bestImageBlock.w + 36,
                h: bestImageBlock.h + 36
            }, bestPageViewport.width, bestPageViewport.height);
            console.log('[Smart Crop] Image-first: found image block', Math.round(bestImageBlock.w) + 'x' + Math.round(bestImageBlock.h));
        } else {
            // ไม่มีภาพจริงหลัง retry ทั้งหมด: ดึงย่อหน้าบริบทในคอลัมน์เดียวกัน
            expanded = await buildArticleContextRegion(bestPageNum, regionToDraw, bestPageViewport);
            console.log('[Smart Crop] no verified illustration; using article-context fallback');
        }

        // Preserve the actual image/text target separately from the viewport
        // overlay used for scrolling and visual focus.
        window.lastFocusedRegion = {
            pageNum: bestPageNum,
            region: { ...expanded },
            viewportWidth: bestPageViewport.width,
            viewportHeight: bestPageViewport.height
        };

        // Get wrapper for canvas clamping
        const wrapper = document.getElementById(`page-wrapper-${bestPageNum}`);
        let finalCanvas = wrapper ? wrapper.querySelector('canvas') : null;

        // Save keyword match center BEFORE zoom (in current-scale canvas coords)
        var keywordMatchCenter = {
            x: regionToDraw.x + regionToDraw.w / 2,
            y: regionToDraw.y + regionToDraw.h / 2
        };

        // Auto-zoom: คำนวณ zoom ให้ expanded region fit viewport ได้สมดุลพอดี
        let zoomRatio = 1;
        if (scale < 2.95) {
            const prevScale = scale;
            const contEl = document.getElementById('pdfContainer');
            const vpW = contEl ? contEl.clientWidth : 800;
            const vpH = contEl ? contEl.clientHeight : 600;
            // คำนวณ zoom จากขนาดexpanded เทียบกับ viewport โดยตรง
            // expanded.w/h อยู่ใน canvas pixels ที่ prevScale → ต้องหารด้วย prevScale ก่อน
            // เพื่อให้ได้ขนาด PDF points แล้วคูณด้วย scale ใหม่
            const expandedPtsW = expanded.w / prevScale;
            const expandedPtsH = expanded.h / prevScale;
            // scale ที่ทำให้ expanded ครอบ 80% ของ viewport
            const fitW = (vpW * 0.80) / expandedPtsW;
            const fitH = (vpH * 0.80) / expandedPtsH;
            scale = Math.max(0.75, Math.min(3.0, Math.min(fitW, fitH)));
            zoomRatio = scale / prevScale;
            zoomLevel.textContent = `${Math.round(scale * 100)}%`;
            await renderKeysPages();
            const refreshedWrapper = document.getElementById(`page-wrapper-${bestPageNum}`);
            finalCanvas = refreshedWrapper ? refreshedWrapper.querySelector('canvas') : finalCanvas;
        }

        window.lastHighlightPageNum = bestPageNum;

        // Helper: คำนวณ viewport region จาก container ∩ canvas
        function calcViewportRegion() {
            var cont = document.getElementById('pdfContainer');
            var wrap = document.getElementById('page-wrapper-' + bestPageNum);
            var cv = wrap ? wrap.querySelector('canvas') : null;
            if (!cv && cont) cv = cont.querySelector('.pdf-canvas-item');
            if (!cont || !cv) return null;
            var cR = cont.getBoundingClientRect();
            var aR = cv.getBoundingClientRect();
            if (!aR.width || !aR.height) return null;
            var vL = Math.max(cR.left, aR.left);
            var vT = Math.max(cR.top, aR.top);
            var vR = Math.min(cR.right, aR.right);
            var vB = Math.min(cR.bottom, aR.bottom);
            if (vR <= vL || vB <= vT) return null;
            var sx = cv.width / aR.width;
            var sy = cv.height / aR.height;
            var vp = {
                x: (vL - aR.left) * sx, y: (vT - aR.top) * sy,
                w: (vR - vL) * sx, h: (vB - vT) * sy
            };
            if (vp.w < 10 || vp.h < 10) return null;
            return vp;
        }

        // Helper: re-position overlay + update lastHighlightRegion
        function syncOverlayToViewport() {
            var vp = calcViewportRegion();
            if (!vp) return false;
            window.lastHighlightRegion = vp;
            var wrap = document.getElementById('page-wrapper-' + bestPageNum);
            if (wrap && overlay) repositionOverlay(overlay, wrap, vp);
            return true;
        }

        // Step 9: วาด overlay = viewport (รอ layout settle ก่อน)
        window.lastHighlightRegion = null;
        const overlay = drawContextHighlight(bestPageNum, { x: 0, y: 0, w: 1, h: 1 });

        // Synchronous fallback: คำนวณ viewport ทันที ถ้า async ไม่ทัน
        syncOverlayToViewport();

        // Step 10: รอ layout settle → คำนวณ viewport จริง → scroll → re-position
        if (overlay) {
            const delay = highlightContextRecursion > 0 ? 450 : 150;
            requestAnimationFrame(function () {
                setTimeout(() => {
                    try {
                        const wrap = document.getElementById(`page-wrapper-${bestPageNum}`);
                        const cont = document.getElementById('pdfContainer');
                        if (!wrap || !cont) {
                            overlay.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            return;
                        }

                        // คำนวณ viewport จริงหลัง layout settle
                        syncOverlayToViewport();

                        // Scroll ให้ keyword อยู่กึ่งกลางจอ
                        const canv = wrap.querySelector('canvas');
                        if (!canv) return;
                        const scX = canv.clientWidth / canv.width;
                        const scY = canv.clientHeight / canv.height;
                        const canvOffX = canv.offsetLeft;
                        const canvOffY = canv.offsetTop;
                        const wrapR = wrap.getBoundingClientRect();
                        const contR = cont.getBoundingClientRect();
                        const contentCtrX = wrapR.left + canvOffX + (keywordMatchCenter.x * zoomRatio * scX);
                        const contentCtrY = wrapR.top + canvOffY + (keywordMatchCenter.y * zoomRatio * scY);
                        const contCenterX = contR.left + contR.width / 2;
                        const contCenterY = contR.top + contR.height / 2;

                        var targetScrollTop = cont.scrollTop + (contentCtrY - contCenterY);
                        var targetScrollLeft = cont.scrollLeft + (contentCtrX - contCenterX);

                        cont.scrollTo({
                            top: Math.max(0, targetScrollTop),
                            left: Math.max(0, targetScrollLeft),
                            behavior: 'smooth'
                        });

                        // Re-calculate viewport หลัง scroll เสร็จ
                        setTimeout(() => { syncOverlayToViewport(); }, 350);
                    } catch (e) {
                        try { overlay.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { }
                    }
                }, delay);
            });
        }

        return { pageNum: bestPageNum, region: window.lastHighlightRegion };

    } catch (err) {
        console.error('[PDF] Smart context highlight failed, falling back:', err);
        return highlightWithLegacyHeuristic(rawPayload);
    }
}

async function highlightWithLegacyHeuristic(rawPayload) {
    if (!pdfDoc || !rawPayload) return null;

    const payload = parseHighlightPayload(rawPayload);
    const searchTerms = extractSearchTermsFromPayload(payload);
    if (searchTerms.length === 0) {
        return highlightTextInPDF(payload.primary || payload.text || '');
    }

    document.querySelectorAll('.highlight-overlay').forEach(el => el.remove());
    syncOverlayFlagToWebview();

    const startPage = currentPage;
    const endPage = Math.min(currentPage + batchSize - 1, totalPages);
    let bestCandidate = null;

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
        try {
            const page = await pdfDoc.getPage(pageNum);
            const content = await page.getTextContent();
            const viewport = page.getViewport({ scale: scale });
            const matches = [];

            for (const item of content.items) {
                const itemNorm = normalizeSearchText(item.str || '');
                if (itemNorm.length < 2) continue;

                // Skip matches inside noise layout blocks (like creases, header/footer line decorations)
                const itemRect = getTextItemRect(item, viewport);
                const blocks = getPageLayoutBlocksAtScale(pageNum, scale);
                let isInsideValidBlock = false;
                if (blocks.length > 0) {
                    for (const block of blocks) {
                        if (block.kind !== 'noise' && getOverlapArea(itemRect, block) > 0) {
                            isInsideValidBlock = true;
                            break;
                        }
                    }
                } else {
                    isInsideValidBlock = true;
                }

                if (!isInsideValidBlock) continue;

                for (const term of searchTerms) {
                    if (!term.norm || term.norm.length < 2) continue;
                    const exact = itemNorm === term.norm;
                    let contained = itemNorm.includes(term.norm);
                    if (!contained && term.norm.includes(itemNorm) && itemNorm.length >= 3) {
                        const termWords = term.raw.toLowerCase().split(/[^a-z0-9\u0E00-\u0E7F]+/).map(w => normalizeSearchText(w)).filter(w => w.length >= 2);
                        if (termWords.includes(itemNorm)) {
                            contained = true;
                        }
                    }

                    if (exact || contained) {
                        matches.push({
                            rect: itemRect,
                            term,
                            exact
                        });
                        break;
                    }
                }
            }

            if (matches.length === 0) continue;

            const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
            const canvas = wrapper ? wrapper.querySelector('canvas') : null;
            const pageArea = canvas ? canvas.width * canvas.height : (viewport.width * viewport.height);

            const clusters = clusterMatches(matches);
            console.log(`[PDF] Page ${pageNum}: Found ${clusters.length} clusters from ${matches.length} matches`);

            // เลือกเฉพาะ cluster ที่ดีที่สุด
            for (const cluster of clusters) {
                const baseRegion = cluster.region;

                // คำนวณขอบเขตคอลัมน์
                const clusterCenterX = baseRegion.x + baseRegion.w / 2;
                const minColWidth = Math.max(300, Math.min(viewport.width * 0.45, 450));
                const maxColumnWidth = Math.max(baseRegion.w * 1.5, minColWidth);
                const columnLeft = Math.max(0, clusterCenterX - maxColumnWidth / 2);
                const columnRight = Math.min(viewport.width, clusterCenterX + maxColumnWidth / 2);

                // เริ่มจาก baseRegion แล้วขยายลงด้านล่างให้ครอบเนื้อหาบริบท
                let expandedRegion = {
                    x: baseRegion.x,
                    y: Math.max(0, baseRegion.y - 20),
                    w: baseRegion.w,
                    h: Math.min(viewport.height * 0.70, baseRegion.h + 300)
                };

                const blocks = getPageLayoutBlocksAtScale(pageNum, scale);
                if (blocks.length > 0) {
                    const canvasW = viewport.width;

                    for (const block of blocks) {
                        const gap = getRectGap(expandedRegion, block);  // วัด gap จาก expandedRegion ไม่ใช่ baseRegion
                        const blockCenter = getRectCenter(block);
                        const overlap = getOverlapArea(expandedRegion, block);

                        let shouldMerge = false;

                        if (block.kind === 'text') {
                            const inColumn = blockCenter.x >= columnLeft - 30 && blockCenter.x <= columnRight + 30;
                            // รวม text blocks ที่อยู่ใกล้หรือ overlap กับ expanded region
                            shouldMerge = inColumn && (overlap > 0 || (gap.y <= 80 && gap.x <= 80));

                        } else if (block.kind === 'image' || block.kind === 'mixed') {
                            // รูปภาพ: ให้ความสำคัญสูง — ขยาย gap ให้กว้างมาก
                            shouldMerge = overlap > 0 || (gap.y <= viewport.height * 0.35 && gap.x <= viewport.width * 0.30);

                        } else if (block.kind === 'caption') {
                            shouldMerge = overlap > 0 || (gap.y <= 100 && gap.x <= 120);
                        }

                        if (!shouldMerge) continue;

                        const candidate = createUnionRect([expandedRegion, block]);
                        if (!candidate) continue;

                        const f = (candidate.w * candidate.h) / pageArea;
                        const wFrac = candidate.w / canvasW;
                        if (f > 0.70 || wFrac > 0.85) continue;

                        expandedRegion = candidate;
                        console.log(`[PDF] ✅ Merged ${block.kind} gap=(${Math.round(gap.x)},${Math.round(gap.y)}) size=${Math.round(f * 100)}%`);
                    }
                }

                // padding รอบๆ
                const padX = 20;
                const padY = 16;
                const newX = Math.max(0, expandedRegion.x - padX);
                const newY = Math.max(0, expandedRegion.y - padY);
                const leftGain = expandedRegion.x - newX;
                expandedRegion = {
                    x: newX,
                    y: newY,
                    w: Math.min(viewport.width - newX, expandedRegion.w + leftGain + padX),
                    h: Math.min(viewport.height - newY, expandedRegion.h + padY * 2)
                };

                // วัดคุณภาพ
                const area = Math.max(1, expandedRegion.w * expandedRegion.h);
                const density = (cluster.weightedHits * 1200) / Math.sqrt(area);
                const uniqueTerms = cluster.termSet.size;
                const exactHits = cluster.matches.filter(m => m.exact).length;

                const regionFraction = area / Math.max(1, pageArea);
                const widthFraction = expandedRegion.w / Math.max(1, viewport.width);
                const crossColumnPenalty = widthFraction > 0.55 ? 200 : widthFraction > 0.45 ? 80 : 0;

                const areaPenalty = regionFraction > 0.55 ? 150 : regionFraction > 0.45 ? 80 : regionFraction > 0.35 ? 40 : 0;
                const articleLikeBonus = expandedRegion.h >= viewport.height * 0.22 ? 18 : 0;
                const score = (cluster.weightedHits * 14) + (uniqueTerms * 18) + (exactHits * 12) + density + articleLikeBonus - areaPenalty - crossColumnPenalty;

                console.log(`[PDF] Cluster: w=${Math.round(widthFraction * 100)}%, area=${Math.round(regionFraction * 100)}%, score=${Math.round(score)}, matches=${cluster.matches.length}`);

                if (!bestCandidate || score > bestCandidate.score) {
                    bestCandidate = {
                        pageNum,
                        region: expandedRegion,
                        score,
                        clusterCount: cluster.matches.length,
                        widthFraction
                    };
                }
            }
        } catch (e) {
            console.error('[PDF] Context highlight error on page ' + pageNum, e);
        }
    }

    if (!bestCandidate) {
        return highlightTextInPDF(payload.primary || searchTerms[0]?.raw || payload.text || '');
    }

    // ซูมไปยังพื้นที่ที่ตรวจพบ (Smart Zoom)
    let regionToDraw = { ...bestCandidate.region };

    // Get page viewport and canvas for validation/correction
    let viewport = null;
    try {
        const page = await pdfDoc.getPage(bestCandidate.pageNum);
        viewport = page.getViewport({ scale: scale });
    } catch (e) {
        console.error('[PDF] Failed to load page viewport for validation:', e);
    }

    const wrapper = document.getElementById(`page-wrapper-${bestCandidate.pageNum}`);
    const canvas = wrapper ? wrapper.querySelector('canvas') : null;

    const availableWidth = Math.max(340, pdfContainer.clientWidth * 0.72);
    const availableHeight = Math.max(300, window.innerHeight * 0.52);
    const zoomFactor = Math.min(availableWidth / regionToDraw.w, availableHeight / regionToDraw.h);

    // ซูมแบบ adaptive
    if (highlightContextRecursion < 1 && zoomFactor > 1.08) {
        const previousScale = scale;
        const desiredScale = Math.max(previousScale, Math.min(4, previousScale * Math.min(zoomFactor * 0.8, 1.28)));
        if (desiredScale > previousScale + 0.05) {
            highlightContextRecursion++;
            try {
                scale = desiredScale;
                zoomLevel.textContent = `${Math.round(scale * 100)}%`;
                await renderKeysPages();

                const ratio = scale / previousScale;
                regionToDraw = {
                    x: regionToDraw.x * ratio,
                    y: regionToDraw.y * ratio,
                    w: regionToDraw.w * ratio,
                    h: regionToDraw.h * ratio
                };
            } finally {
                highlightContextRecursion = Math.max(0, highlightContextRecursion - 1);
            }
        }
    }

    // วาดกรอบแดง 1 กรอบเดียว ครอบคลุมพื้นที่ทั้งหมด

    // ป้องกันกรอบแดงแคบเกินไป
    if (canvas) {
        if (regionToDraw.w < 150) {
            regionToDraw.x = Math.max(0, regionToDraw.x - (150 - regionToDraw.w) / 2);
            regionToDraw.w = 150;
        }
        if (regionToDraw.h < 120) {
            regionToDraw.y = Math.max(0, regionToDraw.y - (120 - regionToDraw.h) / 2);
            regionToDraw.h = Math.min(120, canvas.height - regionToDraw.y);
        }
        regionToDraw = clampRegionToCanvas(regionToDraw, canvas.width, canvas.height);
    }

    if (canvas) {
        const regionFraction = (regionToDraw.w * regionToDraw.h) / (canvas.width * canvas.height);
        const widthFraction = regionToDraw.w / canvas.width;

        // ปรับ Clamp เพื่อความปลอดภัย แต่ไม่ผลัก x ไปในทิศทางลบ
        if (regionFraction > 0.65 || widthFraction > 0.85) {
            console.warn(`[PDF] Highlight region too large, clamping bounds...`);
            const maxW = canvas.width * 0.80;
            const maxH = canvas.height * 0.80;
            const clampedW = Math.min(maxW, regionToDraw.w);
            const clampedH = Math.min(maxH, regionToDraw.h);
            // อย่าดัน x เข้ามา เพราะจะทำให้ฝั่งซ้ายขาด
            // เฉพาะให้แน่ใจว่าไม่เกินเขต boundary ด้านขวาหรือใต้
            regionToDraw = {
                x: Math.min(regionToDraw.x, canvas.width - clampedW),
                y: Math.min(regionToDraw.y, canvas.height - clampedH),
                w: clampedW,
                h: clampedH
            };
        }
    }

    // เก็บ region แม่นยำ (canvas coords) ไว้ใช้ตอน screenshot crop
    window.lastHighlightPageNum = bestCandidate.pageNum;
    window.lastHighlightRegion = { ...regionToDraw };
    window.lastFocusedRegion = {
        pageNum: bestCandidate.pageNum,
        region: { ...regionToDraw },
        viewportWidth: canvas.width,
        viewportHeight: canvas.height
    };

    const overlay = drawContextHighlight(bestCandidate.pageNum, regionToDraw);
    if (overlay) {
        requestAnimationFrame(function () {
            var w2 = document.getElementById('page-wrapper-' + bestCandidate.pageNum);
            if (w2) repositionOverlay(overlay, w2, regionToDraw);
            setTimeout(() => {
                try {
                    var w3 = document.getElementById('page-wrapper-' + bestCandidate.pageNum);
                    const container = document.getElementById('pdfContainer');
                    if (w3 && container) {
                        repositionOverlay(overlay, w3, regionToDraw);
                        const or = overlay.getBoundingClientRect();
                        const contR = container.getBoundingClientRect();
                        var targetScrollTop = container.scrollTop + (or.top + or.height / 2 - contR.top - contR.height / 2);
                        var targetScrollLeft = container.scrollLeft + (or.left + or.width / 2 - contR.left - contR.width / 2);
                        if (targetScrollLeft < 0 && (or.left + or.width / 2) < contR.left) {
                            targetScrollLeft = 0;
                        }
                        container.scrollTo({ top: Math.max(0, targetScrollTop), left: Math.max(0, targetScrollLeft), behavior: 'smooth' });
                        setTimeout(function () { if (w3) repositionOverlay(overlay, w3, regionToDraw); }, 300);
                    } else {
                        overlay.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                } catch (e) {
                    overlay.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 150);
        });
    }

    return {
        pageNum: bestCandidate.pageNum,
        region: regionToDraw
    };
}

async function highlightTextInPDF(keyword) {
    if (!pdfDoc || !keyword) return;

    // Clear existing
    document.querySelectorAll('.highlight-overlay').forEach(el => el.remove());
    syncOverlayFlagToWebview();

    console.log('[PDF] Highlighting Term:', keyword);

    // Smart Extract: If keyword is "Thai (English)", search for "English"
    let searchTarget = keyword;
    const engMatch = keyword.match(/\(([^)]+)\)/);
    if (engMatch) {
        searchTarget = engMatch[1];
    }

    const target = normalizeSearchText(searchTarget);
    if (target.length < 2) return;
    // Skip common English stopwords
    const STOPWORDS = new Set(['the', 'and', 'of', 'to', 'in', 'for', 'on', 'with', 'as', 'by', 'at', 'an', 'be', 'this', 'that', 'from', 'or', 'is', 'it', 'are', 'was', 'were', 'been', 'has', 'have', 'had', 'but', 'not', 'a']);
    if (STOPWORDS.has(target)) { console.log('[PDF] Skipping stopword:', target); return; }

    const endPage = Math.min(currentPage + batchSize - 1, totalPages);
    let scrolled = false;

    for (let i = currentPage; i <= endPage; i++) {
        try {
            const page = await pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            const viewport = page.getViewport({ scale: scale });

            for (let j = 0; j < textContent.items.length; j++) {
                const item = textContent.items[j];
                const itemStr = normalizeSearchText(item.str || '');

                if (itemStr.length >= 2 && itemStr.includes(target)) {
                    const tx = item.transform;
                    const x = tx[4];
                    const y = tx[5];
                    const w = item.width;
                    const h = item.height || Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);

                    const p1 = viewport.convertToViewportPoint(x, y + h);
                    const p2 = viewport.convertToViewportPoint(x + w, y);

                    const left = p1[0];
                    const top = p1[1];
                    const width = p2[0] - p1[0];
                    const height = p2[1] - p1[1];

                    const div = document.createElement('div');
                    div.className = 'highlight-overlay';
                    div.style.width = `${Math.abs(width) + 8}px`;
                    div.style.height = `${Math.abs(height) + 4}px`;

                    const wrapper = document.getElementById(`page-wrapper-${i}`);
                    if (wrapper) {
                        wrapper.appendChild(div);
                        requestAnimationFrame(function () {
                            repositionOverlay(div, wrapper, { x: left - 4, y: top - 2, w: Math.abs(width) + 8, h: Math.abs(height) + 4 });
                        });

                        if (!scrolled) {
                            scrolled = true;
                            setTimeout(() => {
                                div.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 50);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[PDF] Highlight error on page ' + i, e);
        }
    }
    syncOverlayFlagToWebview();
}

async function injectGeminiScript(targetWebview = geminiWebview) {
    if (!targetWebview) return;

    const script = `
    (function() {
        if (window.geminiScriptInjected) {
            console.log('Script already exists');
            return;
        }
        
        try {
            console.log('Injecting Gemini Helper with Focus Mode (V1 + Wacom)...');
            
            // Initialize Reading State
            window.readingComplete = true;
            window.__hasOverlay__ = true;
            
            if (!window.chrome) window.chrome = {};
            
            var lastMouseX = 0;
            var lastMouseY = 0;
            document.addEventListener('mousemove', function(e) {
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
            }, true);
            if (!window.chrome.runtime) window.chrome.runtime = { sendMessage: function(){}, onMessage: { addListener: function(){} } };
            
            function addFocusStyles() {
                if (document.getElementById('gemini-focus-styles')) return;
                const css = \`
                    .focus-response-container { position: relative; z-index: 1; }
                    .focus-response-container li { display: block; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); opacity: 0.88; filter: none; border-left: 3px solid transparent; padding: 10px 16px; margin-bottom: 10px; border-radius: 8px; font-family: inherit; font-size: 1rem; line-height: 1.8; color: #e2e8f0; }
                    .focus-response-container li.active-focus { opacity: 1; filter: none; transform: scale(1.01) translateX(4px); background: linear-gradient(145deg, #1e293b, #0f172a); border: 1px solid rgba(249, 115, 22, 0.35); list-style: none; color: #f8fafc !important; font-weight: 400; text-shadow: 0 1px 2px rgba(0,0,0,0.5); box-shadow: 0 4px 10px -1px rgba(0, 0, 0, 0.5), 0 0 14px rgba(249, 115, 22, 0.18); border-radius: 12px; z-index: 100; position: relative; }
                    .focus-response-container li .thai-keyword { color: #fb923c !important; font-weight: 700 !important; }
                    .focus-response-container li.active-focus .thai-keyword { color: #fdba74 !important; font-weight: 700 !important; background: rgba(251, 146, 60, 0.15) !important; padding: 1px 5px !important; border-radius: 4px !important; }
                    .focus-response-container li strong:not(.thai-keyword),
                    .focus-response-container li b:not(.thai-keyword) { color: inherit !important; background: transparent !important; }
                    .focus-response-container li.active-focus::marker { color: #fb923c !important; }
                    .active-focus .copy-btn-container { opacity: 1 !important; }
                    .focus-response-container li.active-focus .li-save-btn { opacity: 0.8 !important; }
                    .focus-response-container li .li-save-btn:hover { opacity: 1 !important; background: rgba(249,115,22,0.18) !important; border-color: rgba(249,115,22,0.5) !important; }
                    .focus-response-container li.tts-speaking-li { border-left: 3px solid #22c55e !important; background: rgba(34, 197, 94, 0.06) !important; }
                    .focus-response-container li .tts-ch-active { background: rgba(34, 197, 94, 0.4) !important; border-radius: 3px !important; color: #fff !important; text-shadow: 0 0 8px rgba(34,197,94,0.5) !important; }
                    .focus-response-container li .tts-ch { transition: background 0.15s ease, color 0.15s ease; }
                \`;
                const style = document.createElement('style');
                style.id = 'gemini-focus-styles';
                style.textContent = css;
                document.head.appendChild(style);
            }

            function tagThaiKeywords() {
                var R = /[ก-๙]/;
                document.querySelectorAll('message-content li, .model-response-text li, [data-test-id="model-response"] li').forEach(function(li) {
                    if (li._tk) return;
                    li._tk = true;
                    // 1. <strong>/<b> ที่มี "คำไทย (อังกฤษ)"
                    li.querySelectorAll('strong, b').forEach(function(b) {
                        var t = (b.innerText || '').trim();
                        if (t.length < 2) return;
                        var pi = t.indexOf('(');
                        if (pi > 0 && t.indexOf(')') > pi && R.test(t.substring(0, pi))) {
                            var thai = t.substring(0, pi).trim();
                            var eng = t.substring(pi);
                            b.innerHTML = '<span class="thai-keyword" style="color:#fb923c !important;font-weight:700 !important">' + thai + '</span> ' + eng;
                        } else if (R.test(t)) {
                            b.style.cssText = b.style.cssText + ';color:#fb923c !important;font-weight:700 !important';
                            b.classList.add('thai-keyword');
                        }
                    });
                    // 2. ข้อความธรรมดา "คำไทย (อังกฤษ)" ใช้ innerHTML replace
                    var html = li.innerHTML;
                    if (!html.includes('(') || !R.test(html)) return;
                    li.innerHTML = html.replace(/([\u0E00-\u0E7F][\u0E00-\u0E7F\s]*)\(([^)]+)\)/g, function(m, a, b) {
                        a = a.trim();
                        if (!R.test(a)) return m;
                        return '<span class="thai-keyword" style="color:#fb923c !important;font-weight:700 !important">' + a + '</span> (' + b + ')';
                    });
                });
            }

            function uniqueTerms(terms) {
                const seen = new Set();
                return terms.filter(function(term) {
                    const cleaned = (term || '').replace(/\s+/g, ' ').trim();
                    if (!cleaned) return false;
                    const key = cleaned.toLowerCase();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            }

            function buildHighlightPayload(el) {
                const rawText = (el && el.innerText ? el.innerText : '').replace(/\s+/g, ' ').trim();
                const keywords = [];
                el.querySelectorAll('strong, b').forEach(function(node) {
                    const text = node.innerText.trim();
                    if (text.length > 1) keywords.push(text);
                });
                // EnglishAnchor ในวงเล็บคือคำที่ต้องหาใน PDF จริง; ให้มาก่อนคำแปลไทย
                // เพื่อให้การจับภาพยึดตามความหมายของ <li> จาก Gemini ไม่ใช่คำทั่วไปในคำอธิบาย
                const anchors = [];
                const parens = rawText.match(/\(([^)]+)\)/g) || [];
                parens.forEach(function(part) {
                    part.replace(/[()]/g, '').split(',').forEach(function(term) {
                        term = term.trim();
                        if (/[A-Za-z]{2,}/.test(term)) anchors.push(term);
                    });
                });
                const finalKeywords = uniqueTerms(anchors.concat(keywords)).slice(0, 12);
                const primary = finalKeywords[0] || rawText;
                return { primary: primary, keywords: finalKeywords, text: rawText };
            }

            function triggerHighlight(el) {
                 if (!el) return;
                 var payload = buildHighlightPayload(el);
                 if (payload && payload.text && payload.text.length > 1) {
                     console.log('__HIGHLIGHT_NOW__:' + JSON.stringify(payload));
                 }
            }

            function setupFocusMode() {
                addFocusStyles();
                const responses = document.querySelectorAll('message-content, .model-response-text, [data-test-id="model-response"]');
                if (responses.length === 0) return;
                const container = responses[responses.length - 1];
                var items = Array.from(container.querySelectorAll('li')).filter(function(l) { return l.innerText.trim().length > 5; });
                if (container.dataset.focusInitialized !== 'true') {
                    if (items.length === 0) return;
                    container.dataset.focusInitialized = 'true';
                    container.classList.add('focus-response-container');
                    container.dataset.focusIndex = '0';
                    items[0].classList.add('active-focus');
                    triggerHighlight(items[0]);
                    setTimeout(function() { items[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
                    container.addEventListener('wheel', function(e) {
                        var currentItems = Array.from(container.querySelectorAll('li')).filter(function(l) { return l.innerText.trim().length > 5; });
                        if (currentItems.length === 0) return;
                        var idx = parseInt(container.dataset.focusIndex || '0');
                        if (e.deltaY > 0) {
                            if (idx < currentItems.length - 1) { e.preventDefault(); e.stopPropagation(); currentItems[idx].classList.remove('active-focus'); idx++; updateFocus(idx); }
                            else if (window.__ebookOfflineMode) { console.log('__OFFLINE_LAST_LI_WHEEL__'); }
                        }
                        else { if (idx > 0) { e.preventDefault(); e.stopPropagation(); currentItems[idx].classList.remove('active-focus'); idx--; updateFocus(idx); } }
                        function updateFocus(idx) { currentItems[idx].classList.add('active-focus'); currentItems[idx].scrollIntoView({ behavior: 'smooth', block: 'center' }); triggerHighlight(currentItems[idx]); container.dataset.focusIndex = idx.toString(); setTimeout(tagThaiKeywords, 50); speakLi(currentItems[idx]); }
                    }, { passive: false });
                } else if (items.length > 0) {
                    container.querySelectorAll('li').forEach(function(li) { attachSaveBtnToLi(li); });
                    var syncIdx = parseInt(container.dataset.focusIndex || '0');
                    if (syncIdx >= items.length) syncIdx = 0;
                    if (!items[syncIdx].classList.contains('active-focus')) {
                        items[syncIdx].classList.add('active-focus');
                        triggerHighlight(items[syncIdx]);
                    }
                }
            }

            function loadKaTeX() {
                if (document.getElementById('katex-css')) return;
                const link = document.createElement('link');
                link.id = 'katex-css';
                link.rel = 'stylesheet';
                link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
                document.head.appendChild(link);
            }

            function renderMath() {
                if (!window.katex || !window.renderMathInElement) return;
                document.querySelectorAll('message-content, .model-response-text, [data-test-id="model-response"]').forEach(el => {
                    try { window.renderMathInElement(el, { delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}], throwOnError: false }); } catch(e) { }
                });
            }

            function createNextPageBtn() {
                var nextBtn = document.createElement('button');
                nextBtn.className = 'gemini-next-page-btn';
                nextBtn.innerHTML = '<span>หน้าถัดไป &gt;</span>';
                nextBtn.style.cssText = 'cursor:pointer; background:#2563eb; color:#ffffff; border:none; border-radius:18px; padding:6px 16px; font-size:13px; font-weight:600; margin:4px; display:inline-flex; align-items:center; gap:6px; z-index:9999;';
                var autoTimer = null;
                var locked = false;
                function triggerNext() {
                    if (locked) return;
                    locked = true;
                    console.log('__NEXT_PAGE__');
                }
                nextBtn.onclick = function(e) { e.preventDefault(); e.stopPropagation(); triggerNext(); };
                nextBtn.addEventListener('mouseenter', function() {
                    if (locked) return;
                    autoTimer = setTimeout(function() { triggerNext(); }, 500);
                });
                nextBtn.addEventListener('mouseleave', function() {
                    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
                    locked = false;
                });
                return nextBtn;
            }

            function attachNextPageButton() {
                var messageActions = document.querySelectorAll('message-actions, [data-test-id="message-actions"], .message-actions, response-container-footer');
                messageActions.forEach(function(ma) {
                    if (ma.querySelector('.gemini-next-page-btn')) return;
                    ma.appendChild(createNextPageBtn());
                });
            }

            window.updateSaveButtons = function(hasOverlay) {
                window.__hasOverlay__ = !!hasOverlay;
                document.querySelectorAll('.li-save-btn').forEach(function(b) {
                    if (b.textContent !== '⌛' && !b.textContent.includes('✓')) {
                        b.textContent = window.__hasOverlay__ ? '💾🖼️' : '💾';
                    }
                });
            };

            function attachSaveBtnToLi(li) {
                if (li.querySelector('.li-save-btn')) return;
                var txt = (li.innerText || '').trim();
                if (txt.length < 5) return;
                if (li.closest('.user-prompt, .query-text, [data-test-id="user-prompt"], user-query, [data-message-author-role="user"]')) return;

                var btn = document.createElement('button');
                btn.className = 'li-save-btn';
                btn.textContent = window.__hasOverlay__ ? '💾🖼️' : '💾';
                btn.title = 'บันทึกลง Bigdata';
                btn.style.cssText = [
                    'display:inline-flex',
                    'align-items:center',
                    'cursor:pointer',
                    'background:rgba(255,255,255,0.08)',
                    'border:1px solid rgba(255,255,255,0.18)',
                    'color:#f8fafc',
                    'border-radius:6px',
                    'padding:2px 8px',
                    'font-size:13px',
                    'margin-left:10px',
                    'vertical-align:middle',
                    'opacity:0.25',
                    'transition:opacity 0.2s, transform 0.15s',
                    'flex-shrink:0',
                    'line-height:1.6',
                    'position:relative',
                    'top:-1px',
                ].join(';');

                var autoTimer = null;

                function moveToNextLi() {
                    var c = li.closest('message-content, .model-response-text, [data-test-id="model-response"]');
                    if (!c) { console.log('__OFFLINE_SEQUENCE_END__'); console.log('__NEXT_PAGE__'); return; }
                    var items = Array.from(c.querySelectorAll('li')).filter(function(li) { return li.innerText.trim().length > 5; });
                    var idx = items.indexOf(li);
                    if (idx === -1 || idx >= items.length - 1) {
                        console.log('__OFFLINE_SEQUENCE_END__');
                        console.log('__NEXT_PAGE__');
                        return;
                    }
                    var nextLi = items[idx + 1];
                    var nextBtn = nextLi.querySelector('.li-save-btn');
                    if (nextBtn) {
                        var rect = btn.getBoundingClientRect();
                        var isHovered = (lastMouseX >= rect.left && lastMouseX <= rect.right &&
                                         lastMouseY >= rect.top && lastMouseY <= rect.bottom);
                        if (isHovered) {
                            nextBtn._hoverLocked = true;
                            nextBtn._posLocked = true;
                            var unlockHandler = function(mEvt) {
                                if (mEvt.clientX < rect.left - 5 || mEvt.clientX > rect.right + 5 ||
                                    mEvt.clientY < rect.top - 5 || mEvt.clientY > rect.bottom + 5) {
                                    document.removeEventListener('mousemove', unlockHandler);
                                    nextBtn._posLocked = false;
                                    nextBtn._hoverLocked = false;
                                }
                            };
                            document.addEventListener('mousemove', unlockHandler);
                        }
                    }
                    items.forEach(function(item) { item.classList.remove('active-focus'); });
                    nextLi.classList.add('active-focus');
                    if (c.dataset.focusIndex !== undefined) c.dataset.focusIndex = (idx + 1).toString();
                    nextLi.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    if (typeof triggerHighlight === 'function') triggerHighlight(nextLi);
                    setTimeout(tagThaiKeywords, 50);
                    speakLi(nextLi);
                }

                btn.onmouseenter = function() {
                    if (btn.disabled) return;
                    // หลังบันทึก ระบบเลื่อน focus ไป <li> ถัดไปใต้เมาส์พอดี
                    // ต้องบังคับให้ผู้ใช้เลื่อนเมาส์ออกก่อน 1 ครั้ง จึงจะเริ่ม auto-save ได้
                    // ป้องกันการกด Save ของ <li> ถัดไปโดยไม่ตั้งใจ
                    if (btn._posLocked) {
                        btn.style.opacity = '0.7';
                        return;
                    }
                    if (btn._hoverLocked) return;
                    btn.style.opacity = '1';
                    btn.style.transform = 'scale(1.15)';
                    btn.textContent = window.__hasOverlay__ ? '💾🖼️' : '💾';
                    autoTimer = setTimeout(function() { btn.click(); }, 1800);
                };
                btn.onmouseleave = function() {
                    btn.style.transform = 'scale(1)';
                    if (btn._posLocked) {
                        // ปลดล็อกเฉพาะหลัง pointer ออกจริง จากนั้น hover รอบใหม่จึงกดได้
                        btn._posLocked = false;
                        btn._hoverLocked = false;
                    }
                    if (!btn.disabled) {
                        btn.style.opacity = '0.25';
                        btn.textContent = window.__hasOverlay__ ? '💾🖼️' : '💾';
                    }
                    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
                };
                btn.onclick = function(e) {
                    e.preventDefault();
                    e.stopPropagation();

                    var temp = li.cloneNode(true);
                    temp.querySelectorAll('.li-save-btn').forEach(function(c) { c.remove(); });
                    temp.querySelectorAll('strong, b').forEach(function(b) {
                        var k = b.innerText.trim();
                        if (k.length > 0) b.innerText = '**' + k + '**';
                    });
                    var saveText = temp.innerText.trim().replace(/\[Image:[^\]]*\]/g, '').trim();

                    if (window.__hasOverlay__) {
                        console.log('__SCREENSHOT_SAVE__:' + saveText);
                    } else {
                        console.log('__GITHUB_SAVE__:' + saveText);
                    }

                    btn.disabled = true;
                    btn.textContent = '⏳';
                    btn.style.opacity = '0.4';
                    setTimeout(function() {
                        btn.textContent = '✓';
                        btn.style.opacity = '0.5';
                        moveToNextLi();
                    }, 1200);
                };

                // Click on li text to speak
                li.addEventListener('click', function(e) {
                    if (e.target.closest('.li-save-btn, .copy-btn-container, button, a')) return;
                    var c = li.closest('message-content, .model-response-text, [data-test-id="model-response"]');
                    if (c) {
                        var items = Array.from(c.querySelectorAll('li')).filter(function(li) { return li.innerText.trim().length > 5; });
                        items.forEach(function(item) { item.classList.remove('active-focus'); });
                        li.classList.add('active-focus');
                        if (c.dataset.focusIndex !== undefined) c.dataset.focusIndex = items.indexOf(li).toString();
                        triggerHighlight(li);
                    }
                    speakLi(li);
                });

                // แทรกปุ่มต่อท้าย li โดยตรง (inline ไม่ break layout)
                li.appendChild(btn);

                // แสดงปุ่มเมื่อ li active
                li.addEventListener('mouseenter', function() { if (!btn.disabled) btn.style.opacity = '0.7'; });
                li.addEventListener('mouseleave', function() {
                    if (!btn.disabled) btn.style.opacity = li.classList.contains('active-focus') ? '0.7' : '0.25';
                });
            }

            // --- TTS (Thai, English and numbers; parenthesized annotations are skipped) ---
            var ttsState = { queue: [], speakingLi: null, utterance: null };

            function ttsStop() {
                if (window.__ttsStop) window.__ttsStop();
                console.log('__TTS_STOP_EDGE__');
                if (ttsState.speakingLi) {
                    var li = ttsState.speakingLi;
                    ttsRestoreText(li);
                    li.classList.remove('tts-speaking-li');
                }
                ttsState.speakingLi = null;
            }

            function ttsExtractThai(text) {
                // Gemini often puts English hints in parentheses; they are useful
                // visually but should not interrupt the spoken sentence.
                // This code is embedded in a template literal, so regex escapes
                // need a second backslash to reach the Gemini webview intact.
                var s = (text || '').replace(/\\([^)]*\\)/g, ' ');
                // Keep Thai, English, ASCII/Thai digits and speech-friendly marks.
                // Previously this kept only Thai, which also caused numbers to vanish.
                return s.replace(/[^\u0E00-\u0E7FA-Za-z0-9\u0E50-\u0E59\\s.,:;%/\\-+!?]/g, ' ')
                    .replace(/\\s+/g, ' ').trim();
            }

            function ttsSegmentAndWrap(li) {
                var walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, null, false);
                var textNodes = [];
                while (walker.nextNode()) { textNodes.push(walker.currentNode); }
                var charPos = 0;
                textNodes.forEach(function(node) {
                    var text = node.textContent;
                    var parent = node.parentNode;
                    var fragment = document.createDocumentFragment();
                    var i = 0;
                    while (i < text.length) {
                        var ch = text[i];
                        if (/[\u0E00-\u0E7F]/.test(ch)) {
                            var start = i;
                            while (i < text.length && /[\u0E00-\u0E7F]/.test(text[i])) { i++; }
                            var thaiRun = text.substring(start, i);
                            var g = 0;
                            while (g < thaiRun.length) {
                                var groupLen = Math.min(3, thaiRun.length - g);
                                var group = thaiRun.substring(g, g + groupLen);
                                var span = document.createElement('span');
                                span.className = 'tts-ch';
                                span.dataset.start = charPos.toString();
                                span.dataset.end = (charPos + group.length).toString();
                                span.textContent = group;
                                fragment.appendChild(span);
                                charPos += group.length;
                                g += groupLen;
                            }
                        } else {
                            fragment.appendChild(document.createTextNode(ch));
                            i++;
                        }
                    }
                    parent.replaceChild(fragment, node);
                });
            }

            function ttsRestoreText(li) {
                li.querySelectorAll('.tts-ch').forEach(function(span) {
                    var text = span.textContent;
                    span.parentNode.replaceChild(document.createTextNode(text), span);
                });
            }

            function ttsGetThaiVoice(cb) {
                var voices = window.speechSynthesis.getVoices();
                if (voices.length > 0) {
                    var match = voices.find(function(v) { return v.lang.startsWith('th') && /pattara|neural|natural/i.test(v.name); });
                    if (!match) match = voices.find(function(v) { return v.lang.startsWith('th'); });
                    cb(match || null);
                    return;
                }
                var called = false;
                function done(v) { if (!called) { called = true; cb(v || null); } }
                window.speechSynthesis.addEventListener('voiceschanged', function() {
                    var v2 = window.speechSynthesis.getVoices();
                    var match2 = v2.find(function(v) { return v.lang.startsWith('th') && /pattara|neural|natural/i.test(v.name); });
                    if (!match2) match2 = v2.find(function(v) { return v.lang.startsWith('th'); });
                    done(match2);
                }, { once: true });
                setTimeout(function() { done(null); }, 3000);
            }

            function ttsPrefetchNeighbors(li) {
                var container = li.closest('message-content, .model-response-text, [data-test-id="model-response"]');
                if (!container) return;
                var items = Array.from(container.querySelectorAll('li')).filter(function(l) { return l.innerText.trim().length > 5; });
                var idx = items.indexOf(li);
                if (idx < 0) return;
                for (var d = -2; d <= 2; d++) {
                    if (d === 0) continue;
                    var ni = idx + d;
                    if (ni >= 0 && ni < items.length) {
                        var t = ttsExtractThai(items[ni].innerText || '');
                        if (t) console.log('__TTS_CACHE__:' + t);
                    }
                }
            }

            function speakNatural(li) {
                if (window.__ebookOfflineMode) return;
                var fullText = li.innerText || '';
                var thaiText = ttsExtractThai(fullText);
                if (!thaiText) return;
                ttsState.speakingLi = li;
                li.classList.add('tts-speaking-li');
                ttsSegmentAndWrap(li);
                console.log('__TTS_EDGE__:' + thaiText);
                ttsPrefetchNeighbors(li);
                window.__ttsStart = function(duration) {
                    window.__ttsChars = Array.from(document.querySelectorAll('.tts-ch'));
                    window.__ttsStartTime = Date.now();
                    window.__ttsDuration = duration;
                    function tick() {
                        var elapsed = (Date.now() - window.__ttsStartTime) / 1000;
                        var ratio = Math.min(elapsed / window.__ttsDuration, 1);
                        var idx = Math.floor(ratio * window.__ttsChars.length);
                        document.querySelectorAll('.tts-ch-active').forEach(function(s) { s.classList.remove('tts-ch-active'); });
                        if (idx >= 0 && idx < window.__ttsChars.length) {
                            window.__ttsChars[idx].classList.add('tts-ch-active');
                        }
                        if (ratio < 1) {
                            window.__ttsTimer = setTimeout(tick, 50);
                        }
                    }
                    tick();
                };
                window.__ttsStop = function() {
                    if (window.__ttsTimer) { clearTimeout(window.__ttsTimer); window.__ttsTimer = null; }
                    window.__ttsChars = [];
                    document.querySelectorAll('.tts-ch-active').forEach(function(s) { s.classList.remove('tts-ch-active'); });
                };
            }

            function speakLi(li, waitForReady) {
                ttsStop();
                if (window.__ebookOfflineMode) return;
                if (!li) return;
                if (waitForReady && window.lastStatus !== 'DONE') {
                    var retries = 0;
                    var timer = setInterval(function() {
                        retries++;
                        if (window.lastStatus === 'DONE' || retries >= 60) {
                            clearInterval(timer);
                            speakNatural(li);
                        }
                    }, 500);
                    return;
                }
                speakNatural(li);
            }
            // Public bridge for controls in the PDF pane.
            window.__ebookTtsStop = ttsStop;
            window.__ebookPdfCommand = function(command) {
                var container = document.querySelector('message-content.focus-response-container, .model-response-text.focus-response-container, [data-test-id="model-response"].focus-response-container');
                if (!container) { setupFocusMode(); container = document.querySelector('.focus-response-container'); }
                if (!container) return;
                var items = Array.from(container.querySelectorAll('li')).filter(function(li) { return li.innerText.trim().length > 5; });
                if (!items.length) return;
                var idx = parseInt(container.dataset.focusIndex || '0');
                if (idx < 0 || idx >= items.length) idx = Math.max(0, items.findIndex(function(li) { return li.classList.contains('active-focus'); }));
                if (command === 'save') {
                    var saveBtn = items[idx].querySelector('.li-save-btn');
                    if (saveBtn && !saveBtn.disabled) saveBtn.click();
                    return;
                }
                var nextIdx = command === 'next' ? idx + 1 : idx - 1;
                if (nextIdx >= items.length) { console.log('__OFFLINE_SEQUENCE_END__'); console.log('__NEXT_PAGE__'); return; }
                if (nextIdx < 0) return;
                items[idx].classList.remove('active-focus');
                items[nextIdx].classList.add('active-focus');
                container.dataset.focusIndex = nextIdx.toString();
                items[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
                triggerHighlight(items[nextIdx]);
                setTimeout(tagThaiKeywords, 50);
                speakLi(items[nextIdx]);
            };
            // --- end TTS ---

            function attach() {
                loadKaTeX();
                renderMath();
                setupFocusMode();
                tagThaiKeywords();
                attachNextPageButton();

                // ติดปุ่ม Save กับทุก <li> ใน model response
                var responses = document.querySelectorAll('message-content, .model-response-text, [data-test-id="model-response"]');
                responses.forEach(function(resp) {
                    resp.querySelectorAll('li').forEach(function(li) {
                        attachSaveBtnToLi(li);
                    });
                });
            }

            window.clickSend = function() { 
                try {
                    // Helper: รวมข้อความจากปุ่มทุกแหล่งที่เป็นไปได้
                    function getBtnText(btn) {
                        var label = (btn.getAttribute('aria-label') || '').toLowerCase();
                        var tooltip = (btn.getAttribute('mattooltip') || '').toLowerCase();
                        var title = (btn.getAttribute('title') || '').toLowerCase();
                        var tid = (btn.getAttribute('data-testid') || '').toLowerCase();
                        var inner = (btn.innerText || btn.textContent || '').toLowerCase().trim();
                        var cls = (btn.className || '').toLowerCase();
                        var icons = '';
                        btn.querySelectorAll('mat-icon, i, span[class*="icon"], svg, img, lumo-icon, iconify-icon').forEach(function(ic) {
                            icons += ' ' + (ic.getAttribute('fonticon') || ic.getAttribute('data-mat-icon-name') || 
                                ic.getAttribute('icon') || ic.getAttribute('name') || ic.textContent || '').toLowerCase();
                            if (ic.tagName === 'SVG') {
                                var svgTitle = ic.querySelector('title');
                                if (svgTitle) icons += ' ' + (svgTitle.textContent || '').toLowerCase();
                                icons += ' ' + (ic.getAttribute('id') || '').toLowerCase();
                            }
                        });
                        return label + ' ' + tooltip + ' ' + title + ' ' + tid + ' ' + inner + ' ' + cls + ' ' + icons;
                    }

                    var EXCLUDE = ['mic', 'พูด', 'เสียง', 'บันทึก', 'menu', 'เมนู', 'sidebar',
                                   'แถบ', 'upload', 'file', 'ไฟล์', 'อัปโหลด', 'camera', 'กล้อง',
                                   'more', 'เพิ่มเติม', 'setting', 'ตั้งค่า', 'help', 'notebook',
                                   'expand', 'collapse', 'ย่อ', 'ขยาย', 'sticker', 'สติกเกอร์',
                                   'gif', 'emoji', 'attachment', 'แนบ', 'image', 'รูป'];

                    function isSendText(text) {
                        return text.includes('send') || text.includes('ส่ง');
                    }

                    function isNavText(text) {
                        return EXCLUDE.some(function(w) { return text.includes(w); });
                    }

                    var editor = document.querySelector('[contenteditable="true"], rich-textarea p, textarea');
                    if (!editor) return "WAITING";

                    // Strategy 1: ใช้ selector ตรงๆ หา send button (รวม disabled)
                    var directBtn = document.querySelector(
                        'button[aria-label="Send message"], button[aria-label="ส่งข้อความ"], ' +
                        'button[data-testid="send-button"], button[jsname="Qx7uuf"], ' +
                        'button.send-button, ' +
                        'button[class*="send"], button[class*="submit"], ' +
                        'button[aria-label*="send" i], button[aria-label*="ส่ง" i]'
                    );
                    if (directBtn) {
                        if (!directBtn.disabled) { console.log('clickSend: direct click', directBtn.ariaLabel || directBtn.className); directBtn.click(); return "CLICKED"; }
                        console.log('clickSend: direct btn found but DISABLED', getBtnText(directBtn).slice(0,60));
                        return "WAITING"; // ปิดใช้งานอยู่ รอรอบหน้า
                    }

                    // Strategy 2: traverse หา input container
                    var searchRoot = editor;
                    for (var level = 0; level < 6; level++) {
                        searchRoot = searchRoot.parentElement;
                        if (!searchRoot) break;
                        var tag = (searchRoot.tagName || '').toLowerCase();
                        if (tag === 'form' || tag === 'footer' || 
                            (searchRoot.className && (
                                searchRoot.className.includes('input') || 
                                searchRoot.className.includes('compose') ||
                                searchRoot.className.includes('bottom')
                            ))) {
                            break;
                        }
                    }
                    if (!searchRoot) return "WAITING";

                    // Strategy 3: หาจากทุกปุ่มใน container (รวม disabled)
                    var allBtns = searchRoot.querySelectorAll('button');
                    var bestBtn = null;
                    var bestScore = -999;
                    for (var i = 0; i < allBtns.length; i++) {
                        var btn = allBtns[i];
                        var text = getBtnText(btn);
                        if (isNavText(text)) continue;
                        var score = 0;
                        if (isSendText(text)) score += 100;
                        if (!btn.disabled) score += 50;
                        // Prefer buttons closer to the end of the input (usually where send button is)
                        score += (i / allBtns.length) * 30;
                        if (score > bestScore) {
                            bestScore = score;
                            bestBtn = btn;
                        }
                    }
                    if (bestBtn) {
                        var bestText = getBtnText(bestBtn).slice(0,80);
                        console.log('clickSend: best score=' + bestScore, bestText, 'disabled=' + bestBtn.disabled);
                        if (!bestBtn.disabled) { console.log('clickSend: CLICKED'); bestBtn.click(); return "CLICKED"; }
                        console.log('clickSend: bestBtn is DISABLED, returning WAITING');
                        return "WAITING"; // send button ยัง disabled (กำลังประมวลผล)
                    }

                    // Strategy 4: fallback — traverse ขึ้นไปทีละระดับ
                    var closestParent = editor.parentElement;
                    for (var p = 0; p < 4 && closestParent; p++) {
                        var siblingBtns = closestParent.querySelectorAll('button');
                        if (siblingBtns.length === 0) { closestParent = closestParent.parentElement; continue; }
                        if (siblingBtns.length <= 8) {
                            var foundReady = null;
                            var foundDisabled = null;
                            for (var b = 0; b < siblingBtns.length; b++) {
                                var sb = siblingBtns[b];
                                var sText = getBtnText(sb);
                                if (isNavText(sText)) continue;
                                if (!sb.disabled && !foundReady) foundReady = sb;
                                if (sb.disabled && !foundDisabled) foundDisabled = sb;
                            }
                            if (foundReady) { foundReady.click(); return "CLICKED"; }
                            if (foundDisabled) return "WAITING"; // มีปุ่มแต่ disabled
                        }
                        closestParent = closestParent.parentElement;
                    }

                    return "WAITING";
                } catch(e) { return "ERROR"; } 
            };

            window.prepareInput = function() {
                try {
                    var i = document.querySelector('[contenteditable="true"], textarea, rich-textarea p');
                    if (i) {
                        i.focus();
                        i.innerText = '';
                        return "READY";
                    }
                    return "NOT_FOUND";
                } catch(e) {
                    return "ERROR";
                }
            };

            window.startNewChat = function() {
                try {
                    // พยายามหา new chat button หลายวิธี (ห้ามใช้ a[href="/app"] เพราะตรงกับโลโก้)
                    var candidates = [
                        '[data-test-id="new-chat-button"]',
                        '[data-test-id="new-conversation-button"]',
                        'button[aria-label="New chat"]',
                        'button[aria-label="เริ่มแชทใหม่"]',
                        'a[aria-label="New chat"]',
                        'a[aria-label="เริ่มแชทใหม่"]',
                        // sidebar button with text containing "new chat"
                        'nav button, nav a, [role="navigation"] button, [role="navigation"] a, ' +
                        '[class*="sidebar"] button, [class*="sidebar"] a'
                    ];
                    for (var c = 0; c < candidates.length; c++) {
                        var els;
                        try { els = document.querySelectorAll(candidates[c]); } catch(e) { continue; }
                        for (var e = 0; e < els.length; e++) {
                            var txt = (els[e].textContent || '').toLowerCase();
                            if (txt.includes('new chat') || txt.includes('เริ่มแชท') || txt.includes('new conversation')) {
                                console.log('startNewChat: clicked by text', candidates[c], els[e].tagName, txt.slice(0,30));
                                els[e].click(); return "CLICKED";
                            }
                            // check icon
                            var icon = els[e].querySelector('mat-icon[fonticon], mat-icon[data-mat-icon-name]');
                            if (icon) {
                                var iname = (icon.getAttribute('fonticon') || icon.getAttribute('data-mat-icon-name') || '').toLowerCase();
                                if (iname === 'add' || iname === 'plus' || iname === 'edit_note' || iname === 'mode_edit') {
                                    console.log('startNewChat: clicked by icon', candidates[c], iname, els[e].tagName);
                                    els[e].click(); return "CLICKED";
                                }
                            }
                        }
                    }
                    return "NOT_FOUND";
                } catch(e) { return "ERROR:" + e.message; }
            };

            function isElementVisible(el) {
                if (!el) return false;
                var style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
            }

            function checkStatus() {
               try {
                  var temp = document.querySelector('.stop-button, [aria-label*="Stop"], [aria-label*="หยุด"], [data-testid*="stop"], button[class*="stop"]');
                  var animating = document.querySelector('lottie-player, .generating-indicator, [class*="loading-indicator"], .loading-dots, div[class*="lottie"], div[class*="loading"]');
                  
                  var isBusy = false;
                  if (temp && isElementVisible(temp)) {
                      isBusy = true;
                  } else if (animating && isElementVisible(animating)) {
                      isBusy = true;
                  }
                  
                   if(isBusy) { 
                       if(window.lastStatus !== 'BUSY') { 
                           console.log('Gemini status: BUSY'); 
                           window.lastStatus = 'BUSY'; 
                           window.nextPageTriggered = false;
                           autoReadDone = false;
                       }
                  } 
                   else { 
                       if(window.lastStatus !== 'DONE') { 
                           console.log('__GEMINI_DONE__'); 
                           window.lastStatus = 'DONE'; 
                           autoReadFirstLi();
                       } 
                   }
               } catch(e){}
            }

            function handleScroll() {
                // Natural scroll only. Page advancement is handled exclusively by the Next Page button.
            }

            var autoReadDone = false;
            var autoReadRetries = 0;
            function autoReadFirstLi() {
                if (autoReadDone) return;
                var resp = document.querySelectorAll('message-content, .model-response-text, [data-test-id="model-response"]');
                if (resp.length === 0) return;
                var c = resp[resp.length - 1];
                var items = Array.from(c.querySelectorAll('li')).filter(function(l) { return l.innerText.trim().length > 5; });
                if (items.length === 0) { if (autoReadRetries < 20) { autoReadRetries++; setTimeout(autoReadFirstLi, 300); } return; }
                autoReadDone = true;
                autoReadRetries = 0;
                if (window.lastStatus !== 'DONE') { setTimeout(autoReadFirstLi, 500); return; }
                items[0].classList.add('active-focus');
                triggerHighlight(items[0]);
                setTimeout(function() { items[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
                setTimeout(function() { speakLi(items[0]); }, 300);
            }

            // Init
            window.addEventListener('scroll', handleScroll, true);
            setInterval(checkStatus, 500);

            // MutationObserver: observe document.body เพื่อจับ response container ใหม่
            // แล้ว observe เฉพาะ container นั้นสำหรับ li ที่ stream เข้ามา
            var observedContainers = new WeakSet();
            var liDebounce = null;

            function onNewLi(li) {
                // tagThaiKeywords BEFORE attachSaveBtnToLi because part 2 replaces innerHTML
                // which would destroy the save button if already attached
                tagThaiKeywords();
                if (!li.querySelector('.li-save-btn')) {
                    attachSaveBtnToLi(li);
                }
            }

            function observeResponseContainer(container) {
                if (observedContainers.has(container)) return;
                observedContainers.add(container);

                // attach ปุ่มให้ li ที่มีอยู่แล้ว
                container.querySelectorAll('li').forEach(onNewLi);

                // Re-tag keywords after framework re-render (observe both structure and text changes)
                var rerenderTimer = null;
                var contentWatcher = new MutationObserver(function(mutations) {
                    var hasLiChange = false;
                    for (var i = 0; i < mutations.length; i++) {
                        var m = mutations[i];
                        m.addedNodes.forEach(function(node) {
                            if (node.nodeType !== 1) return;
                            if (node.tagName === 'LI') {
                                onNewLi(node);
                            } else {
                                node.querySelectorAll && node.querySelectorAll('li').forEach(onNewLi);
                            }
                        });
                        if (m.type === 'childList') hasLiChange = true;
                    }
                    // Debounced full re-scan for any li that lost keyword styling
                    // This handles framework re-renders that replace the entire li element
                    if (rerenderTimer) clearTimeout(rerenderTimer);
                    rerenderTimer = setTimeout(function() {
                        container.querySelectorAll('li').forEach(function(li) {
                            // Re-process if: no keyword spans AND either never processed OR has Thai text
                            if (!li.querySelector('.thai-keyword')) {
                                var hasThai = /[\u0E00-\u0E7F]/.test(li.textContent || '');
                                if (!li._tk || hasThai) {
                                    li._tk = false;
                                    onNewLi(li);
                                }
                            }
                        });
                    }, hasLiChange ? 200 : 800);
                });
                contentWatcher.observe(container, { childList: true, subtree: true, characterData: true });
            }

            // observe body เพื่อจับ response container ใหม่
            var bodyObserver = new MutationObserver(function(mutations) {
                var responses = document.querySelectorAll('message-content, .model-response-text, [data-test-id="model-response"]');
                responses.forEach(function(resp) {
                    observeResponseContainer(resp);
                });
                // setup focus mode และ next page btn เมื่อมี response ใหม่
                if (liDebounce) clearTimeout(liDebounce);
                liDebounce = setTimeout(function() {
                    liDebounce = null;
                    setupFocusMode();
                    tagThaiKeywords();
                    attachNextPageButton();
                    loadKaTeX();
                }, 600);
            });

            bodyObserver.observe(document.body, { childList: true, subtree: true });

            // attach ครั้งแรกตอน inject
            setTimeout(attach, 800);

            window.geminiScriptInjected = true;
            console.log('Gemini Helper Injected (V1+Wacom)');
            return "INJECTED";
        } catch(e) {
            console.error('Injection Logic Error:', e);
            return "INJECTION_LOGIC_ERROR";
        }
    })();`;

    try {
        const res = await targetWebview.executeJavaScript(script);
        console.log('Injection Result:', res);

        if (targetWebview === geminiWebview && window.pendingResetPrompt) {
            window.pendingResetPrompt = false;
            console.log('[Reset] Helper injected successfully. Starting summary prompt for current page.');
            showToast('กำลังเริ่มสรุปใหม่...', 'info');
            extractTextBatch(currentPage, Math.min(currentPage + batchSize - 1, totalPages));
        }
    } catch (e) {
        console.error('Injection failed (executeJavaScript):', e);
    }
}

// File Logic
async function openFile() {
    const result = await window.electronAPI.openFileDialog();
    if (result) {
        // ตรวจสอบว่าเป็นไฟล์ .epub หรือไม่
        if (result.name && result.name.toLowerCase().endsWith('.epub')) {
            await openEPUB(result);
        } else {
            await loadPDF(result);
        }
    }
}

async function openEPUB(fileData) {
    showToast('กำลังแปลง EPUB เป็น PDF...', 'info');
    const result = await window.electronAPI.convertEpub(fileData.path);
    if (!result || result.error) {
        showToast(result ? `แปลง EPUB ไม่สำเร็จ: ${result.error}` : 'แปลง EPUB ไม่สำเร็จ', 'error');
        return;
    }
    showToast('แปลง EPUB เสร็จแล้ว กำลังเปิดไฟล์...', 'success');
    // โหลด PDF ที่แปลงแล้ว
    const pdfFileData = await window.electronAPI.openFileDirect(result.path);
    if (pdfFileData) {
        await loadPDF(pdfFileData);
    } else {
        showToast('ไม่สามารถเปิดไฟล์ PDF ที่แปลงแล้ว', 'error');
    }
}

async function loadPDF(fileData) {
    try {
        currentFilePath = fileData.path;
        currentFileName = fileData.name;
        restoreOfflineModeForCurrentDocument();
        fileName.textContent = currentFileName;
        pageTextMap = {}; // ล้างข้อความเก่า

        const pdfData = atob(fileData.data);
        const pdfArray = new Uint8Array(pdfData.length);
        for (let i = 0; i < pdfData.length; i++) pdfArray[i] = pdfData.charCodeAt(i);

        const loadingTask = pdfjsLib.getDocument({ data: pdfArray });
        pdfDoc = await loadingTask.promise;
        totalPages = pdfDoc.numPages;
        totalPagesSpan.textContent = totalPages;
        pageInput.max = totalPages;

        // Start every document one page at a time; saved progress may restore a user choice below.
        batchSize = 1;
        if (batchSizeInput) batchSizeInput.value = batchSize;
        showToast(`ตั้งค่าสรุปทีละ ${batchSize} หน้า`, 'info');

        const savedProgress = await window.electronAPI.loadProgress(currentFilePath);
        currentPage = savedProgress ? savedProgress.currentPage : 1;
        if (savedProgress && savedProgress.batchSize) {
            batchSize = savedProgress.batchSize;
            if (batchSizeInput) batchSizeInput.value = batchSize;
        }

        welcomeScreen.style.display = 'none';
        pdfContainer.style.display = 'flex';
        progressBar.style.display = 'flex';
        hideLibrary();

        await fitToPage();
        updateNavigation();
        extractTextBatch(currentPage, Math.min(currentPage + batchSize - 1, totalPages));
    } catch (e) {
        showToast('เปิด PDF ไม่สำเร็จ', 'error');
    }
}

async function loadPDFFromFile(file) {
    try {
        currentFileName = file.name;
        currentFilePath = file.path || file.name;
        restoreOfflineModeForCurrentDocument();
        fileName.textContent = currentFileName;
        pageTextMap = {}; // ล้างข้อความเก่า

        // Handle EPUB via drag & drop
        if (file.name && file.name.toLowerCase().endsWith('.epub')) {
            showToast('กำลังแปลง EPUB เป็น PDF...', 'info');
            const result = await window.electronAPI.convertEpub(file.path || file.name);
            if (!result || result.error) {
                showToast(result ? `แปลง EPUB ไม่สำเร็จ: ${result.error}` : 'แปลง EPUB ไม่สำเร็จ', 'error');
                return;
            }
            showToast('แปลง EPUB เสร็จแล้ว กำลังเปิดไฟล์...', 'success');
            const pdfFileData = await window.electronAPI.openFileDirect(result.path);
            if (pdfFileData) {
                await loadPDF(pdfFileData);
            } else {
                showToast('ไม่สามารถเปิดไฟล์ PDF ที่แปลงแล้ว', 'error');
            }
            return;
        }

        const arrayBuffer = await file.arrayBuffer();
        const pdfArray = new Uint8Array(arrayBuffer);
        const loadingTask = pdfjsLib.getDocument({ data: pdfArray });
        pdfDoc = await loadingTask.promise;
        totalPages = pdfDoc.numPages;
        totalPagesSpan.textContent = totalPages;
        pageInput.max = totalPages;

        batchSize = 1;
        if (batchSizeInput) batchSizeInput.value = batchSize;
        showToast(`ตั้งค่าสรุปทีละ ${batchSize} หน้า`, 'info');

        const savedProgress = await window.electronAPI.loadProgress(currentFilePath);
        currentPage = savedProgress ? savedProgress.currentPage : 1;
        if (savedProgress && savedProgress.batchSize) {
            batchSize = savedProgress.batchSize;
            if (batchSizeInput) batchSizeInput.value = batchSize;
        }

        welcomeScreen.style.display = 'none';
        readingHistory.style.display = 'none'; // Explicitly hide history just in case
        pdfContainer.style.display = 'flex';
        progressBar.style.display = 'flex';

        hideLibrary();

        await fitToPage();
        updateNavigation();
        extractTextBatch(currentPage, Math.min(currentPage + batchSize - 1, totalPages));
    } catch (e) {
        showToast('เปิด PDF ไม่สำเร็จ', 'error');
    }
}

// --- Layout Analysis: detect text/illustration blocks from rendered PDF canvas ---
let pageLayoutBlocks = {};

async function analyzePageLayout(canvas, page, pageNum) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width, h = canvas.height;
    if (w === 0 || h === 0) return;
    const pageArea = w * h;

    let imageData;
    try {
        imageData = ctx.getImageData(0, 0, w, h);
    } catch (e) {
        return;
    }
    const data = imageData.data;
    const blocks = [];

    // Scan in a coarse grid (every 4th pixel for speed)
    const step = 4;
    const threshold = 30; // luminance diff from background
    const gridW = Math.ceil(w / step);
    const gridH = Math.ceil(h / step);
    const grid = new Uint8Array(gridW * gridH);

    // Dynamic background detection by sampling a grid of pixels to find the most frequent color
    const sampleCols = 15;
    const sampleRows = 15;
    const bins = {};
    let maxBinKey = null;
    let maxBinCount = 0;

    for (let row = 0; row < sampleRows; row++) {
        for (let col = 0; col < sampleCols; col++) {
            const px = Math.floor((col + 0.5) * (w / sampleCols));
            const py = Math.floor((row + 0.5) * (h / sampleRows));
            if (px >= 0 && px < w && py >= 0 && py < h) {
                const idx = (py * w + px) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                
                // Quantize to bins of size 32
                const qR = Math.floor(r / 32);
                const qG = Math.floor(g / 32);
                const qB = Math.floor(b / 32);
                const key = `${qR},${qG},${qB}`;
                
                if (!bins[key]) {
                    bins[key] = { count: 0, rSum: 0, gSum: 0, bSum: 0 };
                }
                bins[key].count++;
                bins[key].rSum += r;
                bins[key].gSum += g;
                bins[key].bSum += b;
                
                if (bins[key].count > maxBinCount) {
                    maxBinCount = bins[key].count;
                    maxBinKey = key;
                }
            }
        }
    }

    let bgR = 255, bgG = 255, bgB = 255;
    if (maxBinKey) {
        const bin = bins[maxBinKey];
        bgR = Math.round(bin.rSum / bin.count);
        bgG = Math.round(bin.gSum / bin.count);
        bgB = Math.round(bin.bSum / bin.count);
    }

    for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
            const px = gx * step;
            const py = gy * step;
            // Ignore outer 5% of page margins to prevent edge/spine scan shadows
            const isEdge = (px < w * 0.05) || (px > w * 0.95) || (py < h * 0.05) || (py > h * 0.95);
            let isContent = false;
            if (!isEdge) {
                const idx = (py * w + px) * 4;
                const r = data[idx], g = data[idx + 1], b = data[idx + 2];
                // non-background pixel?
                isContent = (Math.abs(r - bgR) > threshold) ||
                    (Math.abs(g - bgG) > threshold) ||
                    (Math.abs(b - bgB) > threshold);
            }
            grid[gy * gridW + gx] = isContent ? 1 : 0;
        }
    }

    // Perform dilation on the grid to connect nearby thin lines and bridge small gaps
    const dilatedGrid = new Uint8Array(gridW * gridH);
    for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
            const gi = gy * gridW + gx;
            if (grid[gi]) {
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        const nx = gx + dx;
                        const ny = gy + dy;
                        if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
                            dilatedGrid[ny * gridW + nx] = 1;
                        }
                    }
                }
            }
        }
    }

    // Find connected components (simple flood-fill on the dilated grid)
    const visited = new Uint8Array(gridW * gridH);
    for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
            const gi = gy * gridW + gx;
            if (!dilatedGrid[gi] || visited[gi]) continue;
            // BFS
            const stack = [[gx, gy]];
            visited[gi] = 1;
            let minX = gx, minY = gy, maxX = gx, maxY = gy;
            while (stack.length) {
                const [cx, cy] = stack.pop();
                minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
                minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = cx + dx, ny = cy + dy;
                        if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
                        const ni = ny * gridW + nx;
                        if (dilatedGrid[ni] && !visited[ni]) {
                            visited[ni] = 1;
                            stack.push([nx, ny]);
                        }
                    }
                }
            }
            // Convert grid coords back to canvas coords with margin
            const pad = 8;
            const block = {
                x: Math.max(0, minX * step - pad),
                y: Math.max(0, minY * step - pad),
                w: Math.min(w, (maxX - minX + 1) * step + pad * 2),
                h: Math.min(h, (maxY - minY + 1) * step + pad * 2)
            };
            // Filter tiny noise
            if (block.w * block.h > 500) {
                blocks.push(block);
            }
        }
    }

    // Merge overlapping blocks
    let merged = true;
    while (merged) {
        merged = false;
        for (let i = 0; i < blocks.length; i++) {
            for (let j = i + 1; j < blocks.length; j++) {
                const a = blocks[i], b = blocks[j];
                const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
                const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
                const overlapArea = overlapX * overlapY;
                const minArea = Math.min(a.w * a.h, b.w * b.h);
                if (overlapArea > 0 || (
                    // adjacent vertically (same column)
                    Math.abs(a.x - b.x) < 50 &&
                    (a.y + a.h >= b.y - 20 && b.y + b.h >= a.y - 20)
                )) {
                    blocks[i] = {
                        x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
                        w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
                        h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y)
                    };
                    blocks.splice(j, 1);
                    merged = true;
                    break;
                }
            }
            if (merged) break;
        }
    }

    // Fetch text rects once before merging
    let textRects = [];
    const viewportAtScale1 = page.getViewport({ scale: 1 });
    const canvasScale = w / (viewportAtScale1.width || w);
    try {
        const viewport = page.getViewport({ scale: canvasScale });
        const textContent = await page.getTextContent();
        textRects = textContent.items.map(item => {
            const rect = getTextItemRect(item, viewport);
            const tx = item.transform || [1, 0, 0, 1, 0, 0];
            const fontSize = item.height || Math.sqrt((tx[0] || 0) * (tx[0] || 0) + (tx[1] || 0) * (tx[1] || 0)) || 0;
            return { ...rect, fontSize, str: item.str || '' };
        });
    } catch (e) {
        console.error('[PDF] Failed to pre-fetch text rects for layout analysis:', e);
    }

    // Post-merge pass for vertically aligned image/mixed blocks to merge split illustrations
    let imgMerged = true;
    while (imgMerged) {
        imgMerged = false;
        try {
            // Classify blocks locally to identify text blocks
            const blockKinds = blocks.map(block => {
                let overlapArea = 0;
                let textItemCount = 0;
                for (const textRect of textRects) {
                    const overlap = getOverlapArea(block, textRect);
                    if (overlap > 0) {
                        overlapArea += Math.min(overlap, textRect.w * textRect.h);
                        textItemCount++;
                    }
                }
                const blockArea = Math.max(1, block.w * block.h);
                const textCoverage = overlapArea / blockArea;
                const isText = textCoverage >= 0.12 || textItemCount >= 6;
                return { isText };
            });

            for (let i = 0; i < blocks.length; i++) {
                for (let j = i + 1; j < blocks.length; j++) {
                    const a = blocks[i], b = blocks[j];
                    const infoA = blockKinds[i], infoB = blockKinds[j];
                    
                    // Only merge if NEITHER is a text block
                    if ((infoA && infoA.isText) || (infoB && infoB.isText)) continue;

                    const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
                    const gapY = getRangeGap(a.y, a.y + a.h, b.y, b.y + b.h);

                    // Check horizontal alignment and vertical gap
                    const isVerticallyAligned = overlapX > 30 || (Math.abs(a.x - b.x) < 60 && Math.abs((a.x+a.w) - (b.x+b.w)) < 60);
                    if (isVerticallyAligned && gapY > 0 && gapY < 180) {
                        // Check if there is any text block in between them vertically (with interval overlap!)
                        let hasTextInBetween = false;
                        const minY = Math.min(a.y + a.h, b.y + b.h);
                        const maxY = Math.max(a.y, b.y);
                        for (let k = 0; k < blocks.length; k++) {
                            if (k === i || k === j) continue;
                            const blockK = blocks[k];
                            const infoK = blockKinds[k];
                            if (infoK && infoK.isText && blockK.y < maxY && blockK.y + blockK.h > minY) {
                                hasTextInBetween = true;
                                break;
                            }
                        }

                        if (!hasTextInBetween) {
                            blocks[i] = {
                                x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
                                w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
                                h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y)
                            };
                            blocks.splice(j, 1);
                            imgMerged = true;
                            break;
                        }
                    }
                }
                if (imgMerged) break;
            }
        } catch (e) {
            break;
        }
    }

    try {
        pageLayoutBlocks[pageNum] = blocks.map(block => {
            const blockArea = Math.max(1, block.w * block.h);
            let overlapArea = 0;
            let textItemCount = 0;
            let fontSum = 0;
            let blockTextArr = [];

            for (const textRect of textRects) {
                const overlap = getOverlapArea(block, textRect);
                if (overlap <= 0) continue;
                overlapArea += Math.min(overlap, textRect.w * textRect.h);
                textItemCount++;
                fontSum += textRect.fontSize || 0;
                blockTextArr.push(textRect.str);
            }

            const textCoverage = Math.min(1, overlapArea / blockArea);
            const avgFontSize = textItemCount > 0 ? fontSum / textItemCount : 0;
            const aspectRatio = block.w / Math.max(1, block.h);
            const areaFraction = blockArea / pageArea;

            let kind = 'mixed';
            const isLineOrCrease = (aspectRatio < 0.38 && textCoverage < 0.12 && textItemCount < 8) || 
                                   (aspectRatio > 5.5 && textCoverage < 0.12 && textItemCount < 8);

            if (isLineOrCrease) {
                kind = 'noise';
            } else if (textCoverage >= 0.16 || (textItemCount >= 9 && textCoverage >= 0.12)) {
                kind = 'text';
            } else if (textItemCount >= 9 && textCoverage < 0.12) {
                kind = 'mixed';
            } else if (textItemCount >= 2 && block.h <= 120 && textCoverage >= 0.05) {
                kind = 'caption';
            } else if (textCoverage <= 0.035 && textItemCount <= 2 && blockArea >= Math.max(7000, pageArea * 0.008) && aspectRatio >= 0.18 && aspectRatio <= 5.5) {
                // Ignore decorative header/footer banners (at top 15% or bottom 12% margins)
                const isHeaderFooter = (block.y < h * 0.15) || (block.y + block.h > h * 0.88);
                if (isHeaderFooter && block.w > w * 0.5) {
                    kind = 'noise';
                } else {
                    kind = 'image';
                }
            } else if (textItemCount === 0) {
                if (blockArea >= 2500 && aspectRatio >= 0.18 && aspectRatio <= 5.5) {
                    kind = 'image';
                } else {
                    kind = 'noise';
                }
            } else if (areaFraction < 0.004 && textItemCount <= 1) {
                kind = 'noise';
            } else if (block.w < 35 || block.h < 35) {
                kind = 'noise';
            }

            return {
                x: block.x / canvasScale,
                y: block.y / canvasScale,
                w: block.w / canvasScale,
                h: block.h / canvasScale,
                kind,
                textCoverage,
                textItemCount,
                avgFontSize: avgFontSize / canvasScale,
                areaFraction,
                text: blockTextArr.join(' ')
            };
        }).filter(block => block.kind !== 'noise');

    } catch (layoutMetaError) {
        pageLayoutBlocks[pageNum] = blocks.map(b => ({
            x: b.x / canvasScale,
            y: b.y / canvasScale,
            w: b.w / canvasScale,
            h: b.h / canvasScale
        }));
    }
}

// --- Refine layout region: merge adjacent blocks in the same column ---
function getRefinedLayoutRegion(pageNum, region) {
    const blocks = pageLayoutBlocks[pageNum];
    if (!blocks || blocks.length === 0) return region;

    let { x, y, w, h } = region;
    let changed = true;
    while (changed) {
        changed = false;
        for (const block of blocks) {
            const bx = block.x, by = block.y, bw = block.w, bh = block.h;
            // Check if block is adjacent or overlapping horizontally (same column)
            const horizOverlap = Math.min(x + w, bx + bw) - Math.max(x, bx);
            if (horizOverlap > 0 || Math.abs(x + w / 2 - (bx + bw / 2)) < 100) {
                // Check vertical proximity
                const vertGap = Math.max(by - (y + h), y - (by + bh));
                if (vertGap < 80) { // within 80px
                    const newX = Math.min(x, bx), newY = Math.min(y, by);
                    const newW = Math.max(x + w, bx + bw) - newX;
                    const newH = Math.max(y + h, by + bh) - newY;
                    if (newX !== x || newY !== y || newW !== w || newH !== h) {
                        x = newX; y = newY; w = newW; h = newH;
                        changed = true;
                    }
                }
            }
        }
    }
    return { x, y, w, h };
}

/**
 * Extract English anchor keyword from save text format:
 * "**คำไทย** (**EnglishAnchor**, Alias1, Alias2): คำอธิบาย..."
 */
function findEnglishAnchor(text) {
    if (!text) return null;
    // Match **...** (**English**, ...)
    const m = text.match(/\*\*([^*]+)\*\*\s*\(\(?([A-Za-z][^)]+)\)/);
    if (m && m[2]) {
        const anchor = m[2].split(',')[0].trim();
        if (anchor.length >= 2) return anchor;
    }
    // Fallback: any English word >= 4 chars
    const engWords = text.match(/\b[A-Za-z]{4,}\b/g);
    return engWords ? engWords[0] : null;
}

/**
 * Find best page for an English anchor using cached pageTextMap ONLY.
 * No PDF text re-read, no viewport calculation.
 */
function findFastPageForAnchor(anchorText) {
    const norm = normalizeSearchText(anchorText);
    if (norm.length < 2) return null;

    const startPage = currentPage;
    const endPage = Math.min(currentPage + batchSize - 1, totalPages);
    let bestPage = null;
    let bestCount = 0;

    for (let p = startPage; p <= endPage; p++) {
        const pt = pageTextMap[p];
        if (!pt) continue;
        const pn = normalizeSearchText(pt);
        let count = 0, idx = 0;
        while ((idx = pn.indexOf(norm, idx)) !== -1) { count++; idx += norm.length; }
        if (count > bestCount) { bestCount = count; bestPage = p; }
    }
    return bestPage;
}

/**
 * Find best image block on a page using cached pageLayoutBlocks + visual evidence.
 * No pixel re-scan, no cluster calculation.
 */
function findFastImageBlock(pageNum) {
    const blocks = pageLayoutBlocks[pageNum];
    if (!blocks || blocks.length === 0) return null;

    const wrapper = document.getElementById(`page-wrapper-${pageNum}`);
    const canvas = wrapper ? wrapper.querySelector('canvas') : null;

    const candidates = blocks
        .filter(b => b.kind === 'image' && b.w >= 60 && b.h >= 60)
        .map(b => {
            const evidence = canvas ? getVisualEvidence(canvas, {
                x: b.x * scale, y: b.y * scale, w: b.w * scale, h: b.h * scale
            }) : { usable: true, inkRatio: 0.1, colorRatio: 0.01 };
            return { block: b, evidence };
        })
        .filter(c => c.evidence.usable)
        .sort((a, b) => (b.block.w * b.block.h) - (a.block.w * a.block.h));

    return candidates.length > 0 ? candidates[0].block : null;
}

/**
 * Render a page at 3.5x in offscreen canvas, crop to block area.
 * Returns JPEG data URL or null.
 */
async function captureImageBlockHighRes(pageNum, block, padding = 24, renderScale = 3.5) {
    try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: renderScale });

        const bw = block.w * renderScale;
        const bh = block.h * renderScale;
        const bx = block.x * renderScale;
        const by = block.y * renderScale;

        const sx = Math.max(0, bx - padding);
        const sy = Math.max(0, by - padding);
        const sw = Math.min(bw + padding * 2, viewport.width - sx);
        const sh = Math.min(bh + padding * 2, viewport.height - sy);

        if (sw < 30 || sh < 30) return null;

        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = viewport.width;
        fullCanvas.height = viewport.height;
        const fullCtx = fullCanvas.getContext('2d');

        await page.render({ canvasContext: fullCtx, viewport: viewport }).promise;

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = sw;
        cropCanvas.height = sh;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

        return cropCanvas.toDataURL('image/jpeg', 0.88);
    } catch (e) {
        console.error('[FastBlock] captureImageBlockHighRes error:', e);
        return null;
    }
}

async function captureHighlightedRegion(sourceCanvas, keywords = [], targetPageNum = null) {
    if (!sourceCanvas) return null;

    const pageNum = targetPageNum || currentPage;
    const cw = sourceCanvas.width, ch = sourceCanvas.height;

    // Use full canvas — no smart cropping
    const region = { x: 0, y: 0, w: cw, h: ch };

    const footerH = 44;
    const outCanvas = document.createElement('canvas');
    const outCtx = outCanvas.getContext('2d');
    outCanvas.width = cw;
    outCanvas.height = ch + footerH;

    // Draw PDF page
    outCtx.drawImage(sourceCanvas, 0, 0);

    // Draw metadata footer (black bar)
    const footerY = ch;
    outCtx.fillStyle = '#000000';
    outCtx.fillRect(0, footerY, cw, footerH);

    // Book name & page
    let bookName = currentFileName.replace(/\.pdf$/i, '');
    bookName = bookName.split(' -- ')[0];
    bookName = bookName.split(' (')[0];
    bookName = bookName.replace(/_/g, '');
    bookName = bookName.replace(/\[[^\]]*\]/g, '').trim();

    const pageLabel = pageNum ? ` | หนาที่ ${pageNum}` : '';
    const cropLabel = `x=${Math.round(region.x)} y=${Math.round(region.y)} ${Math.round(region.w)}x${Math.round(region.h)}`;

    outCtx.fillStyle = '#ffffff';
    outCtx.font = 'bold 14px Arial, sans-serif';
    outCtx.textBaseline = 'middle';
    outCtx.textAlign = 'left';

    let footerText = `${bookName}${pageLabel}`;
    const maxTextW = cropW - 100;
    if (outCtx.measureText(footerText).width > maxTextW) {
        while (bookName.length > 0 && outCtx.measureText(`${bookName}...${pageLabel}`).width > maxTextW) {
            bookName = bookName.slice(0, -1);
        }
        footerText = `${bookName}...${pageLabel}`;
    }
    outCtx.fillText(footerText, 12, footerY + footerH / 2);

    // Crop coordinates on the right
    outCtx.textAlign = 'right';
    outCtx.font = '11px Arial, sans-serif';
    outCtx.fillStyle = '#aaaaaa';
    outCtx.fillText(cropLabel, cropW - 12, footerY + footerH / 2);

    try {
        return outCanvas.toDataURL('image/png');
    } catch (e) {
        console.error("captureHighlightedRegion export error:", e);
        showToast('ไม่สามารถสร้างภาพหน้าจอได้: โมเดลไม่รองรับ image input', 'error');
        return null;
    }
}

async function fitToPage() {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: 1 });
    const containerWidth = pdfContainer.clientWidth - 40;
    scale = (containerWidth / viewport.width) * 0.95;
    zoomLevel.textContent = `${Math.round(scale * 100)}%`;
    await renderKeysPages();
}

async function renderKeysPages() {
    if (!pdfDoc) return;
    pdfContainer.innerHTML = '';
    const endPage = Math.min(currentPage + batchSize - 1, totalPages);

    try {
        // Pre-fetch all pages in the batch
        const pagePromises = [];
        for (let i = currentPage; i <= endPage; i++) {
            pagePromises.push(pdfDoc.getPage(i));
        }
        const pages = await Promise.all(pagePromises);

        for (let i = 0; i < pages.length; i++) {
            const pageNum = currentPage + i;
            const page = pages[i];

            const wrapper = document.createElement('div');
            wrapper.className = 'pdf-page-wrapper';
            wrapper.style.margin = '0 auto 20px';
            wrapper.style.position = 'relative';
            wrapper.style.textAlign = 'center';
            wrapper.id = `page-wrapper-${pageNum}`;
            wrapper.dataset.page = pageNum;

            const label = document.createElement('div');
            label.textContent = `หน้าที่ ${pageNum}`;
            label.style.color = '#888';
            label.style.fontSize = '12px';
            label.style.marginBottom = '5px';
            wrapper.appendChild(label);

            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-canvas-item';
            wrapper.appendChild(canvas);
            pdfContainer.appendChild(wrapper);

            const viewport = page.getViewport({ scale: scale });
            const ctx = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            // We still await individual renders to avoid too much memory pressure at once
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;

            // Run layout analysis to detect text blocks and illustrations automatically
            try {
                await analyzePageLayout(canvas, page, pageNum);
            } catch (layoutError) {
                console.error(`Layout analysis failed for page ${pageNum}:`, layoutError);
            }
        }
    } catch (e) {
        console.error('Render batch error:', e);
    }
}

// Pre-fetch timer for next batch
let nextPreFetchTimer = null;

// Max illustration images to attach per batch (to keep prompt fast)
const MAX_ILLUSTRATION_IMAGES = 3;

/**
 * Capture illustration/image blocks from the rendered canvases of a page range.
 * Returns an array of base64 PNG data URLs (without the data: prefix).
 */
async function captureIllustrations(start, end) {
    const images = [];
    const canvases = pdfContainer.querySelectorAll('.pdf-canvas-item');

    for (let pageNum = start; pageNum <= end && images.length < MAX_ILLUSTRATION_IMAGES; pageNum++) {
        const blocks = pageLayoutBlocks[pageNum];
        if (!blocks || blocks.length === 0) continue;

        // Find the canvas for this page
        const wrapper = pdfContainer.querySelector(`.pdf-page-wrapper[data-page="${pageNum}"]`);
        const canvas = wrapper ? wrapper.querySelector('.pdf-canvas-item') : null;
        if (!canvas) continue;

        // Pick blocks classified as 'image' or large 'mixed'
        const imageBlocks = blocks.filter(b => {
            if (b.kind === 'image') return true;
            if (b.kind === 'mixed' && b.areaFraction >= 0.03) return true;
            return false;
        });

        for (const block of imageBlocks) {
            if (images.length >= MAX_ILLUSTRATION_IMAGES) break;
            // Skip tiny blocks
            if (block.w < 60 || block.h < 60) continue;

            try {
                const cropCanvas = document.createElement('canvas');
                // Pad the crop slightly
                const pad = 6;
                const sx = Math.max(0, block.x - pad);
                const sy = Math.max(0, block.y - pad);
                const sw = Math.min(canvas.width - sx, block.w + pad * 2);
                const sh = Math.min(canvas.height - sy, block.h + pad * 2);
                cropCanvas.width = sw;
                cropCanvas.height = sh;
                const ctx = cropCanvas.getContext('2d');
                ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
                // Convert to base64 (strip data: prefix)
                const dataUrl = cropCanvas.toDataURL('image/jpeg', 0.82);
                images.push(dataUrl);
            } catch (e) {
                console.warn(`captureIllustrations: failed for page ${pageNum} block`, e);
            }
        }
    }
    return images;
}

async function captureIllustrationsOffscreen(start, end) {
    const images = [];
    if (!pdfDoc) return images;

    const pageNums = [];
    for (let pageNum = start; pageNum <= end; pageNum++) {
        pageNums.push(pageNum);
    }

    const renderPromises = pageNums.map(async (pageNum) => {
        try {
            const page = await pdfDoc.getPage(pageNum);
            const renderScale = 1.5;
            const viewport = page.getViewport({ scale: renderScale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');

            await page.render({ canvasContext: ctx, viewport: viewport }).promise;

            // Run layout analysis using this offscreen canvas
            await analyzePageLayout(canvas, page, pageNum);

            const blocks = pageLayoutBlocks[pageNum];
            if (!blocks || blocks.length === 0) return [];

            // Pick blocks classified as 'image' or large 'mixed'
            const imageBlocks = blocks.filter(b => {
                if (b.kind === 'image') return true;
                if (b.kind === 'mixed' && b.areaFraction >= 0.03) return true;
                return false;
            });

            const pageImages = [];
            for (const block of imageBlocks) {
                if (block.w < 60 || block.h < 60) continue;

                try {
                    const cropCanvas = document.createElement('canvas');
                    const pad = 6;
                    const sx = Math.max(0, block.x - pad);
                    const sy = Math.max(0, block.y - pad);
                    const sw = Math.min(canvas.width - sx, block.w + pad * 2);
                    const sh = Math.min(canvas.height - sy, block.h + pad * 2);
                    cropCanvas.width = sw;
                    cropCanvas.height = sh;
                    const cropCtx = cropCanvas.getContext('2d');
                    cropCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
                    const dataUrl = cropCanvas.toDataURL('image/jpeg', 0.82);
                    pageImages.push(dataUrl);
                } catch (e) {
                    console.warn(`captureIllustrationsOffscreen: failed to crop for page ${pageNum} block`, e);
                }
            }
            return pageImages;
        } catch (err) {
            console.error(`captureIllustrationsOffscreen: failed for page ${pageNum}`, err);
            return [];
        }
    });

    const results = await Promise.all(renderPromises);
    for (const pageImages of results) {
        for (const img of pageImages) {
            if (images.length < MAX_ILLUSTRATION_IMAGES) {
                images.push(img);
            }
        }
    }
    return images;
}

async function extractTextBatch(start, end, isPreFetch = false) {
    if (isProcessingPage && start !== currentPage && !isPreFetch) return;

    if (!isPreFetch) {
        showToast(`กำลังอ่าน หน้า ${start}-${end}...`, 'info');
    }

    try {
        let combinedText = '';

        // 1. Try to use Pending Text if available (cache hit)
        if (!isPreFetch && pendingNextBatchStart === start && pendingNextBatchText) {
            console.log(`Using pre-fetched text for ${start}-${end}`);
            combinedText = pendingNextBatchText;
            extractedPageText = combinedText;
            pendingNextBatchText = ''; // Clear cache
            pendingNextBatchStart = 0;
        } else {
            // 2. Fresh Extraction
            const pagePromises = [];
            for (let i = start; i <= end; i++) {
                pagePromises.push(pdfDoc.getPage(i).then(async (page) => {
                    const content = await page.getTextContent();
                    const text = content.items.map(item => item.str).join(' ');
                    pageTextMap[i] = text; // Update map for highlighting logic
                    return { index: i, text: `\n--- หน้าที่ ${i} ---\n${text}` };
                }));
            }
            const results = await Promise.all(pagePromises);
            results.sort((a, b) => a.index - b.index);
            combinedText = results.map(r => r.text).join('');
        }

        // --- PRE-FETCH MODE ---
        if (isPreFetch) {
            console.log(`Pre-fetched text for pages ${start}-${end}`);
            // Trigger pre-summarization on the prefetch webview
            if (isAutoSummarize && combinedText.trim()) {
                const illustrationImages = await captureIllustrationsOffscreen(start, end);
                preSummarizeNextBatch(combinedText, start, end, illustrationImages);
            }
            return;
        }

        // --- NORMAL LOAD MODE ---
        extractedPageText = combinedText;
        extractedTextDiv.textContent = extractedPageText || '(ช่วงหน้านี้ไม่มีข้อความ)';
        pageInput.value = start;

        updateProgress();
        updateNavigation();
        await saveProgress();

        if (isAutoSummarize && extractedPageText.trim()) {
            // Capture any illustration images from the rendered batch pages
            const illustrationImages = await captureIllustrations(start, end);
            sendToGemini(combinedText, start, end, illustrationImages);
        }

        // Trigger NEXT pre-fetch chain immediately for instant next-page loading
        const nextStart = end + 1;
        if (nextStart <= totalPages) {
            const nextEnd = Math.min(nextStart + batchSize - 1, totalPages);
            if (nextPreFetchTimer) clearTimeout(nextPreFetchTimer);
            nextPreFetchTimer = setTimeout(() => {
                nextPreFetchTimer = null;
                extractTextBatch(nextStart, nextEnd, true);
            }, 500);
        }

    } catch (err) {
        console.error('Extraction Error:', err);
        showToast('ดึงข้อมูล PDF ไม่สำเร็จ', 'error');
    }
}

async function renderPage(pageNum) {
    await renderKeysPages();
}

async function goToPage(pageNum) {
    window.offlineAutoSaveTriggered = false;
    if (!pdfDoc) return;
    pageNum = Math.max(1, Math.min(pageNum, totalPages));
    if (pageNum !== currentPage) {
        // The Gemini response is in a separate webview.  Explicitly stop it before
        // changing batches so a delayed TTS response from the old page cannot play.
        stopActiveTts();
        currentPage = pageNum;
        isGeminiResponding = false;
        isProcessingPage = false;
        window.lastPromptId = '';
        if (nextPreFetchTimer) { clearTimeout(nextPreFetchTimer); nextPreFetchTimer = null; }

        const isPrefetchValid = pendingNextBatchStart === pageNum && pendingNextBatchText;
        if (isPrefetchValid) {
            console.log(`[goToPage] Prefetch hit! Swapping webviews for page ${pageNum}`);

            // Swap webview references
            const tempWebview = geminiWebview;
            geminiWebview = prefetchWebview;
            prefetchWebview = tempWebview;

            // Swap CSS classes to show/hide
            geminiWebview.classList.remove('prefetch-hidden');
            prefetchWebview.classList.add('prefetch-hidden');

            // Update current account index
            currentAccountIndex = pendingNextAccountIndex;
            if (accountSelect) {
                accountSelect.value = currentAccountIndex;
            }

            // Transfer status
            isGeminiResponding = isPrefetchResponding;
            window.lastPromptId = nextPromptIdPrefetch;

            // Invalidate prefetch status since it is now active
            isPrefetchResponding = false;
            isPrefetchReady = false;

            showToast(`หน้าเปลี่ยน (แสดงข้อมูลที่สรุปไว้ล่วงหน้า)`, 'success');

            await fitToPage();
        } else {
            // Clear prefetch if it was a manual mismatch jump
            pendingNextBatchText = '';
            pendingNextBatchStart = 0;
            pendingNextBatchEnd = 0;
            isPrefetchResponding = false;
            isPrefetchReady = false;

            // Rotate/cycle account on page change if auto-rotate is enabled and multiple accounts are active
            if (isAutoRotateAccounts && detectedAccounts.length > 1) {
                const currentIndexInDetected = detectedAccounts.indexOf(currentAccountIndex);
                const nextIndexInDetected = (currentIndexInDetected + 1) % detectedAccounts.length;
                currentAccountIndex = detectedAccounts[nextIndexInDetected];
                localStorage.setItem('currentAccountIndex', currentAccountIndex);
                if (accountSelect) {
                    accountSelect.value = currentAccountIndex;
                }
                console.log(`[goToPage] Auto rotated account to: ${currentAccountIndex}`);
                showToast(`หน้าเปลี่ยน สลับไปบัญชี ${currentAccountIndex + 1}...`, 'info');
            }

            // Direct URL Switching if the account is different, or startNewChat if the account is the same
            let currentUrl = '';
            try {
                currentUrl = geminiWebview.getURL();
            } catch (e) { }

            const isDifferentAccount = !(currentUrl && (currentUrl.includes(`/u/${currentAccountIndex}/`) || (currentAccountIndex === 0 && currentUrl.includes('/app') && !currentUrl.includes('/u/'))));

            if (isDifferentAccount) {
                geminiWebview.src = `https://gemini.google.com/u/${currentAccountIndex}/app`;
                await new Promise(r => setTimeout(r, 1500));
            } else {
                try {
                    const newChatRes = await geminiWebview.executeJavaScript('window.startNewChat ? window.startNewChat() : "NOT_READY"');
                    if (newChatRes !== 'CLICKED') {
                        geminiWebview.src = `https://gemini.google.com/u/${currentAccountIndex}/app`;
                        await new Promise(r => setTimeout(r, 1200));
                    } else {
                        await new Promise(r => setTimeout(r, 300));
                    }
                } catch (e) {
                    geminiWebview.src = `https://gemini.google.com/u/${currentAccountIndex}/app`;
                    await new Promise(r => setTimeout(r, 1200));
                }
            }

            await fitToPage();
        }
        extractTextBatch(currentPage, Math.min(currentPage + batchSize - 1, totalPages));
    }
}

function updateNavigation() {
    prevPageBtn.disabled = currentPage <= 1;
    const isLastPage = !pdfDoc || currentPage + batchSize - 1 >= totalPages;
    if (pdfDoc && currentPage + batchSize - 1 >= totalPages && totalPages > 0) {
        nextPageBtn.disabled = false;
        nextPageBtn.classList.add('btn-danger');
        nextPageBtn.innerHTML = '<span class="icon">🗑️</span> จบเล่ม (ลบไฟล์)';
        nextPageBtn.title = 'อ่านถึงหน้าสุดท้ายแล้ว คลิกเพื่อลบไฟล์ถาวร';
        if (bottomNextPageBtn) {
            bottomNextPageBtn.disabled = false;
            bottomNextPageBtn.classList.add('btn-danger');
            bottomNextPageBtn.innerHTML = '<span class="icon">🏁</span> จบเล่ม (ลบไฟล์)';
            bottomNextPageBtn.title = 'อ่านถึงหน้าสุดท้ายแล้ว คลิกเพื่อลบไฟล์ถาวร';
        }
    } else {
        nextPageBtn.disabled = isLastPage;
        nextPageBtn.classList.remove('btn-danger');
        nextPageBtn.innerHTML = '<span class="icon">❯</span>';
        nextPageBtn.title = 'หน้าถัดไป';
        if (bottomNextPageBtn) {
            bottomNextPageBtn.disabled = isLastPage;
            bottomNextPageBtn.classList.remove('btn-danger');
            bottomNextPageBtn.innerHTML = 'หน้าถัดไป ❯';
            bottomNextPageBtn.title = 'หน้าถัดไป';
        }
    }
}

function updateProgress() {
    const percent = Math.round((currentPage / totalPages) * 100);
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `หน้า ${currentPage}/${totalPages} (${percent}%)`;
}

async function saveProgress() {
    if (!currentFilePath) return;
    await window.electronAPI.saveProgress({
        filePath: currentFilePath,
        fileName: currentFileName,
        currentPage: currentPage,
        totalPages: totalPages,
        batchSize: batchSize
    });
}

function zoom(delta) {
    scale = Math.max(0.3, Math.min(4.0, scale + delta));
    zoomLevel.textContent = `${Math.round(scale * 100)}%`;
    renderPage(currentPage);
}

function handleKeyboard(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    switch (e.key) {
        case 'ArrowLeft': case 'PageUp': goToPage(currentPage - batchSize); break;
        case 'ArrowRight': case 'PageDown': goToPage(currentPage + batchSize); break;
        case 'Home': goToPage(1); break;
        case 'End': goToPage(totalPages); break;
        case '+': case '=': zoom(0.1); break;
        case '-': zoom(-0.1); break;
    }
}

async function getGitHubFile(filename, options = null, retries = 3) {
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${filename}`;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            if (res.status === 404) return null;
            if (res.status === 401 || res.status === 403) {
                if (!options || !options.silent) showToast('Token GitHub ไม่ถูกต้องหรือหมดอายุ', 'error');
                return 'ERR_AUTH';
            }
            if (res.status === 502 || res.status === 503 || res.status === 429) {
                if (attempt < retries) {
                    const delay = 1000 * attempt;
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
            }
            if (!res.ok) {
                if (!options || !options.silent) showToast('ติดต่อ GitHub ไม่ได้ (Status: ' + res.status + ')', 'error');
                return 'ERR_NET';
            }
            return await res.json();
        } catch (e) {
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
                continue;
            }
            if (!options || !options.silent) showToast('ติดต่อ GitHub ไม่ได้ (network error)', 'error');
            return 'ERR_NET';
        }
    }
    return 'ERR_NET';
}

function decodeGitHubContent(fileData) {
    if (!fileData || !fileData.content) return [];
    try {
        let decoded;
        try {
            decoded = decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ''))));
        } catch (e) {
            decoded = atob(fileData.content.replace(/\n/g, ''));
        }
        
        try {
            const sanitized = decoded.replace(/,\s*([\]}])/g, '$1');
            const parsed = JSON.parse(sanitized);
            return Array.isArray(parsed) ? parsed : (typeof parsed === 'object' && parsed ? [parsed] : []);
        } catch (parseError) {
            console.warn('JSON parse failed, trying regex recovery...', parseError);
            const regex = /\{\s*"data"\s*:\s*"(?:[^"\\]|\\.)*"\s*\}/g;
            const matches = decoded.match(regex);
            if (matches) return matches.map(m => { try { return JSON.parse(m); } catch (ex) { return null; } }).filter(x => x);
            return [];
        }
    } catch (e) {
        console.error('decodeGitHubContent critical error:', e);
        return [];
    }
}

async function findLatestGitHubFile(options = null) {
    let num = 1;
    let latestFile = GITHUB_FILE_BASE + num + '.json';
    while (true) {
        const candidate = GITHUB_FILE_BASE + num + '.json';
        const data = await getGitHubFile(candidate, options);
        if (!data) break; // ไม่มีไฟล์นี้ → ใช้ไฟล์ล่าสุดที่เจอ
        if (data === 'ERR_AUTH' || data === 'ERR_NET') return null;
        latestFile = candidate;
        // เช็คว่าไฟล์นี้เต็มยัง
        const items = decodeGitHubContent(data);
        if (items.length < GITHUB_MAX_ITEMS) break; // ไฟล์นี้ยังไม่เต็ม
        num++; // ลองไฟล์ถัดไป
    }
    GITHUB_FILE = latestFile;
    return latestFile;
}

async function putGitHubFile(filename, contentObj, sha, options = null, retries = 3) {
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${filename}`;
    const cleanData = contentObj.map(item => "  " + JSON.stringify(item)).join(",\n");
    const updatedContent = "[\n" + cleanData + "\n]";
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        const body = {
            message: `Update ${filename}`,
            content: btoa(unescape(encodeURIComponent(updatedContent))),
            branch: GITHUB_BRANCH
        };
        if (sha) body.sha = sha;
        try {
            reportUploadProgress(options, 92, `กำลังบันทึก ${filename}…`);
            const res = await fetch(url, {
                method: 'PUT',
                headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                if (!options || !options.silent) showToast('บันทึกที่ ' + filename + ' ✓', 'success');
                return { ok: true, filename, line: contentObj.length + 1 };
            } else if (res.status === 409) {
                if (attempt < retries) {
                    const freshData = await getGitHubFile(filename, options);
                    if (freshData && typeof freshData === 'object' && freshData.sha) {
                        sha = freshData.sha;
                        const freshItems = decodeGitHubContent(freshData);
                        if (freshItems.length < GITHUB_MAX_ITEMS) {
                            contentObj = [...freshItems, ...contentObj.slice(-1)];
                        }
                    }
                    await new Promise(r => setTimeout(r, 500 * attempt));
                    continue;
                }
                if (!options || !options.silent) showToast('ไฟล์ชนกัน ลองอีกครั้ง', 'warning');
            } else if (res.status === 502 || res.status === 503) {
                if (attempt < retries) {
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                    continue;
                }
                if (!options || !options.silent) showToast('บันทึกไม่สำเร็จ (GitHub server error)', 'error');
            } else {
                if (!options || !options.silent) showToast('บันทึกไม่สำเร็จ (' + res.status + ')', 'error');
            }
        } catch (e) {
            console.error('putGitHubFile error:', e);
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
                continue;
            }
            if (!options || !options.silent) showToast('บันทึกไม่สำเร็จ (network error)', 'error');
        }
    }
    return { ok: false };
}

async function updateGitHubFileV2(newContent, url = null, options = null) {
    if (!GITHUB_TOKEN) return { ok: false };

    const cleanData = newContent.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const newItem = { "data": cleanData };
    if (url) {
        let cleanUrl = url.replace(/^https?:\/\//i, '');
        newItem.url = cleanUrl;
    }

    // หาไฟล์ล่าสุดที่ยังไม่เต็ม
    reportUploadProgress(options, 78, 'กำลังค้นหาไฟล์ bigdata ที่พร้อมบันทึก…');
    const targetFile = await findLatestGitHubFile(options);
    if (!targetFile) return { ok: false };

    reportUploadProgress(options, 85, `กำลังอ่าน ${targetFile}…`);
    const fileData = await getGitHubFile(targetFile, options);

    if (!fileData) {
        // ไฟล์ไม่มี → สร้างใหม่
        return putGitHubFile(targetFile, [newItem], null, options);
    }

    if (fileData === 'ERR_AUTH' || fileData === 'ERR_NET') return { ok: false };

    let items = decodeGitHubContent(fileData);
    items.push(newItem);
    return putGitHubFile(targetFile, items, fileData.sha, options);
}

async function detectGoogleAccounts() {
    showToast('กำลังตรวจหาบัญชี Google...', 'info');
    if (detectAccountsBtn) {
        detectAccountsBtn.disabled = true;
        detectAccountsBtn.textContent = '⏳ กำลังตรวจ...';
    }

    try {
        const activeIndices = await window.electronAPI.detectAccounts();
        console.log('Detected active account indices:', activeIndices);

        if (activeIndices && activeIndices.length > 0) {
            detectedAccounts = activeIndices;

            if (accountSelect) {
                accountSelect.innerHTML = '';
                detectedAccounts.forEach(idx => {
                    const opt = document.createElement('option');
                    opt.value = idx;
                    opt.textContent = `บัญชี ${idx + 1} (u/${idx})`;
                    accountSelect.appendChild(opt);
                });

                if (detectedAccounts.includes(currentAccountIndex)) {
                    accountSelect.value = currentAccountIndex;
                } else {
                    currentAccountIndex = detectedAccounts[0];
                    accountSelect.value = currentAccountIndex;
                    localStorage.setItem('currentAccountIndex', currentAccountIndex);
                }
            }
            saveAppSettings();
            showToast(`ตรวจพบ ${detectedAccounts.length} บัญชีในระบบ`, 'success');
        } else {
            // Keep default u/0 if nothing is detected
            detectedAccounts = [0];
            if (accountSelect) {
                accountSelect.innerHTML = '<option value="0">บัญชี 1 (u/0)</option>';
                accountSelect.value = 0;
            }
            currentAccountIndex = 0;
            localStorage.setItem('currentAccountIndex', 0);
            saveAppSettings();
            showToast('ไม่พบบัญชีเพิ่มเติม (ใช้งานบัญชีหลัก u/0)', 'info');
        }
    } catch (err) {
        console.error('Account detection error:', err);
        showToast('เกิดข้อผิดพลาดในการตรวจบัญชี', 'error');
    } finally {
        if (detectAccountsBtn) {
            detectAccountsBtn.disabled = false;
            detectAccountsBtn.textContent = '🔍 ตรวจบัญชี';
        }
    }
}

async function saveAppSettings() {
    try {
        await window.electronAPI.saveSettings({
            detectedAccounts,
            currentAccountIndex,
            isAutoRotateAccounts,
            offlineDocuments,

        });
    } catch (e) {
        console.error('Error saving app settings:', e);
    }
}

async function loadAppSettings() {
    try {
        const settings = await window.electronAPI.loadSettings();
        if (settings) {
            console.log('Loaded app settings:', settings);
            if (settings.detectedAccounts && settings.detectedAccounts.length > 0) {
                detectedAccounts = settings.detectedAccounts;
            }
            if (settings.currentAccountIndex !== undefined) {
                currentAccountIndex = settings.currentAccountIndex;
            }
            if (settings.isAutoRotateAccounts !== undefined) {
                isAutoRotateAccounts = settings.isAutoRotateAccounts;
            }
            if (settings.offlineDocuments && typeof settings.offlineDocuments === 'object') offlineDocuments = settings.offlineDocuments;

        }

        // Update UI
        if (accountSelect) {
            accountSelect.innerHTML = '';
            detectedAccounts.forEach(idx => {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = `บัญชี ${idx + 1} (u/${idx})`;
                accountSelect.appendChild(opt);
            });
            if (detectedAccounts.includes(currentAccountIndex)) {
                accountSelect.value = currentAccountIndex;
            } else {
                currentAccountIndex = detectedAccounts[0] || 0;
                accountSelect.value = currentAccountIndex;
            }
        }
        if (autoRotateAccountsCheckbox) {
            autoRotateAccountsCheckbox.checked = isAutoRotateAccounts;
        }
        // App startup always defaults to Online. A document can opt in after it is opened.
        isOfflineMode = false;
        updateOfflineModeUi();
    } catch (e) {
        console.error('Error loading app settings:', e);
    }
}

async function ensureAccountLoaded(index) {
    const targetUrl = `https://gemini.google.com/u/${index}/app`;
    const currentUrl = geminiWebview.getURL();

    if (currentUrl && (currentUrl.includes(`/u/${index}/`) || (index === 0 && currentUrl.includes('/app') && !currentUrl.includes('/u/')))) {
        return;
    }

    console.log(`Switching webview account to index ${index}: ${targetUrl}`);
    showToast(`กำลังสลับไปบัญชี ${index + 1}...`, 'info');

    geminiWebview.src = targetUrl;

    await new Promise((resolve) => {
        let resolved = false;
        const done = () => {
            if (resolved) return;
            resolved = true;
            geminiWebview.removeEventListener('dom-ready', done);
            resolve();
        };
        geminiWebview.addEventListener('dom-ready', done);
        setTimeout(done, 15000); // 15 seconds timeout
    });

    await new Promise(r => setTimeout(r, 1000)); // Extra settle time
}

async function ensurePrefetchAccountLoaded(index) {
    const targetUrl = `https://gemini.google.com/u/${index}/app`;
    let currentUrl = '';
    try {
        currentUrl = prefetchWebview.getURL();
    } catch (e) { }

    if (currentUrl && (currentUrl.includes(`/u/${index}/`) || (index === 0 && currentUrl.includes('/app') && !currentUrl.includes('/u/')))) {
        return;
    }

    console.log(`[Prefetch] Switching background webview account to index ${index}: ${targetUrl}`);
    prefetchWebview.src = targetUrl;

    await new Promise((resolve) => {
        let resolved = false;
        const done = () => {
            if (resolved) return;
            resolved = true;
            prefetchWebview.removeEventListener('dom-ready', done);
            resolve();
        };
        prefetchWebview.addEventListener('dom-ready', done);
        setTimeout(done, 15000); // 15 seconds timeout
    });

    await new Promise(r => setTimeout(r, 1000)); // Extra settle time
}

async function preSummarizeNextBatch(textToSummarize, startPage, endPage, illustrationImages = []) {
    if (!prefetchWebview) return;

    // Determine the next account index in auto-rotate
    let nextAccountIndex = currentAccountIndex;
    if (isAutoRotateAccounts && detectedAccounts.length > 1) {
        const currentIndexInDetected = detectedAccounts.indexOf(currentAccountIndex);
        const nextIndexInDetected = (currentIndexInDetected + 1) % detectedAccounts.length;
        nextAccountIndex = detectedAccounts[nextIndexInDetected];
    }
    pendingNextAccountIndex = nextAccountIndex;

    const promptId = `${startPage}-${endPage}-${textToSummarize.length}`;
    if (nextPromptIdPrefetch === promptId && isPrefetchResponding) {
        console.log(`[Prefetch] Duplicate blocked: ${promptId}`);
        return;
    }
    nextPromptIdPrefetch = promptId;
    isPrefetchResponding = true;
    isPrefetchReady = false;

    // Set prefetch cache variables ONLY here, when we actually start pre-summarizing
    pendingNextBatchText = textToSummarize;
    pendingNextBatchStart = startPage;
    pendingNextBatchEnd = endPage;

    // Safety timeout to unlock if prefetch hangs
    const safeTimeout = setTimeout(() => {
        if (nextPromptIdPrefetch === promptId) {
            isPrefetchResponding = false;
        }
    }, 45000);

    try {
        // Ensure prefetchWebview is loaded with the nextAccountIndex
        await ensurePrefetchAccountLoaded(nextAccountIndex);

        const prompt = `สรุปเนื้อหาจาก PDF จำนวน ${batchSize} หน้า (หน้าที่ ${startPage} ถึง ${endPage}) เป็นภาษาไทย:
- สรุปแบ่งเป็นประเด็นสำคัญๆ ให้ครอบคลุมเนื้อหาทั้งหมด
- ใช้รายการหัวข้อย่อย (Bullet points) ที่กระชับและเข้าใจง่าย ให้เป็น <li> เดียว อย่าซ้อน
- **รูปแบบบังคับ:** ทุกหัวข้อต้องใช้รูปแบบ: **คำภาษาไทย** (**EnglishAnchor**, Alias1, Alias2): คำอธิบาย...
- **สำคัญมาก:** ต้องมีคำภาษาอังกฤษตัวหนาในวงเล็บหลังคำภาษาไทยเสมอ (EnglishAnchor) เช่น **ข้าวโพด** (**Corn**, Maize): ...
- ถ้ามีชื่อวิทยาศาสตร์ ให้ใส่ต่อท้าย EnglishAnchor คั่นด้วย comma เช่น (**Zea mays**, Corn, Maize)
- หากมีภาพประกอบที่เกี่ยวข้อง ให้ตั้ง EnglishAnchor ให้ตรงกับชื่อวัตถุ/กระบวนการในภาพและข้อความกำกับภาพ เพื่อให้ระบบจับคู่ภาพได้แม่นยำ
- ห้ามใช้ Tag HTML ทุกชนิด ให้ใช้รูปแบบ Markdown ปกติเท่านั้น
- ไม่ต้องเกริ่นนำหรือลงท้าย เอาเฉพาะเนื้อสรุป
- <li> เดียวอย่าซ้อน ห้ามมี - | ต่อท้ายประโยค

เนื้อหา:
${textToSummarize}`;

        // Reset/New Chat in prefetchWebview:
        // Direct URL Switching if the account is different, or startNewChat if the account is the same
        let currentUrl = '';
        try {
            currentUrl = prefetchWebview.getURL();
        } catch (e) { }

        const isDifferentAccount = !(currentUrl && (currentUrl.includes(`/u/${nextAccountIndex}/`) || (nextAccountIndex === 0 && currentUrl.includes('/app') && !currentUrl.includes('/u/'))));

        if (isDifferentAccount) {
            prefetchWebview.src = `https://gemini.google.com/u/${nextAccountIndex}/app`;
            await new Promise(r => setTimeout(r, 1500));
        } else {
            try {
                const newChatRes = await prefetchWebview.executeJavaScript('window.startNewChat ? window.startNewChat() : "NOT_READY"');
                if (newChatRes !== 'CLICKED') {
                    prefetchWebview.src = `https://gemini.google.com/u/${nextAccountIndex}/app`;
                    await new Promise(r => setTimeout(r, 1500));
                } else {
                    await new Promise(r => setTimeout(r, 500));
                }
            } catch (e) {
                prefetchWebview.src = `https://gemini.google.com/u/${nextAccountIndex}/app`;
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        // Retry loop to prepare input
        let prepReady = false;
        for (let attempt = 0; attempt < 5; attempt++) {
            const prepResult = await prefetchWebview.executeJavaScript(`
                (function() {
                    if (window.prepareInput) return window.prepareInput();
                    return "NOT_READY";
                })()
            `);

            if (prepResult === "READY") {
                prepReady = true;
                break;
            }
            // Inject script to prefetchWebview if not ready
            await injectGeminiScript(prefetchWebview);
            await new Promise(r => setTimeout(r, 2000));
        }

        if (!prepReady) {
            console.log('prefetch: Cannot connect to Gemini on prefetchWebview');
            isPrefetchResponding = false;
            clearTimeout(safeTimeout);
            return;
        }

        // Paste illustration images into prefetchWebview input if any
        if (illustrationImages && illustrationImages.length > 0) {
            for (const dataUrl of illustrationImages) {
                try {
                    // Convert data URL to blob and paste via clipboard API in the prefetch webview
                    await prefetchWebview.executeJavaScript(`
                        (async function() {
                            try {
                                const dataUrl = ${JSON.stringify(dataUrl)};
                                const res = await fetch(dataUrl);
                                const blob = await res.blob();
                                const item = new ClipboardItem({ 'image/jpeg': blob });
                                await navigator.clipboard.write([item]);
                                // Paste into the focused input
                                const input = document.querySelector('rich-textarea') || document.querySelector('[contenteditable="true"]');
                                if (input) {
                                    input.focus();
                                    document.execCommand('paste');
                                }
                                return 'IMG_PASTED';
                            } catch(e) {
                                return 'IMG_PASTE_FAILED:' + e.message;
                            }
                        })()
                    `);
                    await new Promise(r => setTimeout(r, 600));
                } catch (imgErr) {
                    console.warn('prefetch image paste failed', imgErr);
                }
            }
        }

        // paste/insert ข้อความเข้า Gemini input (prefetch)
        var prefetchPasteResult = await prefetchWebview.executeJavaScript(`
            (function() {
                try {
                    const text = ${JSON.stringify(prompt)};
                    var el = document.querySelector('[contenteditable="true"]');
                    if (!el) {
                        el = document.querySelector('rich-textarea');
                        if (!el) {
                            var ta = document.querySelector('textarea');
                            if (ta) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); return 'VALUE_SET'; }
                            return 'INPUT_NOT_FOUND';
                        }
                    }
                    el.focus();
                    if (el.textContent) el.textContent = '';
                    if (document.execCommand('insertText', false, text)) {
                        if (el.textContent.trim().length > 0) return 'INSERTED_VIA_TEXT';
                    }
                    el.textContent = text;
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
                    if (el.textContent.trim().length > 0) return 'INSERTED_VIA_TEXTCONTENT';
                    el.appendChild(document.createTextNode(text));
                    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                    if (el.textContent.trim().length > 0) return 'INSERTED_VIA_NODE';
                    return 'ALL_FAILED';
                } catch(e) {
                    return 'ERROR:' + e.message;
                }
            })()
        `);
        console.log('prefetch paste result:', prefetchPasteResult);

        // Click send in prefetchWebview
        let sendRetries = 0;
        const trySendPrefetch = () => {
            prefetchWebview.executeJavaScript('window.clickSend ? window.clickSend() : "NOT_READY"').then(result => {
                if (result === "WAITING" && sendRetries < 15) {
                    sendRetries++;
                    setTimeout(trySendPrefetch, 400);
                } else if (result !== "CLICKED") {
                    console.log("prefetch: send failed after retries:", result);
                }
            });
        };
        setTimeout(trySendPrefetch, 200);

    } catch (e) {
        console.error('preSummarizeNextBatch Error:', e);
        isPrefetchResponding = false;
        isPrefetchReady = false;
        pendingNextBatchText = '';
        pendingNextBatchStart = 0;
        pendingNextBatchEnd = 0;
        clearTimeout(safeTimeout);
    }
}

async function sendToGemini(textToSummarize, startPage, endPage, illustrationImages = []) {
    if (!textToSummarize) {
        textToSummarize = extractedPageText;
        startPage = currentPage;
        endPage = Math.min(currentPage + batchSize - 1, totalPages);
    }
    if (!textToSummarize || !textToSummarize.trim()) return;

    const promptId = `${startPage}-${endPage}-${textToSummarize.length}`;
    // Absolute dedup: same promptId = block until goToPage resets it
    if (window.lastPromptId === promptId) {
        console.log(`sendToGemini: duplicate blocked (${promptId})`);
        return;
    }
    window.lastPromptId = promptId;
    isGeminiResponding = true;



    // Safety timeout to unlock if Gemini hangs
    const safeTimeout = setTimeout(() => {
        if (window.lastPromptId === promptId) {
            isGeminiResponding = false;
            isProcessingPage = false;
            window.lastPromptId = '';
        }
    }, 45000);

    try {
        // Ensure the webview is loaded with the active account
        await ensureAccountLoaded(currentAccountIndex);

        // Safety check if page was changed during account load
        if (window.lastPromptId !== promptId) {
            console.log('sendToGemini: aborted (page changed during account switch)');
            isGeminiResponding = false;
            clearTimeout(safeTimeout);
            return;
        }

        const prompt = `สรุปเนื้อหาจาก PDF จำนวน ${batchSize} หน้า (หน้าที่ ${startPage} ถึง ${endPage}) เป็นภาษาไทย:
- สรุปแบ่งเป็นประเด็นสำคัญๆ ให้ครอบคลุมเนื้อหาทั้งหมด
- ใช้รายการหัวข้อย่อย (Bullet points) ที่กระชับและเข้าใจง่าย ให้เป็น <li> เดียว อย่าซ้อน
- **รูปแบบบังคับ:** ทุกหัวข้อต้องใช้รูปแบบ: **คำภาษาไทย** (**EnglishAnchor**, Alias1, Alias2): คำอธิบาย...
- **สำคัญมาก:** ต้องมีคำภาษาอังกฤษตัวหนาในวงเล็บหลังคำภาษาไทยเสมอ (EnglishAnchor) เช่น **ข้าวโพด** (**Corn**, Maize): ...
- ถ้ามีชื่อวิทยาศาสตร์ ให้ใส่ต่อท้าย EnglishAnchor คั่นด้วย comma เช่น (**Zea mays**, Corn, Maize)
- หากมีภาพประกอบที่เกี่ยวข้อง ให้ตั้ง EnglishAnchor ให้ตรงกับชื่อวัตถุ/กระบวนการในภาพและข้อความกำกับภาพ เพื่อให้ระบบจับคู่ภาพได้แม่นยำ
- ห้ามใช้ Tag HTML ทุกชนิด ให้ใช้รูปแบบ Markdown ปกติเท่านั้น
- ไม่ต้องเกริ่นนำหรือลงท้าย เอาเฉพาะเนื้อสรุป
- <li> เดียวอย่าซ้อน ห้ามมี - | ต่อท้ายประโยค

เนื้อหา:
${textToSummarize}`;

        // Retry loop: keep isGeminiResponding=true throughout
        let prepReady = false;
        for (let attempt = 0; attempt < 5; attempt++) {
            if (window.lastPromptId !== promptId) { console.log('sendToGemini: aborted (page changed during prep)'); isGeminiResponding = false; return; }
            const prepResult = await geminiWebview.executeJavaScript(`
                (function() {
                    if (window.prepareInput) return window.prepareInput();
                    return "NOT_READY";
                })()
            `);

            if (prepResult === "READY") {
                prepReady = true;
                break;
            }
            if (prepResult === "INPUT_NOT_FOUND") {
                showToast('ไม่พบช่องกรอกข้อความ (ลองใหม่)', 'warning');
                await new Promise(r => setTimeout(r, 3000));
                continue;
            }
            // NOT_READY or ERROR: inject script and wait
            await injectGeminiScript();
            await new Promise(r => setTimeout(r, 2000));
        }

        if (!prepReady) {
            showToast('ไม่สามารถติดต่อ Gemini ได้', 'error');
            return;
        }

        if (window.lastPromptId !== promptId) { console.log('sendToGemini: aborted (page changed after prep)'); isGeminiResponding = false; return; }

        // Paste illustration images into Gemini input if any
        if (illustrationImages && illustrationImages.length > 0) {
            for (const dataUrl of illustrationImages) {
                try {
                    // Convert data URL to blob and paste via clipboard API in the webview
                    await geminiWebview.executeJavaScript(`
                        (async function() {
                            try {
                                const dataUrl = ${JSON.stringify(dataUrl)};
                                const res = await fetch(dataUrl);
                                const blob = await res.blob();
                                const item = new ClipboardItem({ 'image/jpeg': blob });
                                await navigator.clipboard.write([item]);
                                // Paste into the focused input
                                const input = document.querySelector('rich-textarea') || document.querySelector('[contenteditable="true"]');
                                if (input) {
                                    input.focus();
                                    document.execCommand('paste');
                                }
                                return 'IMG_PASTED';
                            } catch(e) {
                                return 'IMG_PASTE_FAILED:' + e.message;
                            }
                        })()
                    `);
                    await new Promise(r => setTimeout(r, 600));
                } catch (imgErr) {
                    console.warn('sendToGemini: image paste failed', imgErr);
                }
            }
        }

        // paste/insert ข้อความเข้า Gemini input ด้วยหลายวิธีเรียงลำดับ
        var pasteResult = await geminiWebview.executeJavaScript(`
            (function() {
                try {
                    const text = ${JSON.stringify(prompt)};
                    // หา contenteditable (ตัวที่ focus จริงๆ)
                    var el = document.querySelector('[contenteditable="true"]');
                    if (!el) {
                        // fallback: rich-textarea หรือ textarea
                        el = document.querySelector('rich-textarea');
                        if (!el) {
                            var ta = document.querySelector('textarea');
                            if (ta) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); return 'VALUE_SET'; }
                            return 'INPUT_NOT_FOUND';
                        }
                    }
                    el.focus();
                    // clear content - ห้ามใช้ innerHTML เพราะ TrustedHTML CSP
                    if (el.textContent) el.textContent = '';
                    // Strategy 1: execCommand insertText (trigger Angular/Lit change detection)
                    if (document.execCommand('insertText', false, text)) {
                        if (el.textContent.trim().length > 0) return 'INSERTED_VIA_TEXT';
                    }
                    // Strategy 2: textContent + InputEvent with inputType
                    el.textContent = text;
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
                    if (el.textContent.trim().length > 0) return 'INSERTED_VIA_TEXTCONTENT';
                    // Strategy 3: createTextNode + dispatch input
                    el.appendChild(document.createTextNode(text));
                    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                    if (el.textContent.trim().length > 0) return 'INSERTED_VIA_NODE';
                    return 'ALL_FAILED';
                } catch(e) {
                    return 'ERROR:' + e.message;
                }
            })()
        `);
        console.log('main paste result:', pasteResult);
        lastPromptedText = textToSummarize;

        // Original send flow: retry clickSend immediately (handles timing internally)
        if (window.lastPromptId !== promptId) { isGeminiResponding = false; return; }
        let sendRetries = 0;
        const trySend = () => {
            geminiWebview.executeJavaScript('window.clickSend ? window.clickSend() : "NOT_READY"').then(result => {
                if (window.lastPromptId !== promptId) { isGeminiResponding = false; return; }
                if (result === "WAITING" && sendRetries < 25) {
                    sendRetries++;
                    setTimeout(trySend, 500);
                } else if (result !== "CLICKED") {
                    console.log("sendToGemini: send failed after retries:", result);
                }
            });
        };
        setTimeout(trySend, 800); // รอให้ Gemini ประมวลผล paste ก่อนลองคลิก
    } catch (e) {
        console.error('sendToGemini Error:', e);
        clearTimeout(safeTimeout);
        isGeminiResponding = false;
        window.lastPromptId = '';
        showToast('ส่งข้อมูลสรุปไม่สำเร็จ', 'error');
    }
}

async function copyExtractedText() {
    await navigator.clipboard.writeText(extractedPageText);
    showToast('คัดลอกแล้ว ✓', 'success');
}

async function finishAndDelete() {
    if (!currentFilePath) return;
    const confirmDelete = confirm(`คุณอ่านจบเล่มแล้ว! ต้องการลบไฟล์ "${currentFileName}" ออกจากเครื่องถาวรหรือไม่?`);
    if (confirmDelete) {
        try {
            const success = await window.electronAPI.deleteFile(currentFilePath);
            if (success) {
                showToast('ลบไฟล์เรียบร้อยแล้ว', 'success');
                pdfDoc = null;
                pdfContainer.style.display = 'none';
                progressBar.style.display = 'none';
                welcomeScreen.style.display = 'flex';
                fileName.textContent = 'ยังไม่ได้เลือกไฟล์';
                await window.electronAPI.cleanupProgress();
                await loadReadingHistory();
            } else {
                showToast('ไม่สามารถลบไฟล์ได้', 'error');
            }
        } catch (e) {
            showToast('เกิดข้อผิดพลาดในการลบ', 'error');
        }
    }
}

function setupPanelResizer() {
    let resizing = false;
    panelResizer.addEventListener('mousedown', () => resizing = true);
    document.addEventListener('mousemove', (e) => {
        if (!resizing) return;
        geminiPanel.style.width = `${window.innerWidth - e.clientX}px`;
    });
    document.addEventListener('mouseup', () => {
        if (resizing && pdfDoc) setTimeout(fitToPage, 100);
        resizing = false;
    });
}

async function loadReadingHistory() {
    try {
        const all = await window.electronAPI.getAllProgress();
        const valid = [];
        for (const [filePath, data] of Object.entries(all)) {
            if (await window.electronAPI.checkFileExists(filePath)) valid.push([filePath, data]);
        }
        if (valid.length > 0) {
            readingHistory.style.display = 'block';

            // Build bookshelf
            bookshelf.innerHTML = '';
            valid.sort((a, b) => new Date(b[1].lastRead) - new Date(a[1].lastRead)).forEach(([filePath, data]) => {
                const progress = Math.round((data.currentPage / data.totalPages) * 100);
                const bookItem = document.createElement('div');
                bookItem.className = 'book-item';
                bookItem.innerHTML = `
                    <div class="book-cover">📖</div>
                    <div class="book-info">
                        <div class="book-title" title="${data.fileName}">${data.fileName}</div>
                        <div class="book-progress">อ่านแล้ว ${progress}% (${data.currentPage}/${data.totalPages})</div>
                        <div class="book-progress-bar">
                            <div class="book-progress-fill" style="width: ${progress}%"></div>
                        </div>
                    </div>
                `;
                bookItem.onclick = async () => {
                    const res = await window.electronAPI.openFileDirect(filePath);
                    if (res) await loadPDF(res);
                };
                bookshelf.appendChild(bookItem);
            });

            // Main Screen History (Now displayed as Grid of Cards)
            historyList.innerHTML = '';
            valid.sort((a, b) => new Date(b[1].lastRead) - new Date(a[1].lastRead)).slice(0, 12).forEach(([filePath, data]) => {
                const progress = Math.round((data.currentPage / data.totalPages) * 100);
                const bookItem = document.createElement('div');
                bookItem.className = 'book-item';
                bookItem.innerHTML = `
                    <div class="book-cover">📖</div>
                    <div class="book-info">
                        <div class="book-title" title="${data.fileName}">${data.fileName}</div>
                        <div class="book-progress">อ่านแล้ว ${progress}% (${data.currentPage}/${data.totalPages})</div>
                        <div class="book-progress-bar">
                            <div class="book-progress-fill" style="width: ${progress}%"></div>
                        </div>
                    </div>
                `;
                bookItem.onclick = async () => {
                    const res = await window.electronAPI.openFileDirect(filePath);
                    if (res) await loadPDF(res);
                };
                historyList.appendChild(bookItem);
            });
        }
        return valid;
    } catch (e) { return []; }
}

function toggleLibrary() {
    libraryOverlay.classList.toggle('show');
    if (libraryOverlay.classList.contains('show')) {
        loadReadingHistory();
    }
}

function hideLibrary() {
    libraryOverlay.classList.remove('show');
}

function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
function setupDragAndDrop() {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(n => document.body.addEventListener(n, preventDefaults));
    document.body.addEventListener('drop', async (e) => {
        if (e.dataTransfer.files.length) {
            const file = e.dataTransfer.files[0];
            if (file.name && file.name.toLowerCase().endsWith('.epub')) {
                // For drag & drop EPUB, we need the full path; pass file to loadPDFFromFile which handles it
                await loadPDFFromFile(file);
            } else {
                await loadPDFFromFile(file);
            }
        }
    });
}

function setupHandDragScroll() {
    let isDragging = false;
    let startX, startY, scrollLeft, scrollTop;
    pdfContainer.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const t = e.target;
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'SELECT' || t.closest('.highlight-overlay') || t.closest('.context-highlight')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        scrollLeft = pdfContainer.scrollLeft;
        scrollTop = pdfContainer.scrollTop;
        pdfContainer.style.cursor = 'grabbing';
        pdfContainer.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        pdfContainer.scrollLeft = scrollLeft - (e.clientX - startX);
        pdfContainer.scrollTop = scrollTop - (e.clientY - startY);
    });
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            pdfContainer.style.cursor = '';
            pdfContainer.style.userSelect = '';
        }
    });
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

function updateOfflineModeUi() {
    const offlineModeToggle = document.getElementById('offlineModeToggle');
    const offlineModeLabel = document.getElementById('offlineModeLabel');
    if (offlineModeToggle) offlineModeToggle.checked = isOfflineMode;
    if (offlineModeLabel) offlineModeLabel.textContent = isOfflineMode ? 'Offline' : 'Online';
}

function restoreOfflineModeForCurrentDocument() {
    const key = `document:${currentFileName.toLowerCase()}`;
    isOfflineMode = !!offlineDocuments[key];
    updateOfflineModeUi();
    setOfflineModeForWebviews();
}

function setOfflineModeForWebviews() {
    [geminiWebview, prefetchWebview].forEach((webview) => {
        if (!webview) return;
        webview.executeJavaScript(`window.__ebookOfflineMode = ${isOfflineMode ? 'true' : 'false'}; window.__ebookTtsStop && window.__ebookTtsStop();`).catch(() => {});
    });
    if (isOfflineMode) stopActiveTts();
}

// PDF and Gemini live in different panes.  These controls intentionally keep the
// PDF wheel for navigating the generated list instead of scrolling the canvas.
function runGeminiReadingCommand(command) {
    if (!geminiWebview) return;
    geminiWebview.executeJavaScript(`window.__ebookPdfCommand && window.__ebookPdfCommand(${JSON.stringify(command)})`)
        .catch(() => {});
}

async function autoSaveOfflineCurrentResponse(attempt = 0, requireFreshHighlight = false) {
    if (!isOfflineMode || !pdfDoc || !geminiWebview) return;
    const maxWaitAttempts = 14; // about 5 seconds; skip an unmatchable item promptly
    // Gemini can announce completion while the response DOM is still streaming.
    // Require a settled response and an attached, enabled Save button first.
    try {
        const ready = await geminiWebview.executeJavaScript(`(() => {
            const container = document.querySelector('.focus-response-container') ||
                Array.from(document.querySelectorAll('message-content, .model-response-text, [data-test-id="model-response"]')).pop();
            if (!container || window.lastStatus !== 'DONE') return false;
            return !!container.querySelector('.li-save-btn:not([disabled])');
        })()`);
        if (!ready) {
            if (attempt < maxWaitAttempts) { setTimeout(() => autoSaveOfflineCurrentResponse(attempt + 1, requireFreshHighlight), 350); return; }
            skipOfflineLiWithoutSaving();
            return;
        }
    } catch (e) {
        if (attempt < maxWaitAttempts) { setTimeout(() => autoSaveOfflineCurrentResponse(attempt + 1, requireFreshHighlight), 350); return; }
    }
    // triggerHighlight() sends its request across webview/host asynchronously.
    // Do not click Save until a PDF highlight (the focused image/area) is ready.
    if ((requireFreshHighlight && !window.lastHighlightPromise) || !document.querySelector('.highlight-overlay')) {
        if (attempt < maxWaitAttempts) {
            setTimeout(() => autoSaveOfflineCurrentResponse(attempt + 1, requireFreshHighlight), 350);
            return;
        }
        window.offlineAutoSaveTriggered = false;
        skipOfflineLiWithoutSaving();
        return;
    }
    if (window.lastHighlightPromise) {
        let highlightResult = null;
        try { highlightResult = await window.lastHighlightPromise; } catch (e) { console.warn('Offline auto-save highlight failed:', e); }
        window.lastHighlightPromise = null;
        // Smart image matching may return no region, while the text fallback has
        // already drawn a highlight overlay. In that case capture the closest
        // matching text viewport instead of skipping the <li>.
        if ((!highlightResult || !highlightResult.region) && !document.querySelector('.highlight-overlay')) {
            skipOfflineLiWithoutSaving();
            return;
        }
    }
    try {
        // The response DOM is streamed asynchronously. Find its Save button directly
        // and retry briefly until the injected controls have attached.
        const clicked = await geminiWebview.executeJavaScript(`(() => {
            const container = document.querySelector('.focus-response-container') ||
                Array.from(document.querySelectorAll('message-content, .model-response-text, [data-test-id="model-response"]')).pop();
            if (!container) return false;
            const active = container.querySelector('li.active-focus .li-save-btn:not([disabled])');
            const first = container.querySelector('.li-save-btn:not([disabled])');
            const button = active || first;
            if (!button) return false;
            button.click();
            return true;
        })()`);
        if (clicked) return;
    } catch (e) {
        console.warn('Offline auto-save command failed:', e);
    }
    if (attempt < 24 && isOfflineMode && pdfDoc) {
        setTimeout(() => autoSaveOfflineCurrentResponse(attempt + 1, requireFreshHighlight), 350);
    } else {
        window.offlineAutoSaveTriggered = false;
        skipOfflineLiWithoutSaving();
    }
}

function skipOfflineLiWithoutSaving() {
    if (!isOfflineMode || window.offlineSequenceEnded) return;
    showToast('ตำแหน่งนี้หาไม่เจอ — ข้ามไปสรุปถัดไป', 'warning');
    window.lastHighlightPromise = null;
    runGeminiReadingCommand('next');
    setTimeout(() => {
        if (!window.offlineSequenceEnded) autoSaveOfflineCurrentResponse(0, true);
    }, 900);
}

function stopActiveTts() {
    // Invalidate pending async Edge-TTS requests as well as stopping the audio
    // already playing in the host window.
    window.edgeTtsGeneration = (window.edgeTtsGeneration || 0) + 1;
    if (window.__edgeAudio) {
        window.__edgeAudio.pause();
        if (window.__edgeAudio._ebookUrl) URL.revokeObjectURL(window.__edgeAudio._ebookUrl);
        window.__edgeAudio.remove();
        window.__edgeAudio = null;
    }
    if (geminiWebview) geminiWebview.executeJavaScript('window.__ebookTtsStop && window.__ebookTtsStop()').catch(() => {});
}

function showPdfSaveMark(x, y) {
    const mark = document.createElement('span');
    mark.textContent = '✓';
    mark.setAttribute('aria-hidden', 'true');
    mark.style.cssText = 'position:fixed;z-index:10000;pointer-events:none;color:#22c55e;font-size:26px;font-weight:800;text-shadow:0 1px 4px #000;left:' + x + 'px;top:' + y + 'px;transform:translate(-50%,-50%) scale(.7);opacity:0;transition:opacity .12s,transform .35s;';
    document.body.appendChild(mark);
    requestAnimationFrame(() => { mark.style.opacity = '1'; mark.style.transform = 'translate(-50%,-50%) scale(1)'; });
    setTimeout(() => { mark.style.opacity = '0'; }, 450);
    setTimeout(() => mark.remove(), 850);
}

function setupPdfTabControls() {
    let wheelLocked = false;
    // Keep a short motion trail so the ✓ recognition works whether the stroke is
    // drawn quickly, slowly, or with many intermediate mouse events.
    let mouseTrail = [];
    let lastCheckSaveAt = 0;
    pdfContainer.addEventListener('contextmenu', (e) => {
        if (!pdfDoc) return;
        e.preventDefault();
        runGeminiReadingCommand('save');
        showPdfSaveMark(e.clientX, e.clientY);
    });
    pdfContainer.addEventListener('wheel', (e) => {
        if (!pdfDoc || wheelLocked || !e.deltaY) return;
        e.preventDefault();
        wheelLocked = true;
        runGeminiReadingCommand(e.deltaY > 0 ? 'next' : 'previous');
        setTimeout(() => { wheelLocked = false; }, 140);
    }, { passive: false });
    pdfContainer.addEventListener('mousemove', (e) => {
        if (!pdfDoc || e.buttons) { mouseTrail = []; return; }
        const now = Date.now();
        const last = mouseTrail[mouseTrail.length - 1];
        // A pause means the next motion is a new gesture, not continuation of
        // ordinary cursor movement that happened before it.
        if (last && now - last.time > 220) mouseTrail = [];
        mouseTrail.push({ x: e.clientX, y: e.clientY, time: now });
        mouseTrail = mouseTrail.filter((point) => now - point.time <= 1500);
        if (mouseTrail.length < 3 || now - lastCheckSaveAt < 650) return;
        const end = mouseTrail[mouseTrail.length - 1];
        // Find the best start and lowest bend anywhere in the recent path.  This
        // tolerates a little cursor movement before the user begins the ✓.
        let isCheck = false;
        for (let startIndex = 0; startIndex < mouseTrail.length - 2 && !isCheck; startIndex++) {
            let bendIndex = startIndex + 1;
            for (let i = bendIndex + 1; i < mouseTrail.length - 1; i++) {
                if (mouseTrail[i].y > mouseTrail[bendIndex].y) bendIndex = i;
            }
            const start = mouseTrail[startIndex];
            const bend = mouseTrail[bendIndex];
            const firstDx = bend.x - start.x;
            const firstDy = bend.y - start.y;
            const secondDx = end.x - bend.x;
            const secondDy = end.y - bend.y;
            const firstSlope = firstDy / Math.max(firstDx, 1);
            const secondSlope = -secondDy / Math.max(secondDx, 1);
            isCheck = firstDx >= 7 && firstDy >= 8 && firstSlope >= 0.16 && firstSlope <= 5 &&
                secondDx >= 12 && -secondDy >= 10 && secondSlope >= 0.18 && secondSlope <= 6 &&
                end.x - start.x >= 20;
        }
        if (isCheck) {
            if (isOfflineMode) {
                if (currentPage + batchSize <= totalPages) {
                    goToPage(currentPage + batchSize);
                    showToast('เปลี่ยนหน้าถัดไป', 'info');
                } else {
                    showToast('ถึงหน้าสุดท้ายแล้ว', 'info');
                }
            } else {
                runGeminiReadingCommand('save');
            }
            showPdfSaveMark(e.clientX, e.clientY);
            lastCheckSaveAt = now;
            mouseTrail = [];
        }
    });
}

let uploadStatusTimer = null;
function setUploadStatus(percent, detail, state = 'loading', title = 'กำลังบันทึกภาพและข้อมูล') {
    const popup = document.getElementById('uploadStatus');
    const titleEl = document.getElementById('uploadStatusTitle');
    const detailEl = document.getElementById('uploadStatusDetail');
    const fill = document.getElementById('uploadStatusFill');
    const percentEl = document.getElementById('uploadStatusPercent');
    if (!popup || !titleEl || !detailEl || !fill || !percentEl) return;

    if (uploadStatusTimer) clearTimeout(uploadStatusTimer);
    const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
    titleEl.textContent = title;
    detailEl.textContent = detail;
    percentEl.textContent = `${safePercent}%`;
    fill.style.width = `${safePercent}%`;
    popup.className = `upload-status show ${state === 'loading' ? '' : state}`.trim();
    popup.setAttribute('aria-hidden', 'false');

    if (state === 'success') {
        uploadStatusTimer = setTimeout(() => {
            popup.className = 'upload-status';
            popup.setAttribute('aria-hidden', 'true');
        }, 5500);
    }
}

function reportUploadProgress(options, percent, detail) {
    if (options && typeof options.onProgress === 'function') options.onProgress(percent, detail);
}

// ปุ่ม Save ที่ไม่มีกรอบภาพจะมาทาง __GITHUB_SAVE__ โดยตรง
// ให้มี popup แถบเปอร์เซ็นต์เหมือนเส้นทางอัปโหลดภาพด้วย ไม่ปล่อยให้หายเป็น toast เดี่ยว
async function saveTextToGitHubWithProgress(text) {
    if (!text) return { ok: false };
    if (!GITHUB_TOKEN) {
        setUploadStatus(0, 'ไม่ได้ตั้งค่า GitHub Token', 'error', 'บันทึกไม่สำเร็จ');
        return { ok: false };
    }
    setUploadStatus(8, 'กำลังเตรียมข้อความสำหรับบันทึก…', 'loading', 'กำลังบันทึกข้อมูล');
    const options = {
        silent: true,
        onProgress: (percent, detail) => setUploadStatus(percent, detail, 'loading', 'กำลังบันทึกข้อมูล')
    };
    const saved = await updateGitHubFileV2(text, null, options);
    if (!saved.ok) {
        setUploadStatus(100, 'บันทึกข้อมูลลง GitHub ไม่สำเร็จ', 'error', 'บันทึกไม่สำเร็จ');
    } else {
        setUploadStatus(100, `บันทึกที่ ${saved.filename} บรรทัด ${saved.line}`, 'success', 'บันทึกข้อมูลสำเร็จ ✓');
    }
    return saved;
}

/**
 * Fast image-block save: find page from cache, find image block, render 3.5x, upload.
 * Returns { ok: true/false } or null if no image block found.
 */
async function uploadTextAndImageWithBlock(text) {
    if (!text || !GITHUB_TOKEN) return null;

    const anchor = findEnglishAnchor(text);
    if (!anchor) {
        console.log('[FastBlock] No English anchor found in text');
        return null;
    }
    console.log('[FastBlock] Anchor:', anchor);

    setUploadStatus(5, `ค้นหาหน้าสำหรับ anchor: ${anchor}…`);

    const pageNum = findFastPageForAnchor(anchor);
    if (!pageNum) {
        console.log('[FastBlock] No page found for anchor');
        setUploadStatus(100, 'ไม่พบหน้าที่มีคำค้นนี้ใน cache', 'error', 'บันทึกไม่สำเร็จ');
        return null;
    }
    console.log('[FastBlock] Found page:', pageNum);

    setUploadStatus(15, `พบหน้าที่ ${pageNum} กำลังหาภาพประกอบ…`);

    const imageBlock = findFastImageBlock(pageNum);
    if (!imageBlock) {
        console.log('[FastBlock] No image block on page');
        return null;
    }
    console.log('[FastBlock] Image block:', Math.round(imageBlock.w) + 'x' + Math.round(imageBlock.h));

    setUploadStatus(25, `พบภาพขนาด ${Math.round(imageBlock.w)}x${Math.round(imageBlock.h)} กำลังเรนเดอร์ 3.5x…`);

    const dataUrl = await captureImageBlockHighRes(pageNum, imageBlock);
    if (!dataUrl) {
        console.log('[FastBlock] High-res capture failed');
        return null;
    }
    console.log('[FastBlock] High-res capture done, length:', dataUrl.length);

    // Upload image to GitHub
    const targetFolder = await findLatestScreenshotFolder();
    const timestamp = Date.now();
    const filename = `block_${pageNum}_${timestamp}.jpg`;
    const imagePath = `${targetFolder}/${filename}`;
    const base64Data = dataUrl.split(',')[1];

    setUploadStatus(45, 'กำลังอัปโหลดภาพความละเอียดสูง…');

    const uploadUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${imagePath}`;
    let uploadRes;
    for (let attempt = 1; attempt <= 3; attempt++) {
        uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `Upload block image ${filename}`,
                content: base64Data,
                branch: GITHUB_BRANCH
            })
        });
        if (uploadRes.ok) break;
        if ((uploadRes.status === 502 || uploadRes.status === 503) && attempt < 3) {
            await new Promise(r => setTimeout(r, 1500 * attempt));
            continue;
        }
        break;
    }

    if (!uploadRes.ok) {
        setUploadStatus(100, 'อัปโหลดภาพไม่สำเร็จ (HTTP ' + uploadRes.status + ')', 'error', 'บันทึกไม่สำเร็จ');
        return null;
    }

    const imageUrl = `https://${GITHUB_USER}.github.io/${GITHUB_REPO}/${imagePath}`;
    setUploadStatus(70, 'อัปโหลดภาพสำเร็จ กำลังบันทึกข้อมูล…');

    const saved = await updateGitHubFileV2(text, imageUrl, {
        silent: true,
        onProgress: (pct, detail) => setUploadStatus(70 + Math.round(pct * 0.25), detail)
    });

    if (!saved.ok) {
        setUploadStatus(100, 'อัปโหลดภาพแล้ว แต่บันทึกข้อมูลไม่สำเร็จ', 'error', 'บันทึกไม่สำเร็จ');
        return null;
    }

    setUploadStatus(100, `ภาพ 3.5x + ข้อมูล บันทึกที่ ${saved.filename} บรรทัด ${saved.line}`, 'success', 'บันทึกสำเร็จ ✓');
    return { ok: true };
}

document.addEventListener('DOMContentLoaded', init);

function openShareModal(text) {
    const shareModal = document.getElementById('shareModal');
    const shareText = document.getElementById('shareText');
    const sharePreviewContainer = document.getElementById('sharePreviewContainer');
    const shareImagePreview = document.getElementById('shareImagePreview');
    const pdfCanvas = document.getElementById('pdfCanvas');

    if (shareModal && shareText) {
        shareText.value = text.trim();

        // Capture screenshot
        const activeCanvas = document.querySelector('.pdf-canvas-item') || document.getElementById('pdfCanvas');
        if (activeCanvas && shareImagePreview && sharePreviewContainer) {
            try {
                // Use JPEG 0.8 quality
                const dataUrl = activeCanvas.toDataURL('image/jpeg', 0.8);
                shareImagePreview.src = dataUrl;
                sharePreviewContainer.style.display = 'block';
            } catch (e) {
                console.error('Screenshot error:', e);
                sharePreviewContainer.style.display = 'none';
            }
        }

        shareModal.style.visibility = 'visible';
        shareModal.classList.add('show');
        setTimeout(() => shareText.focus(), 100);
    }
}

async function embedTextToImage(sourceCanvas, text, keywords = [], targetPageNum = null) {
    if (!sourceCanvas) return null;

    const canvas = document.createElement('canvas');
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    const ctx = canvas.getContext('2d');

    // 1. Draw PDF Background
    ctx.drawImage(sourceCanvas, 0, 0);

    // 2. Precise Red Rings (Search all pages in the current batch)
    if (keywords.length > 0 && pdfDoc) {
        try {
            // If targetPageNum is provided, strictly search ONLY that page
            const startPage = targetPageNum ? targetPageNum : currentPage;
            const endPage = targetPageNum ? targetPageNum : Math.min(currentPage + batchSize - 1, totalPages);

            let bestPageNum = startPage;
            let bestMatches = [];
            let maxMatchCount = 0;

            // Search for keywords across the specified range (or single page)
            for (let pNum = startPage; pNum <= endPage; pNum++) {
                const page = await pdfDoc.getPage(pNum);
                const content = await page.getTextContent();
                // Use global scale to match the sourceCanvas dimensions
                const viewport = page.getViewport({ scale: scale });
                let pageMatches = [];

                // 1. Build Normalized Text Map (Sequence Matching)
                let fullTextNorm = "";
                let charMap = []; // Index -> Item

                content.items.forEach(item => {
                    const str = item.str;
                    if (!str) return;
                    for (let char of str) {
                        // Only alphanumeric + Thai
                        if (/[a-zA-Z0-9\u0E00-\u0E7F]/.test(char)) {
                            fullTextNorm += char.toLowerCase();
                            charMap.push(item);
                        }
                    }
                });

                keywords.forEach(function (kw) {
                    let searchTarget = kw;
                    const engMatch = kw.match(/\(([^)]+)\)/);
                    if (engMatch) searchTarget = engMatch[1];

                    // Normalize Target
                    const targetNorm = searchTarget.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/g, '');
                    if (targetNorm.length < 2) return;

                    // Sequence Search
                    let searchIdx = 0;
                    while (true) {
                        const idx = fullTextNorm.indexOf(targetNorm, searchIdx);
                        if (idx === -1) break;

                        // Collect Items for this occurrence of the phrase
                        for (let i = idx; i < idx + targetNorm.length; i++) {
                            const item = charMap[i];
                            if (item) {
                                const tx = item.transform;
                                const fontHeight = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]); // Robust height calc
                                // Convert to viewport point (PDF coords are bottom-left)
                                // Standard PDF: x, y is bottom-left of baseline.
                                // We need top-left for canvas rect.
                                // y_top_left = (viewport_height - y_pdf_bottom_left * scale) - fontHeight * scale

                                // Let's use viewport.convertToViewportRectangle if possible, or manual.
                                // Viewport.convertToViewportPoint([x, y]) returns [px, py]

                                // Correct Logic using Viewport:
                                // [x, y] in PDF is bottom-left of baseline.
                                // We want the bounding box.
                                // Approx: x, y, width, fontHeight.

                                const x = tx[4];
                                const y = tx[5];
                                const w = item.width;
                                const h = item.height || fontHeight;

                                // Project coordinates
                                // Note: convertToViewportPoint handles the Y-flip and scale
                                // p_bl = bottom-left
                                const p_bl = viewport.convertToViewportPoint(x, y);
                                // p_tr = top-right (x+w, y+h)
                                const p_tr = viewport.convertToViewportPoint(x + w, y + h);

                                // Canvas coords:
                                // left = p_bl[0]
                                // top = p_tr[1] (since p_tr[1] is smaller value in canvas Y usually? Wait. 
                                // PDF Y=0 is bottom. Canvas Y=0 is top.
                                // viewport.convertToViewportPoint converts PDF(0,0) -> Canvas(0, height).
                                // So higher PDF Y -> Lower Canvas Y.
                                // So p_tr[1] (top-right) should be SMALLER than p_bl[1] (bottom-left).

                                const left = Math.min(p_bl[0], p_tr[0]);
                                const right = Math.max(p_bl[0], p_tr[0]);
                                const top = Math.min(p_bl[1], p_tr[1]);
                                const bottom = Math.max(p_bl[1], p_tr[1]);

                                pageMatches.push({
                                    cx: left, cy: top, cw: right - left, ch: bottom - top
                                });
                            }
                        }
                        searchIdx = idx + 1;
                    }
                });

                if (pageMatches.length > maxMatchCount) {
                    maxMatchCount = pageMatches.length;
                    bestPageNum = pNum;
                    bestMatches = pageMatches;
                }
            }

            // Draw the rings on the BEST page found
            if (bestMatches.length > 0) {
                // We need to redraw the specific page that matches best matches
                // But we only have `sourceCanvas` which is likely the CURRENT view.
                // If the best match is on a different page, we should try to fetch that page render if possible.
                // However, doing a full render here is async and complex.
                // For now, we only draw rings if bestPageNum is indeed the current page or we accept drawing on current.

                // Better approach: If we found matches on *some* page, we draw them on top of sourceCanvas
                // ONLY if the sourceCanvas corresponds to that page?
                // The User likely wants the image to show the Context.
                // If `shareToLine` logic selected the `bestCanvas` already, then `sourceCanvas` IS `bestCanvas`.
                // So we can assume `sourceCanvas` matches the page where we search?
                // Wait, `shareToLine` logic uses `startPage`... no, `shareToLine` passes `activeCanvas`.
                // BUT `embedTextToImage` here iterates `pdfDoc` again.
                // We should assume `sourceCanvas` is the visual representation of `bestMatches`?
                // Let's trust `bestMatches` coordinates map to `sourceCanvas` if the page is the same.
                // Since `shareToLine` tries to pick the best canvas, hopefully it aligns.
                // To be safe, we just draw what we found.

                ctx.save();
                ctx.strokeStyle = '#ff2121';
                ctx.lineWidth = 5; // Thicker
                ctx.shadowBlur = 0; // Clearer line
                // ctx.shadowColor = 'rgba(255, 0, 0, 0.5)';

                // --- CLUSTERING LOGIC ---
                let clusters = [];
                bestMatches.forEach(m => {
                    const midX = m.cx + m.cw / 2;
                    const midY = m.cy + m.ch / 2;
                    let found = false;
                    for (let c of clusters) {
                        const dist = Math.hypot(midX - c.x, midY - c.y);
                        if (dist < 120) { // Cluster radius
                            c.minX = Math.min(c.minX, m.cx);
                            c.minY = Math.min(c.minY, m.cy);
                            c.maxX = Math.max(c.maxX, m.cx + m.cw);
                            c.maxY = Math.max(c.maxY, m.cy + m.ch);
                            c.x = (c.minX + c.maxX) / 2;
                            c.y = (c.minY + c.maxY) / 2;
                            c.count++;
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        clusters.push({
                            minX: m.cx, minY: m.cy, maxX: m.cx + m.cw, maxY: m.cy + m.ch,
                            x: midX, y: midY, count: 1
                        });
                    }
                });

                clusters.sort((a, b) => b.count - a.count);
                const topClusters = clusters.slice(0, 5);

                topClusters.forEach(c => {
                    const w = c.maxX - c.minX;
                    const h = c.maxY - c.minY;
                    ctx.beginPath();
                    const padX = 12;
                    const padY = 8;
                    // Draw Simple Rect (Safer than roundRect)
                    ctx.rect(c.minX - padX, c.minY - padY, w + (padX * 2), h + (padY * 2));
                    ctx.stroke();
                });

                ctx.restore();
            }
        } catch (e) { console.error("Highlight error:", e); }
    }

    // 3. Layout Text (Legacy Logic)
    let fontSize = 25;
    const padding = 43;
    const cardW = canvas.width * 0.92;
    const cardMargin = (canvas.width - cardW) / 2;
    const maxTextWidth = cardW - (padding * 2);
    const maxCardHeight = canvas.height * 0.78;

    let lines = [];
    let lineHeight = 30;

    function layoutText(fSize) {
        const lH = Math.floor(fSize * 1.4);
        ctx.font = fSize + "px Arial, sans-serif";
        const paragraphs = text.split('\n');
        let currentLines = [];

        paragraphs.forEach(function (p) {
            if (!p.trim()) { currentLines.push(""); return; }

            // Smarter Wrapping (Thai-safe fallback)
            let words = p.split(' ');
            let current = "";

            for (let i = 0; i < words.length; i++) {
                let test = current + (current ? " " : "") + words[i];
                if (ctx.measureText(test).width < maxTextWidth) {
                    current = test;
                } else {
                    if (ctx.measureText(words[i]).width >= maxTextWidth) {
                        if (current) currentLines.push(current);
                        current = "";
                        for (let char of words[i]) {
                            if (ctx.measureText(current + char).width < maxTextWidth) {
                                current += char;
                            } else {
                                currentLines.push(current);
                                current = char;
                            }
                        }
                    } else {
                        currentLines.push(current);
                        current = words[i];
                    }
                }
            }
            if (current) currentLines.push(current);
        });
        return { lines: currentLines, height: (currentLines.length * lH) + (padding * 2), lineHeight: lH };
    }

    let layout = layoutText(fontSize);
    while (layout.height > maxCardHeight && fontSize > 13) {
        fontSize -= 1;
        layout = layoutText(fontSize);
    }
    lines = layout.lines;
    lineHeight = layout.lineHeight;
    const textHeight = layout.height;

    // 4. Draw Card Background
    const cardY = (canvas.height - textHeight) / 2;
    // cardMargin is already defined above

    ctx.save();
    ctx.shadowBlur = 50;
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    // Reduced opacity from 0.95 to 0.70 to show background highlights
    ctx.fillStyle = 'rgba(15, 15, 20)';
    ctx.beginPath();
    // Use manual rounded rect or simple rect for safety
    if (ctx.roundRect) {
        ctx.roundRect(cardMargin, cardY, cardW, textHeight, 30);
    } else {
        ctx.rect(cardMargin, cardY, cardW, textHeight);
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    // 5. Draw Text
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'white';
    let currentY = cardY + padding;

    lines.forEach(line => {
        if (!line) {
            currentY += lineHeight;
            return;
        }

        let x = cardMargin + padding;

        // 1. Check if the line corresponds to a keyword generally
        // This is a heuristic. For more precise granular matching, we'd need to map tokens to keywords.
        // Given the requirement is mostly "Highlight Thai Keywords", we can be aggressive:
        // Any Thai word that looks "Significant" or matches the `keywords` list should be Orange.
        // Simpler: Just match against the provided `keywords` list.

        // We iterate through the line, splitting by "Chunks" that might be keywords.
        // Actually, let's keep it simple: Split mixed Thai/English runs.

        // Split by Thai vs Non-Thai boundaries
        // Capture the delimiters (Thai sequences)
        const chunks = line.split(/([\u0E00-\u0E7F]+)/);

        chunks.forEach(chunk => {
            if (!chunk) return;

            const isThai = /[\u0E00-\u0E7F]/.test(chunk);
            let color = "white";
            let fontStyle = fontSize + "px Arial, sans-serif";

            if (isThai) {
                // It is Thai. Is it a keyword?
                // Check if this chunk is part of any keyword in the list
                let isKwMatch = false;
                // Optimization: Pre-combine keywords or use Set? List is small.
                for (let k of keywords) {
                    // Clean keyword: Remove non-thai to match against this thai chunk?
                    // Or just simple include check.
                    // If the chunk is "การขาย" and keyword is "การขาย", match.
                    // If chunk is "และ", likely not keyword.
                    // Checking `k.includes(chunk)` might false positive on common words.
                    // checking `chunk.includes(k)` works if chunk is phrase.

                    // Best approach for "Focus Mode" derived keywords:
                    // They are usually specific terms. 
                    if (k.includes(chunk) || chunk.includes(k)) {
                        isKwMatch = true;
                        break;
                    }
                }

                // If keywords list is empty (fallback), do we highlight? No.
                if (isKwMatch) {
                    color = "#fbbf24"; // Orange
                    fontStyle = "bold " + fontSize + "px Arial, sans-serif";
                }
            } else {
                // Non-Thai (English, Parens, Space, Punctuation) -> Always White
                color = "white";
                // Optional: Make English keywords Bold? User said "พร้อมทำตัวหนาคำอังกฤษ"
                // But specifically complained about Color.
                // Let's make it Bold if it matches a keyword, but WHITE.
                for (let k of keywords) {
                    if (k.toLowerCase().includes(chunk.toLowerCase()) && chunk.trim().length > 1) {
                        fontStyle = "bold " + fontSize + "px Arial, sans-serif";
                        break;
                    }
                }
            }

            ctx.font = fontStyle;
            ctx.fillStyle = color;
            ctx.fillText(chunk, x, currentY);
            x += ctx.measureText(chunk).width;
        });

        currentY += lineHeight;
    });

    // 6. Draw Book info inside the black card at bottom center (Red Font)
    ctx.save();
    let cleanedBookName = currentFileName.replace(/\.pdf$/i, '');
    cleanedBookName = cleanedBookName.split(' -- ')[0];
    cleanedBookName = cleanedBookName.split(' (')[0];
    cleanedBookName = cleanedBookName.replace(/_/g, '');
    cleanedBookName = cleanedBookName.replace(/\[[^\]]*\]/g, ''); // Remove text in brackets
    cleanedBookName = cleanedBookName.trim();

    const pageLabel = targetPageNum ? ` - หน้าที่ ${targetPageNum}` : "";
    let footerLine = `${cleanedBookName}${pageLabel}`;

    ctx.font = "bold 15px Arial, sans-serif";

    // Fit text within the black box bounds
    const maxFooterWidth = cardW - (padding * 2);
    if (ctx.measureText(footerLine).width > maxFooterWidth) {
        // Truncate the book name, preserving the page label
        let tempBookName = cleanedBookName;
        while (tempBookName.length > 0 && ctx.measureText(`${tempBookName}...${pageLabel}`).width > maxFooterWidth) {
            tempBookName = tempBookName.slice(0, -1);
        }
        footerLine = `${tempBookName}...${pageLabel}`;
    }

    ctx.fillStyle = "rgba(163, 163, 163, 1)";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    // Draw Divider Line (HR)
    ctx.beginPath();
    ctx.strokeStyle = "hsla(0, 0%, 46%, 1.00)";
    ctx.lineWidth = 1;
    const hrY = cardY + textHeight - 35;
    ctx.moveTo(cardMargin + padding, hrY);
    ctx.lineTo(cardMargin + cardW - padding, hrY);
    ctx.stroke();

    // Position inside the black card at the bottom
    ctx.fillText(footerLine, canvas.width / 2, cardY + textHeight - 12);
    ctx.restore();

    try {
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.error("Canvas Export Failed", e);
        return null;
    }
}

async function uploadScreenshotAndSave(text) {
    if (!text) return;
    if (!GITHUB_TOKEN) {
        setUploadStatus(0, 'ไม่ได้ตั้งค่า GitHub Token', 'error', 'บันทึกไม่สำเร็จ');
        return;
    }

    setUploadStatus(4, 'กำลังเตรียมภาพจากกรอบที่เลือก…');
    const progressOptions = {
        silent: true,
        onProgress: (percent, detail) => setUploadStatus(percent, detail)
    };

    const cleanText = text.replace(/[*_]/g, '').replace(/\[Image:[^\]]*\]/g, '').trim();

    try {
        // หา canvas และกรอบแดงที่ active
        const highlightOverlay = document.querySelector('.highlight-overlay');
        let activeCanvas = document.getElementById('pdfCanvas');
        if (highlightOverlay) {
            // use the canvas in the same wrapper as the overlay
            const wrapper = highlightOverlay.closest('[id^="page-wrapper-"]');
            if (wrapper) activeCanvas = wrapper.querySelector('canvas') || activeCanvas;
        }
        if (!activeCanvas) activeCanvas = document.querySelector('.pdf-canvas-item') || document.getElementById('pdfCanvas');

        if (!activeCanvas) {
            setUploadStatus(100, 'ไม่พบ PDF canvas', 'error', 'บันทึกไม่สำเร็จ');
            return;
        }

        let cropRegion = null;
        let pageNum = currentPage;

        // Screenshot = visible viewport เท่านั้น (ส่วนที่ zoom อยู่ตอนนี้ ไม่ใช่วงแดง ไม่ใช่ทั้งหน้า)
        const cont = document.getElementById('pdfContainer');
        const cv = activeCanvas;
        if (cont && cv) {
            const cR = cont.getBoundingClientRect();
            const aR = cv.getBoundingClientRect();
            const vL = Math.max(cR.left, aR.left);
            const vT = Math.max(cR.top, aR.top);
            const vR = Math.min(cR.right, aR.right);
            const vB = Math.min(cR.bottom, aR.bottom);
            if (vR > vL && vB > vT && aR.width > 0 && aR.height > 0) {
                const sx = cv.width / aR.width;
                const sy = cv.height / aR.height;
                cropRegion = {
                    x: (vL - aR.left) * sx,
                    y: (vT - aR.top) * sy,
                    w: (vR - vL) * sx,
                    h: (vB - vT) * sy
                };
                if (window.lastHighlightPageNum) pageNum = window.lastHighlightPageNum;
                console.log('[Screenshot] Visible viewport crop:', cropRegion, '| page:', pageNum);
            }
        }
        if (!cropRegion) {
            cropRegion = { x: 0, y: 0, w: activeCanvas.width, h: activeCanvas.height };
            console.log('[Screenshot] Fallback full canvas');
        }

        // สร้าง canvas สำหรับ crop
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        // กำหนดขนาด
        const footerHeight = 50;
        const maxWidth = 800;

        let sourceX, sourceY, sourceW, sourceH;

        if (cropRegion) {
            sourceX = Math.max(0, cropRegion.x);
            sourceY = Math.max(0, cropRegion.y);
            sourceW = Math.min(cropRegion.w, activeCanvas.width - sourceX);
            sourceH = Math.min(cropRegion.h, activeCanvas.height - sourceY);
        } else {
            sourceX = 0;
            sourceY = 0;
            sourceW = activeCanvas.width;
            sourceH = activeCanvas.height;
        }

        // Scale ถ้ากว้างเกินไป
        let finalW = sourceW;
        let finalH = sourceH;
        if (finalW > maxWidth) {
            const ratio = maxWidth / finalW;
            finalW = maxWidth;
            finalH = Math.round(finalH * ratio);
        }

        tempCanvas.width = finalW;
        tempCanvas.height = finalH + footerHeight;

        // วาดภาพ (เป็นสี ไม่แปลง grayscale)
        tempCtx.drawImage(
            activeCanvas,
            sourceX, sourceY, sourceW, sourceH,
            0, 0, finalW, finalH
        );

        // วาด Footer (พื้นดำ + ข้อความขาว)
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, finalH, finalW, footerHeight);

        // ชื่อหนังสือ
        let bookName = currentFileName.replace(/\.pdf$/i, '');
        bookName = bookName.split(' -- ')[0];
        bookName = bookName.split(' (')[0];
        bookName = bookName.replace(/_/g, ' ');
        bookName = bookName.replace(/\[[^\]]*\]/g, '').trim();

        const pageLabel = ` | หน้าที่ ${pageNum}`;
        let footerText = `${bookName}${pageLabel}`;
        const maxFooterW = finalW - 24;

        tempCtx.fillStyle = '#ffffff';
        tempCtx.textAlign = 'center';
        tempCtx.textBaseline = 'middle';

        let fontSize = 16;
        tempCtx.font = `bold ${fontSize}px Arial, sans-serif`;
        if (tempCtx.measureText(footerText).width > maxFooterW) {
            fontSize = 14;
            tempCtx.font = `bold ${fontSize}px Arial, sans-serif`;
        }
        if (tempCtx.measureText(footerText).width > maxFooterW) {
            fontSize = 12;
            tempCtx.font = `bold ${fontSize}px Arial, sans-serif`;
        }
        if (tempCtx.measureText(footerText).width > maxFooterW) {
            while (bookName.length > 0 && tempCtx.measureText(`${bookName}...${pageLabel}`).width > maxFooterW) {
                bookName = bookName.slice(0, -1);
            }
            footerText = `${bookName}...${pageLabel}`;
        }
        tempCtx.fillText(footerText, finalW / 2, finalH + footerHeight / 2);

        // Upload
        const targetFolder = await findLatestScreenshotFolder();
        const timestamp = Date.now();
        const filename = `screenshot_${timestamp}.jpg`;
        const imagePath = `${targetFolder}/${filename}`;

        let dataUrl;
        try {
            setUploadStatus(18, 'กำลังสร้างไฟล์ภาพ…');
            dataUrl = tempCanvas.toDataURL('image/jpeg', 0.85);
        } catch (e) {
            setUploadStatus(100, 'ไม่สามารถสร้างภาพหน้าจอได้', 'error', 'บันทึกไม่สำเร็จ');
            console.error('Canvas toDataURL failed:', e);
            return;
        }
        const base64Data = dataUrl.split(',')[1];

        const uploadUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${imagePath}`;
        setUploadStatus(35, `กำลังอัปโหลดภาพ ${filename}…`);
        let uploadRes;
        for (let attempt = 1; attempt <= 3; attempt++) {
            uploadRes = await fetch(uploadUrl, {
                method: 'PUT',
                headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: `Upload screenshot ${filename}`,
                    content: base64Data,
                    branch: GITHUB_BRANCH
                })
            });
            if (uploadRes.ok) break;
            if ((uploadRes.status === 502 || uploadRes.status === 503) && attempt < 3) {
                setUploadStatus(35, `อัปโหลดภาพไม่สำเร็จ กำลังลองใหม่ (${attempt}/3)…`);
                await new Promise(r => setTimeout(r, 1500 * attempt));
                continue;
            }
            break;
        }

        if (!uploadRes.ok) {
            const errData = await uploadRes.json().catch(() => ({}));
            setUploadStatus(100, `อัปโหลดภาพไม่สำเร็จ (HTTP ${uploadRes.status})`, 'error', 'บันทึกไม่สำเร็จ');
            console.error('GitHub image upload failed:', errData);
            return;
        }

        const imageUrl = `https://${GITHUB_USER}.github.io/${GITHUB_REPO}/${imagePath}`;
        setUploadStatus(70, 'อัปโหลดภาพสำเร็จ กำลังบันทึกข้อมูล…');

        const saved = await updateGitHubFileV2(cleanText, imageUrl, progressOptions);
        if (!saved.ok) {
            setUploadStatus(100, 'อัปโหลดภาพแล้ว แต่บันทึกข้อมูลลง GitHub ไม่สำเร็จ', 'error', 'บันทึกไม่สำเร็จ');
        } else {
            setUploadStatus(100, `อัปโหลดภาพและบันทึกที่ ${saved.filename} บรรทัด ${saved.line}`, 'success', 'บันทึกสำเร็จ ✓');
        }
    } catch (e) {
        console.error('Screenshot upload failed:', e);
        if (e.message && (e.message.includes('image.png') || e.message.includes('image input'))) {
            setUploadStatus(100, 'ไม่สามารถสร้างภาพหน้าจอได้', 'error', 'บันทึกไม่สำเร็จ');
        } else {
            setUploadStatus(100, 'บันทึกภาพหน้าจอไม่สำเร็จ', 'error', 'บันทึกไม่สำเร็จ');
        }
    }
}

function offlineEntryKey(text) {
    // Formatting may change between app versions; it must not create a second PDF record.
    const source = `${currentFileName.toLowerCase()}|${currentPage}|${text.replace(/[*_]/g, '')}`;
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
    return `${currentFilePath}|${currentPage}|${(hash >>> 0).toString(36)}`;
}

function captureOfflineFocusedViewport() {
    const container = document.getElementById('pdfContainer');
    const overlay = document.querySelector('.highlight-overlay');
    let canvas = document.querySelector('.pdf-canvas-item') || document.getElementById('pdfCanvas');
    if (overlay) {
        const wrapper = overlay.closest('[id^="page-wrapper-"]');
        if (wrapper) canvas = wrapper.querySelector('canvas') || canvas;
    }
    if (!container || !canvas) return null;

    // Crop the visible, zoomed viewport rather than exporting the entire PDF page.
    const viewportRect = container.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const left = Math.max(viewportRect.left, canvasRect.left);
    const top = Math.max(viewportRect.top, canvasRect.top);
    const right = Math.min(viewportRect.right, canvasRect.right);
    const bottom = Math.min(viewportRect.bottom, canvasRect.bottom);
    if (right <= left || bottom <= top || !canvasRect.width || !canvasRect.height) return null;

    const sourceX = (left - canvasRect.left) * canvas.width / canvasRect.width;
    const sourceY = (top - canvasRect.top) * canvas.height / canvasRect.height;
    const sourceW = (right - left) * canvas.width / canvasRect.width;
    const sourceH = (bottom - top) * canvas.height / canvasRect.height;
    const maxWidth = 1600;
    const factor = Math.min(1, maxWidth / sourceW);
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(sourceW * factor));
    output.height = Math.max(1, Math.round(sourceH * factor));
    const outputContext = output.getContext('2d');
    outputContext.drawImage(canvas, sourceX, sourceY, sourceW, sourceH, 0, 0, output.width, output.height);

    // The DOM highlight is not part of the PDF canvas bitmap, so reproduce its
    // red locator in the exported image.
    const focused = window.lastFocusedRegion;
    if (focused && focused.region) {
        const fw = focused.viewportWidth || canvas.width;
        const fh = focused.viewportHeight || canvas.height;
        const targetRect = {
            left: canvasRect.left + focused.region.x * canvasRect.width / fw,
            top: canvasRect.top + focused.region.y * canvasRect.height / fh,
            right: canvasRect.left + (focused.region.x + focused.region.w) * canvasRect.width / fw,
            bottom: canvasRect.top + (focused.region.y + focused.region.h) * canvasRect.height / fh
        };
        const clipLeft = Math.max(left, targetRect.left);
        const clipTop = Math.max(top, targetRect.top);
        const clipRight = Math.min(right, targetRect.right);
        const clipBottom = Math.min(bottom, targetRect.bottom);
        if (clipRight > clipLeft && clipBottom > clipTop) {
            const ox = (clipLeft - left) * output.width / (right - left);
            const oy = (clipTop - top) * output.height / (bottom - top);
            const ow = (clipRight - clipLeft) * output.width / (right - left);
            const oh = (clipBottom - clipTop) * output.height / (bottom - top);
            outputContext.save();
            outputContext.strokeStyle = '#ef2b2d';
            outputContext.lineWidth = Math.max(4, Math.round(output.width / 260));
            outputContext.shadowColor = 'rgba(0,0,0,.45)';
            outputContext.shadowBlur = 5;
            outputContext.strokeRect(ox, oy, ow, oh);
            outputContext.restore();
        }
    }
    return output.toDataURL('image/jpeg', 0.88);
}

async function saveOfflineSummary(text) {
    // Keep **keyword** markup so the exported PDF can render keywords in orange/bold.
    const cleanText = text.replace(/\[Image:[^\]]*\]/g, '').trim();
    if (!cleanText || !currentFilePath) return { ok: false };
    // The active <li> moves/zooms the PDF asynchronously; wait before capturing its viewport.
    if (window.lastHighlightPromise) {
        try { await window.lastHighlightPromise; } catch (e) { console.warn('Offline highlight wait failed:', e); }
        window.lastHighlightPromise = null;
    }
    const focusedImage = captureOfflineFocusedViewport();
    if (!focusedImage) {
        setUploadStatus(100, 'ไม่พบบริเวณ PDF ที่กำลังซูม', 'error', 'บันทึกไม่สำเร็จ');
        return { ok: false };
    }
    setUploadStatus(20, 'กำลังบันทึกภาพและข้อความลง PDF…', 'loading', 'Offline PDF');
    try {
        const result = await window.electronAPI.saveOfflineSummary({
            documentKey: `document:${currentFileName.toLowerCase()}`,
            documentName: currentFileName,
            entryKey: offlineEntryKey(cleanText),
            page: currentPage,
            text: cleanText,
            imageDataUrl: focusedImage
        });
        if (!result || !result.ok) {
            setUploadStatus(100, (result && result.error) || 'สร้าง PDF ไม่สำเร็จ', 'error', 'บันทึกไม่สำเร็จ');
            return { ok: false };
        }
        setUploadStatus(100, result.duplicate ? 'รายการนี้มีอยู่แล้ว — ไม่บันทึกซ้ำ' : `บันทึกที่ ${result.path}`, 'success', 'Offline PDF สำเร็จ ✓');
        // The button itself selects the next <li> after its save animation. Wait
        // for that item's new PDF highlight before saving it; never change pages.
        if (window.offlineSequenceActive && !window.offlineSequenceEnded) {
            setTimeout(() => autoSaveOfflineCurrentResponse(0, true), 1400);
        }
        return result;
    } catch (e) {
        console.error('Offline PDF save failed:', e);
        setUploadStatus(100, 'สร้าง PDF ไม่สำเร็จ', 'error', 'บันทึกไม่สำเร็จ');
        return { ok: false };
    }
}

async function openScreenshotPreview() {
    const activeCanvas = document.querySelector('.pdf-canvas-item') || document.getElementById('pdfCanvas');
    if (!activeCanvas) {
        showToast('ไม่พบ PDF canvas', 'error');
        return;
    }
    const dataUrl = activeCanvas.toDataURL('image/jpeg', 0.8);
    const shareModal = document.getElementById('shareModal');
    const shareText = document.getElementById('shareText');
    const sharePreviewContainer = document.getElementById('sharePreviewContainer');
    const shareImagePreview = document.getElementById('shareImagePreview');
    if (shareText) shareText.value = '';
    if (shareImagePreview && sharePreviewContainer) {
        shareImagePreview.src = dataUrl;
        sharePreviewContainer.style.display = 'block';
    }
    if (shareModal) {
        shareModal.style.visibility = 'visible';
        shareModal.classList.add('show');
    }
}

// --- BIGDATA HELPERS ---
let closedQueries = new Set();
let currentPopupQuery = null;

