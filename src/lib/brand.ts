/**
 * A group's brand colour.
 *
 * A NAMED palette rather than a free colour picker. Each preset carries a
 * dark-mode twin and a foreground chosen for contrast; letting a group pick any
 * hex is how a group ends up with white text on a yellow button nobody can
 * read. The database refuses any name not listed here
 * (`groups_brand_colour_known`), so adding a preset means a migration too.
 *
 * Tailwind resolves `bg-primary`, `text-primary` and friends through the CSS
 * variables in `global.css`, so overriding `--primary` and `--ring` re-colours
 * every class-styled element at once. Icons take a hex `color` prop instead,
 * which is what `hex` is for — see `useBrand()`.
 */

export type BrandKey = 'jade' | 'ocean' | 'indigo' | 'plum' | 'crimson' | 'amber' | 'slate';

export interface BrandPreset {
  key: BrandKey;
  label: string;
  /** HSL triples in the form global.css uses, e.g. `162 84% 27%`. */
  light: { primary: string; foreground: string };
  dark: { primary: string; foreground: string };
  /** Icon colours: `hex` for the ordinary accent, `deep` for icons on outline buttons. */
  hex: string;
  deep: string;
}

export const BRAND_PRESETS: readonly BrandPreset[] = [
  {
    key: 'jade',
    label: 'Jade',
    light: { primary: '162 84% 27%', foreground: '150 40% 98%' },
    dark: { primary: '158 72% 45%', foreground: '168 40% 8%' },
    hex: '#12A67B',
    deep: '#0B7A5C',
  },
  {
    key: 'ocean',
    label: 'Ocean',
    light: { primary: '201 90% 32%', foreground: '0 0% 100%' },
    dark: { primary: '199 80% 55%', foreground: '205 60% 10%' },
    hex: '#0E8AC8',
    deep: '#085E8A',
  },
  {
    key: 'indigo',
    label: 'Indigo',
    light: { primary: '234 62% 45%', foreground: '0 0% 100%' },
    dark: { primary: '232 80% 72%', foreground: '234 50% 12%' },
    hex: '#4C5BD4',
    deep: '#2F3BA8',
  },
  {
    key: 'plum',
    label: 'Plum',
    light: { primary: '292 45% 36%', foreground: '0 0% 100%' },
    dark: { primary: '292 55% 68%', foreground: '292 40% 10%' },
    hex: '#9B3FA6',
    deep: '#6F2B78',
  },
  {
    key: 'crimson',
    label: 'Crimson',
    light: { primary: '350 70% 40%', foreground: '0 0% 100%' },
    dark: { primary: '350 75% 64%', foreground: '350 50% 10%' },
    hex: '#C8264A',
    deep: '#961A36',
  },
  {
    key: 'amber',
    label: 'Amber',
    // Darker than the accent gold so white text on a button still reads.
    light: { primary: '28 90% 36%', foreground: '0 0% 100%' },
    dark: { primary: '36 92% 55%', foreground: '30 80% 10%' },
    hex: '#C2640A',
    deep: '#8F4A07',
  },
  {
    key: 'slate',
    label: 'Slate',
    light: { primary: '215 25% 27%', foreground: '0 0% 100%' },
    dark: { primary: '214 30% 70%', foreground: '215 30% 10%' },
    hex: '#52627A',
    deep: '#334155',
  },
];

export const DEFAULT_BRAND: BrandKey = 'jade';

export function brandPreset(key: string | null | undefined): BrandPreset {
  return BRAND_PRESETS.find((preset) => preset.key === key) ?? BRAND_PRESETS[0]!;
}
