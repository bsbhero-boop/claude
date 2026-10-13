/* =============================================================================
 *  빌드: lms-src/* → lms-statistics-v{N}.html (단일 파일)
 *  실행: node lms-src/build.js
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const ROOT = path.resolve(SRC, '..');
const VERSION = 'ver9';
const OUT = path.join(ROOT, 'lms-statistics-v9.html');

function read(p) { return fs.readFileSync(path.join(SRC, p), 'utf8'); }

// 마커 치환 — 치환 문자열의 $& 등이 특수 해석되지 않도록 함수형으로 넣는다.
function put(html, marker, value) {
  const token = '/*@@' + marker + '@@*/';
  if (html.indexOf(token) < 0) throw new Error('page.html 에 ' + token + ' 마커가 없습니다');
  return html.replace(token, () => value);
}

// 인라인 <script> 안에서 조기 종료를 일으킬 수 있는 시퀀스를 무해하게 만든다.
function safeForScript(js, label) {
  const bad = /<\/script/i;
  if (bad.test(js)) {
    console.warn('  ! ' + label + ' 에 </script 문자열이 있어 이스케이프합니다');
    js = js.replace(/<\/script/gi, '<\\/script');
  }
  return js;
}

console.log('빌드 시작 — ' + VERSION);

const css = read('app.css');
const compute = read('compute.js');
let app = read('app.js').replace(/@@VERSION@@/g, VERSION);
const b64 = read(path.join('vendor', 'xlsx.full.min.js.b64')).trim();

// compute.js 는 <script type="text/plain"> 에 들어가므로 </script 만 막으면 된다.
if (/<\/script/i.test(compute)) throw new Error('compute.js 에 </script 문자열이 있습니다');
if (!/[A-Za-z0-9+/=]{1000,}/.test(b64)) throw new Error('SheetJS base64 가 비정상입니다');

let html = read('page.html');
html = put(html, 'CSS', css);
html = put(html, 'XLSX_B64', b64);
html = put(html, 'COMPUTE', compute);
html = put(html, 'APP', safeForScript(app, 'app.js'));

// 남은 마커가 없는지 확인
const left = html.match(/\/\*@@[A-Z_]+@@\*\//g);
if (left) throw new Error('치환되지 않은 마커: ' + left.join(', '));

fs.writeFileSync(OUT, html, 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + 'KB';
console.log('  app.css      ' + kb(css.length));
console.log('  compute.js   ' + kb(compute.length));
console.log('  app.js       ' + kb(app.length));
console.log('  SheetJS(b64) ' + kb(b64.length));
console.log('완료 → ' + path.relative(process.cwd(), OUT) + '  (' + (html.length / 1048576).toFixed(2) + 'MB)');
