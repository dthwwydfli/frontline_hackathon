import { describe, expect, it } from "vitest";
import { ContentSafetyPolicy } from "../src/Domain/ContentSafetyPolicy.js";

describe("ContentSafetyPolicy", () => {
  const policy = new ContentSafetyPolicy();

  it("flags phone, email, coordinates, address-like, and medical phrases", () => {
    const phone = policy.inspectText("Call me on 07123 456789 please");
    expect(phone.some((w) => w.code === "phone")).toBe(true);

    const email = policy.inspectText("Reach me at neighbour@example.com");
    expect(email.some((w) => w.code === "email")).toBe(true);

    const coords = policy.inspectText("Meet at 51.5074, -0.1278");
    expect(coords.some((w) => w.code === "coordinates")).toBe(true);

    const apt = policy.inspectText("I am in flat 12b");
    expect(apt.some((w) => w.code === "address_like")).toBe(true);

    const med = policy.inspectText("Here is my medical record summary");
    expect(med.some((w) => w.code === "medical_detail")).toBe(true);
  });

  it("does not strip text — returns warnings only", () => {
    const text = "Need help near the courtyard";
    const warnings = policy.inspectText(text);
    expect(text).toBe("Need help near the courtyard");
    expect(Array.isArray(warnings)).toBe(true);
  });
});
