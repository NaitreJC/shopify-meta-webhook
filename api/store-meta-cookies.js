let cookieStore = {};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { session_id, fbp, fbc } = req.body;
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;

  const key = session_id || clientIp;

  if (!key) {
    return res.status(400).json({ error: 'Missing session ID or IP' });
  }

  cookieStore[key] = {
    fbp,
    fbc,
    timestamp: Date.now()
  };

  console.log(`✅ Stored Meta cookies for ${key}`, cookieStore[key]);

  return res.status(200).json({ success: true });
}
