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

/** "98765 43210" / "+91 98765-43210" → "919876543210"; null if not an Indian mobile. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return null;
}
