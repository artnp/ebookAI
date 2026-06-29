const { app, BrowserWindow, ipcMain, dialog, session, shell, screen, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { exec } = require('child_process');

let mainWindow;

// Storage path for reading progress
const progressFilePath = path.join(app.getPath('userData'), 'reading-progress.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      nativeWindowOpen: true,
      webSecurity: true
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'PDF Gemini Reader'
  });

  // Set a very standard user agent to bypass 'insecure browser' check
  const chromeUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
  // Apply stealth UA to all requests in this session
  session.defaultSession.setUserAgent(chromeUA);

  mainWindow.loadFile('index.html');
  mainWindow.maximize();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only allow specific google login popups if needed, otherwise default deny/allow
    if (url.startsWith('https://accounts.google.com')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 600,
          autoHideMenuBar: true
        }
      };
    }

    // For all other external links, we want to open them in the default browser (Chrome)
    // We can deny the internal window and use shell.openExternal
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    // webContents.setUserAgent(chromeUA); // User agent is now set globally for the session
    webContents.setWindowOpenHandler(({ url }) => {
      // Allow Google login popups to open as native windows
      if (url.startsWith('https://accounts.google.com')) {
        return {
          action: 'allow', overrideBrowserWindowOptions: {
            width: 500,
            height: 600,
            autoHideMenuBar: true
          }
        };
      }
      return { action: 'deny' };
    });
  });
}


// Wait for app ready after all handlers are defined
console.log('[Main] Registering Lifecycle Events...');


// IPC Handlers
console.log('[Main] Registering IPC handlers...');

// Open file dialog
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Ebook Files', extensions: ['pdf', 'epub'] }]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    try {
      const fileBuffer = fs.readFileSync(filePath);
      return {
        path: filePath,
        name: path.basename(filePath),
        data: fileBuffer.toString('base64')
      };
    } catch (error) {
      console.error('Error reading file:', error);
      return null;
    }
  }
  return null;
});

// Open file directly by path
ipcMain.handle('open-file-direct', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath);
      return {
        path: filePath,
        name: path.basename(filePath),
        data: fileBuffer.toString('base64')
      };
    }
    return null;
  } catch (error) {
    console.error('Error opening file directly:', error);
    return null;
  }
});

// Check if file exists
ipcMain.handle('check-file-exists', async (event, filePath) => {
  try {
    return fs.existsSync(filePath);
  } catch (error) {
    return false;
  }
});

// Save reading progress
ipcMain.handle('save-progress', async (event, data) => {
  try {
    let progress = {};
    if (fs.existsSync(progressFilePath)) {
      progress = JSON.parse(fs.readFileSync(progressFilePath, 'utf-8'));
    }
    progress[data.filePath] = {
      currentPage: data.currentPage,
      totalPages: data.totalPages,
      batchSize: data.batchSize,
      lastRead: new Date().toISOString(),
      fileName: data.fileName
    };
    fs.writeFileSync(progressFilePath, JSON.stringify(progress, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving progress:', error);
    return false;
  }
});

// Load reading progress
ipcMain.handle('load-progress', async (event, filePath) => {
  try {
    if (fs.existsSync(progressFilePath)) {
      const progress = JSON.parse(fs.readFileSync(progressFilePath, 'utf-8'));
      return progress[filePath] || null;
    }
    return null;
  } catch (error) {
    console.error('Error loading progress:', error);
    return null;
  }
});

// Get all reading progress (for history)
ipcMain.handle('get-all-progress', async () => {
  try {
    if (fs.existsSync(progressFilePath)) {
      return JSON.parse(fs.readFileSync(progressFilePath, 'utf-8'));
    }
    return {};
  } catch (error) {
    console.error('Error getting all progress:', error);
    return {};
  }
});

// Cleanup progress - remove entries for deleted files
ipcMain.handle('cleanup-progress', async () => {
  try {
    if (fs.existsSync(progressFilePath)) {
      const progress = JSON.parse(fs.readFileSync(progressFilePath, 'utf-8'));
      const cleanedProgress = {};

      for (const [filePath, data] of Object.entries(progress)) {
        if (fs.existsSync(filePath)) {
          cleanedProgress[filePath] = data;
        }
      }

      fs.writeFileSync(progressFilePath, JSON.stringify(cleanedProgress, null, 2));
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error cleaning up progress:', error);
    return false;
  }
});

// Open external URL in browser
ipcMain.handle('open-external', async (event, url) => {
  try {
    // Check if it's the specific LINE VOOM URL for automation
    if (url.includes('linevoom.line.me/user/')) {
      openLineAutomationWindow(url);
      return true;
    }
    await shell.openExternal(url);
    return true;
  } catch (error) {
    console.error('Error opening external URL:', error);
    return false;
  }
});


let lineWindow = null;
let currentLineVideoPath = null;
let currentLineText = null;
let isAutomationActive = false;

function openLineAutomationWindow(url, options = {}) {
  if (lineWindow) {
    lineWindow.focus();
    return;
  }

  isAutomationActive = options.active || false;
  currentLineVideoPath = options.videoPath || null;
  currentLineText = options.postText || null;

  lineWindow = new BrowserWindow({
    width: 600,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-line.js'),
      webSecurity: false
    }
  });

  lineWindow.loadURL(url);

  lineWindow.on('closed', () => {
    lineWindow = null;
    currentLineVideoPath = null;
    currentLineText = null;
    isAutomationActive = false;
  });

  try {
    lineWindow.webContents.debugger.attach('1.3');
  } catch (err) {
    console.error('Debugger attach failed:', err);
  }

  lineWindow.webContents.on('select-file-dialog', async (event, details) => {
    event.preventDefault();
    // Fallback if the click works
    const desktopPath = app.getPath('desktop');
    const filePath = path.join(desktopPath, 'ebookai_line.png');
    if (fs.existsSync(filePath)) {
      try {
        // Try debugger method first
        const { root } = await lineWindow.webContents.debugger.sendCommand('DOM.getDocument');
        const { nodeId } = await lineWindow.webContents.debugger.sendCommand('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: 'input[type="file"]'
        });
        if (nodeId) {
          await lineWindow.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
            nodeId: nodeId,
            files: [filePath]
          });
          await lineWindow.webContents.executeJavaScript(`
                    const input = document.querySelector('input[type="file"]');
                    if(input) {
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                `);
        }
      } catch (e) {
        // Standard fallback
        event.sender.sendSelectedFiles([filePath]);
      }
    }
  });
}

