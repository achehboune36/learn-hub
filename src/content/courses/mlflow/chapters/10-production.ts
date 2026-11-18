import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'production',
  title: 'Running MLflow for a team',
  summary: 'The parts nobody writes a tutorial about: conventions that keep a tracking store legible, an automated train-evaluate-gate-promote pipeline, and the scaling and cost problems that arrive at around a million runs.',
  estimatedMinutes: 24,

  blocks: [
    {
      type: 'markdown',
      md: `
Everything so far has been about capability. This chapter is about what happens after eighteen
months, when the tracking store holds two hundred thousand runs, four people have left, and
somebody needs to know why the fraud model was retrained on a Sunday.

Three things decay in that time: **conventions**, **the database**, and **the storage bill**.
Each has a cheap fix applied early and an expensive one applied late.
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## Conventions, which are the highest-leverage thing here

MLflow enforces almost no structure. That flexibility is why it fits everywhere, and it means a
shared store degrades into noise unless a team agrees on a few rules. Write them down; a wiki
page is enough.

**Experiment naming.** Pick a scheme and apply it mechanically. \`<team>/<problem>\` works:
\`risk/fraud-detection\`, \`growth/churn-prediction\`. Avoid dates and people's names, both of
which go stale while the problem persists.

**Mandatory tags on every run.** These are what make the store queryable years later, and they
cost one function call.

| Tag | Why it is not optional |
|---|---|
| \`git_sha\` | The only path from a surprising metric back to the code |
| \`trigger\` | \`manual\`, \`scheduled\`, \`ci\` — separates experiments from production retrains |
| \`owner\` | Who to ask, when they have moved teams but not companies |
| \`data_snapshot\` | Which data cut. The most common cause of an unexplained metric shift |
| \`pipeline_version\` | Distinguishes a model change from a preprocessing change |

**Run names that describe the hypothesis.** \`rf-depth12-no-tenure-feature\` is worth reading in a
list. \`test3\` is not, and every store has forty of them.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'mlflow_conventions.py',
      caption: 'Make the convention the path of least resistance. A helper that is easier than the raw API is followed; a wiki page alone is not.',
      code: `import os
import subprocess
from contextlib import contextmanager

import mlflow


def _git_sha() -> str:
    try:
        sha = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL
        ).decode().strip()
        dirty = subprocess.call(["git", "diff", "--quiet"]) != 0
        return f"{sha}-dirty" if dirty else sha
    except Exception:
        # CI checkouts and containers without git should not break training.
        return os.environ.get("GIT_COMMIT", "unknown")


@contextmanager
def tracked_run(team: str, problem: str, run_name: str, data_snapshot: str, **tags):
    """The only way anyone on this team starts a run."""
    mlflow.set_experiment(f"{team}/{problem}")

    with mlflow.start_run(run_name=run_name) as run:
        mlflow.set_tags({
            "git_sha": _git_sha(),
            # CI systems set these; absence means a human ran it.
            "trigger": "ci" if os.environ.get("CI") else "manual",
            "owner": os.environ.get("MLFLOW_OWNER", os.environ.get("USER", "unknown")),
            "data_snapshot": data_snapshot,
            "pipeline_version": os.environ.get("PIPELINE_VERSION", "dev"),
            **tags,
        })
        yield run


# Usage — shorter than doing it by hand, which is the point.
with tracked_run("growth", "churn-prediction", "rf-depth12", "2026-08") as run:
    ...`,
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'A dirty working tree is a fact worth recording',
      md: `Appending \`-dirty\` to the commit SHA when the tree has uncommitted changes takes three
lines and saves an afternoon. Without it, a run tagged with a clean commit that you cannot
reproduce from that commit is genuinely baffling. With it, the tag tells you immediately that
what ran was not what is in the repository.`,
    },
    {
      type: 'markdown',
      md: `
## The automated pipeline

Once evaluation is comparable and promotion is gated, the whole path from data to production can
run without a human. The gate is what makes that safe: most candidates should fail it, and a
pipeline where nothing ever fails the gate is not gating anything.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    T["Scheduled trigger<br/>or merge to main"] --> T1["Train<br/>tags: git_sha, data_snapshot"]
    T1 --> E1["Evaluate candidate"]
    T1 --> E2["Evaluate incumbent<br/>on the SAME data"]

    E1 --> G{"Beats champion by<br/>more than the noise floor?"}
    E2 --> G

    G -->|"no"| STOP["Stop. Tag rejected.<br/>Keep the run — a failed<br/>candidate is still evidence."]
    G -->|"yes"| REG["Register version N"]

    REG --> SMOKE{"Smoke test:<br/>load in a fresh env,<br/>score known rows"}
    SMOKE -->|"fail"| STOP
    SMOKE -->|"pass"| AL["Move @previous to old champion<br/>Move @champion to N"]

    AL --> IMG["Build image tagged with<br/>the resolved version"]
    IMG --> ROLL["Canary, then roll out"]
    ROLL --> MON["Monitor. Rollback = repoint<br/>@champion to @previous"]
`.trim(),
      caption: 'Every arrow is a step that can fail loudly. The smoke test after registration is the one teams skip and later wish they had not.',
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'Registration is not validation',
      md: `A registered version can be structurally broken: an inferred requirements file missing a
package, an artifact that did not upload cleanly, a signature that does not match what the
serving layer sends. Registration checks none of that. **Load the version in a fresh environment
and score a handful of known rows before moving any alias.** It takes a minute in CI and catches
the class of failure that otherwise surfaces during a rollout.`,
    },
    {
      type: 'markdown',
      md: `
## Scaling: what breaks, and in what order

MLflow's architecture is simple, which means its limits are predictable.

**Metric rows are the first wall.** Every \`log_metric\` call is a database row. A deep-learning
job logging six metrics per step for 100,000 steps writes 600,000 rows in a single run. A team
doing that daily reaches hundreds of millions of rows within a year, and the metrics table stops
serving the UI at interactive speed.

The fixes, in order of how much they cost you:

- **Log less often.** Every tenth step is almost always as informative as every step for a curve
  you are going to look at in a browser 400 pixels wide.
- **Batch the writes.** \`mlflow.log_metrics(dict)\` is one request for many metrics. The REST
  \`log-batch\` endpoint takes many at once, and the client uses it when you hand it a dict.
- **Index and vacuum the backend.** Ordinary database administration, and it is nobody's job
  until it is.

**Artifact storage is the second wall**, and it arrives as an invoice. Autologging with
\`log_models=True\` across every sweep is the usual cause. A 400 MB model logged on 200 sweep runs
is 80 GB from one afternoon.

**The tracking server itself is the third**, especially with \`--serve-artifacts\`, where every
model upload and download passes through it. Scale it horizontally behind a load balancer; it is
stateless, with all state in the database and the blob store.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'high_frequency_logging.py',
      caption: 'The difference between 600,000 rows and 12,000 rows in one training job, for no loss in what you can actually see.',
      code: `import mlflow

LOG_EVERY = 10          # step granularity you will actually look at
BUFFER_FLUSH = 100      # how many steps to accumulate before writing


def train(model, loader, epochs: int):
    with mlflow.start_run():
        buffer: dict[int, dict[str, float]] = {}

        for step, batch in enumerate(loader):
            loss = model.train_step(batch)

            # Do not write a row for every step. Nobody reads a 100,000-point curve.
            if step % LOG_EVERY:
                continue

            buffer[step] = {"train_loss": loss, "lr": model.current_lr()}

            if len(buffer) >= BUFFER_FLUSH:
                # One request per flush instead of one per metric per step.
                for s, metrics in buffer.items():
                    mlflow.log_metrics(metrics, step=s)
                buffer.clear()

        for s, metrics in buffer.items():
            mlflow.log_metrics(metrics, step=s)

        # Final values get logged unconditionally and precisely — these are the
        # numbers that end up in comparisons and gates.
        mlflow.log_metrics({
            "final_train_loss": model.final_loss(),
            "best_val_auc": model.best_val_auc(),
        })`,
    },
    {
      type: 'table',
      headers: ['Symptom', 'Underlying cause', 'Fix'],
      rows: [
        ['Run list takes 30s to load', 'Millions of metric rows; unindexed queries', 'Reduce logging frequency, index the backend, archive old experiments'],
        ['Artifact bill grew 10x in a month', '`log_models=True` during sweeps', 'Disable model logging in sweeps; bucket lifecycle rules'],
        ['`log_metric` calls dominate epoch time', 'One HTTP request per metric per step', 'Batch with `log_metrics`, log every Nth step'],
        ['Deleted runs still consuming storage', 'Deletion marks records; it does not remove artifacts', 'Run `mlflow gc` on a schedule to reclaim them'],
        ['Server times out on large uploads', 'Proxied artifacts through one instance', 'Scale the server horizontally; raise the client timeout'],
        ['A version upgrade broke a specific operation', 'Backend schema not migrated', '`mlflow db upgrade` as a deployment step, after a backup'],
      ],
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Deleting a run does not delete its artifacts',
      md: `Deletion in the UI marks the run as deleted so it disappears from listings. The
artifacts stay in blob storage, still billable, indefinitely. \`mlflow gc\` is what actually
reclaims them, and it is irreversible. Run it on a schedule against runs deleted more than a
retention window ago, never immediately on deletion — people un-delete runs more often than you
would expect.`,
    },
    {
      type: 'markdown',
      md: `
## Retention, which requires a decision rather than a default

Nobody wants to delete experiments, so nothing is ever deleted, and the store becomes an
undifferentiated archive that is slow for everyone. A workable policy distinguishes three tiers:

- **Runs behind a registered model version: keep indefinitely.** They are the lineage. Deleting
  one turns a production model into an artifact of unknown origin.
- **Runs from the last 90 days: keep everything.** This is the active comparison window.
- **Older runs with no registered version and no alias: archive the artifacts, keep the
  metadata.** The metrics rows are small and remain searchable; the 400 MB model files are what
  cost money and nobody will ever load them.

The lifecycle rule to avoid is one that deletes by age alone, because the run that produced the
model still serving traffic is often the oldest one you have.
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## Monitoring after deployment

Tracking covers training. Production drift is a separate discipline, but MLflow gives you the
hooks to connect the two.

The pattern that works: log production inference to your own store — inputs, prediction, model
version, timestamp — and then, when ground truth arrives days or weeks later, run
\`mlflow.evaluate\` over that joined table as an ordinary scheduled run. Production performance
then lands in the same experiment as training metrics, on the same axes, comparable.

The number that matters is not the absolute production metric. It is **the gap between the
holdout metric at promotion time and the production metric now.** A model that scored 0.91 on
holdout and delivers 0.78 in production is telling you something about your evaluation set, and
that is a more valuable finding than the drift itself.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'Pin client and server to the same minor version',
      md: `A client newer than the server can call endpoints the server does not implement; an
older client can miss fields the server now expects. Both fail in ways that look like network
problems. Pin \`mlflow\` in your training images to the version your server runs, upgrade the
server first, then the clients, and keep the window between them short.`,
    },
    {
      type: 'checklist',
      title: 'Operating a shared MLflow installation',
      items: [
        'Experiment naming and mandatory tags written down and wrapped in a helper',
        'The helper easier to use than the raw API, so it is actually adopted',
        'Promotion gated on a re-evaluated baseline, with a threshold above measured noise',
        'A smoke test between registration and alias movement',
        'A `previous` alias maintained so rollback is one call',
        'Metric logging frequency chosen deliberately, batched with log_metrics',
        'log_models disabled inside sweeps',
        '`mlflow gc` scheduled against a retention window, never on immediate deletion',
        'Retention policy that keeps every run behind a registered version, forever',
        'Client and server versions pinned together, with `mlflow db upgrade` in the deploy',
        'Production inference logged and evaluated on a schedule into the same experiment',
      ],
    },
    {
      type: 'quote',
      md: 'The tracking store is not a log. It is the answer to a question somebody will ask under pressure, months from now, about a model nobody remembers training.',
    },
  ],

  flashcards: [
    { front: 'Which five tags should be mandatory on every run?', back: 'git_sha, trigger, owner, data_snapshot and pipeline_version. Together they let you get from any metric back to the code, the data, the person and the reason it ran.' },
    { front: 'Why is a smoke test needed between registration and alias movement?', back: 'Registration validates nothing. A version can carry an incomplete requirements file or a mismatched signature, and only loading it in a fresh environment and scoring known rows will reveal that.' },
    { front: 'What does mlflow gc do that deleting a run does not?', back: 'Deleting marks a run as deleted but leaves its artifacts in blob storage, still billable. Only gc reclaims them, and it is irreversible, so it should run against a retention window.' },
    { front: 'Which comparison matters most when monitoring a deployed model?', back: 'The gap between the holdout metric at promotion and the production metric now. A large gap says more about your evaluation set than about drift.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'A deep-learning team logs six metrics every step for 100,000-step runs, and the MLflow UI has become unusably slow. What is the first change to make?',
      options: [
        'Move the artifact store to a faster storage class',
        'Log every tenth step and batch the writes with log_metrics, since each call is a database row',
        'Switch the backend store from PostgreSQL to the file store',
        'Split each training job across several runs to reduce rows per run',
      ],
      answerIndex: 1,
      explanation: 'Six metrics times 100,000 steps is 600,000 rows from one job, and the metrics table is what the UI queries. Reducing frequency costs nothing you can see on a chart 400 pixels wide, and batching cuts request overhead. Artifact storage is a separate concern, the file store is slower, and splitting runs writes the same number of rows.',
    },
    {
      id: 'q2',
      prompt: 'Why append -dirty to the git SHA tag when the working tree has uncommitted changes?',
      options: [
        'MLflow requires a unique tag value per run',
        'It prevents the run from being registered until the tree is clean',
        'Otherwise the run claims a commit that does not contain the code that actually ran, which is baffling when reproduction fails',
        'It allows search_runs to filter out development runs by default',
      ],
      answerIndex: 2,
      explanation: 'The tag is a promise that checking out that commit reproduces the run. When the tree was dirty, the promise is false and the discrepancy is invisible. Marking it turns a confusing failure into an obvious explanation. Nothing enforces uniqueness or blocks registration.',
    },
    {
      id: 'q3',
      prompt: 'Your retention policy deletes all runs older than one year. What is the specific danger?',
      options: [
        'Metric rows cannot be deleted independently of artifacts',
        'The run behind the model currently serving production traffic may be the oldest one you have, and deleting it destroys that model\'s lineage',
        'Deletion cascades to registered model versions created from other runs',
        'MLflow refuses to delete runs that have any tags set',
      ],
      answerIndex: 1,
      explanation: 'A stable, well-performing model can serve for years, and age is a poor proxy for value. A policy must exempt any run behind a registered version. Deleting one leaves a production model with no record of the code, data or parameters that produced it.',
    },
    {
      id: 'q4',
      prompt: 'A team\'s automated promotion pipeline has never once failed the gate in six months. What is the most reasonable interpretation?',
      options: [
        'The gate is not actually gating anything, most likely because the threshold sits below evaluation noise or the baseline is stale',
        'The training pipeline is unusually well tuned',
        'The evaluation dataset is too large and is masking regressions',
        'Registration is silently succeeding before the gate runs',
      ],
      answerIndex: 0,
      explanation: 'Most candidates should fail a real gate; that is what it is for. A gate that always passes is either comparing against something stale, or set below the noise floor so that any candidate clears it. The right response is to check the threshold against measured variance and confirm the baseline is re-evaluated each run.',
    },
    {
      id: 'q5',
      prompt: 'You upgrade the tracking server to a new minor version but leave training images pinned to the old client. What class of problem should you expect?',
      options: [
        'Artifacts written by the old client become unreadable',
        'Signature enforcement silently switches off for older models',
        'Requests that appear to be network failures, caused by endpoint and field mismatches between client and server',
        'The registry rejects new versions from the older client',
      ],
      answerIndex: 2,
      explanation: 'Version skew shows up as confusing protocol-level errors rather than clear messages, which sends people debugging the network. Upgrading the server first and the clients promptly afterwards, keeping the window short, avoids it. Artifact formats and signature behaviour are unaffected by the skew.',
    },
  ],
};
