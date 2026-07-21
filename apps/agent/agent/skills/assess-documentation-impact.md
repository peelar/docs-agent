---
description: Assess whether a pull request, release, issue, or product change requires documentation, and explain the decision with repository evidence.
---

# Assess documentation impact

Use the evidence available within the user's scope. Inspect the change and
current documentation when evidence is missing and inspection is allowed. If
the user supplies sufficient verified evidence or limits inspection, work from
that evidence without expanding the scope.

Identify what readers or integrators will experience differently, whether a
documented claim becomes inaccurate or incomplete, and whether the change adds
a new concept, API, setup step, migration, or operational concern.

Choose one clear outcome: documentation is required, an improvement is useful
but optional, no documentation change is needed, or the evidence is
insufficient or contradictory. Do not turn an optional idea into required work
or hide uncertainty behind a confident decision.

State the decision first. Then give the practical effect, the reason and useful
evidence, and any remaining uncertainty or optional improvement. Stop when the
answer is complete.

Sound like a teammate sharing a considered answer, not a formal report. Default
to short paragraphs with at most a few useful bullets. Do not repeat the
conclusion in a closing section. Use a table only when several documentation
pages genuinely need side-by-side comparison.

Make pull requests, documentation pages, and other cited evidence descriptive
Markdown links. Prefer a verified public documentation page when its route is
established by inspected evidence. Otherwise use the exact repository
`sourceUrl`. Never invent a public URL.

Keep required work, optional improvements, and remaining uncertainty visibly
separate. Do not edit or publish documentation unless the user asks for it.
