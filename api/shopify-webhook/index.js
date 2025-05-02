export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  const order = req.body;

  const eventPayload = {
    data: [{
      event_name: 'Aimerce_Target',
      event_time: Math.floor(new Date(order.created_at).getTime() / 1000),
      action_source: 'website',
      event_id: `shopify_order_${order.id}`,
      user_data: {
        em: order.email ? require('crypto').createHash('sha256').update(order.email.trim().toLowerCase()).digest('hex') : null,
        ph: order.phone ? require('crypto').createHash('sha256').update(order.phone.replace(/\D/g,'')).digest('hex') : null,
        client_ip_address: order.client_details.browser_ip,
        client_user_agent: order.client_details.user_agent,
      },
      custom_data: {
        currency: order.currency,
        value: order.total_price,
      },
    }]
  };

  const fbResponse = await fetch(`https://graph.facebook.com/v19.0/${process.env.META_PIXEL_ID}/events?access_token=${process.env.META_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(eventPayload)
  });

  const fbResult = await fbResponse.json();
  res.status(200).json({ success: true, fbResult });
}
