import { describe, expect, it } from "vitest";
import { signJwt } from "../src/firebase/auth";
import { toFields } from "../src/firebase/firestore";

describe("toFields", () => {
  it("encodes plain values as Firestore typed values", () => {
    expect(
      toFields({
        s: "a",
        i: 3,
        d: 1.5,
        b: true,
        n: null,
        t: new Date("2026-10-24T00:00:00Z"),
        arr: ["x"],
        map: { k: 1 },
      }),
    ).toEqual({
      s: { stringValue: "a" },
      i: { integerValue: "3" },
      d: { doubleValue: 1.5 },
      b: { booleanValue: true },
      n: { nullValue: null },
      t: { timestampValue: "2026-10-24T00:00:00.000Z" },
      arr: { arrayValue: { values: [{ stringValue: "x" }] } },
      map: { mapValue: { fields: { k: { integerValue: "1" } } } },
    });
  });
});

describe("signJwt", () => {
  it("signs a verifiable RS256 JWT from a PEM key with escaped newlines", async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\\n");
    const pem = `-----BEGIN PRIVATE KEY-----\\n${b64}\\n-----END PRIVATE KEY-----\\n`;

    const jwt = await signJwt({ clientEmail: "bot@test.iam.gserviceaccount.com", privateKey: pem }, 1000);
    const [h, c, s] = jwt.split(".");
    const decode = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));

    expect(JSON.parse(new TextDecoder().decode(decode(c)))).toMatchObject({
      iss: "bot@test.iam.gserviceaccount.com",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1000,
      exp: 4600,
    });
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      pair.publicKey,
      decode(s),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(valid).toBe(true);
  });
});
