const { getStore, ADMIN_EMAILS } = require('./auth-store');

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function dateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function readOptions(params = {}, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const end = dateValue(params.dateTo || today);
  const defaultStart = end && new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  const start = dateValue(params.dateFrom || (defaultStart && defaultStart.toISOString().slice(0, 10)));
  const category = params.category || 'all';
  const minMonths = Number(params.minMonths || 3);
  if (!start || !end || start > end) throw new Error('Choose valid dates with the start on or before the end.');
  if (!['all', 'frequent', 'non-frequent'].includes(category)) throw new Error('Invalid donor category.');
  if (!Number.isInteger(minMonths) || minMonths < 2 || minMonths > 12) throw new Error('Frequent donor threshold must be between 2 and 12 months.');
  const months = [];
  for (let month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); month <= end; month.setUTCMonth(month.getUTCMonth() + 1)) {
    months.push(month.toISOString().slice(0, 7));
    if (months.length > 120) throw new Error('Choose a date range of no more than 10 years.');
  }
  return {
    dateFrom: start.toISOString().slice(0, 10), dateTo: end.toISOString().slice(0, 10),
    frequencyFrom: new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1)).toISOString().slice(0, 10),
    category, minMonths, months, search: String(params.search || '').trim().toLowerCase(),
  };
}

function paymentDay(payment) {
  if (dateValue(payment.paymentDate)) return payment.paymentDate;
  for (const rawDate of [payment.paymentDate, payment.createdAtDate, payment.createdAt ? Number(payment.createdAt) * 1000 : null]) {
    if (!rawDate) continue;
    const date = new Date(rawDate);
    if (!Number.isFinite(date.getTime())) continue;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  }
  return null;
}

function aggregatePayments(payments, options) {
  const byDonor = new Map();
  for (const payment of payments) {
    if (!payment || payment.status !== 'captured' || (payment.currency && payment.currency !== 'INR')) continue;
    const amount = Math.round(Number(payment.amount) * 100);
    const day = paymentDay(payment);
    if (!Number.isFinite(amount) || amount <= 0 || !day || day > options.dateTo) continue;
    const email = String(payment.email || payment.donorEmail || '').trim().toLowerCase();
    const phone = String(payment.contact || payment.donorPhone || '').replace(/\D/g, '');
    const id = email || (phone ? 'phone:' + phone : 'payment:' + (payment.paymentId || payment.id));
    if (id === 'payment:undefined') continue;
    if (!byDonor.has(id)) byDonor.set(id, {
      id, email, name: String(payment.donorName || email || phone || 'Unknown donor').trim(),
      amounts: {}, totalPaise: 0, frequencyMonths: new Set(), lastDonation: day,
    });
    const donor = byDonor.get(id);
    if (day > donor.lastDonation) {
      donor.lastDonation = day;
      if (payment.donorName) donor.name = String(payment.donorName).trim();
    }
    const month = day.slice(0, 7);
    if (day >= options.frequencyFrom) donor.frequencyMonths.add(month);
    if (day >= options.dateFrom) {
      donor.amounts[month] = (donor.amounts[month] || 0) + amount;
      donor.totalPaise += amount;
    }
  }
  return [...byDonor.values()].map(donor => ({
    id: donor.id, email: donor.email, name: donor.name, lastDonation: donor.lastDonation,
    category: donor.frequencyMonths.size >= options.minMonths ? 'frequent' : 'non-frequent',
    activeMonths: donor.frequencyMonths.size,
    amounts: Object.fromEntries(Object.entries(donor.amounts).map(([month, amount]) => [month, amount / 100])),
    total: donor.totalPaise / 100,
  }));
}

async function handle(event, storeProvider = getStore) {
  const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
  if (event.httpMethod !== 'GET') return reply(405, { error: 'Method not allowed' });
  try {
    const store = await storeProvider(event);
    const headers = event.headers || {};
    const token = (headers.cookie || '').match(/vazhai_session=([^;]+)/)?.[1] ||
      ((headers.authorization || '').startsWith('Bearer ') ? headers.authorization.slice(7) : null);
    const session = token && await store.get('session:' + token, { type: 'json' });
    if (!session || !Number.isFinite(session.expiresAt) || Date.now() > session.expiresAt) return reply(401, { error: 'Unauthorized' });
    if (!ADMIN_EMAILS.includes(session.email)) return reply(403, { error: 'System admin access required' });
    let options;
    try { options = readOptions(event.queryStringParameters); }
    catch (error) { return reply(400, { error: error.message }); }
    const ids = await store.get('payments:list', { type: 'json' }) || [];
    const payments = [];
    for (let offset = 0; offset < ids.length; offset += 25) {
      const batch = await Promise.all([...new Set(ids.slice(offset, offset + 25))].map(id => store.get('payment:' + id, { type: 'json' })));
      payments.push(...batch);
    }
    const donors = aggregatePayments(payments, options).filter(donor => options.category === 'all' || donor.category === options.category);
    for (let offset = 0; offset < donors.length; offset += 25) {
      await Promise.all(donors.slice(offset, offset + 25).map(async donor => {
        if (!donor.email) return;
        const user = await store.get('user:' + donor.email, { type: 'json' });
        if (user?.name?.trim()) donor.name = user.name.trim();
      }));
    }
    const selected = donors.filter(donor => !options.search || (donor.name + ' ' + donor.email).toLowerCase().includes(options.search));
    selected.sort((first, second) => first.name.localeCompare(second.name) || first.id.localeCompare(second.id));
    const totals = Object.fromEntries(options.months.map(month => [month,
      selected.reduce((sum, donor) => sum + Math.round((donor.amounts[month] || 0) * 100), 0) / 100,
    ]));
    return reply(200, {
      success: true, ...options, donors: selected, totals,
      total: selected.reduce((sum, donor) => sum + Math.round(donor.total * 100), 0) / 100,
    });
  } catch (error) {
    console.error('[donor-monthly]', error.message);
    return reply(500, { error: 'Could not load donor donations. Please try again.' });
  }
}

exports.handler = event => handle(event);
exports.handle = handle;
exports.readOptions = readOptions;
exports.aggregatePayments = aggregatePayments;