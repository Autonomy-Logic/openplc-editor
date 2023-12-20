/** @type {import('tailwindcss').Config} */

module.exports = {
  content: [
    './src/renderer/**/*.{js,jsx,ts,tsx,ejs,html}',
    './src/main/**/*.{js,jsx,ts,tsx,ejs,html}',
  ],
  darkMode: 'class', // or 'media' or 'class'
  theme: {
    extend: {
      colors: {
        'open-plc-blue': 'rgb(3, 102, 255)',
        primary: 'var(--primary)',
        'primary-light': 'var(--primary-light)',
        'primary-dark': 'var(--primary-dark)',
        'primary-medium': 'var(--primary-medium)',
        'primary-medium-dark': 'var(--primary-medium-dark)',
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [import('@tailwindcss/forms')],
};
