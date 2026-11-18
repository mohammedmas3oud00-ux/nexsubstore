const testPlanId = 'test9999-cn-hk-mo-unlimited-1';
const testVariant = 'un:0';
const testProduct = 'شريحة تجريبية · الصين وهونغ كونغ وماكاو';
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const validUuid = new RegExp('^' + uuid + '$');
const trackingRoute = new RegExp('^/order/(' + uuid + ')/(' + uuid + ')/?$');
const decisionPattern = new RegExp('^(accept|reject):(' + uuid + ')$');
const trackingDecisionPattern = new RegExp('^(a):(' + uuid + '):([A-Za-z0-9_-]{22})$');
const catalogPrefix = 'globalThis.NX_CATALOG = ';
const catalogVersion = '2026-11-17';
const utf8 = new TextEncoder();

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function clean(value, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hash(value) {
  return hex(await crypto.subtle.digest('SHA-256', utf8.encode(value)));
}

function providerSettings(env) {
  if (!env.MICROESIM_ACCOUNT || !env.MICROESIM_SECRET || !/^(?:[0-9a-f]{2})+$/i.test(env.MICROESIM_SALT || '')) return null;
  if (env.MICROESIM_MODE === 'test') {
    return { mode: 'test', base: 'https://test.microesim.com', plans: { [testVariant]: testPlanId } };
  }
  if (env.MICROESIM_MODE !== 'production') return null;
  const mapping = JSON.parse(env.MICROESIM_PLAN_MAP || '{}');
  const plans = Object.fromEntries(Object.entries(mapping).filter(([key, value]) =>
    /^[a-z0-9-]+:\d+$/.test(key) && typeof value === 'string' && value.trim() && !value.startsWith('test9999-')));
  return { mode: 'production', base: 'https://business.microesim.com', plans };
}

function orderSettings(env) {
  const settings = providerSettings(env);
  if (!settings || !env.ORDERS_DB || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET ||
      !/^\d+$/.test(env.TELEGRAM_CHAT_ID || '')) return null;
  return settings;
}

async function getCatalog(request, env) {
  let asset = await env.ASSETS.fetch(new Request(new URL('/catalog.v' + catalogVersion + '.js', request.url)));
  if (!asset.ok) asset = await env.ASSETS.fetch(new Request(new URL('/catalog.js', request.url)));
  const text = (await asset.text()).trim();
  if (!asset.ok || !text.startsWith(catalogPrefix) || !text.endsWith(';')) throw new Error('Catalog unavailable');
  return JSON.parse(text.slice(catalogPrefix.length, -1));
}

function validPhone(value) {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 15;
}

function orderDuration(variant) {
  const [days, , label] = variant;
  return label || (days === 1 ? 'يوم واحد' : days === 2 ? 'يومان' : days <= 10 ? days + ' أيام' : days + ' يومًا');
}

function displayPrice(baisa) {
  return baisa < 1000 ? baisa + ' بيسة' : (baisa / 1000) + ' ريال عُماني';
}

function orderReference(order) {
  return order.order_number == null ? order.id : '#' + order.order_number;
}

function packAccessKey(access) {
  const bytes = access.replaceAll('-', '').match(/../g).map(pair => parseInt(pair, 16));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function unpackAccessKey(packed) {
  const bytes = Uint8Array.from(atob(packed.replaceAll('-', '+').replaceAll('_', '/') + '=='), char => char.charCodeAt(0));
  const value = hex(bytes);
  return [value.slice(0, 8), value.slice(8, 12), value.slice(12, 16), value.slice(16, 20), value.slice(20)].join('-');
}

async function telegram(env, method, data) {
  const multipart = data instanceof FormData;
  const response = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: multipart ? undefined : { 'Content-Type': 'application/json' },
    body: multipart ? data : JSON.stringify(data),
    signal: AbortSignal.timeout(10000),
  });
  const reply = await response.json();
  if (!response.ok || !reply.ok) throw new Error('Telegram request failed');
  return reply.result;
}

