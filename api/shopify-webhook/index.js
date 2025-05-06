const crypto = require('crypto');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const body = req.body;

  // Normalize and split tags
  const tags = (body.tags || '').split(',').map(tag => tag.trim());

  // Exclude recurring subscription orders
  const isRecurringSubscription = tags.includes('Subscription') && tags.includes('Subscription Recurring Order');
  if (isRecurringSubscription) {
    console.log('Recurring subscription - event not sent:', tags);
    return res.status(200).json({ success: false, message: 'Recurring subscription - event skipped' });
  }

  // Construct payload
  const payload = {
    data: [
      {
        event_name: 'Aimerce_Target',
        event_time: Math.floor(new Date(body.created_at).getTime() / 1000),
        action_source: 'website',
        user_data: {
          em: [body.email ? crypto.createHash('sha256').update(body.email.trim().toLowerCase()).digest('hex') : null],
          client_ip_address: body.browser_ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '0.0.0.0',
          client_user_agent: body.browser_user_agent || req.headers['user-agent'] || 'unknown',
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
    const response = await fetch(`https://graph.facebook.com/v18.0/${process.env.META_PIXEL_ID}/events?access_token=${process.env.META_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

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
