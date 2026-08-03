// Netlify Function: GET /donor-wall
// Public: Returns sanitized donor info for the rolling donor ticker.
// Reads the pre-built 'donor-wall' blob (built by admin via /donor-wall/build)
// and merges in manually-added donors (stored in 'donor-wall-manual' blob).
// NEVER returns: email, phone, PAN, address, or payment IDs.
// Returns totalAmount only for client-side ordering — the UI never displays it.
const { getStore } = require('./auth-store');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const store = await getStore(event);

    // Read the pre-built donor wall blob
    const wall = await store.get('donor-wall', { type: 'json' });

    // Read manually-added donors (persist forever)
    const manualObj = await store.get('donor-wall-manual', { type: 'json' });
    const manualDonors = (manualObj && Array.isArray(manualObj.donors)) ? manualObj.donors : [];

    const builtDonors = (wall && Array.isArray(wall.donors)) ? wall.donors : [];

    // Merge: built donors + manual donors
    const allDonors = [...builtDonors, ...manualDonors];

    if (allDonors.length === 0) {
      // No donors at all — return empty so the ticker shows its fallback
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' },
        body: JSON.stringify({ updated: wall ? wall.updated : null, donors: [] }),
      };
    }

    // Strip sensitive/admin-only fields from every donor entry.
    // Public UI sees: name, message, month, and totalAmount (used only for
    // client-side sorting — the UI never displays the amount itself).
    const publicDonors = allDonors
      .filter(d => d && d.name)               // never expose nameless entries
      .map(d => {
        const entry = { name: d.name };
        if (d.message && d.message.trim()) entry.message = d.message.trim();
        if (d.month && d.month.trim()) entry.month = d.month.trim();
        if (d.totalAmount) entry.totalAmount = d.totalAmount;
        return entry;
      });

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({
        updated: wall ? wall.updated : null,
        donors: publicDonors,
      }),
    };
  } catch (err) {
    console.error('[/donor-wall] Error:', err.message);
    // Fail soft — public page should never error because of this
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({ updated: null, donors: [], error: 'Donor wall unavailable' }),
    };
  }
};