function sendOrder(env, caption, receipt, orderId, access) {
  // Telegram callback data is limited to 64 bytes. Keep the customer key out of D1 and the pending message.
  const packed = orderId ? packAccessKey(access) : '';
  const buttons = orderId ? { inline_keyboard: [[
    { text: 'قبول', callback_data: 'a:' + orderId + ':' + packed },
    { text: 'رفض', callback_data: 'reject:' + orderId },
  ]] } : undefined;
  if (!receipt) return telegram(env, 'sendMessage', { chat_id: env.TELEGRAM_CHAT_ID, text: caption, reply_markup: buttons });
  const data = new FormData();
  data.set('chat_id', env.TELEGRAM_CHAT_ID);
  data.set('caption', caption);
  data.set('document', receipt, receipt.name || 'receipt');
  if (buttons) data.set('reply_markup', JSON.stringify(buttons));
  return telegram(env, 'sendDocument', data);
}

async function submitOrder(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return json({ ok: false }, 503);
  const declaredSize = Number(request.headers.get('Content-Length'));
  if (declaredSize > 6 * 1024 * 1024) return json({ ok: false }, 413);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ ok: false }, 400);
  if (form.get('website')) return json({ ok: true });
  if (clean(form.get('catalog_version'), 20) !== catalogVersion) return json({ ok: false, error: 'catalog_version' }, 400);
  const name = clean(form.get('name'), 80);
  const productId = clean(form.get('product_id'), 40);
  const index = clean(form.get('variant'), 8);
  const product = (await getCatalog(request, env)).find(item => item.id === productId);
  const variant = /^\d+$/.test(index) ? product?.d[Number(index)] : undefined;
  if (!name || !variant || !Number.isInteger(variant[1]) || variant[1] <= 0) return json({ ok: false }, 400);
  const uploaded = form.get('receipt');
  const receipt = uploaded instanceof File && uploaded.size > 0 ? uploaded : null;
  if (receipt?.size > 5 * 1024 * 1024) return json({ ok: false }, 413);
  if (receipt && !/^image\/(?:jpeg|png|webp|gif|heic|heif|bmp|tiff)$|^application\/pdf$/i.test(receipt.type)) {
    return json({ ok: false, error: 'receipt_type' }, 415);
  }
  const duration = orderDuration(variant);
  const caption = ['طلب جديد', 'الباقة: ' + product.t, 'المدة: ' + duration,
    'السعر: ' + displayPrice(variant[1]), 'الاسم: ' + name];
  if (product.fam === 'sub') {
    const phone = clean(form.get('whatsapp'), 32);
    if (!validPhone(phone)) return json({ ok: false, error: 'invalid_whatsapp' }, 400);
    await sendOrder(env, [...caption, 'واتساب: ' + phone].join('\n'), receipt);
    return json({ ok: true });
  }
  const transferWhatsapp = clean(form.get('transfer_whatsapp'), 32);
  if (!transferWhatsapp) return json({ ok: false, error: 'transfer_whatsapp_required' }, 400);
  if (!validPhone(transferWhatsapp)) return json({ ok: false, error: 'invalid_whatsapp' }, 400);
  caption.push('واتساب المحوّل: ' + transferWhatsapp);
  const settings = orderSettings(env);
  const planId = settings?.plans[productId + ':' + Number(index)];
  if (!planId) return json({ ok: false, error: 'unavailable' }, 503);
  const access = clean(form.get('request_key'), 40);
  if (!receipt || !validUuid.test(access)) return json({ ok: false, error: 'receipt_required' }, 400);
  const accessHash = await hash(access);
  const orderId = crypto.randomUUID();
  const db = env.ORDERS_DB;
  const productName = settings.mode === 'test' ? testProduct : product.t;
  const price = settings.mode === 'test' ? 0 : variant[1];
  const created = await db.prepare(
    'INSERT INTO orders (id, access_hash, customer_name, product_name, duration, price_baisa, plan_id, mode, order_number) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(order_number), 0) + 1 FROM orders WHERE mode = ?)) ' +
    'ON CONFLICT(access_hash) DO NOTHING RETURNING id, order_number'
  ).bind(orderId, accessHash, name, productName, duration, price, planId, settings.mode, settings.mode).first();
  const order = created ?? await db.prepare('SELECT id, order_number, notification FROM orders WHERE access_hash = ?').bind(accessHash).first();
  const { id } = order;
  if (!created) {
    if (order.notification === 'sent') return json({ ok: true, tracking_url: '/order/' + id + '/' + access });
    const claimed = await db.prepare(
      "UPDATE orders SET notification = 'sending', notification_started_at = unixepoch() WHERE id = ? AND " +
      "(notification = 'failed' OR (notification = 'sending' AND notification_started_at < unixepoch() - 60)) RETURNING id"
    ).bind(id).first();
    if (!claimed) return json({ ok: false, error: 'sending' }, 409);
  }
  try {
    if (settings.mode === 'test') {
      caption.splice(0, 4, 'طلب اختبار · لا يوجد تحويل حقيقي', 'الباقة: ' + testProduct, 'المدة: ' + duration, 'السعر: مجاني');
    }
    caption.push('رقم الطلب: ' + orderReference(order));
    await sendOrder(env, caption.join('\n'), receipt, id, access);
  } catch {
    await db.prepare("UPDATE orders SET notification = 'failed' WHERE id = ?").bind(id).run();
    return json({ ok: false, error: 'telegram' }, 502);
  }
  await db.prepare("UPDATE orders SET notification = 'sent' WHERE id = ?").bind(id).run();
  return json({ ok: true, tracking_url: '/order/' + id + '/' + access });
}

