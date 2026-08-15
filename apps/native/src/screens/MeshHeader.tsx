/**
 * The status pill. Says only what the transport reports, and never implies a
 * message reached anyone.
 *
 * The wording is deliberately not "Bluetooth" unless the radio is genuinely
 * what is carrying traffic — see MeshLink in useNearbyMesh.ts.
 */

import { StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import type { NearbyMeshApi } from '../hooks/useNearbyMesh';
import { color, radius, space } from '../theme/tokens';
import { AppText } from '../ui/kit';

export function MeshPill({ mesh }: { mesh: NearbyMeshApi }) {
  const label = pillLabel(mesh);
  const live = mesh.running && mesh.error === null;

  return (
    <View style={[styles.pill, live ? styles.live : styles.quiet]}>
      <MaterialIcons
        name={live ? 'people-outline' : 'sync-problem'}
        size={14}
        color={live ? color.accent : color.inkSoft}
      />
      <AppText variant="caption" tone={live ? 'accent' : 'soft'}>
        {label}
      </AppText>
    </View>
  );
}

function pillLabel(mesh: NearbyMeshApi): string {
  if (mesh.error !== null) return 'Mesh offline';
  if (mesh.starting) return 'Connecting to mesh';
  if (!mesh.running) return 'Mesh off';

  const medium = mesh.link === 'bluetooth' ? 'Bluetooth mesh' : 'Local mesh';
  return `${medium} · ${mesh.peers.length} nearby`;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  live: { backgroundColor: color.accentSoft },
  quiet: { backgroundColor: 'rgba(11, 28, 48, 0.07)' },
});
