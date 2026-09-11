import api, { clearAuthSession, hasBrowserSession, setAuthSession, setBosLocalSessionToken, setCsrfToken } from './api';

export { hasBrowserSession };

export async function getSetupStatus() {
  const { data } = await api.get('/auth/setup-status');
  return data;
}

export async function login(username, password) {
  const { data } = await api.post('/auth/login', { username, password });
  setAuthSession(data.browser_session, data.csrf_token);
  setBosLocalSessionToken(data.local_session_token || '');
  return data;
}

export async function getCurrentSession() {
  const { data } = await api.get('/auth/me');
  setCsrfToken(data.csrf_token);
  return data;
}

export async function logout() {
  try {
    await api.post('/auth/logout');
  } finally {
    clearAuthSession({ broadcast: true, notify: true });
  }
}

export async function listUsers() {
  const { data } = await api.get('/auth/users');
  return data;
}

export async function createUser(payload) {
  const { data } = await api.post('/auth/users', payload);
  return data;
}

export async function updateUser(userId, payload) {
  const { data } = await api.patch(`/auth/users/${userId}`, payload);
  return data;
}

export async function resetUserPassword(userId, password) {
  const { data } = await api.post(`/auth/users/${userId}/reset-password`, { password });
  return data;
}

export async function revokeUserSessions(userId) {
  const { data } = await api.post(`/auth/users/${userId}/revoke-sessions`);
  return data;
}