async function microesim(env, settings, method, fields) {
  const account = env.MICROESIM_ACCOUNT;
  const timestamp = String(Date.now());
  const nonce = hex(crypto.getRandomValues(new Uint8Array(9)));
  let signature;
  try {
    const salt = Uint8Array.from(env.MICROESIM_SALT.match(/../g), pair => parseInt(pair, 16));
    const password = await crypto.subtle.importKey('raw', utf8.encode(env.MICROESIM_SECRET), 'PBKDF2', false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 1024, hash: 'SHA-256' }, password, 256);
    const key = await crypto.subtle.importKey('raw', utf8.encode(hex(derived)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    signature = hex(await crypto.subtle.sign('HMAC', key, utf8.encode(account + nonce + timestamp)));
  } catch {
    throw new Error('PROVIDER_SIGNING_FAILED');
  }
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const response = await fetch(settings.base + '/allesim/v1/' + method, {
    // Workers supports manual redirects. Keep signed headers on the configured origin.
    method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: {
      'MICROESIM-ACCOUNT': account, 'MICROESIM-NONCE': nonce,
      'MICROESIM-TIMESTAMP': timestamp, 'MICROESIM-SIGN': signature, 'Accept': 'application/json',
    },
  }).catch(error => {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('PROVIDER_TIMEOUT');
    throw new Error('PROVIDER_CONNECTION_FAILED');
  });
  if (response.status >= 300 && response.status < 400) throw new Error('PROVIDER_REDIRECT_' + response.status);
  const reply = await response.json().catch(() => null);
  if (!reply) throw new Error('PROVIDER_NON_JSON_' + response.status);
  if (!response.ok || reply.code !== 1) {
    throw new Error(/^[A-Z_]{1,70}$/.test(reply.error_code || '') ? reply.error_code : 'PROVIDER_ERROR');
  }
  return reply.result;
}

async function issueOrder(env, settings, order) {
  const db = env.ORDERS_DB;
  let topupId;
  try {
    const result = await microesim(env, settings, 'esimSubscribe', {
      number: '1', channel_dataplan_id: order.plan_id, custom_order_no: order.id,
    });
    topupId = result?.topup_id;
    if (typeof topupId !== 'string' || !topupId) throw new Error('MISSING_TOPUP_ID');
  } catch (error) {
    // Never submit again after an uncertain result. The provider may have issued a profile.
    const code = /^[A-Z0-9_]{1,70}$/.test(error.message) ? error.message : 'PROVIDER_UNCERTAIN';
    await db.prepare("UPDATE orders SET status = 'review', provider_error = ? WHERE id = ?").bind(code, order.id).run();
    return 'review';
  }
  await db.prepare("UPDATE orders SET status = 'issuing', topup_id = ? WHERE id = ?").bind(topupId, order.id).run();
  return 'issuing';
}

async function authorizedTelegramRequest(request, env) {
  const supplied = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!supplied || !env.TELEGRAM_WEBHOOK_SECRET) return false;
  const [provided, expected] = await Promise.all([hash(supplied), hash(env.TELEGRAM_WEBHOOK_SECRET)]);
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  return difference === 0;
}

