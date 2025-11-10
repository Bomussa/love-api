// Queue Status endpoint  
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
            // Mock queue data (would query Supabase in production)
            const queueStatus = {
                success: true,
                queue_stats: {
                    total_waiting: 15,
                    average_wait_time: "12 minutes",
                    active_clinics: 3,
                    estimated_processing_time: "45 minutes"
                },
                real_time_updates: {
                    last_update: new Date().toISOString(),
                    next_patient: "Patient #042",
                    current_serving: "Patient #027"
                },
                clinics: [
                    {
                        id: 1,
                        name: "General Medicine",
                        queue_length: 8,
                        status: "active",
                        estimated_wait: "15 minutes"
                    },
                    {
                        id: 2, 
                        name: "Cardiology",
                        queue_length: 4,
                        status: "active",
                        estimated_wait: "20 minutes"
                    },
                    {
                        id: 3,
                        name: "Orthopedics", 
                        queue_length: 3,
                        status: "active",
                        estimated_wait: "10 minutes"
                    }
                ],
                timestamp: new Date().toISOString()
            };

            return res.status(200).json(queueStatus);
        }

        return res.status(405).json({
            success: false,
            error: 'Method not allowed'
        });

    } catch (error) {
        console.error('Queue Status Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
}