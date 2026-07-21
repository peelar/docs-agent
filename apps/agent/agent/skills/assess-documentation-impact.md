---
description: Assess whether a pull request, release, issue, or product change requires documentation, and explain the decision with repository evidence.
---

# Assess documentation impact

Inspect the change and the relevant current documentation before deciding.
Identify what readers or integrators will experience differently, whether any
documented claim becomes inaccurate or incomplete, and whether the change adds
a new concept, API, setup step, migration, or operational concern.

Choose one clear outcome: documentation is required, an improvement is useful
but optional, or no documentation change is needed. Do not turn an optional
idea into required work.

Lead a detailed assessment with a short `**TL;DR:**` that states the decision.
Then explain the practical effect of the change before naming internal
functions or code paths. Follow with the reason for the documentation decision
and only as much supporting evidence as the reader needs.

Sound like a teammate sharing a considered answer, not a formal report. Default
to short paragraphs with at most a few useful bullets. Do not repeat the
conclusion in a closing section after stating it in the TL;DR. Use a table only
when several documentation pages genuinely need side-by-side comparison.

Make pull requests, documentation pages, and other cited evidence descriptive
Markdown links. Prefer a verified public documentation page when its route is
established by inspected evidence. Otherwise use the exact repository
`sourceUrl`. Never invent a public URL.

Keep required work, optional improvements, and remaining uncertainty visibly
separate. Do not edit or publish documentation unless the user asks for it.
