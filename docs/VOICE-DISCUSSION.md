# Batch 4: Voice note se task — discussion guide (for a planning chat)

*Prepared 27 Oct 2026 by the build chat. Owner: Bhaskar (Radhe Tiles World), non-technical, super admin and the person who builds/maintains the bot.*

---

## 0. Instructions for the planning chat (READ FIRST)

You are helping the owner **decide** how Batch 4 should work. **Do not write code.** Your output is a decision document the owner will hand back to the build chat.

1. **Talk in Hinglish** (Hindi grammar, Roman script, no Devanagari). Be blunt and honest; say clearly when an idea is weak, costly or risky. State difficulty (Easy / Medium / Hard / Very Hard) for options. The owner is non-technical: explain with simple examples.
2. **Ask the questions in Section 5 one group at a time** (not all at once). For every question give 2-3 options, the trade-offs, and **your recommendation first**. Skip a question only if an earlier answer already settled it.
3. Don't invent facts about the live system beyond Section 1-3; if something is unknown, say "build chat will verify".
4. Prices of speech/AI services change: give **rough ranges, clearly marked as approximate**, and say the build chat will check current pricing.
5. Never ask for or write secrets (API keys, passwords, webhook secret) or real phone numbers.
6. When all groups are answered, produce **`VOICE-BRIEF.md`** in the format of Section 7, and tell the owner to give it to the build chat.

---

## 1. What exists today (live system, short)

- **WhatsApp task bot** for Radhe Tiles World on **Interakt** (WhatsApp Business API, Advance plan) → **Cloudflare Worker** (`pa-wp-bot`) → **Firebase Firestore**. Plus an admin **dashboard** web app.
- **27 active users:** 2 admins (Bhaskar = super admin, Nayan) and 25 staff in branches Raipur, Jagdalpur, Durg, Hardware, Office.
- **Ways to create a task today:**
  1. WhatsApp chat wizard "➕ Naya task" (6-7 taps: person → title → date → time → repeat → confirm).
  2. WhatsApp Form "📝 Naya task (Form)" (one screen; live since 27 Oct).
  3. Dashboard "Naya task" (admins).
- **Task fields:** title (≤ 200 chars), assignee (admin can pick anyone; staff only themselves), due date, optional time (no time = 10:00 AM IST), repeat = Ek baar / Har 90 min (10 AM–8 PM) / Har mahine.
- **Rules that apply to every new task:** past date/time refused; assignee must be active; staff can't move dates beyond 25 days without admin approval (creation itself has no limit); the assignee gets the WhatsApp template `task_assigned_v1` (not for self tasks); reminders start at the due time.
- **Language:** all bot messages are Hinglish. Staff speak Hindi / Hinglish / Chhattisgarhi-tinged Hindi; names are Indian names.
- **Security today:** only registered active numbers get answers; signed webhooks; one shared set of rules for WhatsApp and dashboard.
- **Costs today:** Interakt per-message charges (Utility templates cheaper; the two form templates and the welcome template were classified Marketing by Meta). Cloudflare and Firebase are within cheap/free tiers.

## 2. What Batch 4 is (the idea)

A user records a **WhatsApp voice note**, for example:
> "Pinky ko bolo kal shaam 5 baje tak Sharma ji ka payment follow up kar le, har 90 minute yaad dilana"

