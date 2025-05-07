const crypto = require('crypto');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const body = req.body;

  // ⛔️ Filter out Recurring Subscription Orders
  const tags = body.tags || '';
  if (tags.includes('Subscription Recurring Order')) {
    return res.status(200).json({ success: false, message: 'Recurring order ignored' });
  }

  // ✅ Extract fbp and fbc from note_attributes (safe + recommended)
  let fbp = null;
  let fbc = null;

  if (Array.isArray(body.note_attributes)) {
    for (const item of body.note_attributes) {
      if (item.name === '_fbp') fbp = item.value;
      if (item.name === '_fbc') fbc = item.value;
    }
  }

  const payload = {
    data: [
      {
        event_name: 'Aimerce_Target',
        event_time: Math.floor(new Date(body.created_at).getTime() / 1000),
        action_source: 'website',
        event_source_url: null, // Deliberately blank to avoid sending URL or product info
        user_data: {
          em: [body.email ? crypto.createHash('sha256').update(body.email.trim().toLowerCase()).digest('hex') : null],
          client_ip_address: body.browser_ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '0.0.0.0',
          client_user_agent: body.browser_user_agent || req.headers['user-agent'] || 'unknown',
          fbp,
          fbc,
        },
        custom_data: {
          currency: body.currency || 'GBP',
          value: body.total_price,
          order_id: body.id,
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
      console.error('Meta API Error:', result);
      return res.status(500).json({ success: false, error: result });
    }

    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error('Fetch error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
