# WhatsApp Templates (Interakt mein submit karne ke liye)

*Radhe Task Bot · Batch 1 + Batch 2*

---

## 1. Ye templates kyun chahiye

WhatsApp ka **24-hour rule**: agar staff ne pichle 24 ghante mein bot ko koi message nahi bheja,
toh bot unhe normal message nahi bhej sakta. Us time sirf **Meta-approved template** hi jaata hai
(ye paid message hota hai).

- Template approve hone tak bot wahi baat **normal text** mein bhejega, lekin wo sirf 24 ghante ki
  window ke andar hi pahunchega.
- Isliye templates jaldi submit kar dijiye. Approval mein usually **24-48 ghante** lagte hain.

### Sabse zaroori baat: naam exact same hona chahiye

Bot inhi naamon se template bhejta hai. Naam mein ek bhi letter, underscore ya `_v1` alag hua toh
template nahi jayega. Copy-paste kijiye, khud type mat kijiye.

---

## 2. Kaunse templates kab chahiye

| Batch | Template name | Kaam |
|---|---|---|
| **Batch 1 (abhi submit karein)** | `task_assigned_v1` | Staff ko naya task milne ki khabar |
| **Batch 1** | `task_done_v1` | Admin ko khabar ki task complete ho gaya |
| **Batch 1** | `welcome_user_v1` | Naye staff/admin ko bot pe add hone ka welcome |
| Batch 2 | `task_reminder_v1` | Task ka reminder |
| Batch 2 | `task_updated_v1` | Admin ko khabar ki staff ne task pe update diya |
| Batch 2 | `date_approval_request_v1` | Admin se due date 25 din se aage karne ki permission |
| Batch 2 | `date_approval_result_v1` | Staff ko batana ki date request approve hui ya reject |
| Batch 2 | `daily_summary_v1` | Roz ki pending / overdue tasks ki ginti |

Batch 2 wale bhi abhi submit kar sakte hain, koi nuksaan nahi. Bas Batch 1 wale pehle zaroor karein.

---

## 3. Interakt mein template kaise submit karein (step by step)

1. **app.interakt.ai** pe login karein.
2. Left menu mein **Templates** kholiye, phir **Create Template** (ya "+ New Template") dabayein.
3. **Template Name**: neeche diya hua naam exact copy-paste karein (jaise `task_assigned_v1`).
4. **Category**: **Utility** chuniye.
5. **Language**: **English** chuniye. (Hinglish Roman script mein hai, isliye English hi chalega.)
6. **Header**: "Text" chuniye aur neeche diya hua header daaliye. (Jahan header "None" likha hai, wahan header mat daaliye.)
7. **Body**: neeche diya hua body text copy-paste karein. `{{1}}`, `{{2}}` ... jaise hain waise hi rehne dein.
8. **Sample values**: har `{{n}}` ke liye Interakt sample maangega. Neeche di hui sample values daal dijiye. (Meta inhe sirf check karne ke liye dekhta hai, customer ko nahi jaati.)
9. **Footer**: `Radhe Task Bot` daaliye.
10. **Buttons**: **Quick Reply** chuniye aur neeche diye hue button text exact daaliye. (Call-to-action / URL / phone button mat lagaiye.)
11. **Submit** dabayein. Status "Pending" dikhega, approve hone pe "Approved" ho jayega.
12. Agar **Rejected** aaye toh reason screenshot karke bhej dijiye, wording thodi badal ke dobara submit karenge (naam `_v2` ho jayega aur code mein bhi update hoga).

### Meta ke rules (inka dhyan rakha gaya hai, wording badlein toh bhi yaad rakhein)

- Body **`{{n}}` se shuru ya khatam nahi** ho sakti. Pehle aur baad mein kuch text hona chahiye.
- Do variables **ek ke baad ek bina text ke** nahi ho sakte (jaise `{{2}} {{3}}` galat hai).
- Koi line **sirf variable** wali nahi honi chahiye bina kisi label ke (isliye har variable ke aage "Task:", "Due date:" jaisa label hai).
- Variables number order mein hone chahiye: `{{1}}`, `{{2}}`, `{{3}}` ... beech ka number skip nahi.
- Body **1024 characters** se zyada nahi. Header 60 characters tak, footer 60 characters tak.
- Text ke hisaab se bahut zyada variables ho toh Meta reject kar deta hai, isliye har template mein thoda normal text bhi hai.
- **Promotional words** (offer, discount, sale, free) mat daaliye, warna Meta template ko "Marketing" bana dega (jo mehenga hai).
- Emoji 1-2 se zyada nahi. Header mein emoji mat daaliye.
- Quick Reply button max 3, har button 25 characters tak.

