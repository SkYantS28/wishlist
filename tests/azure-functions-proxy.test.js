import assert from 'node:assert/strict';
import express from 'express';
import { test } from 'node:test';
import { createExpressProxy } from '../api/express-proxy.js';

test('Azure Functions adapter forwards API requests and session cookies to Express', async (context) => {
  const expressApp = express();
  expressApp.set('trust proxy', 1);
  expressApp.use(express.json());
  expressApp.post('/api/proxy-test', (req, res) => {
    res.cookie('wishly.sid', 'test-session', { httpOnly: true, secure: true, sameSite: 'lax' });
    res.status(201).json({
      body: req.body,
      cookie: req.get('cookie'),
      csrfToken: req.get('x-csrf-token'),
      secure: req.secure,
    });
  });
  const proxy = createExpressProxy(expressApp);
  context.after(() => proxy.close());

  const response = await proxy.handler(new Request('https://wishly.example/api/proxy-test?source=azure', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'wishly.sid=existing-session',
      'X-CSRF-Token': 'csrf-value',
    },
    body: JSON.stringify({ item: 'gift' }),
  }));
  const body = JSON.parse(response.body.toString());

  assert.equal(response.status, 201);
  assert.deepEqual(body.body, { item: 'gift' });
  assert.equal(body.cookie, 'wishly.sid=existing-session');
  assert.equal(body.csrfToken, 'csrf-value');
  assert.equal(body.secure, true);
  assert.ok(response.headers.some(([name, value]) => name.toLowerCase() === 'set-cookie' && value.includes('wishly.sid=test-session')));
});
