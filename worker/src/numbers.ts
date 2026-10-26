import type { Env } from "./env";

export function testNumbers(env: Env): Set<string> {
  return new Set(
    (env.TEST_NUMBERS ?? "")
      .split(",")
      .map((n) => n.replace(/\D/g, ""))
      .filter(Boolean),
  );
}

/** Last four digits only, so logs don't carry full phone numbers. */
export function mask(phone: string): string {
  return phone.length > 4 ? `***${phone.slice(-4)}` : phone;
}
