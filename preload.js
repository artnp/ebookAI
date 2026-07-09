const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // File operations
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    openFileDirect: (path) => ipcRenderer.invoke('open-file-direct', path),
    checkFileExists: (path) => ipcRenderer.invoke('check-file-exists', path),

    // Progress operations
    saveProgress: (data) => ipcRenderer.invoke('save-progress', data),
    loadProgress: (filePath) => ipcRenderer.invoke('load-progress', filePath),
    getAllProgress: () => ipcRenderer.invoke('get-all-progress'),
    cleanupProgress: () => ipcRenderer.invoke('cleanup-progress'),
    getArgs: () => ipcRenderer.invoke('get-args'),
    convertEpub: (path) => ipcRenderer.invoke('convert-epub', path),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    deleteFile: (path) => ipcRenderer.invoke('delete-file', path),
    copyToClipboard: (data) => ipcRenderer.invoke('copy-to-clipboard', data),
    saveTempImage: (data) => {
        console.log('[Preload] Calling save-ebook-image-v2');
        return ipcRenderer.invoke('save-ebook-image-v2', data);
    },
    detectAccounts: () => ipcRenderer.invoke('detect-accounts'),
    saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
    loadSettings: () => ipcRenderer.invoke('load-settings')
});
