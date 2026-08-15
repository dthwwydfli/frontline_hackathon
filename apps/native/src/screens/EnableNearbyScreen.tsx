/**
 * Step 1 of two. One button: enable nearby communication.
 *
 * This calls the real permission API in every case. It never reports success
 * it did not get, and it never claims a mesh is running.
 */

import { useCallback, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NearbyBle } from '../../modules/nearby-ble';
import { color, radius, space } from '../theme/tokens';
import { AppText, Button, Notice } from '../ui/kit';

type Outcome =
  | { kind: 'idle' }
  | { kind: 'denied' }
  | { kind: 'blocked' }
  /** Expo Go: the native module is not in the binary and cannot be. */
  | { kind: 'unavailable' }
  | { kind: 'failed'; message: string };

/** The fallback module throws with this prefix when running under Expo Go. */
const UNSUPPORTED = 'bluetooth_unsupported';

export function EnableNearbyScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const result = await NearbyBle.requestPermissions();
      if (result.granted) {
        onDone();
        return;
      }
      setOutcome({ kind: result.blockedPermanently ? 'blocked' : 'denied' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOutcome(
        message.includes(UNSUPPORTED)
          ? { kind: 'unavailable' }
          : { kind: 'failed', message },
      );
    } finally {
      setBusy(false);
    }
  }, [onDone]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.hero}>
        <View style={styles.mark}>
          <MaterialIcons name="bluetooth-searching" size={34} color={color.accent} />
        </View>

        <AppText variant="display" center accessibilityRole="header">
          Common Thread
        </AppText>
        <AppText variant="body" tone="soft" center style={styles.blurb}>
          Finds people nearby over Bluetooth and passes messages between phones,
          so a neighbourhood can still reach each other with no internet, no
          Wi-Fi and no mobile signal.
        </AppText>
      </View>

      <View style={styles.foot}>
        {outcome.kind === 'denied' && (
          <Notice title="Permission not granted">
            <AppText variant="body" tone="soft">
              Nothing can be sent or received until nearby permission is
              allowed. Tap the button again to ask once more.
            </AppText>
          </Notice>
        )}

        {outcome.kind === 'blocked' && (
          <Notice title="Blocked in settings">
            <AppText variant="body" tone="soft">
              Open system settings, allow Common Thread to use Bluetooth and
              nearby devices, then come back.
            </AppText>
            <Button
              label="Open settings"
              variant="secondary"
              icon="open-in-new"
              onPress={() => void Linking.openSettings()}
            />
          </Notice>
        )}

        {outcome.kind === 'unavailable' && (
          <Notice title="Bluetooth needs the full app">
            <AppText variant="body" tone="soft">
              Expo Go cannot load Bluetooth code — its native side is fixed when
              Expo builds it. Install the Common Thread development build to use
              the mesh. You can look around in the meantime.
            </AppText>
          </Notice>
        )}

        {outcome.kind === 'failed' && (
          <Notice title="Could not turn that on">
            <AppText variant="body" tone="soft">
              {outcome.message}
            </AppText>
          </Notice>
        )}

        <Button
          label={outcome.kind === 'idle' ? 'Enable nearby communication' : 'Try again'}
          icon="bluetooth"
          busy={busy}
          onPress={() => void enable()}
        />

        {outcome.kind !== 'idle' && (
          <Button label="Continue without it" variant="ghost" onPress={onDone} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: space.xl,
    justifyContent: 'space-between',
  },
  hero: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md },
  mark: {
    width: 78,
    height: 78,
    borderRadius: radius.full,
    backgroundColor: color.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  blurb: { maxWidth: 330 },
  foot: { gap: space.md },
});
