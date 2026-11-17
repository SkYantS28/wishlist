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

  let stage = 'initialization';
  try {
    if (!proxyHandler) {
      const [{ app: expressApp }, { createExpressProxy }] = await Promise.all([
        import('./index.js'),
        import('./express-proxy.js'),
      ]);
      proxyHandler = createExpressProxy(expressApp).handler;
    }

    stage = 'request';
    return await proxyHandler(request, context);
  } catch (error) {
    const requestId = context.invocationId || 'unknown';
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const message = error instanceof Error ? error.message : String(error);
    const safeMessage = message
      .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, 'postgresql://[REDACTED]')
      .replace(/\b(password|token|secret)=([^\s&]+)/gi, '$1=[REDACTED]')
      .slice(0, 240);
    context.error(`Wishly API ${stage} failed (${requestId}): ${errorName}: ${safeMessage}`);

    return {
      status: stage === 'initialization' ? 503 : 502,
      jsonBody: {
        error: 'A API não conseguiu processar a solicitação.',
        code: stage === 'initialization' ? 'api_initialization_failed' : 'api_proxy_failed',
        errorType: errorName,
        ...(typeof error?.code === 'string' ? { errorCode: error.code.slice(0, 40) } : {}),
        requestId,
      },
    };
  }
}

functionsApp.http('wishly-api', {
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  route: '{*path}',
  handler: handleFunctionRequest,
});
