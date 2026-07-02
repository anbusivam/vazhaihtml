✅ Backup & Restore functionality implemented. Here's what was created/modified:

**1. New file: `netlify/functions/blob-backup.js`** (Netlify Serverless Function)
- `GET /razorpay/blob-backup` — Exports ALL blob data as JSON:
  - All users (users:list + each user:{email} profile)
  - All payments (payments:list + each payment:{paymentId} record)
  - Receipt mappings (receipts:map)
  - Thank letter template
  - Blog posts and comments (from blog store)
  - Returns stats about the exported data
- `POST /razorpay/blob-backup` — Restores blob data from a JSON payload:
  - Accepts `data` (object) or `base64` (base64 string)
  - Restores all the above data stores
  - Returns details of what was restored
- **Security**: Only hardcoded system admins (`anbusivam@gmail.com`, `vazhai.connect@gmail.com`) can access
- Session data is NOT exported (for security — users need to re-login after restore)

**2. Modified: `dashboard/manage.html`**
- **New UI card** "💾 Backup & Restore" — visible only to hardcoded system admins
- **Export Backup button**: Fetches all data from server and downloads as `vazhai-blob-backup-YYYY-MM-DD.json`
- **Restore from File button**: Opens file picker for `.json` backup files
- **Safety auto-backup before restore**: When restoring, the system FIRST downloads a safety backup named `vazhai-auto-backup-before-restore-YYYY-MM-DD-HH-MM-SS.json` before sending the restore to server
- **Confirmation dialog**: Shows detailed stats about the backup file and warns about overwriting data
- **Detailed results**: After restore, shows what was restored (users, payments, blogs, etc.) with any errors

**3. Modified: `netlify.toml`**
- Added redirect: `/razorpay/blob-backup` → `/.netlify/functions/blob-backup`

**Data integrity**: All data is serialized/deserialized using JSON — the native storage format of Netlify Blobs. No type conversion issues because all stored data is already JSON-compatible. The export produces a clean, human-readable JSON file that can be inspected before restore.