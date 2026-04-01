/**
 * Simple API Index
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return res.status(200).json({
    status: 'OK',
    message: 'API is running',
    version: '4.0.0',
    timestamp: new Date().toISOString()
  });
}
