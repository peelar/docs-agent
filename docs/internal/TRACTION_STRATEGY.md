# Open-Source Traction Strategy

## Goal

Paige is not supposed to become a business. It is supposed to become a public
body of evidence that makes good engineers and engineering managers want to
talk to Adrian.

That changes the growth strategy. The target is not maximum reach, a sales
funnel, or a large Discord full of people waiting for support. The target is
credible proof of four things:

- I can build and operate a non-trivial agent, not just wrap a model API.
- I have product judgment about where an agent should act and where it should
  stop.
- I can explain difficult engineering choices clearly in public.
- I can maintain useful software with other people in the room.

Stars are useful discovery feedback, but they are not the goal. Three
maintainers who run Paige on their own repositories, one respected engineer who
references its architecture, and one accepted Paige-assisted documentation fix
are stronger career evidence than a thousand drive-by stars.

## Current Position

The honest starting point, as of 2026-07-14:

| Surface | Current state | Consequence |
| --- | --- | --- |
| GitHub repository | Public at `peelar/paige`, with zero stars, zero forks, no releases, and one contributor | Paige has not launched yet. This is a baseline, not a failure. |
| Open-source status | Apache License 2.0 selected; `LICENSE` is ready locally but not published | Paige becomes genuinely open source under a standard permissive license when this change lands. |
| Community profile | GitHub reports 28%; the contribution guide, code of conduct, support policy, security policy, issue forms, and pull request template are ready locally but not published | The contributor path is prepared, but visitors cannot use it until the files land on the default branch. |
| Discovery metadata | The description and eight focused topics are live on GitHub | Paige is classifiable in repository search and visibly connected to Eve, Vercel, docs-as-code, agents, and developer tooling. |
| Homepage | The misleading generic Eve status-page URL has been removed | The repository is the honest canonical destination until there is a useful public page. |
| Demo | There is no public demo yet; a static eval transcript was considered and rejected | The launch needs a real recorded run or a genuinely executable path, not text pretending to be a demo. |
| Visual proof | The README deliberately uses the Paige mascot only; screenshots are deferred and the legacy operator image is not promoted | This launch avoids stale UI proof without manufacturing replacement visuals. |
| Product state | The useful direct signal, evidence, repository, authoring, and approval paths exist; the capability migration and proactive watch executor remain open | We can discuss the engineering now, but we must not advertise proactive attention as complete. |
| Personal GitHub profile | Paige is not pinned | Even someone already interested in Adrian will probably not find it. |

The first growth task is therefore not posting. It is making the public claim
match the legal, product, and adoption reality.

### Repository-readiness status

Completed live on GitHub:

- the local remote points to `peelar/paige`;
- the repository description and topics are set;
- the misleading homepage URL is removed;
- private vulnerability reporting is enabled.

Ready locally but not public until the repository changes are committed:

- Apache-2.0 license and README link;
- contribution, support, security, conduct, issue, and pull-request guidance;
- an honest public-alpha claim;
- concise `v0.1.0` release notes.

Verified product proof:

- the no-change Eve eval passed 21/21 required gates against the configured
  working documentation repository on 2026-07-14;
- the focused-patch eval remains unclaimed: two supervised attempts were
  blocked by Microsandbox/dev-server startup, so it is not launch evidence yet.

Still requires a deliberate external action or a later artifact:

- commit and publish the prepared repository files;
- tag and publish `v0.1.0` after those files reach the default branch;
- pin Paige on Adrian's GitHub profile;
- record the short Eve/Vercel video and publish the canonical case study;
- rerun and capture the focused-patch proof in a healthy eval environment.

## Positioning

The current category, “AI documentation agent,” is crowded and easy to dismiss.
Most projects in it promise to generate more text from a codebase. That is not
Paige's interesting idea.

The sharper claim is:

> Paige is an open-source documentation agent that decides whether a product
> change needs documentation, shows its evidence, and prepares the smallest
> accurate intervention for review.

The memorable version is:

> The most useful documentation agent sometimes does nothing.

That claim is native to the repository. Paige already treats the documentation
impact report as the primary output, distinguishes source evidence from Slack
or Linear discussion, prefers no change over a weak patch, works in an isolated
repository, and keeps publication behind explicit approval.

This also creates a better hiring story than “I built an AI writer.” It makes
the work about provenance, agent authority, sandboxing, durable execution,
evaluation, editorial judgment, and human review.

