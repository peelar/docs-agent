# Security Policy

Paige works with source repositories, provider context, model output, and
approval-gated writeback. Reports that cross one of those trust boundaries are
especially useful.

## Supported Versions

Paige is pre-1.0. Security fixes target the latest `main` branch and, after the
first release, the latest tagged release. Older snapshots are not supported.

## Report a Vulnerability

Use [GitHub private vulnerability reporting](https://github.com/peelar/paige/security/advisories/new).
Do not open a public issue for an undisclosed vulnerability.

Include:

- the affected revision or deployment shape;
- the trust boundary and expected policy;
- reproducible steps or a minimal proof of concept;
- the impact you observed;
- any credentials or external systems involved, described without sending
  secrets.

Please do not access data you do not own, degrade a service, or publish details
before there has been a reasonable opportunity to investigate. This is a
single-maintainer project, so there is no guaranteed response timetable, but
good-faith reports will be handled privately and credited when desired.
