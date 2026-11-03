/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: 'var(--bg)', raised: 'var(--bg-raised)', overlay: 'var(--bg-overlay)' },
        line: 'var(--border)',
        ink: { DEFAULT: 'var(--text)', dim: 'var(--text-dim)', faint: 'var(--text-faint)' },
        accent: { DEFAULT: 'var(--accent)', hover: 'var(--accent-hover)' }
      },
      fontSize: { base: 'var(--font-size)' }
    }
  },
  plugins: []
}
