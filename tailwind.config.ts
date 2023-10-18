// @type {import('tailwindcss').Config}

module.exports = {
  content: [
    './src/renderer/**/*.{js,jsx,ts,tsx,ejs}',
    './src/main/**/*.{js,jsx,ts,tsx,ejs}',
  ],
  darkMode: 'class', // or 'media' or 'class'
  theme: {
    extend: {
      colors: {
        'open-plc-blue': 'rgb(3, 102, 255)',
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [import('@tailwindcss/forms')],
};
