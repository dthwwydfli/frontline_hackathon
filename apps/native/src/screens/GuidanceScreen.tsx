/**
 * Reference notes that work with no signal, because they are in the bundle.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { EMERGENCY_NOTICE } from '../domain/ContentSafety';
import { GUIDANCE_CARDS } from '../domain/GuidanceContent';
import { space } from '../theme/tokens';
import { AppText, Card, EmptyState, Notice, Screen, ScreenHeader, TextField } from '../ui/kit';

export function GuidanceScreen({ bottomInset }: { bottomInset: number }) {
  const [query, setQuery] = useState('');

  const cards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return GUIDANCE_CARDS;
    return GUIDANCE_CARDS.filter(
      (card) =>
        card.title.toLowerCase().includes(needle) || card.body.toLowerCase().includes(needle),
    );
  }, [query]);

  return (
    <Screen bottomInset={bottomInset}>
      <ScreenHeader title="Guidance" subtitle="Stored on this phone. Works with no signal." />

      <Notice title="Not an emergency service">
        <AppText variant="body" tone="soft">
          {EMERGENCY_NOTICE}
        </AppText>
      </Notice>

      <TextField label="Search" value={query} onChangeText={setQuery} placeholder="water, power…" />

      {cards.length === 0 ? (
        <EmptyState icon="search-off" title="No matches" body="Try a shorter search term." />
      ) : (
        <View style={{ gap: space.md }}>
          {cards.map((card) => (
            <Card key={card.id}>
              <AppText variant="heading">{card.title}</AppText>
              <AppText variant="body" tone="soft">
                {card.body}
              </AppText>
              <AppText variant="caption" tone="faint">
                {card.source}
              </AppText>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
