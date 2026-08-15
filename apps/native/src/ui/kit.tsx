/**
 * Every shared primitive, in one file.
 *
 * Screens compose these and never reach for a raw View with a hex colour.
 */

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HIT_SIZE, color, elevation, radius, space, type } from '../theme/tokens';
import { AppText } from './AppText';

export { AppText };

// ---------------------------------------------------------------- screen

export function Screen({
  children,
  scroll = true,
  padded = true,
  bottomInset = 0,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  bottomInset?: number;
}) {
  const insets = useSafeAreaInsets();
  const content: StyleProp<ViewStyle> = [
    padded && { paddingHorizontal: space.lg },
    { paddingTop: space.md, paddingBottom: bottomInset + insets.bottom + space.xl, gap: space.lg },
  ];

  if (!scroll) {
    return <View style={[styles.flex, content]}>{children}</View>;
  }
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/** Big screen title plus optional supporting line. */
export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="title" accessibilityRole="header">
        {title}
      </AppText>
      {subtitle !== undefined && (
        <AppText variant="body" tone="soft">
          {subtitle}
        </AppText>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- button

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  icon?: keyof typeof MaterialIcons.glyphMap;
  style?: StyleProp<ViewStyle>;
}) {
  const inert = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'ghost' && styles.buttonGhost,
        pressed && !inert && styles.buttonPressed,
        inert && styles.buttonDisabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? color.onAccent : color.accent} />
      ) : (
        <>
          {icon !== undefined && (
            <MaterialIcons
              name={icon}
              size={18}
              color={variant === 'primary' ? color.onAccent : color.accent}
            />
          )}
          <AppText
            variant="bodyStrong"
            tone={variant === 'primary' ? 'onAccent' : 'accent'}
          >
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------- surfaces

export function Card({
  children,
  onPress,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  if (onPress === undefined) {
    return <View style={[styles.card, style]}>{children}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed, style]}
    >
      {children}
    </Pressable>
  );
}

export function Pill({
  label,
  strong = false,
  icon,
}: {
  label: string;
  strong?: boolean;
  icon?: keyof typeof MaterialIcons.glyphMap;
}) {
  return (
    <View style={[styles.pill, strong && styles.pillStrong]}>
      {icon !== undefined && (
        <MaterialIcons name={icon} size={13} color={strong ? color.onAccent : color.accent} />
      )}
      <AppText variant="caption" tone={strong ? 'onAccent' : 'accent'} style={styles.pillText}>
        {label}
      </AppText>
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <MaterialIcons name={icon} size={26} color={color.accent} />
      </View>
      <AppText variant="heading" center>
        {title}
      </AppText>
      <AppText variant="body" tone="soft" center>
        {body}
      </AppText>
    </View>
  );
}

/**
 * Advisory notice. Carries weight and a border rather than a warning colour,
 * because the palette is two colours and a third hue would be the only one in
 * the app.
 */
export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.notice} accessibilityRole="alert">
      <View style={styles.noticeHead}>
        <MaterialIcons name="info-outline" size={16} color={color.accent} />
        <AppText variant="bodyStrong" tone="accent">
          {title}
        </AppText>
      </View>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------- input

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  maxLength,
  multiline = false,
  autoFocus = false,
  autoCapitalize = 'sentences',
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  autoFocus?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.fieldLabelRow}>
        <AppText variant="label" tone="soft">
          {label}
        </AppText>
        {maxLength !== undefined && value.length > maxLength * 0.7 && (
          <AppText variant="caption" tone="faint">
            {value.length}/{maxLength}
          </AppText>
        )}
      </View>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCapitalize !== 'none'}
        autoFocus={autoFocus}
        maxLength={maxLength}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.inkFaint}
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
      />
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <AppText variant="label" tone={active ? 'onAccent' : 'soft'}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- sheet

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.grabber} />
        <View style={styles.sheetHead}>
          <AppText variant="heading" accessibilityRole="header">
            {title}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={12}
          >
            <MaterialIcons name="close" size={22} color={color.inkSoft} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={{ gap: space.lg, paddingBottom: space.sm }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------- styles

const styles = StyleSheet.create({
  flex: { flex: 1 },

  button: {
    minHeight: HIT_SIZE + 4,
    borderRadius: radius.full,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonPrimary: { backgroundColor: color.accent },
  buttonSecondary: { backgroundColor: color.accentSoft },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonPressed: { opacity: 0.82 },
  buttonDisabled: { opacity: 0.4 },

  card: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    ...elevation.card,
  },
  cardPressed: { opacity: 0.9 },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    backgroundColor: color.accentSoft,
    borderRadius: radius.full,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  pillStrong: { backgroundColor: color.accent },
  pillText: { fontFamily: type.label.fontFamily },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.line },

  empty: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: color.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },

  notice: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.accentBorder,
    backgroundColor: color.accentSoft,
    padding: space.md,
    gap: space.sm,
  },
  noticeHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },

  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  input: {
    minHeight: HIT_SIZE + 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    color: color.ink,
    ...type.body,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },

  segmented: {
    flexDirection: 'row',
    backgroundColor: color.accentSoft,
    borderRadius: radius.full,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    minHeight: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: color.accent },

  scrim: { flex: 1, backgroundColor: color.scrim },
  sheet: {
    backgroundColor: color.surfaceSunken,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.lg,
    maxHeight: '86%',
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: color.line,
    alignSelf: 'center',
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
