const form = document.querySelector('.waitlist-form');
const status = document.querySelector('.form-status');
const button = document.querySelector('.form-button');

function setStatus(message, type) {
  status.textContent = message;
  status.className = `form-status ${type || ''}`.trim();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const payload = {
    firstName: String(data.get('firstName') || '').trim(),
    email: String(data.get('email') || '').trim(),
    tillerUser: String(data.get('tillerUser') || 'prefer-not-to-say'),
  };

  if (!payload.firstName) {
    setStatus('Please enter your first name.', 'error');
    form.elements.firstName.focus();
    return;
  }

  if (!form.elements.email.validity.valid) {
    setStatus('Please enter a valid email address.', 'error');
    form.elements.email.focus();
    return;
  }

  button.disabled = true;
  button.textContent = 'Joining...';
  setStatus('Saving your spot...', '');

  try {
    const response = await fetch('/api/waitlist', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const result = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : {};

    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        throw new Error('Beta signup is moving to Airtable. Please check back soon.');
      }

      throw new Error(result.message || 'Please check the form and try again.');
    }

    form.reset();
    setStatus('You are on the beta list. Thank you for joining Penny early.', 'success');
  } catch (error) {
    setStatus(error.message || 'Something went wrong. Please try again.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Join beta';
  }
});
