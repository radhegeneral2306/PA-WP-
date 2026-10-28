# PA-WP Batch 4: Voice note se task — Build Brief
*Prepared: 27 Oct 2026 · Owner: Bhaskar (super admin, Radhe Tiles World)*

## 1. Goal
An admin sends a WhatsApp voice note to the existing task bot (Interakt → Cloudflare Worker `pa-wp-bot` → Firestore). The bot transcribes it, extracts a task (person, title, date, time, repeat), shows what it understood, and creates the task only after the admin confirms. Old ways (chat wizard, form, dashboard) stay unchanged and remain the fallback.

## 2. Owner decisions
| # | Decision |
|---|----------|
| 1 | Who can use voice: **admins only** (Bhaskar, Nayan). Staff do not use voice in v1. |
| 2 | Trigger: **always-on**. Any voice note an admin sends to the bot is treated as a task attempt (no menu option needed). |
| 3 | Staff assigning to others by voice: **No** (staff have no voice access in v1). |
| 4 | Roll-out: testers first. **Tester right now: only Bhaskar.** Nayan can be added later. Staff never in v1. |
| 5 | **Always ask for confirmation** before creating ("Haan / Badlo / Cancel"). |
| 6 | If something is missing, the bot **asks only for the missing part** (buttons or text), not a new voice note. |
| 7 | If a name is unclear or matches two people: **show a short list to choose from**. Do not default to the sender. |
| 8 | Defaults: **no date = ask, never guess**. No time = 10:00 AM IST (as today). No repeat = Ek baar. |
| 9 | Bot **shows the transcript** ("Maine suna: …") together with the understood task. |
| 10 | **One voice note = one task** in v1. |
| 11 | Max voice note length: **60 seconds**. Longer ones get a polite refusal. |
| 12 | Languages: **Hindi, Hinglish, English**. Chhattisgarhi words may be misheard (known risk). |
| 13 | Customer names and amounts in the title matter, so confirmation must show both transcript and title, with a "Badlo" option. |
| 14 | Acceptable error rate: **up to 2 corrections in 10 notes**. More than that and the feature is not worth using. |
| 15 | Budget: **free tiers only** (Groq + Gemini). **If the free limit is exhausted, voice stops and the form/wizard keep working.** No paid fallback. |
| 16 | Volume: not stated by owner (2 admins, expected low). Build chat to confirm free-tier limits fit. |
| 17 | Privacy: owner is **comfortable** sending audio/text to Groq and Gemini ("not so sensitive data"). |
| 18 | Audio is **deleted right after processing**. Transcript is **kept in the task remarks**. |
| 19 | Accounts and API keys: **owner already created both Groq and Gemini keys.** Keys go only into Cloudflare secrets, never in chat or code. |
| 20 | v1 scope: **only creating tasks** by voice. Other voice actions later. |
| 21 | Voice note sent in the middle of another flow (e.g. adding a remark) does **not** create a task. Bot tells the admin to finish or cancel the current action first. |
| 22 | Dashboard: show a small **mic icon** on voice-created tasks; transcript readable in remarks. **No audio playback** (audio is deleted). |
| 23 | Tester: Bhaskar. Test sentences in Section 6. |
| 24 | "Done" = at least **6 of the 8 test sentences** produce a correct task, and no more than **2 "Badlo" in 10** real notes. |

## 3. User flow
1. Admin sends a voice note (≤ 60 sec).
2. Bot checks: sender is an active admin, not inside another flow, length OK. Audio is downloaded, transcribed (Groq), then understood (Gemini) using the real staff list and today's date. Audio is deleted.
3. Bot shows the transcript and the understood task, with buttons **Haan / Badlo / Cancel**.
4. If something is missing or unclear, the bot asks only for that part (date, or name from a list), then shows the confirmation again.
5. On **Haan**: server re-checks all normal rules (past date refused, assignee active, etc.), creates the task, sends `task_assigned_v1` to the assignee (not for self tasks), stores the transcript in remarks and marks the task as voice-created.
6. On **Badlo**: bot asks what to change. On **Cancel**: nothing is created.

