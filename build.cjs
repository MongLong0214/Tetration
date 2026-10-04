'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = __dirname;
const read = name => fs.readFileSync(path.join(root, 'src', name), 'utf8').replace(/\r\n/g, '\n');
const worker = ['precision.js', 'core.js', 'worker.js'].map(read).join('\n');
const main = read('main.js').replace('__WORKER_SOURCE__', () => JSON.stringify(worker));
const script = [read('precision.js'), read('core.js'), read('gpu.js'), read('webgpu.js'), main].join('\n').replace(/<\/script/gi, '<\\/script');
const styles = read('style.css');
const hash = text => "'sha256-" + createHash('sha256').update(text).digest('base64') + "'";
const csp = ["default-src 'none'", 'script-src ' + hash(script), 'style-src ' + hash(styles),
  "worker-src blob:", "img-src 'self' data: blob:", "connect-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
const html = read('index.html').replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="' + csp + '">')
  .replace('__STYLES__', () => styles).replace('__SCRIPT__', () => script);
if (/__(?:STYLES|SCRIPT|WORKER_SOURCE)__/.test(html)) throw Error('Unresolved build placeholder');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), html);
console.log(`Built dist/index.html (${Buffer.byteLength(html)} bytes) with SHA-256 CSP. No runtime dependencies.`);
