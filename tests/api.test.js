import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('authenticated wishlist API enforces access, feed, and reservation rules', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
  const accounts = [
    { email: `owner-${suffix}@example.test`, username: `owner_${suffix}` },
    { email: `guest-${suffix}@example.test`, username: `guest_${suffix}` },
    { email: `other-${suffix}@example.test`, username: `other_${suffix}` },
  ];
  const port = await getAvailablePort();
  const server = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: randomBytes(32).toString('hex'),
      NODE_ENV: 'test',
      PREVIEW_ALLOWED_HOSTS: 'amazon.com.br',
      SMTP_HOST: '',
      SMTP_FROM: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      PORT: String(port),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let serverError = '';
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', (chunk) => { serverError += chunk; });

  try {
    await waitForApi(server, port, () => serverError);
    const owner = new ApiClient(port);
    const guest = new ApiClient(port);
    const other = new ApiClient(port);

    const registration = await owner.register(accounts[0]);
    assert.equal(registration.status, 201);
    assert.equal(registration.value.user.email, undefined);
    assert.equal((await fetch(`http://localhost:${port}/api/dashboard`)).status, 401);
    assert.equal((await owner.call('/auth/logout', { method: 'POST' })).status, 204);
    assert.equal((await owner.call('/dashboard')).status, 401);
    await owner.call('/auth/csrf');
    assert.equal((await owner.call('/auth/login', {
      method: 'POST',
      body: { email: accounts[0].email, password: 'a-strong-password-123' },
    })).status, 200);

    let publicList = (await owner.call('/lists', {
      method: 'POST',
      body: { title: 'Lista pública de teste', description: '', visibility: 'public' },
    })).value.list;
    const privateList = (await owner.call('/lists', {
      method: 'POST',
      body: { title: 'Lista privada de teste', description: '', visibility: 'private' },
    })).value.list;
    assert.equal((await owner.call(`/lists/${privateList.id}/items`, {
      method: 'POST',
      body: { title: 'Link inválido', url: 'javascript:alert(1)' },
    })).status, 400);
    const item = (await owner.call(`/lists/${publicList.id}/items`, {
      method: 'POST',
      body: { title: 'Produto de teste', url: 'https://shop.example/item.jpg' },
    })).value.item;
    assert.equal(item.image, 'https://shop.example/item.jpg');
    publicList = (await owner.call(`/lists/${publicList.id}`, {
      method: 'PATCH',
      body: { title: 'Lista atualizada', description: 'Descrição', visibility: 'public' },
    })).value.list;
    assert.equal(publicList.title, 'Lista atualizada');

    const guestRegistration = await guest.register(accounts[1]);
    const features = await guest.call('/auth/config');
    assert.equal(features.value.passwordResetEnabled, false);
    assert.equal(features.value.imagePreviewEnabled, true);
    assert.equal((await guest.call('/auth/password-reset/request', {
      method: 'POST',
      body: { email: accounts[1].email },
    })).status, 503);
    assert.equal((await guest.call(`/lists/${privateList.id}`)).status, 404);
    assert.equal((await guest.call(`/lists/${publicList.id}`)).status, 200);
    assert.equal((await guest.call(`/users/${registration.value.user.id}/follow`, { method: 'POST' })).status, 200);
    const dashboard = (await guest.call('/dashboard')).value;
    assert.equal(dashboard.following.length, 1);
    assert.equal(dashboard.feed.length, 1);

    assert.equal((await guest.call(`/items/${item.id}/reservation`, { method: 'POST' })).status, 204);
    const ownerItem = (await owner.call(`/lists/${publicList.id}`)).value.list.items[0];
    assert.equal(ownerItem.reserved, false);
    assert.equal(ownerItem.reservedByMe, false);
    const guestItem = (await guest.call(`/lists/${publicList.id}`)).value.list.items[0];
    assert.equal(guestItem.reserved, true);
    assert.equal(guestItem.reservedByMe, true);

    const otherRegistration = await other.register(accounts[2]);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf5sAAAAASUVORK5CYII=', 'base64');
    assert.equal((await other.uploadAvatar(png)).status, 200);
    assert.equal((await other.uploadAvatar(Buffer.from('not an image'))).status, 415);
    const otherList = (await other.call('/lists', {
      method: 'POST',
      body: { title: 'Lista de perfil privado', description: '', visibility: 'public' },
    })).value.list;
    await other.call('/me', {
      method: 'PATCH',
      body: { username: accounts[2].username, displayName: 'Private Owner', bio: '', visibility: 'private' },
    });
    const followRequest = await guest.call(`/users/${otherRegistration.value.user.id}/follow`, { method: 'POST' });
    assert.equal(followRequest.status, 200);
    assert.equal(followRequest.value.status, 'pending');
    const lockedProfile = await guest.call(`/users/${accounts[2].username}`);
    assert.equal(lockedProfile.status, 200);
    assert.equal(lockedProfile.value.profileLocked, true);
    assert.equal(lockedProfile.value.lists.length, 0);
    assert.equal((await fetch(`http://localhost:${port}/api/users/${otherRegistration.value.user.id}/avatar`, {
      headers: { Cookie: guest.cookie },
    })).status, 404);
    assert.equal((await guest.call(`/lists/${otherList.id}`)).status, 404);
    const requests = await other.call('/me/follow-requests');
    assert.equal(requests.value.requests.length, 1);
    assert.equal((await owner.call(`/me/follow-requests/${guestRegistration.value.user.id}/accept`, { method: 'POST' })).status, 404);
    assert.equal((await guest.call('/previews', { method: 'POST', body: { url: 'https://example.com/product' } })).status, 422);
    assert.equal((await other.call(`/me/follow-requests/${guestRegistration.value.user.id}/accept`, { method: 'POST' })).status, 204);
    const acceptedProfile = await guest.call(`/users/${accounts[2].username}`);
    assert.equal(acceptedProfile.value.profileLocked, false);
    assert.equal(acceptedProfile.value.lists.length, 1);
    assert.equal((await guest.call(`/lists/${otherList.id}`)).status, 200);
    const visibleAvatar = await fetch(`http://localhost:${port}/api/users/${otherRegistration.value.user.id}/avatar`, {
      headers: { Cookie: guest.cookie },
    });
    assert.equal(visibleAvatar.status, 200);
    assert.equal(visibleAvatar.headers.get('content-type'), 'image/png');

    assert.equal((await other.call(`/items/${item.id}/reservation`, { method: 'POST' })).status, 409);
    await owner.call('/me', {
      method: 'PATCH',
      body: { username: accounts[0].username, displayName: 'Owner', bio: '', visibility: 'private' },
    });
    assert.equal((await guest.call(`/users/${accounts[0].username}`)).status, 200);
    assert.equal((await guest.call(`/users/${accounts[0].username}`)).value.profileLocked, false);
    assert.equal((await guest.call('/search?q=Lista')).value.lists.length, 0);

    await owner.call('/me', {
      method: 'PATCH',
      body: { username: accounts[0].username, displayName: 'Owner', bio: '', visibility: 'public' },
    });
    assert.equal((await owner.call(`/items/${item.id}/purchased`, { method: 'PATCH', body: { purchased: true } })).status, 204);
    assert.equal((await guest.call(`/lists/${publicList.id}`)).value.list.items[0].reserved, false);
  } finally {
    await prisma.user.deleteMany({ where: { email: { in: accounts.map((account) => account.email) } } });
    await prisma.$disconnect();
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await once(server, 'exit');
    }
  }
});

