# Batch 0 Setup Guide

**Difficulty:** Easy-Medium · **Time:** ~30-45 minute · **Terminal ki zaroorat nahi**

Batch 0 ka maqsad sirf ye test karna hai:
1. Interakt API se **List** (dropdown) aur **Buttons** wale message jaate hain ya nahi
2. Jab koi list/button pe click karta hai, toh webhook mein data kaisa aata hai

Bot sirf `TEST_NUMBERS` wale numbers ko reply karega. Customers ko kuch nahi jayega.

> ⚠️ **Koi bhi key / password chat mein ya GitHub pe paste mat karna.** Sirf Cloudflare ke "Secrets" box mein daalna hai.

---

## Step 1: Firebase project banao (~10 min)

1. https://console.firebase.google.com kholo → **Create a project**
2. Naam do (jaise `pa-wp-tasks`) → Google Analytics **OFF** kar do → Create
3. Left menu mein **Build → Firestore Database** → **Create database**
   - Location: **asia-south1 (Mumbai)**. Ye baad mein badal nahi sakte.
   - Mode: **Production mode** (safe hai, bot apni key se access karega)
4. Upar ⚙️ (gear) → **Project settings** → **Service accounts** tab → **Generate new private key** → ek `.json` file download hogi
5. Is file ko Notepad mein kholo. Isme se 3 cheezein Step 2 mein chahiye:
   - `project_id`
   - `client_email`
   - `private_key` (`-----BEGIN PRIVATE KEY-----` se `-----END PRIVATE KEY-----\n` tak, poora)

   Ye file kisi ko mat bhejna. Kaam hone ke baad kisi safe jagah rakh do.

## Step 2: Cloudflare Worker banao (~15 min)

1. https://dash.cloudflare.com pe free account banao
2. Left menu → **Workers & Pages** → **Create** → **Import a repository** (GitHub connect karo)
3. Repo chuno: `PA-WP-`
4. Settings:
   - **Project name:** `pa-wp-bot`
   - **Production branch:** `claude/nifty-franklin-xolea7` (baad mein `main` kar denge)
   - **Root directory / Path:** `worker`
   - **Build command:** khaali chhod do · **Deploy command:** `npx wrangler deploy`
5. **Deploy** dabao. Deploy hone pe ek URL milega, jaise `https://pa-wp-bot.<tumhara-naam>.workers.dev`
   - Browser mein kholo. **`pa-wp-bot ok`** dikhna chahiye ✅
6. Worker → **Settings → Variables and Secrets** → har ek ko **Add → Type: Secret** se daalo:

| Name | Value kahan se |
|---|---|
| `WEBHOOK_SECRET` | Claude ne chat mein diya hai |
| `INTERAKT_API_KEY` | Interakt → Settings → Developer Settings → API key |
| `INTERAKT_ORG_ID` | Claude ne chat mein diya hai |
| `TEST_NUMBERS` | Claude ne chat mein diya hai |
| `FIREBASE_PROJECT_ID` | JSON file ka `project_id` |
| `FIREBASE_CLIENT_EMAIL` | JSON file ka `client_email` |
| `FIREBASE_PRIVATE_KEY` | JSON file ka `private_key` (poora, quotes ke bina) |
| `SHEET_FORWARD_URL` | Purane Google Sheet wala Apps Script URL (taaki sheet mein logging chalti rahe). Nahi chahiye toh skip |

7. Secrets save karne ke baad worker **re-deploy** ho jayega.

## Step 3: Interakt ka webhook URL badlo (~5 min)

1. Interakt → **Settings → Developer Settings → Webhook**
2. URL daalo: `https://pa-wp-bot.<tumhara-naam>.workers.dev/webhook/<WEBHOOK_SECRET>`
3. **Message received** event ON hona chahiye
4. Save. Purana Google Sheet URL yahan se hat jayega, par `SHEET_FORWARD_URL` daala hai toh sheet mein data aata rahega.

## Step 4: Test (~5 min)

Test number (Bhaskar) se business number pe **Hi** bhejo:

| Kya hona chahiye | Matlab |
|---|---|
| "Branch chuno" button wala list message aaya | ✅ List API kaam karti hai |
| Approve / Reject buttons wala message aaya | ✅ Button API kaam karti hai |
| List mein "Durg" chuna → "✅ List kaam kar rahi hai! ... id: BRANCH_DURG" | ✅ List reply padh pa rahe hain |
| Approve dabaya → "✅ Button kaam kar raha hai! ... id: TEST_APPROVE" | ✅ Button reply padh pa rahe hain |

**Kuch na aaye ya galat aaye toh:**
- Cloudflare → Worker → **Logs** (Live) kholo, phir dobara Hi bhejo. Jo error dikhe uska screenshot Claude ko bhejo.
- Firebase → Firestore → `webhook_log` collection mein har message ka raw data save hota hai. Button dabane wala entry ka `raw` field copy karke Claude ko bhejo.

**Note:** Interakt ki purani "welcome / Greeting Flow / FAQ" automations bhi "Hi" ka reply kar sakti hain. Test mein double reply dikhe toh ghabrana mat, ye expected hai. Unko live jaane se pehle handle karenge.
