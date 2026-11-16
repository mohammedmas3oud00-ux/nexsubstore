const testPlanId = 'test9999-cn-hk-mo-unlimited-1';
const testVariant = 'un:0';
const testProduct = 'شريحة تجريبية · الصين وهونغ كونغ وماكاو';
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const validUuid = new RegExp('^' + uuid + '$');
const trackingRoute = new RegExp('^/order/(' + uuid + ')/(' + uuid + ')/?$');
const decisionPattern = new RegExp('^(accept|reject):(' + uuid + ')$');
const trackingDecisionPattern = new RegExp('^(a):(' + uuid + '):([A-Za-z0-9_-]{22})$');
const catalogPrefix = 'globalThis.NX_CATALOG = ';
const CATALOG_VERSION='2026-11-17';
const VERIFIED_PLANS={"gb1:0":"7876dde7-774b-430e-bfe1-e445f4318878","gb2:0":"9e6f8cda-6ba6-45ad-9180-c70b61f8f6ef","gb3:0":"6e252d80-4359-4c45-a7df-7b3f43e6451b","un:0":"18d0cdfe-0554-4702-852f-60309ac1f2db","un:1":"ec4c6793-a092-4362-9a46-97143c2050dd","un:2":"4b15a5a9-e04f-43ff-b153-eab2ab793c78","un:3":"53014496-0cd7-4dc3-b1c9-b916479a14a4","un:4":"0cf0f2f4-ad9b-477b-ae7f-41d1ebab300d","un:5":"f83798cd-faa6-457e-b2b2-df72cc03c4ad","un:6":"cd545300-8ad7-4b75-a979-2f1ea1b9f8af","un:7":"12fd3bc7-5c9a-409b-8bd2-d85578ee777b","un:8":"a221645f-dc2a-4a70-a647-edcd3461a8de","un:9":"523adb5b-0f31-42da-a116-0a11fbad43d2","un:10":"0c1c4ac2-2584-40b7-a7c4-68d439b01138","un:11":"34bc0542-eacd-4213-a73c-a0ef3f8f1cd0","un:12":"cfaffaa0-25ad-49e5-beac-f6a2148827a6","un:13":"60aa7ffa-2e37-4035-91ea-35844a023743"};
const VERIFIED_SPECS={"gb1:0":{"days":1,"price":450},"gb2:0":{"days":1,"price":700},"gb3:0":{"days":1,"price":900},"un:0":{"days":1,"price":1000},"un:1":{"days":2,"price":1800},"un:2":{"days":3,"price":2500},"un:3":{"days":4,"price":3200},"un:4":{"days":5,"price":3600},"un:5":{"days":6,"price":4200},"un:6":{"days":7,"price":5000},"un:7":{"days":8,"price":5500},"un:8":{"days":9,"price":6200},"un:9":{"days":10,"price":6700},"un:10":{"days":15,"price":10000},"un:11":{"days":20,"price":13000},"un:12":{"days":25,"price":15500},"un:13":{"days":30,"price":16500}};
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
  let mapping;
  try { mapping = JSON.parse(env.MICROESIM_PLAN_MAP || '{}'); } catch { return null; }
  const plans = Object.fromEntries(Object.entries(mapping).filter(([key, value]) =>
    /^[a-z0-9-]+:\d+$/.test(key) && typeof value === 'string' && value.trim() && !value.startsWith('test9999-')));
  return { mode: 'production', base: 'https://business.microesim.com', plans: {...plans,...VERIFIED_PLANS} };
}

function orderSettings(env) {
  const settings = providerSettings(env);
  if (!settings || !env.ORDERS_DB || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET ||
      !/^\d+$/.test(env.TELEGRAM_CHAT_ID || '')) return null;
  return settings;
}

