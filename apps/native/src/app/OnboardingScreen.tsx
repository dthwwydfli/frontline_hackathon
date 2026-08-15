/**
 * First run: explain, ask for permission, name yourself, join a room.
 *
 * Deliberately plain. Visual design is done separately in Cursor; this screen
 * exists so the flow, the wording and the recovery paths are real and
 * testable on a device.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { NearbyBle } from '../../modules/nearby-ble';
import { EMERGENCY_NOTICE } from '../domain/ContentSafety';
import { decodeJoinPayload, isValidRoomId, isValidRoomSecretHex } from '../identity/JoinPayload';

export type JoinResult = {
  displayName: string;
  roomId: string;
  secretHex: string;
};

export function OnboardingScreen({ onJoin }: { onJoin: (result: JoinResult) => void }) {
  const [displayName, setDisplayName] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [permissionState, setPermissionState] = useState<
    'unknown' | 'granted' | 'denied' | 'blocked'
  >('unknown');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const requestPermission = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await NearbyBle.requestPermissions();
      if (result.granted) {
        setPermissionState('granted');
      } else {
        // Never claim an active mesh when permission is missing.
        setPermissionState(result.blockedPermanently ? 'blocked' : 'denied');
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setPermissionState('denied');
    } finally {
      setBusy(false);
    }
  }, []);

  const join = useCallback(() => {
    setProblem(null);

    const trimmedName = displayName.trim();
    if (trimmedName.length === 0) {
      setProblem('Enter a short display name so people know who is asking.');
      return;
    }

    const input = joinInput.trim();
    const decoded = decodeJoinPayload(input);

    if (decoded === null) {
      setProblem(
        'That join link is not valid. Ask the organiser for the Common Thread QR code or link.',
      );
      return;
    }
    if (!isValidRoomId(decoded.roomId) || !isValidRoomSecretHex(decoded.secretHex)) {
      setProblem('That join link is malformed.');
      return;
    }

    onJoin({
      displayName: trimmedName,
      roomId: decoded.roomId,
      secretHex: decoded.secretHex,
    });
  }, [displayName, joinInput, onJoin]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading} accessibilityRole="header">
        Common Thread
      </Text>

      <Text style={styles.body}>
        Common Thread uses Bluetooth to find nearby participants and exchange messages
        when internet and Wi-Fi are unavailable.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          1. Allow nearby communication
        </Text>

        {permissionState === 'granted' ? (
          <Text style={styles.ok}>Bluetooth permission granted.</Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enable nearby communication"
            style={styles.button}
            onPress={requestPermission}
            disabled={busy}
          >
            <Text style={styles.buttonLabel}>
              {busy ? 'Asking...' : 'Enable nearby communication'}
            </Text>
          </Pressable>
        )}

        {permissionState === 'denied' && (
          <Text style={styles.warning}>
            Without Bluetooth permission this app cannot reach anyone nearby. Tap the
            button again to retry.
          </Text>
        )}

        {permissionState === 'blocked' && (
          <Text style={styles.warning}>
            Bluetooth permission is turned off for Common Thread. Open system settings,
            allow Bluetooth and nearby devices, then come back and retry.
          </Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          2. Your display name
        </Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="e.g. Sam"
          accessibilityLabel="Display name"
          maxLength={24}
          autoCorrect={false}
        />
        <Text style={styles.hint}>
          Use a first name or nickname. Do not use your full name or address.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          3. Join the event room
        </Text>
        <TextInput
          style={styles.input}
          value={joinInput}
          onChangeText={setJoinInput}
          placeholder="commonthread://join?..."
          accessibilityLabel="Join link"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.hint}>
          Paste the organiser's join link. You need it before the network goes down.
        </Text>
      </View>

      {problem !== null && (
        <Text style={styles.error} accessibilityRole="alert">
          {problem}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Join room"
        style={[styles.button, styles.primary]}
        onPress={join}
      >
        <Text style={styles.buttonLabel}>Join room</Text>
      </Pressable>

      {busy && <ActivityIndicator accessibilityLabel="Working" />}

      <Text style={styles.notice}>{EMERGENCY_NOTICE}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  heading: { fontSize: 26, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
    // 44pt is the minimum comfortable touch target on both platforms.
    minHeight: 44,
  },
  hint: { fontSize: 13, color: '#555' },
  button: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: 'center',
  },
  primary: { backgroundColor: '#e8e8e8' },
  buttonLabel: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  ok: { fontSize: 15, color: '#1a6b2a' },
  warning: { fontSize: 15, color: '#8a5400' },
  error: { fontSize: 15, color: '#a11' },
  notice: { fontSize: 13, color: '#555', marginTop: 8 },
});
