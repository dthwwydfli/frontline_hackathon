/**
 * The feed: who is nearby, what has been asked, and the composer.
 *
 * Every claim here is one the transport can actually observe. There is no
 * "delivered" and no safety advice.
 */

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import type { Thread } from '../domain/ThreadReducer';
import type { NearbyMeshApi } from '../hooks/useNearbyMesh';
import { color, radius, space } from '../theme/tokens';
import {
  AppText,
  Button,
  Card,
  EmptyState,
  Pill,
  Screen,
  Segmented,
} from '../ui/kit';
import { Composer } from './Composer';
import { MeshHeader } from './MeshHeader';

type Filter = 'all' | 'open' | 'matched' | 'resolved';

const FILTERS = [
  { value: 'all' as const, label: 'All' },
  { value: 'open' as const, label: 'Open' },
  { value: 'matched' as const, label: 'Matched' },
  { value: 'resolved' as const, label: 'Done' },
];

export const STATUS_LABEL: Record<Thread['status'], string> = {
  open: 'Open',
  matched: 'Offer accepted',
  resolved: 'Resolved',
};

export function NearbyScreen({
  mesh,
  nameFor,
  onOpenThread,
  bottomInset,
}: {
  mesh: NearbyMeshApi;
  nameFor: (peerId: string) => string;
  onOpenThread: (threadId: string) => void;
  bottomInset: number;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [composing, setComposing] = useState(false);

  const visible = useMemo(
    () => (filter === 'all' ? mesh.threads : mesh.threads.filter((t) => t.status === filter)),
    [filter, mesh.threads],
  );

  return (
    <>
      <Screen bottomInset={bottomInset}>
        <MeshHeader mesh={mesh} />

        {mesh.peers.length > 0 && (
          <View style={{ gap: space.sm }}>
            <AppText variant="label" tone="soft">
              In range
            </AppText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.peerRow}
            >
              {mesh.peers.map((peer) => (
                <View key={peer.peerId} style={styles.peer}>
                  <View style={styles.avatar}>
                    <AppText variant="bodyStrong" tone="accent">
                      {initial(peer.displayName ?? nameFor(peer.peerId))}
                    </AppText>
                  </View>
                  <AppText variant="caption" tone="soft" numberOfLines={1}>
                    {peer.displayName ?? nameFor(peer.peerId)}
                  </AppText>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        <Segmented options={FILTERS} value={filter} onChange={setFilter} />

        {visible.length === 0 ? (
          <EmptyState
            icon="waving-hand"
            title={filter === 'all' ? 'Nothing nearby yet' : 'Nothing here'}
            body={
              filter === 'all'
                ? 'Post the first request and anyone in Bluetooth range will see it.'
                : 'Try a different filter.'
            }
          />
        ) : (
          <View style={{ gap: space.md }}>
            {visible.map((thread) => (
              <ThreadCard
                key={thread.threadId}
                thread={thread}
                author={thread.createdBy === null ? 'Someone nearby' : nameFor(thread.createdBy)}
                onPress={() => onOpenThread(thread.threadId)}
              />
            ))}
          </View>
        )}
      </Screen>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Post a request"
        onPress={() => setComposing(true)}
        style={({ pressed }) => [
          styles.fab,
          { bottom: bottomInset + space.lg },
          pressed && { opacity: 0.85 },
        ]}
      >
        <MaterialIcons name="add" size={26} color={color.onAccent} />
      </Pressable>

      <Composer
        visible={composing}
        onClose={() => setComposing(false)}
        onPost={async (payload) => {
          await mesh.post('thread.created', payload);
          setComposing(false);
        }}
        canPost={mesh.running}
      />
    </>
  );
}

export function ThreadCard({
  thread,
  author,
  onPress,
  footer,
}: {
  thread: Thread;
  author: string;
  onPress?: () => void;
  footer?: string;
}) {
  const activity = thread.offers.length + thread.replies.length;

  return (
    <Card onPress={onPress}>
      <View style={styles.cardHead}>
        <Pill label={STATUS_LABEL[thread.status]} strong={thread.status === 'matched'} />
        {thread.category !== null && (
          <AppText variant="caption" tone="faint">
            {thread.category}
          </AppText>
        )}
      </View>

      <AppText variant="heading">{thread.title ?? 'Request'}</AppText>

      <View style={styles.metaRow}>
        <AppText variant="caption" tone="soft">
          {author}
        </AppText>
        {thread.place !== null && thread.place.length > 0 && (
          <>
            <Dot />
            <AppText variant="caption" tone="soft" numberOfLines={1} style={styles.flexShrink}>
              {thread.place}
            </AppText>
          </>
        )}
        {activity > 0 && (
          <>
            <Dot />
            <AppText variant="caption" tone="soft">
              {activity} {activity === 1 ? 'response' : 'responses'}
            </AppText>
          </>
        )}
      </View>

      {footer !== undefined && footer.length > 0 && (
        <AppText variant="caption" tone="accent">
          {footer}
        </AppText>
      )}
    </Card>
  );
}

function Dot() {
  return (
    <AppText variant="caption" tone="faint">
      ·
    </AppText>
  );
}

export function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

const styles = StyleSheet.create({
  peerRow: { gap: space.lg, paddingVertical: space.xs, paddingRight: space.lg },
  peer: { alignItems: 'center', gap: space.xs, width: 64 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    backgroundColor: color.accentSoft,
    borderWidth: 1,
    borderColor: color.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'nowrap' },
  flexShrink: { flexShrink: 1 },
  fab: {
    position: 'absolute',
    right: space.lg,
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: color.ink,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
