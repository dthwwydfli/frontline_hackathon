import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { EnableNearbyScreen } from './src/screens/EnableNearbyScreen';
import { OnboardingScreen, type JoinResult } from './src/screens/OnboardingScreen';
import { NearbyScreen } from './src/screens/NearbyScreen';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { GuidanceScreen } from './src/screens/GuidanceScreen';
import { MeScreen } from './src/screens/MeScreen';
import { ThreadDetailScreen } from './src/screens/ThreadDetailScreen';
import { TabBar, TAB_BAR_HEIGHT, type TabKey } from './src/navigation/TabBar';
import { useNearbyMesh } from './src/hooks/useNearbyMesh';
import { useAppFonts } from './src/theme/useAppFonts';
import { color, space } from './src/theme/tokens';
import { AppText } from './src/ui/kit';
import { fromHex } from './src/crypto/bytes';
import {
  getOrCreateDeviceId,
  loadRoomSecret,
  saveRoomSecret,
} from './src/identity/RoomIdentity';
import type { RoomSecret } from './src/mesh/EnvelopeCodec';

const PRIMED_KEY = 'ct.btPrimed';

type Session = {
  displayName: string;
  deviceId: string;
  secret: RoomSecret;
};

export default function App() {
  const fontsReady = useAppFonts();

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [primed, setPrimed] = useState<boolean | null>(null);
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

    SecureStore.getItemAsync(PRIMED_KEY)
      .then((value) => setPrimed(value === 'yes'))
      .catch(() => setPrimed(false));
  }, []);

  const finishPriming = useCallback(() => {
    setPrimed(true);
    void SecureStore.setItemAsync(PRIMED_KEY, 'yes').catch(() => {
      // A failed write only means the sheet shows again next launch.
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
              ? `Could not join: ${error.message}`
              : 'Could not join.',
          );
        });
    },
    [deviceId],
  );

  let content: React.ReactNode;

  if (problem !== null) {
    content = (
      <View style={styles.centered}>
        <AppText variant="body" tone="soft" center accessibilityRole="alert">
          {problem}
        </AppText>
      </View>
    );
  } else if (!fontsReady || deviceId === null || primed === null) {
    content = (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Starting" color={color.accent} />
      </View>
    );
  } else if (!primed) {
    content = <EnableNearbyScreen onDone={finishPriming} />;
  } else if (session === null) {
    content = <OnboardingScreen onJoin={join} />;
  } else {
    content = <Shell session={session} onReEnable={() => setPrimed(false)} />;
  }

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="dark" />
        {content}
      </View>
    </SafeAreaProvider>
  );
}

/** The signed-in app: four tabs and a detail layer over them. */
function Shell({ session, onReEnable }: { session: Session; onReEnable: () => void }) {
  const insets = useSafeAreaInsets();
  const mesh = useNearbyMesh({
    roomId: session.secret.roomId,
    displayName: session.displayName,
    deviceId: session.deviceId,
    secret: session.secret,
  });
  const [tab, setTab] = useState<TabKey>('nearby');
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  const bottomInset = TAB_BAR_HEIGHT;

  const openThread = useMemo(
    () => mesh.threads.find((thread) => thread.threadId === openThreadId) ?? null,
    [mesh.threads, openThreadId],
  );

  return (
    <View style={styles.root}>
      <View style={[styles.stage, { paddingTop: insets.top }]}>
        {tab === 'nearby' && (
          <NearbyScreen
            mesh={mesh}
            nameFor={mesh.nameFor}
            onOpenThread={setOpenThreadId}
            bottomInset={bottomInset}
          />
        )}
        {tab === 'activity' && (
          <ActivityScreen
            mesh={mesh}
            deviceId={session.deviceId}
            nameFor={mesh.nameFor}
            onOpenThread={setOpenThreadId}
            bottomInset={bottomInset}
          />
        )}
        {tab === 'guidance' && <GuidanceScreen bottomInset={bottomInset} />}
        {tab === 'me' && (
          <MeScreen
            mesh={mesh}
            displayName={session.displayName}
            deviceId={session.deviceId}
            onEnableBluetooth={onReEnable}
            bottomInset={bottomInset}
          />
        )}
      </View>

      <TabBar active={tab} onChange={setTab} />

      {openThread !== null && (
        <ThreadDetailScreen
          thread={openThread}
          mesh={mesh}
          deviceId={session.deviceId}
          nameFor={mesh.nameFor}
          onClose={() => setOpenThreadId(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surfaceSunken },
  stage: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
});