Until issues [#60](https://github.com/peelar/paige/issues/60),
[#61](https://github.com/peelar/paige/issues/61), and
[#62](https://github.com/peelar/paige/issues/62) are complete, public copy
should not imply that Paige continuously watches work by itself. The current
truth is that a teammate can bring Paige into a Slack or Linear discussion, or
ask it to investigate configured repository evidence. Proactive attention can
be a later release story.

## Primary Bet: Become Eve's Showcase App

The highest-leverage distribution opportunity is not the documentation
community or Hacker News. It is Vercel.

The original instinct was to earn credibility first and distribute the proof
afterward. That is usually sensible. It misses what happens when a new platform
needs examples: distribution can help create the credibility. If Paige becomes
one of the first serious external Eve applications, the association itself is
career evidence.

Vercel introduced Eve on 2026-06-17. The framework is in public preview, its
repository already has roughly 3,500 stars, and the launch argument is that Eve
comes with production already built in. Vercel now needs external applications
that make that claim believable. Paige is unusually well shaped for this
moment: it is not another five-file weather agent, and it exercises most of the
Agent Stack in one coherent product.

| Vercel claim | Paige proof |
| --- | --- |
| Durable execution | Documentation work stays attached to one signal and Eve session across long work, questions, corrections, and approvals. |
| Sandboxed compute | Paige materializes repositories, inspects them, and prepares checked diffs outside the application runtime. |
| Human-in-the-loop | Repository publication remains a separate, approval-gated action. |
| Secure connections | GitHub, Slack, and Linear authority flows through Vercel Connect and scoped server-side contracts. |
| Multi-channel agents | The same product receives work from Slack and Linear and exposes an operator control plane. |
| Evals and observability | Paige has behavioral evals, deterministic gates, persisted assurance results, and the planned Paige Bench model qualification. |
| Production application shape | The repository contains the Eve agent, a Next.js operator app, durable product state, authentication, deployment, and a full validation graph. |

Keep the audiences separate:

- Documentation maintainers are the product audience. Paige has to solve a
  real problem for them.
- The Eve and Vercel team is the first audience for the launch story. They can
  recognize the architecture before setup is polished for everyone else.
- Other agent builders are the technical audience. They should learn what Eve
  handles and which production problems remain application work.
- Engineering leaders and hiring managers are the career audience. They should
  see judgment, system design, operation, and communication rather than a pile
  of social metrics.

So, for this launch, the framework team is the first customer for the story.
Documentation maintainers remain the customers for the product.

This gives Vercel something commercially useful without turning Paige into a
business. They can point to it when someone asks, “Has anybody built a serious
external application on Eve yet?” In return, Paige can borrow Vercel's audience
and Adrian becomes associated with an emerging framework while its map is still
being drawn.

The timing changes the launch advice. Do not wait months for every open issue
before showing Paige to the Eve team. The attention window around a new
framework decays quickly. Prepare a narrow, honest showcase of the stable
direct-invocation path now; do not claim that proactive watches are complete.
The broader open-source launch can still wait for the full launch gate.

### The Vercel-Ready Packet

Do not ask Vercel to “check out my repo.” Hand them something they can repost
without doing editorial work:

- a 30–45 second native video showing Slack or Linear intake, repository
  evidence, the impact decision, a minimal draft, and the approval boundary;
- a second short clip where Paige correctly concludes that no change is needed;
- one architecture image mapping Paige to Eve, Workflow, Sandbox, Connect,
  Chat SDK, AI Gateway, and the Next.js control plane;
- a two-sentence description and one memorable claim;
- a clean repository URL, an OSI-approved license, recognizable mascot, and a
  real product recording or live demo;
- one concrete result from the dogfood repository;
- a short “what Eve handled versus what Paige had to design” breakdown.

The repostability test is blunt: could Guillermo understand why Paige matters
and repost it in thirty seconds without rewriting the story? If not, the packet
is not finished. This is not about simplifying the product. It is about doing
the editorial work for the person with the megaphone.

The first clip needs visible action. The no-change thesis is intellectually
interesting, but a person scrolling X first needs to see the agent do real
work. Use the second clip or thread reply to show restraint.

Suggested lead:

> Vercel launched Eve three weeks ago. I wanted to see what “production already
> built in” looks like after the starter example, so I built Paige: a
> documentation agent that works across Slack, Linear, GitHub, and an approval-
> gated repository sandbox.

The repository link and architecture image can live in the first reply so the
lead post stays visual and legible. This is not algorithm superstition; it is
simply a better artifact for a busy person to repost.

### The Megaphone Ladder

Work inward through the ecosystem instead of starting with a blind mention of
the CEO:

1. Publish the clean repository, video, architecture image, and case study.
2. Post Paige to the
   [Eve “Show and tell” discussion](https://github.com/vercel/eve/discussions/categories/show-and-tell).
   The Eve README explicitly routes builders there, and the category is almost
   empty today.
3. Post a more visual version to the
   [Vercel Community Showcase](https://community.vercel.com/c/showcase/41).
   Vercel Weekly already selects community projects from this surface.
4. Add Paige to the emerging
   [EveAgents directory](https://github.com/vercel/eve/discussions/701) once the
   repository is licensed and the demo works.
5. Publish the native X post. Tag `@vercel` and at most one person whose work is
   directly demonstrated. Do not tag the whole launch team.
6. Reply to or quote
   [Vercel's Eve launch post](https://x.com/vercel/status/2067180054979936413)
   with the concise “you asked what people would build; here is mine” version.
7. Send the finished packet to the Eve builders and DevRel authors who can
   judge it: Shar Dara (`@shardara`), Kevin Corbett (`@Kev_InDev`), Andrew Barba
   (`@andrew_barba`), Allen Zhou (`@allenzhou101`), John Phamous
   (`@johnphamous`), and Ben Sabic (`@bensabic`). Contact one or two relevant
   people, not everybody.
8. Make the specific ask: “Would Paige be useful as an advanced Eve showcase,
   live demo, or production case study?” Do not ask them to “boost” it.
9. Mention `@rauchg` when the artifact is already public, legible, and showing
   some response. His amplification should be the result of making Vercel look
   good, not the first step of the plan.

Guillermo is a legitimate target. The sequencing still matters. The repository
metadata and homepage are now clean; mentioning him before the license and a
stable recorded path are public would still waste the best shot. Put the
complete artifact in his path after the Eve community has had a chance to react
to it.

Vercel has already published a simple
[Sanity documentation-fix agent](https://vercel.com/kb/guide/sanity-eve-agent).
That is an opening, not a reason to avoid the category. Paige is the natural
advanced counterpart: Git-based documentation, several evidence sources,
durable ownership, a real operator surface, explicit repository authority, and
approval-gated PRs. Pitch it as “what the docs-agent pattern becomes in a
production-shaped repository,” not as a competitor to their example.

The Vercel Community also invites members with something to demo to participate
in live sessions. A 15-minute “Eve after hello world” walkthrough is a better
ask than a retweet because it gives Vercel content and gives Adrian a durable
recording. The Vercel template marketplace would normally be another route, but
community template submissions are currently closed; do not spend time trying
to force Paige through that door.

Run this as a seven-day ecosystem sprint rather than an indefinite launch
project:

1. Publish the Apache 2.0 license and prepared repository-readiness files; keep
   the mascot as the only promoted static visual.
2. Record one stable end-to-end path and one correct no-change decision.
3. Draw the Eve architecture image and write the two-sentence pitch.
4. Publish the Eve Show and tell post and answer every substantive response.
5. Publish the Vercel Community Showcase version.
6. Publish the native X clip, then send the complete packet to one or two Eve
   builders with the concrete showcase or demo ask.
7. Turn any response into a better demo, an upstream issue, or an Eve
   contribution, and make the improvement visible.

Do not measure this sprint only by whether `@rauchg` reposts it. A reply from an
Eve maintainer, inclusion in Vercel Weekly, a live-session invitation, an
upstream contribution, or a Vercel-authored case study would all be valuable
outcomes. The point is to enter the ecosystem's active narrative while it is
still forming.

The career payoff is association, not traffic. The desired memory is:

> Adrian built one of the first serious applications on Eve and helped expose
> what production agents actually require.

A response from an Eve maintainer, an upstream contribution, inclusion in
Vercel Weekly, a technical case study, or a live demonstration may be worth
more than thousands of generic visitors. If Vercel ignores the first attempt,
the packet is still useful for the repository, personal site, talks, and the
broader launch. The bet has asymmetric upside without requiring Paige to become
a business.

This is the developer-hustler move the original strategy missed: find the
well-funded platform that urgently needs your project as evidence, package the
story around its current narrative, and make amplifying you the easiest useful
thing its team can do that day.

## The Developer-Hacker Playbook

“Developer hacker” growth is useful when the product itself produces the
distribution artifact. It becomes embarrassing when it is just normal spam
with a terminal screenshot attached.

| Strategy | Fit for Paige | Career signal | Verdict |
| --- | --- | --- | --- |
| Make Paige the first obvious production-grade external Eve showcase and package it for Vercel amplification | Exceptional, time-sensitive | Associates Adrian with a new framework, validates production agent expertise, and can unlock Vercel's audience | Primary bet now |
| Use Paige on real open-source documentation problems and publish the report, accepted patch, or justified no-change decision | Very high | Product judgment, technical depth, and real-world usefulness | Core loop |
| Publish Paige Bench results for Paige's own task distribution | Very high | Evaluation discipline, cost awareness, model skepticism, and reproducibility | Core launch artifact after #89 |
| Write technical essays backed by code, ADRs, evals, and failures | Very high | Clear thinking and senior engineering communication | Do continuously |
| Contribute relevant fixes or examples upstream to Eve and adjacent ecosystems | High | Open-source citizenship and ability to work across codebases | Do when the contribution is real |
| Record a two-minute real end-to-end demo | High | Shipping quality and technical communication | Required before a broad launch |
| Ask a small docs community for critique before asking a large developer community for attention | High | User research and responsiveness | Do before Show HN |
| Launch on Hacker News | Medium to high | Can create high-signal technical discussion | One launch spike, only after people can try it |
| Submit to developer-tool newsletters and curated lists | Medium | Useful third-party discovery if the project already has proof | Do after the first release |
| Post in generic AI, side-project, and open-source feeds | Low to medium | Mostly reach, little durable credibility | Use selectively with a community-specific angle |
| Launch on Product Hunt | Low | Optimizes for startup launch theater, not this goal | Skip unless the project becomes a polished standalone product |
| Create Discord, Slack, or a newsletter for Paige | Low right now | An empty community is negative proof and creates support work | Keep support on GitHub until users ask for more |
| Manufacture `good first issue` work, mass-open generated PRs, trade stars, ask friends to vote, cold-DM maintainers, or automate cross-posting | Negative | Damages trust | Never do |

The key loop is small:

```text
real docs problem
      ↓
Paige report, abstention, or reviewed patch
      ↓
public evidence and a technical lesson
      ↓
targeted discussion with the people who own that problem
      ↓
feedback becomes an issue, eval, or product correction
      ↓
a better Paige and a stronger next artifact
```

This compounds. A launch post expires. An accepted patch, benchmark artifact,
or well-argued architecture article continues to be useful in a portfolio,
search result, conference proposal, and hiring conversation.

## Launch Gate

There are two launch gates.

The narrow Eve/Vercel showcase should happen as soon as Paige has an
OSI-approved license, accurate repository metadata, a current video, one stable
demonstrable path, and an honest public-alpha disclaimer. It does not need
credential-free general onboarding, complete community health files, or the
watch executor. The artifact is for framework builders who can understand an
advanced application and tolerate setup friction.

Do not make the broader open-source launch or Show HN post until all of the
following are true:

- Publish the chosen Apache-2.0 license and make it visible from the README.
- Point every public surface at the canonical `peelar/paige` repository. Update
  the local remote, GitHub description, topics, and homepage.
- Either make the homepage useful or remove it. The authenticated operator app
  is not a public landing page, and weakening its access boundary for marketing
  would be the wrong trade.
- Add an actual try path only if it can execute Paige against a safe fixture.
  Do not present a static transcript as a demo. Until a real try path exists,
  use a short recording of a real run.
- Put the result before setup in the README: a short recording, one real impact
  report, one small diff, and one no-change example.
- Add `CONTRIBUTING.md`, `SECURITY.md`, a code of conduct, and focused issue
  forms. Explain the actual acceptance boundary instead of saying all PRs are
  welcome.
- Cut a named `v0.1.0` release with a concise scope and known limitations.
- Do not promote stale screenshots or old product names. The mascot-only README
  is the chosen boundary until a current product recording exists.
- Make the public claim match the runtime. If the launch happens before the
  watch executor is complete, lead with docs-impact judgment and direct team
  invocation, not continuous monitoring.
- Pin Paige on Adrian's GitHub profile and publish one canonical case study on
  `peelar.dev`.

This does not require every roadmap issue, broad documentation-platform
support, a fancy marketing site, a contributor community, or a fully hosted
multi-tenant service. It requires one complete and honest experience.

The capability migration tracked by
[#78](https://github.com/peelar/paige/issues/78) is a sensible boundary for the
first public alpha: finish #88, remove compatibility surfaces, then record the
demo against the architecture we intend to keep. Paige Bench
[#89](https://github.com/peelar/paige/issues/89) can power a second and stronger
technical launch. It should remain a Paige-specific model qualification report,
not drift into a generic model leaderboard.

## Proof Program

### 1. Three Real Cases

Start with three small, inspectable cases rather than asking the internet to
install a complex workspace agent cold.

1. A change that genuinely requires a small documentation patch.
2. A plausible false alarm where Paige correctly decides that no docs change is
   needed.
3. A change where Slack or issue context is insufficient and Paige asks for
   source evidence instead of inventing certainty.

The Saleor docs dogfood repository is a good first case, not the whole program.
At least one later case should come from an unrelated Docusaurus or Markdown
project with a different information architecture.

Each case should publish the same proof packet:

- the initiating issue, release, diff, or discussion with sensitive context
  removed;
- Paige's documentation impact report;
- pages considered and evidence used;
- the proposed diff or explicit reason for no change;
- checks run;
- the maintainer's response and final outcome;
- what failed and which issue or eval was added as a result.

For an external project, disclose that Paige assisted the work. Comment with
the impact report or ask whether a patch would be useful before opening a broad
generated PR. One accepted precise fix is good. Ten unsolicited rewrites are a
reputation bug.

### 2. Paige Bench

Issue #89 is unusually good credibility material because it makes a claim most
agent projects avoid: model choice should be earned on the product's task
distribution.

Publish the dated result as a repository artifact and a technical article:

- deterministic completion and safety gates before aesthetic scoring;
- repeated runs and variance rather than one lucky sample;
- model and judge identities recorded separately;
- cost per successful task, not token price alone;
- disqualifications, ties, and insufficient evidence left visible;
- no claim that the result generalizes beyond Paige.

The interesting headline is not “model X won.” It is “how I chose a production
model for an agent without letting an LLM judge overrule safety.”

### 3. A Small Technical Series

Use the repository's real hard parts as the content backlog:

- **The most useful documentation agent sometimes does nothing** — impact
  judgment, abstention, and why more prose is not the success metric.
- **Slack is context, not truth** — provenance, source verification, and prompt
  injection boundaries.
- **I gave an agent capabilities, not authority** — dynamic capability
  resolution, sandboxed repositories, and separately approved publishing.
- **Choosing a model by cost per successful task** — Paige Bench after the
  first complete run.
- **What changed after three maintainers tried Paige** — failures, rejected
  assumptions, and the resulting evals.

Each article needs one code link, one concrete artifact, and one uncomfortable
tradeoff. Do not publish generic “five lessons from building an AI agent” filler.

### 4. Upstream Work

Paige is built on Eve and depends on GitHub, Slack, Linear, Vercel, and common
docs-as-code conventions. When Paige exposes a real integration gap, fix or
document it upstream where appropriate. Then reference the upstream issue or PR
from the Paige case study.

That is legitimate borrowed distribution: the other community gets a useful
contribution, and people discover Paige through work that already helped them.
Do not add Paige to unrelated awesome lists before it has a release, a license,
and a working demo.

## Where To Share

The unit of distribution is the proof artifact, not “Paige is live.” Different
communities should receive the part that is useful to them.

| Channel | What to share | Why it fits | Timing |
| --- | --- | --- | --- |
| GitHub repository and Adrian's pinned profile | Current demo, quickstart, release, proof cases, architecture links | This is the source of truth every other channel will inspect | First |
| `peelar.dev` | Canonical case study and the deeper technical essays | Owns the career narrative and remains useful after a social post disappears | First |
| Eve GitHub “Show and tell” | The Vercel-ready packet, architecture map, and honest alpha limits | It is the official builder surface, is still sparsely populated, and reaches the people most motivated to validate Eve | First ecosystem post |
| Vercel Community Showcase | A visual demo with a concise “Eve after hello world” story | Vercel Weekly already lifts community projects from this surface | Immediately after Eve feedback |
| X | Native clip, one sharp claim, and a reply to the official Eve launch post | This is where Vercel's amplification network is unusually valuable; the artifact must be effortless to understand and repost | During the ecosystem sprint |
| Direct Eve builder or Vercel DevRel outreach | The finished packet plus a specific request for a showcase, technical review, live demo, or case study | A precise editorial opportunity is easier to act on than a generic request for attention | After the posts are live |
| Vercel live community session | A 15-minute “production Eve app after the starter” walkthrough | Creates reusable proof of technical communication and gives Vercel useful programming | Pitch after visible ecosystem response |
| EveAgents directory | Licensed repository, short description, and working demo | Early directory placement can make Paige a reference point for later Eve builders | Once the narrow showcase gate passes |
| Write the Docs Slack `#community-showcase` | A short demo and a specific request for critique of the impact report | The audience owns documentation quality; its rules explicitly allow relevant self-promotion with context | Before the broad launch |
| Write the Docs Slack `#community-help-wanted` | One genuine, bounded unpaid contribution opportunity | Useful only after the contribution path exists; it is not an announcement channel | Later |
| LinkedIn | A technical claim, 30–60 second clip, and the case-study link | Closest channel to the hiring outcome; existing professional context helps | With every major proof artifact, sparingly |
| DEV `#showdev` | A project walkthrough or condensed version of a real engineering article | The tag is designed for projects; generic project promotion does not belong under `#opensource` | After the canonical article |
| Hacker News `Show HN` | A runnable Paige with the “sometimes does nothing” angle | Strong technical audience and direct feedback, but Show HN requires something people can try | Once the launch gate passes |
| Lobsters | The provenance, capability, or benchmark article | Good fit for deep technical material if Adrian is already an active member; self-promotion must remain a minority of participation | Opportunistically, not as a drive-by account |
| Changelog News | The release or benchmark article | Self-submission is explicitly welcome when the work is newsworthy to developers | After the public release |
| Console.dev | The released tool with a sharp demo and clear developer use case | Curates interesting developer tools and accepts submissions | After external proof exists |
| `r/LLMDevs` | The safety/eval design and free open-source project | The community currently permits clearly disclosed free open-source projects | One relevant post; recheck rules first |
| `r/devops` weekly self-promotion thread | The docs-drift workflow and operator boundaries | The recurring thread explicitly accepts projects; relevance is narrower than HN | Secondary distribution |
| `r/AI_Agents` project-display thread or `r/github` self-promotion megathread | Demo clip and repository | Allowed discovery surfaces, but noisy and weak as career evidence | Optional |
| Local Write the Docs, AI engineering, TypeScript, and DevTools meetups | A live talk built around one failure and one demo | A talk creates deeper relationships and a reusable recording | After two real cases |

Do not publish the same announcement everywhere on the same morning. Start with
the repository, enter the Eve and Vercel surfaces during the ecosystem sprint,
and use those responses to improve the artifact. Then ask the Write the Docs
community for product critique before the broader developer launch. Be present
for replies. A launch is a conversation window, not a scheduled-posting
problem.

Possible angles:

- **Show HN:** `Show HN: Paige – an open-source documentation agent that sometimes decides not to write`
- **Write the Docs:** “I built Paige because most AI docs tools are biased
  toward producing copy. This one starts with an impact report and can conclude
  that no change is needed. I would value criticism of what evidence a
  documentarian would need before trusting that decision.”
- **LinkedIn:** lead with the failed assumption or engineering tradeoff, show
  the artifact, then link to the full case. Avoid “thrilled to announce.”
- **Meetup talk:** `Slack is not a source of truth: building an agent that can
  maintain docs without believing every message it reads`.

Before every community post, read its current rules. Community guidelines move
faster than this document.

## Operating Plan

### Phase 0: Make It Real

- Publish the Apache-2.0 license. Community health files can follow before the
  broad launch.
- Keep the canonical repository metadata and homepage accurate, pin the
  repository, and use the mascot until current visual proof exists.
- Narrow the alpha claim to the current stable surface.
- Record the Vercel-ready video and architecture image against that surface.
- Run the seven-day ecosystem sprint: Eve Show and tell, Vercel Showcase, X,
  and precise outreach to one or two Eve builders.

Exit: an Eve builder can understand the application, verify that the claim is
honest, and repost or invite a deeper demonstration without doing research for
Adrian.

### Phase 1: Earn Evidence

- Complete the capability-migration exit.
- Publish the prepared community health files, then cut the `v0.1.0` release
  required for the broad launch.
- Run the three proof cases with at least two maintainers outside the immediate
  project context.
- Turn every material failure into an issue or eval.
- Publish the first case study and demo.
- Ask Write the Docs for critique and respond to it.

Exit: at least one external maintainer has confirmed a useful outcome, and the
public material shows both action and restraint.

### Phase 2: Launch The Argument

- Publish the canonical “sometimes does nothing” article and video.
- Share it to GitHub, the personal site, Write the Docs, LinkedIn, and DEV.
- Run Show HN only when the try path is ready.
- Submit the strongest artifact to Changelog News and Console.dev.
- Complete Paige Bench and use its result as a separate technical story.

Exit: several substantive conversations with the target audience, not a target
star count.

### Phase 3: Keep Showing The Work

- Publish a small proof-based release note monthly when there is something
  worth showing.
- Contribute to adjacent open-source projects and help people with the docs
  problems Paige is built around.
- Reply to new issues and contributions quickly, even if the first response is
  only an acknowledgement.
- Convert repeated questions into README or demo improvements.
- Pitch the proven talk to local meetups and later to Write the Docs or
  developer-tool conferences.

Exit: Paige has a visible maintenance history and Adrian is known for the
quality of the work, not just the launch.

## Scorecard

Review this monthly. Record names and links, not just totals.

### Primary evidence

- External maintainers who ran Paige on their own material.
- Public impact reports with a confirmed outcome.
- Accepted or maintainer-requested documentation patches.
- Correct no-change decisions that a maintainer confirmed.
- External issues, contributions, citations, and invitations to explain the
  work.
- Technical articles, demos, talks, and upstream PRs that point to concrete
  Paige artifacts.
- Inbound collaboration, interview, or hiring conversations that mention Paige.

### Diagnostic metrics

- Stars, forks, clones, release downloads, demo completion, and README-to-demo
  click-through.
- Time to first response on external issues and PRs.
- How many people begin setup but do not reach a first impact report.
- Which proof artifacts start substantive discussion rather than shallow likes.

The first meaningful milestone is five external maintainer conversations, three
real runs, two confirmed useful outcomes, three strong public artifacts, and one
inbound professional opportunity tied to the project. If those happen with 40
stars, the strategy is working. If Paige gets 4,000 stars and nobody can show a
trusted result, it is not.

## Career Conversion

Keep the repository about the project. Do not turn the README into a job ad.
The hiring conversion belongs on Adrian's profile and personal site:

- pin Paige on GitHub once the launch gate passes;
- publish a `peelar.dev` case study that names the problem, constraints,
  architecture, failures, proof, and Adrian's role;
- link the strongest live demo, accepted external outcome, benchmark report,
  and architecture decision;
- use one concrete CV bullet with the same evidence;
- keep a short talk recording available for people who will not clone the repo.

The desired impression is not “Adrian had time for a side project.” It is
“Adrian can take an ambiguous product problem, build the hard system behind it,
set responsible boundaries, prove that it works, and explain the tradeoffs.”

## Research Anchors

- [Vercel: Introducing Eve](https://vercel.com/blog/introducing-eve)
- [Eve Discussions: Show and tell](https://github.com/vercel/eve/discussions/categories/show-and-tell)
- [Vercel: Build a documentation agent with Eve and Sanity](https://vercel.com/kb/guide/sanity-eve-agent)
- [Vercel Community: Showcase](https://community.vercel.com/c/showcase/41)
- [Vercel Weekly: Community Projects](https://community.vercel.com/t/vercel-weekly-2026-06-22/44187)
- [Vercel Community FAQ: live demos](https://community.vercel.com/t/frequently-asked-questions-faq/151)
- [Vercel Community: template submissions are currently closed](https://community.vercel.com/t/template-submission-link/41236)
- [GitHub: Licensing a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
- [GitHub: Community profiles](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories)
- [Open Source Guides: Finding users](https://opensource.guide/finding-users/)
- [Open Source Guides: Building welcoming communities](https://opensource.guide/building-community/)
- [Hacker News: Show HN guidelines](https://news.ycombinator.com/showhn.html)
- [Write the Docs: Slack channels and self-promotion guidelines](https://www.writethedocs.org/slack/)
- [DEV: Show DEV](https://dev.to/t/showdev)
- [DEV: Open-source tag guidelines](https://dev.to/t/opensource)
- [Lobsters: About and self-promotion rules](https://lobste.rs/about)
- [Changelog News: Submit news](https://changelog.com/news/submit)
- [Console.dev: Selection criteria](https://console.dev/selection-criteria)