class ApiClient {
  constructor(port) {
    this.base = `http://localhost:${port}/api`;
    this.cookie = '';
    this.csrfToken = '';
  }

  async register(account) {
    await this.call('/auth/csrf');
    return this.call('/auth/register', {
      method: 'POST',
      body: { ...account, displayName: account.username, password: 'a-strong-password-123' },
    });
  }

  async call(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (this.cookie) headers.Cookie = this.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      if (!this.csrfToken) await this.call('/auth/csrf');
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    const response = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookies = response.headers.getSetCookie?.() || [];
    if (setCookies.length) this.cookie = setCookies.at(-1).split(';')[0];
    const value = response.status === 204 ? null : await response.json();
    if (value?.csrfToken) this.csrfToken = value.csrfToken;
    return { status: response.status, value };
  }

  async uploadAvatar(buffer) {
    const formData = new FormData();
    formData.append('avatar', new Blob([buffer]), 'avatar.png');
    const response = await fetch(`${this.base}/me/avatar`, {
      method: 'POST',
      headers: { Cookie: this.cookie, 'X-CSRF-Token': this.csrfToken },
      body: formData,
    });
    const value = await response.json();
    return { status: response.status, value };
  }
}

async function getAvailablePort() {
  const socket = net.createServer();
  socket.listen(0);
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForApi(server, port, getServerError) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`API process exited: ${getServerError()}`);
    try {
      const response = await fetch(`http://localhost:${port}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`API did not start in time: ${getServerError()}`);
}
