# Cashfree Payment Gateway — Zero-Failure Architecture

This document defines the payment architecture for the **CHANSMA Olympic Registration** platform.

---

## 1. High-Level System Architecture & Component Flow

```mermaid
flowchart TD
    subgraph Client["1. User & Client (Browser / Vite)"]
        A1["Step 1-3: User Fills Registration Form"]
        A2["Step 4: Review Form & Click 'Proceed to Pay'"]
        A3["Open Cashfree Checkout Modal<br/><i>(@cashfreepayments/cashfree-js)</i>"]
        A4["User Completes UPI / Card / Netbanking"]
        A5["Modal Closes → Call /api/payments/verify"]
        A6["Step 5: Registration Confirmed Screen<br/><i>(Ref ID: CHN-XXXXXX, Seat Confirmed)</i>"]
    end

    subgraph Backend["2. Our Backend (Node.js / Express)"]
        B1["POST /api/payments/create-order<br/>• Validate age & phone duplicates<br/>• Generate unique order_id"]
        B2["Call Cashfree PGCreateOrder API"]
        B3["Channel A: POST /api/payments/webhook<br/>• Verify HMAC SHA-256 Signature"]
        B4["Channel B: POST /api/payments/verify<br/>• Call Cashfree PGFetchOrder API"]
        B5{"Atomic Fulfillment Engine<br/><i>(SELECT FOR UPDATE)</i><br/>Order already SUCCESS?"}
        B6["Idempotent No-Op<br/><i>(Return 200 OK immediately)</i>"]
        B7["Atomic PostgreSQL Commit<br/>• Update order to 'SUCCESS'<br/>• Insert into 'registrations'<br/>• Recalculate confirmed/waiting seats"]
        B8["WebSocket Broadcast<br/><i>('registrations-updated')</i>"]
    end

    subgraph Cashfree["3. Cashfree Gateway & Banking Network"]
        C1["Cashfree API returns payment_session_id"]
        C2["Bank processes payment & debits money"]
        C3["Direct Server Webhook<br/><i>(PAYMENT_SUCCESS_WEBHOOK)</i>"]
        C4["Cashfree Order Status API<br/><i>(Status: 'PAID')</i>"]
    end

    subgraph Database["4. PostgreSQL Database"]
        D1[("orders table<br/>Status: 'PENDING'<br/>Snapshot of full form_payload")]
        D2[("orders table<br/>Status: 'SUCCESS'<br/>Payment ID & Method stored")]
        D3[("registrations table<br/>Participant officially created<br/>Assigned confirmed/waiting seat")]
    end

    %% Step Connections
    A1 --> A2
    A2 -->|1. Submit form snapshot| B1
    B1 -->|2. Pre-save order snapshot| D1
    B1 -->|3. Init Order| B2
    B2 --> C1
    C1 -->|4. Return session ID| A3
    A3 --> A4
    A4 --> C2

    %% Dual-Channel Verification
    C2 -->|Channel A: Instant Webhook| C3
    C3 -->|Autonomous Server POST| B3
    B3 --> B5

    A4 -->|Channel B: Modal Closes| A5
    A5 -->|Direct client callback| B4
    B4 -->|Direct API status check| C4
    C4 --> B5

    %% Atomic Fulfillment
    B5 -->|Already Processed| B6
    B5 -->|First Time Processing| B7
    B7 --> D2
    B7 --> D3
    B7 --> B8
    B7 -->|Confirmation Response| A6

    %% Styling
    classDef clientStyle fill:#e0f2fe,stroke:#0284c7,stroke-width:2px,color:#0369a1;
    classDef backendStyle fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#92400e;
    classDef cashfreeStyle fill:#f3e8ff,stroke:#9333ea,stroke-width:2px,color:#6b21a8;
    classDef dbStyle fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#15803d;

    class A1,A2,A3,A4,A5,A6 clientStyle;
    class B1,B2,B3,B4,B5,B6,B7,B8 backendStyle;
    class C1,C2,C3,C4 cashfreeStyle;
    class D1,D2,D3 dbStyle;
```

---

