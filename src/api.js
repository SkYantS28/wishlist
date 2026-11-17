let csrfToken = '';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function responseJson(response) {
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || 'Não foi possível concluir a operação.', response.status);
  if (body.csrfToken) csrfToken = body.csrfToken;
  return body;
}

export async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!csrfToken) {
      const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      const csrf = await responseJson(csrfResponse);
      csrfToken = csrf.csrfToken;
    }
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(`/api${path}`, {
    ...options,
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return responseJson(response);
}

export async function uploadAvatar(file) {
  if (!csrfToken) {
    const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    const csrf = await responseJson(csrfResponse);
    csrfToken = csrf.csrfToken;
  }
  const formData = new FormData();
  formData.append('avatar', file);
  const response = await fetch('/api/me/avatar', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
    credentials: 'same-origin',
    body: formData,
  });
  return responseJson(response);
}
