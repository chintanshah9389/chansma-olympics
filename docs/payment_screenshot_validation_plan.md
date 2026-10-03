# Payment Screenshot OCR Validation Architecture & Implementation Plan

> **CRITICAL DISCLAIMER & LIMITATION:**  
> Screenshot validation verifies that an uploaded image contains visual and textual information consistent with a genuine payment receipt. It **does not** independently verify that money was settled in the organizer's bank account. Definitive payment verification requires direct bank statement/UPI transaction log confirmation. This system serves as a powerful automated filter to eliminate fake, random, duplicate, and wrong-amount uploads while routing ambiguous submissions to human organizers.

---

## 1. Existing Codebase Inspection & Integration Points

Before detailing the plan, here is the exact mapping of where this functionality integrates into your current repository without rewriting existing components:

| Layer | Existing File | Proposed Integration Point |
|---|---|---|
| **Frontend Form (Pay Phase)** | [`src/main.ts`](file:///Users/harshshah/Projects/chansma-olympics/src/main.ts#L2836-L2931) (`renderPay()`) | Add a **"Verify Screenshot"** pre-check when a screenshot is selected in `<input data-payment-shot>`. Show instant feedback badge (Verified / Rejected / Manual Review required) and lock final submission if rejected. |
| **Frontend Storage API** | [`src/storage.ts`](file:///Users/harshshah/Projects/chansma-olympics/src/storage.ts) | Add helper function `verifyPaymentScreenshot(base64Image, expectedAmount)` calling backend verification endpoint. |
| **Node.js Express Server** | [`server/index.js`](file:///Users/harshshah/Projects/chansma-olympics/server/index.js) | Add endpoint `POST /api/payments/verify-screenshot` and enforce server-side validation inside `POST /api/registrations/checkout` before saving. |
| **OCR Engine (Python)** | `server/ocr_service/` *(New local service)* | Standalone local Python microservice using **PaddleOCR** + **OpenCV** + **FastAPI/Flask**, keeping models warm in memory for fast inference (< 1 sec). |
| **PostgreSQL Database** | [`server/index.js`](file:///Users/harshshah/Projects/chansma-olympics/server/index.js#L268-L308) (`ensureSchema()`) | Add columns to `registrations`: `utr_no`, `payment_status` (`VERIFIED`, `MANUAL_REVIEW`, `REJECTED`), `ocr_extracted_data` (JSONB). Add unique index on `utr_no`. |
| **Admin Dashboard** | [`src/admin.ts`](file:///Users/harshshah/Projects/chansma-olympics/src/admin.ts) | Add `Verification Status` & `UTR` columns in table; add quick approve/reject actions for entries flagged for `MANUAL_REVIEW`. |

---

## 2. Architecture: Local Python OCR Microservice vs Node.js

PaddleOCR is a Python-native library based on PaddlePaddle. Running Python child processes on-demand (`child_process.spawn`) has a **3 to 6 second import overhead** on every request.

### Recommended Architecture: Lightweight Local Python Sidecar
```
[User Browser]
       │ (1) Uploads Screenshot
       ▼
[Express Server (Port 3001)]
       │ (2) POST http://localhost:5001/ocr/validate
       │     Payload: { image_base64, expected_amount }
       ▼
[Python OCR Service (Port 5001)] ── Keep PaddleOCR model warm in RAM (<800ms inference)
       │ (3) File integrity & Magic Bytes check
       │ (4) OpenCV image preprocessing (deskew, contrast, resize)
       │ (5) PaddleOCR text + bounding box extraction
       │ (6) Regex & heuristic extractor (Amount, App, UTR, Success)
       │ (7) Return structured JSON
       ▼
[Express Server (Port 3001)]
       │ (8) Check Database: Does UTR already exist?
       │ (9) Apply Decision Engine → ACCEPT / REJECT / MANUAL_REVIEW
       ▼
[PostgreSQL Database] (Save UTR, OCR data, and status)
```

* **Zero external API costs**: Runs 100% locally on your machine/server.
* **Fallback Option**: If PaddleOCR dependencies fail on a specific platform, **Tesseract OCR (`pytesseract`)** acts as a drop-in fallback with identical extractor interfaces.

---

## 3. Step-by-Step Validation & Extraction Pipeline

```
                     ┌────────────────────────┐
                     │ Raw Uploaded Image File │
                     └───────────┬────────────┘
                                 │
                 [STEP 1: File & Dimension Validation]
                 ├── MIME check (image/jpeg, image/png)
                 ├── Magic bytes: JPEG (FF D8 FF) / PNG (89 50 4E 47)
                 ├── Min size > 15 KB & Max size < 10 MB
                 └── Dimensions > 300x300 px
                                 │ (Pass)
                 [STEP 2: OpenCV Image Preprocessing]
                 ├── Convert to grayscale / contrast normalization
                 └── Scale to optimal DPI/resolution for OCR
                                 │
                 [STEP 3: PaddleOCR Inference]
                 ├── Extract text tokens with bounding boxes & confidence
                 └── Construct full text + line-level coordinate map
                                 │
                 [STEP 4: Heuristic & Regex Extraction]
                 ├── 4.1 Payment App Detection (GPay, PhonePe, Paytm, BHIM, Bank)
                 ├── 4.2 Payment Success Indicators ("Paid to", "Payment successful")
                 ├── 4.3 Amount Extraction & Parsing (₹500 vs expected amount)
                 ├── 4.4 UTR / Transaction ID Extraction (12-digit UPI reference)
                 └── 4.5 Date / Time / Recipient details (if legible)
                                 │
                 [STEP 5: Security & Anti-Fraud Checks]
                 ├── Duplicate UTR check in PostgreSQL `registrations`
                 ├── Negative indicator check ("Failed", "Declined", "Pending")
                 └── Confidence score aggregation
                                 │
                     ┌───────────┴────────────┐
                     ▼                        ▼
                [DECISION]               [DB PERSISTENCE]
         ACCEPT / REJECT / REVIEW
```

### Detailed Extraction Rules

#### A. Payment App Detection
Scans for distinctive UPI ecosystem keywords:
- **Google Pay**: `"Google Pay"`, `"GPay"`, `"UPI transaction ID"`, `"Google LLC"`, `"CIC"`, `"Paid to"`
- **PhonePe**: `"PhonePe"`, `"Transaction ID"`, `"T24"`, `"Debited from"`, `"Transfer Details"`
- **Paytm**: `"Paytm"`, `"UPI Ref No"`, `"Money Sent"`, `"Payment to"`, `"Paytm Payments Bank"`
- **BHIM / Bank Apps**: `"BHIM"`, `"UPI Ref"`, `"Kotak"`, `"HDFC"`, `"SBI"`, `"ICICI"`, `"Axis"`, `"iMobile"`

#### B. Payment Success Indicators
Requires explicit proof of completion. General words like *"payment"* or *"UPI"* are **insufficient**:
- **Positive indicators (Required)**:  
  `"payment successful"`, `"paid successfully"`, `"transaction successful"`, `"payment completed"`, `"paid to"`, `"money sent to"`, `"successful"`, `"sent successfully"`.
- **Negative / Disqualifying indicators (Immediate Reject)**:  
  `"failed"`, `"payment failed"`, `"declined"`, `"transaction failed"`, `"cancelled"`, `"reversed"`.
- **Ambiguous indicators (Triggers Manual Review)**:  
  `"payment pending"`, `"processing"`, `"under review"`, `"awaiting confirmation"`.

#### C. Amount Validation
Strict equality matching against the expected amount calculated by [`src/fees.ts`](file:///Users/harshshah/Projects/chansma-olympics/src/fees.ts):
- Regex matches common currency variations:
  - `(?:₹|Rs\.?|INR)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{2})?)`
  - `(?:Amount|Total|Paid)\s*[:\-]?\s*(?:₹|Rs\.?|INR)?\s*([0-9,]+(?:\.[0-9]{2})?)`
- Normalize extracted string by removing commas, symbols, and formatting (e.g., `"₹ 1,200.00"` → `1200`).
- **Comparison Rule**:
  - `Extracted Amount == Expected Amount` → **PASS**
  - `Extracted Amount != Expected Amount` → **REJECT** (e.g., expected ₹700, screenshot says ₹500 or ₹70)
  - `No amount legible` → **MANUAL_REVIEW**

#### D. UTR / Transaction Reference Extraction & Duplicate Check
Every UPI transaction generates a standard 12-digit Unique Transaction Reference (UTR) or an app-specific transaction ID:
- **12-digit UTR Regex**:
  - `(?:UTR|UPI\s*(?:Ref|Reference|Transaction)?\s*(?:No|Number|ID)?)\s*[:\-#]?\s*([0-9]{12})`
  - `(?:\b)([0-9]{12})(?:\b)` (validated with surrounding context keywords)
- **App Specific IDs**:
  - PhonePe: `T[0-9]{20,24}`
  - Paytm: `[0-9]{16,20}`
- **Database Duplicate Check**:
  ```sql
  SELECT id, full_name, mobile, created_at 
  FROM registrations 
  WHERE utr_no = $1;
  ```
  If found → **REJECT** with reason: *"Duplicate payment: This UTR has already been used for registration [CHN-XXXXXX]."*

---

## 4. Decision Engine Truth Matrix

| Condition | Decision | User Action | System Action |
|---|---|---|---|
| Image is valid, success wording detected, amount matches expected, UTR found and unique in DB | **`ACCEPT`** | Can click "Submit Registration" | Auto-saves with status `VERIFIED` |
| File is not an image / corrupted / < 300px | **`REJECT`** | Must upload a valid image | Form stays blocked |
| Amount extracted does not match expected amount (e.g. ₹50 vs ₹500) | **`REJECT`** | Must upload screenshot showing full expected fee | Form stays blocked |
| UTR already exists in database | **`REJECT`** | Replay fraud blocked; must upload new payment | Form stays blocked; logged in security audit |
| Contains words like "Failed", "Declined", "Cancelled" | **`REJECT`** | Prompted to complete payment and retry | Form stays blocked |
| Success detected, amount matches, but UTR number is blurry or cut off | **`MANUAL_REVIEW`** | Allowed to submit with warning note | Saved with status `MANUAL_REVIEW`; highlighted in admin dashboard |
| Payment says "Processing" or "Pending" at bank | **`MANUAL_REVIEW`** | Allowed to submit | Flagged for manual verification once bank settles |
| Text is completely unreadable / random picture uploaded | **`REJECT`** | Prompted to upload proper payment receipt | Form stays blocked |

---

## 5. Database Schema Migration Plan

Update `registrations` in PostgreSQL via `ensureSchema()` in [`server/index.js`](file:///Users/harshshah/Projects/chansma-olympics/server/index.js):

```sql
-- Track extracted UTR and deduplicate payments
ALTER TABLE registrations 
  ADD COLUMN IF NOT EXISTS utr_no TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_verification_status TEXT DEFAULT 'PENDING_REVIEW',
  ADD COLUMN IF NOT EXISTS ocr_extracted_amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS ocr_extracted_app TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS ocr_raw_payload JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verification_notes TEXT DEFAULT '';

-- Fast lookup for duplicate UTR checks (ignore blank UTRs)
CREATE INDEX IF NOT EXISTS idx_registrations_utr 
  ON registrations (utr_no) 
  WHERE utr_no != '';

CREATE INDEX IF NOT EXISTS idx_registrations_payment_status 
  ON registrations (payment_verification_status);
```

---

## 6. Frontend User Interface Plan ([`src/main.ts`](file:///Users/harshshah/Projects/chansma-olympics/src/main.ts))

In Section `pay` (`renderPay()`):
1. **Interactive Screenshot Uploader**:
   - As soon as the user selects a screenshot, show an inline preview card.
   - Display a verification button: **"Verify Screenshot / સ્ક્રીનશૉટ ચકાસો"**.
2. **Real-time Status Pill & Analysis Details**:
   - **Scanning**: *"Analyzing screenshot using OCR... / OCR વડે ચકાસણી થઈ રહી છે..."*
   - **ACCEPT (Green)**:
     - *"✓ Verified: Google Pay · Amount ₹500 · UTR: 428190123456"*
     - Enables the primary **"Submit Registration"** button.
   - **REJECT (Red Alert Box)**:
     - *"✗ Rejected: Amount mismatch. Expected ₹700, but screenshot shows ₹250. Please upload the full payment screenshot."*
     - Keeps "Submit Registration" disabled.
   - **MANUAL_REVIEW (Amber Alert Box)**:
     - *"⚠️ Under Review: Amount matches (₹500), but UTR is partially obscured. You may submit; an organizer will verify your payment manually."*
     - Enables submission with a pending verification tag.

---

## 7. Admin Dashboard Plan ([`src/admin.ts`](file:///Users/harshshah/Projects/chansma-olympics/src/admin.ts))

Add administrative verification controls to the existing admin table:
1. **Status Filter**: Dropdown filter to view all `MANUAL_REVIEW` entries.
2. **Table Columns**:
   - `Payment Status`: Badges for `VERIFIED (Auto)`, `MANUAL REVIEW`, `CASH`.
   - `Extracted UTR`: Displays extracted 12-digit reference with a copy button.
3. **One-Click Review Modal**:
   - Shows the uploaded screenshot image side-by-side with the extracted text, detected amount, detected app, and user's expected amount.
   - Buttons: **"Mark Verified / મંજૂર કરો"** and **"Mark Rejected / અસ્વીકાર કરો"**.

---

## 8. Test Cases & Verification Matrix

| # | Test Scenario | Expected Result | Reason |
|---|---|---|---|
| **1** | Genuine Google Pay screenshot (₹500, UTR 428190123456, "Payment to Nihar Shah Successful") | **`ACCEPT`** | Matches amount, contains success keywords, valid unique UTR. |
| **2** | Genuine PhonePe screenshot (₹700, UTR 431289012345, "Paid Successfully") | **`ACCEPT`** | Correct amount, PhonePe headers, valid UTR. |
| **3** | Genuine Paytm screenshot (₹250, UPI Ref 429182736451, "Money Sent Successfully") | **`ACCEPT`** | Correct amount, Paytm UPI Ref, valid indicator. |
| **4** | Random photo of a dog or sunset (JPG/PNG) | **`REJECT`** | No payment indicators, no amount, no UTR. |
| **5** | Word document / text file renamed to `.png` | **`REJECT`** | Fails magic byte / OpenCV image decoding. |
| **6** | Screenshot of payment for ₹50 when fee is ₹500 | **`REJECT`** | Amount mismatch (`50 != 500`). |
| **7** | Screenshot with correct amount ₹500 but status says "Payment Failed" | **`REJECT`** | Explicit negative indicator detected. |
| **8** | Valid screenshot where user cropped out the bottom UTR number | **`MANUAL_REVIEW`** | Success and amount are verified, but UTR is missing. Requires organizer check. |
| **9** | Same valid screenshot uploaded by two different phone numbers | **`REJECT` (2nd attempt)** | Duplicate UTR collision in database. |
| **10** | Tiny image (50x50 pixels) | **`REJECT`** | Fails minimum dimension threshold. |
| **11** | Image of a news article or cricket scorecard | **`REJECT`** | Meaningful text exists, but no payment app or success tokens. |
| **12** | Screenshot with status "Payment Processing / Pending at Bank" | **`MANUAL_REVIEW`** | Transaction initiated but not settled. |

---

## 9. Next Steps When Ready to Implement

When you approve this plan, implementation can proceed in 3 clean stages without affecting existing registrations:
1. **Stage 1 (Backend OCR Service)**: Set up the Python FastAPI sidecar with PaddleOCR and test with sample payment screenshots.
2. **Stage 2 (Express & Database Integration)**: Add the database migration columns, duplicate check, and Express verification route.
3. **Stage 3 (Frontend & Admin UI)**: Wire up the verification feedback into the existing `renderPay()` uploader and add the manual review column to the admin table.