async function handleDecision(request, env) {
  if (!await authorizedTelegramRequest(request, env)) return json({ ok: false }, 403);
  const update = await request.json();
  const query = update.callback_query;
  const trackingDecision = trackingDecisionPattern.exec(query?.data || '');
  const decision = trackingDecision || decisionPattern.exec(query?.data || '');
  if (!query || !decision) return json({ ok: true });
  const chat = query.message?.chat;
  if (chat?.type !== 'private' || String(chat.id) !== env.TELEGRAM_CHAT_ID || String(query.from.id) !== env.TELEGRAM_CHAT_ID) {
    await telegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'غير مصرح لك بمراجعة هذا الطلب.' });
    return json({ ok: true });
  }
  const settings = orderSettings(env);
  if (!settings) return json({ ok: false }, 503);
  const approve = decision[1] === 'accept' || decision[1] === 'a';
  const order = await env.ORDERS_DB.prepare(
    "UPDATE orders SET status = ?, decided_at = unixepoch() WHERE id = ? AND mode = ? AND status = 'pending' RETURNING id, order_number, plan_id, access_hash"
  ).bind(approve ? 'submitting' : 'rejected', decision[2], settings.mode).first();
  const answer = text => telegram(env, 'answerCallbackQuery', { callback_query_id: query.id, text }).catch(() => {});
  if (!order) {
    await answer('الطلب اتراجع بالفعل أو غير متاح.');
    return json({ ok: true });
  }
  await answer(approve ? 'تم تسجيل القبول. جاري إصدار الشريحة.' : 'تم رفض الطلب.');
  const status = approve ? await issueOrder(env, settings, order) : 'rejected';
  let message = status === 'review' ? '⚠️ الإصدار يحتاج مراجعة. رقم الطلب: ' + orderReference(order) :
    status === 'issuing' ? '✅ تم القبول وبدأ إصدار الشريحة.' : '❌ تم رفض الطلب.';
  if (approve && trackingDecision) {
    const access = unpackAccessKey(trackingDecision[3]);
    if (await hash(access) === order.access_hash) {
      const origin = settings.mode === 'production' ? 'https://nexsubstore.com' : new URL(request.url).origin;
      message += '\n\nرابط متابعة الطلب (احتفظ به وأرسله للعميل فقط عند الحاجة):\n' +
        origin + '/order/' + order.id + '/' + access;
    }
  }
  const original = query.message.caption ?? query.message.text ?? 'رقم الطلب: ' + orderReference(order);
  const attachment = query.message.caption !== undefined;
  await telegram(env, attachment ? 'editMessageCaption' : 'editMessageText', {
    chat_id: chat.id, message_id: query.message.message_id,
    [attachment ? 'caption' : 'text']: original + '\n\n' + message,
    reply_markup: { inline_keyboard: [] },
  }).catch(() => {});
  return json({ ok: true });
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {}
  return '';
}

