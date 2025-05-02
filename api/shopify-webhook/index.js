const axios = require("axios");

module.exports = async (req, res) => {
  try {
    const body = req.body;

    // Construct Meta CAPI event payload properly
    const payload = {
      data: [
        {
          event_name: "Aimerce_Target",
          event_time: Math.floor(new Date(body.created_at).getTime() / 1000),
          action_source: "website",
          user_data: {
            em: [body.email ? require('crypto').createHash('sha256').update(body.email.trim().toLowerCase()).digest('hex') : null],
            client_ip_address: body.browser_ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            client_user_agent: body.browser_user_agent || req.headers['user-agent'],
          },
          custom_data: {
            currency: body.currency || "GBP",
            value: body.total_price,
            order_id: body.id,
          },
        },
      ],
    };

    // POST to Meta
    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v18.0/${process.env.META_PIXEL_ID}/events`,
      headers: { "Content-Type": "application/json" },
      params: { access_token: process.env.META_ACCESS_TOKEN },
      data: payload,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Meta API error:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};
