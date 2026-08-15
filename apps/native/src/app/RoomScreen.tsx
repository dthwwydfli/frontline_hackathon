/**
 * The room: mesh status, nearby peers, threads, and the composer.
 *
 * Every claim on this screen is one the system can actually observe. There is
 * no "delivered", no "everyone received it", and no safety advice.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EMERGENCY_NOTICE, scanForWarnings } from '../domain/ContentSafety';
import type { Thread } from '../domain/ThreadReducer';
import type { RoomSecret } from '../mesh/EnvelopeCodec';
import { deliveryLabel, useNearbyMesh } from './useNearbyMesh';

export function RoomScreen(props: {
  roomId: string;
  displayName: string;
  deviceId: string;
  secret: RoomSecret;
}) {
  const mesh = useNearbyMesh(props);
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState(false);

  const warnings = useMemo(
    () => scanForWarnings(`${title} ${place}`),
    [place, title],
  );

  const submit = useCallback(async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;

    // Warnings inform, they never block. A user under stress may have a good
    // reason for what they wrote, and the product does not overrule them.
    if (warnings.length > 0 && !acknowledgedWarnings) {
      setAcknowledgedWarnings(true);
      return;
    }

    await mesh.post('thread.created', {
      title: trimmed,
      category: 'general',
      place: place.trim(),
    });

    setTitle('');
    setPlace('');
    setAcknowledgedWarnings(false);
  }, [acknowledgedWarnings, mesh, place, title, warnings.length]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <MeshStatusPanel mesh={mesh} />

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Ask for help
        </Text>

        <TextInput
          style={styles.input}
          value={title}
          onChangeText={(text) => {
            setTitle(text);
            setAcknowledgedWarnings(false);
          }}
          placeholder="What do you need?"
          accessibilityLabel="What do you need"
          maxLength={140}
        />

        <TextInput
          style={styles.input}
          value={place}
          onChangeText={(text) => {
            setPlace(text);
            setAcknowledgedWarnings(false);
          }}
          placeholder="Roughly where? e.g. north stairwell"
          accessibilityLabel="Approximate place"
          maxLength={80}
        />

        {warnings.length > 0 && (
          <View style={styles.warningBox} accessibilityRole="alert">
            <Text style={styles.warningTitle}>Check before you post</Text>
            {warnings.map((warning) => (
              <Text key={`${warning.kind}:${warning.match}`} style={styles.warningText}>
                {warning.message}
              </Text>
            ))}
            <Text style={styles.warningText}>
              Everyone in this room can read a public post. Share contact details
              privately after you accept an offer.
            </Text>
            {acknowledgedWarnings && (
              <Text style={styles.warningText}>Tap Post again to send anyway.</Text>
            )}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Post request"
          style={styles.button}
          onPress={submit}
          disabled={!mesh.running}
        >
          <Text style={styles.buttonLabel}>
            {warnings.length > 0 && acknowledgedWarnings ? 'Post anyway' : 'Post'}
          </Text>
        </Pressable>

        {!mesh.running && (
          <Text style={styles.hint}>
            Nearby communication is not running, so nothing can be sent yet.
          </Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Requests
        </Text>
        {mesh.threads.length === 0 ? (
          <Text style={styles.hint}>
            No requests yet. Anything posted nearby appears here.
          </Text>
        ) : (
          mesh.threads.map((thread) => (
            <ThreadRow
              key={thread.threadId}
              thread={thread}
              delivery={deliveryLabel(mesh.delivery[thread.threadId])}
            />
          ))
        )}
      </View>

      <Text style={styles.notice}>{EMERGENCY_NOTICE}</Text>
    </ScrollView>
  );
}

function MeshStatusPanel({ mesh }: { mesh: ReturnType<typeof useNearbyMesh> }) {
  const peerCount = mesh.peers.length;

  return (
    <View style={styles.statusPanel}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        Nearby
      </Text>

      {mesh.error !== null ? (
        <View accessibilityRole="alert">
          <Text style={styles.error}>{mesh.error.message}</Text>
          <Text style={styles.hint}>{mesh.error.recovery}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry"
            style={styles.button}
            onPress={() => void mesh.start()}
          >
            <Text style={styles.buttonLabel}>Retry</Text>
          </Pressable>
        </View>
      ) : mesh.running ? (
        <>
          <Text style={styles.statusLine}>
            {peerCount === 0
              ? 'Searching for nearby participants'
              : peerCount === 1
                ? '1 nearby participant'
                : `${peerCount} nearby participants`}
          </Text>
          {mesh.status !== null && !mesh.status.advertising && (
            <Text style={styles.warningText}>
              This device is not discoverable, so others cannot start a connection to
              it. It can still receive from devices that can.
            </Text>
          )}
          <Text style={styles.hint}>
            Experimental. Reach is limited to devices within Bluetooth range.
          </Text>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start nearby communication"
          style={styles.button}
          onPress={() => void mesh.start()}
          disabled={mesh.starting}
        >
          <Text style={styles.buttonLabel}>
            {mesh.starting ? 'Starting...' : 'Start nearby communication'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function ThreadRow({ thread, delivery }: { thread: Thread; delivery: string }) {
  return (
    <View style={styles.threadRow}>
      <Text style={styles.threadTitle}>{thread.title ?? 'Request'}</Text>
      {thread.place !== null && thread.place.length > 0 && (
        <Text style={styles.hint}>{thread.place}</Text>
      )}
      <Text style={styles.hint}>
        {thread.status === 'resolved'
          ? 'Resolved'
          : thread.status === 'matched'
            ? 'Offer accepted'
            : 'Open'}
        {thread.offers.length > 0 ? ` · ${thread.offers.length} offer(s)` : ''}
        {thread.replies.length > 0 ? ` · ${thread.replies.length} reply(ies)` : ''}
      </Text>
      {delivery.length > 0 && <Text style={styles.delivery}>{delivery}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 20 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '600' },
  statusPanel: {
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
  },
  statusLine: { fontSize: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
    minHeight: 44,
  },
  button: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  hint: { fontSize: 13, color: '#555' },
  delivery: { fontSize: 13, color: '#1a4b7a' },
  error: { fontSize: 15, color: '#a11' },
  warningBox: {
    borderWidth: 1,
    borderColor: '#c89400',
    borderRadius: 6,
    padding: 12,
    gap: 6,
  },
  warningTitle: { fontSize: 15, fontWeight: '600' },
  warningText: { fontSize: 14, color: '#7a4f00' },
  threadRow: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 12,
    gap: 4,
  },
  threadTitle: { fontSize: 16, fontWeight: '600' },
  notice: { fontSize: 13, color: '#555' },
});
