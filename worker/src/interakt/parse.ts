// Turns an Interakt webhook body into a small, predictable shape.
// Interakt's docs don't spell out how list/button replies arrive, so the reply
// extraction accepts every variant seen so far (object, JSON string, nested
// under `interactive`, template quick-reply `button`).

export interface Reply {
  kind: "list" | "button";
  id: string;
  title: string;
}

export interface IncomingMessage {
  messageId: string;
  /** Digits only, with country code, e.g. "919999999999". */
  phone: string;
  countryCode: string;
  /** National number as Interakt sends it, e.g. "9999999999". */
  phoneNumber: string;
  name: string;
  contentType: string;
  text: string;
  reply: Reply | null;
  mediaUrl: string | null;
  receivedAt: string | null;
  organizationId: string | null;
}

export type ParsedWebhook =
  | { kind: "message"; message: IncomingMessage }
  | { kind: "ignored"; type: string };

type Obj = Record<string, any>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const digits = (v: string): string => v.replace(/\D/g, "");

export function parseWebhook(body: unknown): ParsedWebhook {
  if (!isObj(body)) return { kind: "ignored", type: "invalid" };
  const type = str(body.type);
  if (type !== "message_received") return { kind: "ignored", type: type || "unknown" };

  const data = isObj(body.data) ? body.data : {};
  const customer = isObj(data.customer) ? data.customer : {};
  const msg = isObj(data.message) ? data.message : {};
  const traits = isObj(customer.traits) ? customer.traits : {};

  const countryCode = str(customer.country_code) || "+91";
  const phoneNumber = digits(str(customer.phone_number));
  const channelPhone = digits(str(customer.channel_phone_number));
  const phone = channelPhone || digits(countryCode) + phoneNumber;

  const content = decodeContent(msg.message);
  const reply = extractReply(content);

  return {
    kind: "message",
    message: {
      messageId: str(msg.id),
      phone,
      countryCode,
      phoneNumber,
      name: str(traits.name),
      contentType: str(msg.message_content_type),
      text: typeof content === "string" ? content.trim() : reply?.title ?? "",
      reply,
      mediaUrl: msg.media_url ? str(msg.media_url) : null,
      receivedAt: msg.received_at_utc ? str(msg.received_at_utc) : null,
      organizationId: data.organization_id ? str(data.organization_id) : null,
    },
  };
}

function decodeContent(raw: unknown): unknown {
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.startsWith("{")) {
      try {
        return JSON.parse(t);
      } catch {
        return raw;
      }
    }
    return raw;
  }
  return raw;
}

export function extractReply(content: unknown): Reply | null {
  if (!isObj(content)) return null;
  if (isObj(content.interactive)) return extractReply(content.interactive);

  if (isObj(content.list_reply)) return toReply("list", content.list_reply);
  if (isObj(content.button_reply)) return toReply("button", content.button_reply);
  // Template quick-reply buttons: { type: "button", button: { payload, text } }
  if (isObj(content.button)) {
    const b = content.button;
    return toReply("button", { id: b.payload ?? b.id ?? b.text, title: b.text ?? b.title });
  }
  return null;
}

function toReply(kind: Reply["kind"], r: Obj): Reply | null {
  const id = str(r.id);
  const title = str(r.title);
  if (!id && !title) return null;
  return { kind, id: id || title, title: title || id };
}
