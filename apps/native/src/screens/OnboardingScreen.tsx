/**
 * Step 2 of two: a name, then Join. That is the whole screen.
 *
 * There is no room to pick and no link to paste. The channel is fixed in
 * DefaultRoom.ts, so everyone nearby running this app lands in the same mesh.
 */

import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EMERGENCY_NOTICE } from '../domain/ContentSafety';
import { DEFAULT_ROOM_ID, DEFAULT_ROOM_SECRET_HEX } from '../identity/DefaultRoom';
import { space } from '../theme/tokens';
import { AppText, Button, TextField } from '../ui/kit';

export type JoinResult = {
  displayName: string;
  roomId: string;
  secretHex: string;
};

export function OnboardingScreen({ onJoin }: { onJoin: (result: JoinResult) => void }) {
  const insets = useSafeAreaInsets();
  const [displayName, setDisplayName] = useState('');

  const trimmed = displayName.trim();

  const join = useCallback(() => {
    if (trimmed.length === 0) return;
    onJoin({
      displayName: trimmed,
      roomId: DEFAULT_ROOM_ID,
      secretHex: DEFAULT_ROOM_SECRET_HEX,
    });
  }, [onJoin, trimmed]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <View
        style={[
          styles.screen,
          { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl },
        ]}
      >
        <View style={styles.top}>
          <AppText variant="display" accessibilityRole="header">
            What should people call you?
          </AppText>
          <AppText variant="body" tone="soft">
            Shown next to anything you post. A first name or nickname is plenty —
            it stays on this phone and never goes into a message.
          </AppText>

          <View style={styles.field}>
            <TextField
              label="Name"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="e.g. Sam"
              autoCapitalize="words"
              autoFocus
              maxLength={24}
            />
          </View>
        </View>

        <View style={styles.foot}>
          <Button label="Join" icon="arrow-forward" disabled={trimmed.length === 0} onPress={join} />
          <AppText variant="caption" tone="faint" center>
            {EMERGENCY_NOTICE}
          </AppText>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, paddingHorizontal: space.xl, justifyContent: 'space-between' },
  top: { gap: space.md },
  field: { marginTop: space.lg },
  foot: { gap: space.lg },
});
