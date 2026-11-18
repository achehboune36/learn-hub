import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'projects-environments',
  title: 'Projects and reproducible environments',
  summary: 'Making a training run executable by someone who has never seen the repository, and the three ways MLflow can rebuild the environment a model needs.',
  estimatedMinutes: 22,

  blocks: [
    {
      type: 'markdown',
      md: `
Tracking answers *what did this run do?* Projects answer the harder question: *can someone else
run it?*

An MLflow Project is a directory with an \`MLproject\` file declaring how to execute the code and
what environment it needs. The payoff is a single command that clones a git repository, builds
the right environment, and runs training with your parameters — on a colleague's laptop or a CI
runner, with no README steps in between.

\`\`\`
mlflow run git@github.com:acme/churn.git -v main -e train -P learning_rate=0.05
\`\`\`
`.trim(),
    },
    {
      type: 'code',
      lang: 'yaml',
      filename: 'MLproject',
      caption: 'Parameters get types and defaults, so a typo in a flag fails before training starts rather than forty minutes in.',
      code: `name: churn-prediction

# One of: python_env.yaml, conda.yaml, or a docker image. Pick one.
python_env: python_env.yaml

entry_points:
  # Named entry points let one repository expose several runnable jobs.
  train:
    parameters:
      learning_rate: {type: float, default: 0.05}
      max_depth: {type: int, default: 8}
      # A path parameter is downloaded locally first if it is a remote URI,
      # so the training script only ever sees a local file.
      training_data: {type: path, default: data/train.parquet}
      experiment_tag: {type: string, default: manual}
    command: >
      python train.py
        --learning-rate {learning_rate}
        --max-depth {max_depth}
        --data {training_data}
        --tag {experiment_tag}

  evaluate:
    parameters:
      model_uri: {type: string}
      eval_data: {type: path}
    command: "python evaluate.py --model {model_uri} --data {eval_data}"

  # No parameters, no problem — a plain entry point is still worth declaring.
  build_features:
    command: "python features.py"`,
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    R["mlflow run &lt;target&gt; -e train -P lr=0.05"]

    R --> L{"Target is<br/>a git URI?"}
    L -->|"yes"| G["Clone at the requested<br/>version into a temp dir"]
    L -->|"no"| D["Use the local directory"]

    G --> E
    D --> E{"Which environment<br/>does MLproject declare?"}

    E -->|"python_env"| V["Build a virtualenv<br/>from python_env.yaml"]
    E -->|"conda_env"| C["Solve and create<br/>a conda environment"]
    E -->|"docker_env"| K["Run inside the image,<br/>repo mounted in"]

    V --> X["Substitute parameters,<br/>execute the command"]
    C --> X
    K --> X
    X --> RUN["A tracked run appears<br/>in the experiment"]
`.trim(),
      caption: 'One command resolves the code, the environment and the parameters, then produces an ordinary tracked run.',
    },
    {
      type: 'markdown',
      md: `
## The three environment declarations

This is the part that outlives Projects themselves, because the same three mechanisms are used
when MLflow rebuilds an environment to *serve* a model.

**\`python_env.yaml\`** — a Python version plus pip build and dependency steps. Fast, no conda
required, and the modern default. This is what \`log_model\` writes.

**\`conda.yaml\`** — the older mechanism, still necessary when you depend on non-Python packages
that pip cannot install. Its cost is dependency solving, which on a large environment can take
longer than the training job.

**\`docker_env\`** — an image you built. The strongest reproducibility guarantee, because system
libraries and CUDA versions are pinned too, and the only option that handles a GPU stack
honestly. The project directory is mounted into the container at run time.
`.trim(),
    },
    {
      type: 'code',
      lang: 'yaml',
      filename: 'python_env.yaml',
      caption: 'Written for you by log_model, and readable enough to edit when inference gets it wrong.',
      code: `python: "3.11.9"

# Tools needed to construct the environment, before dependencies are installed.
build_dependencies:
  - pip==24.2
  - setuptools==75.1.0
  - wheel==0.44.0

# The actual dependency set. Pinned exactly, because "scikit-learn" without a
# version will resolve to something different in six months and load your pickle
# with a warning at best.
dependencies:
  - scikit-learn==1.5.2
  - pandas==2.2.2
  - numpy==1.26.4
  - joblib==1.4.2
  - mlflow==3.1.0`,
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'An unpinned dependency is a time bomb with a long fuse',
      md: `A model logged with \`scikit-learn\` and no version loads fine today. In eight months the
resolver picks a newer major version, unpickling emits an \`InconsistentVersionWarning\`, and the
model produces subtly different predictions — or loads and silently misbehaves. This failure is
delayed, silent, and extremely hard to attribute. **Always pin exact versions in anything you
intend to deploy.**`,
    },
    {
      type: 'markdown',
      md: `
## \`--env-manager\`, and the flag that will bite you

Every command that has to *use* an environment — \`mlflow run\`, \`mlflow models serve\`,
\`mlflow models predict\` — takes \`--env-manager\`.

| Value | Behaviour | When it is right |
|---|---|---|
| \`virtualenv\` | Builds a fresh venv from \`python_env.yaml\` | The default, and the correct answer nearly always |
| \`uv\` | Same, resolved and installed by uv | Recent MLflow versions; dramatically faster on large dependency sets |
| \`conda\` | Creates a conda environment from \`conda.yaml\` | You genuinely need non-Python packages |
| \`local\` | **Uses the current environment as-is** | Inside a container you already built to match |

\`--env-manager local\` is the flag people reach for when environment builds are slow, and it is
the one that removes the guarantee they came for. It runs the model against whatever happens to
be installed. Inside a purpose-built container that is exactly right. On a developer laptop it
means the environment file was never tested, and the first place it gets tested is production.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'Environment build time is a real cost, and it is paid at the wrong moment',
      md: `Building a virtualenv for a large ML stack takes minutes; a conda solve can take
considerably longer. \`mlflow models serve\` does this **on startup**, which means a scale-out
event or a pod restart incurs the full build before the first request is served. The fix is not
\`--env-manager local\` — it is to bake the environment into an image ahead of time with
\`mlflow models build-docker\`, then run that image with the local manager inside it.`,
    },
    {
      type: 'code',
      lang: 'bash',
      filename: 'running-projects.sh',
      code: `# Local directory, default entry point, overriding two parameters.
mlflow run . -P learning_rate=0.01 -P max_depth=12

# A specific entry point, and a named experiment for the resulting run.
mlflow run . -e evaluate --experiment-name churn-prediction \\
  -P model_uri=models:/churn-detector@champion \\
  -P eval_data=s3://acme-data/eval/2026-08.parquet

# Straight from git, pinned to a commit. Nobody clones anything by hand.
# -v takes a branch, tag or commit SHA.
mlflow run https://github.com/acme/churn.git -v 9f2c1ab -e train -P max_depth=6

# A project living in a subdirectory of a monorepo.
mlflow run https://github.com/acme/platform.git#models/churn -e train

# Reuse the current environment. Correct inside a purpose-built container,
# and a way to fool yourself anywhere else.
mlflow run . --env-manager local

# Run without creating a new run — attach to an existing one instead.
mlflow run . --run-id 8f3adc21b4e5470aa1c2d3e4f5061728`,
    },
    {
      type: 'markdown',
      md: `
## Are Projects worth adopting?

Honest answer: less often than the other three components. Most teams already have a way to run
training — a Makefile, an Airflow DAG, a Kubeflow pipeline, a CI workflow — and Projects overlap
with it. Adopting them alongside an existing orchestrator gives you two definitions of how to
run the job, which drift.

Projects earn their place in three specific situations:

- **Handing work between people or teams.** A git URI that anyone can run beats a README with
  eleven setup steps that has been wrong since March.
- **Research repositories** where the orchestration layer does not exist yet and the alternative
  is bare scripts.
- **Reproducing a historical run.** With the commit recorded as a tag on the run, \`mlflow run\`
  against that SHA rebuilds both the code and the environment as they were.

If you already have an orchestrator, keep it, and take the environment declaration ideas from
this chapter without the \`MLproject\` file. Those matter regardless — they are the same files
that decide whether your model can be served at all.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'MLflow Recipes is gone',
      md: `You may find tutorials referencing MLflow Recipes, a declarative pipeline framework
built on Projects. It was removed in MLflow 3. If you encounter a repository using it, treat it
as legacy: the underlying Tracking, Models and Registry APIs it sat on are all still current.`,
    },
    {
      type: 'checklist',
      title: 'Environment reproducibility review',
      items: [
        'Every dependency pinned to an exact version, in anything destined for deployment',
        'The Python version declared explicitly, not inherited from whoever ran the job',
        'python_env.yaml preferred over conda unless non-Python packages force the issue',
        'Docker used where GPU or system libraries are part of the contract',
        '--env-manager local reserved for containers built for that exact model',
        'The environment tested by building it fresh, not by trusting the file',
        'Long environment builds moved to image build time, never to server startup',
        'Entry point parameters typed, so bad input fails immediately',
      ],
    },
  ],

  flashcards: [
    { front: 'What does an MLproject file declare?', back: 'How to execute the code — named entry points with typed parameters and commands — and which environment to build: python_env, conda, or a docker image.' },
    { front: 'What is the risk of --env-manager local?', back: 'It runs against whatever is currently installed instead of building the declared environment, so the environment file goes untested until production. It is correct only inside a container built to match.' },
    { front: 'Why must deployment dependencies be pinned to exact versions?', back: 'An unpinned package resolves to a newer version months later, and unpickling under a different library version can produce warnings or subtly different predictions. The failure is delayed and hard to attribute.' },
    { front: 'When are MLflow Projects genuinely worth adopting?', back: 'Handing work between teams, research repositories with no orchestrator, and reproducing a historical run from its recorded commit. With an existing orchestrator they usually add a second, drifting definition.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Your model server takes four minutes to become ready after every pod restart, because it builds a virtualenv on startup. What is the right fix?',
      options: [
        'Switch the server to --env-manager local so it skips the build',
        'Bake the environment into an image with mlflow models build-docker and run that image',
        'Move the dependencies from python_env.yaml into conda.yaml',
        'Reduce the number of pinned dependencies so the resolver finishes faster',
      ],
      answerIndex: 1,
      explanation: 'The build itself is legitimate work; the problem is that it happens at the worst possible moment. Moving it to image build time pays the cost once, in CI. Using the local manager on a bare host merely skips the build and serves against an untested environment, and conda solving is slower, not faster.',
    },
    {
      id: 'q2',
      prompt: 'A model logged eight months ago with the dependency listed as scikit-learn, unpinned, now loads with a version warning and gives slightly different predictions. What category of failure is this?',
      options: [
        'A signature enforcement failure, fixed by declaring column types',
        'An artifact store misconfiguration, fixed by proxying artifacts',
        'A backend schema mismatch, fixed by running mlflow db upgrade',
        'A delayed, silent environment failure caused by an unpinned dependency resolving to a newer version',
      ],
      answerIndex: 3,
      explanation: 'Nothing changed in the model or MLflow. The resolver simply picked a different scikit-learn than the one that wrote the pickle, and unpickling across versions is not guaranteed to be faithful. The long delay between logging and failure is what makes this class of bug so hard to attribute.',
    },
    {
      id: 'q3',
      prompt: 'What does declaring an MLproject parameter with type: path give you?',
      options: [
        'The value is validated as an existing local file before the project runs',
        'A remote URI is downloaded locally first, so the training script only ever opens a local file',
        'The path is logged automatically as a dataset input on the run',
        'The file is copied into the artifact store when the run completes',
      ],
      answerIndex: 1,
      explanation: 'The path type handles fetching, so the same entry point works whether you pass a local file or an object-store URI and the script stays simple. It does not perform existence checks up front, log the dataset, or archive the file afterwards.',
    },
    {
      id: 'q4',
      prompt: 'Which situation most justifies docker_env over python_env for a project?',
      options: [
        'Training uses a GPU, so CUDA and system libraries are part of what must be reproduced',
        'The project has more than twenty pip dependencies',
        'Runs must be tracked against a remote server rather than local files',
        'The team wants faster environment creation than virtualenv provides',
      ],
      answerIndex: 0,
      explanation: 'A pip environment pins Python packages and nothing beneath them. A GPU stack depends on driver and CUDA versions that only an image can capture. Dependency count is not the deciding factor, tracking is orthogonal, and images are slower to build than a virtualenv, not faster.',
    },
    {
      id: 'q5',
      prompt: 'Your team already runs training through Airflow. What is the balanced view on adopting MLflow Projects as well?',
      options: [
        'Adopt them, since Projects are required for the model registry to record lineage',
        'Adopt them for the parameter typing alone, and trigger them from Airflow',
        'Usually skip the MLproject file, since it duplicates the orchestrator, but take the environment declaration practices, which matter regardless',
        'Avoid MLflow entirely when an orchestrator is present, since the two conflict',
      ],
      answerIndex: 2,
      explanation: 'Two definitions of how to run a job drift apart, and the orchestrator is already the one on call. The environment files are a separate matter: the same declarations decide whether a logged model can be rebuilt and served, so they are worth getting right whether or not you use Projects. Registry lineage comes from tracking, not Projects.',
    },
  ],
};