### Buttons ke baare mein

- Quick Reply dabane pe bot ko **sirf button ka text** milta hai (jaise "Mere tasks"). Isliye "Done" jaisa button nahi lagaya, kyunki bot ko pata nahi chalega kaunsa task.
- "Mere tasks" dabane pe bot aapke tasks ki list bhejega, wahan se Done / Update kar sakte hain.
- Button dabane se 24-hour window bhi khul jaati hai, phir bot normal messages bhej sakta hai.

---

## 4. Templates (copy-paste ke liye)

### 4.1 `task_assigned_v1` (Batch 1)

Kab jaata hai: jab kisi ko naya task diya jaata hai.

| Field | Value |
|---|---|
| Name | `task_assigned_v1` |
| Category | Utility |
| Language | English |
| Header | Text: `Naya Task` |
| Footer | `Radhe Task Bot` |
| Buttons | Quick Reply: `Mere tasks` · Quick Reply: `Menu` |

**Body:**

```
Namaste {{1}} ji,
{{2}} ne aapko ek naya task diya hai.

Task: {{3}}
Due date: {{4}}
Agla reminder: {{5}}

Apne tasks dekhne ya update karne ke liye neeche "Mere tasks" dabayein.
```

| Variable | Matlab | Sample value |
|---|---|---|
| `{{1}}` | Jisko task mila (assignee) | Chikku |
| `{{2}}` | Jisne task diya | Bhaskar |
| `{{3}}` | Task | Raipur godown ka tiles stock check karna |
| `{{4}}` | Due date | 28 Oct 2026, 10:00 AM |
| `{{5}}` | Agla reminder | 28 Oct 2026, 9:00 AM |

---

### 4.2 `task_done_v1` (Batch 1)

Kab jaata hai: jab task complete hota hai, sirf us admin ko jisne task diya tha.

| Field | Value |
|---|---|
| Name | `task_done_v1` |
| Category | Utility |
| Language | English |
| Header | Text: `Task Complete` |
| Footer | `Radhe Task Bot` |
| Buttons | Quick Reply: `Mere tasks` |

**Body:**

```
Namaste {{1}} ji,
{{2}} ne ek task complete kar diya hai ✅

Task: {{3}}
Complete hua: {{4}}

Baaki tasks dekhne ke liye neeche "Mere tasks" dabayein.
```

| Variable | Matlab | Sample value |
|---|---|---|
| `{{1}}` | Admin ka naam | Bhaskar |
| `{{2}}` | Jisne complete kiya | Chikku |
| `{{3}}` | Task | Raipur godown ka tiles stock check karna |
| `{{4}}` | Kab complete hua | 27 Oct 2026, 4:30 PM |

---

### 4.3 `welcome_user_v1` (Batch 1)

Kab jaata hai: jab admin kisi naye staff/admin ko bot pe add karta hai.

| Field | Value |
|---|---|
| Name | `welcome_user_v1` |
| Category | Utility |
| Language | English |
| Header | Text: `Radhe Task Bot` |
| Footer | `Radhe Task Bot` |
| Buttons | Quick Reply: `Mere tasks` |

**Body:**

```
Namaste {{1}} ji,
{{2}} ne aapko Radhe Task Bot par {{3}} ke roop mein add kiya hai.

Ab aap WhatsApp par hi apne tasks dekh aur update kar sakte hain. Shuru karne ke liye "Hi" bhejein ya neeche "Mere tasks" dabayein.
```

| Variable | Matlab | Sample value |
|---|---|---|
| `{{1}}` | Naye user ka naam | Chikku |
| `{{2}}` | Jisne add kiya | Bhaskar |
| `{{3}}` | Role (Staff / Admin) | Staff |

---

### 4.4 `task_reminder_v1` (Batch 2)

Kab jaata hai: reminder time pe (ek baar, har 90 min, ya monthly).

| Field | Value |
|---|---|
| Name | `task_reminder_v1` |
| Category | Utility |
| Language | English |
| Header | Text: `Task Reminder` |
| Footer | `Radhe Task Bot` |
| Buttons | Quick Reply: `Mere tasks` · Quick Reply: `Menu` |

**Body:**

