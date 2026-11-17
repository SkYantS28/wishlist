import assert from 'node:assert/strict';
import express from 'express';
import { test } from 'node:test';
import { createExpressProxy } from '../api/express-proxy.js';
import { handleFunctionRequest } from '../api/functions.js';

test('Azure Function reports missing application settings without failing route registration', async () => {
  const names = ['DATABASE_URL', 'SESSION_SECRET', 'APP_URL', 'NODE_ENV'];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  const warnings = [];

  try {
    const response = await handleFunctionRequest(
      new Request('https://wishly.example/api/auth/config'),
      { warn: (message) => warnings.push(message) },
    );

    assert.equal(response.status, 503);
    assert.deepEqual(response.jsonBody.missingSettings, names.slice(0, 3).concat('NODE_ENV=production'));
    assert.equal(warnings.length, 1);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

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
