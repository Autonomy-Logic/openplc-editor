/** @type {import('tailwindcss').Config} */

module.exports = {
  content: ['./src/renderer/**/*.{js,jsx,ts,tsx,ejs,html}', './src/main/**/*.{js,jsx,ts,tsx,ejs,html}'],
  darkMode: 'media', // or 'media' or 'class'
  theme: {
    extend: {
      scrollbar: ['rounded'],
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
      screens: {
        xl: '1294px',
        '2xl': '1550px',
        xm: '1806px',
        '3xl': '2062px',
        '4xl': '2318px',
      },
      rotate: {
        270: '270deg',
      },
      animation: {
        'slide-in-l-to-r': 'slideInLToR 1s ease-in-out',
        'slide-in-r-to-l': 'slideInRToL 0.5s ease-in-out',
        slideDown: "slideDown 300ms ease-in-out",
				slideUp: "slideUp 300ms ease-in-out",
      },
      boxShadow: {
        oplc: '0px 4px 20px 0px rgba(0, 0, 0, 0.25)',
        'oplc-dark': '0px 1px 7px 0px rgba(255, 255, 255, 0.25)',
      },
    },
    keyframes: {
      slideInLToR: {
        '0%': { opacity: 0, transform: 'translateX(-100%)' },
        '100%': { opacity: 1, transform: 'translateX(0)' },
      },
      slideInRToL: {
        '0%': { opacity: 0, transform: 'translateX(75%)' },
        '100%': { opacity: 1, transform: 'translateX(0)' },
      },
      slideDown: {
        from: { height: "0px" },
        to: { height: "var(--radix-accordion-content-height)" },
      },
      slideUp: {
        from: { height: "var(--radix-accordion-content-height)" },
        to: { height: "0px" },
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [import('@tailwindcss/forms'), import('tailwind-scrollbar')],
}
