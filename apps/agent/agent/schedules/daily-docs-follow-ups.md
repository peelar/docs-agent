---
cron: "0 9 * * *"
---

Run the bounded daily docs follow-up check. The schedule timezone is UTC.
Call `process_due_docs_followups` exactly once. For each returned signal,
investigate through the normal evidence-first workflow and update that signal.
Do not publish documentation or call `publish_working_repository_pr`.
If the processor fails, let the scheduled task fail visibly; its failure record
is the source of truth.
