import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'tracking-runs',
  title: 'Runs, parameters, metrics and artifacts',
  summary: 'The tracking API in practice: the experiment and run hierarchy, what belongs in each of the four record types, nested runs for sweeps, and querying thousands of runs without opening the UI.',
  estimatedMinutes: 24,

  blocks: [
    {
      type: 'markdown',
      md: `
Tracking has a small API — perhaps a dozen functions you will ever use — and almost all the
difficulty is in deciding *what to log*, not how. This chapter covers the mechanics quickly and
then spends its time on the judgement calls that make a tracking store useful a year later
rather than an undifferentiated pile.
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## The hierarchy

\`\`\`
Experiment  "churn-prediction"       <- a problem you are working on
 └── Run  "rf-baseline"              <- one execution
      ├── params      {n_estimators: 300, max_depth: 12}
      ├── metrics     val_auc: [0.81, 0.84, 0.86]   (a series, by step)
      ├── tags        {git_sha: "a1b2c3d", owner: "sam"}
      ├── inputs      dataset: s3://…/train-2026-08.parquet
      └── artifacts   model/, feature_importance.png, confusion_matrix.png
\`\`\`

An **experiment** is a long-lived container scoped to a problem, not to a person or a day. Runs
accumulate in it for as long as the problem exists. The single most common organisational
mistake is creating an experiment per attempt, which defeats comparison — the entire point of
the grouping is that runs inside it are comparable.

A **run** should correspond to one training job. Not one notebook execution, not one cell. If
your notebook trains three models, that is three runs, and MLflow's nested runs exist precisely
for that shape.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    E["Experiment: churn-prediction"]
    E --> R1["Run: rf-baseline<br/>val_auc 0.86"]
    E --> R2["Run: xgb-sweep<br/>parent"]
    E --> R3["Run: logreg-control<br/>val_auc 0.79"]

    R2 --> C1["child: lr=0.01<br/>0.88"]
    R2 --> C2["child: lr=0.05<br/>0.91"]
    R2 --> C3["child: lr=0.10<br/>0.87"]

    C2 -.->|"best; promoted"| REG["Registered model v7"]
`.trim(),
      caption: 'One experiment, many runs. A hyperparameter sweep is a parent run whose children carry the individual trials.',
    },
    {
      type: 'markdown',
      md: `
## Choosing between the four record types

The API pushes you towards a decision every time you log something. These rules resolve almost
every case.

**Log it as a parameter** if it was an input you chose and it does not change during the run.
Parameters are stored as strings, so everything is coerced — \`log_param("max_depth", 12)\` comes
back as \`"12"\`. They are immutable: logging the same key twice with a different value in one run
is an error, by design.

**Log it as a metric** if it is a number the run produced. Metrics are floats and carry an
optional \`step\`, which is what turns them into curves. Log training loss every epoch with
\`step=epoch\` and you get a chart; log only the final value and you get a dot, and you will not
be able to tell a converged run from one that was still improving when it stopped.

**Log it as a tag** if it is a searchable fact about the run rather than an input to it. Git SHA,
branch, owner, ticket number, whether the run was a scheduled retrain or a manual experiment.
Tags are mutable, so they also work for lightweight workflow state.

**Log it as an artifact** if it is a file. Plots, the model, a sample of misclassified rows, the
resolved config. Artifacts have no size ceiling in the API, which is exactly why you need
judgement: they go to blob storage and someone pays for them.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Parameter values are length-capped; artifacts are not',
      md: `Parameter values are stored in a database column with a length limit. Dumping a full
JSON config, a SQL query or a list of 400 feature names into a parameter will either truncate or
fail depending on your MLflow and backend version. **Log the summary as parameters and the full
thing as an artifact** — \`mlflow.log_dict(config, "config.json")\` costs one line and has no such
limit.`,
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'training_loop.py',
      caption: 'A realistic run: config as both parameters and an artifact, metrics with steps, evaluation plots, and the model itself.',
      code: `import mlflow
import matplotlib.pyplot as plt
from sklearn.metrics import roc_auc_score

mlflow.set_tracking_uri("http://mlflow.internal:5000")
mlflow.set_experiment("churn-prediction")


def train(config: dict, data, git_sha: str):
    with mlflow.start_run(run_name=config["name"]) as run:
        # Tags first: if the run crashes, you still know whose it was and from which commit.
        mlflow.set_tags({
            "git_sha": git_sha,
            "trigger": "manual",
            "data_snapshot": data.snapshot_date,
        })

        # Flat, scalar inputs go in as params; the whole config goes in as an artifact
        # because it is nested and will outgrow the parameter length limit.
        mlflow.log_params({
            "model": config["model"],
            "learning_rate": config["learning_rate"],
            "max_depth": config["max_depth"],
            "n_features": len(data.features),
        })
        mlflow.log_dict(config, "config.json")

        # Declaring the dataset records source, schema and a hash — this is what makes
        # "which data did this run see?" answerable months later.
        mlflow.log_input(
            mlflow.data.from_pandas(data.train_df, source=data.uri, targets="churned"),
            context="training",
        )

        model = build(config)
        for epoch in range(config["epochs"]):
            loss = model.fit_one_epoch(data.train_df)
            val_auc = roc_auc_score(data.y_val, model.predict_proba(data.X_val)[:, 1])

            # step= is what makes these curves rather than final numbers.
            mlflow.log_metrics({"train_loss": loss, "val_auc": val_auc}, step=epoch)

        fig = plot_feature_importance(model, data.features)
        mlflow.log_figure(fig, "plots/feature_importance.png")
        plt.close(fig)

        # The model goes in the same run as its metrics. Always.
        mlflow.sklearn.log_model(
            model,
            name="model",
            input_example=data.X_val[:5],
        )
        return run.info.run_id`,
    },
    {
      type: 'markdown',
      md: `
## Run lifecycle, and the runs that never end

\`mlflow.start_run()\` as a context manager sets the run's status to \`FINISHED\` on clean exit and
\`FAILED\` on an exception. Use it that way. Runs started without the context manager, in a
notebook cell that you then abandon, stay in \`RUNNING\` forever — and because MLflow considers a
run active until told otherwise, your next \`log_metric\` call may land on the wrong run entirely.

The symptom is unmistakable once you have seen it: a run whose metrics jump discontinuously
because two training jobs were writing into it. If you work in notebooks, \`mlflow.end_run()\` at
the top of your training cell is a cheap insurance policy.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'Nested runs need nested=True, and a parent',
      md: `\`mlflow.start_run(nested=True)\` creates a child of the *currently active* run. Call it
with no active parent and you get a top-level run instead, silently. In a sweep, that turns 200
trials into 200 unparented runs cluttering the experiment. Wrap the sweep in an outer
\`start_run\` and let each trial open a nested one inside it.`,
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'sweep.py',
      caption: 'The parent run holds the sweep-level summary; each trial is a child. This is also the shape autologging produces for GridSearchCV.',
      code: `import itertools
import mlflow

grid = {"learning_rate": [0.01, 0.05, 0.1], "max_depth": [4, 8, 12]}


def sweep(data):
    keys = list(grid)
    best = {"auc": -1.0, "run_id": None}

    # The outer run is the sweep itself — it owns the summary, not a model.
    with mlflow.start_run(run_name="lr-depth-sweep") as parent:
        mlflow.log_param("search_space_size", len(list(itertools.product(*grid.values()))))

        for combo in itertools.product(*(grid[k] for k in keys)):
            params = dict(zip(keys, combo))

            # nested=True attaches this trial to the parent above.
            with mlflow.start_run(nested=True, run_name=str(params)) as child:
                mlflow.log_params(params)
                auc = train_and_score(params, data)
                mlflow.log_metric("val_auc", auc)

                if auc > best["auc"]:
                    best = {"auc": auc, "run_id": child.info.run_id}

        # Roll the winner up so the parent is self-describing in the runs table.
        mlflow.log_metric("best_val_auc", best["auc"])
        mlflow.set_tag("best_run_id", best["run_id"])
    return best`,
    },
    {
      type: 'markdown',
      md: `
## Querying: the UI is not the interface

The web UI is good for eyeballing a handful of runs. Past a few hundred, the useful interface is
\`mlflow.search_runs()\`, which returns a pandas DataFrame with one row per run and columns for
every parameter, metric and tag.

The filter syntax is a restricted SQL-like string. Comparisons on metrics are numeric, on
parameters and tags they are string comparisons — which is the source of the classic surprise
that \`params.max_depth > "9"\` excludes \`"12"\`, because \`"12"\` sorts before \`"9"\`
lexicographically.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'query.py',
      code: `import mlflow

# Everything worth comparing, as a DataFrame.
runs = mlflow.search_runs(
    experiment_names=["churn-prediction"],
    filter_string=(
        "metrics.val_auc > 0.85 "
        "and tags.trigger = 'manual' "
        "and attributes.status = 'FINISHED'"
    ),
    order_by=["metrics.val_auc DESC"],
    max_results=50,
)

print(runs[["run_id", "params.model", "metrics.val_auc", "tags.git_sha"]].head())

# Numeric comparison on a PARAMETER is a string comparison — this is the trap.
#   "params.max_depth > '9'"   excludes max_depth=12, because "12" < "9" as text.
# Log anything you intend to filter numerically as a metric as well:
#   mlflow.log_metric("max_depth_numeric", 12)

# Reconstructing the best model is a two-liner once runs are queryable.
best_run_id = runs.iloc[0]["run_id"]
model = mlflow.pyfunc.load_model(f"runs:/{best_run_id}/model")`,
    },
    {
      type: 'table',
      headers: ['You want to record', 'Use', 'Why not the alternative'],
      rows: [
        ['Learning rate', 'Parameter', 'A metric would imply it changed during the run'],
        ['Learning rate under a scheduler', 'Metric, with step', 'It genuinely does change; a parameter cannot represent a curve'],
        ['Final validation AUC', 'Metric', 'Parameters are immutable strings and cannot be compared numerically in filters'],
        ['The full training config', 'Artifact via log_dict', 'Exceeds the parameter length limit and is nested'],
        ['Git commit SHA', 'Tag', 'It is a fact about the run, not an input, and you will filter on it'],
        ['Which data file was read', 'Dataset input, plus a tag for the snapshot date', 'A bare parameter loses the schema and the hash'],
        ['200 MB of model weights', 'Artifact, via log_model', 'Only artifacts go to blob storage; nothing else can hold a file'],
      ],
      caption: 'When two options both seem defensible, ask whether the value can change during the run.',
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'System metrics come free',
      md: `\`mlflow.enable_system_metrics_logging()\` records CPU, memory, GPU utilisation and GPU
memory as ordinary stepped metrics for the duration of the run. It costs nothing to switch on and
answers the question that otherwise requires rerunning the job: *was this slow because the model
is big, or because we were swapping?*`,
    },
    {
      type: 'checklist',
      title: 'Instrumenting a training job',
      items: [
        'One experiment per problem, one run per training job — never one experiment per attempt',
        'Always use start_run as a context manager so failures are recorded as FAILED, not left RUNNING',
        'Tags set first, before anything that might throw',
        'Scalar inputs as parameters; the full config as a JSON artifact alongside them',
        'Every metric that changes during training logged with step=',
        'Anything you will filter numerically logged as a metric, even if it is conceptually a parameter',
        'Dataset declared with log_input so the data question stays answerable',
        'Sweeps wrapped in a parent run, with each trial nested inside it',
        'The model logged in the same run as the metrics that describe it',
      ],
    },
  ],

  flashcards: [
    { front: 'What does the step argument to log_metric buy you?', back: 'It turns a metric into a time series, so training curves are visible. Without it you get a single final value and cannot distinguish a converged run from one that was still improving.' },
    { front: 'Why does filtering with params.max_depth > "9" exclude max_depth=12?', back: 'Parameters are stored as strings, so the comparison is lexicographic and "12" sorts before "9". Log anything you need to filter numerically as a metric as well.' },
    { front: 'What happens if you call start_run(nested=True) with no active parent run?', back: 'You silently get a top-level run instead of a child, which scatters sweep trials across the experiment as unparented runs.' },
    { front: 'Where should a large nested training config go?', back: 'As an artifact via log_dict, with only the flat scalars as parameters. Parameter values are length-capped by the backend database column.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Your team creates a new MLflow experiment for every model they try. What does this cost them?',
      options: [
        'Increased artifact storage, since each experiment duplicates the model files',
        'Comparability — the point of grouping runs in an experiment is that they can be ranked against each other, which is impossible across experiments',
        'Nothing; experiments are free and this is the recommended layout',
        'Slower queries, because each experiment maintains its own database index',
      ],
      answerIndex: 1,
      explanation: 'An experiment is a container for a problem, and its value comes from holding runs that answer the same question so you can sort them by a metric. Splitting attempts across experiments turns one ranked table into a dozen tables of one row each. Storage and index behaviour are unaffected.',
    },
    {
      id: 'q2',
      prompt: 'A run\'s validation AUC chart shows a sudden discontinuous jump partway through, and the run has been in RUNNING status for two days. What is the most likely cause?',
      options: [
        'The metric was logged without a step argument',
        'The backend store ran out of connections and dropped writes',
        'A run was started without a context manager and never ended, so a later job logged into the same run',
        'The learning rate scheduler was logged as a parameter rather than a metric',
      ],
      answerIndex: 2,
      explanation: 'An abandoned run stays active, and subsequent logging calls in the same process attach to it. Two training jobs writing into one run produce exactly this discontinuity. Using start_run as a context manager sets the status on exit and prevents the overlap.',
    },
    {
      id: 'q3',
      prompt: 'You want to record the learning rate, which is adjusted every epoch by a scheduler. What is correct?',
      options: [
        'A tag, updated each epoch, since tags are mutable',
        'A parameter, logged once per epoch with the same key',
        'A metric logged with step=epoch, because the value genuinely changes during the run',
        'An artifact, since the schedule is a sequence rather than a scalar',
      ],
      answerIndex: 2,
      explanation: 'The deciding question is whether the value changes during the run. A scheduled learning rate does, so it is a metric with a step and shows up as a curve. Re-logging a parameter with a different value in the same run is an error, and a tag would be overwritten with no history.',
    },
    {
      id: 'q4',
      prompt: 'What does mlflow.log_input add over simply logging the data path as a parameter?',
      options: [
        'It uploads a copy of the dataset into the artifact store for reproducibility',
        'It records the source alongside schema and a hash, and marks the role of the data such as training or validation',
        'It enables numeric filtering on dataset size in search_runs',
        'It is required before a model can be registered',
      ],
      answerIndex: 1,
      explanation: 'A bare path tells you where the file was, not what was in it or how it was used. The dataset input records structure and a digest with a context label, so a later change to the file at that path is detectable rather than invisible. It does not copy the data, and it is unrelated to registration.',
    },
    {
      id: 'q5',
      prompt: 'For a 200-run hyperparameter sweep, why wrap the trials in a parent run?',
      options: [
        'Nested runs are stored more compactly than top-level runs',
        'MLflow refuses to create more than 100 top-level runs in one experiment',
        'Only nested runs can log models',
        'It keeps the experiment\'s run table readable and gives the sweep a single row that carries the summary and the winner',
      ],
      answerIndex: 3,
      explanation: 'Without a parent, 200 trials sit at the top level alongside your genuinely distinct experiments and drown them. The parent collapses into one row you can expand, and it is the natural place for sweep-level facts such as the search space size and the best run id. Storage and logging capabilities are identical either way.',
    },
  ],
};