async function updateDelivery(env, order) {
  const settings = providerSettings(env);
  if (settings?.mode !== order.mode) return order;
  const db = env.ORDERS_DB;
  const claimed = await db.prepare(
    "UPDATE orders SET last_poll = unixepoch() WHERE id = ? AND status = 'issuing' AND last_poll <= unixepoch() - 8 RETURNING id"
  ).bind(order.id).first();
  if (!claimed) return order;
  const detail = await microesim(env, settings, 'topupDetail', { topup_id: order.topup_id }).catch(() => null);
  if (detail?.status !== 'completed' || Number(detail.success_number) !== 1) return order;
  const delivery = {
    qr: httpsUrl(detail.qrcode?.[0]), ios: httpsUrl(detail.ios_esim_install_link?.[0]),
    android: httpsUrl(detail.android_esim_install_link?.[0]),
    lpa: typeof detail.lpa_str?.[0] === 'string' ? detail.lpa_str[0] : '',
  };
  if (!delivery.qr && !delivery.ios && !delivery.android && !delivery.lpa) return order;
  order.delivery = JSON.stringify(delivery);
  order.status = 'ready';
  await db.prepare("UPDATE orders SET status = 'ready', delivery = ? WHERE id = ? AND status = 'issuing'")
    .bind(order.delivery, order.id).run();
  return order;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function trackingPage(order) {
  const statuses = {
    pending: 'طلبك قيد المراجعة',
    rejected: 'الطلب مرفوض',
    submitting: 'تم قبول الطلب وجارٍ إصدار الشريحة',
    issuing: 'تم قبول الطلب وجارٍ تجهيز الشريحة',
    ready: 'شريحتك جاهزة للتثبيت',
    review: 'الطلب قيد المراجعة بعد الموافقة',
  };
  const state = order?.status === 'submitting' && order.decided_at < Date.now() / 1000 - 120 ? 'review' : order?.status;
  const title = statuses[state] || 'تعذر العثور على الطلب';
  const delivery = order?.status === 'ready' ? JSON.parse(order.delivery) : null;
  const refresh = ['pending', 'submitting', 'issuing'].includes(state);
  const links = delivery ? [
    [delivery.ios, 'تثبيت على آيفون'],
    [delivery.android, 'تثبيت على أندرويد'],
  ].filter(([url]) => url).map(([url, label]) => '<a rel="noreferrer" href="' + escapeHtml(url) + '">' + label + '</a>').join('') : '';
  const details = order ? '<p>' + escapeHtml(order.product_name) + ' · ' + escapeHtml(order.duration) +
    '</p><p>رقم الطلب <bdi>' + escapeHtml(orderReference(order)) + '</bdi></p>' : '<p>راجع رابط الطلب الخاص بك.</p>';
  const tracking = order ? '<section class="tracking-warning" aria-labelledby="tracking-label"><p id="tracking-label"><strong>تنبيه مهم جدًا: انسخ رابط الطلب واحفظه قبل ما تقفل الصفحة.</strong></p>' +
    '<p>هتحتاج الرابط لمتابعة طلبك واستلام الشريحة بعد الموافقة. لو ضاع، تواصل مع الدعم برقم الطلب. احتفظ بالرابط لنفسك لأنه يفتح بيانات الشريحة.</p>' +
    '<div class="tracking"><button type="button" id="copy-tracking">نسخ رابط الطلب</button><input id="tracking-url" aria-label="رابط متابعة الطلب" dir="ltr" readonly></div>' +
    '<p id="copy-status" role="status"></p></section>' : '';
  const localQr = /^LPA:1\$[\x21-\x7e]{1,500}$/i.test(delivery?.lpa || '');
  const qr = localQr ? '<img id="esim-qr" alt="رمز QR لتثبيت الشريحة" width="240" height="240" hidden>' :
    delivery?.qr ? '<img alt="رمز QR لتثبيت الشريحة" width="240" height="240" src="' + escapeHtml(delivery.qr) + '">' : '';
  const lpa = delivery?.lpa ? '<details id="manual-install"><summary>بيانات التثبيت اليدوي</summary><p dir="ltr"><code id="esim-activation">' +
    escapeHtml(delivery.lpa) + '</code></p></details>' : '';
  const qrScripts = localQr ? '<script defer src="/qrcode-generator.js"></script><script defer src="/qr-display.js"></script>' : '';
  return new Response(
    '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    (refresh ? '<meta http-equiv="refresh" content="15">' : '') +
    '<title>' + title + ' | NEXSUB STORE</title><style>' +
    'body{margin:0;background:#06143a;color:#f4f5ff;font:16px/1.8 system-ui,sans-serif;padding:24px}' +
    'main{max-width:560px;margin:7vh auto;background:#101d43;border:1px solid #2e477c;border-radius:18px;padding:24px}' +
    'h1{line-height:1.35;font-size:clamp(1.5rem,5vw,2rem)}p{color:#c8d5f5}bdi,code{overflow-wrap:anywhere}' +
    'a{color:#9ce5ff;margin:0 0 12px 12px}img{display:block;max-width:100%;height:auto;background:white;border-radius:10px;margin:20px auto}img[hidden]{display:none}' +
    '.tracking-warning{background:#3b1b25;border:2px solid #ff987f;border-radius:12px;padding:16px;margin:16px 0}.tracking-warning p{color:#fff1eb;margin:0 0 10px}.tracking-warning strong{font-size:1.1rem}.tracking{display:flex;gap:8px;flex-direction:column}.tracking input,.tracking button{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid #ffad96}.tracking input{min-width:0;background:#25101a;color:#fff1eb}.tracking button{background:#ffc0aa;color:#29120d;cursor:pointer;font-weight:700}#copy-status{min-height:1.8em;margin:4px 0 0}' +
    '</style><main><a href="/">NEXSUB STORE</a><h1>' + title + '</h1>' + details +
    (order?.mode === 'test' ? '<p>طلب تجريبي.</p>' : '') +
    tracking + (refresh ? '<p>الصفحة بتتحدث تلقائيًا.</p>' : '') + qr + links + lpa + '</main>' +
    (order ? '<script defer src="/tracking-link.js"></script>' : '') + qrScripts + '</html>',
    { status: order ? 200 : 404, headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src https: data:; base-uri 'none'; frame-ancestors 'none'",
    } },
  );
}

