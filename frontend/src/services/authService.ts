import api, { clearAuthSession, hasBrowserSession, setAuthSession, setBosLocalSessionToken, setCsrfToken } from './api';
import type { User } from '../types';

export { hasBrowserSession };

export interface SetupStatusResponse {
  configured: boolean;
}

export interface LoginResponse {
  user: User;
  browser_session: string;
  csrf_token: string;
  local_session_token?: string | null;
}

export interface CurrentSessionResponse {
  user: User;
  csrf_token: string;
  local_session_token?: string | null;
}

export interface CreateUserPayload {
  username: string;
  display_name: string;
  password: string;
  role: 'admin' | 'operator' | 'viewer';
  is_active?: boolean;
}

export interface UpdateUserPayload {
  display_name?: string;
  role?: string;
  is_active?: boolean;
}

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  const { data } = await api.get<SetupStatusResponse>('/auth/setup-status');
  return data;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', { username, password });
  setAuthSession(data.browser_session, data.csrf_token);
  setBosLocalSessionToken(data.local_session_token || '');
  return data;
}

export async function getCurrentSession(): Promise<CurrentSessionResponse> {
  const { data } = await api.get<CurrentSessionResponse>('/auth/me');
  setCsrfToken(data.csrf_token);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    clearAuthSession({ broadcast: true, notify: true });
  }
}

export async function listUsers(): Promise<User[]> {
  const { data } = await api.get<User[]>('/auth/users');
  return data;
}

export async function createUser(payload: CreateUserPayload): Promise<User> {
  const { data } = await api.post<User>('/auth/users', payload);
  return data;
}

export async function updateUser(userId: User['id'], payload: UpdateUserPayload): Promise<User> {
  const { data } = await api.patch<User>(`/auth/users/${userId}`, payload);
  return data;
}

export async function resetUserPassword(userId: User['id'], password: string): Promise<unknown> {
  const { data } = await api.post(`/auth/users/${userId}/reset-password`, { password });
  return data;
}

export async function revokeUserSessions(userId: User['id']): Promise<unknown> {
  const { data } = await api.post(`/auth/users/${userId}/revoke-sessions`);
  return data;
}
