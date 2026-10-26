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
