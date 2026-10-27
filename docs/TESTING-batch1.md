# Batch 1 Testing Checklist

**Test users (already saved):**
- **Bhaskar:** admin (real)
- **Hardware:** staff, Durg (real)
- **Chikku:** staff, Raipur (real)
- Baaki 7 users dummy hain (naam mein "(dummy)" likha hai). Unko koi message nahi jaata.

> Jab tak Cloudflare mein `TEST_NUMBERS` set hai, bot sirf in 3 real numbers ko message bhejega.

> **Templates approve hone tak:** naya task milne ka message staff ko tabhi pahunchega jab staff ne pichhle 24 ghante mein bot ko kuch bheja ho. Isliye test se pehle **Hardware aur Chikku dono ek baar "Hi" bhej dein.**

---

## A. Admin (Bhaskar ke phone se)

- [ ] **Hi** → 4 options aaye: Mere tasks, Staff ke tasks, Naya task, Staff manage
- [ ] **Naya task** → Durg → Hardware → task likho → **Kal** → **Skip** → summary → **Haan**
  - Bhaskar ko "✅ Task ban gaya" aaya
  - Hardware ko "naya task mila" message aaya
- [ ] **Naya task** → Raipur → Chikku → task → **Date likho** → `28/10 4pm` → Haan
- [ ] **Naya task** → 👔 Admins → Bhaskar (khud) → task → Aaj → `6pm` → Haan
- [ ] Galat date likho (jaise `abc`) → bot dobara poochta hai
- [ ] Beeti hui date likho (jaise `1/10`) → bot mana karta hai
- [ ] **Staff ke tasks** → Durg → Hardware → task dikha
- [ ] **Staff ke tasks** → Durg → "Sabhi ke pending tasks"
- [ ] **Staff manage** → Sabka list → saare users branch-wise dikhe
- [ ] **Staff manage** → Staff add karo → naam `Test Dummy` → number `0000000999` → Staff → Jagdalpur → Haan
- [ ] **Staff manage** → Staff hatao → Jagdalpur → Test Dummy → Haan

## B. Staff (Hardware ya Chikku ke phone se)

- [ ] **Hi** → sirf 2 options: Mere tasks, Naya task
- [ ] **Mere tasks** → admin ka diya task dikha → task pe tap
- [ ] **Update ✏️** → remark likho → "Remark save ho gaya"
- [ ] **Date badlo 📅** → Kal → Skip → remark likho → "Date badal di"
- [ ] **Date badlo 📅** → Date likho → 30 din baad ki date (jaise `30/11`) → ⚠️ 25 din wala warning aaya, date nahi badli
- [ ] **Done ✅** → "Shabash" aaya, aur **Bhaskar** ko "task complete" message aaya
- [ ] **Naya task** → seedha task poochha (branch/staff nahi) → khud ka task bana

## C. Baaki checks

- [ ] Beech flow mein `cancel` likho → cancel ho gaya
- [ ] Kisi purani list pe tap karo → "Ye option purana hai" + menu
- [ ] 30 min ruk ke kuch likho → menu dobara aata hai
- [ ] Kisi **unregistered** number se Hi → koi reply nahi aaya

---

**Kuch galat lage toh:** screenshot + kya kiya tha, bas itna bhej do. Cloudflare logs se main baaki dekh lunga.

---

# Batch 2 Testing

> Pehle Cloudflare se `TEST_NUMBERS` hata do, taaki naye staff ko bhi message jaaye.

## D. Reminders
- [ ] Naya task banao → time **5-10 min baad** ka do → **Ek baar** → time aane pe staff ko ⏰ reminder template aaya (max 5 min late ho sakta hai)
- [ ] Task pe remark do, phir naya reminder aaye toh usme **last remark** dikha
- [ ] Naya task → **Har 90 min** → pehla reminder due time pe, phir har 90 min (sirf 10 AM–8 PM)
- [ ] 90-min wale task pe staff **Update ✏️** kare → aaj aur reminder nahi, agli subah 10 baje se phir
- [ ] Naya task → **Har mahine** → Done karo → "🔁 Agla task" agle mahine ki usi tareekh ka bana
- [ ] Agle din subah 10 baje ☀️ daily summary aayi (jinke pending tasks hain)

## E. 25 din approval
- [ ] Staff: task → **Date badlo** → 30+ din aage ki date → remark → "Request admin ko bhej di", date **nahi** badli
- [ ] Admin (jisne task diya) ko approval request template aaya
- [ ] Admin: **Hi → ⏳ Approvals** (ya template ka "Approvals dekhein" button) → request → **Approve ✅** → staff ko "Approved" message, date badal gayi
- [ ] Dobara request → **Reject ❌** → staff ko "Rejected", purani date rahi

## F. Creator ko updates
- [ ] Staff remark de → admin (creator) ko "task update" template aaya
- [ ] Staff date badle (25 din ke andar) → admin ko update aaya

## G. Staff edit
- [ ] Admin: **Staff manage → Staff edit** → kisi ka naam badlo → list mein naya naam
- [ ] Staff ki branch badlo; staff ko admin banao; apna role badalne ki koshish → mana
