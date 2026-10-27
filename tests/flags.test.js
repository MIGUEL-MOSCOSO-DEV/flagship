import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { evaluate } from '../shared/evaluation.js';
import { FlagshipClient } from '../sdk/client.js';
let f, owner, other, id, envId, flagId, keyId, token;
before(async () => {
  f = await fixture();
  owner = await f.register('Owner');
  other = await f.register('Other');
});
after(async () => f.close());
test('el proyecto y sus entornos son privados', async () => {
  let result = await f.request('/workspace/projects', {
    cookie: owner.cookie,
    method: 'POST',
    body: { name: 'Proyecto' },
  });
  id = result.data.id;
  assert.equal(
    (await f.request('/workspace/projects/' + id, { cookie: other.cookie })).status,
    404,
  );
  result = await f.request('/workspace/projects/' + id + '/environments', {
    cookie: owner.cookie,
    method: 'POST',
    body: { name: 'Producción', key: 'production' },
  });
  envId = result.data.id;
  result = await f.request('/workspace/projects/' + id + '/flags', {
    cookie: owner.cookie,
    method: 'POST',
    body: { key: 'new-flow', description: '' },
  });
  flagId = result.data.id;
  result = await f.request('/workspace/projects/' + id + '/keys', {
    cookie: owner.cookie,
    method: 'POST',
    body: { environmentId: envId, name: 'Servidor' },
  });
  token = result.data.token;
  keyId = result.data.id;
});
test('una clave solo evalúa y no expone su token en el estado', async () => {
  const state = await f.request('/workspace/projects/' + id, { cookie: owner.cookie });
  assert.equal(JSON.stringify(state.data).includes(token), false);
  assert.equal(
    (
      await f.request('/evaluate/new-flow', {
        method: 'POST',
        body: { key: 'subject' },
        headers: { Authorization: 'Bearer ' + token },
      })
    ).data.value,
    false,
  );
  assert.equal(
    (await f.request('/workspace/state', { headers: { Authorization: 'Bearer ' + token } })).status,
    401,
  );
});
test('la lista permitida se aplica con regla habilitada y respeta versiones', async () => {
  const path = '/workspace/projects/' + id + '/flags/' + flagId + '/environments/' + envId;
  const input = { enabled: true, percentage: 0, allowlist: ['allowed'], version: 0 };
  assert.equal(
    (await f.request(path, { cookie: owner.cookie, method: 'PUT', body: input })).status,
    200,
  );
  assert.equal(
    (await f.request(path, { cookie: owner.cookie, method: 'PUT', body: input })).status,
    409,
  );
  assert.equal(
    (
      await f.request('/evaluate/new-flow', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: { key: 'allowed' },
      })
    ).data.value,
    true,
  );
  assert.equal(
    (
      await f.request('/evaluate/new-flow', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: { key: 'other' },
      })
    ).data.value,
    false,
  );
  assert.equal(
    (await f.request('/workspace/projects/' + id, { cookie: owner.cookie })).data.audit.length,
    1,
  );
});
test('el rollout es estable y los extremos son exactos', () => {
  const context = { flagKey: 'flag', environmentId: 'environment', subject: 'stable-user' };
  assert.deepEqual(
    evaluate({ enabled: true, percentage: 25, allowlist: [] }, context),
    evaluate({ enabled: true, percentage: 25, allowlist: [] }, context),
  );
  assert.equal(evaluate({ enabled: true, percentage: 100, allowlist: [] }, context).value, true);
  assert.equal(
    evaluate({ enabled: false, percentage: 100, allowlist: ['stable-user'] }, context).value,
    false,
  );
});
test('revocar la clave bloquea nuevas evaluaciones', async () => {
  await f.request('/workspace/projects/' + id + '/keys/' + keyId, {
    cookie: owner.cookie,
    method: 'DELETE',
  });
  assert.equal(
    (
      await f.request('/evaluate/new-flow', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: { key: 'allowed' },
      })
    ).status,
    401,
  );
});
test('el SDK usa caché acotada y falla con valor seguro', async () => {
  let calls = 0;
  const client = new FlagshipClient({
    baseUrl: 'https://example.com',
    apiKey: 'test',
    fetcher: async () => {
      calls++;
      return { ok: true, json: async () => ({ value: true }) };
    },
  });
  assert.equal(await client.variation('flag', 'user'), true);
  assert.equal(await client.variation('flag', 'user'), true);
  assert.equal(calls, 1);
  client.clearCache();
  await client.variation('flag', 'user');
  assert.equal(calls, 2);
  const failed = new FlagshipClient({
    baseUrl: 'https://example.com',
    apiKey: 'test',
    fetcher: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(await failed.variation('flag', 'user'), false);
});
