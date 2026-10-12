// dist/index.html의 JS·CSS를 인라인해 단일 HTML 파일(dist/blaze-eleven.html)을 만든다.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = readdirSync(join(dist, 'assets'));

html = html.replace(/<script type="module" crossorigin src="\.\/assets\/([^"]+)"><\/script>/, (_, f) => {
  const js = readFileSync(join(dist, 'assets', f), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/assets\/([^"]+)">/, (_, f) => {
  const css = readFileSync(join(dist, 'assets', f), 'utf8');
  return `<style>${css}</style>`;
});
writeFileSync(join(dist, 'blaze-eleven.html'), html);
console.log(`단일 파일 생성: dist/blaze-eleven.html (${(html.length / 1024).toFixed(0)} KB, assets: ${assets.join(', ')})`);
