// PIN Status endpoint
import { supabaseQuery } from './supabase-client.js';

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        if (req.method === 'GET') {
            // Get today's PIN status
            const today = new Date().toISOString().split('T')[0];
            
            // Mock data for now (would query Supabase in production)
            const pinStatus = {
                success: true,
                date: today,
                pin_available: true,
                pin_code: "****", // Hidden for security
                expires_at: new Date(Date.now() + 24*60*60*1000).toISOString(),
                status: 'active',
                timestamp: new Date().toISOString()
            };

            return res.status(200).json(pinStatus);
        }

        return res.status(405).json({
            success: false,
            error: 'Method not allowed'
        });

    } catch (error) {
        console.error('PIN Status Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
}