```
Namaste {{1}} ji, ye aapke task ka reminder hai.

Task: {{2}}
Due date: {{3}}
Last remark: {{4}}

Kaam ho gaya ho toh "Mere tasks" mein jaakar Done mark karein.
```

| Variable | Matlab | Sample value |
|---|---|---|
| `{{1}}` | Jisko task mila | Chikku |
| `{{2}}` | Task | Raipur godown ka tiles stock check karna |
| `{{3}}` | Due date | 28 Oct 2026, 10:00 AM |
| `{{4}}` | Aakhri remark (na ho toh "-") | Aadha stock check ho gaya |

---

### 4.5 `task_updated_v1` (Batch 2)

Kab jaata hai: jab staff kisi task pe update/remark deta hai (admin ko).

| Field | Value |
|---|---|
| Name | `task_updated_v1` |
| Category | Utility |
| Language | English |
| Header | Text: `Task Update` |
| Footer | `Radhe Task Bot` |
| Buttons | Quick Reply: `Mere tasks` |

**Body:**

```
Namaste {{1}} ji,
{{2}} ne ek task par update diya hai.

Task: {{3}}
Update: {{4}}

Details dekhne ke liye neeche "Mere tasks" dabayein.
```

| Variable | Matlab | Sample value |
|---|---|---|
| `{{1}}` | Admin ka naam | Bhaskar |
| `{{2}}` | Jisne update diya | Chikku |
| `{{3}}` | Task | Raipur godown ka tiles stock check karna |
| `{{4}}` | Update / remark | Aadha stock check ho gaya, baaki kal karenge |

---

### 4.6 `date_approval_request_v1` (Batch 2)

Kab jaata hai: jab staff due date 25 din se zyada aage karna chahta hai (admin ko).

| Field | Value |
|---|---|
| Name | `date_approval_request_v1` |
| Category | Utility |
| Language | English |
| Header | Text: `Date Approval` |
| Footer | `Radhe Task Bot` |
| Buttons | Quick Reply: `Approvals dekhein` · Quick Reply: `Mere tasks` |

**Body:**

```
Namaste {{1}} ji,
{{2}} ek task ki due date 25 din se zyada aage karna chahte hain.

Task: {{3}}
Abhi ki date: {{4}}
Maangi gayi date: {{5}}

Approve ya Reject karne ke liye neeche "Approvals dekhein" dabayein.
```

| Variable | Matlab | Sample value |
|---|---|---|
| `{{1}}` | Admin ka naam | Bhaskar |
| `{{2}}` | Staff ka naam | Chikku |
| `{{3}}` | Task | Jagdalpur showroom ka display badalna |
| `{{4}}` | Abhi ki due date | 30 Oct 2026, 10:00 AM |
| `{{5}}` | Nayi maangi gayi date | 5 Dec 2026, 10:00 AM |

---

### 4.7 `date_approval_result_v1` (Batch 2)

Kab jaata hai: admin ke Approve / Reject karne ke baad (staff ko).

| Field | Value |
|---|---|
| Name | `date_approval_result_v1` |
| Category | Utility |
| Language | English |
| Header | Text: `Date Request` |
| Footer | `Radhe Task Bot` |
| Buttons | Quick Reply: `Mere tasks` |

**Body:**

```
Namaste {{1}} ji,
aapki due date badalne ki request par faisla ho gaya hai.

Task: {{2}}
Result: {{3}}
Ab due date: {{4}}

Apne tasks dekhne ke liye neeche "Mere tasks" dabayein.
```

| Variable | Matlab | Sample value |
|---|---|---|
| `{{1}}` | Staff ka naam | Chikku |
| `{{2}}` | Task | Jagdalpur showroom ka display badalna |
| `{{3}}` | Result | Approved |
| `{{4}}` | Ab ki due date | 5 Dec 2026, 10:00 AM |

---

### 4.8 `daily_summary_v1` (Batch 2)

Kab jaata hai: roz subah, har user ko apne pending/overdue tasks ki ginti.

| Field | Value |
|---|---|
| Name | `daily_summary_v1` |
| Category | Utility |
| Language | English |
| Header | Text: `Aaj ke Tasks` |
| Footer | `Radhe Task Bot` |
| Buttons | Quick Reply: `Mere tasks` |

**Body:**

```
Namaste {{1}} ji, ye aapke aaj ke tasks ki summary hai.

Pending tasks: {{2}}
Overdue tasks: {{3}}

Poori list dekhne ke liye neeche "Mere tasks" dabayein.
```

