# Batch 3: Interakt form setup (owner steps)

*27 Oct 2026. Owner decision: the Admin form has a fixed Branch + Person list (Decision 4 in `FORMS-BRIEF.md`). Interakt forms cannot be edited after publishing, so every staff change needs a new form + new template version (`_v2`, `_v3`...). The build chat prepares the updated list each time.*

Copy names and options **exactly** (spelling, capital letters, spaces). The bot matches them word for word.

---

## What was actually built (27 Oct 2026)

| Form | Form ID (= Flow ID) | Template | Status |
|---|---|---|---|
| Naya Task Admin v2 | 2636999320105587 | `task_form_admin_v1` | approved (Utility); no longer sent (replaced by v2) |
| Naya Task Staff | 1676969103936562 | `task_form_staff_v1` | approved (Meta made it Marketing) |
| Naya Task Admin v3 (no Branch) | 2211140249828307 | `task_form_admin_v2` | APPROVED (Meta made it Marketing); **in use since 27 Oct** |

Differences from the plan below:
- Interakt limits: field label max 20 characters, option max 30. So the Hardware person option is `Ofc Hardware - 66466 (Hdw)`; the bot reads `(Hdw)` as Hardware.
- The date picker has no "no past dates" setting; the bot rejects past dates itself.
- An older `Naya Task Admin` (ID 939478788999708) was published by mistake with a cut-off name. Not linked to any template; never use it.
- "Save as Draft" published the form. After publishing, press Sync Data to check the status.
- Form category in Interakt: Lead Generation (the templates are Utility).

## Step 1. Admin form (Interakt → Automations → WhatsApp Forms → Create)

- **Form name:** `Naya Task Admin`
- **Screen title:** `Naya task`
- **Fields, in this order** (if the builder asks for a field "name"/"key", use the key in brackets):

| # | Label shown | Key | Type | Required | Options |
|---|---|---|---|---|---|
| 1 | Branch | `branch` | Dropdown | Yes | Admins, Raipur, Jagdalpur, Durg, Hardware, Office |
| 2 | Kisko dena hai | `person` | Dropdown | Yes | see the Person list below |
| 3 | Task kya hai | `title` | Text (short or long answer) | Yes | max 200 characters if the builder asks |
| 4 | Due date | `date` | Date picker | Yes | turn on "no past dates" if available |
| 5 | Time | `time` | Dropdown | No | see the Time list below |
| 6 | Reminder | `repeat` | Single choice (radio) | Yes | Ek baar, Har 90 min, Har mahine |

- **Submit button text:** `Task banao`

### Person list (27 Oct 2026, 27 active people)
Each option is `Name (Branch)`:

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

### Time list
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
(Leaving Time empty also means 10:00 AM.)

Then **Save → Publish**.

## Step 2. Staff form

Same as the Admin form but **without** Branch and Person:

- **Form name:** `Naya Task Staff`
- Fields: Task kya hai (`title`), Due date (`date`), Time (`time`, same Time list), Reminder (`repeat`, same 3 options).
- Submit button `Task banao`. Save → Publish.

## Step 3. Two templates (Interakt → Templates → Create)

| | Admin template | Staff template |
|---|---|---|
| Name | `task_form_admin_v1` | `task_form_staff_v1` |
| Category | Utility | Utility |
| Language | English | English |
| Body | `Naya task banane ke liye neeche button dabaiye aur form bhariye. Sab ek hi screen pe.` | same text |
| Button | type **WhatsApp Flow / Form**, text `Form kholo`, form = **Naya Task Admin** | same, form = **Naya Task Staff** |

Submit both for approval. Form templates can take longer than normal templates.

## Step 4. Webhook

Nothing new to switch on: the bot already receives "incoming customer messages", which include the form answers. **Do not** turn on the separate "Completed Flow" webhook to the bot URL (it would deliver the same answer twice).

## Step 5. Tell the build chat
- Both template names, once **Approved**.
- If any field key could not be set as above, say what the builder showed instead (a screenshot is fine).

## Later: when staff change
Keep every option within 30 characters (use a short branch tag such as `(Hdw)` if needed; tell the build chat any new short tag). Ask the build chat for an updated Person list, build a new Admin form with it, and a new template `task_form_admin_v2` (then `_v3`...). The bot is told the new name; old names are never reused.
