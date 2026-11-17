import http from 'node:http';

const requestHopByHopHeaders = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const responseHopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function createExpressProxy(expressApp) {
  const server = http.createServer(expressApp);
  let listening;

  async function getPort() {
    if (!listening) {
      listening = new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve(server.address().port);
        });
      });
    }
    return listening;
  }

  const handler = async (request) => {
    const port = await getPort();
    const url = new URL(request.url);
    const headers = {};
    for (const [name, value] of request.headers) {
      if (!requestHopByHopHeaders.has(name.toLowerCase())) headers[name] = value;
    }
    headers['x-forwarded-proto'] ||= process.env.NODE_ENV === 'production' ? 'https' : url.protocol.slice(0, -1);
    headers['x-forwarded-host'] ||= url.host;

    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.from(await request.arrayBuffer());
    return new Promise((resolve, reject) => {
      const proxy = http.request({
        host: '127.0.0.1',
        port,
        path: `${url.pathname}${url.search}`,
        method: request.method,
        headers,
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const responseHeaders = [];
          for (let index = 0; index < response.rawHeaders.length; index += 2) {
            const name = response.rawHeaders[index];
            if (!responseHopByHopHeaders.has(name.toLowerCase())) {
              responseHeaders.push([name, response.rawHeaders[index + 1]]);
            }
          }
          resolve({
            status: response.statusCode || 500,
            headers: responseHeaders,
            body: Buffer.concat(chunks),
          });
        });
      });
      proxy.on('error', reject);
      if (body) proxy.end(body);
      else proxy.end();
    });
  };

  return {
    handler,
    close: () => new Promise((resolve, reject) => {
      if (!server.listening) return resolve();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
