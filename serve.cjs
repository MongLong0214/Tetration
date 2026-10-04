'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
if (require.main === module) require('./build.cjs');
const headers = Object.fromEntries(require('./vercel.json').headers[0].headers.map(({key, value}) => [key, value]));
function createServer(directory = path.resolve(__dirname, 'dist')) {
  const root = fs.realpathSync(directory);
  return http.createServer(async (req, res) => {
    const send = (status, body = '', extra = {}) => { res.writeHead(status, {...headers, ...extra});res.end(req.method === 'HEAD' ? undefined : body); };
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'Method not allowed', {Allow:'GET, HEAD'});
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.includes('\0')) return send(400, 'Invalid path');
      const requested = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!requested.startsWith(root + path.sep)) return send(403, 'Forbidden');
      const file = await fs.promises.realpath(requested);
      if (!file.startsWith(root + path.sep)) return send(403, 'Forbidden');
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) return send(404, 'Not found');
      const data = await fs.promises.readFile(file);
      send(200, data, {'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream','Content-Length':data.length});
    } catch (error) {
      send(error instanceof URIError ? 400 : 404, 'Not found');
    }
  });
}
module.exports = {createServer};
if (require.main === module) {
  const port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT must be between 1 and 65535');
  const server = createServer();
  server.listen(port, host, () => console.log(`TETRA: http://${host}:${port}`));
  server.on('error', error => {console.error(error.message);process.exitCode=1;});
}
