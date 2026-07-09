const { app, BrowserWindow, ipcMain, dialog, session, shell, screen, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { exec } = require('child_process');

let mainWindow;

// Storage path for reading progress
const progressFilePath = path.join(app.getPath('userData'), 'reading-progress.json');
const settingsFilePath = path.join(app.getPath('userData'), 'app-settings.json');

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
    await shell.openExternal(url);
    return true;
  } catch (error) {
    console.error('Error opening external URL:', error);
    return false;
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

// Convert EPUB to PDF using Python script
ipcMain.handle('convert-epub', async (event, epubPath) => {
  try {
    const pythonScript = path.join(__dirname, 'convertepub2pdf.py');
    const epubName = path.basename(epubPath).replace(/\.epub$/i, '');
    const uploadsDir = path.join(__dirname, '.uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const pdfPath = path.join(uploadsDir, `${epubName}.pdf`);

    return new Promise((resolve) => {
      exec(`python "${pythonScript}" "${epubPath}" "${pdfPath}"`, {
        timeout: 120000
      }, (error, stdout, stderr) => {
        if (error) {
          console.error('[EPUB] Convert error:', error.message);
          resolve(null);
          return;
        }
        console.log('[EPUB] Convert stdout:', stdout);
        if (stderr) console.error('[EPUB] Convert stderr:', stderr);
        if (fs.existsSync(pdfPath)) {
          resolve(pdfPath);
        } else {
          resolve(null);
        }
      });
    });
  } catch (error) {
    console.error('[EPUB] Convert exception:', error);
    return null;
  }
});

// Get command line arguments (for drag & drop to .bat)
ipcMain.handle('get-args', () => {
  return process.argv;
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

// Detect Google Accounts via Chromium Network Stack
ipcMain.handle('detect-accounts', async () => {
  console.log('[Main] Detecting Google Accounts...');
  const activeIndices = [];
  const partitionSession = session.fromPartition('persist:google_secure_v2');
  const chromeUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
  
  for (let i = 0; i < 6; i++) {
    const url = `https://gemini.google.com/u/${i}/app`;
    try {
      const response = await partitionSession.fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': chromeUA
        }
      });
      
      const status = response.status;
      const text = await response.text();
      const titleMatch = text.match(/<title>([^<]*)<\/title>/i);
      const title = titleMatch ? titleMatch[1] : 'NO_TITLE';
      const emails = text.match(/[\w.-]+@(?:gmail|googlemail|[\w-]+\.[\w-]+)/gi) || [];
      console.log(`[Main] Probe account ${i} status: ${status}, title: "${title}", emails found:`, [...new Set(emails)].slice(0, 5));
      
      if (status === 200 && title.toLowerCase().includes('gemini')) {
        activeIndices.push(i);
      } else {
        break; // Sequential accounts, stop probing
      }
    } catch (error) {
      console.error(`[Main] Error probing account ${i}:`, error);
      break;
    }
  }
  return activeIndices;
});

// Save Application Settings
ipcMain.handle('save-settings', async (event, data) => {
  try {
    fs.writeFileSync(settingsFilePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
});

// Load Application Settings
ipcMain.handle('load-settings', async () => {
  try {
    if (fs.existsSync(settingsFilePath)) {
      return JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'));
    }
    return null;
  } catch (error) {
    console.error('Error loading settings:', error);
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


