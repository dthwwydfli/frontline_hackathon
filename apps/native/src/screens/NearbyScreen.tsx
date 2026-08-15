/**
 * The feed: area title, mesh status, the three compose actions, and what has
 * been posted. Laid out to match apps/web so the two clients read as one
 * product.
 *
 * Every claim here is one the transport can actually observe.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import type { Thread, ThreadKind } from '../domain/ThreadReducer';
import type { NearbyMeshApi } from '../hooks/useNearbyMesh';
import { color, radius, space } from '../theme/tokens';
import { AppText, Button, Card, EmptyState, Screen, Segmented } from '../ui/kit';
import { Composer } from './Composer';
import { MeshPill } from './MeshHeader';

type Filter = 'all' | 'request' | 'offer';

const FILTERS = [
  { value: 'all' as const, label: 'All' },
  { value: 'request' as const, label: 'Requests' },
  { value: 'offer' as const, label: 'Offers' },
];

const KIND_LABEL: Record<ThreadKind, string> = {
  request: 'Request',
  offer: 'Offer',
  update: 'Update',
};

/**
 * Status wording depends on what was posted — an offer that nobody has taken
 * is "Available", not "Open". Mirrors displayStatus() in apps/web.
 */
export function displayStatus(thread: Thread): string {
  if (thread.kind === 'offer') {
    return thread.status === 'open'
      ? 'Available'
      : thread.status === 'resolved'
        ? 'Closed'
        : 'Matched';
  }
  if (thread.kind === 'update') {
    return thread.status === 'open' ? 'Current' : 'Resolved';
  }
  return thread.status === 'open'
    ? 'Open'
    : thread.status === 'matched'
      ? 'Matched'
      : 'Resolved';
}

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
  const [composing, setComposing] = useState<ThreadKind | null>(null);

  const visible = useMemo(
    () => (filter === 'all' ? mesh.threads : mesh.threads.filter((t) => t.kind === filter)),
    [filter, mesh.threads],
  );

  return (
    <>
      <Screen bottomInset={bottomInset}>
        <View style={styles.header}>
          <AppText variant="title" accessibilityRole="header">
            Riverside Estate
          </AppText>
          <MeshPill mesh={mesh} />
        </View>

        <Segmented options={FILTERS} value={filter} onChange={setFilter} />

        <View style={styles.actions}>
          <Action label="Ask" icon="campaign" onPress={() => setComposing('request')} />
          <Action label="Offer" icon="add" onPress={() => setComposing('offer')} />
          <Action label="Update" icon="notifications-none" onPress={() => setComposing('update')} />
        </View>

        {mesh.error !== null && (
          <Card>
            <AppText variant="bodyStrong">Not connected</AppText>
            <AppText variant="body" tone="soft">
              {mesh.error.recovery}
            </AppText>
            <Button label="Retry" variant="secondary" onPress={() => void mesh.start()} />
          </Card>
        )}

        {visible.length === 0 ? (
          <EmptyState
            icon="waving-hand"
            title="Nothing nearby yet"
            body={
              filter === 'all'
                ? 'Post the first request or offer and everyone nearby will see it.'
                : 'Nothing of this kind yet.'
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

      <Composer
        kind={composing}
        onClose={() => setComposing(null)}
        onPost={async (payload) => {
          await mesh.post('thread.created', payload);
          setComposing(null);
        }}
        canPost={mesh.running}
      />
    </>
  );
}

function Action({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Button label={label} icon={icon} variant="secondary" onPress={onPress} style={styles.action} />
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
  const replies = thread.replies.length + thread.offers.length;

  return (
    <Card onPress={onPress}>
      <View style={styles.topline}>
        <View style={styles.kind}>
          <AppText variant="caption" tone="accent">
            {KIND_LABEL[thread.kind]}
          </AppText>
        </View>
        <View style={styles.status}>
          <MaterialIcons name="check" size={13} color={color.inkSoft} />
          <AppText variant="caption" tone="soft">
            {displayStatus(thread)}
          </AppText>
        </View>
      </View>

      <AppText variant="heading">{thread.title ?? 'Request'}</AppText>

      <View style={styles.meta}>
        <AppText variant="caption" tone="faint">
          {author}
        </AppText>
        {thread.place !== null && thread.place.length > 0 && (
          <AppText variant="caption" tone="faint" numberOfLines={1} style={styles.shrink}>
            {thread.place}
          </AppText>
        )}
        {thread.createdAtMs !== null && (
          <AppText variant="caption" tone="faint">
            {elapsed(thread.createdAtMs)}
          </AppText>
        )}
        {replies > 0 && (
          <AppText variant="caption" tone="faint">
            {replies} {replies === 1 ? 'reply' : 'replies'}
          </AppText>
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

function elapsed(createdAtMs: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - createdAtMs) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

const styles = StyleSheet.create({
  header: { gap: space.sm },
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1, paddingHorizontal: space.sm },
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kind: {
    backgroundColor: color.accentSoft,
    borderRadius: radius.full,
    paddingHorizontal: space.md,
    paddingVertical: 4,
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  shrink: { flexShrink: 1 },
});
