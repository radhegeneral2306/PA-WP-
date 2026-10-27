// Minimal Firestore REST client: typed-value codec plus document CRUD and
// single-filter queries over the v1 REST API.

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

/** Decodes a Firestore typed value. Timestamps come back as ISO strings. */
export function fromValue(v: Record<string, unknown>): Plain {
  if ("stringValue" in v) return v.stringValue as string;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue as boolean;
  if ("timestampValue" in v) return new Date(v.timestampValue as string).toISOString();
  if ("referenceValue" in v) return v.referenceValue as string;
  if ("bytesValue" in v) return v.bytesValue as string;
  if ("arrayValue" in v) {
    const arr = v.arrayValue as { values?: Record<string, unknown>[] };
    return (arr.values ?? []).map(fromValue);
  }
  if ("mapValue" in v) return fromFields((v.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields);
  return null; // nullValue (and anything unknown)
}

export function fromFields(fields: Record<string, Record<string, unknown>> = {}): { [k: string]: Plain } {
  const obj: { [k: string]: Plain } = {};
  for (const [k, v] of Object.entries(fields)) obj[k] = fromValue(v);
  return obj;
}

/** REST shape of a document. */
export interface RawDoc {
  name: string;
  fields?: Record<string, Record<string, unknown>>;
}

/** Decoded document: id is the last segment of the resource name. */
export interface Doc {
  id: string;
  data: { [k: string]: Plain };
}

export function decodeDoc(raw: RawDoc): Doc {
  return { id: raw.name.slice(raw.name.lastIndexOf("/") + 1), data: fromFields(raw.fields) };
}

function docsUrl(cfg: FirestoreConfig): string {
  return `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`;
}

function docUrl(cfg: FirestoreConfig, collection: string, id: string): string {
  return `${docsUrl(cfg)}/${collection}/${encodeURIComponent(id)}`;
}

async function call(cfg: FirestoreConfig, method: string, url: string, body?: unknown): Promise<Response> {
  const token = await getAccessToken(cfg);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function fail(what: string, res: Response): Promise<never> {
  throw new Error(`Firestore ${what} failed ${res.status}: ${await res.text()}`);
}

/** Returns null when the document does not exist. */
export async function getDoc(cfg: FirestoreConfig, collection: string, id: string): Promise<Doc | null> {
  const res = await call(cfg, "GET", docUrl(cfg, collection, id));
  if (res.status === 404) return null;
  if (!res.ok) return fail(`get ${collection}/${id}`, res);
  return decodeDoc((await res.json()) as RawDoc);
}

/** Creates or fully replaces `collection/id`. */
export async function setDoc(
  cfg: FirestoreConfig,
  collection: string,
  id: string,
  data: { [k: string]: Plain },
): Promise<void> {
  const res = await call(cfg, "PATCH", docUrl(cfg, collection, id), { fields: toFields(data) });
  if (!res.ok) await fail(`set ${collection}/${id}`, res);
}

/**
 * Updates only the given top-level fields of an existing document
 * (keys must be simple identifiers). Fails with 404 if it does not exist.
 */
export async function patchDoc(
  cfg: FirestoreConfig,
  collection: string,
  id: string,
  data: { [k: string]: Plain },
): Promise<void> {
  const params = new URLSearchParams({ "currentDocument.exists": "true" });
  for (const k of Object.keys(data)) params.append("updateMask.fieldPaths", k);
  const res = await call(cfg, "PATCH", `${docUrl(cfg, collection, id)}?${params}`, { fields: toFields(data) });
  if (!res.ok) await fail(`patch ${collection}/${id}`, res);
}

/** Deleting a missing document is not an error. */
export async function deleteDoc(cfg: FirestoreConfig, collection: string, id: string): Promise<void> {
  const res = await call(cfg, "DELETE", docUrl(cfg, collection, id));
  if (!res.ok && res.status !== 404) await fail(`delete ${collection}/${id}`, res);
}

/** Creates a document with an auto-generated id and returns that id. */
export async function createDoc(cfg: FirestoreConfig, collection: string, data: { [k: string]: Plain }): Promise<string> {
  const res = await call(cfg, "POST", `${docsUrl(cfg)}/${collection}`, { fields: toFields(data) });
  if (!res.ok) return fail(`create ${collection}`, res);
  return decodeDoc((await res.json()) as RawDoc).id;
}

export interface EqualityFilter {
  field: string;
  value: Plain;
}

/**
 * Lists a collection, optionally narrowed by one equality filter. One filter
 * and no orderBy means only automatic single-field indexes are needed.
 */
export async function queryDocs(cfg: FirestoreConfig, collection: string, filter?: EqualityFilter): Promise<Doc[]> {
  const structuredQuery: Record<string, unknown> = { from: [{ collectionId: collection }] };
  if (filter) {
    structuredQuery.where = {
      fieldFilter: { field: { fieldPath: filter.field }, op: "EQUAL", value: toValue(filter.value) },
    };
  }
  const res = await call(cfg, "POST", `${docsUrl(cfg)}:runQuery`, { structuredQuery });
  if (!res.ok) return fail(`query ${collection}`, res);
  const rows = (await res.json()) as { document?: RawDoc }[];
  return rows.filter((r) => r.document).map((r) => decodeDoc(r.document as RawDoc));
}

/** The document with the highest `field` value (single-field index, automatic), or null. */
export async function latestDoc(cfg: FirestoreConfig, collection: string, field: string): Promise<Doc | null> {
  const structuredQuery = {
    from: [{ collectionId: collection }],
    orderBy: [{ field: { fieldPath: field }, direction: "DESCENDING" }],
    limit: 1,
  };
  const res = await call(cfg, "POST", `${docsUrl(cfg)}:runQuery`, { structuredQuery });
  if (!res.ok) return fail(`latest ${collection}`, res);
  const rows = (await res.json()) as { document?: RawDoc }[];
  const raw = rows.find((r) => r.document)?.document;
  return raw ? decodeDoc(raw) : null;
}

/**
 * Documents whose `field` is strictly less than `before` (Date -> timestamp
 * comparison, string -> lexicographic, e.g. ISO dates), at most `limit`.
 * One range filter and no orderBy: only the automatic single-field index.
 * `select` limits the returned fields (["__name__"] = ids only, which keeps
 * the response small for collections holding large payloads).
 */
export async function queryBefore(
  cfg: FirestoreConfig,
  collection: string,
  field: string,
  before: Date | string,
  limit: number,
  select?: string[],
): Promise<Doc[]> {
  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: collection }],
    where: {
      fieldFilter: {
        field: { fieldPath: field },
        op: "LESS_THAN",
        value: before instanceof Date ? { timestampValue: before.toISOString() } : { stringValue: before },
      },
    },
    limit,
  };
  if (select) structuredQuery.select = { fields: select.map((fieldPath) => ({ fieldPath })) };
  const res = await call(cfg, "POST", `${docsUrl(cfg)}:runQuery`, { structuredQuery });
  if (!res.ok) return fail(`query ${collection} ${field} < ${String(before instanceof Date ? before.toISOString() : before)}`, res);
  const rows = (await res.json()) as { document?: RawDoc }[];
  return rows.filter((r) => r.document).map((r) => decodeDoc(r.document as RawDoc));
}

/** Max writes Firestore accepts in one commit. */
export const MAX_COMMIT_WRITES = 500;

/**
 * Deletes `collection/<id>` for every id with one `documents:commit` per
 * 500 ids (atomic per chunk). Deleting a missing document is not an error.
 */
export async function deleteMany(cfg: FirestoreConfig, collection: string, ids: string[]): Promise<void> {
  const base = `projects/${cfg.projectId}/databases/(default)/documents/${collection}`;
  for (let i = 0; i < ids.length; i += MAX_COMMIT_WRITES) {
    const chunk = ids.slice(i, i + MAX_COMMIT_WRITES);
    const writes = chunk.map((id) => ({ delete: `${base}/${id}` }));
    const res = await call(cfg, "POST", `${docsUrl(cfg)}:commit`, { writes });
    if (!res.ok) await fail(`delete ${chunk.length} docs in ${collection}`, res);
  }
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
