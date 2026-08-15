import { describe, expect, it } from 'vitest';

import { EMERGENCY_NOTICE, scanForWarnings } from '../src/domain/ContentSafety';
import { decodeJoinPayload, encodeJoinPayload, roomCodeFor } from '../src/identity/JoinPayload';

function kinds(text: string): string[] {
  return scanForWarnings(text).map((w) => w.kind);
}

describe('content warnings', () => {
  it('flags a phone number', () => {
    expect(kinds('call me on 07700 900123')).toContain('phone_number');
  });

  it('flags an international phone number', () => {
    expect(kinds('+44 7700 900123')).toContain('phone_number');
  });

  it('flags an email address', () => {
    expect(kinds('reach me at sam@example.org')).toContain('email_address');
  });

  it('flags a street address', () => {
    expect(kinds('I am at 42 Bramble Lane')).toContain('street_address');
  });

  it('flags coordinates', () => {
    expect(kinds('here: 51.50722, -0.12750')).toContain('coordinates');
  });

  it('flags an identity document number', () => {
    expect(kinds('passport 123456789')).toContain('identity_document');
  });

  it('stays quiet on an ordinary post', () => {
    expect(scanForWarnings('Need three blankets near the north stairwell')).toEqual([]);
  });

  it('does not flag small quantities as phone numbers', () => {
    expect(kinds('I have 3 tins and 12 bottles')).not.toContain('phone_number');
  });

  it('does not flag a time as a phone number', () => {
    expect(kinds('meeting at 14:30 today')).not.toContain('phone_number');
  });

  it('does not flag an approximate place', () => {
    expect(scanForWarnings('second floor, by the fire door')).toEqual([]);
  });

  it('reports the matched text so the composer can highlight it', () => {
    const warnings = scanForWarnings('email sam@example.org please');
    expect(warnings[0].match).toBe('sam@example.org');
  });

  it('reports each distinct match once', () => {
    const warnings = scanForWarnings('sam@example.org and sam@example.org');
    expect(warnings.filter((w) => w.kind === 'email_address')).toHaveLength(1);
  });

  it('finds several kinds in one post', () => {
    const found = kinds('sam@example.org or 07700 900123, I am at 42 Bramble Lane');
    expect(found).toContain('email_address');
    expect(found).toContain('phone_number');
    expect(found).toContain('street_address');
  });

  it('does not carry regex state between calls', () => {
    // A /g pattern reused without resetting lastIndex silently misses matches
    // on every other call.
    const first = scanForWarnings('sam@example.org');
    const second = scanForWarnings('sam@example.org');
    expect(second).toEqual(first);
  });

  it('handles an empty post', () => {
    expect(scanForWarnings('')).toEqual([]);
  });

  it('carries a message that tells the user what to do', () => {
    for (const warning of scanForWarnings('sam@example.org')) {
      expect(warning.message.length).toBeGreaterThan(20);
    }
  });
});

describe('emergency notice', () => {
  it('never claims to contact emergency services', () => {
    expect(EMERGENCY_NOTICE).toContain('not an emergency service');
    expect(EMERGENCY_NOTICE.toLowerCase()).not.toMatch(/we will|we can call|dispatch/);
  });
});

describe('join payload', () => {
  const roomId = 'room-alpha';
  const secretHex = 'a'.repeat(64);

  it('round-trips a join link', () => {
    const uri = encodeJoinPayload({ roomId, secretHex });
    expect(decodeJoinPayload(uri)).toEqual({ roomId, secretHex });
  });

  it('round-trips an optional room name', () => {
    const uri = encodeJoinPayload({ roomId, secretHex, roomName: 'Hall B' });
    expect(decodeJoinPayload(uri)?.roomName).toBe('Hall B');
  });

  it('rejects a link with no secret', () => {
    expect(decodeJoinPayload('commonthread://join?r=room-alpha')).toBeNull();
  });

  it('rejects a secret that is not hex', () => {
    expect(
      decodeJoinPayload(`commonthread://join?r=${roomId}&k=${'z'.repeat(64)}`),
    ).toBeNull();
  });

  it('rejects a secret that is too short to be high entropy', () => {
    expect(decodeJoinPayload(`commonthread://join?r=${roomId}&k=abcd`)).toBeNull();
  });

  it('rejects a room id that could not travel in an envelope', () => {
    expect(decodeJoinPayload(`commonthread://join?r=room%20alpha&k=${secretHex}`)).toBeNull();
  });

  it('rejects a link for another scheme', () => {
    expect(decodeJoinPayload(`https://example.org/join?r=${roomId}&k=${secretHex}`)).toBeNull();
  });

  it('rejects a bare string', () => {
    expect(decodeJoinPayload('not a link')).toBeNull();
  });

  it('normalises the secret to lower case so both devices derive one key', () => {
    const uri = `commonthread://join?r=${roomId}&k=${'A'.repeat(64)}`;
    expect(decodeJoinPayload(uri)?.secretHex).toBe('a'.repeat(64));
  });
});

describe('room code', () => {
  it('is stable for a room id', () => {
    expect(roomCodeFor('room-alpha')).toBe(roomCodeFor('room-alpha'));
  });

  it('differs between rooms', () => {
    expect(roomCodeFor('room-alpha')).not.toBe(roomCodeFor('room-beta'));
  });

  it('is short enough to read aloud', () => {
    expect(roomCodeFor('room-alpha')).toMatch(/^[0-9A-F]{6}$/);
  });
});
