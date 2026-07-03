/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Muted, low-saturation palette — "trustworthy learning tool", not a game.
        brand: {
          50: '#f4f6f7',
          100: '#e4e9eb',
          200: '#c9d3d7',
          300: '#a5b4bb',
          400: '#7c8f98',
          500: '#5e7480',
          600: '#4c5f6a',
          700: '#3f4f58',
          800: '#38434a',
          900: '#333b41',
        },
        accent: {
          400: '#7fae9c',
          500: '#5f9683',
          600: '#4a7c6a',
        },
      },
      fontSize: {
        base: ['18px', '1.6'],
        lg: ['20px', '1.6'],
        xl: ['22px', '1.5'],
        '2xl': ['24px', '1.4'],
        '3xl': ['28px', '1.35'],
      },
      minHeight: {
        touch: '48px',
      },
      boxShadow: {
        glow: '0 0 0 3px rgba(95, 150, 131, 0.35), 0 0 16px 4px rgba(95, 150, 131, 0.35)',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 3px rgba(95,150,131,0.35), 0 0 12px 2px rgba(95,150,131,0.35)' },
          '50%': { boxShadow: '0 0 0 5px rgba(95,150,131,0.55), 0 0 22px 6px rgba(95,150,131,0.55)' },
        },
      },
      animation: {
        pulseGlow: 'pulseGlow 2.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
