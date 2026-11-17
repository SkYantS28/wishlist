import { app as functionsApp } from '@azure/functions';

const requiredSettings = ['DATABASE_URL', 'SESSION_SECRET', 'APP_URL'];
let proxyHandler;

export async function handleFunctionRequest(request, context) {
  const missingSettings = requiredSettings.filter((name) => !process.env[name]);
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
    missingSettings.push('SESSION_SECRET (at least 32 characters)');
  }
  if (process.env.NODE_ENV !== 'production') missingSettings.push('NODE_ENV=production');
  if (missingSettings.length) {
    context.warn(`Azure API is missing required application settings: ${missingSettings.join(', ')}`);
    return {
      status: 503,
      jsonBody: {
        error: 'API configuration is incomplete.',
        missingSettings,
      },
    };
  }

  if (!proxyHandler) {
    const [{ app: expressApp }, { createExpressProxy }] = await Promise.all([
      import('./index.js'),
      import('./express-proxy.js'),
    ]);
    proxyHandler = createExpressProxy(expressApp).handler;
  }

  return proxyHandler(request, context);
}

functionsApp.http('wishly-api', {
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  route: '{*path}',
  handler: handleFunctionRequest,
});
