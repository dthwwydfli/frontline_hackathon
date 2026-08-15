/**
 * Local pattern warnings before a public send.
 *
 * A public post goes to everyone in the room and cannot be recalled off a
 * mesh. This runs entirely on-device and warns; it never blocks a send and
 * never transmits what it found. Users writing under stress may have a good
 * reason to include something this flags, and the product does not get to
 * overrule them.
 *
 * These are heuristics. They will miss things. The UI must say "check before
 * you post", not "no personal details found".
 */

export type WarningKind =
  | 'phone_number'
  | 'email_address'
  | 'street_address'
  | 'coordinates'
  | 'identity_document';

export type ContentWarning = {
  kind: WarningKind;
  /** The matched text, for highlighting in the composer. Stays on-device. */
  match: string;
  message: string;
};

type Rule = {
  kind: WarningKind;
  pattern: RegExp;
  message: string;
};

const RULES: Rule[] = [
  {
    kind: 'phone_number',
    // 7+ digits allowing spaces, dashes, dots, parens, optional country code.
    pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g,
    message: 'This looks like a phone number. Public posts are visible to everyone nearby.',
  },
  {
    kind: 'email_address',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    message: 'This looks like an email address. Share contact details privately after accepting an offer.',
  },
  {
    kind: 'street_address',
    pattern:
      /\b\d{1,4}[a-zA-Z]?\s+[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)*\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|close|court|ct|crescent|way|place|pl|terrace|boulevard|blvd)\b/gi,
    message: 'This looks like an exact address. An approximate place is safer in a public post.',
  },
  {
    kind: 'coordinates',
    // Decimal lat/long pairs, e.g. "51.5074, -0.1278".
    pattern: /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g,
    message: 'This looks like exact coordinates. Public posts should not pin your location.',
  },
  {
    kind: 'identity_document',
    pattern:
      /\b(?:passport|national insurance|nhs number|social security|ssn|driver'?s? licence|driver'?s? license|medicare)\b[\s:#-]*[A-Z0-9-]{4,}/gi,
    message: 'This looks like an identity document number. Never put one in a public post.',
  },
];

/**
 * Digits-only length of a candidate, used to keep the phone rule off things
 * like "2 tins" or a time range.
 */
function digitCount(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') count++;
  }
  return count;
}

export function scanForWarnings(text: string): ContentWarning[] {
  const warnings: ContentWarning[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    // Fresh regex per call: /g patterns carry lastIndex between uses.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const value = match[0].trim();
      if (value.length === 0) continue;

      if (rule.kind === 'phone_number') {
        const digits = digitCount(value);
        if (digits < 7 || digits > 15) continue;
        // An email's local part often contains a digit run; the email rule
        // already covers that case with a better message.
        if (/@/.test(text.slice(Math.max(0, match.index - 1), match.index + value.length + 1))) {
          continue;
        }
      }

      const key = `${rule.kind}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      warnings.push({ kind: rule.kind, match: value, message: rule.message });
    }
  }

  return warnings;
}

/** Fixed notice. Must stay visible wherever a user can post. */
export const EMERGENCY_NOTICE =
  'Common Thread is not an emergency service. If there is immediate danger, use any available official emergency channel.';
