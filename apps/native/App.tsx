import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { OnboardingScreen, type JoinResult } from './src/app/OnboardingScreen';
import { RoomScreen } from './src/app/RoomScreen';
import { fromHex } from './src/crypto/bytes';
import {
  getOrCreateDeviceId,
  loadRoomSecret,
  saveRoomSecret,
} from './src/identity/RoomIdentity';
import type { RoomSecret } from './src/mesh/EnvelopeCodec';

type Session = {
  displayName: string;
  deviceId: string;
  secret: RoomSecret;
};

export default function App() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    getOrCreateDeviceId()
      .then(setDeviceId)
      .catch((error: unknown) => {
        setProblem(
          error instanceof Error
            ? `Could not create a local identity: ${error.message}`
            : 'Could not create a local identity.',
        );
      });
  }, []);

  const join = useCallback(
    (result: JoinResult) => {
      if (deviceId === null) return;

      // The secret goes to the keystore, never to SQLite and never into an
      // envelope. Storing it is what "joining" means.
      saveRoomSecret(result.roomId, result.secretHex)
        .then(() => loadRoomSecret(result.roomId))
        .then((stored) => {
          setSession({
            displayName: result.displayName,
            deviceId,
            secret: stored ?? {
              roomId: result.roomId,
              key: fromHex(result.secretHex),
            },
          });
        })
        .catch((error: unknown) => {
          setProblem(
            error instanceof Error
              ? `Could not join that room: ${error.message}`
              : 'Could not join that room.',
          );
        });
    },
    [deviceId],
  );

  if (problem !== null) {
    return (
      <SafeAreaView style={styles.centered}>
        <StatusBar style="auto" />
        <Text style={styles.error} accessibilityRole="alert">
          {problem}
        </Text>
      </SafeAreaView>
    );
  }

  if (deviceId === null) {
    return (
      <SafeAreaView style={styles.centered}>
        <StatusBar style="auto" />
        <ActivityIndicator accessibilityLabel="Starting" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="auto" />
      {session === null ? (
        <OnboardingScreen onJoin={join} />
      ) : (
        <RoomScreen
          roomId={session.secret.roomId}
          displayName={session.displayName}
          deviceId={session.deviceId}
          secret={session.secret}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  error: { fontSize: 16, color: '#a11', textAlign: 'center' },
});
