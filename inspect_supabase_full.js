import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1and1cnV1b3NmZmN4YXp5bWl0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTM4NzI2NSwiZXhwIjoyMDc2OTYzMjY1fQ.5PWwdcBXgS1FZhwRonSRgdbnUQuXHl5VeIHvr41yUbs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function inspect() {
    console.log('--- Starting Full Supabase Inspection ---');
    
    // 1. List all tables in public schema
    const { data: tables, error: tablesError } = await supabase
        .from('pg_catalog.pg_tables')
        .select('tablename')
        .eq('schemaname', 'public');

    if (tablesError) {
        // Fallback if direct pg_catalog access is restricted
        console.log('Falling back to RPC for table listing...');
        const { data: rpcTables, error: rpcError } = await supabase.rpc('get_tables_info');
        if (rpcError) {
            console.error('Error listing tables:', rpcError);
        } else {
            console.log('Tables Found:', rpcTables);
        }
    } else {
        console.log('Tables Found:', tables.map(t => t.tablename));
    }

    // 2. Check for potential duplicates (tables with similar names)
    const knownTables = ['unified_queue', 'clinics', 'admins', 'logs', 'settings', 'appointments'];
    // We will check if there are variations like 'unified_queue_v2', 'old_clinics', etc.

    // 3. Inspect specific tables for duplicate rows (e.g., in unified_queue)
    try {
        const { data: queueData, error: queueError } = await supabase
            .from('unified_queue')
            .select('id, pin_code')
            .limit(1000);
        
        if (queueData) {
            const pinCounts = {};
            queueData.forEach(row => {
                pinCounts[row.pin_code] = (pinCounts[row.pin_code] || 0) + 1;
            });
            const duplicates = Object.entries(pinCounts).filter(([pin, count]) => count > 1);
            console.log('Duplicate PINs in unified_queue:', duplicates);
        }
    } catch (e) {
        console.log('Error checking unified_queue duplicates:', e.message);
    }

    // 4. Check for active RLS policies
    console.log('--- Inspection Finished ---');
}

inspect();
