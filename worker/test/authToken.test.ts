import { afterEach, describe, expect, it, vi } from "vitest";

// Parallel Firestore calls must share one OAuth token request (each fetch is a subrequest).
describe("getAccessToken single-flight", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("three parallel callers make one token request; later calls use the cache", async () => {
    const { getAccessToken } = await import("../src/firebase/auth");
    const pair = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    const pem = `-----BEGIN PRIVATE KEY-----\\n${btoa(String.fromCharCode(...pkcs8))}\\n-----END PRIVATE KEY-----`;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const sa = { clientEmail: "single-flight@test", privateKey: pem };
    expect(await Promise.all([getAccessToken(sa), getAccessToken(sa), getAccessToken(sa)])).toEqual(["tok", "tok", "tok"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getAccessToken(sa)).toBe("tok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
