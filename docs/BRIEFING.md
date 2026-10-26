# PA-WP: Project Briefing

*Last updated: 26 Oct 2026 (Batch 2 built)*

---

## 1. Hum kya bana rahe hain

Ek **WhatsApp task management bot**, Radhe ke staff ke liye.

- **Branches:** Raipur, Jagdalpur, Durg (3)
- **Users:** admins (Bhaskar + partners) aur ~15-20 staff
- **Kaise chalega:** staff aur admin business WhatsApp number pe "Hi" bhejenge, bot menu dega, aur tasks banenge / dikhenge / update honge. Reminder bhi WhatsApp pe hi aayenge.

### Main features
| Feature | Detail |
|---|---|
| Role-based menu | "Hi" bhejne pe admin aur staff ko alag menu |
| Admin | Apne tasks dekho, staff ke tasks dekho (branch, phir staff), task banao |
| Staff | Apne tasks dekho, Done / Update / date aage karo (remark ke saath) |
| Reminders | Ek baar ka · har 90 min repeat (sirf 10 AM - 8 PM) · monthly (31 tareekh ho toh mahine ki last date) |
| 25-day rule | Staff 25 din se aage date kare toh admin ko Approve / Reject jayega |
| Notifications | Task assign hone pe staff ko message · Done hone pe sirf assign karne wale admin ko |
| Staff manage | Admin WhatsApp se hi staff add / remove kar sakega |
| Baad mein | WhatsApp Forms, voice notes (Groq + Gemini), dashboard (PWA) |

---

## 2. Decisions jo final ho chuke hain

| Topic | Decision |
|---|---|
| WhatsApp API | Interakt **Advance** plan (incoming webhook ON hai, tested ✅) |
| Backend | **Cloudflare Workers** (Apps Script ki jagah: 302 redirect issue, timer limits) |
| Database | **Firebase Firestore**, naya project, Mumbai (asia-south1) |
| Purana To-do-list app | **Alag rahega**, koi sync nahi |
| Permissions | Staff khud ka task bana sakta hai · admin dusre admin ko task de sakta hai |
| Bot ki language | **Hinglish** |
| Staff list | User-defined: admin baad mein add/remove karega |
| Testing | 3 real numbers: 1 admin (Bhaskar) + 2 staff (Hardware, Chikku). Numbers Cloudflare secrets mein hain, code mein nahi |
| Tasker / location idea | **Is project se alag**, abhi scope mein nahi |

---

## 3. Ab tak kya hua ✅

1. Requirement document padha aur review kiya
2. Interakt ka real webhook data dekha. Isse pata chala message kaisa aata hai (phone, text, message id, organization id)
3. Research kiya: Interakt API se **List** aur **Button** messages session mein bheje ja sakte hain (ek real project yahi use kar raha hai)
4. **Batch 0 ka code ban gaya** aur GitHub branch `claude/nifty-franklin-xolea7` pe push ho gaya hai:
   - Cloudflare Worker jo Interakt webhook receive karta hai
   - Security: secret URL + organization check + **Interakt-Signature** verification
   - Har message Firebase mein log hota hai, duplicate message pe double reply nahi hota
   - Sirf test numbers ko reply jaata hai, customers ko nahi
   - "Hi" bhejne pe test branch list + Approve/Reject buttons aate hain
   - Purani Google Sheet mein logging chalu rakh sakte hain (optional)
   - Har step ka log + `/webhook/<secret>/status` page (settings, test numbers, Firebase check)
   - 31 automatic tests pass
5. Setup guide likhi gayi: `docs/SETUP-batch0.md`
6. **Batch 0 live test PASS ✅ (26 Oct 2026):** Firebase, Cloudflare, Interakt webhook set hue. "Hi" pe list + buttons aaye, aur dono ke click ka reply sahi aaya.
   - Setup mein atke: `WEBHOOK_SECRET` mein galat value thi (404 aa raha tha). Ab code dashboard values ke extra space khud hata deta hai, aur `keep_vars` se deploy pe variables delete nahi hote.

---

## 3b. Batch 1 (26 Oct 2026)

