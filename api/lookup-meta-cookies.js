let cookieStore = {}; // You can import/share this in Vercel edge function memory if needed

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const key = req.query.key;

  if (!key || !cookieStore[key]) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { fbp, fbc } = cookieStore[key];

  return res.status(200).json({ fbp, fbc });
}
