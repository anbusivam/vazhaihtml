// Shared auth helper for blog functions
const { getStore } = require('./auth-store');
const { ADMIN_EMAILS } = require('./auth-store');

async function getSession(store, event) {
  const cookies = event.headers['cookie'] || '';
  const authHeader = event.headers['authorization'] || '';

  let token = null;
  const match = cookies.match(/vazhai_session=([^;]+)/);
  if (match) token = match[1];
  if (!token && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
  if (!token) return null;

  const session = await store.get(`session:${token}`, { type: 'json' });
  if (!session || Date.now() > session.expiresAt) return null;
  return session;
}

async function getUserRoles(store, email) {
  const userData = await store.get(`user:${email}`, { type: 'json' });
  let roles = [];
  if (userData) {
    if (Array.isArray(userData.roles)) {
      roles = userData.roles;
    } else if (userData.role) {
      roles = [userData.role];
    }
  }
  if (ADMIN_EMAILS.includes(email) && !roles.includes('admin')) {
    roles = [...roles, 'admin'];
  }
  return roles;
}

async function requireBloggerOrAdmin(store, event) {
  const session = await getSession(store, event);
  if (!session) return { authorized: false, error: 'Unauthorized', status: 401 };
  const roles = await getUserRoles(store, session.email);
  const isBlogger = roles.includes('blogger') || roles.includes('admin');
  if (!isBlogger) return { authorized: false, error: 'Forbidden: blogger or admin access required', status: 403 };
  return { authorized: true, session, roles, email: session.email };
}

async function requireAnyAuthenticated(store, event) {
  const session = await getSession(store, event);
  if (!session) return { authorized: false, error: 'Unauthorized', status: 401 };
  const roles = await getUserRoles(store, session.email);
  return { authorized: true, session, roles, email: session.email };
}

function corsHeaders(extraMethods) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': `GET, POST, PUT, DELETE, OPTIONS${extraMethods ? ', ' + extraMethods : ''}`,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function handleOptions(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  return null;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = { getSession, getUserRoles, requireBloggerOrAdmin, requireAnyAuthenticated, corsHeaders, handleOptions, CORS_HEADERS };
