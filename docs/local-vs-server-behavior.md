# Local Mode vs Server Mode: Behavioral Differences

This document catalogues every behavioral difference between running this project locally (`netlify dev`, `localhost`) versus deployed on Netlify's production servers.

---

## Table of Contents

1. [Blob / Session Storage](#1-blob--session-storage)
2. [API URL Routing (Frontend)](#2-api-url-routing-frontend)
3. [Environment Variables & Configuration](#3-environment-variables--configuration)
4. [Razorpay Plan ID Resolution](#4-razorpay-plan-id-resolution)
5. [Config Endpoint Fallback Chain](#5-config-endpoint-fallback-chain)
6. [DEV MODE Auto-fill in Donation Form](#6-dev-mode-auto-fill-in-donation-form)
7. [CORS Headers](#7-cors-headers)
8. [Redirects & URL Rewrites](#8-redirects--url-rewrites)
9. [File System Access](#9-file-system-access)
10. [Email Sending (Resend)](#10-email-sending-resend)
11. [Summary Table](#11-summary-table)

---

## 1. Blob / Session Storage

**File:** `netlify/functions/auth-store.js`

This is the **biggest difference** between local and server modes. The store uses a cascade of fallbacks:

| Attempt | Method | Local Mode | Server (Production) Mode |
|---|---|---|---|
| 1st | `getStore({ name: 'auth', context })` using the `context` parameter | ✅ Works via `netlify dev` if site is linked | ✅ Works (automatic) |
| 2nd | `NETLIFY_BLOBS_CONTEXT` env var | ✅ If manually set in `.env` | ❌ Not available |
| 3rd | `.netlify/state.json` + `NETLIFY_AUTH_TOKEN` | ✅ With `netlify link` + token | ❌ Not available |
| 4th | `.netlify/state.json` (siteID only, no token) — local emulation | ✅ (limited) | ❌ Not available |
| 5th | `SITE_ID` env var | ❌ Not set locally | ✅ Injected by Netlify runtime |
| **Fallback** | ❌ Removed — throws error instead | N/A | N/A |

### Key Differences:

**In production (Netlify deployed):**
- `SITE_ID` is always set by the Netlify runtime
- Netlify Blobs always works without any explicit credentials
- The file-backed fallback is never used (and wouldn't work anyway due to Lambda's read-only filesystem)

**In local (`netlify dev`):**
- `SITE_ID` is **not** set
- The code tries multiple credential sources in order:
  1. `NETLIFY_BLOBS_CONTEXT` env var (JSON string with `siteID` + `token`)
  2. `.netlify/state.json` (created by `netlify link`) combined with `NETLIFY_AUTH_TOKEN` env var
  3. `.netlify/state.json` with siteID only (no token) — tries local blob emulation
- If none of these work, an error is thrown — there is **no file-backed fallback** anymore

> **Note:** The `.local-auth-store.json` file-backed fallback has been removed to ensure identical behavior between local and production modes. The store now requires Netlify Blobs in both environments.

### Impact:
- **Stored data survives** in both modes (blobs in both local and production)
- **Data is NOT shared** between local and production — they are completely separate blob stores (different site IDs)
- **Race conditions**: Not possible — Netlify Blobs handles concurrent access correctly
- **Failure mode**: If blobs are unavailable (no `netlify link`, not running via `netlify dev`), the function throws an error instead of silently falling back to a file

---

## 2. API URL Routing (Frontend)

**File:** `js/donate.js`, lines 299-313

```javascript
const _netlifyFunctionsLocalPort = 8888;
const _isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const _functionMap = {
  '/donate/order': 'donate-order',
  '/donate/verify': 'donate-verify',
  '/donate/subscribe': 'donate-subscribe',
  '/donate/verify-subscription': 'donate-verify-subscription',
};
function apiUrl(path) {
  if (_isLocalHost && _functionMap[path]) {
    return `http://localhost:${_netlifyFunctionsLocalPort}/.netlify/functions/${_functionMap[path]}`;
  }
  return path;
}
```

### Difference:

| Aspect | Local Mode | Server Mode |
|---|---|---|
| Donate API URLs | `http://localhost:8888/.netlify/functions/donate-*` | Relative path: `/donate/order`, `/donate/verify`, etc. |
| Proxy via netlify.toml | Not used for XHR (bypasses redirects) | Used (redirects map `/donate/*` → `/.netlify/functions/donate-*`) |
| Hardcoded port | `8888` | N/A |

### Potential Issue:
The `_netlifyFunctionsLocalPort` is hardcoded to `8888`. If the user runs `netlify dev` on a different port (e.g., via `netlify dev --port 9999`), the donate flow **will break** locally because the API calls will go to the wrong port.

**Auth functions** (`/auth/*`) do NOT have this issue — they use relative paths throughout and rely on netlify.toml redirects.

### Auth API URL Handling:
All auth functions use relative URL paths:

| Context | URL Used | Mechanism |
|---|---|---|
| `login.html` | `/auth/send-otp`, `/auth/verify-otp`, `/auth/check`, `/auth/logout` | Resolved via netlify.toml redirects in both modes |
| `dashboard/user.html` | `/auth/check`, `/auth/logout` | Same — relative paths |
| `dashboard/manage.html` | `/auth/check`, `/auth/admin` | Same — relative paths |
| `js/common.js` | `/auth/check`, `/auth/logout` | Same — relative paths |

---

## 3. Environment Variables & Configuration

**Files:** `.env`, `netlify/functions/config.js`, various function files

### Environment Variable Availability:

| Variable | Local Mode Source | Server Mode Source |
|---|---|---|
| `RESEND_API_KEY` | `.env` (file) | Netlify UI → Environment variables |
| `OTP_FROM_EMAIL` | `.env` (file) | Netlify UI → Environment variables |
| `RAZORPAY_KEY_ID` | Must be in Netlify UI or `.env` | Netlify UI → Environment variables |
| `RAZORPAY_KEY_SECRET` | Must be in Netlify UI or `.env` | Netlify UI → Environment variables |
| `TURNSTILE_SITE_KEY` | Must be in Netlify UI or `.env` | Netlify UI → Environment variables |
| `TURNSTILE_SECRET_KEY` | Must be in Netlify UI or `.env` | Netlify UI → Environment variables |
| `SITE_ID` | **Not set** locally (unless using `netlify dev` with `--live`) | Always set by Netlify runtime |
| `OTP_SIGNING_SECRET` | `.env` | Netlify UI → Environment variables |
| `LAMBDA_TASK_ROOT` | **Not set** in `netlify dev` | Set in Lambda runtime |
| `AWS_EXECUTION_ENV` | **Not set** in `netlify dev` | Set in Lambda runtime |

### Key Risk:
- **`.env` is NOT loaded by Netlify Functions automatically.** The functions only read from `process.env`, which gets its values from Netlify's environment variable configuration.
- Locally, `netlify dev` does load `.env` files automatically for functions (Netlify CLI behavior).
- If you're running functions via `node server.js` (Express), the code does NOT use `dotenv` to load `.env` — so env vars that aren't already in the shell will be missing.
- The config endpoint (`/config`) returns public keys; locally it reads from `process.env` (populated by `netlify dev`'s `.env` loading); in production from Netlify's env vars.

### Config Endpoint Behavior:

**`netlify/functions/config.js`** returns:
```javascript
{
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || ''
}
```

If these env vars are missing (either locally or in production), the keys will be empty strings, causing the payment flow to immediately fail with "Payment system is not ready."

---

## 4. Razorpay Plan ID Resolution

**File:** `netlify/functions/donate-subscribe.js`, lines 29-48

```javascript
function isProductionHost(host) {
  const isProdEnv = process.env.IS_PRODUCTION === true
    || process.env.IS_PRODUCTION === 'true'
    || process.env.IS_PRODUCTION === '1';
  if (isProdEnv) return true;

  if (!host) return false;
  const h = host.split(':')[0].toLowerCase();
  return h === 'vazhai.in' || h === 'vazhaihtml.netlify.app';
}

function resolvePlanId(planId, host) {
  if (isProductionHost(host) && PRODUCTION_PLAN_MAP[planId]) {
    return PRODUCTION_PLAN_MAP[planId];
  }
  return planId;
}
```

### Difference:

| Mode | Host Detected | Plans Used |
|---|---|---|
| **Local** (`localhost:8888`) | `localhost` → not production | **Test mode plan IDs** (hardcoded starting with `plan_Sry...`) |
| **Netlify** (`vazhai.in`) | `vazhai.in` → production | **Production plan IDs** (mapped via `PRODUCTION_PLAN_MAP`) |
| **Netlify** (`vazhaihtml.netlify.app`) | `vazhaihtml.netlify.app` → production | **Production plan IDs** |
| **Override** (`IS_PRODUCTION=true`) | Any host | **Production plan IDs** |

### Detection Method:
- In production, the `Host` header (or `x-forwarded-host`) is used for detection
- Locally, `host` will be `localhost:8888` (or whatever port), so it always uses test plans
- The `IS_PRODUCTION` env var can override this behavior

### Impact:
- **Subscriptions created locally will use test/development Razorpay plans** that may not exist in a production Razorpay account
- This is intentional — test plans typically have different pricing or may not actually charge real money
- Plan IDs differ between test mode and production mode in Razorpay

---

## 5. Config Endpoint Fallback Chain

**File:** `js/donate.js`, lines 19-39

```javascript
async function loadDonConfig() {
  try {
    let res = await fetch('/.netlify/functions/config');
    if (!res.ok || /* not JSON */) {
      res = await fetch('/.netlify/functions/config-cors');
    }
    if (!res.ok || /* not JSON */) {
      const alt = `${location.protocol}//localhost:9999/.netlify/functions/config`;
      res = await fetch(alt);
    }
    const data = await res.json();
    rzpKeyId = data.razorpayKeyId;
    turnstileSiteKey = data.turnstileSiteKey;
  } catch (e) {
    console.error('[donation] Could not load config:', e);
  }
}
```

### Fallback Sequence:

| Order | URL | Used When |
|---|---|---|
| 1 | `/.netlify/functions/config` | Primary — works in both modes via netlify.toml redirects |
| 2 | `/.netlify/functions/config-cors` | Fallback if #1 fails — wraps the same config function but adds CORS headers |
| 3 | `http://localhost:9999/.netlify/functions/config` | **Local only** — hardcoded `localhost:9999` |

### Issue Warning:
- Step 3 falls back to **port 9999**, but step 2 in `apiUrl()` uses port **8888**
- These port numbers are inconsistent — if Netlify dev is running on 8888 (default), the fallback to 9999 will fail

---

## 6. DEV MODE Auto-fill in Donation Form

**File:** `js/donate.js`, lines 158-178

```javascript
const host = window.location.hostname;
if (host === 'localhost' || host === '127.0.0.1') {
  // Auto-fill donor fields with test data
  if (!document.getElementById('don-name').value) {
    document.getElementById('don-name').value    = 'Test Donor';
  }
  if (!document.getElementById('don-email').value) {
    document.getElementById('don-email').value   = 'test@example.com';
  }
  // ... and phone, address, PAN, comment
}
```

### Difference:

| Mode | Behavior |
|---|---|
| **Local** (localhost or 127.0.0.1) | Donor form is **auto-filled** with test data |
| **Production** (any other hostname) | No auto-fill — form starts empty |

This is purely a convenience feature for local testing. No functional difference.

---

## 7. CORS Headers

All function files define explicit `Access-Control-Allow-Origin: *` headers.

### Difference: None in behavior, but there's a `config-cors` wrapper

**`netlify/functions/config-cors.js`** is a wrapper around `config.js` that adds the same CORS headers already present in `config.js`. It exists only as a fallback (see §5 above) and is functionally identical.

### Environment Variable for Turnstile Remote IP:

```javascript
// donate-order.js and donate-subscribe.js
event.headers['client-ip'] || event.headers['x-forwarded-for'] || ''
```

- **In production:** Netlify populates `client-ip` and `x-forwarded-for` headers with the visitor's real IP
- **In local:** These headers may be missing or set to `127.0.0.1`

This only affects the `remoteip` parameter sent to Turnstile for verification, which is optional and advisory only.

---

## 8. Redirects & URL Rewrites

**File:** `netlify.toml`

### Auth Redirects (used in both modes):

| From | To | Status |
|---|---|---|
| `/auth/send-otp` | `/.netlify/functions/auth-send-otp` | 200 (internal rewrite) |
| `/auth/verify-otp` | `/.netlify/functions/auth-verify-otp` | 200 |
| `/auth/check` | `/.netlify/functions/auth-check` | 200 |
| `/auth/logout` | `/.netlify/functions/auth-logout` | 200 |
| `/auth/admin` | `/.netlify/functions/auth-admin` | 200 |

### Donate Redirects (used in both modes):

| From | To | Status |
|---|---|---|
| `/donate/order` | `/.netlify/functions/donate-order` | 200 |
| `/donate/verify` | `/.netlify/functions/donate-verify` | 200 |
| `/donate/subscribe` | `/.netlify/functions/donate-subscribe` | 200 |
| `/donate/verify-subscription` | `/.netlify/functions/donate-verify-subscription` | 200 |

### Clean URL Redirects:

| From | To | Status |
|---|---|---|
| `/who-we-are` | `/who-we-are.html` | 200 |
| `/what-we-do` | `/what-we-do.html` | 200 |
| `/join` | `/join.html` | 200 |
| `/donate` | `/donate.html` | 200 |
| `/contact` | `/contact.html` | 200 |
| `/events` | `/events.html` | 200 |
| `/login` | `/login.html` | 200 |
| `/dashboard` | `/dashboard/user.html` | 200 |
| `/dashboard/manage` | `/dashboard/manage.html` | 200 |

### Difference:

| Aspect | Local Mode | Server Mode |
|---|---|---|
| netlify.toml redirects | Processed by `netlify dev` (emulated) | Processed by Netlify Edge/CDN |
| Auth function redirects | ✅ Work correctly | ✅ Work correctly |
| Auth JS file calls `/auth/*` | Resolved via netlify.toml | Resolved via netlify.toml |
| Donate JS file calls | **Bypasses** netlify.toml (uses `apiUrl()` with direct Lambda URL) | Goes through netlify.toml redirects |
| Clean URLs (`.html` → `/path`) | ✅ Work correctly | ✅ Work correctly |

### Important Note:
The auth-related API calls in the frontend JS use **relative paths** (`/auth/send-otp`, etc.) and rely on netlify.toml redirects in both modes. The donate-related calls use **relative paths in production** but **direct function URLs** locally via the `apiUrl()` helper.

---

## 9. File System Access

**File:** `netlify/functions/auth-store.js`

| Operation | Local Mode | Server Mode |
|---|---|---|
| Read `.netlify/state.json` | ✅ Works (file exists) | ❌ File doesn't exist |
| Write `.local-auth-store.json` | ❌ No longer used — removed | ❌ No longer used — removed |
| `require('@netlify/blobs')` | ✅ Loaded from `node_modules` | ✅ Available in runtime |

### Lambda Filesystem Constraints:
- **Not relevant anymore** — the file-backed fallback has been removed. All storage goes through Netlify Blobs, which doesn't use the Lambda filesystem.
- The only remaining filesystem access is reading `.netlify/state.json` (local dev only) to discover blob credentials.

---

## 10. Email Sending (Resend)

**File:** `netlify/functions/auth-send-otp.js`

### Difference: None in code behavior

The OTP email sending works identically in both modes — it always calls the Resend API.

### Practical Difference:

| Aspect | Local Mode | Server Mode |
|---|---|---|
| `RESEND_API_KEY` source | `.env` file (loaded by `netlify dev`) | Netlify Environment Variables |
| `OTP_FROM_EMAIL` | `onboarding@resend.dev` (from `.env`) | Configurable in Netlify UI |
| Email delivery | ✅ Works if `RESEND_API_KEY` is valid | ✅ Works |

However, the `.env` file uses `onboarding@resend.dev` as the sender, which is Resend's test sender address — emails sent from this address will always show "Sent via Resend" branding and may not look professional. In production, a verified domain should be used.

---

## 11. Summary Table

| # | Area | Local Mode | Server Mode | ✅ Same? |
|---|---|---|---|---|
| 1 | **Session Storage** | Netlify Blobs only | Netlify Blobs only | ✅ **Identical** — same backend in both modes |
| 2 | **Donate API URLs** | `http://localhost:8888/.netlify/functions/donate-*` | Relative `/donate/order`, etc. via redirects | ⚠️ **Different routing** |
| 3 | **Auth API URLs** | Relative paths `/auth/*` via redirects | Same — relative paths via redirects | ✅ Same |
| 4 | **Env vars** | `.env` (loaded by `netlify dev`) | Netlify UI Environment Variables | ✅ Same values expected |
| 5 | **SITE_ID** | Not set locally | Always set | ⚠️ **Different** (affects credential discovery path only) |
| 6 | **Razorpay plans** | Test mode plan IDs | Production plan IDs (host-based switching) | ⚠️ **Intentionally different** |
| 7 | **Donor form auto-fill** | Auto-filled with test data | Empty form | ⚠️ **Different UX** (intentional for dev) |
| 8 | **Config fallback C** | `localhost:9999` fallback exists | Never hit | ⚠️ **Exists locally only** |
| 9 | **config-cors wrapper** | Available as fallback | Available as fallback | ✅ Same |
| 10 | **Turnstile remote IP** | `127.0.0.1` or missing | Visitor's real IP | ⚠️ **Different IP** (advisory only) |
| 11 | **File system writes** | ✅ Only reads `.netlify/state.json` | ❌ No writes needed | ✅ **Not used for storage** |
| 12 | **OTP email delivery** | Via Resend with `.env` key | Via Resend with Netlify env var | ✅ Same mechanism |
| 13 | **Session duration** | 30 days (same code) | 30 days (same code) | ✅ Same |
| 14 | **CORS headers** | `Access-Control-Allow-Origin: *` | `Access-Control-Allow-Origin: *` | ✅ Same |
| 15 | **`netlify dev` blob emulation** | Attempted via siteID-only | Not applicable | ⚠️ Local-only feature |

---

## Key Risks & Gotchas

1. **Port mismatch in donate.js**: `apiUrl()` uses port `8888` but the config fallback at line 29 uses port `9999`. If `netlify dev` is run on a non-default port, the config endpoint may load correctly but all donate API calls will fail.

2. **Blob data isolation**: Sessions and OTP data created locally are NOT accessible in production, and vice versa. This is expected — they are different blob stores under different site IDs.

3. **`.local-auth-store.json` no longer used**: The file-backed fallback has been removed. If you had existing data in this file, it will not be migrated. You'll need to re-create sessions (log in again) after this change.

4. **Plan ID detection depends on Host header**: The `isProductionHost()` function in `donate-subscribe.js` depends on the `Host` header. If running behind a reverse proxy or custom domain locally, plan detection may behave unexpectedly.

5. **`.env` is git-committed by accident?** Check `.gitignore` — if `.env` is tracked, production secrets would be exposed. (The current `.env` contains a Resend API key.)