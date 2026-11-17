import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import ipaddr from 'ipaddr.js';

const MAX_HTML_BYTES = 512 * 1024;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const previewCache = new Map();

export function getPreviewAllowedHosts() {
  return (process.env.PREVIEW_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

export async function getProductImage(productUrl, allowedHosts) {
  const startUrl = validateAllowedUrl(productUrl, allowedHosts);
  const cached = previewCache.get(startUrl.href);
  if (cached && cached.expiresAt > Date.now()) return { imageUrl: cached.imageUrl };

  let currentUrl = startUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const addresses = await getPublicAddresses(currentUrl.hostname);
    const response = await requestPage(currentUrl, addresses[0]);
    if (response.redirect) {
      if (redirectCount === MAX_REDIRECTS) throw new Error('A página redirecionou muitas vezes.');
      currentUrl = validateAllowedUrl(new URL(response.redirect, currentUrl).href, allowedHosts);
      continue;
    }

    const imageUrl = findOpenGraphImage(response.html, currentUrl);
    if (imageUrl) {
      if (previewCache.size > 500) {
        for (const [key, entry] of previewCache) {
          if (entry.expiresAt <= Date.now()) previewCache.delete(key);
        }
        if (previewCache.size > 500) previewCache.clear();
      }
      previewCache.set(startUrl.href, { imageUrl, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return { imageUrl };
  }
  throw new Error('A página redirecionou muitas vezes.');
}

function validateAllowedUrl(value, allowedHosts) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Informe um link válido.');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const permitted = allowedHosts.some((allowedHost) => hostname === allowedHost || hostname.endsWith(`.${allowedHost}`));
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || (url.port && url.port !== '443')
    || net.isIP(hostname)
    || !permitted
  ) {
    throw new Error('A prévia não está habilitada para esse domínio.');
  }
  url.hash = '';
  return url;
}

async function getPublicAddresses(hostname) {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => {
    try {
      return ipaddr.process(address).range() !== 'unicast';
    } catch {
      return true;
    }
  })) {
    throw new Error('O domínio do link não pode ser acessado com segurança.');
  }
  return addresses;
}

function requestPage(url, resolvedAddress) {
  return new Promise((resolve, reject) => {
    let receivedBytes = 0;
    const request = https.get(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9',
        'Accept-Encoding': 'identity',
        'User-Agent': 'wishly-link-preview/1.0',
      },
      lookup: (_hostname, _options, callback) => callback(null, resolvedAddress.address, resolvedAddress.family),
      timeout: TIMEOUT_MS,
    }, (response) => {
      const location = response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.resume();
        resolve({ redirect: location, html: '' });
        return;
      }
      if (response.statusCode !== 200 || !/^text\/html(?:;|$)/i.test(response.headers['content-type'] || '')) {
        response.resume();
        resolve({ html: '' });
        return;
      }
      if (Number(response.headers['content-length']) > MAX_HTML_BYTES) {
        response.destroy(new Error('A página é grande demais para gerar uma prévia.'));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_HTML_BYTES) {
          response.destroy(new Error('A página é grande demais para gerar uma prévia.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('A página demorou demais para responder.')));
    request.on('error', reject);
  });
}

function findOpenGraphImage(html, pageUrl) {
  let selectedImage = '';
  const images = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map();
    for (const attribute of match[0].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes.set(attribute[1].toLowerCase(), decodeHtml(attribute[2] ?? attribute[3] ?? attribute[4] ?? ''));
    }
    const property = (attributes.get('property') || attributes.get('name') || '').toLowerCase();
    const content = attributes.get('content');
    if (content && ['og:image', 'og:image:url', 'twitter:image'].includes(property)) {
      images.push({ property, content });
    }
  }
  images.sort((left, right) => {
    const priority = { 'og:image': 0, 'og:image:url': 1, 'twitter:image': 2 };
    return priority[left.property] - priority[right.property];
  });
  selectedImage = images[0]?.content || '';
  if (!selectedImage) return '';
  try {
    const imageUrl = new URL(selectedImage, pageUrl);
    if (!['http:', 'https:'].includes(imageUrl.protocol) || imageUrl.username || imageUrl.password) return '';
    return imageUrl.href;
  } catch {
    return '';
  }
}

function decodeHtml(value) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);?/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}
