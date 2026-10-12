import type { Config } from 'tailwindcss';

const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        surface: token('surface'),
        raised: token('raised'),
        fg: token('fg'),
        muted: token('muted'),
        faint: token('faint'),
        accent: token('accent'),
        live: token('live'),
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
      },
      // `base` is a background-only token: as a generic colour it would collide with the `text-base` font size.
      backgroundColor: { base: token('base') },
      gradientColorStops: { base: token('base') },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: { sm: '6px', md: '10px', lg: '14px', xl: '20px' },
      boxShadow: {
        soft: '0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px -8px rgb(0 0 0 / 0.18)',
        pop: '0 12px 40px -8px rgb(0 0 0 / 0.45)',
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    },
  },
  plugins: [],
};
export default config;
