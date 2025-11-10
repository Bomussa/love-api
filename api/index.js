export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    return res.status(200).json({
        success: true,
        message: 'API is working!',
        timestamp: new Date().toISOString(),
        path: req.url,
        method: req.method
    });
}