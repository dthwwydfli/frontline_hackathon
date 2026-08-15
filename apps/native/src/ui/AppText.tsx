/**
 * The only Text in the app.
 *
 * Screens pick a variant, never a fontSize. That is what keeps six screens
 * looking like one product.
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { color, type TypeVariant, type as typeScale } from '../theme/tokens';

export type AppTextProps = TextProps & {
  variant?: TypeVariant;
  tone?: 'ink' | 'soft' | 'faint' | 'accent' | 'onAccent';
  center?: boolean;
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
};

const TONE: Record<NonNullable<AppTextProps['tone']>, string> = {
  ink: color.ink,
  soft: color.inkSoft,
  faint: color.inkFaint,
  accent: color.accent,
  onAccent: color.onAccent,
};

export function AppText({
  variant = 'body',
  tone = 'ink',
  center = false,
  style,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[
        typeScale[variant],
        { color: TONE[tone] },
        center && styles.center,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
});
