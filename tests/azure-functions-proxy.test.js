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

test('Azure Function returns a request ID when API initialization fails', async () => {
  const values = {
    DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:5432/wishly',
    SESSION_SECRET: 'a'.repeat(32),
    APP_URL: 'not-a-valid-url',
    NODE_ENV: 'production',
  };
  const previous = new Map(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  const errors = [];

  try {
    const response = await handleFunctionRequest(
      new Request('https://wishly.example/api/auth/config'),
      { invocationId: 'test-request-id', error: (message) => errors.push(message) },
    );

    assert.equal(response.status, 503);
    assert.deepEqual(response.jsonBody, {
      error: 'A API não conseguiu processar a solicitação.',
      code: 'api_initialization_failed',
      errorType: 'TypeError',
      errorCode: 'ERR_INVALID_URL',
      requestId: 'test-request-id',
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /test-request-id.*TypeError/);
    assert.doesNotMatch(errors[0], /postgresql:\/\/invalid/);
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
    res.cookie('wishly.sid', 'test-session', { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60_000 });
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
  assert.equal(response.cookies.length, 1);
  assert.equal(response.cookies[0].name, 'wishly.sid');
  assert.equal(response.cookies[0].value, 'test-session');
  assert.equal(response.cookies[0].path, '/');
  assert.equal(response.cookies[0].httpOnly, true);
  assert.equal(response.cookies[0].secure, true);
  assert.equal(response.cookies[0].sameSite, 'Lax');
  assert.equal(response.cookies[0].maxAge, 60);
  assert.ok(response.cookies[0].expires instanceof Date);
});
