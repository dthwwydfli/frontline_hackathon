# PLD-03 — Event Protocol

## Envelope

Versioned JSON, append-only. Schema version starts at `1`.

```json
{
  "v": 1,
  "eventID": "550e8400-e29b-41d4-a716-446655440000",
  "threadID": "660e8400-e29b-41d4-a716-446655440000",
  "area": "riverside-estate",
  "kind": "thread.created",
  "authorPeerID": "peer-abc",
  "createdAt": "2026-08-15T12:00:00.000Z",
  "body": { }
}
```

Public text fields must be ≤ **300 Unicode code points**. Encode compactly; respect upstream bitchat public payload limits (fragmentation still applies upstream).

## Event kinds

| Kind | Body fields |
|------|-------------|
| `thread.created` | `type` (`request` \| `offer` \| `update`), `title`, `text`, `roughPlace`, `category`, optional `expiresAt` |
| `thread.reply.created` | `text` |
| `thread.offer.accepted` | `acceptedOfferEventID` |
| `thread.resolved` | optional `note` |
| `guidance.shared` | `title`, `text` |

## Forbidden in public events

Never include: phone numbers, emails, exact street addresses, apartment numbers, health records, contact details, or latitude/longitude coordinates.

`ContentSafetyPolicy` **flags** probable patterns; `EventAuthoriser` **rejects** over-limit or schema-invalid payloads. Callers decide how to present warnings.

## Area

MVP area string: `riverside-estate`. Out-of-area events are rejected by the authoriser and do not alter thread state.

## Authority

- `thread.created` creates the root only if it is the first valid event for `threadID`.
- Only the root event’s `authorPeerID` may author `thread.offer.accepted` or `thread.resolved`.
- A valid accept moves `Open` → `Matched`.
- A valid resolve moves `Open` or `Matched` → `Resolved`.
- Resolved threads do not reopen in v1.

## Mesh carriage

Public CT events ride bitchat **public** mesh messages. Private details use bitchat **encrypted private** messages only after `PrivateContactGate` allows. Never embed private details in public CT envelopes.

## Prefix / envelope marker

Wire payloads SHOULD start with the ASCII marker `CT1:` followed by compact JSON so the companion can ignore non-CT public traffic.
