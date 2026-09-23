/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dae6ff',
          200: '#bdd3ff',
          300: '#90b6ff',
          400: '#5b8dff',
          500: '#3563f4',
          600: '#2044e0',
          700: '#1a35b5',
          800: '#1b3091',
          900: '#1c2d72',
        },
        ink: {
          50: '#f7f8fa',
          100: '#eef0f4',
          200: '#dfe3ea',
          300: '#c6ccd8',
          400: '#98a1b3',
          500: '#6b7488',
          600: '#4d5567',
          700: '#3a4152',
          800: '#252b38',
          900: '#161a23',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
        lift: '0 4px 6px -1px rgba(16,24,40,0.06), 0 10px 24px -4px rgba(16,24,40,0.10)',
        pop: '0 12px 32px -8px rgba(16,24,40,0.18)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out',
        'slide-up': 'slide-up .22s cubic-bezier(.22,1,.36,1)',
        'slide-in-right': 'slide-in-right .22s cubic-bezier(.22,1,.36,1)',
      },
    },
  },
  plugins: [],
};
