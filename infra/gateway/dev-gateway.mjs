// Development gateway: everything on one address (http://localhost:8080), routed by path, exactly like
// production (see Caddyfile). One origin means no CORS and first-party cookies for every app.
//
//   /api/platform/*  → Platform API          (path kept)
//   /tasks/api/*     → Tasks API (Django)    (/tasks stripped)
//   /media/*         → Tasks uploads (Django)
//   /tasks/*         → Tasks web (Vite)      (path kept; built with base /tasks/)
//   /assets/api/*    → Assets API (NestJS)   (/assets stripped)
//   /assets/*        → Assets web (Vite)     (path kept; built with base /assets/)
//   everything else  → Portal web (Vite)
import http from 'node:http';
import net from 'node:net';

export const ROUTES = [
  { prefix: '/api/platform/', port: 4000 },
  { prefix: '/tasks/api/', port: 8000, strip: '/tasks' },
  { prefix: '/media/', port: 8000 },
  { prefix: '/tasks/', port: 5174 },
  { prefix: '/assets/api/', port: 3000, strip: '/assets' },
  { prefix: '/assets/', port: 5173 },
  { prefix: '/', port: 5175 },
];

export function route(url) {
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

export function startGateway(port = Number(process.env.GATEWAY_PORT ?? 8080)) {
  const server = http.createServer((req, res) => {
    const target = route(req.url ?? '/');
    const upstream = http.request(
      { host: '127.0.0.1', port: target.port, path: target.path, method: req.method, headers: forwardedHeaders(req) },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
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
