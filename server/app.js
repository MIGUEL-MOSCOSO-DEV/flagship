import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { createBase, finishApi, problem, text } from './core.js';
import { createToken, hashToken } from './auth.js';
import { transaction } from './db.js';
import { evaluate } from '../shared/evaluation.js';
const slug = text(80).regex(/^[a-z][a-z0-9_.-]{1,79}$/);
const policySchema = z.object({
  enabled: z.boolean(),
  percentage: z.number().min(0).max(100).multipleOf(0.01),
  allowlist: z.array(text(200).min(1)).max(100),
  version: z.number().int().min(0),
});
const readPolicy = (row) =>
  row
    ? {
        enabled: Boolean(row.enabled),
        percentage: row.percentage,
        allowlist: JSON.parse(row.allowlist),
        version: row.version,
      }
    : { enabled: false, percentage: 0, allowlist: [], version: 0 };
export function createApp(db, options = { appUrl: 'http://localhost:3800' }) {
  const { app, workspace } = createBase(db, options);
  function own(id, userId) {
    const row = db.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').get(id, userId);
    if (!row) throw problem(404, 'No se encontró el proyecto.');
    return row;
  }
  function environment(id, projectId) {
    const row = db
      .prepare('SELECT * FROM environments WHERE id=? AND project_id=?')
      .get(id, projectId);
    if (!row) throw problem(404, 'No se encontró el entorno.');
    return row;
  }
  function flag(id, projectId) {
    const row = db.prepare('SELECT * FROM flags WHERE id=? AND project_id=?').get(id, projectId);
    if (!row) throw problem(404, 'No se encontró la función.');
    return row;
  }
  function policy(flagId, environmentId) {
    return readPolicy(
      db
        .prepare('SELECT * FROM policies WHERE flag_id=? AND environment_id=?')
        .get(flagId, environmentId),
    );
  }
  workspace.get('/state', (req, res) =>
    res.json({
      projects: db
        .prepare(
          'SELECT id,name,created_at AS createdAt FROM projects WHERE user_id=? ORDER BY created_at',
        )
        .all(req.user.id),
    }),
  );
  workspace.post('/projects', (req, res) => {
    const input = z.object({ name: text(120).min(1) }).parse(req.body);
    const id = randomUUID();
    db.prepare('INSERT INTO projects(id,user_id,name,created_at) VALUES(?,?,?,?)').run(
      id,
      req.user.id,
      input.name,
      new Date().toISOString(),
    );
    res.status(201).json({ id });
  });
  workspace.get('/projects/:id', (req, res) => {
    const project = own(req.params.id, req.user.id);
    const environments = db
      .prepare('SELECT id,name,key FROM environments WHERE project_id=? ORDER BY name')
      .all(project.id);
    const flags = db
      .prepare('SELECT id,key,description FROM flags WHERE project_id=? ORDER BY key')
      .all(project.id)
      .map((flag) => ({
        ...flag,
        policies: Object.fromEntries(environments.map((env) => [env.id, policy(flag.id, env.id)])),
      }));
    res.json({
      project: { id: project.id, name: project.name },
      environments,
      flags,
      keys: db
        .prepare(
          'SELECT api_keys.id,environment_id AS environmentId,api_keys.name,prefix,revoked,created_at AS createdAt,last_used AS lastUsed FROM api_keys JOIN environments ON environments.id=api_keys.environment_id WHERE project_id=? ORDER BY api_keys.created_at DESC',
        )
        .all(project.id),
      audit: db
        .prepare(
          'SELECT id,actor,flag_key AS flagKey,environment_name AS environmentName,before_json AS beforeJson,after_json AS afterJson,created_at AS createdAt FROM audit WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',
        )
        .all(project.id),
    });
  });
  workspace.post('/projects/:id/environments', (req, res) => {
    own(req.params.id, req.user.id);
    const input = z.object({ name: text(80).min(1), key: slug }).parse(req.body);
    if (
      db
        .prepare('SELECT id FROM environments WHERE project_id=? AND key=?')
        .get(req.params.id, input.key)
    )
      throw problem(409, 'Ese identificador de entorno ya existe.');
    const id = randomUUID();
    db.prepare('INSERT INTO environments(id,project_id,name,key) VALUES(?,?,?,?)').run(
      id,
      req.params.id,
      input.name,
      input.key,
    );
    res.status(201).json({ id });
  });
  workspace.post('/projects/:id/flags', (req, res) => {
    own(req.params.id, req.user.id);
    const input = z.object({ key: slug, description: text(1000) }).parse(req.body);
    if (
      db.prepare('SELECT id FROM flags WHERE project_id=? AND key=?').get(req.params.id, input.key)
    )
      throw problem(409, 'Esa clave ya existe.');
    const id = randomUUID();
    db.prepare('INSERT INTO flags(id,project_id,key,description) VALUES(?,?,?,?)').run(
      id,
      req.params.id,
      input.key,
      input.description,
    );
    res.status(201).json({ id });
  });
  workspace.put('/projects/:id/flags/:flagId/environments/:envId', (req, res) => {
    own(req.params.id, req.user.id);
    const f = flag(req.params.flagId, req.params.id);
    const env = environment(req.params.envId, req.params.id);
    const input = policySchema.parse(req.body);
    transaction(db, () => {
      const previous = policy(f.id, env.id);
      if (previous.version !== input.version)
        throw problem(409, 'La regla cambió en otra sesión. Actualiza antes de guardar.');
      db.prepare(
        'INSERT INTO policies(flag_id,environment_id,enabled,percentage,allowlist,version) VALUES(?,?,?,?,?,?) ON CONFLICT(flag_id,environment_id) DO UPDATE SET enabled=excluded.enabled,percentage=excluded.percentage,allowlist=excluded.allowlist,version=excluded.version',
      ).run(
        f.id,
        env.id,
        Number(input.enabled),
        input.percentage,
        JSON.stringify([...new Set(input.allowlist)]),
        input.version + 1,
      );
      db.prepare(
        'INSERT INTO audit(id,project_id,actor,flag_key,environment_name,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)',
      ).run(
        randomUUID(),
        req.params.id,
        JSON.parse(req.user.profile).name,
        f.key,
        env.name,
        JSON.stringify(previous),
        JSON.stringify({ ...input, version: input.version + 1 }),
        new Date().toISOString(),
      );
    });
    res.json({ policy: policy(f.id, env.id) });
  });
  workspace.post('/projects/:id/keys', (req, res) => {
    own(req.params.id, req.user.id);
    const input = z
      .object({ environmentId: z.string().uuid(), name: text(80).min(1) })
      .parse(req.body);
    environment(input.environmentId, req.params.id);
    const token = 'fs_' + createToken();
    const id = randomUUID();
    db.prepare(
      'INSERT INTO api_keys(id,environment_id,name,prefix,token_hash,created_at) VALUES(?,?,?,?,?,?)',
    ).run(
      id,
      input.environmentId,
      input.name,
      token.slice(0, 11),
      hashToken(token),
      new Date().toISOString(),
    );
    res.status(201).json({ id, token });
  });
  workspace.delete('/projects/:id/keys/:keyId', (req, res) => {
    own(req.params.id, req.user.id);
    const row = db
      .prepare(
        'SELECT api_keys.id FROM api_keys JOIN environments ON environments.id=api_keys.environment_id WHERE api_keys.id=? AND environments.project_id=?',
      )
      .get(req.params.keyId, req.params.id);
    if (!row) throw problem(404, 'No se encontró la clave.');
    db.prepare('UPDATE api_keys SET revoked=1 WHERE id=?').run(row.id);
    res.json({ ok: true });
  });
  workspace.post('/projects/:id/test', (req, res) => {
    own(req.params.id, req.user.id);
    const input = z
      .object({
        environmentId: z.string().uuid(),
        flagId: z.string().uuid(),
        subject: text(200).min(1),
      })
      .parse(req.body);
    environment(input.environmentId, req.params.id);
    const f = flag(input.flagId, req.params.id);
    res.json(
      evaluate(policy(f.id, input.environmentId), {
        flagKey: f.key,
        environmentId: input.environmentId,
        subject: input.subject,
      }),
    );
  });
  const limiter = rateLimit({
    windowMs: 60000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Límite de evaluaciones alcanzado.' },
  });
  function authorize(req, res, next) {
    const token = req.headers.authorization?.match(/^Bearer (fs_[A-Za-z0-9_-]{43})$/)?.[1];
    const key = token
      ? db
          .prepare(
            'SELECT api_keys.id,environment_id,project_id FROM api_keys JOIN environments ON environments.id=api_keys.environment_id WHERE token_hash=? AND revoked=0',
          )
          .get(hashToken(token))
      : null;
    if (!key) return next(problem(401, 'Clave de evaluación no válida.'));
    req.evaluationKey = key;
    db.prepare('UPDATE api_keys SET last_used=? WHERE id=?').run(new Date().toISOString(), key.id);
    next();
  }
  app.post('/api/evaluate/:flagKey', limiter, authorize, (req, res) => {
    const input = z.object({ key: text(200).min(1) }).parse(req.body);
    const env = req.evaluationKey;
    const f = db
      .prepare('SELECT * FROM flags WHERE project_id=? AND key=?')
      .get(env.project_id, req.params.flagKey);
    if (!f) throw problem(404, 'La función no existe en este proyecto.');
    res.json({
      ...evaluate(policy(f.id, env.environment_id), {
        flagKey: f.key,
        environmentId: env.environment_id,
        subject: input.key,
      }),
      key: f.key,
    });
  });
  workspace.get('/sdk', (req, res) => res.download(resolve('sdk/client.js'), 'flagship-client.js'));
  return finishApi(app);
}
