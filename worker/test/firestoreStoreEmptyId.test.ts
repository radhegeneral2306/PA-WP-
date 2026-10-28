import { afterEach, describe, expect, it, vi } from "vitest";
import { FirestoreStore } from "../src/data/firestoreStore";

// Health alert tasks are created by "Bot" with phone "": acting on them must not query /users/ (audit S3).
describe("FirestoreStore empty ids", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("getUser('') and getTask('') return null without any request", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const store = new FirestoreStore({ projectId: "p", clientEmail: "c", privateKey: "k" });
    expect(await store.getUser("")).toBeNull();
    expect(await store.getTask("")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
