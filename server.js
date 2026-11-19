import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './_worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.pdf': 'application/pdf',
};

const BLOCKED_FILES = new Set([
  '/_worker.js',
  '/server.js',
  '/package.json',
  '/package-lock.json',
  '/metadata.json',
]);

// In-memory Cloudflare D1 stub for local/preview execution (data resets on restart)
function createMockD1() {
  const monthlyVisitors = new Map(); // month -> Set(visitor_hash)
  const orders = new Map(); // id -> order object
  const ordersByAccessHash = new Map(); // access_hash -> id

  const nowSec = () => Math.floor(Date.now() / 1000);

  return {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      const execute = (params, mode) => {
        // monthly_visitors
        if (normalized.startsWith('INSERT OR IGNORE INTO monthly_visitors')) {
          const [month, visitorHash] = params;
          if (!monthlyVisitors.has(month)) monthlyVisitors.set(month, new Set());
          monthlyVisitors.get(month).add(visitorHash);
          return mode === 'run' ? { success: true } : null;
        }
        if (normalized.startsWith('SELECT COUNT(*) AS count FROM monthly_visitors')) {
          const [month] = params;
          const count = monthlyVisitors.get(month)?.size ?? 0;
          return { count };
        }

        // orders INSERT
        if (normalized.startsWith('INSERT INTO orders')) {
          const [id, access_hash, customer_name, product_name, duration, price_baisa, plan_id, orderMode, maxMode] = params;
          if (ordersByAccessHash.has(access_hash)) return null;
          let maxNum = 0;
          for (const row of orders.values()) {
            if (row.mode === maxMode && row.order_number > maxNum) maxNum = row.order_number;
          }
          const order = {
            id,
            access_hash,
            customer_name,
            product_name,
            duration,
            price_baisa,
            plan_id,
            mode: orderMode,
            order_number: maxNum + 1,
            status: 'pending',
            notification: 'sending',
            notification_started_at: nowSec(),
            decided_at: null,
            last_poll: 0,
            topup_id: null,
            provider_error: null,
            delivery: null,
            created_at: nowSec(),
          };
          orders.set(id, order);
          ordersByAccessHash.set(access_hash, id);
          return { id: order.id, order_number: order.order_number };
        }

        // orders SELECT by access_hash
        if (normalized === 'SELECT id, order_number, notification FROM orders WHERE access_hash = ?') {
          const id = ordersByAccessHash.get(params[0]);
          const order = id ? orders.get(id) : null;
          return order ? { id: order.id, order_number: order.order_number, notification: order.notification } : null;
        }

        // orders SELECT by id and access_hash
        if (normalized === 'SELECT * FROM orders WHERE id = ? AND access_hash = ?') {
          const order = orders.get(params[0]);
          return order && order.access_hash === params[1] ? { ...order } : null;
        }

        // orders SELECT ready orders
        if (normalized.startsWith("SELECT * FROM orders WHERE status = 'ready' AND delivery IS NOT NULL")) {
          const results = Array.from(orders.values())
            .filter(o => o.status === 'ready' && o.delivery != null)
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, 200)
            .map(o => ({ ...o }));
          return { results };
        }

        // orders UPDATE notification = 'sending'
        if (normalized.startsWith("UPDATE orders SET notification = 'sending'")) {
          const order = orders.get(params[0]);
          const now = nowSec();
          if (order && (order.notification === 'failed' || (order.notification === 'sending' && order.notification_started_at < now - 60))) {
            order.notification = 'sending';
            order.notification_started_at = now;
            return { id: order.id };
          }
          return null;
        }

        if (normalized === "UPDATE orders SET notification = 'failed' WHERE id = ?") {
          const order = orders.get(params[0]);
          if (order) order.notification = 'failed';
          return { success: true };
        }

        if (normalized === "UPDATE orders SET notification = 'sent' WHERE id = ?") {
          const order = orders.get(params[0]);
          if (order) order.notification = 'sent';
          return { success: true };
        }

        if (normalized === "UPDATE orders SET status = 'review', provider_error = ? WHERE id = ?") {
          const order = orders.get(params[1]);
          if (order) {
            order.status = 'review';
            order.provider_error = params[0];
          }
          return { success: true };
        }

        if (normalized === "UPDATE orders SET status = 'issuing', topup_id = ? WHERE id = ?") {
          const order = orders.get(params[1]);
          if (order) {
            order.status = 'issuing';
            order.topup_id = params[0];
          }
          return { success: true };
        }

        if (normalized.startsWith("UPDATE orders SET status = ?, decided_at = unixepoch() WHERE id = ? AND mode = ? AND status = 'pending'")) {
          const [status, id, orderMode] = params;
          const order = orders.get(id);
          if (order && order.mode === orderMode && order.status === 'pending') {
            order.status = status;
            order.decided_at = nowSec();
            return { id: order.id, order_number: order.order_number, plan_id: order.plan_id, access_hash: order.access_hash };
          }
          return null;
        }

        if (normalized.startsWith("UPDATE orders SET last_poll = unixepoch() WHERE id = ? AND status = 'issuing'")) {
          const order = orders.get(params[0]);
          const now = nowSec();
          if (order && order.status === 'issuing' && (order.last_poll || 0) <= now - 8) {
            order.last_poll = now;
            return { id: order.id };
          }
          return null;
        }

        if (normalized === "UPDATE orders SET status = 'ready', delivery = ? WHERE id = ? AND status = 'issuing'") {
          const order = orders.get(params[1]);
          if (order && order.status === 'issuing') {
            order.status = 'ready';
            order.delivery = params[0];
          }
          return { success: true };
        }

        return mode === 'all' ? { results: [] } : null;
      };

      const statement = (params = []) => ({
        bind: (...bound) => statement(bound),
        first: async () => execute(params, 'first'),
        all: async () => execute(params, 'all'),
        run: async () => execute(params, 'run'),
      });
      return statement();
    },
  };
}

async function serveAsset(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const url = new URL(request.url);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  if (
    BLOCKED_FILES.has(pathname) ||
    pathname.startsWith('/.') ||
    pathname.includes('/.') ||
    pathname.startsWith('/node_modules')
  ) {
    return new Response('Not Found', { status: 404 });
  }

  const resolvedPath = path.resolve(__dirname, '.' + pathname);
  if (!resolvedPath.startsWith(__dirname + path.sep) && resolvedPath !== __dirname) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    let targetPath = resolvedPath;
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) {
      targetPath = path.join(targetPath, 'index.html');
    }
    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const body = request.method === 'HEAD' ? null : await fs.readFile(targetPath);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

const env = {
  ...process.env,
  ORDERS_DB: createMockD1(),
  ASSETS: { fetch: serveAsset },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    const url = `${proto}://${host}${req.url || '/'}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else {
        headers.set(key, value);
      }
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const body = hasBody ? await readBody(req) : undefined;
    const webRequest = new Request(url, {
      method: req.method,
      headers,
      body: hasBody && body.length > 0 ? body : undefined,
    });

    const webResponse = await worker.fetch(webRequest, env);
    res.statusCode = webResponse.status;
    webResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (req.method === 'HEAD' || !webResponse.body) {
      res.end();
      return;
    }

    const buffer = Buffer.from(await webResponse.arrayBuffer());
    res.end(buffer);
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({ ok: false, error: 'internal_error' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`NEXSUB STORE server listening on http://${HOST}:${PORT}`);
});
