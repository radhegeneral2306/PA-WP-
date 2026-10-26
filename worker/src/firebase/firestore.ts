// Minimal Firestore REST client. Only what the bot needs so far.

import { getAccessToken, type ServiceAccount } from "./auth";

export interface FirestoreConfig extends ServiceAccount {
  projectId: string;
}

export type Plain = string | number | boolean | null | Date | Plain[] | { [k: string]: Plain };

export function toValue(v: Plain): Record<string, unknown> {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}

export function toFields(obj: { [k: string]: Plain }): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toValue(v);
  return fields;
}

function docsUrl(cfg: FirestoreConfig): string {
  return `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`;
}

/**
 * Creates `collection/docId` only if it does not exist yet.
 * Returns false when the document already exists, which doubles as
 * duplicate-webhook detection when docId is the Interakt message id.
 */
export async function createIfAbsent(
  cfg: FirestoreConfig,
  collection: string,
  docId: string,
  data: { [k: string]: Plain },
): Promise<boolean> {
  const token = await getAccessToken(cfg);
  const url = `${docsUrl(cfg)}/${collection}?documentId=${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFields(data) }),
  });
  if (res.status === 409) return false;
  if (!res.ok) throw new Error(`Firestore create ${collection}/${docId} failed ${res.status}: ${await res.text()}`);
  return true;
}

/** Reads one document page to prove the credentials and project id work. */
export async function checkAccess(cfg: FirestoreConfig, collection: string): Promise<void> {
  const token = await getAccessToken(cfg);
  const res = await fetch(`${docsUrl(cfg)}/${collection}?pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Firestore read ${collection} failed ${res.status}: ${await res.text()}`);
}
