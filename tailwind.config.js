/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#0a0f1a',
          1: '#0f172a',
          2: '#1e293b',
          3: '#334155',
          4: '#475569',
        },
        accent: {
          DEFAULT: '#6366f1',
          hover: '#4f46e5',
          muted: '#312e81',
        },
        ink: {
          DEFAULT: '#e2e8f0',
          muted: '#94a3b8',
          faint: '#475569',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      typography: (theme) => ({
        invert: {
          css: {
            '--tw-prose-body': theme('colors.ink.DEFAULT'),
            '--tw-prose-headings': '#f8fafc',
            '--tw-prose-links': theme('colors.accent.DEFAULT'),
            '--tw-prose-code': '#f472b6',
            '--tw-prose-pre-bg': theme('colors.surface.2'),
            '--tw-prose-pre-code': theme('colors.ink.DEFAULT'),
          }
        }
      })
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
