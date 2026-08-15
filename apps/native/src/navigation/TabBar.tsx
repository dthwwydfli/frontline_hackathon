/**
 * Four tabs over local state. No navigation library: four destinations and one
 * overlay do not justify four extra native dependencies.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HIT_SIZE, color, space } from '../theme/tokens';
import { AppText } from '../ui/AppText';

export type TabKey = 'nearby' | 'activity' | 'guidance' | 'me';

const TABS: readonly {
  key: TabKey;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}[] = [
  { key: 'nearby', label: 'Nearby', icon: 'explore' },
  { key: 'activity', label: 'Activity', icon: 'forum' },
  { key: 'guidance', label: 'Guidance', icon: 'menu-book' },
  { key: 'me', label: 'Me', icon: 'person-outline' },
];

export const TAB_BAR_HEIGHT = 60;

export function TabBar({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.key)}
            style={styles.tab}
          >
            <MaterialIcons
              name={tab.icon}
              size={24}
              color={selected ? color.accent : color.inkFaint}
            />
            <AppText variant="caption" tone={selected ? 'accent' : 'faint'}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: color.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  tab: {
    flex: 1,
    minHeight: TAB_BAR_HEIGHT,
    minWidth: HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingTop: space.sm,
  },
});
