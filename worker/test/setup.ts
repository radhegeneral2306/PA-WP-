// Most tests were written when the Round 7 chat switches (detail routing, memory) were off for everyone but the
// testers. They keep describing that behaviour: the switches are off in tests unless a test turns them on
// with setChatFlagsForTest (or by adding the user to CHAT_TESTERS). Production values: src/bot/chatFlags.ts.
import { setChatFlagsForTest } from "../src/bot/chatFlags";

setChatFlagsForTest({ detail: false, memory: false });