and the bot turns it into a task (assignee Pinky, title "Sharma ji ka payment follow up", due tomorrow 5:00 PM, repeat Har 90 min), shows what it understood, and creates it after confirmation (or asks for what's missing).

## 3. Technical facts the planning chat should know (for honest answers)

- Interakt's incoming-message webhook gives the bot a **media URL** for audio messages; the bot already parses `media_url` but ignores voice notes today. Whether that URL needs authentication and how long it stays valid: **build chat will verify** with a real sample.
- Turning voice into a task needs **two steps**:
  1. **Speech-to-text (transcription).** Options to compare: OpenAI (Whisper / GPT-4o transcribe), Google Speech-to-Text, Sarvam AI (Indian-language specialist, Hindi/Hinglish), Deepgram, others. Accuracy on Hinglish, Indian names and noisy shop audio differs a lot; **no service is 100% accurate**.
  2. **Understanding (extraction).** An AI language model (for example Claude) reads the text and fills title / person / date / time / repeat, using the real staff list and today's date.
- Both steps cost money per voice note (each is small; roughly a few paise to a couple of rupees per note depending on service and length — **approximate, to be checked**). Needs an account + API key with the chosen provider(s), stored as a Cloudflare secret.
- Cloudflare Workers can call these services; long audio = slower reply. A reply in ~5-15 seconds is realistic; WhatsApp users may see a short delay.
- Voice notes may contain customer names/amounts: sending audio to an outside AI service is a **privacy decision** for the owner.
- Mis-hearing is the main risk: wrong person, wrong date ("parso" vs "barso"), wrong amount in the title. Hence the usual safety pattern: **always show what was understood and ask "Sahi hai?" before creating**.

## 4. Things already decided elsewhere (don't re-ask)
- Old ways to create tasks stay unchanged (chat wizard, form, dashboard).
- Same task rules as today (Section 1); the bot re-checks everything on the server.
- Hinglish everywhere; no secrets in chat or code.

## 5. Questions to ask the owner (group by group)

### Group A — Who and when
1. Who may create tasks by voice: admins only, staff only for themselves, or everyone (with the same rules as today)?
2. Should **every** voice note to the bot become a task attempt, or only after choosing a menu option like "🎤 Voice se task" (then "ab voice note bhejiye")? (Trade-off: always-on is easiest for staff but every random voice note costs money and may create junk tasks.)
3. Can a staff member assign a task to **someone else** by voice? (Today staff can only create tasks for themselves.)
4. Roll-out: start with testers only (like the form), then everyone?

### Group B — Understanding and confirmation
5. After understanding, should the bot **always ask for confirmation** ("Ye task banau? Haan / Badlo / Cancel") or create directly when it's confident? (Recommendation to discuss: always confirm.)
6. If something is missing (no date, no person), should the bot ask for just that part (by buttons/text), or ask to send a new voice note?
7. If the person's name is unclear or matches two people (two "Pooja"s), how to resolve: show a short list to choose from? Default to the sender?
8. Default rules when not spoken: no date → today? tomorrow? ask? No time → 10:00 AM (as today)? No repeat → Ek baar?
9. Should the bot also send back the **transcript** ("Maine suna: …") so the user can see what it heard?
10. Several tasks in one voice note ("Pinky ko payment, aur Hema ko stock check") — support it in version 1, or one task per voice note?
11. Max voice note length to accept (for example 60 seconds)? What to reply for longer ones?

### Group C — Language and accuracy
12. Which languages/accents must work: Hindi, Hinglish, English, Chhattisgarhi words? Any staff who speak mostly another language?
13. How important are exact customer names/amounts in the title (affects which service to choose)?
14. Is it acceptable that maybe 1 in 10 notes needs a correction? What error rate would make the owner stop using it?

### Group D — Cost, provider, privacy
15. Monthly budget ceiling for voice processing (for example ₹500 / ₹2,000 / ₹5,000)? Should the bot stop or warn when a limit is reached?
16. Expected volume: how many voice notes per day across all users?
17. Privacy: is it OK that audio/text goes to an outside AI company (OpenAI / Google / Sarvam / Anthropic)? Any provider the owner prefers or wants to avoid?
18. Should audio be **kept** (for checking mistakes later) or deleted right after processing? Keep the transcript in the task remarks?
19. Who creates the provider account and pays (owner's card)? The build chat will give step-by-step setup.

### Group E — Beyond creating tasks (scope check)
20. Voice for **other actions** later (e.g. "payment wala task done", voice remark on a task)? In version 1 or later?
21. Should a voice note sent while inside another flow (e.g. while adding a remark) be treated as a remark instead?
22. Anything about the dashboard: show that a task came from voice? Play/read the transcript there?

### Group F — Testing and done
23. Who will test (names), and with which example sentences (ask the owner for 5-10 real examples of how staff actually talk)?
24. What counts as "done" for the owner?

## 6. Honest notes the planning chat must tell the owner
- **Difficulty: Hard overall** (2-3 build sessions). Most effort is in handling mistakes gracefully, not in calling the AI.
- **Extra running cost** per voice note and a new outside account/API key.
- **Accuracy is never perfect** on Hinglish names/dates in a noisy shop; confirmation step is the safety net.
- The form and chat wizard remain the reliable fallback.

## 7. Output: `VOICE-BRIEF.md` format (produce this at the end)

```
# PA-WP Batch 4: Voice note se task — Build Brief
*Prepared: <date> · Owner: Bhaskar*

## 1. Goal (2-3 lines)
## 2. Owner decisions
| # | Decision |   (one row per answered question, numbered, in the owner's words where possible)
## 3. User flow (step by step, with the exact Hinglish bot messages the owner approved, including error/unclear cases)
## 4. Provider choice (transcription + understanding), budget limit, privacy rules (keep/delete audio, transcript in remarks?)
## 5. Defaults (date/time/repeat/person when not spoken) and confirmation rules
## 6. Roll-out (testers first? names) and test sentences (the owner's 5-10 real examples)
## 7. Out of scope for version 1
## 8. Open points for the build chat to verify (e.g. Interakt media URL access, current prices)
```

Keep it short, concrete, and in English with Hinglish message texts quoted exactly.
