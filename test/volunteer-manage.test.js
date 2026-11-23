const test = require('node:test');
const assert = require('node:assert/strict');
const { handle } = require('../netlify/functions/volunteer-manage');

function createStores(user, email = 'person@example.com') {
  const authData = {
    'session:valid': { email, expiresAt: Date.now() + 60_000 },
    [`user:${email}`]: user,
  };
  const volunteerData = {
    'volunteers:list': ['VOL-2026-0001'],
    'volunteer:VOL-2026-0001': {
      id: 'VOL-2026-0001',
      name: 'Test Volunteer',
      email: 'volunteer@example.com',
      status: 'new',
      notes: 'Internal follow-up',
      whatsappToken: 'private-token',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };
  const authStore = { get: async key => authData[key] || null };
  const volunteerStore = {
    get: async key => volunteerData[key] || null,
    setJSON: async (key, value) => { volunteerData[key] = value; },
    delete: async key => { delete volunteerData[key]; },
  };
  return {
    authStoreProvider: async () => authStore,
    volunteerStoreProvider: async () => volunteerStore,
    volunteerData,
  };
}

function event(method, token = 'valid', body = undefined) {
  return {
    httpMethod: method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

test('newvolunteermgmt can view registrations but not private notes or registration tokens', async () => {
  const stores = createStores({ roles: ['newvolunteermgmt'] });
  const response = await handle(event('GET'), stores.authStoreProvider, stores.volunteerStoreProvider);
  assert.equal(response.statusCode, 200);
  const [record] = JSON.parse(response.body).volunteers;
  assert.equal(record.name, 'Test Volunteer');
  assert.equal('notes' in record, false);
  assert.equal('whatsappToken' in record, false);
});

test('newvolunteermgmt cannot update or delete registrations', async () => {
  const stores = createStores({ roles: ['newvolunteermgmt'] });
  const response = await handle(
    event('POST', 'valid', { action: 'delete', id: 'VOL-2026-0001' }),
    stores.authStoreProvider,
    stores.volunteerStoreProvider,
  );
  assert.equal(response.statusCode, 403);
  assert.ok(stores.volunteerData['volunteer:VOL-2026-0001']);
});

test('users without the volunteer management role cannot view registrations', async () => {
  const stores = createStores({ roles: ['volunteer'] });
  const response = await handle(event('GET'), stores.authStoreProvider, stores.volunteerStoreProvider);
  assert.equal(response.statusCode, 403);
});

test('admins can still update registrations and retain access to admin notes', async () => {
  const stores = createStores({ roles: ['admin'] });
  const response = await handle(event('GET'), stores.authStoreProvider, stores.volunteerStoreProvider);
  assert.equal(response.statusCode, 200);
  const [record] = JSON.parse(response.body).volunteers;
  assert.equal(record.notes, 'Internal follow-up');
  assert.equal('whatsappToken' in record, false);

  const update = await handle(
    event('POST', 'valid', { action: 'update', id: record.id, status: 'contacted' }),
    stores.authStoreProvider,
    stores.volunteerStoreProvider,
  );
  assert.equal(update.statusCode, 200);
  assert.equal(stores.volunteerData[`volunteer:${record.id}`].status, 'contacted');
});
