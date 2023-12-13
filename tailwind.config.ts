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
        'open-plc-dark': '#121316',
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [import('@tailwindcss/forms')],
};
