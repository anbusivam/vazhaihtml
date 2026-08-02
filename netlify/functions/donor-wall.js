// Netlify Function: GET /donor-wall
// Public: Returns sanitized donor info for the rolling donor ticker.
// Reads the pre-built 'donor-wall' blob (built by admin via /donor-wall/build).
// NEVER returns: email, phone, PAN, address, payment IDs, or total amounts.
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

    if (!wall || !Array.isArray(wall.donors)) {
      // No wall built yet — return empty so the ticker shows its fallback
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' },
        body: JSON.stringify({ updated: null, donors: [] }),
      };
    }

    // Strip sensitive/admin-only fields from every donor entry
    // Public UI only sees: name, message, month
    const publicDonors = (wall.donors || [])
      .filter(d => d && d.name)               // never expose nameless entries
      .map(d => {
        const entry = { name: d.name };
        if (d.message && d.message.trim()) entry.message = d.message.trim();
        if (d.month && d.month.trim()) entry.month = d.month.trim();
        return entry;
      });

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({
        updated: wall.updated || null,
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