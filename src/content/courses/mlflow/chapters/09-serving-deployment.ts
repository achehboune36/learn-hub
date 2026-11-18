import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'serving-deployment',
  title: 'Serving and batch scoring',
  summary: 'Getting a logged model to answer requests: the scoring server and its REST contract, containerising it properly, Spark UDFs for batch, and the latency traps that only appear under load.',
  estimatedMinutes: 26,

  blocks: [
    {
      type: 'markdown',
      md: `
Because every model reduces to the pyfunc contract, deployment is uniform. The same command
serves a scikit-learn classifier, a PyTorch network and a custom Python wrapper.

\`\`\`
mlflow models serve -m models:/churn-detector@champion -p 5000
\`\`\`

That command is genuinely useful and genuinely insufficient for production, and the gap between
those two facts is what this chapter is about.
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## The scoring server

\`mlflow models serve\` starts a small web server around the model. Underneath it is Flask behind
gunicorn on Linux, which matters when you start tuning concurrency.

It exposes four endpoints:

| Endpoint | Purpose |
|---|---|
| \`POST /invocations\` | Scoring. The only one that does real work. |
| \`GET /ping\` | Liveness. Point your orchestrator's health check here. |
| \`GET /health\` | Same as \`/ping\`. |
| \`GET /version\` | The MLflow version serving the model. |

Note what is absent: no authentication, no rate limiting, no request logging, no metrics
endpoint, no batching. The scoring server is a **component**, not a production service. It
belongs behind an ingress or a gateway that supplies those things.
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## The request contract

\`/invocations\` accepts JSON with exactly one top-level key naming the input format. Getting this
wrong is the most common first-hour error, and the message you get back is not always
illuminating.

\`\`\`json
{"dataframe_split": {"columns": ["tenure_months", "monthly_charges"],
                     "data": [[24, 79.5], [3, 120.0]]}}

{"dataframe_records": [{"tenure_months": 24, "monthly_charges": 79.5}]}

{"instances": [[24, 79.5], [3, 120.0]]}

{"inputs": {"tenure_months": [24, 3], "monthly_charges": [79.5, 120.0]}}
\`\`\`

Use \`dataframe_split\` for tabular models. It is compact, unambiguous about column order, and
round-trips cleanly from pandas. Reach for \`dataframe_records\` when readability in logs matters
more than payload size, and \`inputs\` when your model takes tensors rather than a table.

Parameters declared in the signature travel alongside, in their own key:

\`\`\`json
{"dataframe_split": {"columns": ["tenure_months"], "data": [[24]]},
 "params": {"threshold": 0.7}}
\`\`\`
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
sequenceDiagram
    participant C as Client
    participant G as Gateway
    participant S as MLflow scoring server
    participant M as Loaded pyfunc model

    Note over S,M: load_context ran ONCE at startup.<br/>Cold start = env build + model load.

    C->>G: POST /score {dataframe_split: …}
    G->>S: POST /invocations
    S->>S: Validate against the signature<br/>(missing cols fail, extra cols dropped)
    S->>M: predict(DataFrame)
    M-->>S: predictions
    S-->>G: JSON {predictions: […]}
    G-->>C: response

    Note over G: Auth, rate limiting and request logging.<br/>Everything the scoring server does not do.
`.trim(),
      caption: 'The scoring server does schema validation and prediction. Authentication, rate limiting and observability are the gateway\'s job.',
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'Cold start is environment build plus model load, and it happens at scale-out',
      md: `By default the server builds a virtualenv from the model's \`python_env.yaml\` **on
startup**. On a large ML stack that is minutes, and it recurs on every pod restart and every
scale-out event — precisely when you are already under load. Build the environment into an image
once, in CI, then run that image with \`--env-manager local\` inside it, where local is finally
the correct choice because the container was built to match.`,
    },
    {
      type: 'code',
      lang: 'bash',
      filename: 'serve.sh',
      code: `# Local development: builds an isolated env from the model's declaration.
mlflow models serve -m models:/churn-detector@champion -p 5000

# Faster iteration when you know your current env matches. On a laptop this is a
# convenience; on a bare production host it is how you serve an untested env.
mlflow models serve -m runs:/8f3adc21/model -p 5000 --env-manager local

# Concurrency is gunicorn's, so tune it through gunicorn.
export GUNICORN_CMD_ARGS="--workers=4 --threads=2 --timeout=120"
mlflow models serve -m models:/churn-detector@champion -p 5000 --host 0.0.0.0

# Build a container with the environment baked in — the production path.
mlflow models build-docker \\
  --model-uri models:/churn-detector@champion \\
  --name churn-scorer:v7 \\
  --enable-mlserver          # MLServer instead of Flask: async, adaptive batching

# Prefer to own the Dockerfile? Generate it and commit it.
mlflow models generate-dockerfile \\
  --model-uri models:/churn-detector@champion \\
  --output-directory ./docker

# Verify before shipping. This is a real prediction through a real environment.
curl -s -X POST http://localhost:5000/invocations \\
  -H 'Content-Type: application/json' \\
  -d '{"dataframe_split": {"columns": ["tenure_months", "monthly_charges"],
                           "data": [[24, 79.5]]}}'`,
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'Pin the version into the image tag, resolve the alias at build time',
      md: `\`build-docker\` with an alias URI resolves it **once**, when the image is built, and
bakes that version in. That is the behaviour you want: the image is immutable and its tag can
name the version it contains. Promotion then means building a new image and rolling it out
through your normal deployment process, with all the safety that already has. An image that
re-resolves an alias at runtime can silently change what it serves between two restarts of the
same tag, which makes an incident timeline impossible to reconstruct.`,
    },
    {
      type: 'markdown',
      md: `
## Batch scoring, which is what most teams actually need

Real-time serving is the default assumption and the wrong one surprisingly often. If predictions
are consumed by a dashboard refreshed hourly, or a campaign sent on Tuesdays, a scheduled batch
job is cheaper, simpler and easier to reason about. There is no cold start, no autoscaling, and
a failure is a retry rather than an outage.

MLflow supports three shapes of batch scoring, and the Spark UDF is the one worth knowing.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'batch_score.py',
      caption: 'The UDF ships the model to the executors and loads it once per worker, not once per row. That distinction is the whole performance story.',
      code: `import mlflow
import pandas as pd

MODEL_URI = "models:/churn-detector@champion"

# --- 1. Spark: millions of rows, in parallel ---------------------------------
from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

# The model is broadcast to executors and loaded ONCE per worker process.
predict = mlflow.pyfunc.spark_udf(
    spark,
    model_uri=MODEL_URI,
    result_type="double",
    env_manager="local",     # executors already have the deps; building per-worker is brutal
)

accounts = spark.read.parquet("s3://acme-data/accounts/2026-08/")
scored = accounts.withColumn(
    "churn_probability",
    predict("tenure_months", "monthly_charges", "contract_type"),
)
scored.write.mode("overwrite").parquet("s3://acme-scores/2026-08/")


# --- 2. Plain pandas: a few million rows on one machine ----------------------
model = mlflow.pyfunc.load_model(MODEL_URI)      # load once, outside the loop

def score_in_chunks(path: str, chunk_rows: int = 100_000):
    out = []
    for chunk in pd.read_parquet(path, engine="pyarrow").groupby(
        lambda i: i // chunk_rows
    ):
        frame = chunk[1]
        frame["churn_probability"] = model.predict(frame)
        out.append(frame)
    return pd.concat(out)


# --- 3. The CLI, for a one-off ------------------------------------------------
#   mlflow models predict -m models:/churn-detector@champion \\
#     -i accounts.csv -t csv -o scores.csv`,
    },
    {
      type: 'table',
      headers: ['Pattern', 'Latency', 'Right when', 'Main cost'],
      rows: [
        ['`mlflow models serve` behind a gateway', 'Tens of ms', 'Predictions needed per request, modest traffic', 'You supply auth, logging and scaling yourself'],
        ['Container from `build-docker`', 'Tens of ms', 'Production real-time on Kubernetes', 'Image build in CI; a rollout per promotion'],
        ['`--enable-mlserver`', 'Tens of ms, higher throughput', 'Concurrent load where adaptive batching helps', 'A second serving stack to understand'],
        ['Spark UDF', 'Minutes to hours', 'Scoring an entire table on a schedule', 'A Spark cluster'],
        ['Scheduled pandas job', 'Minutes', 'Under a few million rows, no Spark available', 'Single-machine memory limits'],
        ['Managed endpoint via a deployments plugin', 'Tens of ms', 'You are already on SageMaker, Azure ML or similar', 'Provider lock-in and its own deployment model'],
      ],
    },
    {
      type: 'markdown',
      md: `
## Latency: where the time actually goes

When a served model is slower than expected, the cause is almost never the matrix multiplication.

**Model loading inside \`predict\`.** The single most common serious bug. If \`load_context\` was
skipped and weights are loaded in the predict path, every request pays for it. Symptom: latency
is flat, high, and identical for a one-row and a thousand-row request.

**Per-request DataFrame construction.** For a small model the pandas overhead of building and
validating the input can genuinely exceed inference. Visible as a latency floor you cannot get
below no matter how small the model.

**One row per request.** Almost every model is far more efficient per row on a batch of 100 than
on 100 batches of one. If the caller can accumulate, let it.

**Environment build on startup**, covered above. Symptom: the first request after a deploy takes
minutes, then everything is fine.

**Signature enforcement on wide inputs.** Validating and casting a 500-column frame is not free.
Real, but the smallest item on this list; measure before optimising it away.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Load-test with your real payload shape',
      md: `A benchmark that sends 1,000-row batches will report throughput your production traffic
never sees if production sends one row at a time. The per-request overhead — JSON parsing,
DataFrame construction, signature validation — is roughly constant, so it dominates completely at
batch size one and disappears at batch size 1,000. **Measure at the batch size you will actually
receive**, and measure the tail rather than the mean.`,
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'serving_wrapper.py',
      caption: 'When the model must own its own contract: batching, timing and version reporting inside the pyfunc, so every deployment target gets them for free.',
      code: `import time
import logging
import mlflow
import pandas as pd

log = logging.getLogger(__name__)


class InstrumentedScorer(mlflow.pyfunc.PythonModel):
    """Adds the operational behaviour the bare scoring server does not provide."""

    def load_context(self, context):
        # Everything expensive happens exactly once, here.
        import joblib

        t0 = time.perf_counter()
        self.model = joblib.load(context.artifacts["estimator"])
        self.model_version = context.artifacts.get("version_marker", "unknown")
        log.info("model loaded in %.2fs", time.perf_counter() - t0)

    def predict(self, context, model_input: pd.DataFrame, params=None):
        t0 = time.perf_counter()

        # Guard rails the server will not enforce for you.
        if len(model_input) > 10_000:
            raise ValueError(f"batch of {len(model_input)} exceeds the 10,000 row limit")

        proba = self.model.predict_proba(model_input)[:, 1]

        # Structured, so your log aggregator can chart p99 by batch size.
        log.info(
            "scored rows=%d duration_ms=%.1f version=%s",
            len(model_input),
            (time.perf_counter() - t0) * 1000,
            self.model_version,
        )
        return pd.DataFrame({"churn_probability": proba})`,
    },
    {
      type: 'checklist',
      title: 'Before a model serves real traffic',
      items: [
        'Environment baked into an image at build time, never built on server startup',
        'The image tag names the exact model version it contains',
        'A gateway in front supplying authentication, rate limiting and request logging',
        '/ping wired to the orchestrator\'s liveness and readiness checks',
        'Load-tested at the batch size production will actually send, measuring the tail',
        'Model loading confirmed to happen in load_context, not in predict',
        'Batch scoring seriously considered first — many use cases never needed an endpoint',
        'A rollback path that does not depend on rebuilding an image under pressure',
      ],
    },
  ],

  flashcards: [
    { front: 'Which endpoints does the MLflow scoring server expose, and what is missing?', back: 'POST /invocations for scoring plus GET /ping, /health and /version. Missing: authentication, rate limiting, request logging, metrics and batching, all of which belong to a gateway in front.' },
    { front: 'What is the default payload format for a tabular model?', back: 'A JSON object with a single dataframe_split key carrying columns and data. It is compact and unambiguous about column order. Signature params travel in a separate params key.' },
    { front: 'Why does mlflow models build-docker resolve an alias at build time rather than runtime?', back: 'It makes the image immutable, so its tag names the version inside. Re-resolving at runtime lets the same tag serve different models across restarts, which makes incidents impossible to reconstruct.' },
    { front: 'What is the signature of a model that loads its weights inside predict?', back: 'Flat, high latency that is nearly identical for one row and a thousand rows, because the constant load cost dominates. Loading belongs in load_context, which runs once.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Your served model shows the same 900ms latency whether the request has one row or five hundred. What does this point to?',
      options: [
        'Signature enforcement is validating every column individually',
        'A fixed per-request cost dominates, most likely the model being loaded inside predict rather than in load_context',
        'The gunicorn worker count is too low for the offered concurrency',
        'The client is sending dataframe_records rather than dataframe_split',
      ],
      answerIndex: 1,
      explanation: 'Latency that does not scale with input size is a constant cost, and the largest constant available is loading the model. Moving it to load_context makes it a one-time startup cost. A worker shortage would show as queueing under concurrency, and payload format changes parsing cost only marginally.',
    },
    {
      id: 'q2',
      prompt: 'Why is --env-manager local correct inside a container built by mlflow models build-docker, but risky on a bare production host?',
      options: [
        'The flag is ignored inside containers, so it is harmless there',
        'Containers cannot create virtualenvs, so local is the only option',
        'The image was built from the model\'s own environment declaration, so the current environment is the declared one; on a bare host it is whatever happens to be installed',
        'Local mode disables signature enforcement, which containers restore',
      ],
      answerIndex: 2,
      explanation: 'The flag means "trust the current environment". That trust is earned when the container was constructed from the model\'s declaration and untested when the environment is simply whatever the host has. Neither signature enforcement nor virtualenv support differs between the two.',
    },
    {
      id: 'q3',
      prompt: 'Predictions feed a dashboard that refreshes hourly. What should you build?',
      options: [
        'A scheduled batch scoring job, since there is no cold start, no autoscaling, and a failure is a retry rather than an outage',
        'A real-time endpoint with autoscaling configured for the hourly spike',
        'A real-time endpoint with a cache in front, keyed by account id',
        'A Spark UDF invoked synchronously by the dashboard',
      ],
      answerIndex: 0,
      explanation: 'Nothing in the requirement asks for a prediction at request time, so an endpoint adds availability obligations for no benefit. A scheduled job writes the scores ahead of time, and if it fails you rerun it rather than paging someone. Caching an endpoint is a workaround for a service that should not exist here.',
    },
    {
      id: 'q4',
      prompt: 'What does mlflow.pyfunc.spark_udf do that a naive per-row UDF would not?',
      options: [
        'It converts the model to a native Spark ML pipeline',
        'It guarantees exactly-once semantics on the output write',
        'It bypasses signature enforcement to reduce overhead',
        'It loads the model once per worker process and scores partitions in batches, instead of loading or invoking per row',
      ],
      answerIndex: 3,
      explanation: 'Loading the model per row would be catastrophic, and scoring one row at a time forfeits vectorisation. The UDF broadcasts the model, loads it once per worker, and hands each executor a batch. It does not convert the model or change write semantics.',
    },
    {
      id: 'q5',
      prompt: 'You load-test at 1,000 rows per request and see excellent throughput, but production sends one row at a time and is far slower per row. Why?',
      options: [
        'The signature is re-validated more times than necessary for small payloads',
        'Small requests bypass the gunicorn worker pool',
        'Per-request overhead such as JSON parsing, DataFrame construction and validation is roughly constant, so it dominates completely at batch size one',
        'The model reloads whenever the batch size changes',
      ],
      answerIndex: 2,
      explanation: 'Fixed costs per request are amortised across 1,000 rows and paid in full for one. That is why a benchmark must use the batch size production actually sends. The worker pool handles all requests alike and the model is not reloaded.',
    },
  ],
};
