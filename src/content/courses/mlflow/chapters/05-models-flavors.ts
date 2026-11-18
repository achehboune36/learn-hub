import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'models-flavors',
  title: 'The MLflow Model format and flavors',
  summary: 'Why a pickle file is not a deployable model, what the MLmodel file declares, how the pyfunc contract makes any framework servable by the same code, and how signatures catch schema drift before production does.',
  estimatedMinutes: 26,

  blocks: [
    {
      type: 'markdown',
      md: `
Here is the problem the MLflow Model format solves. You have \`model.pkl\`. To use it, someone
needs to know:

- which library wrote it, and which version, because pickle is not portable across versions;
- what Python version it was created under;
- what shape of input it expects, in what dtype, in what column order;
- whether \`predict\` returns a class, a probability, or a tuple;
- what preprocessing has to happen first, and whether it is inside the object or outside it.

None of that is in the pickle. All of it lives in the head of whoever trained it, which is a
storage medium with poor durability guarantees.

**An MLflow Model is a directory that carries those answers with the weights.**
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## Anatomy of the directory

\`\`\`
model/
├── MLmodel                # the manifest — the only required file
├── model.pkl              # the serialised estimator (name varies by flavor)
├── requirements.txt       # pip requirements, inferred at log time
├── python_env.yaml        # python version + pip/virtualenv build steps
├── conda.yaml             # the same environment expressed for conda
└── input_example.json     # a few real rows, if you supplied them
\`\`\`

\`MLmodel\` is the manifest, and reading one carefully teaches you most of what this chapter has
to say.
`.trim(),
    },
    {
      type: 'code',
      lang: 'yaml',
      filename: 'model/MLmodel',
      caption: 'Two flavors describing one artifact. Deployment tools read the pyfunc entry; a Python user who wants the real estimator back reads the sklearn one.',
      code: `artifact_path: model
mlflow_version: 3.1.0
model_uuid: 8c1f2a7b4e0d4c3f9a2b1c8d7e6f5a40
utc_time_created: '2026-08-14 09:12:44.180213'

flavors:
  # The native flavor: how to get the original object back, with full fidelity.
  sklearn:
    sklearn_version: 1.5.2
    pickled_model: model.pkl
    serialization_format: cloudpickle

  # The universal flavor: how ANY tool can call this model without knowing sklearn.
  python_function:
    loader_module: mlflow.sklearn
    model_path: model.pkl
    python_version: 3.11.9
    env:
      conda: conda.yaml
      virtualenv: python_env.yaml

# The contract. Enforced at predict time when the model is loaded as pyfunc.
signature:
  inputs: '[{"name": "tenure_months", "type": "long", "required": true},
            {"name": "monthly_charges", "type": "double", "required": true},
            {"name": "contract_type", "type": "string", "required": true}]'
  outputs: '[{"type": "double", "name": "churn_probability"}]'
  params: '[{"name": "threshold", "type": "double", "default": 0.5}]'

saved_input_example_info:
  artifact_path: input_example.json
  type: dataframe
  pandas_orient: split`,
    },
    {
      type: 'markdown',
      md: `
## Flavors, and why there are always two

A **flavor** is one way of interpreting the same saved artifact. A model almost always has two.

The **native flavor** — \`sklearn\`, \`pytorch\`, \`xgboost\`, \`transformers\` — restores the original
object exactly. \`mlflow.sklearn.load_model()\` gives you back a real \`RandomForestClassifier\`,
with \`feature_importances_\` and everything else. Use it when you need the framework's own API.

The **\`python_function\` flavor** — pyfunc — is the universal contract, and it is the entire
reason MLflow's deployment story works. It promises exactly one thing:

> Give me a DataFrame, a numpy array, a dict or a list. I will return predictions.

That is a small enough promise that every deployment target can rely on it. The model server,
the Spark UDF, the Docker image and the cloud deployment plugins are all written against pyfunc
alone. They do not know or care that a scikit-learn model is inside.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart LR
    subgraph Train["Training — many frameworks"]
      A["sklearn"]
      B["PyTorch"]
      C["XGBoost"]
      D["Custom Python"]
    end

    A --> M["MLflow Model directory<br/>MLmodel + weights + env"]
    B --> M
    C --> M
    D --> M

    M -->|"python_function flavor"| PF["One contract:<br/>predict(input) → output"]

    PF --> S1["mlflow models serve"]
    PF --> S2["Spark UDF<br/>batch scoring"]
    PF --> S3["Docker image"]
    PF --> S4["Cloud endpoint"]
`.trim(),
      caption: 'Every framework converges on pyfunc, and every deployment target consumes only pyfunc. That narrow waist is the design.',
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'The narrow waist',
      md: `Without pyfunc you would need one deployment integration per framework, times one per
target — a multiplication that never converges. With it you need one adapter per framework *in*,
and one per target *out*. This is the same architectural move as the IP layer in networking, and
it is why "MLflow supports X" is usually a one-file change rather than a project.`,
    },
    {
      type: 'markdown',
      md: `
## Signatures: the schema contract

A signature declares input and output schemas. It is optional, and omitting it is a mistake you
discover in production, because pyfunc **enforces** the signature when one is present.

Enforcement is not merely a check. The rules are specific and worth memorising:

- **Missing required column** → error. Good; this is the failure you want, loudly and early.
- **Extra columns** → ignored, and the model still runs. Convenient, and a silent trap when a
  column is misspelled: the correct one is now missing and the typo is discarded.
- **Column order** → irrelevant when inputs are named. Names are matched, not positions.
- **Safe type upcast** → performed automatically. An \`int\` where a \`double\` is expected is cast.
- **Lossy conversion** → rejected. A \`double\` where an \`int\` is expected is an error, because
  the fractional part would be discarded silently.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'The integer column that becomes a float',
      md: `This one catches nearly everyone. Pandas cannot represent a missing value in a plain
integer column, so a single null promotes the whole column to \`float64\`. You train on complete
data, MLflow infers the column as \`long\`, and then the first production batch containing one
missing value arrives as \`double\` — a lossy conversion, and the request fails.

**Declare integer columns that can ever be null as \`double\` in the signature**, and handle the
missing value inside the model. The alternative is an outage on the day your upstream has a gap.`,
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'signatures.py',
      caption: 'Infer the signature from real data, then correct the columns that can be null. Validating in an isolated environment is the step that catches a broken requirements list.',
      code: `import mlflow
import pandas as pd
from mlflow.models import infer_signature, ModelSignature
from mlflow.types import Schema, ColSpec, ParamSchema, ParamSpec

# Inference from real data is the right starting point — it gets dtypes and names right.
predictions = model.predict(X_val)
signature = infer_signature(X_val, predictions)

# ...but override integer columns that can ever contain a missing value.
# A single null in production promotes the column to float64, and long <- double
# is a lossy conversion that pyfunc will refuse.
signature = ModelSignature(
    inputs=Schema([
        ColSpec("double", "tenure_months"),      # nullable upstream, so double, not long
        ColSpec("double", "monthly_charges"),
        ColSpec("string", "contract_type"),
    ]),
    outputs=Schema([ColSpec("double", "churn_probability")]),
    # Params are inference-time knobs the caller may pass per request.
    params=ParamSchema([ParamSpec("threshold", "double", 0.5)]),
)

with mlflow.start_run():
    mlflow.sklearn.log_model(
        model,
        name="model",
        signature=signature,
        # A real sample. It is stored with the model and used to validate the
        # environment on load — and it is the fastest way for a colleague to see
        # what this model expects.
        input_example=X_val.head(3),
        # Pin anything the inferred list will miss, such as a package used only
        # inside a custom predict path.
        extra_pip_requirements=["pandas==2.2.2"],
    )

# Validate in a FRESH environment before trusting the requirements file.
# This builds the env from python_env.yaml and runs a prediction inside it —
# which is how you find out that a transitive dependency was never captured.
mlflow.models.predict(
    model_uri="runs:/8f3adc21/model",
    input_data=X_val.head(3),
    env_manager="virtualenv",
)`,
    },
    {
      type: 'markdown',
      md: `
## Custom models: \`PythonModel\`

Real models are rarely just an estimator. There is a tokeniser, a lookup table, a business rule
that overrides the score for VIP customers. Wrapping all of it in a \`PythonModel\` turns the
whole assembly into one pyfunc — which means the serving stack sees a single model rather than
your pipeline's internals.

The two pieces that make this work are \`load_context\`, which runs once at load time, and
\`artifacts\`, a dict of extra files that get packaged alongside the model and handed back to you
through \`context.artifacts\`.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'custom_model.py',
      caption: 'Everything the model needs travels with it. The serving layer sees one pyfunc, not a pipeline.',
      code: `import json
import mlflow
import pandas as pd


class ChurnScorer(mlflow.pyfunc.PythonModel):
    """Estimator plus the business logic that surrounds it."""

    def load_context(self, context):
        # Runs ONCE when the model is loaded, not per request. Anything expensive
        # belongs here — loading weights in predict() is a classic latency bug.
        import joblib

        self.model = joblib.load(context.artifacts["estimator"])
        with open(context.artifacts["vip_accounts"]) as fh:
            self.vip = set(json.load(fh))

    def predict(self, context, model_input: pd.DataFrame, params=None):
        # params carries per-request knobs declared in the signature.
        params = params or {}
        threshold = params.get("threshold", 0.5)

        proba = self.model.predict_proba(model_input.drop(columns=["account_id"]))[:, 1]
        out = pd.DataFrame({"churn_probability": proba})

        # The business rule that would otherwise live in three different services.
        is_vip = model_input["account_id"].isin(self.vip)
        out["action"] = "monitor"
        out.loc[(out.churn_probability > threshold) & is_vip, "action"] = "escalate"
        out.loc[(out.churn_probability > threshold) & ~is_vip, "action"] = "campaign"
        return out


with mlflow.start_run():
    mlflow.pyfunc.log_model(
        name="churn_scorer",
        python_model=ChurnScorer(),
        # These paths are copied into the model directory at log time and reappear
        # under context.artifacts at load time, wherever the model ends up running.
        artifacts={
            "estimator": "artifacts/rf.joblib",
            "vip_accounts": "config/vip.json",
        },
        input_example=X_val.head(3),
        pip_requirements=["scikit-learn==1.5.2", "pandas==2.2.2", "joblib==1.4.2"],
    )`,
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Inferred requirements are a starting point, not a guarantee',
      md: `MLflow infers dependencies by inspecting the objects it is asked to serialise. It sees
scikit-learn because it is pickling an estimator. It does **not** see the package your custom
\`predict\` imports lazily, or a version constraint that only matters at runtime. The model then
serves correctly on your machine — where the package happens to be installed — and fails inside
a fresh container. Pin explicitly with \`pip_requirements\` or \`extra_pip_requirements\`, then
verify with \`mlflow.models.predict\` in a built environment.`,
    },
    {
      type: 'table',
      headers: ['Loading style', 'You get back', 'Use when'],
      rows: [
        ['`mlflow.sklearn.load_model(uri)`', 'The real estimator, framework API intact', 'You need `feature_importances_`, further fitting, or introspection'],
        ['`mlflow.pyfunc.load_model(uri)`', 'A uniform wrapper exposing `predict`', 'Serving, batch scoring, or any code that must not care about the framework'],
        ['`mlflow.pyfunc.spark_udf(spark, uri)`', 'A Spark UDF', 'Scoring a table of millions of rows in parallel'],
        ['`mlflow.models.predict(uri, data, env_manager=…)`', 'Predictions from an isolated env', 'Verifying the packaged environment actually works before you ship it'],
      ],
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'MLflow 3 made models first-class',
      md: `In MLflow 2 a model was an artifact hanging off a run, addressed as
\`runs:/<id>/model\`. MLflow 3 promotes it to a **LoggedModel** entity with its own identifier,
so metrics from later evaluation runs can attach to the *model* rather than to the training run
that happened to produce it. This matters for the common case where a model is trained once and
evaluated five times against new data. The parameter also changed name: prefer \`name=\` over the
older positional \`artifact_path=\` when logging.`,
    },
    {
      type: 'checklist',
      title: 'Before you call a model packaged',
      items: [
        'A signature is present, not omitted — enforcement is the point',
        'Integer columns that can ever be null declared as double',
        'An input_example supplied, using real rows from validation data',
        'Requirements pinned explicitly wherever inference could plausibly miss something',
        'Expensive loading done in load_context, never inside predict',
        'Auxiliary files passed as artifacts so they travel with the model',
        'Validated end to end with mlflow.models.predict in a fresh virtualenv',
        'Loadable as pyfunc by someone who has never seen the training code',
      ],
    },
  ],

  flashcards: [
    { front: 'What does the python_function flavor promise?', back: 'That the model accepts a DataFrame, array, dict or list and returns predictions. That single narrow contract is what every deployment target is written against.' },
    { front: 'How does signature enforcement treat extra columns versus missing ones?', back: 'Missing required columns raise an error; extra columns are silently ignored. The combination makes a misspelled column name fail quietly as a missing one.' },
    { front: 'Why declare a nullable integer column as double in a signature?', back: 'Pandas promotes an integer column to float64 as soon as it holds one null. Casting double back to long is lossy, so pyfunc rejects it and the request fails in production.' },
    { front: 'What runs in load_context and why does it matter?', back: 'One-time setup such as loading weights or lookup tables, executed when the model is loaded rather than per request. Doing it inside predict adds that cost to every single call.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Why does MLflow write both a native flavor and a python_function flavor for the same model?',
      options: [
        'The native flavor is a fallback used only if pyfunc loading fails',
        'The native flavor restores the framework object with full fidelity, while pyfunc gives deployment tools one uniform contract they can target regardless of framework',
        'They store different precision levels of the same weights',
        'Pyfunc is required for the model registry and the native flavor for serving',
      ],
      answerIndex: 1,
      explanation: 'They serve different consumers. A data scientist wanting feature importances needs the real estimator back. A model server wants to know nothing about scikit-learn, so it targets the narrow pyfunc contract. Neither is a fallback for the other.',
    },
    {
      id: 'q2',
      prompt: 'A production request fails with a schema error. The model expects a long for tenure_months, and the incoming batch has that column as double because one row had a missing value. What is the correct fix?',
      options: [
        'Remove the signature so enforcement stops rejecting the batch',
        'Drop rows with missing values before sending the request',
        'Declare the column as double in the signature and handle the missing value inside the model',
        'Cast the column to int32 in the serving layer before it reaches the model',
      ],
      answerIndex: 2,
      explanation: 'Pandas promotes an integer column to float as soon as a null appears, and pyfunc refuses double to long because it is lossy. Declaring the column as double makes the schema honest about what production actually sends. Removing the signature discards the protection, and silently dropping rows changes the output shape.',
    },
    {
      id: 'q3',
      prompt: 'Your model serves fine locally but fails inside a freshly built container with a missing-module error. What is the most likely cause, and the check that would have caught it?',
      options: [
        'Inferred requirements missed a package imported inside your custom predict path; mlflow.models.predict with an isolated env_manager would have caught it',
        'The MLmodel file lacks a native flavor; loading as pyfunc would have caught it',
        'The signature was inferred rather than declared; validating with infer_signature would have caught it',
        'The artifact store used a file:// URI; checking the run\'s artifact root would have caught it',
      ],
      answerIndex: 0,
      explanation: 'Dependency inference inspects the objects being serialised, so it sees the estimator library but not a package your own code imports lazily. Locally the package is already installed and hides the gap. Running a prediction in a freshly built environment reproduces the container exactly.',
    },
    {
      id: 'q4',
      prompt: 'You need to bundle a tokeniser, a lookup table and a business rule with your estimator so the serving stack sees one model. Which mechanism fits?',
      options: [
        'Log each component as a separate model and have the server call them in order',
        'A custom PythonModel whose artifacts dict carries the extra files, reassembled in load_context',
        'A conda.yaml listing the lookup table as a dependency',
        'A signature with additional params declaring the lookup table path',
      ],
      answerIndex: 1,
      explanation: 'The artifacts dict copies arbitrary files into the model directory at log time and hands their paths back through the context on load, so the whole assembly travels as one unit. Separate models push orchestration into the serving layer, and neither environment files nor signature params can carry data files.',
    },
    {
      id: 'q5',
      prompt: 'What problem does MLflow 3\'s LoggedModel entity address?',
      options: [
        'Models exceeding the artifact store size limit',
        'Pickle incompatibility between framework versions',
        'A model addressed only as an artifact of a training run, which makes it awkward to attach metrics from later evaluations',
        'The need for a separate signature file per deployment target',
      ],
      answerIndex: 2,
      explanation: 'When the model is just a path under a run, every metric produced afterwards has to attach to that training run or float free. Making the model an entity with its own id lets a model trained once and evaluated five times accumulate those results against itself. Serialisation and storage limits are unrelated.',
    },
  ],
};
