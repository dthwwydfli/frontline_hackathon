/**
 * What this device has taken part in, and where each post got to.
 */

import { useMemo } from 'react';
import { View } from 'react-native';

import type { NearbyMeshApi } from '../hooks/useNearbyMesh';
import { deliveryLabel } from '../hooks/useNearbyMesh';
import { space } from '../theme/tokens';
import { AppText, Card, EmptyState, Screen, ScreenHeader } from '../ui/kit';
import { ThreadCard } from './NearbyScreen';

export function ActivityScreen({
  mesh,
  deviceId,
  nameFor,
  onOpenThread,
  bottomInset,
}: {
  mesh: NearbyMeshApi;
  deviceId: string;
  nameFor: (peerId: string) => string;
  onOpenThread: (threadId: string) => void;
  bottomInset: number;
}) {
  const mine = useMemo(
    () =>
      mesh.threads.filter(
        (thread) =>
          thread.createdBy === deviceId ||
          thread.replies.some((reply) => reply.senderId === deviceId) ||
          thread.offers.some((offer) => offer.senderId === deviceId),
      ),
    [deviceId, mesh.threads],
  );

  return (
    <Screen bottomInset={bottomInset}>
      <ScreenHeader title="Activity" subtitle="Requests you started or replied to." />

      {mine.length === 0 ? (
        <EmptyState
          icon="forum"
          title="Nothing yet"
          body="Post a request or offer help on one, and it shows up here with its delivery state."
        />
      ) : (
        <View style={{ gap: space.md }}>
          {mine.map((thread) => (
            <ThreadCard
              key={thread.threadId}
              thread={thread}
              author={thread.createdBy === deviceId ? 'You' : nameFor(thread.createdBy ?? '')}
              onPress={() => onOpenThread(thread.threadId)}
              footer={deliveryLabel(mesh.delivery[thread.threadId])}
            />
          ))}
        </View>
      )}

      <Card>
        <AppText variant="heading">Private messages</AppText>
        <AppText variant="body" tone="soft">
          A private conversation only opens after you accept someone's offer.
          Until then everything posted here is readable by everyone in range, so
          keep phone numbers and addresses out of it.
        </AppText>
      </Card>
    </Screen>
  );
}
