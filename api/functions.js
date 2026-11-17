import { app as functionsApp } from '@azure/functions';
import { app as expressApp } from './index.js';
import { createExpressProxy } from './express-proxy.js';

const { handler: proxyExpressRequest } = createExpressProxy(expressApp);

functionsApp.http('wishly-api', {
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  route: '{*path}',
  handler: proxyExpressRequest,
});
