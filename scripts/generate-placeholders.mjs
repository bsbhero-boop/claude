// Generates simple placeholder scene images: solid muted background + scene title text.
// Per spec §8, these are meant to be swapped for real semi-realistic illustrations later —
// keep them intentionally plain rather than trying to fake final art.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'images');

const scenes = [
  { file: 'scene_01', num: 1, title: '사전준비 및 이동지원', sub: '자택 현관 앞', bg: '#5e7480' },
  { file: 'scene_02', num: 2, title: '병원 도착 및 접수', sub: '병원 로비', bg: '#4c5f6a' },
  { file: 'scene_03', num: 3, title: '진료 대기', sub: '대기실', bg: '#7c8f98' },
  { file: 'scene_04', num: 4, title: '진료실 동행', sub: '진료실', bg: '#4a7c6a' },
  { file: 'scene_05', num: 5, title: '검사 동행', sub: '검사실 복도', bg: '#5f9683' },
  { file: 'scene_06a', num: 6, title: '수납', sub: '수납창구', bg: '#6a5f4c' },
  { file: 'scene_06b', num: 6, title: '약국', sub: '약국창구', bg: '#4c6a5f' },
  { file: 'scene_07', num: 7, title: '귀가 지원 및 마무리', sub: '병원 정문', bg: '#3f4f58' },
];

function svgFor({ num, title, sub, bg }) {
  const titleSize = title.length > 8 ? 34 : 42;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <linearGradient id="vignette" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.05" />
      <stop offset="70%" stop-color="#000000" stop-opacity="0.05" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.28" />
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="${bg}" />
  <rect width="800" height="600" fill="url(#vignette)" />
  <text x="50%" y="264" text-anchor="middle" font-family="-apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="22" letter-spacing="4" fill="#ffffff" fill-opacity="0.75">STAGE ${num}</text>
  <text x="50%" y="320" text-anchor="middle" font-family="-apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="${titleSize}" font-weight="700" fill="#ffffff">${title}</text>
  <text x="50%" y="360" text-anchor="middle" font-family="-apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="20" fill="#ffffff" fill-opacity="0.7">${sub}</text>
</svg>
`;
}

for (const scene of scenes) {
  const outPath = join(outDir, `${scene.file}.svg`);
  writeFileSync(outPath, svgFor(scene), 'utf-8');
  console.log('wrote', outPath);
}
