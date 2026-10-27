# Task for Claude: create the Admin task form WITHOUT the Branch field (Interakt)

*Prepared 27 Oct 2026 for the owner of Radhe Tiles World. Hand this whole file to a Claude that can operate the owner's browser (Interakt dashboard). Owner: Bhaskar (non-technical); talk to him in Hinglish (Roman script), simple steps.*

## 0. Rules (read first)

1. **Create new things only. Never edit, unpublish, delete or rename** any existing form or template. In particular leave these alone:
   - Form `Naya Task Admin v2` (ID 2636999320105587) and its template `task_form_admin_v1` (live, in use)
   - Form `Naya Task Staff` (ID 1676969103936562) and template `task_form_staff_v1` (live, in use)
   - Old form `Naya Task Admin` (ID 939478788999708, unused)
   - All other templates (`task_assigned_v1`, `task_reminder_v1`, ... are used by the live bot)
2. **Copy every label and option exactly** as written below: spelling, capital letters, spaces, brackets. The bot matches them word for word.
3. **Interakt limits** (learned on 27 Oct): field label max **20** characters, dropdown/radio option max **30** characters. Everything below already fits; do not shorten anything else.
4. **Careful: in this Interakt form builder "Save as Draft" has published the form before.** Fill everything and check it fully **before** pressing any save button. After saving, press **Sync Data** and check the status.
5. Ask the owner before the final **Submit** of the template (it goes to Meta).
6. Do not type or reveal any phone number, API key or password anywhere.

## 1. Goal

Today's Admin form asks **Branch** and then **Kisko dena hai** (person). Every person option already carries the branch in brackets (for example `Pinky (Durg)`), and the bot takes the real branch from its own records, so the Branch question is redundant and only causes mismatch errors. Build a new Admin form with the same fields **minus Branch**, plus a new template that opens it. The bot already accepts submissions without a Branch answer.

## 2. Create the form

Interakt dashboard → **Automations → WhatsApp Forms → Create new form** (form without data exchange).

- **Form name:** `Naya Task Admin v3`
- **Category:** Lead Generation (same as the existing forms)
- **Screen title:** `Naya task`
- **Fields, exactly in this order** (if the builder lets you set a field name/key, use the key in the second column; if not, just use the label):

| # | Label | Key | Type | Required | Options |
|---|---|---|---|---|---|
| 1 | `Kisko dena hai` | `person` | Dropdown | Yes | Person list (section 3) |
| 2 | `Task kya hai` | `title` | Text input (short or long answer) | Yes | max length 200 if asked |
| 3 | `Due date` | `date` | Date picker | Yes | (no "past dates" setting exists; that's fine, the bot rejects past dates) |
| 4 | `Time` | `time` | Dropdown | **No** (optional) | Time list (section 4) |
| 5 | `Reminder` | `repeat` | Single choice (radio) | Yes | `Ek baar`, `Har 90 min`, `Har mahine` |

- **No Branch field.**
- **Submit / footer button text:** `Task banao`

## 3. Person list (27 options, this order)

```
Bhaskar (Admin)
Nayan (Admin)
Chikku (Raipur)
Harsh (Raipur)
Alish (Jagdalpur)
Angle (Jagdalpur)
Barkha (Jagdalpur)
Dhani (Jagdalpur)
Jagen (Jagdalpur)
Pooja (Jagdalpur)
Shruti (Jagdalpur)
Sonu (Jagdalpur)
Durg Office - 66866 (Durg)
Hema (Durg)
Khomeshwari (Durg)
Pinky (Durg)
Prachi (Durg)
Rinky (Durg)
Sudha (Durg)
Vani (Durg)
Ofc Hardware - 66466 (Hdw)
Roshni (Hardware)
Yash (Hardware)
Bharti (Office)
Gopeshwari (Office)
Isha (Office)
Reshmi (Office)
```

Note `Ofc Hardware - 66466 (Hdw)`: `(Hdw)` is intentional (30-character limit); the bot reads it as Hardware.

**Before publishing, ask the owner:** "Kya staff list mein koi naya aaya ya koi hata hai?" If yes, stop and get the updated list from the build chat first (a published form can't be edited).

## 4. Time list (23 options, this order)

```
10:00 AM (default)
9:00 AM
9:30 AM
10:30 AM
11:00 AM
11:30 AM
12:00 PM
12:30 PM
1:00 PM
1:30 PM
2:00 PM
2:30 PM
3:00 PM
3:30 PM
4:00 PM
4:30 PM
5:00 PM
5:30 PM
6:00 PM
6:30 PM
7:00 PM
7:30 PM
8:00 PM
```

## 5. Check, then publish

Go through the preview and tick each:
- [ ] Exactly 5 fields, in the order above; **no Branch**
- [ ] 27 person options, spelled exactly; first `Bhaskar (Admin)`, last `Reshmi (Office)`
- [ ] 23 time options; Time is optional
- [ ] Reminder has exactly `Ek baar`, `Har 90 min`, `Har mahine`
- [ ] Button says `Task banao`

Then publish, press **Sync Data**, and note the new **Form ID** (this is also the Flow ID).

## 6. Create the template

Interakt → **Templates → Create new template**:

- **Name:** `task_form_admin_v2`
- **Category:** Utility
- **Language:** English
- **Body (no variables):** `Naya task banane ke liye neeche button dabaiye aur form bhariye. Sab ek hi screen pe.`
- **Button:** type **WhatsApp Flow / Form**, button text `Form kholo`, form = **Naya Task Admin v3** (open on its first screen; no data exchange)

Show the owner the filled template, get his OK, then **Submit for approval**.

## 7. Report back (give this to the owner to paste into the build chat)

```
Admin form v3 done
Form name: Naya Task Admin v3
Form ID: <new id>
Template: task_form_admin_v2, status: <Pending/Approved/Rejected + reason>
Any difference from FORMS-ADMIN-V2.md: <none / what changed>
```

## 8. What happens next (build chat, not you)

When `task_form_admin_v2` is **Approved**, the build chat switches the bot from `task_form_admin_v1` to `task_form_admin_v2` (code: `worker/src/bot/outgoing.ts` `TEMPLATE_PARAMS`/`FLOW_TEMPLATES`, `worker/src/bot/flows/createTaskForm.ts` start()). Until then the bot keeps sending the current v1 form, so nothing breaks while waiting.
