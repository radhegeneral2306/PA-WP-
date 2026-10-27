// "Naya task (Form)": sends the WhatsApp Form template and turns a submitted form into a task.
// Placeholder signatures; implemented in Batch 3 phase 3.

import type { BotContext, Flow } from "../flow";
import type { Outgoing } from "../outgoing";

export const taskFormFlow: Flow = {
  id: "task_form",
  async start(_ctx: BotContext) {
    return [];
  },
  async handle() {
    return [];
  },
};

export async function handleTaskForm(_ctx: BotContext, _form: Record<string, unknown>): Promise<Outgoing[]> {
  return [];
}
