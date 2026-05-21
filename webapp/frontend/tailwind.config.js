/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['var(--font-body)', 'sans-serif'],
        display: ['var(--font-display)', 'serif'],
        mono:    ['var(--font-mono)', 'monospace'],
      },
      colors: {
        ink:    '#0d0d0d',
        cream:  '#f5f0e8',
        rust:   '#c94a2b',
        sage:   '#4a7c59',
        gold:   '#c9a227',
        // These two were missing — used throughout with @apply and in JSX classNames
        muted:  '#888880',
        border: '#d4cfc5',
      },
    },
  },
  plugins: [],
};
