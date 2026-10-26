import { describe, expect, it } from "vitest";
import { interaktSignature, verifyInteraktSignature } from "../src/interakt/signature";

describe("Interakt signature", () => {
  it("matches a known HMAC-SHA256 vector", async () => {
    // RFC 4231 test case 2
    expect(await interaktSignature("Jefe", "what do ya want for nothing?")).toBe(
      "sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("accepts a valid header and rejects tampered bodies", async () => {
    const sig = await interaktSignature("k", '{"a":1}');
    expect(await verifyInteraktSignature("k", '{"a":1}', sig)).toBe(true);
    expect(await verifyInteraktSignature("k", '{"a":1}', sig.toUpperCase().replace("SHA256", "sha256"))).toBe(true);
    expect(await verifyInteraktSignature("k", '{"a":2}', sig)).toBe(false);
    expect(await verifyInteraktSignature("k", '{"a":1}', null)).toBe(false);
  });
});
