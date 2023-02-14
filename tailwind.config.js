// tailwind.config.js
const colors = require('tailwindcss/colors')

module.exports = {
    purge: {
        mode: 'all',
        preserveHtmlElements: false,
        enabled: true,
        content: ['*.html', '*.js', 'assets/js/*.js'],
        options: {
            keyframes: true,
          }
    },
    theme: {
      extend: {
        colors: {
          'light-blue': colors.lightBlue,
          cyan: colors.cyan,
          green: colors.emerald,
          yellow: colors.amber
        },
      },
    },
    variants: {},
    plugins: [],
  }