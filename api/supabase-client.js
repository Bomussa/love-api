/**
 * Supabase Client Helper - Unified Service Role Version
 * المصدر الوحيد للحقيقة: استخدام Service Role Key لجميع عمليات الـ Backend
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
// استخدام Service Role Key حصرياً في الـ Backend لضمان الوصول الكامل وتجاوز RLS
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_SECRET;

if (!SUPABASE_KEY) {
    console.error('CRITICAL: SUPABASE_SERVICE_ROLE_KEY is missing in environment variables');
}

const commonHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

export async function supabaseQuery(table, options = {}) {
    const { select = '*', filter = {}, limit, order } = options;
    let url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}`;
    
    Object.entries(filter).forEach(([key, value]) => {
        url += `&${key}=eq.${value}`;
    });

    if (limit) url += `&limit=${limit}`;
    if (order) url += `&order=${order}`;

    const response = await fetch(url, { headers: commonHeaders });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Supabase query failed: ${JSON.stringify(error)}`);
    }
    return await response.json();
}

export async function supabaseInsert(table, data) {
    const url = `${SUPABASE_URL}/rest/v1/${table}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Supabase insert failed: ${JSON.stringify(error)}`);
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
        headers: commonHeaders,
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Supabase update failed: ${JSON.stringify(error)}`);
    }
    return await response.json();
}

export async function supabaseDelete(table, filter) {
    let url = `${SUPABASE_URL}/rest/v1/${table}?`;
    Object.entries(filter).forEach(([key, value], index) => {
        if (index > 0) url += '&';
        url += `${key}=eq.${value}`;
    });
    const response = await fetch(url, {
        method: 'DELETE',
        headers: commonHeaders
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Supabase delete failed: ${JSON.stringify(error)}`);
    }
    return true;
}

export async function supabaseRpc(functionName, params = {}) {
    const url = `${SUPABASE_URL}/rest/v1/rpc/${functionName}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify(params)
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Supabase RPC failed: ${JSON.stringify(error)}`);
    }
    return await response.json();
}
