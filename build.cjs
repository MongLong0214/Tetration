'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = __dirname;
const read = name => fs.readFileSync(path.join(root, 'src', name), 'utf8').replace(/\r\n/g, '\n');
const worker = ['precision.js', 'reference.js', 'core.js', 'worker.js'].map(read).join('\n');
const main = read('main.js').replace('__WORKER_SOURCE__', () => JSON.stringify(worker));
const script = [read('precision.js'), read('reference.js'), read('core.js'), read('gpu.js'), read('saved.js'), read('render.js'), main].join('\n').replace(/<\/script/gi, '<\\/script');
const styles = read('style.css');
const hash = text => "'sha256-" + createHash('sha256').update(text).digest('base64') + "'";
const csp = ["default-src 'none'", 'script-src ' + hash(script), 'style-src ' + hash(styles),
  "worker-src 'self' blob:", "manifest-src 'self'", "img-src 'self' data: blob:", "connect-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
const html = read('index.html').replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="' + csp + '">')
  .replace('__STYLES__', () => styles).replace('__SCRIPT__', () => script);
if (/__(?:STYLES|SCRIPT|WORKER_SOURCE)__/.test(html)) throw Error('Unresolved build placeholder');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
// Offline shell: the service worker cache name changes with every distinct build.
const assets = fs.readdirSync(path.join(root, 'src', 'assets')).filter(name => name.endsWith('.png')).sort();
const release = createHash('sha256').update(html).update(read('manifest.webmanifest'));
for (const name of assets) release.update(fs.readFileSync(path.join(root, 'src', 'assets', name)));
fs.writeFileSync(path.join(out, 'sw.js'), read('sw.js').replace('__BUILD__', release.digest('hex').slice(0, 16)));
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), read('manifest.webmanifest'));
for (const name of assets) fs.copyFileSync(path.join(root, 'src', 'assets', name), path.join(out, name));
console.log(`Built dist/index.html (${Buffer.byteLength(html)} bytes) with SHA-256 CSP, offline shell and ${assets.length} icons. No runtime dependencies.`);
