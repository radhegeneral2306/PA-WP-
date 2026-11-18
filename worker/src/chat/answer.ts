// Round 5, Agent B: answers for list/count chat requests. Permissions are enforced HERE,
// whatever the rules layer or the AI asked for. Reads use listTasks only (at most 2 store calls).
import type { Outgoing } from "../bot/outgoing";
import { sortUrgentFirst, taskList, text } from "../bot/ui";
import type { Store, TaskFilter } from "../data/store";
import { daysFromToday, isOverdue, istDay } from "../domain/dates";
import { branchName, type Task, type User } from "../domain/types";
import type { ChatFilter, ChatRequest, ChatWhen } from "./types";

export const STAFF_REFUSAL = "Aap sirf apne tasks dekh sakte hain.";
const MAX_ROWS = 8;
const FLOW = "tasks";

type Query = Extract<ChatRequest, { kind: "list" | "count" }>;

/** Days from today (IST) of this week's Monday and Sunday, e.g. on Wednesday: -2 and +4. */
function weekRange(now: Date): { start: number; end: number } {
  const dow = new Date(Date.UTC(istDay(now).year, istDay(now).month - 1, istDay(now).day)).getUTCDay();
  const sinceMonday = (dow + 6) % 7;
  return { start: -sinceMonday, end: 6 - sinceMonday };
}

function inBucket(t: Task, when: ChatWhen, now: Date): boolean {
  switch (when) {
    case "all":
      return true;
    case "overdue":
      return isOverdue(t.dueAt, now);
    case "today":
      return daysFromToday(t.dueAt, now) === 0;
    case "tomorrow":
      return daysFromToday(t.dueAt, now) === 1;
    case "week": {
      const d = daysFromToday(t.dueAt, now);
      const { start, end } = weekRange(now);
      return d >= start && d <= end;
    }
  }
}

interface Resolved {
  tasks: Task[];
  /** Hinglish subject: "Aapke", "Pinky ke", "Durg ke", "Sabke". */
  subject: string;
  showAssignee: boolean;
}

async function load(store: Store, user: User, f: ChatFilter): Promise<Resolved | string> {
  const status = "pending" as const;
  const read = (filter: TaskFilter) => store.listTasks(filter);
  if (user.role !== "admin") {
    const own = f.scope === "mine" || (f.scope === "person" && f.person && f.person.trim().toLowerCase() === user.name.trim().toLowerCase());
    if (!own) return STAFF_REFUSAL;
    return { tasks: await read({ assigneePhone: user.phone, status }), subject: "Aapke", showAssignee: false };
  }
  if (f.scope === "mine") return { tasks: await read({ assigneePhone: user.phone, status }), subject: "Aapke", showAssignee: false };
  if (f.scope === "person") {
    const wanted = (f.person ?? "").trim().toLowerCase();
    const people = wanted ? await store.listUsers() : [];
    const match = people.find((u) => u.name.trim().toLowerCase() === wanted);
    if (!match) return "Ye naam mere paas nahi mila. Naam dobara likhiye ya menu use kijiye.";
    if (match.phone === user.phone) return { tasks: await read({ assigneePhone: match.phone, status }), subject: "Aapke", showAssignee: false };
    return { tasks: await read({ assigneePhone: match.phone, status }), subject: `${match.name} ke`, showAssignee: false };
  }
  if (f.scope === "branch") {
    if (!f.branch) return "Kaun si branch? Branch ka naam likhiye ya menu use kijiye.";
    return { tasks: await read({ branch: f.branch, status }), subject: `${branchName(f.branch)} ke`, showAssignee: true };
  }
  return { tasks: await read({ status }), subject: "Sabke", showAssignee: true };
}

const BUCKET_LABEL: Record<ChatWhen, string> = {
  all: "pending",
  today: "aaj ke",
  tomorrow: "kal ke",
  week: "is hafte ke",
  overdue: "overdue ⚠️",
};

export async function answerQuery(store: Store, user: User, request: Query, now: Date): Promise<Outgoing[]> {
  const filter = request.filter;
  const loaded = await load(store, user, filter);
  if (typeof loaded === "string") return [text(user.phone, loaded)];

  let tasks = loaded.tasks.filter((t) => t.status === "pending");
  if (filter.urgentOnly) tasks = tasks.filter((t) => t.urgent === true);
  const urgentWord = filter.urgentOnly ? "🔴 urgent " : "";
  const { subject } = loaded;

  if (request.kind === "count") {
    const pending = tasks.length;
    const overdue = tasks.filter((t) => isOverdue(t.dueAt, now)).length;
    const today = tasks.filter((t) => daysFromToday(t.dueAt, now) === 0).length;
    const asked = tasks.filter((t) => inBucket(t, filter.when, now)).length;
    const tail = pending === 0 ? " 🎉" : "";
    let body: string;
    switch (filter.when) {
      case "overdue":
        body = `${subject} *${overdue}* ${urgentWord}overdue ⚠️ tasks hain, total *${pending}* pending, *${today}* aaj due.`;
        break;
      case "today":
        body = `${subject} *${today}* ${urgentWord}tasks aaj due hain, total *${pending}* pending, *${overdue}* overdue ⚠️.`;
        break;
      case "tomorrow":
      case "week": {
        const label = filter.when === "tomorrow" ? "kal" : "is hafte";
        body = `${subject} *${asked}* ${urgentWord}tasks ${label} due hain, total *${pending}* pending, *${overdue}* overdue ⚠️, *${today}* aaj due.`;
        break;
      }
      default:
        body = `${subject} *${pending}* ${urgentWord}pending tasks hain, *${overdue}* overdue ⚠️, *${today}* aaj due.`;
    }
    return [text(user.phone, body + tail)];
  }

  const picked = sortUrgentFirst(tasks.filter((t) => inBucket(t, filter.when, now)));
  if (picked.length === 0) {
    const what = filter.when === "all" ? "pending" : BUCKET_LABEL[filter.when];
    return [text(user.phone, `${subject} ${urgentWord}${what} koi task nahi 🎉`)];
  }
  const shown = picked.slice(0, MAX_ROWS);
  const more = picked.length > shown.length ? ` Pehle ${shown.length} dikha raha hoon.` : "";
  const header = `${subject} ${urgentWord}${BUCKET_LABEL[filter.when]} *${picked.length}* tasks hain.${more}`;
  return [
    text(user.phone, header),
    taskList(user.phone, FLOW, shown, "Detail ke liye task chuniye 👇", { now, showAssignee: loaded.showAssignee }),
  ];
}
