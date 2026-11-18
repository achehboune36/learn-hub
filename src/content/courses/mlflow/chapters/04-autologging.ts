import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'autologging',
  title: 'Autologging and its blind spots',
  summary: 'One line captures parameters, metrics and the model for most frameworks. Knowing precisely what it does and does not see is what separates a useful default from a false sense of coverage.',
  estimatedMinutes: 20,

  blocks: [
    {
      type: 'markdown',
      md: `
\`mlflow.autolog()\` instruments your training framework by monkey-patching its fit methods. Call
it once, before training, and runs start appearing with parameters, metrics and a logged model
that you never wrote code for.

It is genuinely the highest-value single line in the library. It is also the source of the most
misplaced confidence, because **what it captures is defined by the framework's API, not by your
intent.** Anything you do outside the estimator's own \`fit\` call is invisible to it.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'autolog_basic.py',
      code: `import mlflow
from sklearn.ensemble import GradientBoostingClassifier

# One call, before training. With no arguments it enables every integration
# for libraries it finds installed.
mlflow.autolog()

mlflow.set_experiment("churn-prediction")

# No start_run needed — autologging opens one on fit() if none is active.
# Being explicit is still better: it lets you name the run and add tags.
with mlflow.start_run(run_name="gbm-autologged"):
    model = GradientBoostingClassifier(n_estimators=200, max_depth=3)
    model.fit(X_train, y_train)

    # Captured automatically from this single fit call:
    #   params  — every value from model.get_params(), including defaults you never set
    #   metrics — the estimator's own training score
    #   model   — logged with an inferred signature
    #   tags    — the estimator class name and the autologging version`,
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    A["mlflow.autolog()"] -->|"patches"| F["estimator.fit()"]

    F --> P["get_params()<br/>→ parameters"]
    F --> M["training score<br/>→ metrics"]
    F --> S["the fitted object<br/>→ logged model"]

    subgraph Invisible["Outside the patch — never captured"]
      X1["Your feature engineering"]
      X2["Your held-out evaluation"]
      X3["Business metrics<br/>and thresholds"]
      X4["Which data file you read"]
    end

    style Invisible stroke-dasharray: 5 5
`.trim(),
      caption: 'Autologging sees exactly one function call. Everything before and after it is your responsibility.',
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'The metric autolog gives you is usually not the one you care about',
      md: `For scikit-learn, the automatically logged score is computed on the data passed to
\`fit\` — the **training** set. It is an optimistic number that says nothing about
generalisation. Teams routinely ship dashboards ranking runs by an autologged training accuracy
and wonder why the ordering does not survive contact with production. Your validation metric
still has to be logged by hand.`,
    },
    {
      type: 'markdown',
      md: `
## What each integration actually captures

Coverage varies by framework, because each patch can only surface what that library exposes.

| Framework | Parameters | Metrics | Model | Notable extra |
|---|---|---|---|---|
| scikit-learn | All of \`get_params()\` | Training score; search results | Yes, with signature | Child runs per hyperparameter combination |
| XGBoost / LightGBM | Booster config | Per-iteration eval metrics, with steps | Yes | Feature importance plot |
| PyTorch Lightning | Trainer and module hyperparameters | Whatever you pass to \`self.log()\` | Checkpoints | Early-stopping state |
| Keras / TensorFlow | Optimiser, loss, layer config | Per-epoch train and validation metrics | Yes | TensorBoard-style curves |
| Transformers | \`TrainingArguments\` | Trainer-reported metrics | Yes | Tokeniser bundled with the model |
| LangChain, OpenAI, LlamaIndex | Invocation parameters | Token usage and latency | Where applicable | **Traces** — spans per call |

The deep-learning integrations are the strongest, because those frameworks already have a
callback system with a well-defined notion of an epoch metric. The scikit-learn integration is
the weakest in the sense that matters most: it has no concept of a validation set.
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## Hyperparameter search creates child runs

When autologging wraps \`GridSearchCV\` or \`RandomizedSearchCV\`, it logs the best parameters and
the best score on the parent run, then creates **child runs for individual parameter
combinations**. This is useful right up until it is not: a 500-point search would otherwise
produce 500 child runs.

MLflow caps this at five by default, controlled by \`max_tuning_runs\`. Setting it to \`None\` logs
every combination, which is occasionally what you want and is more often a way to make an
experiment unreadable.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'autolog_tuned.py',
      caption: 'Autologging for the mechanical parts, manual logging for the parts that carry meaning.',
      code: `import mlflow
from sklearn.model_selection import GridSearchCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score, average_precision_score

mlflow.sklearn.autolog(
    log_models=True,          # set False for large models you do not intend to keep
    log_input_examples=True,  # stores a sample of fit() input — useful, and it is your data
    log_datasets=False,       # off by default in some versions; be deliberate about it
    max_tuning_runs=10,       # child runs for the top N combinations, not all of them
    silent=True,              # suppress the integration's own warnings in notebooks
)

with mlflow.start_run(run_name="rf-grid") as run:
    search = GridSearchCV(
        RandomForestClassifier(random_state=0),
        param_grid={"max_depth": [4, 8, 12], "n_estimators": [100, 300]},
        cv=5,
        scoring="roc_auc",
    )
    search.fit(X_train, y_train)      # everything above this line is captured for you

    # --- everything that actually matters is below this line ---
    # Autologging never sees your held-out set. Log the honest numbers yourself.
    proba = search.best_estimator_.predict_proba(X_test)[:, 1]
    mlflow.log_metrics({
        "test_auc": roc_auc_score(y_test, proba),
        "test_avg_precision": average_precision_score(y_test, proba),
        # The metric the business will judge this on, whatever it is.
        "recall_at_5pct_alert_rate": recall_at_alert_rate(y_test, proba, rate=0.05),
    })
    mlflow.set_tag("eval_set", "2026-Q2-holdout")`,
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'log_models=True on a large model, in a loop',
      md: `Autologging stores a model on **every** patched \`fit\` call. In a cross-validation loop
or a long sweep with a large network, that is dozens of multi-hundred-megabyte uploads nobody
asked for, and a storage bill that arrives a month later. When sweeping, set
\`log_models=False\` and log only the winner explicitly.`,
    },
    {
      type: 'markdown',
      md: `
## Interactions worth knowing

**Autologging plus manual logging of the same key conflicts.** If the integration logs
\`training_score\` and you also log a parameter the estimator already reported, you can hit an
immutable-parameter error. Keep manual logging to keys the framework does not produce.

**\`mlflow.autolog()\` with no arguments enables every installed integration.** In an environment
with both scikit-learn and PyTorch present, a stray \`fit\` in a preprocessing utility can open a
run you did not intend. Prefer the specific form — \`mlflow.sklearn.autolog()\` — in library code,
and reserve the global call for notebooks.

**\`disable=True\` turns an integration off** without removing the call, which is the clean way to
kill autologging in a config rather than by deleting lines.

**\`exclusive=True\` makes autologged runs refuse to share a run with manual logging.** It is
occasionally useful for enforcing separation, and it surprises people who then find their manual
metrics silently absent.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'Tracing is autologging for LLM applications',
      md: `Calling \`mlflow.openai.autolog()\` or \`mlflow.langchain.autolog()\` records a **trace**
per invocation: a tree of spans with the prompt, the response, token counts and latency at each
step. It is the same instrument-by-patching idea applied to inference rather than training, and
it is the practical way to see what a chain actually sent to the model — which is almost never
what the code appears to say.`,
    },
    {
      type: 'table',
      headers: ['Situation', 'Autolog setting', 'Reason'],
      rows: [
        ['Exploring in a notebook', '`mlflow.autolog()`', 'Zero friction; capture everything and sort it out later'],
        ['Hyperparameter sweep', '`log_models=False`, `max_tuning_runs` set', 'Avoids storing hundreds of models nobody will load'],
        ['Production training pipeline', 'Framework-specific call, `silent=True`', 'Explicit about what is instrumented; no surprise runs from utilities'],
        ['Custom training loop', 'Autolog adds little — log manually', 'There is no `fit` to patch, so the integration has nothing to see'],
        ['Debugging an LLM chain', '`mlflow.langchain.autolog()`', 'Traces show the real prompts and token usage per span'],
      ],
    },
    {
      type: 'checklist',
      title: 'Using autologging honestly',
      items: [
        'Log your held-out validation metric by hand — the autologged score is on training data',
        'Prefer the framework-specific call over the global one in anything that is not a notebook',
        'Set log_models=False inside sweeps and cross-validation loops',
        'Cap max_tuning_runs so a large search does not flood the experiment',
        'Log the dataset, the git SHA and the business metric yourself; autolog sees none of them',
        'Check what actually landed on the first run before trusting it on the hundredth',
      ],
    },
  ],

  flashcards: [
    { front: 'What does scikit-learn autologging compute its metric on?', back: 'The data passed to fit, meaning the training set. It is an optimistic number, and your held-out validation metric still has to be logged manually.' },
    { front: 'What is max_tuning_runs for?', back: 'It caps how many child runs are created for individual hyperparameter combinations during a GridSearchCV or RandomizedSearchCV, defaulting to five. Setting None logs every combination.' },
    { front: 'Why set log_models=False during a sweep?', back: 'Autologging saves a model on every patched fit call, so a sweep or cross-validation loop uploads dozens of models nobody will load, at real storage cost.' },
    { front: 'What does mlflow.langchain.autolog() produce that training autologging does not?', back: 'Traces: a tree of spans per invocation carrying prompts, responses, token counts and latency, which shows what the chain actually sent rather than what the code appears to say.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'A team ranks runs by the accuracy that scikit-learn autologging recorded, and the ordering does not hold up in production. What is the flaw?',
      options: [
        'Autologged metrics are rounded to three decimal places before storage',
        'The autologged score is computed on the data passed to fit, so it measures training-set performance',
        'Accuracy is logged as a parameter and therefore compared as a string',
        'Autologging records the score before the final boosting iteration completes',
      ],
      answerIndex: 1,
      explanation: 'The integration can only see the fit call, and the only data it has is what fit received. That produces an optimistic training score which says nothing about generalisation. Ranking candidates requires a held-out metric that you log yourself.',
    },
    {
      id: 'q2',
      prompt: 'You enable autologging and run a 500-point randomized search. What is the default behaviour regarding child runs?',
      options: [
        'All 500 combinations become child runs',
        'No child runs are created; only the best parameters land on the parent',
        'The best five combinations become child runs, controlled by max_tuning_runs',
        'Child runs are created only if you wrap the search in start_run',
      ],
      answerIndex: 2,
      explanation: 'Logging every combination would make the experiment unreadable, so MLflow caps child runs at five by default. The parent still carries the best parameters and best score. Raising the cap or setting it to None is a deliberate choice, not the default.',
    },
    {
      id: 'q3',
      prompt: 'Which of these does autologging capture without any additional code?',
      options: [
        'The version of the training dataset that was read from S3',
        'The alert-rate threshold your team uses to judge the model',
        'The estimator\'s constructor parameters, including defaults you never set explicitly',
        'The feature engineering applied before fit was called',
      ],
      answerIndex: 2,
      explanation: 'The patch reads get_params on the estimator, which returns the full parameter set including untouched defaults. Everything outside that single fit call, including data provenance, preprocessing and any business threshold, is invisible to it and must be logged deliberately.',
    },
    {
      id: 'q4',
      prompt: 'Why prefer mlflow.sklearn.autolog() over bare mlflow.autolog() inside a production training package?',
      options: [
        'The bare call is deprecated in MLflow 3',
        'The framework-specific call logs strictly more information',
        'The bare call cannot be combined with an explicit start_run',
        'The bare call enables every installed integration, so an unrelated fit in a utility can open runs you did not intend',
      ],
      answerIndex: 3,
      explanation: 'Enabling everything is convenient in a notebook and unpredictable in a package, where a preprocessing helper calling fit will silently start a run. Naming the integration makes the instrumentation explicit. Neither form is deprecated, and both work with an explicit run.',
    },
    {
      id: 'q5',
      prompt: 'You have a custom PyTorch training loop written by hand, with no Lightning Trainer. What should you expect from autologging?',
      options: [
        'Very little — there is no framework fit method to patch, so manual logging is the real answer',
        'Full parameter and metric capture, since MLflow inspects the optimiser directly',
        'Per-epoch metrics only, with parameters requiring manual logging',
        'An error, because autologging requires a supported high-level API',
      ],
      answerIndex: 0,
      explanation: 'Autologging works by wrapping a framework entry point. A hand-written loop has none, so there is nothing to intercept and nothing is captured. It does not raise an error, it simply stays quiet, which is exactly the case where a false sense of coverage is most dangerous.',
    },
  ],
};
