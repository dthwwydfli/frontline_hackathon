/**
 * One request, its timeline, and the actions the reducer will actually accept.
 *
 * Accept and Resolve are gated the same way ThreadReducer gates them, so the
 * UI never offers something the domain would silently drop.
 */

import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { scanForWarnings } from '../domain/ContentSafety';
import type { Thread } from '../domain/ThreadReducer';
import { deliveryLabel, type NearbyMeshApi } from '../hooks/useNearbyMesh';
import { color, space } from '../theme/tokens';
import { AppText, Button, Card, Divider, Notice, Pill, Screen, TextField } from '../ui/kit';
import { displayStatus } from './NearbyScreen';

type Entry = {
  key: string;
  senderId: string;
  text: string;
  createdAtMs: number;
  isOffer: boolean;
  accepted: boolean;
};

export function ThreadDetailScreen({
  thread,
  mesh,
  deviceId,
  nameFor,
  onClose,
}: {
  thread: Thread;
  mesh: NearbyMeshApi;
  deviceId: string;
  nameFor: (peerId: string) => string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [asOffer, setAsOffer] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const isAuthor = thread.createdBy === deviceId;
  const warnings = useMemo(() => scanForWarnings(text), [text]);

  const timeline = useMemo<Entry[]>(() => {
    const entries: Entry[] = [
      ...thread.offers
        .filter((offer) => offer.senderId.length > 0)
        .map((offer) => ({
          key: offer.messageId,
          senderId: offer.senderId,
          text: offer.description,
          createdAtMs: offer.createdAtMs,
          isOffer: true,
          accepted: offer.accepted,
        })),
      ...thread.replies.map((reply) => ({
        key: reply.messageId,
        senderId: reply.senderId,
        text: reply.text,
        createdAtMs: reply.createdAtMs,
        isOffer: false,
        accepted: false,
      })),
    ];
    return entries.sort((a, b) => a.createdAtMs - b.createdAtMs);
  }, [thread.offers, thread.replies]);

  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (warnings.length > 0 && !acknowledged) {
      setAcknowledged(true);
      return;
    }
    await mesh.post('thread.reply', {
      threadId: thread.threadId,
      text: trimmed,
      isOffer: asOffer,
    });
    setText('');
    setAsOffer(false);
    setAcknowledged(false);
  }, [acknowledged, asOffer, mesh, text, thread.threadId, warnings.length]);

  return (
    <View style={[styles.overlay, { paddingTop: insets.top }]}>
      <View style={styles.navBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onClose}
          hitSlop={12}
          style={styles.back}
        >
          <MaterialIcons name="arrow-back" size={22} color={color.ink} />
          <AppText variant="bodyStrong">Back</AppText>
        </Pressable>
      </View>

      <Screen bottomInset={space.xl}>
        <Card>
          <Pill label={displayStatus(thread)} strong={thread.status === 'matched'} />
          <AppText variant="title">{thread.title ?? 'Request'}</AppText>
          <AppText variant="caption" tone="soft">
            {thread.createdBy === null
              ? 'Someone nearby'
              : isAuthor
                ? 'You'
                : nameFor(thread.createdBy)}
            {thread.place !== null && thread.place.length > 0 ? ` · ${thread.place}` : ''}
          </AppText>
          {deliveryLabel(mesh.delivery[thread.threadId]).length > 0 && (
            <AppText variant="caption" tone="accent">
              {deliveryLabel(mesh.delivery[thread.threadId])}
            </AppText>
          )}

          {isAuthor && thread.status !== 'resolved' && (
            <>
              <Divider />
              <Button
                label="Mark resolved"
                variant="secondary"
                icon="check-circle-outline"
                onPress={() =>
                  void mesh.post('thread.resolved', { threadId: thread.threadId })
                }
              />
            </>
          )}
        </Card>

        {timeline.length === 0 ? (
          <AppText variant="body" tone="soft">
            No responses yet.
          </AppText>
        ) : (
          <View style={{ gap: space.md }}>
            {timeline.map((entry) => (
              <Card key={entry.key}>
                <View style={styles.entryHead}>
                  <AppText variant="bodyStrong">
                    {entry.senderId === deviceId ? 'You' : nameFor(entry.senderId)}
                  </AppText>
                  {entry.isOffer && (
                    <Pill label={entry.accepted ? 'Accepted' : 'Offer'} strong={entry.accepted} />
                  )}
                </View>
                <AppText variant="body" tone="soft">
                  {entry.text}
                </AppText>

                {isAuthor && entry.isOffer && !entry.accepted && thread.status === 'open' && (
                  <Button
                    label="Accept this offer"
                    variant="secondary"
                    onPress={() =>
                      void mesh.post('offer.accepted', {
                        threadId: thread.threadId,
                        offerId: entry.key,
                      })
                    }
                  />
                )}
              </Card>
            ))}
          </View>
        )}

        <Card>
          <TextField
            label={asOffer ? 'Your offer' : 'Reply'}
            value={text}
            onChangeText={(next) => {
              setText(next);
              setAcknowledged(false);
            }}
            placeholder={asOffer ? 'What can you bring or do?' : 'Add a public reply'}
            maxLength={280}
            multiline
          />

          {warnings.length > 0 && (
            <Notice title="Check before you post">
              {warnings.map((warning) => (
                <AppText key={`${warning.kind}:${warning.match}`} variant="body" tone="soft">
                  {warning.message}
                </AppText>
              ))}
              {acknowledged && <AppText variant="bodyStrong">Tap again to send anyway.</AppText>}
            </Notice>
          )}

          {!isAuthor && (
            <Button
              label={asOffer ? 'Sending as an offer' : 'Send as an offer instead'}
              variant="ghost"
              onPress={() => setAsOffer((current) => !current)}
            />
          )}

          <Button
            label={warnings.length > 0 && acknowledged ? 'Send anyway' : 'Send'}
            icon="send"
            disabled={text.trim().length === 0 || !mesh.running}
            onPress={() => void send()}
          />
        </Card>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.surfaceSunken,
  },
  navBar: { paddingHorizontal: space.lg, paddingVertical: space.md },
  back: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  entryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
