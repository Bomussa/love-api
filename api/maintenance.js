// love-api/api/maintenance.js
// Vercel Serverless Function for Automatic Maintenance Mode

import { createEnv } from '../lib/env';

// This function will be triggered by a cron job or a health check failure
// It checks the system status and returns a maintenance page if needed.

export default async (req, res) => {
  const env = createEnv();
  const { method } = req;

  if (method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${method} Not Allowed`);
  }

  // 1. Check for a global maintenance flag (e.g., in a simple KV store or environment variable)
  // Since we don't have a real KV store here, we'll use a mock check.
  const isGlobalMaintenanceActive = env.MAINTENANCE_MODE === 'true';

  // 2. Check the health of critical services (e.g., Database, Supabase Functions)
  // In a real scenario, this would involve actual pings to the services.
  // Here, we rely on the enhanced health check from v1.js (if available) or a simple mock.
  
  let systemStatus = 'healthy';
  let detailedStatus = {};

  try {
    // Attempt to get detailed status from the main API endpoint
    const statusResponse = await fetch(`${req.headers.host}/api/v1/status`);
    if (statusResponse.ok) {
      detailedStatus = await statusResponse.json();
      if (detailedStatus.status !== 'operational') {
        systemStatus = 'degraded';
      }
    } else {
      systemStatus = 'down';
    }
  } catch (error) {
    systemStatus = 'down';
  }

  // Decision Logic for Maintenance Mode
  const shouldActivateMaintenance = isGlobalMaintenanceActive || systemStatus === 'down';

  if (shouldActivateMaintenance) {
    // Return a simple JSON response for the frontend to handle
    return res.status(503).json({
      success: false,
      error: 'Service Unavailable',
      message: 'The system is currently undergoing maintenance or experiencing a critical failure. Please try again later.',
      maintenance_active: true,
      system_status: systemStatus
    });
  }

  // If all is well, return a simple status
  return res.status(200).json({
    success: true,
    message: 'System is operational. No maintenance required.',
    maintenance_active: false,
    system_status: systemStatus
  });
};
