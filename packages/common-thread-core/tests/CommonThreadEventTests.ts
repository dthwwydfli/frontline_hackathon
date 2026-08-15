import { describe, expect, it } from "vitest";
import {
  MAX_PUBLIC_TEXT_CODE_POINTS,
  decodeWirePayload,
  encodeWirePayload,
  parseCommonThreadEvent,
  unicodeLength,
  type CommonThreadEvent,
} from "../src/Domain/CommonThreadEvent.js";

function baseEvent(
  overrides: Partial<CommonThreadEvent> = {},
): CommonThreadEvent {
  return {
    v: 1,
    eventID: "11111111-1111-1111-1111-111111111111",
    threadID: "22222222-2222-2222-2222-222222222222",
    area: "riverside-estate",
    kind: "thread.created",
    authorPeerID: "peer-a",
    createdAt: "2026-08-15T12:00:00.000Z",
    body: {
      type: "request",
      title: "Need torch",
      text: "Power is out on our floor",
      roughPlace: "near the courtyard",
      category: "supplies",
    },
    ...overrides,
  };
}

describe("CommonThreadEvent encode/decode", () => {
  it("round-trips a valid event on the wire", () => {
    const event = baseEvent();
    const wire = encodeWirePayload(event);
    expect(wire.startsWith("CT1:")).toBe(true);
    const decoded = decodeWirePayload(wire);
    expect(decoded).toEqual(event);
  });

  it("rejects invalid JSON / missing fields", () => {
    expect(() => decodeWirePayload("CT1:{")).toThrow();
    expect(() => parseCommonThreadEvent({ v: 1 })).toThrow();
  });

  it("enforces 300 Unicode character public text limit", () => {
    const long = "😀".repeat(MAX_PUBLIC_TEXT_CODE_POINTS + 1);
    expect(unicodeLength(long)).toBe(MAX_PUBLIC_TEXT_CODE_POINTS + 1);
    expect(() =>
      parseCommonThreadEvent(
        baseEvent({
          body: {
            type: "request",
            title: "ok",
            text: long,
            roughPlace: "here",
            category: "supplies",
          },
        }),
      ),
    ).toThrow(/300/);
  });

  it("allows exactly 300 code points", () => {
    const text = "a".repeat(MAX_PUBLIC_TEXT_CODE_POINTS);
    const event = parseCommonThreadEvent(
      baseEvent({
        body: {
          type: "request",
          title: "ok",
          text,
          roughPlace: "here",
          category: "supplies",
        },
      }),
    );
    expect(unicodeLength((event.body as { text: string }).text)).toBe(300);
  });
});