// New IPC: Trigger LINE VOOM with options
ipcMain.handle('trigger-line-voom', async (event, options) => {
  const lineUrl = 'https://linevoom.line.me/user/_dd9JDo889wfojzv17U8LwAKX2-hN4oDNIStQBfQ';
  openLineAutomationWindow(lineUrl, options);
  return true;
});

// IPC: Get Current Automation Data
ipcMain.handle('get-automation-data', (event) => {
  const isLineWindow = lineWindow && event.sender === lineWindow.webContents;
  return {
    active: isLineWindow ? isAutomationActive : false,
    text: currentLineText,
    videoPath: currentLineVideoPath
  };
});

ipcMain.on('trigger-line-upload-manual', async (event) => {
  console.log('[Main] Received manual upload request');
  if (!lineWindow) return;
  try {
    let filePath = currentLineVideoPath;

    if (!filePath) {
      const desktopPath = app.getPath('desktop');
      filePath = path.join(desktopPath, 'ebookai_line.png');
    }

    if (!fs.existsSync(filePath)) {
      console.error('File not found:', filePath);
      return;
    }

    try { lineWindow.webContents.debugger.attach('1.3'); } catch (e) { }

    const { root } = await lineWindow.webContents.debugger.sendCommand('DOM.getDocument');

    // RETRY LOGIC: Fast polling for input
    let nodeId = null;
    for (let i = 0; i < 20; i++) { // More retries
      try {
        // 1. Try Strict
        let res = await lineWindow.webContents.debugger.sendCommand('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: '#modalPortal .vw_post_writer input[type="file"]'
        });

        if (!res.nodeId) {
          res = await lineWindow.webContents.debugger.sendCommand('DOM.querySelector', {
            nodeId: root.nodeId,
            selector: '.vw_post_writer input[type="file"]'
          });
        }

        if (!res.nodeId && i > 3) { // Faster fallback trigger
          res = await lineWindow.webContents.debugger.sendCommand('DOM.querySelector', {
            nodeId: root.nodeId,
            selector: 'input[type="file"]'
          });
        }

        if (res.nodeId) {
          nodeId = res.nodeId;
          break;
        }
      } catch (e) { }
      await new Promise(r => setTimeout(r, 200)); // Faster interval (was 500)
    }

    if (nodeId) {
      await lineWindow.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
        nodeId: nodeId,
        files: [filePath]
      });
      console.log('[Main] Manual Trigger Upload Success');
      await lineWindow.webContents.executeJavaScript(`
            // Try to find the input more robustly
            let input = document.querySelector('.vw_post_writer input[type="file"]');
            
            // If not found there, try global
            if (!input) input = document.querySelector('input[type="file"]');

            if(input) {
                console.log('Main: Found input. Files length:', input.files.length);
                if(input.files.length > 0) {
                    console.log('Dispatching change event...');
                    // React often needs 'bubbles' and 'composed'
                    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                } else {
                    console.error('Main: Files not set on input!');
                }
            } else {
                console.error('Main: Input element not found!');
            }
          `);
    } else {
      console.error('[Main] Input file not found via debugger after 10 retries');
    }
  } catch (err) {
    console.error('Manual upload handler failed:', err);
  }
});

