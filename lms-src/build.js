// 단일 HTML 빌드: page.html 의 마커를 실제 내용으로 치환
const fs = require('fs');
const path = require('path');
const SRC = __dirname;
const ROOT = path.resolve(__dirname, '..');

const VERSION = 'ver3';
const OUT_NAME = 'lms-statistics-v3.html';

const css = fs.readFileSync(path.join(SRC, 'app.css'), 'utf8');
const compute = fs.readFileSync(path.join(SRC, 'compute.js'), 'utf8');
const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
const xlsxBuf = fs.readFileSync(path.join(SRC, 'vendor/xlsx.full.min.js'));
const xlsxB64 = xlsxBuf.toString('base64');

let html = fs.readFileSync(path.join(SRC, 'page.html'), 'utf8');
html = html.replace('__VERSION__', () => VERSION)
           .replace('/*__CSS__*/', () => css)
           .replace('/*__XLSX_B64__*/', () => xlsxB64)
           .replace('/*__COMPUTE__*/', () => compute)
           .replace('/*__APP__*/', () => app);

const out = path.join(ROOT, OUT_NAME);
fs.writeFileSync(out, html);
console.log('built', out, VERSION, (html.length/1024/1024).toFixed(2)+'MB');
