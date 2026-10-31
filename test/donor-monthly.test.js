const test = require('node:test');
const assert = require('node:assert/strict');
const { readOptions, aggregatePayments, handle } = require('../netlify/functions/donor-monthly');
const { ADMIN_EMAILS } = require('../netlify/functions/auth-store');

function payment(email, paymentDate, amount = 100, extra = {}) {
  return { email, paymentDate, amount, status: 'captured', ...extra };
}

test('default range contains the current and previous eleven months in India', () => {
  const options = readOptions({}, new Date('2026-10-31T20:00:00Z'));
  assert.equal(options.dateFrom, '2025-12-01');
  assert.equal(options.dateTo, '2026-11-01');
  assert.equal(options.months.length, 12);
});

test('invalid dates, reversed ranges, excessive ranges and invalid categories are rejected', () => {
  for (const params of [
    { dateFrom: '2026-02-30' }, { dateFrom: 'oops' },
    { dateFrom: '2026-11-01', dateTo: '2026-10-01' },
    { dateFrom: '2000-01-01' }, { category: 'monthly' }, { minMonths: '1' },
  ]) assert.throws(() => readOptions(params));
});

test('matrix sums captured payments, keeps zero-payment donors and classifies distinct months', () => {
  const options = readOptions({ dateFrom: '2026-09-10', dateTo: '2026-10-20' });
  const donors = aggregatePayments([
    payment(' A@example.com ', '2026-08-02'),
    payment('a@example.com', '2026-09-01'),
    payment('a@example.com', '2026-09-10', '100.10'),
    payment('a@example.com', '2026-09-10', '200.20'),
    payment('a@example.com', '2026-10-20', 400),
    payment('a@example.com', '2026-10-21', 800),
    payment('a@example.com', '2026-10-10', 900, { status: 'failed' }),
    payment('a@example.com', '2026-10-10', 900, { currency: 'USD' }),
    payment('annual@example.com', '2025-11-01', 12000),
    payment('one@example.com', '2026-09-12'), payment('one@example.com', '2026-09-14'),
  ], options);
  const donor = donors.find(item => item.email === 'a@example.com');
  assert.deepEqual(donor.amounts, { '2026-09': 300.3, '2026-10': 400 });
  assert.equal(donor.total, 700.3);
  assert.equal(donor.category, 'frequent');
  assert.equal(donors.find(item => item.email === 'annual@example.com').total, 0);
  assert.equal(donors.find(item => item.email === 'one@example.com').category, 'non-frequent');
});

test('timestamp dates use India time and paymentDate overrides creation time', () => {
  const options = readOptions({ dateFrom: '2026-10-01', dateTo: '2026-11-02' });
  const donors = aggregatePayments([
    payment('a@example.com', null, 100, { createdAt: Date.parse('2026-10-31T20:00:00Z') / 1000 }),
    payment('a@example.com', '2026-10-03', 50, { createdAtDate: '2026-11-02T00:00:00Z' }),
  ], options);
  assert.deepEqual(donors[0].amounts, { '2026-11': 100, '2026-10': 50 });
});

test('backend enforces authorization and filters donors before returning totals', async () => {
  const records = {
    'session:admin': { email: ADMIN_EMAILS[0], expiresAt: Date.now() + 60000 },
    'session:user': { email: 'other@example.com', expiresAt: Date.now() + 60000 },
    'session:expired': { email: ADMIN_EMAILS[0], expiresAt: 1 },
    'payments:list': ['first', 'second', 'third', 'occasional'],
    'payment:first': payment('a@example.com', '2026-08-01'),
    'payment:second': payment('a@example.com', '2026-09-01'),
    'payment:third': payment('a@example.com', '2026-10-01'),
    'payment:occasional': payment('b@example.com', '2026-10-01', 500),
    'user:a@example.com': { name: 'Profile Name' },
  };
  const provider = async () => ({ get: async key => records[key] || null });
  const event = { httpMethod: 'GET', headers: {}, queryStringParameters: { dateFrom: '2026-08-01', dateTo: '2026-10-31', category: 'frequent' } };
  assert.equal((await handle(event, provider)).statusCode, 401);
  for (const [token, expected] of [['user', 403], ['expired', 401]]) {
    assert.equal((await handle({ ...event, headers: { authorization: 'Bearer ' + token } }, provider)).statusCode, expected);
  }
  const response = await handle({ ...event, headers: { cookie: 'vazhai_session=admin' } }, provider);
  assert.equal(response.statusCode, 200);
  const data = JSON.parse(response.body);
  assert.equal(data.donors.length, 1);
  assert.equal(data.donors[0].name, 'Profile Name');
  assert.equal(data.total, 300);
  assert.deepEqual(data.totals, { '2026-08': 100, '2026-09': 100, '2026-10': 100 });
  const invalid = await handle({ ...event, headers: { authorization: 'Bearer admin' }, queryStringParameters: { dateFrom: 'invalid' } }, provider);
  assert.equal(invalid.statusCode, 400);
});