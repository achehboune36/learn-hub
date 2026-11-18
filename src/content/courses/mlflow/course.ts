import type { Course } from '../../types';
import { meta } from './meta';

import { chapter as whyTracking } from './chapters/01-why-tracking';
import { chapter as trackingRuns } from './chapters/02-tracking-runs';
import { chapter as trackingServer } from './chapters/03-tracking-server';
import { chapter as autologging } from './chapters/04-autologging';
import { chapter as modelsFlavors } from './chapters/05-models-flavors';
import { chapter as projectsEnvironments } from './chapters/06-projects-environments';
import { chapter as modelRegistry } from './chapters/07-model-registry';
import { chapter as evaluation } from './chapters/08-evaluation';
import { chapter as servingDeployment } from './chapters/09-serving-deployment';
import { chapter as production } from './chapters/10-production';

export const course: Course = {
  ...meta,

  intro: `
A trained model is a function of code, data, hyperparameters, environment and randomness. Git
version-controls exactly one of those. Everything MLflow does follows from closing that gap.

This course works through one thread: a churn model, from the first tracked run to a production
endpoint that someone else can roll back at 2am. Each chapter takes one part of MLflow, explains
the mechanism rather than the API surface, and spends most of its time on how that part fails in
practice — the artifact URI that points at a laptop, the autologged metric measured on training
data, the integer column that becomes a float the first time production sends a null.

The examples are Python and provider-neutral. MLflow's design is a narrow waist: every framework
converges on one packaging contract, and every deployment target consumes only that contract.
Once you can see that shape, the rest of the tool stops being a list of functions and starts
being predictable.
`.trim(),

  outcomes: [
    'Instrument a training job so that a metric, months later, leads back to the code, data and environment that produced it',
    'Choose correctly between parameters, metrics, tags and artifacts, and know why the distinction is enforced',
    'Configure a shared tracking server, and diagnose the artifact-store misconfigurations that break every new deployment',
    'Use autologging for what it covers while logging the validation and business metrics it structurally cannot see',
    'Package a model with a signature and pinned environment that loads in a container it has never run in',
    'Run a registry where deployment role and approval state are separate facts, with rollback as a single call',
    'Gate promotion on a re-evaluated baseline with a threshold set above measured evaluation noise',
    'Serve or batch-score a model, and recognise the latency traps that only appear under production traffic shapes',
  ],

  glossary: [
    { term: 'run', definition: 'One execution of training code, together with the parameters, metrics, tags and artifacts that describe it. The central unit of MLflow Tracking.', aliases: ['runs'] },
    { term: 'experiment', definition: 'A long-lived container grouping runs that address the same problem, so they can be ranked against each other. Scoped to a problem, never to a person or a date.', aliases: ['experiments'] },
    { term: 'parameter', definition: 'An input you chose, stored as a string and immutable within a run. Re-logging one with a different value is an error, because it would rewrite what the run was.', aliases: ['params', 'parameters'] },
    { term: 'metric', definition: 'A number the run produced, stored as a float with an optional step so it forms a time series. The step is what turns a final value into a training curve.', aliases: ['metrics'] },
    { term: 'artifact', definition: 'A file produced by a run — the model, plots, tables, a sample of the data. Artifacts live in blob storage rather than the database.', aliases: ['artifacts'] },
    { term: 'backend store', definition: 'The database holding experiments, runs, parameters, metrics and tags. A SQL backend is required for the model registry; the default file store cannot host one.' },
    { term: 'artifact store', definition: 'The blob storage holding files logged by runs. Written directly by the client unless the tracking server is started with proxied artifact access.' },
    { term: 'proxied artifact access', definition: 'Routing artifact bytes through the tracking server via --serve-artifacts, so only the server holds cloud credentials and clients need nothing but the tracking URL.' },
    { term: 'autologging', definition: 'Instrumenting a framework by patching its fit method, capturing parameters, metrics and the model automatically. It sees only that one call, so validation and business metrics remain your responsibility.', aliases: ['autolog'] },
    { term: 'flavor', definition: 'One way of interpreting a saved model. A native flavor restores the original framework object; the python_function flavor exposes a uniform predict interface.', aliases: ['flavors'] },
    { term: 'pyfunc', definition: 'The python_function flavor: the universal contract promising that the model accepts a DataFrame, array, dict or list and returns predictions. Every deployment target is written against it alone.', aliases: ['python_function'] },
    { term: 'MLmodel', definition: 'The manifest file at the root of a model directory, declaring its flavors, the environment, the signature and the input example.' },
    { term: 'signature', definition: 'The declared input and output schema of a model. Enforced at predict time: missing required columns error, extra columns are dropped, and lossy type conversions are rejected.', aliases: ['model signature'] },
    { term: 'input example', definition: 'A few real rows stored with the model. Documents what the model expects and is used to validate the packaged environment on load.' },
    { term: 'PythonModel', definition: 'The base class for a custom pyfunc, wrapping an estimator together with tokenisers, lookup tables and business rules so the serving layer sees a single model.' },
    { term: 'load_context', definition: 'The PythonModel hook that runs once when a model is loaded. Expensive setup belongs here; doing it in predict charges every request for it.' },
    { term: 'Model Registry', definition: 'A named catalogue of model versions layered over tracking. It stores references and metadata rather than new artifacts, which is why versions are cheap.', aliases: ['registry'] },
    { term: 'model version', definition: 'An immutable, auto-incrementing entry under a registered model name, pointing at a model logged in a specific run. Never edited, only superseded.' },
    { term: 'alias', definition: 'A movable named pointer to one model version, such as champion or challenger. Deployments reference the alias, so promotion is a registry operation rather than a code change.', aliases: ['aliases'] },
    { term: 'stage', definition: 'The deprecated fixed enum of None, Staging, Production and Archived, removed in MLflow 3. It could not express shadow or canary roles and conflated being deployed with being approved.', aliases: ['stages'] },
    { term: 'MLproject', definition: 'A file declaring named entry points with typed parameters and the environment to build, making a repository runnable with a single mlflow run command.' },
    { term: 'env manager', definition: 'How MLflow rebuilds an environment: virtualenv, uv, conda, or local. Local trusts whatever is currently installed, which is correct only inside a container built to match.', aliases: ['--env-manager'] },
    { term: 'LoggedModel', definition: 'The MLflow 3 entity that makes a model first-class rather than an artifact of a run, so evaluations performed later can attach metrics to the model itself.' },
    { term: 'MetricThreshold', definition: 'A promotion gate condition. Its min_absolute_change field is the noise filter, and it must be set above measured run-to-run evaluation variance to mean anything.' },
    { term: 'trace', definition: 'A tree of spans recording one invocation of an LLM application, with prompts, responses, token counts and latency. Autologging for inference rather than training.', aliases: ['tracing', 'traces'] },
    { term: 'scorer', definition: 'A function that grades one output in a generative evaluation. Deterministic where the requirement can be stated exactly, and an LLM judge only where semantic understanding is genuinely needed.', aliases: ['scorers'] },
    { term: 'mlflow gc', definition: 'The command that permanently reclaims storage for deleted runs. Deleting a run in the UI only marks it; the artifacts remain billable until gc removes them.' },
  ],

  chapters: [
    whyTracking,
    trackingRuns,
    trackingServer,
    autologging,
    modelsFlavors,
    projectsEnvironments,
    modelRegistry,
    evaluation,
    servingDeployment,
    production,
  ],
};
