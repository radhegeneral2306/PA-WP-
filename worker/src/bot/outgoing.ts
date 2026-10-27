// What the bot wants to send, as plain data. Flows return these; the delivery
// layer (src/interakt/deliver.ts) turns them into Interakt API calls.

import type { Button, ListRow } from "../interakt/send";

export type Outgoing =
  | { to: string; kind: "text"; body: string }
  | { to: string; kind: "list"; body: string; button: string; sectionTitle: string; rows: ListRow[] }
  | { to: string; kind: "buttons"; body: string; buttons: Button[] }
  | {
      to: string;
      kind: "template";
      template: TemplateName;
      /** One value per {{n}} placeholder, in order (see TEMPLATE_PARAMS). */
      bodyValues: string[];
      /** Sent as a plain session message if the template send fails (e.g. not approved yet). */
      fallbackText: string;
      /** Form (WhatsApp Flow) templates only: comes back with the answers, tells which form it was. */
      flowToken?: string;
    };

/**
 * Template names exactly as registered in Interakt, with the meaning of each
 * {{n}} body placeholder. Wording lives in docs/TEMPLATES.md.
 */
export const TEMPLATE_PARAMS = {
  task_assigned_v1: ["assignee name", "assigned by", "task", "due", "next reminder"],
  task_reminder_v1: ["assignee name", "task", "due", "last remark"],
  task_done_v1: ["admin name", "done by", "task", "done at"],
  task_updated_v1: ["admin name", "updated by", "task", "update"],
  date_approval_request_v1: ["admin name", "staff name", "task", "current due", "requested due"],
  date_approval_result_v1: ["staff name", "task", "result", "due"],
  daily_summary_v1: ["name", "pending count", "overdue count"],
  welcome_user_v1: ["name", "added by", "role"],
  task_cancelled_v1: ["recipient name", "cancelled by", "task", "assigned to"],
  // Batch 3 form templates: no body placeholders, one "Form kholo" button that opens the form.
  task_form_admin_v1: [],
  task_form_admin_v2: [], // Admin form v3 without the Branch field (submitted 27 Oct)
  task_form_staff_v1: [],
} as const;

/** Templates whose button opens a WhatsApp Form; sent with is_flow_template. */
export const FLOW_TEMPLATES: ReadonlySet<TemplateName> = new Set<TemplateName>(["task_form_admin_v1", "task_form_admin_v2", "task_form_staff_v1"]);

export type TemplateName = keyof typeof TEMPLATE_PARAMS;
