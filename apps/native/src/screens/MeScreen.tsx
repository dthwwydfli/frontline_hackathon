/**
 * This device: who you are here, and what the radio is actually doing.
 *
 * No room row, no join link, no code. There is nothing for anyone to type.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { NearbyMeshApi } from '../hooks/useNearbyMesh';
import { color, radius, space } from '../theme/tokens';
import {
  AppText,
  Button,
  Card,
  Divider,
  Screen,
  ScreenHeader,
  Sheet,
} from '../ui/kit';
import { initial } from './NearbyScreen';

export function MeScreen({
  mesh,
  displayName,
  deviceId,
  onEnableBluetooth,
  bottomInset,
}: {
  mesh: NearbyMeshApi;
  displayName: string;
  deviceId: string;
  onEnableBluetooth: () => void;
  bottomInset: number;
}) {
  const [confirming, setConfirming] = useState(false);

  const stats = useMemo(() => {
    const open = mesh.threads.filter((t) => t.status === 'open').length;
    const matched = mesh.threads.filter((t) => t.status === 'matched').length;
    const resolved = mesh.threads.filter((t) => t.status === 'resolved').length;
    const offers = mesh.threads.reduce((sum, t) => sum + t.offers.length, 0);
    return [
      { label: 'Open', value: open },
      { label: 'Offers', value: offers },
      { label: 'Matched', value: matched },
      { label: 'Resolved', value: resolved },
    ];
  }, [mesh.threads]);

  return (
    <>
      <Screen bottomInset={bottomInset}>
        <ScreenHeader title="Me" />

        <Card>
          <View style={styles.profile}>
            <View style={styles.avatar}>
              <AppText variant="title" tone="accent">
                {initial(displayName)}
              </AppText>
            </View>
            <View style={styles.grow}>
              <AppText variant="heading">{displayName}</AppText>
              <AppText variant="caption" tone="faint">
                Local-only profile · {deviceId.slice(0, 8)}
              </AppText>
            </View>
          </View>
        </Card>

        <Card>
          <AppText variant="heading">Nearby communication</AppText>
          <Divider />
          <Row label="Running" value={mesh.running ? 'Yes' : 'No'} />
          <Row label="Bluetooth" value={mesh.status?.bluetoothState ?? 'unknown'} />
          <Row label="Discoverable" value={mesh.status?.advertising === true ? 'Yes' : 'No'} />
          <Row label="In range" value={String(mesh.peers.length)} />
          <Button
            label="Bluetooth permission"
            variant="secondary"
            icon="bluetooth"
            onPress={onEnableBluetooth}
          />
        </Card>

        <Card>
          <AppText variant="heading">Wall mode</AppText>
          <View style={styles.grid}>
            {stats.map((stat) => (
              <View key={stat.label} style={styles.tile}>
                <AppText variant="display" tone="accent">
                  {stat.value}
                </AppText>
                <AppText variant="caption" tone="soft">
                  {stat.label}
                </AppText>
              </View>
            ))}
          </View>
        </Card>

        <Button
          label="Clear local data"
          variant="ghost"
          icon="delete-outline"
          onPress={() => setConfirming(true)}
        />

        <AppText variant="caption" tone="faint">
          Messages travel phone to phone over Bluetooth. Reach is limited to
          devices in range, and nothing here can confirm that a message was read.
          Common Thread is not an emergency service.
        </AppText>
      </Screen>

      <Sheet visible={confirming} onClose={() => setConfirming(false)} title="Clear local data?">
        <AppText variant="body" tone="soft">
          This erases every request and reply stored on this phone. It cannot be
          undone, and it does not remove anything from anyone else's device.
        </AppText>
        <Button
          label="Clear everything"
          onPress={() => {
            setConfirming(false);
          }}
        />
        <Button label="Keep it" variant="ghost" onPress={() => setConfirming(false)} />
      </Sheet>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <AppText variant="body" tone="soft">
        {label}
      </AppText>
      <AppText variant="bodyStrong">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  grow: { flex: 1, gap: 2 },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: radius.full,
    backgroundColor: color.accentSoft,
    borderWidth: 1,
    borderColor: color.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: color.accentSoft,
    borderRadius: radius.sm,
    paddingVertical: space.lg,
    alignItems: 'center',
    gap: 2,
  },
});
