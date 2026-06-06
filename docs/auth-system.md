# Vazhai Authentication System — Architecture Overview

## Table of Contents

1. [Overview](#overview)
2. [Flow Diagram](#flow-diagram)
3. [Step 1: Send OTP](#step-1-send-otp)
4. [Step 2: Verify OTP & Create Session](#step-2-verify-otp--create-session)
5. [Session Persistence](#session-persistence)
   - [Local Development](#local-development)
6. [Auth Check (Page Load)](#auth-check-page-load)
7. [Logout](#logout)
8. [File Map](#file-map)

---

## Overview

The authentication system uses **email-based OTP login**. No passwords are involved. The flow is:

1. User enters their email → receives a 6-digit OTP via email (Resend API).
2. User enters the OTP → server verifies it → creates a **session token**.
3. The session token is stored in a **cookie + localStorage** on the client, and in **persistent server-side storage**.
4. On every page load, `js/common.js` calls `/auth/check` to validate the session.
5. The session is valid for **30 days**.

---

## Flow Diagram

```mermaid
sequenceDiagram
    participant User as Browser
    participant Client as js/common.js / login.html
    participant Server as Netlify Functions
    participant Store as Session Store
    participant Resend as Resend API

    Note over User,Resend: STEP 1: Send OTP
    User->>Client: Enters email & clicks "Send OTP"
    Client->>Server: POST /auth/send-otp { email }
    Server->>Server: Generate 6-digit OTP, set expiry 10 min
    Server->>Store: Save otp:{email} → { otp, expiresAt, attempts }
    Server->>Resend: Send email with OTP
    Resend-->>User: Email delivered
    Server-->>Client: { success: true }

    Note over User,Resend: STEP 2: Verify OTP
    User->>Client: Enters 6-digit OTP
    Client->>Server: POST /auth/verify-otp { email, otp }
    Server->>Store: Read otp:{email}
    Server->>Server: Validate otp, check expiry, check attempts
    Server->>Store: Delete otp:{email} (one-time use)
    Server->>Server: Generate random 64-char session token
    Server->>Store: Save session:{token} → { email, expiresAt (30d) }
    Server->>Store: Upsert user:{email} → { email, lastLogin }
    Server-->>Client: { token, email } + Set-Cookie
    Client->>Client: Save token to localStorage + cookie

    Note over User,Resend: STEP 3: Auth Check (every page load)
    Client->>Server: GET /auth/check (with Cookie or Authorization header)
    Server->>Store: Read session:{token}
    Server->>Server: Check expiry (30 days)
    Server-->>Client: { authenticated: true, email, expiresAt }
    Client->>Client: Show logged-in UI (email, logout button)
```

---

## Step 1: Send OTP

**Endpoint:** `POST /auth/send-otp`  
**File:** `netlify/functions/auth-send-otp.js`

```mermaid
flowchart LR
    A[User enters email] --> B[POST /auth/send-otp]
    B --> C{Validate email format}
    C -->|Invalid| D[Return 400 error]
    C -->|Valid| E[Generate 6-digit OTP]
    E --> F[Set expiry: now + 10 min]
    F --> G["Save to store: otp:{email}"]
    G --> H[Send via Resend API]
    H --> I{Resend success?}
    I -->|No| J[Return 500 error]
    I -->|Yes| K["Return { success: true }"]
```

**Key details:**
- OTP expires in **10 minutes**.
- Maximum **5 failed attempts** per OTP.
- OTP is deleted after successful verification (one-time use).
- In local dev, the email is still sent via Resend (requires `RESEND_API_KEY` in `.env`).

**Store key format:** `otp:{normalizedEmail}`

```json
{
  "otp": "482916",
  "expiresAt": 1780719000000,
  "attempts": 0
}
```

---

## Step 2: Verify OTP & Create Session

**Endpoint:** `POST /auth/verify-otp`  
**File:** `netlify/functions/auth-verify-otp.js`

```mermaid
flowchart TD
    A[User enters OTP] --> B[POST /auth/verify-otp]
    B --> C["Read otp:{email} from store"]
    C --> D{OTP exists?}
    D -->|No| E[Return error: request new OTP]
    D -->|Yes| F{Expired?}
    F -->|Yes| G[Delete otp record, return error]
    F -->|No| H{Attempts >= 5?}
    H -->|Yes| I[Delete otp record, return error]
    H -->|No| J{OTP matches?}
    J -->|No| K[Increment attempts, save, return error]
    J -->|Yes| L[Delete otp record]
    L --> M[Generate random session token]
    M --> N["Save session:{token} with 30-day expiry"]
    N --> O["Upsert user:{email} record"]
    O --> P["Set-Cookie: vazhai_session={token}"]
    P --> Q["Return { token, email }"]
```

**Key details:**
- Session token is a **64-character hex string** (32 random bytes via `crypto.randomBytes`).
- Session expires in **30 days** (`SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000`).
- The `Set-Cookie` header includes `Max-Age=2592000` (30 days in seconds) and `SameSite=Lax`.

**Store key formats:**

```
session:{token} → { email, expiresAt, createdAt }
user:{email}    → { email, firstLogin, lastLogin }
```

---

## Session Persistence

**File:** `netlify/functions/auth-store.js`

The store always tries **Netlify Blobs** first. If Netlify Blobs is unavailable (e.g. running locally without proper credentials), it falls back to a **file-backed JSON store** at `.local-auth-store.json`.

| Scenario | Storage Backend | Persistence |
|---|---|---|
| **Production (Netlify deployed)** | Netlify Blobs | ✅ Survives deploys, restarts, scaling |
| **Local `netlify dev` (with `NETLIFY_AUTH_TOKEN`)** | Netlify Blobs | ✅ Survives restarts (local blob emulation) |
| **Local `netlify dev` (no credentials)** | File-backed JSON (`.local-auth-store.json`) | ✅ Survives restarts, shared across function processes |

**Blob Store Configuration (when Netlify Blobs is used):**

| Property | Value |
|---|---|
| Storage driver | `@netlify/blobs` |
| Store name | `auth` |
| Init call | `getStore({ name: 'auth', context })` |

**Blob Key Names:**

| Key pattern | Purpose | Value shape |
|---|---|---|
| `otp:{normalizedEmail}` | Temporary OTP data (expires 10 min) | `{ otp, expiresAt, attempts }` |
| `session:{token}` | Active session (expires 30 days) | `{ email, expiresAt, createdAt }` |
| `user:{email}` | User metadata (persistent) | `{ email, firstLogin, lastLogin }` |

> **Important:** The `context` parameter (the second argument passed to the Netlify Function handler) is **required** for Netlify Blobs to correctly scope the store to the deployment. Without it, blob operations will fail.

**Usage in code:**
```javascript
const { getStore } = require('./auth-store');
const store = await getStore(context);

await store.setJSON(`otp:user@example.com`, { otp, expiresAt, attempts: 0 });
const session = await store.get(`session:abc123...`, { type: 'json' });
await store.delete(`user:user@example.com`);
```

**Store implementation logic:**
```
getStore(context)
  ├── Try: Netlify Blobs (using context parameter)
  │     └── Success → return Blobs store
  ├── Try: Netlify Blobs (explicit siteID + token from env/files)
  │     ├── NETLIFY_BLOBS_CONTEXT env var (JSON)
  │     ├── .netlify/state.json + NETLIFY_AUTH_TOKEN env var
  │     └── Success → return Blobs store
  └── Fallback: File-backed JSON store (.local-auth-store.json)
        └── Loaded into Map on first access
        └── Each write persists to disk immediately
        └── Expired sessions pruned on load
```
---

## Auth Check (Page Load)

**Endpoint:** `GET /auth/check`  
**File:** `netlify/functions/auth-check.js`  
**Client:** `js/common.js` (IIFE runs on all pages except login)

```mermaid
sequenceDiagram
    participant Browser
    participant commonJS as js/common.js
    participant Server as Netlify Function
    participant Store

    Note over Browser: User navigates to any page
    Browser->>commonJS: DOMContentLoaded
    commonJS->>commonJS: Skip if on login page
    commonJS->>commonJS: Get token from localStorage<br/>or document.cookie
    commonJS->>Server: GET /auth/check<br/>Headers: Authorization: Bearer {token}<br/>Cookie: vazhai_session={token}
    Server->>Server: Extract token from Cookie or Authorization header
    Server->>Store: Read session:{token}
    Store-->>Server: { email, expiresAt }
    Server->>Server: Check if expired
    alt Token valid & not expired
        Server-->>commonJS: { authenticated: true, email, expiresAt }
        commonJS->>commonJS: Hide "Login" link
        commonJS->>commonJS: Show email & "Logout" link
        commonJS->>commonJS: Attach logout handler
    else No token or expired
        Server->>Store: Delete expired session
        Server-->>commonJS: { authenticated: false }
        commonJS->>commonJS: Show "Login" link (default)
    end
```

**Where the UI updates happen** (`common-bottom.html` typically includes these elements):

| Element ID | Purpose |
|---|---|
| `page-login-link` | The "Login" link shown when logged out |
| `page-loggedin-email` | Shows the user's email when logged in |
| `page-logout-link` | The "Logout" link shown when logged in |

---

## Logout

**Endpoint:** `POST /auth/logout`  
**File:** `netlify/functions/auth-logout.js`

```mermaid
flowchart LR
    A[User clicks Logout] --> B[POST /auth/logout]
    B --> C[Extract token from Cookie or Authorization header]
    C --> D["Delete session:{token} from store"]
    D --> E["Set-Cookie: vazhai_session=; Max-Age=0"]
    E --> F[Client clears localStorage + cookie]
    F --> G[Reload page]
```

**Client-side cleanup:**
```javascript
localStorage.removeItem('vazhai_session');
document.cookie = 'vazhai_session=; Path=/; Max-Age=0; SameSite=Lax';
window.location.reload();
```

---

## File Map

| File | Purpose |
|---|---|
| `netlify/functions/auth-store.js` | Storage abstraction — Netlify Blobs (always, including local dev via `netlify dev`) |
| `netlify/functions/auth-send-otp.js` | Generates OTP, stores it, sends via Resend |
| `netlify/functions/auth-verify-otp.js` | Verifies OTP, creates session token, stores it, sets cookie |
| `netlify/functions/auth-check.js` | Validates session token on page load |
| `netlify/functions/auth-logout.js` | Deletes session from store, clears cookie |
| `js/common.js` | Client-side auth check on every page (IIFE at bottom) |
| `login.html` | Login page UI with email + OTP forms |
| `netlify.toml` | Redirects `/auth/*` URLs to the corresponding Netlify functions |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | Yes | API key for sending OTP emails via Resend |
| `OTP_FROM_EMAIL` | No | Sender email address (default: `do-not-reply@vazhai.in`) |
| `SITE_URL` | Local dev only | Used for local testing (e.g. `http://localhost:8888`) |
| `NETLIFY_BLOBS_CONTEXT` | No (see below) | JSON string with `{ "siteID": "...", "token": "..." }` for Netlify Blobs |

### Netlify Blobs: Providing `siteID` and `token`

Netlify Blobs requires `siteID` and `token` to connect. There are three ways to supply them:

**1. `netlify link` (recommended)**  
Run `netlify link` in the project root and select your Netlify site. This stores the site ID in `.netlify/state.json` and `netlify dev` automatically injects the proper context into functions — Netlify Blobs works natively without any extra env vars.

**2. `NETLIFY_BLOBS_CONTEXT` env var**  
The `@netlify/blobs` package reads the `NETLIFY_BLOBS_CONTEXT` environment variable, which must be a JSON string:
```bash
NETLIFY_BLOBS_CONTEXT='{"siteID":"YOUR_SITE_ID","token":"YOUR_API_TOKEN"}'
```
- **siteID**: Found at **Netlify Dashboard → Site → Site settings → General → Site details → Site ID**, or in `.netlify/state.json` after `netlify link`.
- **token**: Generate at **Netlify Dashboard → User settings → Applications → Personal access tokens**.

Add this to your `.env` file for local development.

**3. File-backed JSON fallback (no setup needed)**  
If neither option is configured, `auth-store.js` falls back to a JSON file at `.local-auth-store.json`. This persists across restarts and is shared across all function processes, so sessions survive cold starts. Gitignored by default. No configuration required.

---

## Summary

```mermaid
flowchart TD
    subgraph Client-Side
        A[login.html] --> |OTP verification| B[localStorage + Cookie]
        C[js/common.js] --> |Page load check| B
        B --> D[Auth header or Cookie sent with requests]
    end

    subgraph Netlify_Functions ["Netlify Functions"]
        E["/auth/send-otp"] --> F["/auth/verify-otp"]
        F --> G["session:{token} stored"]
        H["/auth/check"] --> |Read session| G
        I["/auth/logout"] --> |Delete session| G
    end

    subgraph Storage
        J[Netlify Blobs] --> K[(Persistent<br/>KV Store)]
    end

    G --> J
```

The key insight is: **the session token is stored server-side**, not just client-side. The client only holds a reference (cookie/token) to look up the session. This means revoking a session on the server (e.g. via logout) truly invalidates it, and the 30-day expiry is enforced server-side regardless of what the client does.