'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),esbuild=require('esbuild');
const destination=path.resolve(__dirname,'../../src/vendor');
fs.mkdirSync(destination,{recursive:true});
esbuild.buildSync({entryPoints:[path.join(__dirname,'entry.js')],bundle:true,format:'iife',globalName:'TetraMedia',platform:'browser',target:'es2022',minify:true,
 legalComments:'inline',outfile:path.join(destination,'mediabunny.js'),banner:{js:'/* Mediabunny v1.61.3 — MPL-2.0. See NOTICE.md and LICENSE.mediabunny. */'}});
fs.copyFileSync(path.join(__dirname,'node_modules/mediabunny/LICENSE'),path.join(destination,'LICENSE.mediabunny'));
const bytes=fs.readFileSync(path.join(destination,'mediabunny.js'));
fs.writeFileSync(path.join(destination,'SHA256SUMS'),createHash('sha256').update(bytes).digest('hex')+'  mediabunny.js\n');
console.log(`Vendored Mediabunny 1.61.3 (${bytes.length} bytes).`);
