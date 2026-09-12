#!/usr/bin/env node
/*
 * build-standalone.js — inline the page's scripts into one HTML file.
 *
 *   node build-standalone.js
 *
 * The multi-file page is what the extension loads (extension pages block
 * inline scripts). The standalone build is the one to hand someone who just
 * wants to open a file and use it.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const src = fs.readFileSync(path.join(dir, 'uniform-import.html'), 'utf8');
const out = path.join(dir, 'uniform-import-standalone.html');

const html = src.replace(/[ \t]*<script src="([^"]+)"><\/script>\n?/g, (_, name) => {
  const code = fs.readFileSync(path.join(dir, name), 'utf8');
  /* </script> inside a string would end the block early; nothing in these
     files contains it, but guard anyway. */
  return '<script>\n/* ' + name + ' */\n' + code.replace(/<\/script>/g, '<\\/script>') + '\n</script>\n';
}).replace('<title>Team Builder Uniform Importer</title>',
           '<title>Team Builder Uniform Importer</title>\n<!-- Single-file build: run node build-standalone.js to regenerate. -->');

if (/<script src=/.test(html)) throw new Error('some scripts were not inlined');
fs.writeFileSync(out, html);
console.log('wrote ' + path.basename(out) + ' (' + (html.length / 1024).toFixed(0) + ' KB)');