## 2. Chronological Sequence Diagram (Step-by-Step)

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Participant
    participant FE as Frontend (Browser)
    participant BE as Backend (Express API)
    participant CF as Cashfree PG / Bank
    participant DB as PostgreSQL Database

    Note over User, DB: STEP 1: PRE-SAVE DATA & CREATE ORDER
    User->>FE: Fills form & clicks "Proceed to Payment"
    FE->>BE: POST /api/payments/create-order (snapshot of full form)
    BE->>BE: Validate phone duplicate & age limits for each sport
    BE->>DB: INSERT INTO orders (order_id, status='PENDING', form_payload)
    Note over DB: Form data safely preserved in DB before payment starts
    BE->>CF: Cashfree.PGCreateOrder (order_id, amount, customer_phone)
    CF-->>BE: Returns payment_session_id
    BE-->>FE: Returns { orderId, paymentSessionId }

    Note over User, DB: STEP 2: USER PAYS IN CHECKOUT MODAL
    FE->>CF: Mounts Cashfree Checkout Modal (@cashfreepayments/cashfree-js)
    User->>CF: Selects UPI / Card / Netbanking & authorizes payment
    CF->>CF: Bank debits money & marks order as PAID

    Note over User, DB: STEP 3: DUAL-CHANNEL SYNCHRONIZATION (ZERO-DROP GUARANTEE)
    par Channel A: Server Webhook (Autonomous & Immune to Browser Drops)
        CF->>BE: POST /api/payments/webhook (x-webhook-signature, rawBody)
        BE->>BE: Cryptographic HMAC SHA-256 signature verification
        BE->>DB: Atomic Lock: SELECT * FROM orders WHERE order_id = $1 FOR UPDATE
        alt If not already fulfilled
            BE->>DB: UPDATE orders SET status='SUCCESS'
            BE->>DB: INSERT INTO registrations (from verified form_payload)
            BE->>DB: Recalculate confirmed/waiting quota allocations
            BE->>FE: WebSocket broadcast('registrations-updated')
        else If already fulfilled
            BE-->>CF: 200 OK (Idempotent No-Op)
        end
        BE-->>CF: 200 OK
    and Channel B: Fast-Track Direct Verify (When Modal Closes)
        FE->>BE: POST /api/payments/verify { orderId }
        BE->>CF: Cashfree.PGFetchOrder(order_id)
        CF-->>BE: Returns { order_status: 'PAID' }
        BE->>DB: Atomic Lock & fulfill (if Channel A hasn't done it yet)
        BE-->>FE: Returns confirmed registration + Reference ID (CHN-XXXXXX)
    end

    Note over User, DB: STEP 4: REGISTRATION SUCCESSFUL
    FE->>User: Displays Step 5 Success Screen (Ref ID, Seat Confirmation, Payment Details)
```

---

## 3. How Zero-Failure & Zero-Lost-Payment Is Guaranteed

| Failure Scenario | What Happens In Standard Integrations | How Our Architecture Prevents It |
|---|---|---|
| **User closes browser right after paying** | Registration is lost; user's money is debited with no receipt. | **Pre-Saved Order + Webhook**: Form data was already saved in PostgreSQL as `PENDING`. Cashfree's server webhook communicates directly to our backend server, autonomously committing the registration even if the browser is closed. |
| **Cashfree Webhook is delayed** | User sits on a blank loading screen or sees a false timeout. | **Channel B (Direct API Fetch)**: When the modal closes, our backend actively queries Cashfree's `PGFetchOrder` API and instantly confirms the registration without waiting for the webhook. |
| **Both Webhook & Frontend Verify fire at the same time** | Duplicate registration created; tournament seats double-counted. | **PostgreSQL Row Lock (`SELECT FOR UPDATE`) & Idempotency Guard**: Whichever channel executes first marks the order `SUCCESS`. The second channel sees `SUCCESS` and exits cleanly as a safe no-op. |
| **Client-side tampering** | Attacker calls `/api/registrations` directly or fakes success. | **Zero-Trust Client**: Registrations can **only** be created by the backend fulfillment engine after cryptographic HMAC SHA-256 signature verification or Cashfree official REST API verification. |
| **Payment cancelled or declined by bank** | Partial data remains or seats get blocked. | The order is marked `FAILED` / `USER_DROPPED`. **No registration is inserted**, and no tournament seats are consumed. The user stays on Step 4 (Review) with all their inputs preserved so they can retry. |

---

## 4. Database Schema Structure

### `orders` Table
```sql
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,               -- e.g. order_CHN_K89X2P
  registration_id TEXT NOT NULL,          -- e.g. CHN-K89X2P
  customer_name TEXT NOT NULL,
  customer_mobile TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING, SUCCESS, FAILED, USER_DROPPED
  form_payload JSONB NOT NULL,            -- Complete snapshot of user's form inputs
  cf_order_id TEXT,
  cf_payment_id TEXT,
  payment_method TEXT,                    -- UPI, Card, Netbanking
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_mobile ON orders (customer_mobile);
```

### `registrations` Table Enhancements
```sql
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_id TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'PAID';
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10, 2);
```