function formatDataMb(mb) {
  const value = Number(mb);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value >= 1024) return (Math.round((value / 1024) * 100) / 100) + ' GB';
  return Math.round(value) + ' MB';
}

async function handleVisit(request, env) {
  if (!env.ORDERS_DB) return json({ ok: false }, 503);
  const month = new Date().toISOString().slice(0, 7);
  if (request.method === 'POST') {
    const id = (await request.text().catch(() => '')).trim();
    if (validUuid.test(id)) {
      const visitorHash = await hash(id);
      await env.ORDERS_DB.prepare('INSERT OR IGNORE INTO monthly_visitors (month, visitor_hash) VALUES (?, ?)')
        .bind(month, visitorHash).run();
    }
  } else if (request.method !== 'GET') {
    return json({ ok: false }, 405);
  }
  const row = await env.ORDERS_DB.prepare('SELECT COUNT(*) AS count FROM monthly_visitors WHERE month = ?')
    .bind(month).first();
  return json({ ok: true, month, count: Number(row?.count || 0) });
}

async function findOrderByReference(env, reference, requestUrl) {
  if (!env.ORDERS_DB || !reference) return null;
  let path = '';
  try {
    path = new URL(reference, requestUrl).pathname;
  } catch {}
  const match = trackingRoute.exec(path);
  if (match) {
    return env.ORDERS_DB.prepare('SELECT * FROM orders WHERE id = ? AND access_hash = ?')
      .bind(match[1], await hash(match[2])).first();
  }
  const rows = await env.ORDERS_DB.prepare(
    "SELECT * FROM orders WHERE status = 'ready' AND delivery IS NOT NULL ORDER BY created_at DESC LIMIT 200"
  ).all();
  for (const row of rows.results || []) {
    try {
      const delivery = JSON.parse(row.delivery);
      if (delivery.lpa === reference || delivery.qr === reference) return row;
    } catch {}
  }
  return null;
}

