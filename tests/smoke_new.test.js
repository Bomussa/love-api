import fetch from 'node-fetch';

const API_URL = 'http://localhost:3000/api/v1';

async function runTest() {
  console.log('Starting Smoke Test...');
  
  try {
    // 1. Health Check
    const health = await fetch(`${API_URL}/health`).then(r => r.json());
    console.log('Health Check:', health.success ? '✅' : '❌');

    // 2. Patient Login
    const login = await fetch(`${API_URL}/patient/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalId: '55', gender: 'male', examType: 'recruitment' })
    }).then(r => r.json());
    console.log('Patient Login:', login.success ? '✅' : '❌');
    
    if (login.success) {
      console.log('Patient Flow:', login.data.flow.join(' -> '));
    }

  } catch (err) {
    console.error('Test Failed:', err.message);
  }
}

runTest();
