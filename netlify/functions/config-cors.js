const original = require('./config');

// Wrapper that delegates to the existing config function and ensures CORS headers
exports.handler = async function(event, context) {
  const result = await original.handler(event, context);
  // Ensure headers object exists
  result.headers = Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  }, result.headers || {});
  return result;
};

