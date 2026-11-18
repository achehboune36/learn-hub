import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'evaluation',
  title: 'Evaluating models with MLflow',
  summary: 'Turning evaluation into a logged, comparable artifact rather than a number in a notebook: built-in metrics, custom business metrics, threshold gates for CI, and LLM-as-judge scoring.',
  estimatedMinutes: 24,

  blocks: [
    {
      type: 'markdown',
      md: `
Evaluation usually lives in the worst possible place: a notebook cell, run once, whose output
was pasted into a message. The number that decided a deployment is then unreproducible, and
nobody can say which data it was computed on.

\`mlflow.evaluate\` makes evaluation a **logged artifact of a run** — metrics, plots and a
per-row results table, attached to the model, comparable across candidates, and referenceable
six months later.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'evaluate_basic.py',
      caption: 'One call produces a dozen metrics, several plots and a per-row table. The eval_data must include the target column, named in targets.',
      code: `import mlflow
import pandas as pd

# The evaluation set carries features AND the ground-truth column together.
eval_data = X_test.copy()
eval_data["churned"] = y_test

with mlflow.start_run(run_name="eval-v7"):
    result = mlflow.evaluate(
        model="models:/churn-detector/7",   # or a run URI, or a callable
        data=eval_data,
        targets="churned",
        model_type="classifier",
        evaluators="default",
        evaluator_config={
            # SHAP explanations. Genuinely useful, and slow on wide data —
            # it is off by default for that reason.
            "log_model_explainability": True,
        },
    )

    # Everything below is now logged to the run as well as returned.
    print(result.metrics["roc_auc"], result.metrics["f1_score"])

    # The per-row table: inputs, predictions and targets side by side. This is
    # what you filter to find out WHICH cases the model gets wrong.
    errors = result.tables["eval_results_table"]
    worst = errors[errors["churned"] != (errors["prediction"] > 0.5)]
    mlflow.log_table(worst.head(200), "misclassified_sample.json")`,
    },
    {
      type: 'markdown',
      md: `
## What the default evaluator produces

Passing a \`model_type\` selects a metric bundle. You get more than you would have written by
hand, which is most of the value — the metrics you skip are usually the ones that would have
caught the problem.

| \`model_type\` | Metrics you get | Artifacts logged |
|---|---|---|
| \`classifier\` | Accuracy, precision, recall, F1, ROC AUC, log loss, per-class breakdowns | Confusion matrix, ROC curve, precision-recall curve, lift chart |
| \`regressor\` | MAE, MSE, RMSE, R², mean absolute percentage error | Residual and prediction-error plots |
| \`question-answering\` | Exact match, token count, latency, toxicity | Per-row results table |
| \`text-summarization\` | ROUGE variants, toxicity, readability | Per-row results table |
| \`retriever\` | Precision, recall and NDCG at k | Per-row results table |

Every type also logs the **per-row results table**, and that table is more valuable than the
aggregate metrics. An AUC tells you the model is worse this week. The table tells you it is worse
on accounts created in the last thirty days, which is a thing you can act on.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    M["Candidate model"] --> E["mlflow.evaluate()"]
    D["Eval dataset<br/>features + targets"] --> E

    E --> AGG["Aggregate metrics<br/>auc, f1, log loss"]
    E --> PLOTS["Plots<br/>confusion matrix, ROC, SHAP"]
    E --> TBL["Per-row results table<br/>input | prediction | target"]

    AGG --> G{"Threshold gate:<br/>beats the baseline<br/>by a real margin?"}
    B["Incumbent champion<br/>evaluated on the SAME data"] --> G

    G -->|"yes"| P["Register and promote"]
    G -->|"no"| F["Fail the pipeline<br/>with the offending metric named"]

    TBL -.->|"slice and inspect"| WHY["Which segment regressed?"]
`.trim(),
      caption: 'Aggregate metrics decide the gate. The per-row table is what tells you why the gate said no.',
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'Comparing against a baseline evaluated on different data proves nothing',
      md: `The incumbent's AUC recorded three months ago was measured on that month's test set. Your
candidate's AUC is on this month's. If the comparison shows an improvement, you cannot tell
whether the model got better or the data got easier. **Re-evaluate the baseline on the same
dataset, in the same pipeline run.** It costs one extra inference pass and it is the difference
between a gate and a ritual.`,
    },
    {
      type: 'markdown',
      md: `
## Custom metrics: the ones your business actually uses

Built-in metrics are generic by construction. The number your organisation makes decisions with
is usually not among them — it is *recall at the alert rate the operations team can staff*, or
*expected cost given that a false negative costs eleven times a false positive*.

\`make_metric\` turns such a function into a first-class metric: logged, plotted, and usable in a
threshold gate.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'custom_metrics.py',
      caption: 'The metric that reflects the actual decision, elevated to the same status as accuracy.',
      code: `import numpy as np
import mlflow
from mlflow.metrics import make_metric, MetricValue


def _recall_at_alert_rate(predictions, targets, metrics, rate=0.05):
    """Of the churners, what share land in the top 5% of scores?

    This is the metric that matches how the model is used: the retention team can
    call a fixed number of accounts per week, so what matters is how many real
    churners fall inside that budget — not accuracy over the whole population.
    """
    y_true = np.asarray(targets)
    scores = np.asarray(predictions)

    k = max(1, int(len(scores) * rate))
    top_k_idx = np.argsort(scores)[-k:]

    caught = y_true[top_k_idx].sum()
    total_positives = y_true.sum()
    value = float(caught / total_positives) if total_positives else 0.0

    return MetricValue(aggregate_results={"recall_at_alert_rate": value})


def _expected_cost(predictions, targets, metrics, fn_cost=11.0, fp_cost=1.0):
    """False negatives cost 11x false positives here. Lower is better."""
    y_true = np.asarray(targets)
    y_pred = (np.asarray(predictions) > 0.5).astype(int)

    fn = int(((y_true == 1) & (y_pred == 0)).sum())
    fp = int(((y_true == 0) & (y_pred == 1)).sum())
    return MetricValue(aggregate_results={"expected_cost": fn * fn_cost + fp * fp_cost})


recall_at_alert_rate = make_metric(
    eval_fn=_recall_at_alert_rate, greater_is_better=True, name="recall_at_alert_rate"
)
expected_cost = make_metric(
    eval_fn=_expected_cost, greater_is_better=False, name="expected_cost"
)

result = mlflow.evaluate(
    model="models:/churn-detector/7",
    data=eval_data,
    targets="churned",
    model_type="classifier",
    extra_metrics=[recall_at_alert_rate, expected_cost],
)`,
    },
    {
      type: 'markdown',
      md: `
## Gating a pipeline on thresholds

The point of comparable evaluation is to let CI refuse a bad model without a human in the loop.
\`MetricThreshold\` expresses three distinct ideas, and the second and third are the ones that
matter:

- \`threshold\` — an absolute floor. Useful as a sanity check.
- \`min_absolute_change\` — the candidate must beat the baseline by at least this much. **This is
  the noise filter.** Set it above your evaluation's run-to-run variance or you will promote
  noise half the time.
- \`min_relative_change\` — the same idea as a proportion, better when metric scales differ across
  models.

Note that where this call lives has moved between MLflow versions: older code passes
\`validation_thresholds\` and \`baseline_model\` directly to \`mlflow.evaluate\`, while current
versions separate validation into its own step. Check your version, and expect tutorials to
disagree.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'gate.py',
      caption: 'Evaluate both models on identical data, then validate. A raised exception fails the CI job, which is precisely the intent.',
      code: `import mlflow
from mlflow.models import MetricThreshold

# Evaluate BOTH on the same dataset in the same run. This is the whole point.
with mlflow.start_run(run_name="promotion-gate") as run:
    candidate = mlflow.evaluate(
        model="runs:/8f3adc21/model",
        data=eval_data, targets="churned", model_type="classifier",
        extra_metrics=[recall_at_alert_rate],
    )
    baseline = mlflow.evaluate(
        model="models:/churn-detector@champion",
        data=eval_data, targets="churned", model_type="classifier",
        extra_metrics=[recall_at_alert_rate],
    )

    thresholds = {
        # An absolute floor: never ship something this bad, whatever the incumbent does.
        "roc_auc": MetricThreshold(threshold=0.80, greater_is_better=True),

        # The real gate. 0.005 was chosen by measuring run-to-run variance on this
        # eval set — below that, an "improvement" is indistinguishable from noise.
        "recall_at_alert_rate": MetricThreshold(
            min_absolute_change=0.005, greater_is_better=True
        ),
    }

    # Raises if any threshold is unmet, which fails the pipeline step.
    mlflow.validate_evaluation_results(
        candidate_result=candidate,
        baseline_result=baseline,
        validation_thresholds=thresholds,
    )

    mlflow.set_tag("gate", "passed")`,
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Set the change threshold from measured variance, not from a round number',
      md: `Run your evaluation three times with different random seeds and look at the spread. If
AUC moves by 0.004 between identical models, then a \`min_absolute_change\` of 0.001 promotes
coin flips. Teams pick 0.01 because it looks tidy and then wonder why half their promotions do
not reproduce. **Measure the noise first, then set the gate above it.**`,
    },
    {
      type: 'markdown',
      md: `
## Evaluating LLM applications

Generative outputs break the assumption everything above rests on: that there is one correct
answer to compare against. MLflow 3's \`mlflow.genai.evaluate\` replaces exact-match scoring with
**scorers**, most of which are themselves LLM calls with a rubric.

Built-in scorers cover the recurring questions — is the answer correct, is it relevant to the
question, is it grounded in the retrieved context, is it safe, does it follow stated guidelines.
Custom scorers are ordinary Python functions, which is where domain-specific checks belong.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'genai_eval.py',
      caption: 'Deterministic checks and judge-based scorers in one pass. The cheap deterministic ones catch the failures you can define exactly.',
      code: `import mlflow
from mlflow.genai.scorers import Correctness, RelevanceToQuery, Guidelines, scorer

# Each row is one test case. expectations carries whatever the scorers need.
eval_dataset = [
    {
        "inputs": {"question": "How do I cancel my subscription?"},
        "expectations": {"expected_response": "Settings, then Billing, then Cancel."},
    },
    {
        "inputs": {"question": "What is your refund window?"},
        "expectations": {"expected_response": "30 days from purchase."},
    },
]


# A custom scorer is just a function. Deterministic checks are cheap and exact —
# use them wherever the requirement can be stated precisely, and save the judge
# for questions that genuinely need semantic understanding.
@scorer
def cites_a_source(outputs: dict) -> bool:
    return "[source:" in outputs.get("response", "")


results = mlflow.genai.evaluate(
    data=eval_dataset,
    predict_fn=my_rag_app,          # called once per row; traced automatically
    scorers=[
        Correctness(),              # LLM judge, against expected_response
        RelevanceToQuery(),         # LLM judge, no ground truth needed
        Guidelines(                 # LLM judge against a rubric you write
            name="tone",
            guidelines="Be concise and never speculate about account specifics.",
        ),
        cites_a_source,             # deterministic, effectively free
    ],
)`,
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'A judge is a model, so it needs evaluating too',
      md: `LLM-as-judge scores are estimates produced by a system with its own biases — towards
longer answers, towards its own phrasing, and towards whatever its provider changed last week.
Before trusting a judge, **grade fifty examples by hand and measure agreement with it.** If the
judge agrees with you 70% of the time, a 3-point movement in its score means nothing. Judges also
drift when the underlying model is updated, so pin the judge model version if the score gates
anything.`,
    },
    {
      type: 'checklist',
      title: 'Evaluation that can be trusted',
      items: [
        'Evaluation runs in the pipeline, not in a notebook, and logs to a run',
        'The baseline re-evaluated on the same dataset in the same run as the candidate',
        'The metric your organisation actually decides with defined via make_metric',
        'Per-row results table kept, and sliced by segment when a metric moves',
        'Change thresholds set above measured run-to-run variance',
        'The eval dataset versioned and logged with log_input, so a metric shift is attributable',
        'For LLM apps, deterministic scorers wherever the requirement can be stated exactly',
        'Judge agreement with human grading measured before any judge score gates a release',
      ],
    },
  ],

  flashcards: [
    { front: 'Why is the per-row results table often more useful than the aggregate metrics?', back: 'Aggregates tell you performance dropped. The table lets you slice by segment and discover it dropped only on accounts created in the last thirty days, which is actionable.' },
    { front: 'Why must the baseline be re-evaluated on the same dataset as the candidate?', back: 'A baseline metric recorded months ago was measured on different data, so any comparison confounds model improvement with the data getting easier or harder.' },
    { front: 'How should min_absolute_change be chosen?', back: 'By measuring run-to-run variance of the evaluation across seeds, then setting the threshold above it. A gate below the noise floor promotes coin flips.' },
    { front: 'What must you check before trusting an LLM judge score?', back: 'Its agreement with human grading on a sample of around fifty examples. A judge that agrees 70% of the time cannot support a decision on a small score movement.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Your candidate model scores AUC 0.88 and the incumbent\'s recorded AUC from three months ago was 0.86. Why is promoting on this comparison unsound?',
      options: [
        'AUC is not a valid metric for comparing model versions',
        'The two numbers were computed on different datasets, so the difference confounds model quality with a change in the data',
        'The incumbent\'s metric was logged as a parameter and compared as a string',
        'Three months is longer than the metric retention window',
      ],
      answerIndex: 1,
      explanation: 'A metric is only meaningful relative to the data it was measured on. If this month\'s test set happens to be easier, a worse model can post a higher number. Running the incumbent through the same evaluation in the same pipeline costs one inference pass and removes the ambiguity.',
    },
    {
      id: 'q2',
      prompt: 'A team sets min_absolute_change to 0.001 on AUC, and finds that promoted models often fail to reproduce their gains. What went wrong?',
      options: [
        'The threshold should have been expressed as a relative change instead',
        'greater_is_better was left at its default and inverted the comparison',
        'The threshold sits below the evaluation\'s run-to-run variance, so noise passes the gate',
        'Absolute change thresholds only apply to regression metrics',
      ],
      answerIndex: 2,
      explanation: 'If two identical models can differ by 0.004 across seeds, a gate at 0.001 is measuring randomness. Measuring the spread first and setting the threshold above it is what makes the gate mean something. Relative change has exactly the same problem if chosen without measurement.',
    },
    {
      id: 'q3',
      prompt: 'Why define recall at a fixed alert rate as a custom metric rather than relying on the built-in classifier bundle?',
      options: [
        'Built-in metrics cannot be used in threshold gates',
        'The built-in bundle omits recall entirely for binary classifiers',
        'Custom metrics are computed faster because they skip the results table',
        'It matches how the model is used, since the team can only contact a fixed number of accounts, which generic accuracy metrics do not capture',
      ],
      answerIndex: 3,
      explanation: 'The built-in metrics are generic by design and measure the model in the abstract. A retention team with a weekly calling budget cares only about how many real churners fall inside that budget. Making that a first-class metric means the gate optimises the thing the organisation actually cares about.',
    },
    {
      id: 'q4',
      prompt: 'When building an LLM evaluation suite, why prefer a deterministic scorer where one is possible?',
      options: [
        'Deterministic scorers can be registered as models and judges cannot',
        'They are exact, effectively free, and do not drift, whereas a judge is another model with its own biases and costs',
        'LLM judges cannot be combined with deterministic scorers in a single evaluation',
        'Deterministic scorers are the only ones that produce a per-row results table',
      ],
      answerIndex: 1,
      explanation: 'If the requirement can be stated precisely, such as whether a citation marker appears, a plain function answers it perfectly for no cost and no variance. Judges are worth their cost only for questions needing semantic understanding, and the two mix freely in one evaluation run.',
    },
    {
      id: 'q5',
      prompt: 'What does logging the evaluation dataset with log_input add to the evaluation run?',
      options: [
        'It makes a later metric shift attributable, by recording which data the number came from',
        'It caches the dataset so subsequent evaluations run faster',
        'It is required before extra_metrics can be used',
        'It automatically re-evaluates the baseline on the same data',
      ],
      answerIndex: 0,
      explanation: 'Without a record of the evaluation set, a metric that moves between runs is ambiguous between a model change and a data change. Recording the source and digest makes that distinction checkable. It provides no caching and does not affect custom metrics or baselines.',
    },
  ],
};