// HANDLER: Simulate Real Mouse Click
ipcMain.on('simulate-click', async (event, { x, y }) => {
  try {
    console.log(`[Main] Simulating click at ${x}, ${y}`);
    // Move mouse to position
    await lineWindow.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    // Mouse Down
    await lineWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    // Small delay to mimic real click duration
    await new Promise(r => setTimeout(r, 50));
    // Mouse Up
    await lineWindow.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    console.log('[Main] Click simulation complete');
  } catch (err) {
    console.error('[Main] Click simulation failed:', err);
  }
});

// HANDLER: Paste Image (Alternative Upload Method)
ipcMain.on('paste-image-manual', (event, filePath) => {
  try {
    let targetPath = filePath;
    if (!targetPath) {
      // Default to the standard file path if not provided
      targetPath = path.join(app.getPath('desktop'), 'ebookai_line.png');
    }

    console.log('[Main] Pasting image from path:', targetPath);
    if (fs.existsSync(targetPath)) {
      const image = nativeImage.createFromPath(targetPath);
      if (image.isEmpty()) {
        console.error('[Main] Failed to load image for pasting');
        return;
      }
      clipboard.writeImage(image);
      // Focus and Paste
      if (lineWindow) {
        lineWindow.webContents.paste();
        console.log('[Main] Image pasted to renderer');
      }
    } else {
      console.error('[Main] Image file not found for pasting:', targetPath);
    }
  } catch (err) {
    console.error('[Main] Paste failed:', err);
  }
});

ipcMain.on('close-line-window', () => {
  if (currentLineVideoPath && fs.existsSync(currentLineVideoPath)) {
    try {
      const txtPath = currentLineVideoPath.replace(/\.mp4$/i, '.txt');
      fs.unlinkSync(currentLineVideoPath);
      if (fs.existsSync(txtPath)) {
        fs.unlinkSync(txtPath);
      }
      console.log('[Main] Deleted posted video and txt file:', currentLineVideoPath);
    } catch (err) {
      console.error('[Main] Failed to delete video/txt file:', err);
    }
  }

  if (lineWindow) {
    lineWindow.close();
  }
});

// Delete file
ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting file:', error);
    return false;
  }
});

// Get command line arguments (for drag & drop to .bat)
ipcMain.handle('get-args', () => {
  return process.argv;
});

ipcMain.on('linevoom-post-created-main', (event, data) => {
  console.log('[Main] Post created event received from LINE window, forwarding to main window...');
  if (mainWindow) {
    mainWindow.webContents.send('linevoom-post-created-forwarded', data);
  }
});

// Copy content (text + image) to clipboard
ipcMain.handle('copy-to-clipboard', async (event, { text, image }) => {
  try {
    const data = {};
    if (text) data.text = text;
    if (image) data.image = nativeImage.createFromDataURL(image);

    clipboard.write(data);
    return true;
  } catch (error) {
    console.error('Error copying to clipboard:', error);
    return false;
  }
});

// Save image to Desktop for easy access
ipcMain.handle('save-ebook-image-v2', async (event, dataUrl) => {
  console.log('[Main] Received save-ebook-image-v2 request, data length:', dataUrl ? dataUrl.length : 0);
  try {
    const desktopPath = app.getPath('desktop');
    const filePath = path.join(desktopPath, 'ebookai_line.png');

    // Write the file
    const img = nativeImage.createFromDataURL(dataUrl);
    fs.writeFileSync(filePath, img.toPNG());

    console.log('[Main] File saved successfully:', filePath);
    return filePath;

  } catch (e) {
    console.error('Save image to desktop failed:', e);
    dialog.showErrorBox('Save Image Error', `Failed to save image to Desktop:\n${e.message}`);
    return null;
  }
});




console.log('[Main] All IPC handlers registered.');

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  console.log('[Main] App ready, creating window...');
  createWindow();
});


