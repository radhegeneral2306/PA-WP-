// User changes shared by the "Staff manage" chat flow and the /users endpoint,
// so both behave the same.

import type { Store } from "../data/store";
import { branchName, type User } from "../domain/types";
import type { Outgoing } from "./outgoing";

export function roleLabel(user: Pick<User, "role" | "branch">): string {
  return user.role === "admin" ? "Admin" : `Staff (${branchName(user.branch)})`;
}

/** welcome_user_v1 for a newly added user. */
export function welcomeMessage(user: User, addedBy: string): Outgoing {
  const label = roleLabel(user);
  return {
    to: user.phone,
    kind: "template",
    template: "welcome_user_v1",
    bodyValues: [user.name, addedBy, label],
    fallbackText: [
      `Namaste ${user.name} ji,`,
      `${addedBy} ne aapko Radhe Task Bot par *${label}* ke roop mein add kiya hai.`,
      "",
      "Ab aap WhatsApp par hi apne tasks dekh aur update kar sakte hain. Shuru karne ke liye *Hi* bhejiye.",
    ].join("\n"),
  };
}

/** Carries a name or branch change over to the user's existing tasks (assigned and created). */
export async function syncUserTasks(store: Store, before: User, after: User): Promise<number> {
  let count = 0;
  if (before.name !== after.name || before.branch !== after.branch) {
    for (const t of await store.listTasks({ assigneePhone: after.phone })) {
      const patch = { assigneeName: after.name, branch: after.branch };
      await store.updateTask(t.id, t.createdByPhone === after.phone ? { ...patch, createdByName: after.name } : patch);
      count++;
    }
  }
  if (before.name !== after.name) {
    for (const t of await store.listTasks({ createdByPhone: after.phone })) {
      if (t.assigneePhone === after.phone) continue; // already updated above
      await store.updateTask(t.id, { createdByName: after.name });
      count++;
    }
  }
  return count;
}
