import React, { useState } from 'react';
import {
  Plus,
  Code2,
  KeyRound,
  Flag,
  Terminal,
  History,
  Download,
  SlidersHorizontal,
} from 'lucide-react';
import { api } from './api.js';
import {
  Session,
  Brand,
  Identity,
  Button,
  Field,
  Modal,
  Notice,
  Empty,
  useTask,
  useData,
  dateLabel,
} from './ui.jsx';
export default function App() {
  return <Session>{(user, onUser) => <Control user={user} onUser={onUser} />}</Session>;
}
function Control({ user, onUser }) {
  const { data, error, reload } = useData('/workspace/state');
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState(false);
  const task = useTask();
  const id = selected || data?.projects[0]?.id;
  return (
    <div className="flag-control">
      <aside className="project-tree">
        <Brand />
        <div className="tree-label">
          PROJECTS{' '}
          <button className="icon" aria-label="Crear proyecto" onClick={() => setCreating(true)}>
            <Plus size={15} />
          </button>
        </div>
        {data?.projects.map((p) => (
          <button
            className={'tree-project ' + (p.id === id ? 'active' : '')}
            key={p.id}
            onClick={() => setSelected(p.id)}
          >
            <span>▧</span>
            {p.name}
          </button>
        ))}
        <div className="tree-foot">
          <span>FLAGSHIP / CONTROL PLANE</span>
          <Identity user={user} onUser={onUser} />
        </div>
      </aside>
      <main>
        <Notice error={error || task.error} />
        {id ? (
          <Project key={id} id={id} />
        ) : (
          <div className="flag-start">
            <span className="code-label">$ flagship init</span>
            <h1>
              El código ya está.
              <br />
              <em>El control empieza aquí.</em>
            </h1>
            <p>Crea un proyecto, define un entorno y decide quién ve cada funcionalidad.</p>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> Crear primer proyecto
            </Button>
            <div className="flag-steps">
              <span>01 / PROJECT</span>
              <span>02 / ENVIRONMENT</span>
              <span>03 / FLAGS</span>
            </div>
          </div>
        )}
      </main>
      {creating && (
        <Modal title="Crear proyecto" onClose={() => setCreating(false)}>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              const name = new FormData(event.currentTarget).get('name');
              task.perform(async () => {
                const result = await api('/workspace/projects', { method: 'POST', body: { name } });
                setCreating(false);
                await reload();
                setSelected(result.id);
              });
            }}
          >
            <Notice error={task.error} />
            <Field label="Nombre del proyecto" name="name" maxLength={120} required />
            <Button busy={task.busy}>Crear proyecto</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function Project({ id }) {
  const { data, error, reload } = useData('/workspace/projects/' + id);
  const [tab, setTab] = useState('flags');
  const [environmentId, setEnvironmentId] = useState('');
  const [form, setForm] = useState(null);
  const [secret, setSecret] = useState('');
  const [result, setResult] = useState(null);
  const task = useTask();
  const env = environmentId || data?.environments[0]?.id;
  const endpoint = '/workspace/projects/' + id;
  const snippet =
    "import { FlagshipClient } from './flagship-client.js';\n\nconst flags = new FlagshipClient({\n  baseUrl: process.env.FLAGSHIP_URL,\n  apiKey: process.env.FLAGSHIP_API_KEY,\n  ttl: 30000,\n  fallback: false,\n});\n\nconst enabled = await flags.variation(\n  process.env.FLAG_KEY,\n  currentUser.id,\n);";
  if (!data)
    return (
      <>
        <Notice error={error} />
        <p className="code-loading">Loading project…</p>
      </>
    );
  return (
    <>
      <header className="flag-header">
        <div>
          <span className="eyebrow">WORKSPACE / {data.project.name}</span>
          <h1>Feature control</h1>
        </div>
        <select
          aria-label="Entorno activo"
          value={env || ''}
          onChange={(event) => setEnvironmentId(event.target.value)}
        >
          <option value="" disabled>
            Seleccionar entorno
          </option>
          {data.environments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <button
          className="icon"
          aria-label="Crear entorno"
          onClick={() => setForm({ type: 'environment' })}
        >
          <Plus size={17} />
        </button>
      </header>
      <nav className="flag-tabs">
        {[
          ['flags', Flag, 'Flags'],
          ['keys', KeyRound, 'API keys'],
          ['audit', History, 'Audit log'],
          ['sdk', Code2, 'SDK & playground'],
        ].map(([key, Icon, label]) => (
          <button className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>
      <div className="flag-content">
        <Notice error={error || task.error} />
        {tab === 'flags' ? (
          <>
            <div className="flag-section-title">
              <p>
                {data.flags.length} funciones ·{' '}
                {data.environments.find((e) => e.id === env)?.name || 'Configura tu primer entorno'}
              </p>
              <Button onClick={() => setForm({ type: 'flag' })}>
                <Plus size={15} /> Nueva flag
              </Button>
            </div>
            <section className="flag-sheet">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Key / descripción</th>
                      <th>Estado</th>
                      <th>Rollout</th>
                      <th>Versión</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.flags.map((f) => {
                      const p = f.policies[env] || {
                        enabled: false,
                        percentage: 0,
                        allowlist: [],
                        version: 0,
                      };
                      return (
                        <tr key={f.id}>
                          <td>
                            <code>{f.key}</code>
                            <small>{f.description}</small>
                          </td>
                          <td>
                            <button
                              className={'flag-switch ' + (p.enabled ? 'on' : '')}
                              aria-label={(p.enabled ? 'Desactivar ' : 'Activar ') + f.key}
                              disabled={!env || task.busy}
                              onClick={() =>
                                task.perform(async () => {
                                  await api(endpoint + '/flags/' + f.id + '/environments/' + env, {
                                    method: 'PUT',
                                    body: { ...p, enabled: !p.enabled },
                                  });
                                  await reload();
                                })
                              }
                            >
                              <i />
                              {p.enabled ? 'Enabled' : 'Disabled'}
                            </button>
                          </td>
                          <td>{p.percentage}%</td>
                          <td className="flag-version">v{p.version}</td>
                          <td>
                            <button
                              className="icon"
                              aria-label={'Configurar ' + f.key}
                              disabled={!env}
                              onClick={() => setForm({ type: 'policy', flag: f, policy: p })}
                            >
                              <SlidersHorizontal size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!data.flags.length && (
                <Empty
                  title="Cada lanzamiento empieza con una decisión."
                  action={
                    <Button secondary onClick={() => setForm({ type: 'flag' })}>
                      Crear una flag
                    </Button>
                  }
                >
                  Las funciones se evalúan como desactivadas hasta que configures sus reglas en un
                  entorno.
                </Empty>
              )}
            </section>
          </>
        ) : tab === 'keys' ? (
          <>
            <div className="flag-section-title">
              <p>Credenciales de solo evaluación. Una clave, un entorno.</p>
              <Button disabled={!data.environments.length} onClick={() => setForm({ type: 'key' })}>
                <Plus size={15} /> Crear API key
              </Button>
            </div>
            <div className="key-list">
              {data.keys.map((k) => (
                <article key={k.id}>
                  <KeyRound size={20} />
                  <div>
                    <h3>{k.name}</h3>
                    <code>{k.prefix}••••••••</code>
                    <p>
                      {data.environments.find((e) => e.id === k.environmentId)?.name} ·{' '}
                      {k.revoked ? 'Revocada' : 'Activa'} · Último uso: {dateLabel(k.lastUsed)}
                    </p>
                  </div>
                  {!k.revoked && (
                    <Button
                      secondary
                      busy={task.busy}
                      onClick={() =>
                        task.perform(async () => {
                          await api(endpoint + '/keys/' + k.id, { method: 'DELETE' });
                          await reload();
                        })
                      }
                    >
                      Revocar
                    </Button>
                  )}
                </article>
              ))}
              {!data.keys.length && (
                <Empty title="Todavía no hay credenciales.">
                  Crea un entorno y genera una clave para integrar tu servidor.
                </Empty>
              )}
            </div>
          </>
        ) : tab === 'audit' ? (
          <div className="audit-log">
            {data.audit.map((a) => (
              <article key={a.id}>
                <time>{dateLabel(a.createdAt)}</time>
                <div>
                  <code>{a.flagKey}</code>
                  <p>
                    {a.actor} / {a.environmentName}
                  </p>
                  <details>
                    <summary>Ver cambio registrado</summary>
                    <pre>
                      {JSON.stringify(
                        { before: JSON.parse(a.beforeJson), after: JSON.parse(a.afterJson) },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
              </article>
            ))}
            {!data.audit.length && (
              <Empty title="Las decisiones también tienen historial.">
                Cada cambio de regla guardará su versión anterior, nueva versión, entorno y autor.
              </Empty>
            )}
          </div>
        ) : (
          <div className="sdk-layout">
            <section>
              <span className="code-label">SERVER-SIDE JAVASCRIPT</span>
              <h2>Conecta. Evalúa. Decide.</h2>
              <p>
                La clave se usa en tu servidor, nunca en el código público del navegador. El SDK
                conserva resultados hasta 30 segundos y devuelve false si la evaluación falla.
              </p>
              <pre>{snippet}</pre>
              <a className="button secondary" href="/api/workspace/sdk" download>
                <Download size={15} /> Descargar SDK
              </a>
            </section>
            <section className="playground">
              <Terminal size={22} />
              <h2>Prueba una regla</h2>
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  const values = Object.fromEntries(new FormData(event.currentTarget));
                  task.perform(async () =>
                    setResult(
                      await api(endpoint + '/test', {
                        method: 'POST',
                        body: { ...values, environmentId: env },
                      }),
                    ),
                  );
                }}
              >
                <Field label="Flag">
                  <select name="flagId" required>
                    <option value="">Seleccionar</option>
                    {data.flags.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.key}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Identificador del usuario" name="subject" maxLength={200} required />
                <Button busy={task.busy} disabled={!env}>
                  Evaluar
                </Button>
              </form>
              {result && <pre className="evaluation-result">{JSON.stringify(result, null, 2)}</pre>}
            </section>
          </div>
        )}
      </div>
      {form && (
        <FlagForm
          value={form}
          data={data}
          endpoint={endpoint}
          env={env}
          onClose={() => setForm(null)}
          onSaved={async (result) => {
            setForm(null);
            if (result.token) setSecret(result.token);
            await reload();
            if (result.envId) setEnvironmentId(result.envId);
          }}
        />
      )}
      {secret && (
        <Modal title="Guarda tu clave de evaluación" onClose={() => setSecret('')}>
          <div className="stack">
            <p>
              Solo se muestra completa ahora. Consérvala en las variables de entorno de tu servidor.
            </p>
            <pre className="secret-key">{secret}</pre>
            <Notice error={task.error} success={task.success} />
            <Button
              onClick={() =>
                task.perform(() => navigator.clipboard.writeText(secret), 'Clave copiada.')
              }
            >
              Copiar clave
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
function FlagForm({ value, data, endpoint, env, onClose, onSaved }) {
  const task = useTask();
  function submit(event) {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget));
    task.perform(async () => {
      let result;
      if (value.type === 'environment') {
        result = await api(endpoint + '/environments', { method: 'POST', body: f });
        result.envId = result.id;
      } else if (value.type === 'flag')
        result = await api(endpoint + '/flags', { method: 'POST', body: f });
      else if (value.type === 'key')
        result = await api(endpoint + '/keys', { method: 'POST', body: f });
      else
        result = await api(endpoint + '/flags/' + value.flag.id + '/environments/' + env, {
          method: 'PUT',
          body: {
            enabled: f.enabled === 'on',
            percentage: Number(f.percentage),
            allowlist: f.allowlist
              .split('\n')
              .map((v) => v.trim())
              .filter(Boolean),
            version: value.policy.version,
          },
        });
      await onSaved(result);
    });
  }
  return (
    <Modal
      title={
        value.type === 'environment'
          ? 'Crear entorno'
          : value.type === 'flag'
            ? 'Crear feature flag'
            : value.type === 'key'
              ? 'Crear API key'
              : 'Reglas de ' + value.flag.key
      }
      onClose={onClose}
    >
      <form className="stack" onSubmit={submit}>
        <Notice error={task.error} />
        {value.type === 'policy' ? (
          <>
            <label className="policy-checkbox">
              <input type="checkbox" name="enabled" defaultChecked={value.policy.enabled} />{' '}
              Habilitar evaluación
            </label>
            <Field
              label="Porcentaje de exposición"
              type="number"
              name="percentage"
              min="0"
              max="100"
              step=".01"
              defaultValue={value.policy.percentage}
              required
            />
            <Field
              label="Identificadores permitidos (uno por línea)"
              hint="Hasta 100 identificadores. La lista solo se aplica si la regla está habilitada."
            >
              <textarea
                name="allowlist"
                defaultValue={value.policy.allowlist.join('\n')}
                rows={5}
              />
            </Field>
            <p>
              Versión actual: {value.policy.version}. Los cambios simultáneos se rechazan para
              evitar sobrescrituras.
            </p>
          </>
        ) : (
          <>
            {value.type !== 'flag' && <Field label="Nombre" name="name" required maxLength={120} />}{' '}
            {value.type === 'key' ? (
              <Field label="Entorno">
                <select name="environmentId" defaultValue={env} required>
                  {data.environments.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field
                label="Identificador"
                name="key"
                required
                pattern="[a-z][a-z0-9_.-]{1,79}"
                hint="Minúsculas, números, puntos, guiones o guiones bajos."
              />
            )}
            {value.type === 'flag' && (
              <Field label="Descripción">
                <textarea name="description" maxLength={1000} rows={3} />
              </Field>
            )}
          </>
        )}
        <Button busy={task.busy}>Guardar</Button>
      </form>
    </Modal>
  );
}
