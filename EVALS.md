# Paige evals

Paige makes decisions about documentation using source repositories and product
evidence. A fluent answer is not enough: Paige must inspect the right evidence,
respect repository authority, admit uncertainty, and require approval before
publishing documentation.

Our evals call a real model through the same Eve agent surface used by the
product. They are grouped by the kind of claim they can support:

- **Behavior** checks whether Paige reaches the right documentation decision,
  uses the expected tools, and communicates the result clearly.
- **Safety** checks read-only evidence boundaries, approval requirements,
  protection against instructions hidden in evidence, and honest failures.
- **Live integration** checks real GitHub access separately. Credential,
  permission, and rate-limit failures are reported as environment limitations,
  not silently counted as model-quality failures.

Model qualification uses repeated runs of a locked behavior and safety suite.
Safety is a release gate: a cheaper or more capable model is not qualified if
it crosses an authority boundary in any accepted run.

<!-- benchmark-results:start -->
## Current model qualification

_Updated 21 July 2026 from 3 repeated runs per model._

| Model | Behavior | Safety | Clean full runs | Average model cost | Average duration | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| GLM 5.2 | 28/30 cases; 220/222 gates | 18/18 cases; 133/133 gates | 1/3 | $0.128 | 3m 22s | Safety passed; behavior varied |
| DeepSeek V4 Pro | 21/30 cases; 209/222 gates | 10/18 cases; 124/136 gates | 0/3 | $0.017 | 3m 24s | Not qualified |

A full run contains the behavior and safety suites. Safety must pass on every run before a model can be qualified. Cost is the amount reported by the model gateway and may change as provider pricing changes.
<!-- benchmark-results:end -->

## Reading the results

The table is a Paige qualification result, not a general-purpose model
leaderboard. It says how these models behaved with Paige's tools, instructions,
fixtures, and product contracts on the stated date.

The current comparison shows why cost cannot be the only routing criterion.
DeepSeek V4 Pro cost substantially less, but failed safety cases in every run.
GLM 5.2 kept the safety boundary in all three runs, while two behavior failures
show that its output still has meaningful variance.

Raw Eve artifacts can contain prompts, model output, and repository evidence,
so they are kept local by default rather than published without review.

## Updating the benchmark

Run the benchmark from a clean checkout with the required model credentials:

```bash
pnpm eval:benchmark
```

The command runs the models and repetition count declared in
[`apps/agent/evals/benchmark.config.ts`](./apps/agent/evals/benchmark.config.ts)
against the same behavior and safety suites. Add another `label` and `modelId`
there to include a new model. The command validates the model identity and
generated Eve artifacts, then updates only the generated results section above.
Product failures are printed in the table. An incomplete run, skipped eval,
execution error, or unexpected model leaves the existing public result
unchanged.

For ordinary development, use the smaller suite commands instead:

```bash
pnpm eval:behavior
pnpm eval:safety
pnpm eval:integration
```
