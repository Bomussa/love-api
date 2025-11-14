/**
 * Supabase Client Helper - إصدار مُصحح
 * للاتصال بقاعدة البيانات الحقيقية
 * 
 * التغييرات المطلوبة:
 * - استبدال VITE_SUPABASE_URL بـ SUPABASE_URL
 * - استبدال VITE_SUPABASE_ANON_KEY بـ SUPABASE_ANON_KEY  
 * - إضافة دعم SERVICE_ROLE_KEY للعمليات الإدارية
 */

// ✅ متغيرات صحيحة للـ Backend (بدون VITE_)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1and1cnV1b3NmZmN4YXp5bWl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEzODcyNjUsImV4cCI6MjA3Njk2MzI2NX0.HnrSwc7OZTqZRzCwzBH8hqtgtHMBix4yxy0RKvRDX10';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // للعمليات الإدارية

export async function supabaseQuery(table, options = {}) {
    const { select = '*', filter = {}, limit, order } = options;

    let url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}`;

    // Add filters
    Object.entries(filter).forEach(([key, value]) => {
        url += `&${key}=eq.${value}`;
    });

    // Add limit
    if (limit) {
        url += `&limit=${limit}`;
    }

    // Add order
    if (order) {
        url += `&order=${order}`;
    }

    const response = await fetch(url, {
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Supabase query failed: ${response.statusText}`);
    }

    return await response.json();
}

export async function supabaseInsert(table, data) {
    const url = `${SUPABASE_URL}/rest/v1/${table}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        throw new Error(`Supabase insert failed: ${response.statusText}`);
    }

    return await response.json();
}

export async function supabaseUpdate(table, filter, data) {
    let url = `${SUPABASE_URL}/rest/v1/${table}?`;

    Object.entries(filter).forEach(([key, value], index) => {
        if (index > 0) url += '&';
        url += `${key}=eq.${value}`;
    });

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        throw new Error(`Supabase update failed: ${response.statusText}`);
    }

    return await response.json();
}

// دالة إضافية للعمليات الإدارية (تتطلب SERVICE_ROLE_KEY)
export async function supabaseAdminOperation(table, operation, data) {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('SERVICE_ROLE_KEY is required for admin operations');
    }

    const url = `${SUPABASE_URL}/rest/v1/${table}`;

    const response = await fetch(url, {
        method: operation,
        headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        throw new Error(`Supabase admin operation failed: ${response.statusText}`);
    }

    return await response.json();
}