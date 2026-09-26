'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const err = document.getElementById('login-error');
  if (!form) return;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;

    const username = form.username.value;
    const password = form.password.value;

    const res = await api.postForm('/login', { username, password });

    if (res.status === 429) {
      const data = await res.json();
      const minutes = Math.ceil(data.retryAfterSeconds / 60);
      err.textContent =
        'Trop de tentatives. Réessayez dans ' + minutes + ' min.';
      err.hidden = false;
      return;
    }
    if (res.status === 401) {
      err.textContent = 'Identifiants invalides.';
      err.hidden = false;
      return;
    }

    window.location.href = '/';
  });
});