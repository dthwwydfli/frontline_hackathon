/**
 * Posting a request, an offer or an update.
 *
 * Content warnings inform, they never block. Someone under stress may have a
 * good reason for what they wrote, and the product does not overrule them —
 * it just makes sure they saw the warning once.
 */

import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { scanForWarnings } from '../domain/ContentSafety';
import type { ThreadKind } from '../domain/ThreadReducer';
import { color, radius, space } from '../theme/tokens';
import { AppText, Button, Notice, Sheet, TextField } from '../ui/kit';

const CATEGORIES = ['supplies', 'power', 'access', 'check-in', 'general'] as const;

const TITLES: Record<ThreadKind, string> = {
  request: 'Ask for help',
  offer: 'Offer help',
  update: 'Post an update',
};

const PROMPTS: Record<ThreadKind, string> = {
  request: 'What do you need?',
  offer: 'What can you offer?',
  update: 'What should people know?',
};

const PLACEHOLDERS: Record<ThreadKind, string> = {
  request: 'e.g. Drinking water for two people',
  offer: 'e.g. Spare six-pack of water',
  update: 'e.g. Water is back on in Block A',
};

export function Composer({
  kind,
  onClose,
  onPost,
  canPost,
}: {
  /** Null when closed; the kind being composed when open. */
  kind: ThreadKind | null;
  onClose: () => void;
  onPost: (payload: {
    title: string;
    kind: ThreadKind;
    category: string;
    place: string;
  }) => Promise<void>;
  canPost: boolean;
}) {
  const active: ThreadKind = kind ?? 'request';
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [category, setCategory] = useState<string>('general');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  const warnings = useMemo(() => scanForWarnings(`${title} ${place}`), [place, title]);

  const submit = useCallback(async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;

    if (warnings.length > 0 && !acknowledged) {
      setAcknowledged(true);
      return;
    }

    setBusy(true);
    try {
      await onPost({ title: trimmed, kind: active, category, place: place.trim() });
      setTitle('');
      setPlace('');
      setCategory('general');
      setAcknowledged(false);
    } finally {
      setBusy(false);
    }
  }, [acknowledged, active, category, onPost, place, title, warnings.length]);

  return (
    <Sheet visible={kind !== null} onClose={onClose} title={TITLES[active]}>
      <TextField
        label={PROMPTS[active]}
        value={title}
        onChangeText={(text) => {
          setTitle(text);
          setAcknowledged(false);
        }}
        placeholder={PLACEHOLDERS[active]}
        maxLength={140}
        multiline
      />

      <TextField
        label="Roughly where?"
        value={place}
        onChangeText={(text) => {
          setPlace(text);
          setAcknowledged(false);
        }}
        placeholder="e.g. north stairwell"
        maxLength={80}
      />

      <View style={{ gap: space.sm }}>
        <AppText variant="label" tone="soft">
          Category
        </AppText>
        <View style={styles.chips}>
          {CATEGORIES.map((item) => {
            const selected = item === category;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setCategory(item)}
                style={[styles.chip, selected && styles.chipActive]}
              >
                <AppText variant="label" tone={selected ? 'onAccent' : 'soft'}>
                  {item}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {warnings.length > 0 && (
        <Notice title="Check before you post">
          {warnings.map((warning) => (
            <AppText key={`${warning.kind}:${warning.match}`} variant="body" tone="soft">
              {warning.message}
            </AppText>
          ))}
          <AppText variant="body" tone="soft">
            Everyone nearby can read a public post. Share contact details
            privately after you accept an offer.
          </AppText>
          {acknowledged && (
            <AppText variant="bodyStrong">Tap Post again to send anyway.</AppText>
          )}
        </Notice>
      )}

      <Button
        label={warnings.length > 0 && acknowledged ? 'Post anyway' : 'Post'}
        icon="send"
        busy={busy}
        disabled={title.trim().length === 0 || !canPost}
        onPress={() => void submit()}
      />

      {!canPost && (
        <AppText variant="caption" tone="soft" center>
          Nearby communication is not running, so nothing can be sent yet.
        </AppText>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderRadius: radius.full,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: color.accentSoft,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { backgroundColor: color.accent },
});