async function getCatalog(request, env) {
  const asset = await env.ASSETS.fetch(new Request(new URL('/catalog.v2026-11-17.js', request.url)));
  const text = (await asset.text()).trim();
  if (!asset.ok || !text.startsWith(catalogPrefix) || !text.endsWith(';')) throw new Error('Catalog unavailable');
  return JSON.parse(text.slice(catalogPrefix.length, -1));
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
  const name = clean(form.get('name'), 80);
  const productId = clean(form.get('product_id'), 40);
  const index = clean(form.get('variant'), 8);
  const product = (await getCatalog(request, env)).find(item => item.id === productId);
  const variant = /^\d+$/.test(index) ? product?.d[Number(index)] : undefined;
  if (!name || !variant || !Number.isInteger(variant[1]) || variant[1] <= 0) return json({ ok: false }, 400);
  const planKey=productId+':'+Number(index),spec=VERIFIED_SPECS[planKey];
  if(spec && (variant[0]!==spec.days || variant[1]!==spec.price)) return json({ok:false,error:'catalog_mismatch'},503);
  // Legacy country packs are orderable only if priced in this catalog and mapped by the server.
  if(product.fam==='sub'&&!['s-nf','s-osn'].includes(productId))return json({ok:false,error:'unavailable'},403);
  if(clean(form.get('catalog_version'),32)!==CATALOG_VERSION)return json({ok:false,error:'catalog_version'},409);
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
    if (!phone) return json({ ok: false }, 400);
    await sendOrder(env, [...caption, 'واتساب: ' + phone].join('\n'), receipt);
    return json({ ok: true });
  }
  const transferWhatsapp=clean(form.get('transfer_whatsapp'),32);
  if(!/^\+?[0-9][0-9 ()-]{6,23}$/.test(transferWhatsapp))return json({ok:false,error:'transfer_whatsapp_required'},400);
  const settings = orderSettings(env);
  const planId = settings?.plans[planKey];
  if(spec && planId!==VERIFIED_PLANS[planKey])return json({ok:false,error:'unavailable'},503);
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
    // At-most-once notification: an uncertain Telegram response must not be retried automatically.
    // A failed/sending request requires manual reconciliation to prevent duplicate admin messages.
    return json({ ok: false, error: 'notification_pending' }, 409);
  }
  try {
    if (settings.mode === 'test') {
      caption.splice(0, 4, 'طلب اختبار · لا يوجد تحويل حقيقي', 'الباقة: ' + testProduct, 'المدة: ' + duration, 'السعر: مجاني');
    }
    caption.push('رقم واتساب مُحوّل المبلغ: '+transferWhatsapp);
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
  const isAdmin=(chat,user)=>chat?.type==='private' && String(chat.id)===env.TELEGRAM_CHAT_ID && String(user?.id)===env.TELEGRAM_CHAT_ID;
  if(['زوار الشهر','/visitors','/start'].includes(update.message?.text)){
    if(!isAdmin(update.message.chat,update.message.from))return json({ok:true});
    if(!env.ORDERS_DB)return json({ok:false},503);
    const month=omanMonth();
    const count=update.message.text==='/start' ? null : await env.ORDERS_DB.prepare('SELECT COUNT(*) AS total FROM monthly_visitors WHERE month = ?').bind(month).first();
    await telegram(env,'sendMessage',{chat_id:env.TELEGRAM_CHAT_ID,text:count===null?'أهلًا، اختر زوار الشهر من القائمة.':'زوار الشهر ('+month+'): '+(count?.total??0),reply_markup:{keyboard:[[{text:'زوار الشهر'}]],resize_keyboard:true}});
    return json({ok:true});
  }
  const trackingDecision = trackingDecisionPattern.exec(query?.data || '');
  const decision = trackingDecision || decisionPattern.exec(query?.data || '');
  if (!query || !decision) return json({ ok: true });
  const chat = query.message?.chat;
  if (!isAdmin(chat,query.from)) {
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
    tracking + (refresh ? '<p>الصفحة بتتحدث تلقائيًا.</p>' : '') + qr + links + lpa +
    (order?.status === 'ready' ? '<section><button type="button" id="show-usage">عرض استهلاك الشريحة</button><p id="usage-result" role="status" style="white-space:pre-line"></p></section>' : '') + '</main>' +
    (order ? '<script defer src="/tracking-link.js"></script>' : '') + (order?.status === 'ready' ? '<script defer src="/usage-tracking.js"></script>' : '') + qrScripts + '</html>',
    { status: order ? 200 : 404, headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src https: data:; base-uri 'none'; frame-ancestors 'none'",
    } },
  );
}


