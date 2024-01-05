/** @type {import('tailwindcss').Config} */

module.exports = {
  content: [
    './src/renderer/**/*.{js,jsx,ts,tsx,ejs,html}',
    './src/main/**/*.{js,jsx,ts,tsx,ejs,html}',
  ],
  darkMode: 'class', // or 'media' or 'class'
  theme: {
    extend: {
      fontSize: {
        'cp-xs': ['0.5rem', '0.625rem'] /* font-size: 8px, line-height: 10px */,
        'cp-sm': ['0.625rem', '0.75rem'] /* font-size: 10px, line-height: 12px */,
        'cp-base': ['0.75rem', '1rem'] /* font-size: 12px, line-height: 16px */,
      },
      colors: {
        transparent: 'transparent',
        current: 'currentColor',
        brand: {
          light: 'var(--primary-light)',
          DEFAULT: 'var(--primary-default)',
          medium: 'var(--primary-medium)',
          'medium-dark': 'var(--primary-medium-dark)',
          dark: 'var(--primary-dark)',
        },
        white: '#ffffff',
        black: '#000000',
        neutral: {
          50: '#f5f7f8',
          100: '#edeff2',
          200: '#dde2e8',
          300: '#c8d0d9',
          400: '#b1b9c8',
          500: '#9ca4b8',
          600: '#868ca5',
          700: '#7d8297',
          800: '#5e6275',
          850: '#50545f',
          900: '#2e3038',
          950: '#121316',
          1000: '#030303',
        },
      },
      fontFamily: {
        display: ['Poppins', 'sans-serif'] /* Font for body text, titles and displays */,
        caption: ['Inter', 'sans-serif'] /* Font for captions, labels, buttons and legends */,
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [import('@tailwindcss/forms')],
};
