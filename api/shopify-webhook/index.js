// /api/shopify-webhook.js

const crypto = require('crypto');

const ENFORCE_HMAC = false;
const HAS_ADS_CONSENT = true;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const raw = JSON.stringify(req.body);
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];
    const digest = crypto.createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
      .update(raw, 'utf8')
      .digest('base64');

    const ok = (digest === hmacHeader);
    if (!ok) {
      const msg = '⚠️ HMAC mismatch (report-only)';
      if (ENFORCE_HMAC) return res.status(401).send('Invalid signature');
      console.warn(msg);
    }
  } catch (e) {
    console.warn('⚠️ HMAC verify skipped:', e.message);
  }

  const body = req.body;

  // 🔍 EXTRA DEBUG: dump the full incoming payload for this test phase
  try {
    console.log('🧾 RAW BODY:', JSON.stringify(body, null, 2));
  } catch (e) {
    console.warn('⚠️ Could not stringify body:', e.message);
  }

  console.log('🚚 Order received:', body.id);
  console.log('🏷️ Tags (raw):', body.tags);
  console.log('🪪 Source Name (raw):', body.source_name);

  const tagsArray = (body.tags || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);

  const sourceName = body.source_name || '';

  console.log('🔎 Parsed tagsArray:', tagsArray);
  console.log('🔎 sourceName:', sourceName);

  // NEW: Check for Recharge indicators in line items
  const lineItems = Array.isArray(body.line_items) ? body.line_items : [];
  const hasSubscriptionProps = lineItems.some(item =>
    Array.isArray(item.properties) &&
    item.properties.some(p => p.name === '_recharge_subscription_id')
  );
  const hasSellingPlan = lineItems.some(item => item.selling_plan_allocation);

  console.log('🔎 hasSubscriptionProps:', hasSubscriptionProps);
  console.log('🔎 hasSellingPlan:', hasSellingPlan);

  const isRecurring = (
    tagsArray.includes('Subscription Recurring Order') ||
    sourceName === 'subscription_contract' ||
    hasSubscriptionProps ||
    hasSellingPlan
  );

  console.log('🤖 isRecurring evaluation:', {
    isRecurring,
    fromTag: tagsArray.includes('Subscription Recurring Order'),
    fromSourceName: sourceName === 'subscription_contract',
    fromProps: hasSubscriptionProps,
    fromSellingPlan: hasSellingPlan,
  });

  if (isRecurring) {
    console.log(`❌ Skipping recurring subscription order in webhook: ${body.id}`);
    return res.status(200).json({ success: false, message: 'Recurring order ignored' });
  }

  // ✅ Extract fbp/fbc from note_attributes or fallback proxy
  let fbp = null;
  let fbc = null;

  if (Array.isArray(body.note_attributes)) {
    for (const item of body.note_attributes) {
      if (item?.name === '_fbp') fbp = item.value;
      if (item?.name === '_fbc') fbc = item.value;
    }
  }

  const lookupKey = body.cart_token || body.browser_ip || null;
  if ((!fbp || !fbc) && lookupKey && process.env.PROXY_COOKIE_LOOKUP_URL) {
    try {
      const url = `${process.env.PROXY_COOKIE_LOOKUP_URL}?key=${encodeURIComponent(lookupKey)}`;
      const proxyRes = await fetch(url);
      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        fbp = fbp || proxyData.fbp || null;
        fbc = fbc || proxyData.fbc || null;
        if (fbp || fbc) console.log('📡 Enriched cookies from proxy');
      } else {
        console.warn('⚠️ Proxy enrichment HTTP error:', proxyRes.status);
      }
    } catch (err) {
      console.error('❌ Proxy cookie fetch error:', err.message);
    }
  }

  // 🔒 EMQ setup
  const customer = body.customer || {};
  const bill = body.billing_address || {};
  const ship = body.shipping_address || {};

  const toSha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
  const lc = (s = '') => s.toString().trim().toLowerCase();
  const up = (s = '') => s.toString().trim().toUpperCase();
  const cleanText = (s = '') => lc(s).normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ');
  const cleanPhone = (p, cc = '44') => {
    if (!p) return '';
    const d = String(p).replace(/\D+/g, '');
    return d.startsWith(cc) ? d : cc + d.replace(/^0+/, '');
  };

  const email   = lc(customer.email || body.email || '');
  const phone   = cleanPhone(customer.phone || bill.phone || ship.phone || '');
  const fn      = cleanText(customer.first_name || bill.first_name || ship.first_name || '');
  const ln      = cleanText(customer.last_name  || bill.last_name  || ship.last_name  || '');
  const city    = cleanText(bill.city || ship.city || '');
  const state   = up(bill.province_code || ship.province_code || '');
  const zip     = (bill.zip || ship.zip || '').toString().trim();
  const country = up(bill.country_code || ship.country_code || '');

  const clientIp = body.browser_ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '0.0.0.0';
  const userAgent = body.browser_user_agent || req.headers['user-agent'] || 'unknown';

  const eventTime = Math.floor(new Date(body.created_at || Date.now()).getTime() / 1000);
  const eventId = `${body.id || body.order_number || 'order'}:${eventTime}`;

  const user_data = {
    client_ip_address: clientIp,
    client_user_agent: userAgent,
    fbp,
    fbc,
    ...(HAS_ADS_CONSENT && email   ? { em: [toSha256(email)] } : {}),
    ...(HAS_ADS_CONSENT && phone   ? { ph: [toSha256(phone)] } : {}),
    ...(HAS_ADS_CONSENT && fn      ? { fn: [toSha256(fn)]    } : {}),
    ...(HAS_ADS_CONSENT && ln      ? { ln: [toSha256(ln)]    } : {}),
    ...(HAS_ADS_CONSENT && city    ? { ct: [toSha256(city)]  } : {}),
    ...(HAS_ADS_CONSENT && state   ? { st: [toSha256(state)] } : {}),
    ...(HAS_ADS_CONSENT && zip     ? { zp: [toSha256(zip)]   } : {}),
    ...(HAS_ADS_CONSENT && country ? { country: [toSha256(country)] } : {}),
    ...(HAS_ADS_CONSENT            ? { external_id: [toSha256(String(customer.id || body.id))] } : {})
  };

  const payload = {
    data: [
      {
        event_name: 'Aimerce_Target',
        event_time: eventTime,
        event_id: eventId,
        action_source: 'website',
        event_source_url: 'https://events.naitre.com',
        user_data,
        custom_data: {
          currency: body.currency || 'GBP',
          value: Number(body.total_price) || 0,
          order_id: String(body.id),
        },
      },
    ],
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${process.env.META_PIXEL_ID}/events?access_token=${process.env.META_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('❌ Meta API Error:', result);
      return res.status(500).json({ success: false, error: result });
    }

    console.log(`✅ Sent Aimerce_Target for order ${body.id}`, {
      matched: result.events_received,
      fbtrace_id: result.fbtrace_id
    });
    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error('❌ Fetch error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