function omanMonth(){
  const p=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Muscat',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value;
}
async function countVisitor(request,env){
  if(!env.ORDERS_DB||!(env.VISITOR_HASH_SECRET||env.TELEGRAM_WEBHOOK_SECRET))return json({ok:false},503);
  const cookie=/(?:^|;\s*)nx_visitor=([0-9a-f]{64})(?:;|$)/.exec(request.headers.get('Cookie')||'');
  const token=cookie?.[1]||hex(crypto.getRandomValues(new Uint8Array(32)));
  const key=await hash(omanMonth()+':'+token+':'+(env.VISITOR_HASH_SECRET||env.TELEGRAM_WEBHOOK_SECRET));
  await env.ORDERS_DB.prepare('INSERT OR IGNORE INTO monthly_visitors (month, visitor_hash) VALUES (?, ?)').bind(omanMonth(),key).run();
  const response=json({ok:true});
  response.headers.set('Set-Cookie','nx_visitor='+token+'; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax');
  return response;
}
function formattedUsage(value,unit){
  if(value==null||value==='')return null;
  if(typeof value==='object'&&!Array.isArray(value))return formattedUsage(value.value??value.amount??value.data_usage,value.unit??unit);
  const m=/^\s*(\d+(?:\.\d+)?)\s*(MB|GB|KB|B)?\s*$/i.exec(String(value));
  if(!m)return null;
  const amount=Number(m[1]),u=(m[2]||unit||'MB').toUpperCase();
  const mb=u==='GB'?amount*1000:u==='KB'?amount/1000:u==='B'?amount/1000000:u==='MB'?amount:null;
  if(mb===null||!Number.isFinite(mb))return null;
  // Explicit GB stays in GB (including zero); otherwise switch from MB to GB at 1000 MB.
  const showGb = u === 'GB' || mb >= 1000;
  const num=showGb?(mb/1000).toFixed(3):mb.toFixed(2);
  return {formatted:num.replace(/\.?0+$/,'')+(showGb?' GB':' MB'),unit:u,assumed_mb:!m[2]&&!unit};
}
function deviceIds(top){
  const value=top?.device_ids??top?.deviceIds??top?.devices;
  const items=Array.isArray(value)?value:typeof value==='string'?value.split(','):[];
  return [...new Set(items.map(x=>typeof x==='object'?x?.device_id:String(x)).filter(x=>typeof x==='string'&&x.length&&x.length<160))].slice(0,20);
}

function dailyUsageEntries(raw, defaultUnit) {
  if (raw == null || raw === '') return [];
  const isScalar = raw && typeof raw === 'object' && !Array.isArray(raw) &&
    ('value' in raw || 'amount' in raw || 'data_usage' in raw || 'usage' in raw);
  const rows = Array.isArray(raw) ? raw : isScalar ? [raw] :
    typeof raw === 'object' ? Object.entries(raw).map(([date, value]) => ({date, value})) : [raw];
  return rows.slice(0, 100).map(row => {
    const value = row && typeof row === 'object' ?
      row.data_usage ?? row.usage ?? row.value ?? row.amount : row;
    const unit = row && typeof row === 'object' ? row.unit ?? defaultUnit : defaultUnit;
    const quantity = formattedUsage(value, unit);
    const date = row && typeof row === 'object' && typeof (row.date ?? row.day) === 'string'
      ? (row.date ?? row.day).slice(0, 50) : '';
    return quantity ? {date, amount:quantity.formatted} : null;
  }).filter(Boolean);
}

async function countLegacyVisitor(request, env) {
  if (!env.ORDERS_DB || !(env.VISITOR_HASH_SECRET || env.TELEGRAM_WEBHOOK_SECRET)) return json({ok:false},503);
  const raw = await request.text().catch(() => '');
  if (!validUuid.test(raw) || raw.length > 40) return json({ok:false},400);
  const month = omanMonth();
  const key = await hash(month + ':' + raw + ':' + (env.VISITOR_HASH_SECRET || env.TELEGRAM_WEBHOOK_SECRET));
  await env.ORDERS_DB.prepare('INSERT OR IGNORE INTO monthly_visitors (month, visitor_hash) VALUES (?, ?)').bind(month,key).run();
  return json({ok:true});
}

