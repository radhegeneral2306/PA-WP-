// Interakt session-message sender (Advance plan). Works only inside the 24-hour
// window after the user's last message; outside it a template is required.

const INTERAKT_MESSAGE_URL = "https://api.interakt.ai/v1/public/message/";

export interface Recipient {
  countryCode: string; // "+91"
  phoneNumber: string; // national number, "9999999999"
}

export interface ListRow {
  id: string;
  title: string; // WhatsApp limit: 24 chars
  description?: string; // WhatsApp limit: 72 chars
}

export interface Button {
  id: string;
  title: string; // WhatsApp limit: 20 chars
}

export interface SendResult {
  ok: boolean;
  status: number;
  body: string;
}

export function textPayload(to: Recipient, text: string) {
  return { ...base(to), type: "Text", data: { message: text } };
}

export function listPayload(
  to: Recipient,
  opts: { body: string; button: string; sectionTitle: string; rows: ListRow[] },
) {
  if (opts.rows.length < 1 || opts.rows.length > 10) {
    throw new Error(`List needs 1-10 rows, got ${opts.rows.length}`);
  }
  return {
    ...base(to),
    type: "InteractiveList",
    data: {
      message: {
        type: "list",
        body: { text: opts.body },
        action: {
          button: opts.button.slice(0, 20),
          sections: [
            {
              title: opts.sectionTitle.slice(0, 24),
              rows: opts.rows.map((r) => ({
                id: r.id,
                title: r.title.slice(0, 24),
                ...(r.description ? { description: r.description.slice(0, 72) } : {}),
              })),
            },
          ],
        },
      },
    },
  };
}

export function buttonsPayload(to: Recipient, opts: { body: string; buttons: Button[] }) {
  if (opts.buttons.length < 1 || opts.buttons.length > 3) {
    throw new Error(`Buttons need 1-3 items, got ${opts.buttons.length}`);
  }
  return {
    ...base(to),
    type: "InteractiveButton",
    data: {
      message: {
        type: "button",
        body: { text: opts.body },
        action: {
          buttons: opts.buttons.map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    },
  };
}

function base(to: Recipient) {
  return { countryCode: to.countryCode, phoneNumber: to.phoneNumber };
}

export async function send(apiKey: string, payload: object): Promise<SendResult> {
  const res = await fetch(INTERAKT_MESSAGE_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  const type = (payload as { type?: string }).type;
  if (res.ok) console.log("Interakt send ok", type, body.slice(0, 200));
  else console.error("Interakt send failed", type, res.status, body.slice(0, 500));
  return { ok: res.ok, status: res.status, body };
}
