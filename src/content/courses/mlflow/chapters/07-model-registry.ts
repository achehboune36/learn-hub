import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'model-registry',
  title: 'The Model Registry',
  summary: 'Closing the gap between "a run produced a model" and "this is the model serving traffic right now": versions, aliases, promotion workflows, and why stages were replaced.',
  estimatedMinutes: 24,

  blocks: [
    {
      type: 'markdown',
      md: `
Tracking gives you thousands of runs, each with a model attached. That is a lake, not an answer.
The question operations actually asks is narrower and more urgent:

> Which model is serving production traffic right now, which one did it replace, who approved
> the change, and how do I go back?

The registry exists for that question alone. It is a thin layer — a named catalogue of model
versions with pointers back into tracking — and its thinness is a feature. It stores no new
artifacts. A registered model version is a *reference* to a model already logged in a run, plus
the organisational metadata that makes it governable.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'The registry needs a database backend',
      md: `The file store cannot host a registry. If \`mlflow.register_model\` fails with an
unsupported-endpoint error, your tracking server is running on \`./mlruns\` rather than a SQL
backend. This is the most common first encounter with the registry, and the fix is a
\`--backend-store-uri\` pointing at SQLite or Postgres.`,
    },
    {
      type: 'markdown',
      md: `
## The object model

**Registered model** — a name, and the concept behind it: \`churn-detector\`. Long-lived. It
outlives every model that fills the role.

**Model version** — an immutable, auto-incrementing integer under that name. Version 7 is
whatever it was the day it was created, forever. Versions are never edited, only superseded.

**Alias** — a movable, named pointer to one version. \`@champion\` might be version 7 today and
version 9 next week. Aliases are what deployments reference.

**Tags** — key/value metadata on either the model or a version. \`validation_status=approved\`,
\`data_snapshot=2026-08\`, \`reviewed_by=risk-team\`.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart LR
    subgraph Tracking
      R1["Run a1b2<br/>val_auc 0.86"]
      R2["Run c3d4<br/>val_auc 0.91"]
      R3["Run e5f6<br/>val_auc 0.89"]
    end

    R1 -->|"register"| V5["churn-detector<br/>version 5"]
    R2 -->|"register"| V7["churn-detector<br/>version 7"]
    R3 -->|"register"| V8["churn-detector<br/>version 8"]

    V7 -.->|"@champion"| P["Production traffic"]
    V8 -.->|"@challenger"| SH["Shadow / canary"]
    V5 -.->|"no alias"| ARCH["Superseded,<br/>still loadable"]

    V7 ==>|"lineage"| R2
`.trim(),
      caption: 'Versions are immutable and accumulate. Aliases move. A deployment references the alias, so promotion is a registry operation rather than a code change.',
    },
    {
      type: 'markdown',
      md: `
## Aliases replaced stages, and the reason matters

Older MLflow had four fixed **stages**: None, Staging, Production, Archived. They were deprecated
in MLflow 2.9 and removed in MLflow 3, in favour of aliases and tags. Tutorials still show
\`transition_model_version_stage\`, so it is worth understanding why it went.

Stages were a fixed enum, and real deployment topologies are not. Teams needed a shadow model, a
canary, a champion and a challenger, and per-region variants — none of which the four names could
express. Worse, "Production" as a stage conflated two different facts: *this model is deployed*,
and *this model was approved*. Those come apart constantly. A model can be approved and not yet
rolled out, or serving traffic while its approval is under review.

Aliases carry the deployment role and tags carry the governance state. They vary independently,
because in practice they do.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Old stage model', 'Current equivalent', 'What you gain'],
      rows: [
        ['`stage="Production"`', 'Alias `@champion`', 'Any number of roles: champion, challenger, shadow, `@eu-champion`'],
        ['`stage="Staging"`', 'Alias `@challenger` plus tag `validation_status=pending`', 'Deployment role and approval state stop being the same field'],
        ['`stage="Archived"`', 'Simply no alias', 'Nothing special is needed; a version with no pointer is superseded'],
        ['Only one version per stage', 'Many aliases, one version each', 'Canary and champion can coexist without contortions'],
      ],
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'promote.py',
      caption: 'A promotion gate. The important line is the comparison against the incumbent — a candidate is only better relative to what is already serving.',
      code: `import mlflow
from mlflow import MlflowClient

client = MlflowClient()
MODEL_NAME = "churn-detector"


def register_candidate(run_id: str, metrics: dict, data_snapshot: str):
    """Register a run's model as a new version, with the context needed to judge it."""
    version = mlflow.register_model(
        model_uri=f"runs:/{run_id}/model",
        name=MODEL_NAME,
        tags={"data_snapshot": data_snapshot, "validation_status": "pending"},
    )

    # A description future-you will be grateful for during an incident at 2am.
    client.update_model_version(
        name=MODEL_NAME,
        version=version.version,
        description=(
            f"Trained on {data_snapshot}. "
            f"Holdout AUC {metrics['test_auc']:.4f}, "
            f"recall@5% {metrics['recall_at_5pct']:.4f}."
        ),
    )
    return version.version


def promote_if_better(candidate_version: str, min_improvement: float = 0.005) -> bool:
    """Compare against the incumbent champion, not against a fixed threshold."""
    candidate = client.get_model_version(MODEL_NAME, candidate_version)
    cand_auc = float(client.get_run(candidate.run_id).data.metrics["test_auc"])

    try:
        champion = client.get_model_version_by_alias(MODEL_NAME, "champion")
    except mlflow.exceptions.MlflowException:
        champion = None                      # first ever model: nothing to beat

    if champion is not None:
        champ_auc = float(client.get_run(champion.run_id).data.metrics["test_auc"])
        if cand_auc < champ_auc + min_improvement:
            # Not an error. Most candidates should lose; that is what a gate is for.
            client.set_model_version_tag(
                MODEL_NAME, candidate_version, "validation_status", "rejected"
            )
            return False

        # Keep the outgoing champion addressable so rollback is one call, not an archaeology dig.
        client.set_registered_model_alias(MODEL_NAME, "previous", champion.version)

    client.set_model_version_tag(MODEL_NAME, candidate_version, "validation_status", "approved")
    client.set_registered_model_alias(MODEL_NAME, "champion", candidate_version)
    return True


# Rollback, in its entirety:
#   previous = client.get_model_version_by_alias(MODEL_NAME, "previous")
#   client.set_registered_model_alias(MODEL_NAME, "champion", previous.version)`,
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'A promotion gate compares against the incumbent',
      md: `The tempting design is a fixed threshold: promote if AUC exceeds 0.85. It fails in both
directions. When the problem gets easier, everything passes and quality silently drifts down;
when the data gets harder, nothing passes and you cannot ship an improvement. **The only
comparison that means anything is against the model currently serving**, with a margin large
enough to exceed evaluation noise.`,
    },
    {
      type: 'markdown',
      md: `
## Loading by alias, and the timing question this raises

\`\`\`python
model = mlflow.pyfunc.load_model("models:/churn-detector@champion")
\`\`\`

The alias resolves **at load time**. This is the property that makes promotion decoupled from
deployment, and it is also the property that surprises people during an incident.

A long-running server that loaded the model at startup keeps serving the old version after you
repoint the alias. Nothing is wrong; the model simply is not reloaded until the process is. So
decide deliberately which behaviour you want:

- **Resolve once at startup.** Predictable, and every replica serves the same version. Promotion
  requires a rolling restart. This is the right default for most services.
- **Poll and hot-reload.** Promotion takes effect without a deploy, at the cost of replicas
  briefly disagreeing and of a much more interesting debugging story.

Whichever you pick, log the resolved version number at startup. Otherwise you cannot answer
"what is this replica actually running?" without guessing.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'Deleting a model version breaks anything that loads it later',
      md: `Versions are cheap — they are pointers, not copies of the weights. Deleting one to tidy
up removes the ability to roll back to it, and breaks any replica that restarts and tries to load
it. Worse, if the underlying **run** is deleted, the artifact goes with it and the version becomes
a dangling reference. Prefer removing aliases and tagging versions as deprecated. Reserve deletion
for genuine mistakes, and never delete a version any alias has pointed at within your rollback
window.`,
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'inspect_registry.py',
      caption: 'Auditing what exists. search_model_versions uses the same filter syntax as search_runs.',
      code: `from mlflow import MlflowClient

client = MlflowClient()

# What is deployed right now, and where did it come from?
champion = client.get_model_version_by_alias("churn-detector", "champion")
print(f"v{champion.version}  run={champion.run_id}  status={champion.status}")
print(f"tags: {champion.tags}")

# Every version awaiting review, across all registered models.
pending = client.search_model_versions("tags.validation_status = 'pending'")
for v in pending:
    print(f"{v.name} v{v.version} — registered {v.creation_timestamp}")

# The full history of one model, newest first.
versions = client.search_model_versions(
    "name = 'churn-detector'",
    order_by=["version_number DESC"],
)

# Which versions currently carry an alias? Anything else is superseded.
model = client.get_registered_model("churn-detector")
print("aliases:", model.aliases)      # {'champion': '7', 'challenger': '8', 'previous': '5'}`,
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'Approval workflows are a platform concern',
      md: `Open-source MLflow gives you the state — tags, descriptions, aliases — and no workflow
engine to move between states. There are no built-in webhooks or approval steps; managed
platforms layer those on. The practical pattern is to keep the *decision* in your existing
system, whether that is a pull request, a change ticket or a CI job, and let it write the
resulting tag and alias through the client. The registry then records what was decided rather
than trying to be the thing that decides.`,
    },
    {
      type: 'checklist',
      title: 'Registry hygiene',
      items: [
        'A database backend, since the file store cannot host a registry',
        'Aliases for deployment roles, tags for approval state — never one field for both',
        'Deployments reference an alias, never a raw run id or a pinned version number',
        'A `previous` alias maintained on every promotion, so rollback is one call',
        'Every version given a description carrying its headline metrics and data snapshot',
        'Promotion gated on a comparison with the incumbent, not a fixed threshold',
        'The resolved version number logged at server startup',
        'Versions deprecated by tag rather than deleted',
      ],
    },
  ],

  flashcards: [
    { front: 'What does a registered model version actually store?', back: 'A reference to a model already logged in a run, plus metadata. The registry stores no new artifacts, which is why versions are cheap and why deleting the source run breaks them.' },
    { front: 'Why did aliases replace the fixed Staging/Production stages?', back: 'Four fixed names could not express shadow, canary or per-region roles, and "Production" conflated deployment with approval. Aliases carry the role, tags carry the governance state, and they vary independently.' },
    { front: 'When does models:/name@champion resolve?', back: 'At load time. A long-running server that loaded at startup keeps serving the old version until it restarts, so you must decide deliberately between resolve-once and poll-and-reload.' },
    { front: 'Why gate promotion on the incumbent rather than a fixed metric threshold?', back: 'A fixed threshold lets quality drift down when the problem gets easier, and blocks genuine improvements when the data gets harder. Only a comparison against what is currently serving is meaningful.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'mlflow.register_model fails against your tracking server with an unsupported endpoint error. What is the cause?',
      options: [
        'The model was logged without a signature',
        'The server is using the file store rather than a SQL backend, and the file store cannot host a registry',
        'The run is still in RUNNING status and must be finished first',
        'Artifacts are proxied, which is incompatible with registration',
      ],
      answerIndex: 1,
      explanation: 'The registry needs transactional, queryable state that a directory tree cannot provide, so it requires a database backend. Signatures, run status and artifact proxying are all unrelated to whether the registry endpoints exist at all.',
    },
    {
      id: 'q2',
      prompt: 'Your team needs a champion serving all traffic, a challenger receiving shadow traffic, and a separate approved-but-not-yet-deployed version. Why can the old stage model not express this?',
      options: [
        'Stages could only be set by an administrator account',
        'Stages did not record which run produced the version',
        'Stages were limited to one model version per registered model',
        'Stages were a fixed enum of four names, and they conflated being deployed with being approved',
      ],
      answerIndex: 3,
      explanation: 'There is no stage name for shadow traffic, and marking the approved-but-undeployed version as Production would be a lie while marking it Staging loses the approval. Aliases name the deployment role and tags record approval, so both facts can be true at once.',
    },
    {
      id: 'q3',
      prompt: 'You repoint @champion from version 7 to version 9, but production keeps serving version 7. What is happening?',
      options: [
        'The alias resolves at load time, and the running server loaded the model at startup',
        'The alias change has not been committed until the previous alias is removed',
        'Version 9 lacks the validation_status=approved tag, so the registry refuses to serve it',
        'The registry caches alias resolution for a fixed interval',
      ],
      answerIndex: 0,
      explanation: 'Nothing is broken. The server resolved the alias once when it started and holds the loaded model in memory. Promotion takes effect on restart unless you deliberately implement polling and hot-reload. Tags carry no enforcement power on their own.',
    },
    {
      id: 'q4',
      prompt: 'A colleague deletes old model versions to keep the registry tidy. What is the strongest objection?',
      options: [
        'Deletion is irreversible and requires database administrator access',
        'It frees no storage, since versions are references, while removing your rollback targets and breaking any replica that restarts and tries to load one',
        'Deleted versions leave gaps in the version numbering, which confuses the UI',
        'Deletion also removes the metrics from the originating run',
      ],
      answerIndex: 1,
      explanation: 'The tidying achieves nothing, because a version is a pointer rather than a copy of the weights. Meanwhile the ability to roll back to that version is gone, and any replica that happens to restart against it fails. Tagging as deprecated gets the tidiness without the cost.',
    },
    {
      id: 'q5',
      prompt: 'You want an approval step where a risk reviewer must sign off before promotion. What does open-source MLflow provide?',
      options: [
        'A built-in approval workflow with configurable reviewers',
        'Registry webhooks that fire on version creation and can block promotion',
        'The state — tags, descriptions and aliases — with the decision itself made in your existing pull request or ticketing system, which then writes the tag',
        'A required-reviewers setting on the registered model',
      ],
      answerIndex: 2,
      explanation: 'The open-source registry records state and does not orchestrate transitions between states. Keeping the decision in the system your team already uses for approvals avoids duplicating governance, and the client call that sets the tag and alias becomes the last step of that existing process.',
    },
  ],
};
