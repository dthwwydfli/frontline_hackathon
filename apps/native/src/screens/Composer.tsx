/**
 * Posting a request.
 *
 * Content warnings inform, they never block. Someone under stress may have a
 * good reason for what they wrote, and the product does not overrule them —
 * it just makes sure they saw the warning once.
 */

import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { scanForWarnings } from '../domain/ContentSafety';
import { color, radius, space } from '../theme/tokens';
import { AppText, Button, Notice, Sheet, TextField } from '../ui/kit';

const CATEGORIES = ['supplies', 'power', 'access', 'check-in', 'general'] as const;

export function Composer({
  visible,
  onClose,
  onPost,
  canPost,
}: {
  visible: boolean;
  onClose: () => void;
  onPost: (payload: { title: string; category: string; place: string }) => Promise<void>;
  canPost: boolean;
}) {
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
      await onPost({ title: trimmed, category, place: place.trim() });
      setTitle('');
      setPlace('');
      setCategory('general');
      setAcknowledged(false);
    } finally {
      setBusy(false);
    }
  }, [acknowledged, category, onPost, place, title, warnings.length]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Ask for help">
      <TextField
        label="What do you need?"
        value={title}
        onChangeText={(text) => {
          setTitle(text);
          setAcknowledged(false);
        }}
        placeholder="e.g. Drinking water for two people"
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
            const active = item === category;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setCategory(item)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <AppText variant="label" tone={active ? 'onAccent' : 'soft'}>
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
