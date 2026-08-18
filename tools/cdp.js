#!/usr/bin/env node
/**
 * Minimal headless-Chrome driver over the DevTools Protocol: loads a page,
 * collects console output and page errors, evaluates an expression and
 * optionally screenshots. Enough to iterate on the graph without a GUI.
 *
 *   node tools/cdp.js <url> [--eval='expr'] [--shot=out.png] [--wait=3000]
 *                     [--size=1600x1000]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2];
const arg = (n, d) => {
  const a = process.argv.find(x => x.startsWith('--' + n + '='));
  return a ? a.slice(n.length + 3) : d;
};
const wait = parseInt(arg('wait', '3500'), 10);
const [W, H] = arg('size', '1600x1000').split('x').map(Number);
const shot = arg('shot', '');
const expr = arg('eval', '');
const port = 9333;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--remote-debugging-port=' + port, '--user-data-dir=/tmp/cdp-profile-familytree',
  `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
function getJSON(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path }, r => {
      let b = '';
      r.on('data', c => (b += c));
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      const list = await getJSON('/json/list');
      target = list.find(t => t.type === 'page');
    } catch (e) { /* not up yet */ }
  }
  if (!target) throw new Error('chrome did not start');

  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  let msgId = 0;
  const pending = new Map();
  const logs = [];
  await new Promise(r => ws.on('open', r));
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push('[pageerror] ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    }
  });
  const send = (method, params) => new Promise(res => {
    const id = ++msgId;
    pending.set(id, m => res(m.result || m.error));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(wait);

  if (expr) {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true, replMode: true, userGesture: true,
    });
    if (r.exceptionDetails) console.log('EVAL ERROR:', r.exceptionDetails.text, r.exceptionDetails.exception && r.exceptionDetails.exception.description);
    else console.log(typeof r.result.value === 'object' ? JSON.stringify(r.result.value, null, 2) : String(r.result.value));
  }
  if (shot) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shot, Buffer.from(r.data, 'base64'));
    console.log('screenshot ->', shot);
  }
  if (logs.length) console.log('\n--- console ---\n' + logs.join('\n'));

  ws.close();
  chrome.kill();
  process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