- 5 agents ne parallel kaam kiya (dates, Firebase store, templates, create/manage flows, task view/actions), contract: `docs/BATCH1-CONTRACT.md`
- Live: role-based menu, naya task (Aaj/Kal/Date likho + optional time, default 10 AM), mere tasks / staff ke tasks (paging), Done / Update / Date badlo (remark zaroori, staff ke liye 25-day limit), staff add/remove/list
- Sirf registered users ko reply; `TEST_NUMBERS` set hai toh sirf unhi ko message jaata hai
- 10 test users (3 real + 7 dummy) Firebase mein
- Templates ke drafts: `docs/TEMPLATES.md` · Test checklist: `docs/TESTING-batch1.md`
- 257 automatic tests

## 3c. Batch 2 (26 Oct 2026)

- 3 agents: E1 scheduler, E2 reminder type + staff edit, E3 task actions + approvals
- Cloudflare cron: har 5 min due reminders (`task_reminder_v1`, last remark ke saath); roz 10 AM IST daily summary (`DAILY_SUMMARY=off` se band)
- Reminder types: Ek baar / Har 90 min (10 AM–8 PM, remark dene pe agli subah tak ruk jaata hai) / Har mahine (Done pe agle mahine ka task, 31 → mahine ki last date)
- Overdue (Ek baar / Har mahine): Done hone tak roz 11 AM reminder
- Staff ka naam/branch edit karne pe purane tasks bhi update; koi bhi date change hone pe pending date-request apne aap hat jaati hai
- Staff 25 din se aage date maange → admin ko approval request → Approvals menu se Approve/Reject → staff ko result
- Staff update / date badle → creator ko `task_updated_v1`
- Staff edit (naam / branch / role)
- 333 automatic tests

## 4. Abhi ke pending chhote kaam

- [ ] Cloudflare se `TEST_NUMBERS` hatana (warna naye add kiye staff ko message nahi jayega)
- [ ] Batch 2 ka real WhatsApp pe test

- [x] Saare 8 templates Interakt mein approve ho gaye
- [ ] `docs/TESTING-batch1.md` ki checklist chalana

- [ ] `INTERAKT_WEBHOOK_KEY` Cloudflare mein daalna (Interakt ka webhook Secret key). Optional hai, par live jaane se pehle zaroori
- [ ] Hardware ka number (8359966**4**66) confirm karna. Business number (8359966**0**66) se bahut milta-julta hai

---

## 5. Aage ka plan (batches)

| Batch | Kya banega | Difficulty | Parallel agents? |
|---|---|---|---|
| **0** | Interakt test (list/button + reply format) | Easy-Medium | ✅ **Done, test pass** |
| **1** | Foundation: database design, staff/admin list, "Hi" menu, task banao/dekho/Done, assign + done notification, staff manage | Medium-Hard | ✅ **Built (5 agents), live testing** |
| **2** | Reminders (one-time, 90-min, monthly), remark, 25-day Approve/Reject | Hard | ✅ **Built (3 agents)** |
| **3** | WhatsApp Forms (static) | Medium | Haan |
| **4** | Voice notes (Groq Whisper + Gemini) | Medium-Hard | Haan |
| **5** | Dashboard PWA | Medium | Haan |

**Parallel agents ka rule:** foundation (Batch 1) ek hi jagah banega. Uske baad har agent apni alag files/module pe kaam karega taaki kaam collide na ho.

---

## 6. Dhyan rakhne wali baatein ⚠️

- **24-hour rule:** staff ne 24 ghante mein bot ko message nahi kiya, toh reminder sirf **approved template** se jayega, aur wo paid hai. 90-min repeat se cost badh sakti hai. Templates Meta approval ke liye pehle submit karne honge (1-2 din lagte hain).
- **Purani automations:** Interakt ki "welcome / Greeting Flow / FAQ Auto-replies" bhi "Hi" ka reply karti hain. Live jaane se pehle inhe handle karna hoga, warna double reply aayega.
- **Secrets:** API key, Firebase key, webhook key kabhi chat ya GitHub mein nahi. Sirf Cloudflare Secrets mein.
- **Business number customers ke liye bhi hai:** bot sirf registered staff/admin numbers ko jawab dega.

---

## 7. Abhi bhi decide karna hai

- 10 extra feature ideas (priority flags, stuck-task detection, daily summary, leaderboard, etc.)
- Dashboard ka design
- Meta templates ka exact wording (assignment, reminder, done)
