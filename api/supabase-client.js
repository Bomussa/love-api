/**
 * Supabase Client Helper
 * للاتصال بقاعدة البيانات الحقيقية
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

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
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
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
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
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
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
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
