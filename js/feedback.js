(function () {
  const feedbackEndpoint = '/.netlify/functions/feedback';
  const form = document.getElementById('feedback-form');
  const identityInputs = document.querySelectorAll('input[name="identity"]');
  const guestDetails = document.getElementById('guest-details');
  const loginNote = document.getElementById('feedback-login');
  const loginLink = document.getElementById('feedback-login-link');
  const status = document.getElementById('feedback-status');
  const submit = document.getElementById('feedback-submit');
  let auth = { authenticated: false };

  function selectedIdentity() {
    const selected = document.querySelector('input[name="identity"]:checked');
    return selected ? selected.value : 'anonymous';
  }

  function updateIdentityFields() {
    const identity = selectedIdentity();
    guestDetails.hidden = identity !== 'guest';
    loginNote.style.display = identity === 'authenticated' && !auth.authenticated ? 'block' : 'none';
    submit.disabled = identity === 'authenticated' && !auth.authenticated;
  }

  function showStatus(message, type) {
    status.textContent = message;
    status.className = `feedback-status ${type}`;
  }

  async function readResponse(response) {
    const raw = await response.text();
    try {
      return JSON.parse(raw);
    } catch (_) {
      throw new Error(raw || `Request failed with status ${response.status}.`);
    }
  }

  async function checkAuth() {
    try {
      const token = localStorage.getItem('vazhai_session');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch('/auth/check', { headers });
      auth = await response.json();
      if (auth.authenticated) {
        loginNote.textContent = `Submitting as ${auth.name || auth.email}.`;
        loginNote.style.display = selectedIdentity() === 'authenticated' ? 'block' : 'none';
        loginLink.style.display = 'none';
      }
    } catch (error) {
      console.error('Feedback auth check failed', error);
    }
    updateIdentityFields();
  }

  identityInputs.forEach(input => input.addEventListener('change', updateIdentityFields));

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const identityType = selectedIdentity();
    const message = document.getElementById('feedback-message').value.trim();
    const name = document.getElementById('feedback-name').value.trim();
    const email = document.getElementById('feedback-email').value.trim();

    if (!message) return showStatus('Please write your feedback before sending.', 'error');
    if (identityType === 'authenticated' && !auth.authenticated) {
      return showStatus('Please log in first or choose another submission option.', 'error');
    }
    if (identityType === 'guest' && (!name || !email)) {
      return showStatus('Please provide both your name and email.', 'error');
    }

    submit.disabled = true;
    submit.textContent = 'Sending...';
    status.className = 'feedback-status';

    try {
      const token = localStorage.getItem('vazhai_session');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(feedbackEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          category: document.getElementById('feedback-category').value,
          message,
          identityType,
          name: identityType === 'guest' ? name : undefined,
          email: identityType === 'guest' ? email : undefined,
          pageUrl: document.referrer || window.location.pathname,
        }),
      });
      const result = await readResponse(response);
      if (!response.ok) throw new Error(result.error || 'Unable to submit feedback.');
      form.reset();
      showStatus(result.message, 'success');
      updateIdentityFields();
    } catch (error) {
      showStatus(error.message, 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send Feedback';
      updateIdentityFields();
    }
  });

  checkAuth();
})();
