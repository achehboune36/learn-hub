import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'tracking-server',
  title: 'Where tracking data lives',
  summary: 'The backend store and the artifact store are two different things with two different failure modes. Understanding the split explains nearly every confusing MLflow deployment problem.',
  estimatedMinutes: 22,

  blocks: [
    {
      type: 'markdown',
      md: `
MLflow writes to **two** stores, and almost every deployment problem people hit is a consequence
of not realising this.

- The **backend store** holds the small structured records: experiments, runs, parameters,
  metrics, tags. It is a database.
- The **artifact store** holds the files: models, plots, datasets. It is blob storage.

They are configured separately, they fail separately, and — critically — in the default
configuration **they are written by different processes**. The metrics go through the tracking
server. The artifacts, by default, go directly from your training client to the blob store,
without the tracking server ever touching the bytes.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart LR
    C["Training client<br/>mlflow.log_metric()<br/>mlflow.log_model()"]

    C -->|"1. metrics, params, tags<br/>(REST)"| S["Tracking server"]
    S -->|"SQL"| DB[("Backend store<br/>PostgreSQL")]

    C ==>|"2. artifact bytes<br/>DIRECT — client needs<br/>its own S3 credentials"| B[("Artifact store<br/>s3://bucket/")]

    S -.->|"stores only the URI,<br/>never the bytes"| DB
`.trim(),
      caption: 'The default topology. The thick arrow is the one that surprises people: the client uploads artifacts itself, so it needs blob-store credentials the tracking server cannot provide.',
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'The single most common MLflow deployment bug',
      md: `A team stands up a tracking server, points clients at it, and everything works — until
someone tries to download a model and gets a path that does not exist, or an
\`Unable to locate credentials\` error at \`log_model\` time. The cause is always the same: the
client is expected to talk to the artifact store directly, and either it lacks credentials or the
server was configured with a **local filesystem** artifact root, which resolves to a directory on
the *server's* disk that the client cannot see. Proxied artifact access, below, is the fix.`,
    },
    {
      type: 'markdown',
      md: `
## The four topologies

You will meet these in roughly this order as a team grows.

### 1. Local files only
No server at all. \`mlflow.set_tracking_uri()\` is unset, so everything lands in \`./mlruns\`. The
backend store is a directory tree of files, and so is the artifact store.

Perfect for a laptop, and genuinely fine for a solo project. Its limits are hard, though: the
file store has **no model registry support**, searching is a filesystem walk that degrades badly
past a few thousand runs, and two processes writing concurrently can corrupt it.

### 2. Local database
\`--backend-store-uri sqlite:///mlflow.db\` with artifacts still on local disk. One extra flag,
and it unlocks the model registry and fast queries. This is the setup to use on a single machine
that you care about.

### 3. Remote server, direct artifact access
A tracking server on a host, PostgreSQL behind it, S3 or GCS for artifacts. Clients hit the
server for metadata and the bucket for files. Fast, because artifact bytes never pass through
the server, but every client needs cloud credentials.

### 4. Remote server, proxied artifacts
The same, with \`--serve-artifacts\`. Artifacts now flow through the tracking server, which holds
the only set of blob credentials. Clients need nothing but the server URL. You pay for this in
server bandwidth and CPU, and the server becomes a chokepoint for large model uploads — but for
most teams it is the correct trade.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Topology', 'Registry?', 'Client needs cloud credentials', 'Fails when'],
      rows: [
        ['Local files (`./mlruns`)', 'No', 'No', 'A second person joins, or you pass a few thousand runs'],
        ['SQLite + local artifacts', 'Yes', 'No', 'A second machine needs to read the artifacts'],
        ['Server + direct artifacts', 'Yes', '**Yes** — every client', 'A client lacks bucket access, or you need central audit of downloads'],
        ['Server + `--serve-artifacts`', 'Yes', 'No', 'Model artifacts are large enough that server bandwidth becomes the bottleneck'],
      ],
    },
    {
      type: 'code',
      lang: 'bash',
      filename: 'run-server.sh',
      caption: 'A production-shaped tracking server. The artifact flags are the ones worth reading twice.',
      code: `# Backend store: a real database. Postgres or MySQL — SQLite will not survive
# concurrent writers, and the file store cannot host the model registry at all.
export MLFLOW_BACKEND_STORE_URI="postgresql://mlflow:secret@db.internal:5432/mlflow"

# Apply schema migrations BEFORE starting a server on a new MLflow version.
# Skipping this is how a version upgrade turns into an outage.
mlflow db upgrade "$MLFLOW_BACKEND_STORE_URI"

# --serve-artifacts routes artifact bytes through this server, so only the server
# holds S3 credentials. Clients then use mlflow-artifacts:/ URIs and need nothing
# but the tracking URL. --workers tunes the gunicorn pool underneath.
mlflow server \\
  --host 0.0.0.0 --port 5000 \\
  --backend-store-uri "$MLFLOW_BACKEND_STORE_URI" \\
  --serve-artifacts \\
  --artifacts-destination "s3://acme-mlflow-artifacts/" \\
  --workers 4

# On the client, this is now the entire configuration:
#   export MLFLOW_TRACKING_URI=http://mlflow.internal:5000`,
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Run `mlflow db upgrade` before starting a new server version',
      md: `The backend schema changes between MLflow releases. A server started against an
older schema may run for a while and then fail on a specific operation, which is far harder to
diagnose than an upfront migration error. Make the upgrade a step in your deployment, take a
database backup before it, and **pin the MLflow version on clients and server to the same minor
release** while you roll out.`,
    },
    {
      type: 'markdown',
      md: `
## Artifact URIs, and why they matter

Every run has an artifact root, and its scheme tells you which topology you are in. Recognising
these on sight saves a great deal of debugging.

| URI you see | What it means |
|---|---|
| \`file:///home/user/mlruns/…\` | Local disk. Meaningless on any other machine. |
| \`s3://bucket/1/abc123/artifacts\` | Direct access. Whoever reads this needs bucket credentials. |
| \`mlflow-artifacts:/1/abc123/artifacts\` | Proxied. Resolved by the tracking server; the client needs nothing else. |

A \`file://\` artifact root on a shared server is the classic misconfiguration. The training
client writes to its *own* local path, the server records that path, and nobody can ever fetch
the model again — including the serving job that needs it most.
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## Referring to models: the URI schemes

Loading a model is always \`mlflow.pyfunc.load_model(uri)\`; only the URI changes, and the choice
carries real consequences.

\`\`\`
runs:/<run_id>/model              a specific run's output. Immutable, but opaque —
                                  nobody reading the deploy config knows what it is.

models:/<name>/<version>          registered model, pinned version. Explicit and stable.

models:/<name>@champion           registered model by alias. Resolves at load time,
                                  so promotion changes what deploys without a code change.
\`\`\`

Use \`runs:/\` while experimenting, \`models:/\` everywhere else. A production deployment
referencing a raw run id is a deployment nobody can reason about six months later.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'Authentication is basic, and that is deliberate',
      md: `MLflow ships a simple username/password layer via \`mlflow server --app-name basic-auth\`,
with per-user read and edit permissions on experiments and registered models. It is genuine
authentication, but it is not SSO, not fine-grained, and not audited. The common production
pattern is to run MLflow behind an existing authenticating proxy or ingress and let that handle
identity, treating MLflow's own auth as a second layer rather than the only one.`,
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'client_config.py',
      caption: 'Configuration precedence, from most to least specific. Setting it in code overrides the environment, which is a useful escape hatch and an easy way to point at the wrong server by accident.',
      code: `import os
import mlflow

# 1. Explicit call — wins over everything. Good for notebooks, dangerous in library code.
mlflow.set_tracking_uri("http://mlflow.internal:5000")

# 2. Environment variable — the right place for it in CI and containers.
#    export MLFLOW_TRACKING_URI=http://mlflow.internal:5000

# 3. Nothing set — falls back to ./mlruns in the working directory. This is why a
#    CI job "loses" its runs: the container is discarded and so are the files.

print(mlflow.get_tracking_uri())

# The registry can live somewhere else entirely, which matters when tracking is
# self-hosted but the registry is on a managed platform.
mlflow.set_registry_uri("databricks-uc://profile")

# Timeouts and retries are worth setting for flaky networks: large artifact uploads
# through a proxied server are the operation most likely to time out.
os.environ["MLFLOW_HTTP_REQUEST_TIMEOUT"] = "300"
os.environ["MLFLOW_HTTP_REQUEST_MAX_RETRIES"] = "5"`,
    },
    {
      type: 'checklist',
      title: 'Standing up a shared tracking server',
      items: [
        'PostgreSQL or MySQL as the backend store — never SQLite for a shared server',
        'Object storage as the artifact destination — never a local filesystem path',
        '`--serve-artifacts` unless you have measured that server bandwidth is the constraint',
        '`mlflow db upgrade` run against a backed-up database before each version bump',
        'Client and server pinned to the same MLflow minor version during rollout',
        'MLFLOW_TRACKING_URI set in the environment, not hard-coded in training scripts',
        'An authenticating proxy in front, with MLflow basic auth as defence in depth',
        'A lifecycle policy on the artifact bucket, decided before it holds a terabyte',
      ],
    },
  ],

  flashcards: [
    { front: 'What are the two stores MLflow writes to, and what goes in each?', back: 'The backend store, a database holding experiments, runs, params, metrics and tags; and the artifact store, blob storage holding models, plots and files.' },
    { front: 'In the default remote setup, who uploads artifact bytes?', back: 'The client, directly to the blob store. The tracking server records only the URI, which is why clients need their own cloud credentials unless --serve-artifacts is enabled.' },
    { front: 'What does an mlflow-artifacts:/ URI indicate?', back: 'Proxied artifact access. The tracking server holds the blob credentials and relays the bytes, so clients need nothing but the tracking URL.' },
    { front: 'Why can the file store not host a model registry?', back: 'The registry needs transactional, queryable state across concurrent writers. The file store is a directory tree with no such guarantees, so a database backend is required.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'A data scientist logs a model successfully against your shared tracking server, but the serving job fails to download it with a path-not-found error. The artifact URI reads file:///home/ds/mlruns/…. What went wrong?',
      options: [
        'The tracking server was configured with a local filesystem artifact root, so the model was written to the client\'s own disk',
        'The model was logged before the run was ended, so the upload never completed',
        'The serving job is using an incompatible MLflow version',
        'The backend database schema needs migrating with mlflow db upgrade',
      ],
      answerIndex: 0,
      explanation: 'A file:// artifact root means the bytes went to a path on whichever machine ran the client. The tracking server dutifully recorded that path, but it refers to nothing on any other host. The artifact destination must be object storage, or artifacts must be proxied through the server.',
    },
    {
      id: 'q2',
      prompt: 'Your clients run in CI containers that you would rather not give S3 credentials to. Which option addresses this?',
      options: [
        'Switch the backend store from PostgreSQL to SQLite',
        'Start the tracking server with --serve-artifacts and an --artifacts-destination',
        'Set MLFLOW_TRACKING_URI in the container environment',
        'Use runs:/ URIs instead of models:/ URIs when loading',
      ],
      answerIndex: 1,
      explanation: 'Proxied artifact access routes the bytes through the tracking server, which becomes the only holder of blob credentials. Clients then need just the tracking URL. The backend store choice is about metadata, and the tracking URI only tells the client where the server is, not how artifacts are transferred.',
    },
    {
      id: 'q3',
      prompt: 'Why is models:/fraud-detector@champion preferable to runs:/8f3a…/model in a production deployment config?',
      options: [
        'Run-based URIs expire after the run is archived',
        'Alias URIs load faster because the registry caches the artifact',
        'The alias is readable and resolves at load time, so promoting a new version does not require editing the deployment',
        'Run-based URIs cannot be used with mlflow.pyfunc.load_model',
      ],
      answerIndex: 2,
      explanation: 'A raw run id tells a future reader nothing about what is deployed, and pinning to one means every promotion is a code change. An alias names the role the model plays and is repointed in the registry. Both URI forms load fine and neither expires.',
    },
    {
      id: 'q4',
      prompt: 'You are upgrading your tracking server to a new MLflow minor version. What must happen first?',
      options: [
        'Delete and recreate the artifact bucket so URIs use the new scheme',
        'Migrate all runs from the file store into the database',
        'Back up the database and run mlflow db upgrade against the backend store URI',
        'Downgrade all clients so they match the previous server version',
      ],
      answerIndex: 2,
      explanation: 'The backend schema evolves between releases. Running the migration up front, with a backup taken beforehand, converts a hard-to-diagnose runtime failure into a controlled step. Clients should end up matched to the new version, not held back on the old one.',
    },
    {
      id: 'q5',
      prompt: 'A solo project has been using the default ./mlruns directory. What is the first concrete capability gained by switching the backend store to sqlite:///mlflow.db?',
      options: [
        'Artifacts move to object storage automatically',
        'Concurrent training jobs become safe from any machine',
        'System metrics such as GPU utilisation start being collected',
        'The model registry becomes available, along with fast filtered queries',
      ],
      answerIndex: 3,
      explanation: 'The file store cannot host the registry and searches by walking directories. A database backend enables registered models and versions, and makes filtered search fast. Artifacts stay exactly where they were, and SQLite still does not tolerate concurrent writers across machines.',
    },
  ],
};