async function handleUsage(request, env) {
  if (request.method !== 'POST') return json({ ok: false }, 405);
  const body = await request.json().catch(() => null);
  const reference = clean(body?.reference, 600);
  if (!reference) return json({ ok: false, error: 'not_found' }, 404);
  const order = await findOrderByReference(env, reference, request.url);
  if (!order) return json({ ok: false, error: 'not_found' }, 404);
  if (order.status !== 'ready' || !order.topup_id) return json({ ok: false, error: 'not_ready' }, 409);
  const settings = providerSettings(env);
  if (settings?.mode !== order.mode) return json({ ok: false, error: 'provider_unavailable' }, 503);
  try {
    const detail = await microesim(env, settings, 'topupDetail', { topup_id: order.topup_id });
    const deviceIds = Array.isArray(detail?.device_ids) ? detail.device_ids :
      (detail?.device_id ? [detail.device_id] : []);
    const devices = [];
    for (const deviceId of deviceIds) {
      const dev = await microesim(env, settings, 'deviceDetail', { device_id: String(deviceId) }).catch(() => null);
      if (!dev) continue;
      const totalFormatted = formatDataMb(dev.data_usage ?? dev.usage ?? dev.used_data);
      const dailyFormatted = formatDataMb(dev.daily_usage ?? dev.today_usage);
      const entries = Array.isArray(dev.daily_entries) ? dev.daily_entries.map(x => ({
        date: x.date || '',
        amount: formatDataMb(x.usage ?? x.amount) || String(x.amount ?? ''),
      })) : [];
      devices.push({
        usage: totalFormatted ? { formatted: totalFormatted } : null,
        daily: dailyFormatted ? { formatted: dailyFormatted } : null,
        daily_entries: entries,
        daily_reset_time: dev.daily_reset_time ?? null,
      });
    }
    return json({ ok: true, devices });
  } catch {
    return json({ ok: false, error: 'provider_unavailable' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/api/esim-availability') {
        if (request.method !== 'GET') return json({ ok: false }, 405);
        const settings = orderSettings(env);
        return json({ mode: settings?.mode, catalog_version: catalogVersion, variants: Object.keys(settings?.plans || {}) });
      }
      if (path === '/api/visit') return await handleVisit(request, env);
      if (path === '/api/usage') return await handleUsage(request, env);
      if (path === '/api/order') return request.method === 'POST' ? await submitOrder(request, env) : json({ ok: false }, 405);
      if (path === '/api/telegram') return request.method === 'POST' ? await handleDecision(request, env) : json({ ok: false }, 405);
      if (path.startsWith('/order/')) {
        if (request.method !== 'GET') return json({ ok: false }, 405);
        const match = trackingRoute.exec(path);
        if (!match || !env.ORDERS_DB) return trackingPage(null);
        const order = await env.ORDERS_DB.prepare('SELECT * FROM orders WHERE id = ? AND access_hash = ?')
          .bind(match[1], await hash(match[2])).first();
        return trackingPage(order?.status === 'issuing' ? await updateDelivery(env, order) : order);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      // Runtime errors may contain credentials or private URLs. Report the route only.
      console.error('Request failed:', path.startsWith('/order/') ? '/order/' : path);
      return json({ ok: false }, 503);
    }
  },
};
