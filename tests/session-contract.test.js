import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.LOVE_API_USE_MEMORY_SUPABASE = '1';

const { default: handler } = await import('../api/v1.js');

function createReq({ method = 'GET', url = '/', body = undefined, headers = {} } = {}) {
  return {
    method,
    url,
    body,
    headers: {
      host: 'localhost:3000',
      ...headers,
    },
  };
}

function createRes() {
  const state = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
  };

  const res = {
    setHeader(name, value) {
      state.headers[String(name).toLowerCase()] = value;
      return res;
    },
    status(code) {
      state.statusCode = code;
      return res;
    },
    json(payload) {
      state.body = payload;
      state.ended = true;
      return res;
    },
    send(payload) {
      if (typeof payload === 'string') {
        try {
          state.body = JSON.parse(payload);
        } catch {
          state.body = payload;
        }
      } else {
        state.body = payload;
      }
      state.ended = true;
      return res;
    },
    end(payload) {
      if (payload !== undefined) {
        state.body = payload;
      }
      state.ended = true;
      return res;
    },
    get state() {
      return state;
    },
  };

  return res;
}

async function invoke({ method, url, body, headers } = {}) {
  const req = createReq({ method, url, body, headers });
  const res = createRes();
  await handler(req, res);
  return res.state;
}

function assertSuccess(response, label) {
  assert.equal(response.statusCode >= 200 && response.statusCode < 300, true, `${label}: unexpected HTTP status ${response.statusCode}`);
  assert.equal(response.body?.success, true, `${label}: success flag is false`);
}

test('patient login, queue enter, and session endpoints are wired end-to-end', async () => {
  const login = await invoke({
    method: 'POST',
    url: '/api/v1/patient/login',
    body: {
      personalId: '12345678901',
      gender: 'male',
    },
  });

  assertSuccess(login, 'patient login');
  assert.ok(login.body.sessionId, 'patient login did not return sessionId');

  const queueEnter = await invoke({
    method: 'POST',
    url: '/api/v1/queue/enter',
    body: {
      sessionId: login.body.sessionId,
      clinicId: 'lab',
      examType: 'recruitment',
      patientName: 'Test Patient',
    },
  });

  assertSuccess(queueEnter, 'queue enter');
  assert.ok(queueEnter.body.display_number || queueEnter.body.position, 'queue enter did not return a queue position');

  const status = await invoke({
    method: 'GET',
    url: '/api/v1/queue/status?clinicId=lab',
  });

  assertSuccess(status, 'queue status');
  assert.equal(status.body.clinicId, 'lab');
  assert.equal(typeof status.body.waitingCount, 'number');

  const validate = await invoke({
    method: 'POST',
    url: '/api/v1/session/validate',
    body: {
      token: login.body.sessionId,
    },
  });

  assertSuccess(validate, 'session validate');
  assert.equal(validate.body.valid, true);
  assert.equal(validate.body.sessionId, login.body.sessionId);
  assert.equal(validate.body.session?.personalId, '12345678901');

  const device = await invoke({
    method: 'POST',
    url: '/api/v1/session/device',
    body: {
      token: login.body.sessionId,
      device: 'iPhone',
    },
  });

  assertSuccess(device, 'session device');
  assert.equal(device.body.registered, true);
  assert.equal(device.body.device, 'iPhone');

  const validateAfterDevice = await invoke({
    method: 'POST',
    url: '/api/v1/session/validate',
    body: {
      token: login.body.sessionId,
    },
  });

  assertSuccess(validateAfterDevice, 'session validate after device');
  assert.equal(validateAfterDevice.body.session?.device, 'iPhone');
});
