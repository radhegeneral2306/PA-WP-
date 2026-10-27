// "Voice se task" (Batch 4): admin voice note -> confirm -> task. Placeholder.
import type { BotContext, Flow } from "../flow";
import type { Outgoing } from "../outgoing";

export const voiceTaskFlow: Flow = {
  id: "voice_task",
  async start() {
    return [];
  },
  async handle() {
    return [];
  },
};

export async function handleVoice(_ctx: BotContext, _mediaUrl: string): Promise<Outgoing[]> {
  return [];
}
