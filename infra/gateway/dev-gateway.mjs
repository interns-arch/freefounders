// Development gateway: everything on one address (http://localhost:8080), routed by path, exactly like
// production (see Caddyfile). One origin means no CORS and first-party cookies for every app.
//
//   /api/platform/*         → Platform API          (path kept)
//   /tasks/api/*            → Tasks API (Django)    (/tasks stripped)
//   /media/*                → Tasks uploads (Django)
//   /assets/api/*           → Assets API (NestJS)   (/assets stripped)
//   everything else         → FreeFounders web app (Vite, apps/web): /, /tasks/…, /assets/…, /people …
import http from 'node:http';
import net from 'node:net';

const ROUTES = [
  { prefix: '/api/platform/', port: 4000 },
  { prefix: '/tasks/api/', port: 8000, strip: '/tasks' },
  { prefix: '/media/', port: 8000 },
  { prefix: '/assets/api/', port: 3000, strip: '/assets' },
  { prefix: '/', port: 5176 },
];

function route(url) {
  // A prefix matches whole path segments only: "/tasks" and "/tasks/x", never "/tasksx".
  const pathname = url.split('?')[0];
  const r = ROUTES.find((x) => pathname === x.prefix.replace(/\/$/, '') || pathname.startsWith(x.prefix));
  const path = r.strip && url.startsWith(r.strip) ? url.slice(r.strip.length) || '/' : url;
  return { port: r.port, path };
}

function forwardedHeaders(req) {
  return {
    ...req.headers,
    'x-forwarded-for': req.socket.remoteAddress ?? '',
    'x-forwarded-proto': 'http',
    'x-forwarded-host': req.headers.host ?? '',
  };
}

// Dev only: the phone app's browser preview (`expo start`, port 8081) runs on another origin than this gateway,
// so the browser needs CORS to call the APIs. The phone itself does not (no CORS in native apps).
const EXPO_WEB = /^http:\/\/(localhost|127\.0\.0\.1|\d{1,3}(\.\d{1,3}){3}):8081$/;
function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !EXPO_WEB.test(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': req.headers['access-control-request-headers'] ?? 'authorization, content-type, x-requested-with',
    vary: 'Origin',
  };
}

export function startGateway(port = Number(process.env.GATEWAY_PORT ?? 8080)) {
  const server = http.createServer((req, res) => {
    const cors = corsHeaders(req);
    if (cors && req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'access-control-max-age': '600' });
      res.end();
      return;
    }
    const target = route(req.url ?? '/');
    const upstream = http.request(
      { host: '127.0.0.1', port: target.port, path: target.path, method: req.method, headers: forwardedHeaders(req) },
      (up) => {
        res.writeHead(up.statusCode ?? 502, cors ? { ...up.headers, ...cors } : up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Gateway: nothing is answering on port ${target.port} yet (still starting?). Try again in a moment.`);
    });
    req.pipe(upstream);
  });

  // WebSockets (Vite hot reload): pass the raw connection through.
  server.on('upgrade', (req, socket, head) => {
    const target = route(req.url ?? '/');
    const up = net.connect(target.port, '127.0.0.1', () => {
      const lines = [`${req.method} ${target.path} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(lines.join('\r\n') + '\r\n\r\n');
      if (head?.length) up.write(head);
      up.pipe(socket).pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('dev-gateway.mjs')) {
  startGateway().then(() => console.log('✔ Gateway on http://localhost:8080'));
}
