// Batch 0 test bot: proves that list/button messages go out through the
// Interakt API and shows what their replies look like in the webhook.
// Replaced by the real menu in Batch 1.

import type { IncomingMessage } from "./interakt/parse";
import { buttonsPayload, listPayload, send, textPayload, type Recipient } from "./interakt/send";

export const TEST_BRANCHES = [
  { id: "BRANCH_RAIPUR", title: "Raipur" },
  { id: "BRANCH_JAGDALPUR", title: "Jagdalpur" },
  { id: "BRANCH_DURG", title: "Durg" },
];

const GREETINGS = new Set(["hi", "hii", "hello", "hey", "menu"]);

/** Returns the payloads the test bot sends for one incoming message. */
export function batch0Replies(msg: IncomingMessage): object[] {
  const to: Recipient = { countryCode: msg.countryCode, phoneNumber: msg.phoneNumber };
  const debug = `(type: ${msg.contentType || "?"})`;

  if (msg.reply?.kind === "list") {
    return [textPayload(to, `✅ List kaam kar rahi hai!\nAapne chuna: *${msg.reply.title}*\nid: ${msg.reply.id} ${debug}`)];
  }
  if (msg.reply?.kind === "button") {
    return [textPayload(to, `✅ Button kaam kar raha hai!\nAapne dabaya: *${msg.reply.title}*\nid: ${msg.reply.id} ${debug}`)];
  }
  if (GREETINGS.has(msg.text.toLowerCase())) {
    return [
      listPayload(to, {
        body: `Namaste${msg.name ? ` ${msg.name}` : ""} 🙏\nBatch 0 test: ek branch chuniye.`,
        button: "Branch chuno",
        sectionTitle: "Branches",
        rows: TEST_BRANCHES,
      }),
      buttonsPayload(to, {
        body: "Batch 0 test: koi ek button dabaiye.",
        buttons: [
          { id: "TEST_APPROVE", title: "Approve" },
          { id: "TEST_REJECT", title: "Reject" },
        ],
      }),
    ];
  }
  return [textPayload(to, `Batch 0 test bot hai. Menu ke liye *Hi* bhejiye. ${debug}`)];
}

export async function handleBatch0(apiKey: string, msg: IncomingMessage): Promise<void> {
  // Sequential so the list arrives before the buttons.
  for (const payload of batch0Replies(msg)) {
    await send(apiKey, payload);
  }
}
