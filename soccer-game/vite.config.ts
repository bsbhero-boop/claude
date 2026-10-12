import { defineConfig } from 'vite';

// 상대 경로 base — GitHub Pages 하위 경로나 단일 HTML 어디서든 동작하도록.
export default defineConfig({
  base: './',
  // 상위 폴더(병원동행 앱)의 PostCSS/Tailwind 설정을 상속받지 않도록 명시
  css: { postcss: {} },
  build: {
    target: 'es2020',
    assetsInlineLimit: 100000000,
  },
});