| Variable | Matlab | Sample value |
|---|---|---|
| `{{1}}` | User ka naam | Chikku |
| `{{2}}` | Pending tasks ki ginti | 5 |
| `{{3}}` | Overdue tasks ki ginti | 2 |

---

### 4.9 `task_cancelled_v1` (Dashboard) · approved 27 Oct, used by the dashboard Cancel

Kab jaata hai: jab dashboard se task cancel hota hai. Assignee aur creator dono ko jaata hai, par jisne cancel kiya usko nahi. Agar dono ek hi insaan hain, toh ek hi message jaata hai.

| Field | Value |
|---|---|
| Name | `task_cancelled_v1` |
| Category | Utility |
| Language | English |
| Header | Text: `Task Cancelled` |
| Footer | `Radhe Task Bot` |
| Buttons | Quick Reply: `Mere tasks` |

**Body:**

```
Namaste {{1}} ji,
{{2}} ne ek task cancel kar diya hai.

Task: {{3}}
Kiska task: {{4}}

Is task ka ab koi reminder nahi aayega. Baaki tasks ke liye neeche "Mere tasks" dabayein.
```

| Variable | Matlab | Sample value |
|---|---|---|
| `{{1}}` | Jisko message ja raha hai | Hema |
| `{{2}}` | Jisne cancel kiya | Dashboard (admin) |
| `{{3}}` | Task | Sharma ji se payment lena |
| `{{4}}` | Task kiske naam pe tha | Hema |

---

### 4.10 `task_form_admin_v1` and `task_form_staff_v1` (Batch 3 forms) · APPROVED 27 Oct (Meta categorised `task_form_staff_v1` as MARKETING, admin one as UTILITY)

Form templates: the button opens a WhatsApp Form built in Interakt (Automations → WhatsApp Forms). Full steps and the exact form fields: `docs/FORMS-SETUP.md`.

| | `task_form_admin_v1` | `task_form_staff_v1` |
|---|---|---|
| Category / language | Utility / English | Utility / English |
| Body (no variables) | `Naya task banane ke liye neeche button dabaiye aur form bhariye. Sab ek hi screen pe.` | same |
| Button | WhatsApp Flow/Form, text `Form kholo`, form **Naya Task Admin v2** | same, form **Naya Task Staff** |

Code: zero body values; sent with `is_flow_template: true` and the flow token `task_form_admin` / `task_form_staff` (`interakt/templates.ts`). Sent only when the user taps "📝 Naya task (Form)" in the menu (inside the 24 h window). If the send fails, the fallback text points to the old "➕ Naya task".
Staff changes: a new Admin form needs a new template `task_form_admin_v2`, `_v3`... (published forms can't be edited).

## 5. Aage ke liye ideas (OPTIONAL, abhi code mein nahi hain)

> Ye sirf ideas hain. Abhi submit karne ki zaroorat **nahi** hai. Jab ye features banenge tab
> wording final karke submit karenge.

### `task_overdue_alert_v1` (optional)

Admin ko khabar jab kisi staff ka task due date nikal jaane ke baad bhi pending ho.

```
Namaste {{1}} ji,
{{2}} ka ek task due date ke baad bhi pending hai.

Task: {{3}}
Due date thi: {{4}}

Details dekhne ke liye neeche "Mere tasks" dabayein.
```

Samples: Bhaskar · Chikku · Durg branch ka payment follow-up · 25 Oct 2026, 10:00 AM
Buttons: Quick Reply `Mere tasks`

### `weekly_report_v1` (optional)

Har Monday admin ko pichle hafte ka hisaab.

```
Namaste {{1}} ji, ye pichle hafte ki task report hai.

Complete hue: {{2}}
Abhi pending: {{3}}
Overdue: {{4}}

Poori list ke liye neeche "Menu" dabayein.
```

Samples: Bhaskar · 18 · 7 · 3
Buttons: Quick Reply `Menu`

### `task_reassigned_v1` (optional)

Jab task ek staff se lekar dusre ko diya jaaye (purane staff ko khabar).

```
Namaste {{1}} ji,
aapka ek task {{2}} ne {{3}} ko de diya hai.

Task: {{4}}

Apne baaki tasks dekhne ke liye neeche "Mere tasks" dabayein.
```

Samples: Hardware · Bhaskar · Chikku · Raipur godown ka tiles stock check karna
Buttons: Quick Reply `Mere tasks`
