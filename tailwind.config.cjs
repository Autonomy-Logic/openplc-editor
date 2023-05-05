/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './electron/**/*.ts'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'open-plc-blue': 'rgb(3, 102, 255)',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
