// Round 5, Agent B: answers for list/count chat requests. Permissions are enforced HERE,
// whatever the rules layer or the AI asked for. Reads use listTasks only (at most 2 store calls).
import type { Outgoing } from "../bot/outgoing";
import { clip, sortUrgentFirst, taskList, text, URGENT_MARK } from "../bot/ui";
import type { Store, TaskFilter } from "../data/store";
import { daysFromToday, formatDue, isOverdue, istDay } from "../domain/dates";
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

export interface AnswerOpts {
  /** List only: how many tasks to skip ("aur dikhao"). */
  offset?: number;
  /** Round 7: "1) title · due" lines in the text, in the same order as the picker rows (memory on). */
  numbered?: boolean;
}

export interface AnswerDetailed {
  outs: Outgoing[];
  /** Task IDs of the picker rows, in the order of the numbered lines. */
  shown: string[];
  offset: number;
  total: number;
  /** True when nothing was read (staff asked for someone else, unknown name): nothing to remember. */
  refused?: boolean;
}

const HEADER_MAX = 1024;
const TITLE_CLIP = 60;

function numberedLines(shown: Task[], now: Date, showAssignee: boolean): string {
  return shown
    .map((t, i) => {
      const parts = [`${i + 1}) ${t.urgent ? URGENT_MARK : ""}${clip(t.title, TITLE_CLIP)}`, formatDue(t.dueAt, t.dueHasTime, now)];
      if (showAssignee) parts.push(t.assigneeName);
      return parts.join(" · ");
    })
    .join("\n");
}

export async function answerQuery(store: Store, user: User, request: Query, now: Date): Promise<Outgoing[]> {
  return (await answerQueryDetailed(store, user, request, now)).outs;
}

export async function answerQueryDetailed(store: Store, user: User, request: Query, now: Date, opts: AnswerOpts = {}): Promise<AnswerDetailed> {
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const filter = request.filter;
  const loaded = await load(store, user, filter);
  if (typeof loaded === "string") return { outs: [text(user.phone, loaded)], shown: [], offset: 0, total: 0, refused: true };

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
    return { outs: [text(user.phone, body + tail)], shown: [], offset: 0, total: pending };
  }

  const picked = sortUrgentFirst(tasks.filter((t) => inBucket(t, filter.when, now)));
  if (picked.length === 0) {
    const what = filter.when === "all" ? "pending" : BUCKET_LABEL[filter.when];
    return { outs: [text(user.phone, `${subject} ${urgentWord}${what} koi task nahi 🎉`)], shown: [], offset: 0, total: 0 };
  }
  const shown = picked.slice(offset, offset + MAX_ROWS);
  if (shown.length === 0) {
    // Asked for a page past the end ("aur dikhao" with nothing left): no picker.
    const done = `Saare *${picked.length}* tasks dikha diye ✅`;
    return { outs: [text(user.phone, done)], shown: [], offset, total: picked.length };
  }
  const label = `${subject} ${urgentWord}${BUCKET_LABEL[filter.when]} *${picked.length}* tasks hain.`;
  let header: string;
  if (opts.numbered) {
    const progress = picked.length > shown.length ? ` ${offset + 1}–${offset + shown.length} / ${picked.length} dikhaye.` : "";
    header = clip(`${label}${progress}\n\n${numberedLines(shown, now, loaded.showAssignee)}`, HEADER_MAX);
  } else {
    const more = picked.length > shown.length ? ` Pehle ${shown.length} dikha raha hoon.` : "";
    header = `${label}${more}`;
  }
  return {
    outs: [
      text(user.phone, header),
      taskList(user.phone, FLOW, shown, "Detail ke liye task chuniye 👇", { now, showAssignee: loaded.showAssignee }),
    ],
    shown: shown.map((t) => t.id),
    offset,
    total: picked.length,
  };
}
