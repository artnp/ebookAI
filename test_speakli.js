const { app, BrowserWindow } = require('electron');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('[BROWSER CONSOLE]', message);
  });
  await win.loadURL('about:blank');
  const content = fs.readFileSync('d:/Github/ebookAI/app.js', 'utf8');
  const fnBody = content.match(/async function injectGeminiScript[\s\S]*?const script = (`[\s\S]*?`);\s*try\s*\{\s*const res = await targetWebview\.executeJavaScript/)[1];
  const evaluatedScript = eval(fnBody);
  await win.webContents.executeJavaScript(evaluatedScript);

  // Now create a dummy DOM inside the webContents and call speakLi!
  const testRun = await win.webContents.executeJavaScript(`
    (() => {
      const container = document.createElement('message-content');
      container.className = 'model-response-text';
      const ul = document.createElement('ul');
      const li = document.createElement('li');
      li.innerText = 'ความไว้วางใจในการดำเนินงาน (Trust Is Operational, Operational Trust): ระบบและการบริการต้องสร้างความน่าเชื่อถือ';
      ul.appendChild(li);
      container.appendChild(ul);
      document.body.appendChild(container);

      try {
        console.log('TEST: calling speakLi...');
        speakLi(li);
        return 'SUCCESS';
      } catch(e) {
        return 'ERROR: ' + e.message + '\\n' + e.stack;
      }
    })()
  `);
  console.log('TEST RESULT:', testRun);
  app.quit();
});
