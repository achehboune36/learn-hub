import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'why-tracking',
  title: 'Why experiment tracking exists',
  summary: 'The problem MLflow was built for: a model that works in production and nobody can rebuild it. What reproducibility actually requires, and which of those things git already gives you.',
  estimatedMinutes: 20,

  blocks: [
    {
      type: 'markdown',
      md: `
Every team arrives at MLflow by the same road. Someone trains a model that performs well. It
ships. Three months later a colleague asks a reasonable question — *can we retrain it on the
new data?* — and the answer turns out to be no.

The notebook has been edited since. The preprocessing step lives in a cell that was deleted.
Nobody recorded the learning rate, because at the time it was obvious. The saved weights sit in
a file called \`model_final_v2_actually_final.pkl\` and there are four of them.

This is not a discipline problem. It is a **tooling** problem, and it comes from a specific
mismatch: software engineering solved reproducibility for code, and a machine learning run is
only about one-fifth code.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'Git covers one input out of five',
      md: `A traditional program is a function of its source. Run the same commit twice, get the same
program. **A trained model is a function of code, data, hyperparameters, environment and
randomness** — and git version-controls exactly one of those. Every experiment tracking tool
that exists is an attempt to put the other four under version control too.`,
    },
    {
      type: 'markdown',
      md: `
## What a "run" is

MLflow's central noun is the **run**: one execution of training code, together with everything
that made it what it was. A run records four kinds of things, and the distinction between them
matters more than it first appears.

- **Parameters** — inputs you chose. Learning rate, max depth, model architecture, the data
  cut-off date. Written once, never changed.
- **Metrics** — numbers the run produced. Loss, AUC, latency. Recorded repeatedly, over steps,
  so they form a series.
- **Tags** — annotations for organising and searching. Git commit SHA, branch, who ran it, why.
- **Artifacts** — files the run produced. The model itself, plots, a confusion matrix, the
  feature list, a sample of the data.

The reason this taxonomy holds up is that each kind gets different treatment. Parameters are
immutable so a run's identity cannot shift under you. Metrics are time-series so you can see
the shape of training rather than one final number. Artifacts go to blob storage because they
are large. Tags are mutable because organisational facts change.
`.trim(),
    },
    {
      type: 'table',
      headers: ['What varies between two runs', 'Recorded by git?', 'Recorded by MLflow'],
      rows: [
        ['Training code', 'Yes', 'A tag holding the commit SHA, linking the run back to the code'],
        ['Hyperparameters', 'Only if hard-coded, which is the bad case', 'Parameters'],
        ['Which data, and which version of it', 'No — data lives elsewhere', 'Dataset inputs plus metadata: source, hash, row count'],
        ['Library versions and Python version', 'Only if a lockfile is committed and honoured', 'Captured into the model package at log time'],
        ['Random seed and hardware nondeterminism', 'No', 'A parameter if you log it; otherwise still a gap'],
        ['What the run actually scored', 'No', 'Metrics, queryable across every run ever'],
      ],
      caption: 'Experiment tracking exists to close the rows where the middle column says no.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Seeds do not buy you determinism on their own',
      md: `Setting a seed fixes sampling and initialisation. It does not fix GPU kernel
nondeterminism, thread-scheduling in parallel data loaders, or a library upgrade that changes a
default. Log the seed, but treat bit-identical reruns as a bonus rather than the goal. The
practical target is **explicability** — being able to say exactly what produced this model — not
byte-for-byte reproduction.`,
    },
    {
      type: 'markdown',
      md: `
## The four components

MLflow is usually described as one tool, but it is four that happen to share a database. You
can adopt them one at a time, and most teams should.

1. **Tracking** — record runs: parameters, metrics, tags, artifacts. This is the entry point and
   the part with the best effort-to-value ratio.
2. **Models** — a packaging format. A directory with enough metadata that anything downstream can
   load and call the model without knowing which framework trained it.
3. **Model Registry** — a named, versioned catalogue on top of those packages, answering "which
   model is live right now, and where did it come from?"
4. **Projects** — a convention for making a training run itself executable and reproducible from
   a git URL.

MLflow 3, released in 2025, added a fifth area aimed at generative AI: **tracing** for LLM
applications, a prompt registry, and evaluation built around LLM-as-judge scorers. The
underlying idea did not change. A trace is a run-shaped record of one request instead of one
training job.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart LR
    subgraph Dev["Experimentation"]
      T["Training code"] -->|"logs params,<br/>metrics, artifacts"| R["Run"]
    end

    R -->|"log_model"| M["MLflow Model<br/>(portable package)"]
    M -->|"register"| V["Registered model<br/>version 7"]
    V -->|"alias @champion"| S["Serving / batch scoring"]

    V -.->|"lineage: which run,<br/>which code, which data"| R
`.trim(),
      caption: 'Tracking captures the run, Models package the output, the Registry names the one that ships. The dotted line is the part teams miss until they need it.',
    },
    {
      type: 'markdown',
      md: `
## What adoption actually looks like

The smallest useful change is three lines. Here is training code before and after, with nothing
else altered.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'train.py',
      caption: 'The instrumented version answers "what did we run, and what did it score?" forever. The original answers it until the terminal scrollback is gone.',
      code: `import mlflow
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score

# --- before: the numbers exist only in your terminal ---
def train_untracked(X_train, y_train, X_val, y_val):
    model = RandomForestClassifier(n_estimators=300, max_depth=12, random_state=0)
    model.fit(X_train, y_train)
    auc = roc_auc_score(y_val, model.predict_proba(X_val)[:, 1])
    print("AUC:", auc)          # gone when you close the tab
    return model


# --- after: the same run, recorded ---
def train_tracked(X_train, y_train, X_val, y_val, git_sha: str):
    mlflow.set_experiment("churn-prediction")

    # Params are chosen once, in one place, so they can be logged as a unit.
    params = {"n_estimators": 300, "max_depth": 12, "random_state": 0}

    with mlflow.start_run(run_name="rf-baseline") as run:
        # The tag is what lets you get from a surprising metric back to the code.
        mlflow.set_tag("git_sha", git_sha)
        mlflow.log_params(params)

        model = RandomForestClassifier(**params).fit(X_train, y_train)
        auc = roc_auc_score(y_val, model.predict_proba(X_val)[:, 1])
        mlflow.log_metric("val_auc", auc)

        # Logging the model stores the weights AND the environment needed to load them.
        mlflow.sklearn.log_model(model, name="model", input_example=X_val[:5])

        print("run:", run.info.run_id)
        return model`,
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'The half-adoption trap',
      md: `The most common failure is logging metrics and parameters but not the model itself. You
end up with a beautiful comparison table and no way to obtain the artifact any row describes.
Six months later the best run in your dashboard is unreachable. **If a run is worth logging, log
the model in the same run** — that is what binds a score to a thing you can actually deploy.`,
    },
    {
      type: 'markdown',
      md: `
## When you do not need this

Tracking is cheap, but not free — it is a server, a database, a blob store and a schema your
team has to agree on. Skip it when:

- You are exploring for an afternoon and will throw the code away. A notebook is fine.
- The model is retrained by an automated pipeline that already records its own lineage, and no
  human ever compares candidate runs by hand.
- Your platform already provides tracking, which is common on managed ML services. Running a
  second system in parallel gets you two half-populated sources of truth.

The signal that you *do* need it is specific and easy to recognise: **more than one person is
training models against the same problem, or the same person is doing it across more than about
a week.** Below that threshold human memory works. Above it, it reliably does not.
`.trim(),
    },
    {
      type: 'checklist',
      title: 'Before you instrument anything',
      items: [
        'Decide what a run means for your team — one training job, not one notebook execution',
        'Agree on an experiment naming convention now; renaming later loses nothing but confuses everyone',
        'Log the git commit SHA as a tag on every run, from day one',
        'Log the model artifact in the same run as its metrics, never separately',
        'Record which data the run saw — a path, a snapshot date, or a hash, but something',
        'Accept that explicability, not bit-identical reruns, is the achievable goal',
      ],
    },
  ],

  flashcards: [
    { front: 'Why is git insufficient for reproducing a model?', back: 'A model is a function of code, data, hyperparameters, environment and randomness. Git version-controls only the code, so four of the five inputs are unrecorded.' },
    { front: 'What are the four things a run records, and why are they treated differently?', back: 'Parameters (immutable inputs), metrics (time-series outputs), tags (mutable annotations for search), artifacts (large files in blob storage). Each has different mutability and storage needs.' },
    { front: 'Name MLflow\'s four core components.', back: 'Tracking (record runs), Models (a portable packaging format), Model Registry (named versions and lineage), Projects (executable, reproducible run definitions).' },
    { front: 'What is the half-adoption trap?', back: 'Logging metrics and parameters without logging the model artifact. You get a comparison table full of rows you cannot turn back into a deployable model.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'A colleague argues that committing training code to git makes experiment tracking unnecessary. What is the strongest counter?',
      options: [
        'Git repositories become too large when models are committed',
        'Git cannot store floating-point metrics accurately',
        'A trained model also depends on data, hyperparameters, environment and randomness, none of which the commit captures',
        'Git lacks a web interface for comparing branches',
      ],
      answerIndex: 2,
      explanation: 'The commit pins the code and nothing else. Two runs of the same commit against different data cuts, seeds or library versions produce different models, and the repository cannot tell you which one you are holding. Model size is a real but separate concern, and it argues for artifact storage rather than against tracking.',
    },
    {
      id: 'q2',
      prompt: 'Why does MLflow keep parameters immutable while allowing tags to be changed?',
      options: [
        'Parameters define what the run was, so changing one would rewrite history; tags are organisational annotations that legitimately evolve',
        'Parameters are stored in blob storage, which does not support updates',
        'Tags are indexed for search and parameters are not',
        'Immutability is required for metrics but is applied to parameters for consistency',
      ],
      answerIndex: 0,
      explanation: 'A run is a record of something that already happened. If you could rewrite the learning rate afterwards, the record would no longer describe the execution that produced the model. Tags carry facts about the run rather than inputs to it, such as an owner or a review status, and those genuinely change.',
    },
    {
      id: 'q3',
      prompt: 'You set a random seed and still cannot reproduce a GPU training run bit-for-bit. What is the appropriate conclusion?',
      options: [
        'The seed was logged as a metric instead of a parameter',
        'Explicability is the achievable goal — knowing exactly what produced the model — while bit-identical reruns depend on hardware and library determinism you do not fully control',
        'MLflow failed to capture the environment and should be reconfigured',
        'Seeds only work when the run is executed inside an MLflow Project',
      ],
      answerIndex: 1,
      explanation: 'Seeds fix sampling and initialisation, not GPU kernel scheduling, parallel data-loader ordering, or a library default that shifted between versions. Recording everything that shaped the run is both achievable and sufficient for the questions teams actually ask.',
    },
    {
      id: 'q4',
      prompt: 'Which situation is the clearest signal that a team has outgrown ad-hoc tracking?',
      options: [
        'The training script exceeds a few hundred lines',
        'The model is being deployed to a cloud provider rather than run locally',
        'The dataset no longer fits in memory on one machine',
        'More than one person trains models on the same problem, or one person does so over more than about a week',
      ],
      answerIndex: 3,
      explanation: 'The constraint that breaks first is human memory, not code size or data volume. A single person over a few days can hold the comparison in their head. Two people, or one person across weeks, cannot — and that is exactly when a shared, queryable record starts paying for itself.',
    },
    {
      id: 'q5',
      prompt: 'What does the dotted lineage arrow from a registered model version back to its run buy you?',
      options: [
        'It reduces artifact storage by deduplicating model files across versions',
        'It lets the registry recompute metrics on demand without retraining',
        'When the live model behaves oddly, you can recover which code, parameters and data produced it',
        'It allows the serving layer to fall back to a previous version automatically',
      ],
      answerIndex: 2,
      explanation: 'Lineage is the link that makes a production incident debuggable. Without it you have a binary in a registry and no account of its origin, which is the situation the whole tool exists to prevent. Rollback is a registry feature, but it is achieved through aliases rather than through the lineage link.',
    },
  ],
};
