// 在盒子上的 WebView 里执行一段 JS 并打印结果（Chrome DevTools 协议）。App 需要用 install.ps1 -DebugKeys 启动（开启远程调试）。
// 用法：node tools/cdp.mjs <包名> "<JS 表达式>"      表达式可以返回 Promise
// 例：  node tools/cdp.mjs io.github.flufy3d.tv.neonracer "document.documentElement.className"
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const [pkg, expr] = process.argv.slice(2);
if (!pkg || !expr) {
  console.error('用法：node tools/cdp.mjs <包名> "<JS 表达式>"');
  process.exit(2);
}
const sdk = process.env.ANDROID_HOME || join(process.env.USERPROFILE, 'tools', 'android-sdk');
const adb = join(sdk, 'platform-tools', 'adb.exe');
const device = process.env.TVSHELL_DEVICE || '100.108.156.33:5555';
const run = (...a) => execFileSync(adb, ['-s', device, ...a], { encoding: 'utf8' }).trim();

const pid = run('shell', 'pidof', pkg);
if (!pid) throw new Error(`${pkg} 没有在运行`);
const port = 9222;
run('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid.split(/\s+/)[0]}`);
try {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('没有找到页面（App 是否用 -DebugKeys 启动？）');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  ws.send(JSON.stringify({
    id: 1, method: 'Runtime.evaluate',
    params: { expression: expr, awaitPromise: true, returnByValue: true },
  }));
  const msg = await new Promise(ok => { ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) ok(m); }; });
  ws.close();
  const r = msg.result;
  if (r.exceptionDetails) { console.error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); process.exit(1); }
  const v = r.result.value;
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
} finally {
  run('forward', '--remove', `tcp:${port}`);
}
