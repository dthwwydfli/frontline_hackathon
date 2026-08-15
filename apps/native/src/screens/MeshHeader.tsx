/**
 * The status line. Says only what the transport reports, and never implies a
 * message reached anyone.
 */

import { StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import type { NearbyMeshApi } from '../hooks/useNearbyMesh';
import { color, radius, space } from '../theme/tokens';
import { AppText, Button } from '../ui/kit';

export function MeshHeader({ mesh }: { mesh: NearbyMeshApi }) {
  if (mesh.error !== null) {
    return (
      <View style={[styles.bar, styles.barQuiet]}>
        <View style={styles.line}>
          <MaterialIcons name="bluetooth-disabled" size={18} color={color.inkSoft} />
          <AppText variant="bodyStrong" tone="soft" style={styles.grow}>
            Not connected
          </AppText>
        </View>
        <AppText variant="caption" tone="soft">
          {mesh.error.recovery}
        </AppText>
        <Button label="Retry" variant="secondary" onPress={() => void mesh.start()} />
      </View>
    );
  }

  const peers = mesh.peers.length;
  const searching = mesh.running && peers === 0;

  return (
    <View style={[styles.bar, mesh.running ? styles.barLive : styles.barQuiet]}>
      <View style={styles.line}>
        <MaterialIcons
          name={mesh.running ? 'bluetooth-connected' : 'bluetooth-searching'}
          size={18}
          color={mesh.running ? color.accent : color.inkSoft}
        />
        <AppText variant="bodyStrong" tone={mesh.running ? 'accent' : 'soft'} style={styles.grow}>
          {mesh.starting
            ? 'Starting'
            : searching
              ? 'Searching nearby'
              : mesh.running
                ? `${peers} nearby ${peers === 1 ? 'person' : 'people'}`
                : 'Nearby communication is off'}
        </AppText>
      </View>

      {mesh.running && mesh.status !== null && !mesh.status.advertising && (
        <AppText variant="caption" tone="soft">
          This phone is not discoverable, so others cannot start a connection to
          it. It can still receive from phones that can.
        </AppText>
      )}

      {mesh.running && (
        <AppText variant="caption" tone="faint">
          {mesh.link === 'bluetooth'
            ? 'Over Bluetooth. Reaches phones in radio range only.'
            : 'Over local Wi-Fi. Reaches phones on this network only — no internet needed.'}
        </AppText>
      )}

      {!mesh.running && !mesh.starting && (
        <Button label="Start" variant="secondary" onPress={() => void mesh.start()} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
    borderWidth: 1,
  },
  barLive: { backgroundColor: color.accentSoft, borderColor: color.accentBorder },
  barQuiet: { backgroundColor: color.surface, borderColor: color.line },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
});
