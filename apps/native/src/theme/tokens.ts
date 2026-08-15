/**
 * The whole visual language, in one file.
 *
 * Two colours: `accent` and `ink`. Everything else is one of those two at an
 * opacity, or plain white. Nothing in the app may introduce a third hue — if a
 * state needs emphasis it gets weight, border or space, not a new colour.
 */

export const color = {
  accent: '#00685f',
  ink: '#0b1c30',

  accentSoft: 'rgba(0, 104, 95, 0.10)',
  accentBorder: 'rgba(0, 104, 95, 0.28)',
  accentPressed: '#00534c',

  inkSoft: 'rgba(11, 28, 48, 0.62)',
  inkFaint: 'rgba(11, 28, 48, 0.42)',
  line: 'rgba(11, 28, 48, 0.12)',
  lineStrong: 'rgba(11, 28, 48, 0.22)',
  scrim: 'rgba(11, 28, 48, 0.45)',

  surface: '#ffffff',
  surfaceSunken: '#f8f9ff',
  onAccent: '#ffffff',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  full: 999,
} as const;

/** Minimum touch target. Every pressable in the app respects this. */
export const HIT_SIZE = 44;

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export type TypeVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'caption';

export const type: Record<
  TypeVariant,
  { fontFamily: string; fontSize: number; lineHeight: number; letterSpacing?: number }
> = {
  display: { fontFamily: font.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.6 },
  title: { fontFamily: font.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  heading: { fontFamily: font.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.1 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: font.semibold, fontSize: 15, lineHeight: 21 },
  label: { fontFamily: font.medium, fontSize: 13, lineHeight: 17 },
  caption: { fontFamily: font.regular, fontSize: 12, lineHeight: 16 },
};

/**
 * One elevation only. A second shadow depth reads as noise on a screen this
 * dense, and Android renders soft shadows poorly anyway.
 */
export const elevation = {
  card: {
    shadowColor: color.ink,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
} as const;