async function legacyUsageRequest(request, env) {
  const path = new URL(request.url).pathname.replace(/\/usage\/?$/, '');
  const match = trackingRoute.exec(path);
  if (!match) return json({ok:false},404);
  const reference = new URL(path, request.url).href;
  const internal = new Request(new URL('/api/usage', request.url), {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({reference})
  });
  const response = await usageRequest(internal,env);
  if (!response.ok) return json({ok:false},response.status);
  const result = await response.json();
  return json({ok:true,usage:(result.devices||[]).map(device=>({
    cumulative:device.usage?.formatted ?? null,
    daily:device.daily_entries || (device.daily ? [{date:'',amount:device.daily.formatted}] : []),
    resetTime:device.daily_reset_time ?? null
  }))});
}

async function usageRequest(request,env){
  if(!env.ORDERS_DB)return json({ok:false},503);
  if(Number(request.headers.get('Content-Length')||0)>4096)return json({ok:false},413);
  const payload=await request.json().catch(()=>null);
  const reference=typeof payload?.reference==='string'?payload.reference.trim().slice(0,2048):'';
  let order=null;
  try{
    const url=new URL(reference,new URL(request.url).origin);
    const here=new URL(request.url),match=trackingRoute.exec(url.pathname);
    if(match&&!url.search&&!url.hash&&!url.username&&!url.password&&
      ['nexsubstore.com','www.nexsubstore.com',here.hostname].includes(url.hostname)&&
      (url.protocol==='https:'||here.hostname==='localhost'&&url.protocol==='http:'))
      order=await env.ORDERS_DB.prepare('SELECT * FROM orders WHERE id = ? AND access_hash = ?').bind(match[1],await hash(match[2])).first();
  }catch{}
  if(!order&&/^LPA:1\$[\x21-\x7e]{1,500}$/i.test(reference)){
    const found=await env.ORDERS_DB.prepare("SELECT * FROM orders WHERE status = 'ready' AND instr(delivery, ?) > 0 LIMIT 100").bind(reference).all();
    order=(found.results||[]).find(row=>{try{return JSON.parse(row.delivery||'{}').lpa===reference}catch{return false}})||null;
  }
  if(!order)return json({ok:false,error:'not_found'},404);
  if(order.status!=='ready'||!order.topup_id)return json({ok:false,error:'not_ready'},409);
  const settings=providerSettings(env);
  if(!settings||settings.mode!==order.mode)return json({ok:false,error:'unavailable'},503);
  try{
    const top=await microesim(env,settings,'topupDetail',{topup_id:order.topup_id});
    const ids=deviceIds(top);
    if(!ids.length)return json({ok:false,error:'unavailable'},503);
    const devices=await Promise.all(ids.map(async device_id=>{
      const data=await microesim(env,settings,'deviceDetail',{topup_id:order.topup_id,device_id});
      return {usage:formattedUsage(data?.data_usage,data?.data_usage_unit??data?.unit),daily:formattedUsage(data?.data_usage_daily,data?.data_usage_daily_unit??data?.data_usage_unit??data?.unit),daily_entries:dailyUsageEntries(data?.data_usage_daily,data?.data_usage_daily_unit??data?.data_usage_unit??data?.unit),is_daily:data?.is_daily??null,daily_reset_time:data?.daily_reset_time??null};
    }));
    return json({ok:true,devices});
  }catch{return json({ok:false,error:'provider_unavailable'},502)}
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/api/esim-availability') {
        if (request.method !== 'GET') return json({ ok: false }, 405);
        const settings = orderSettings(env);
        return json({ mode: settings?.mode, catalog_version: CATALOG_VERSION, variants: Object.keys(settings?.plans || {}) });
      }
      if (path === '/api/usage') return request.method === 'POST' ? await usageRequest(request,env) : json({ok:false},405);
      if (path === '/api/visitor') return request.method === 'POST' ? await countVisitor(request,env) : json({ok:false},405);
      if (path === '/api/visit') return request.method === 'POST' ? await countLegacyVisitor(request,env) : json({ok:false},405);
      if (path === '/api/order') return request.method === 'POST' ? await submitOrder(request, env) : json({ ok: false }, 405);
      if (path === '/api/telegram') return request.method === 'POST' ? await handleDecision(request, env) : json({ ok: false }, 405);
      if (path.startsWith('/order/')) {
        if (request.method !== 'GET') return json({ ok: false }, 405);
        if (/\/usage\/?$/.test(path)) return await legacyUsageRequest(request,env);
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