**Bot messages: DRAFTS, the owner has not yet approved the exact wording.** Build chat should show these to Bhaskar and fix the wording before shipping:
- Confirmation: "Maine suna: \"<transcript>\"\n\nTask: <title>\nKisko: <name>\nKab: <date, time>\nRepeat: <Ek baar / Har 90 min / Har mahine>\n\nYe task banau?"
- Date missing: "Date nahi suni. Ye task kab tak ka hai?"
- Two matching names: "Is naam ke do log hain. Kisko dena hai?"
- Name not found: "Ye naam staff list mein nahi mila. Kisko dena hai?"
- Too long: "Voice note bahut lamba hai. 1 minute ke andar bhejiye."
- Inside another flow: "Pehle chal raha kaam pura ya cancel kijiye, phir voice note bhejiye."
- Not understood: "Samajh nahi aaya. Dobara bhejiye ya form se task banaiye."
- Voice limit over: "Voice se task abhi band hai. Form ya 'Naya task' use kijiye."

## 4. Provider choice, limits, privacy
- **Transcription:** Groq (Whisper-based, free tier).
- **Understanding / extraction:** Gemini (free tier).
- **Budget:** zero. When either free limit is hit, voice is switched off automatically; other task creation continues.
- **Privacy:** audio and text go to Groq and Gemini; owner accepted this. Audio deleted right after processing; transcript saved in task remarks.
- **Keys:** stored as Cloudflare secrets only.

## 5. Defaults and confirmation rules
- Always confirm before creating.
- Date missing: ask. Time missing: 10:00 AM IST. Repeat missing: Ek baar.
- Spoken repeat is understood ("har 90 minute" = Har 90 min). Allowed repeats stay: Ek baar / Har 90 min (10 AM–8 PM) / Har mahine.
- Relative words ("kal", "parso") resolved from today's date in IST; shown in the confirmation so mis-hearing is visible.
- Unclear or duplicate name: choose from a list.
- Phrases like "fir mujhe update dena" stay in the title; the bot does not act on them.
- A dependency like "Durg ka task complete hone ke baad…" is not supported (no task linking today): bot asks for a date.

## 6. Roll-out and test sentences
Roll-out: Bhaskar alone first; add Nayan later; staff not in v1.

Owner's real examples (spoken Hindi/Hinglish; names as in the staff list):
1. "Pinky ko bolo kal shaam paanch baje Sharma ji ka payment ka follow up lena hai"
2. "Chiku ko bolo kal barah baje PC ko format kar dega"
3. "Harsh ko bolo ki kal stock counting karwa lega aur update dega"
4. "Bharti ko bolo kal creditor list clear kar degi"
5. "Isha ko bolo Durg ka task complete hone ke baad Jagdalpur ka karegi" *(no date, needs a follow-up question)*
6. "Reshmi ko bolo kal PagarBook ki saari entries update kar degi"
7. "Gopeshwari ko bolo kal Rajim ki entry kar legi aur fir mujhe update degi"
8. "Bharti ko bolo kal wallmark ka hisab mila legi aur fir mujhe update degi, har ninety minutes mein ise remind karna" *(repeat = Har 90 min)*

(Note: in the owner's first sample, "Chiku" and "Pinky" etc. are used as spoken; actual staff names/spellings come from the staff list.)

Pass mark: at least 6 of these 8 correct, and ≤ 2 "Badlo" in 10 real notes.

## 7. Out of scope for version 1
- Staff using voice; voice for assigning to others by staff
- Several tasks in one voice note
- Other voice actions ("task done", voice remarks)
- Task dependencies ("A ke baad B")
- Audio playback on dashboard / keeping audio
- Paid providers or paid fallback

## 8. Open points for the build chat to verify
- Interakt audio `media_url`: does it need authentication, and how long is it valid? Test with a real sample.
- Current Groq and Gemini free-tier limits and rate limits; confirm they cover expected volume (2 admins, low).
- Whether free-tier data may be used for provider training or logs, and tell the owner plainly.
- Groq accuracy on Hindi/Hinglish names and amounts with real shop audio; test with the 8 sentences above.
- How the bot detects "free limit exhausted" and switches voice off cleanly.
- Whether to alert Bhaskar when voice switches off (suggested, **not yet confirmed by owner**).
- Meta template classification: do any new messages need templates, or are all replies inside the 24-hour window?
- Final Hinglish message wording: get Bhaskar's approval on the drafts in Section 3.
