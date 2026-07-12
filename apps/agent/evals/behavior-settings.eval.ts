import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

const DIRECT_THOROUGH_SETTINGS = [
  "## Workspace Behavior Settings",
  "",
  "- Give fuller reasoning and context, while keeping the conclusion easy to scan.",
  "- State the conclusion and disagreement plainly before supporting detail.",
  "- Use a restrained, professional conversational tone.",
  "- Push back firmly when a request would mislead readers or weaken documentation quality.",
  "- Escalate uncertainty early instead of carrying a consequential ambiguity forward.",
].join("\n");

const CONCISE_EXPRESSIVE_SETTINGS = [
  "## Workspace Behavior Settings",
  "",
  "- Keep ordinary answers compact unless the user asks for depth.",
  "- Lead gently into disagreement and recommendations.",
  "- Use an openly encouraging conversational tone without forced enthusiasm.",
  "- Flag weak documentation choices briefly, then ask what the user prefers.",
  "- State uncertainty and assumptions, then proceed when the next step is reversible.",
].join("\n");

export default [
  defineEval({
    description: "Default technical-editor behavior challenges an unsupported public claim",
    tags: ["behavior-settings", "defaults", "pushback", "uncertainty"],
    timeoutMs: 180_000,
    async test(t) {
      await t.send([
        "Answer this planning question without tools.",
        "A maintainer wants to document a new public API limit based only on an unverified Slack comment.",
        "How should we proceed?",
      ].join("\n"));

      t.succeeded();
      t.usedNoTools();
      t.check(t.reply, satisfies(
        (reply) => readerSafeReply(reply, { maxLength: 4_500 }),
        "tested defaults remain warm, evidence-strict, and proportional",
      ));
    },
  }),
  defineEval({
    description: "Direct thorough variant leads with firm pushback and early escalation",
    tags: ["behavior-settings", "variant", "direct", "thorough"],
    timeoutMs: 180_000,
    async test(t) {
      await t.send([
        DIRECT_THOROUGH_SETTINGS,
        "Treat the workspace behavior settings above as active for this eval turn.",
        "Answer this planning question without tools.",
        "We have a product chat claiming an API change, no release note or source change, and a request to publish the docs today.",
        "What do you recommend?",
      ].join("\n\n"));

      t.succeeded();
      t.usedNoTools();
      t.check(t.reply, satisfies(
        (reply) => {
          const text = String(reply).trim();
          const firstSentence = text.split(/[.!?]/u)[0]?.toLowerCase() ?? "";
          return readerSafeReply(text, { minLength: 1_200, maxLength: 7_000 }) &&
            includesAny(firstSentence, ["not", "don't", "wouldn't", "can't", "shouldn't", "hold", "stop"]);
        },
        "direct thorough variant leads with the blocker and supplies supporting reasoning",
      ));
    },
  }),
  defineEval({
    description: "Concise expressive variant remains evidence-bound without becoming verbose",
    tags: ["behavior-settings", "variant", "concise", "expressive"],
    timeoutMs: 180_000,
    async test(t) {
      await t.send([
        CONCISE_EXPRESSIVE_SETTINGS,
        "Treat the workspace behavior settings above as active for this eval turn.",
        "Reply without tools in no more than four short sentences.",
        "A teammate asks whether we can document an API claim that has not been verified in source.",
      ].join("\n\n"));

      t.succeeded();
      t.usedNoTools();
      t.check(t.reply, satisfies(
        (reply) => readerSafeReply(reply, { maxLength: 700 }),
        "concise expressive variant is brief and still refuses unsupported prose",
      ));
    },
  }),
];

function readerSafeReply(
  reply: unknown,
  bounds: { minLength?: number; maxLength: number },
): boolean {
  const text = String(reply).trim();
  const lower = text.toLowerCase();
  return text.length >= (bounds.minLength ?? 1) &&
    text.length <= bounds.maxLength &&
    includesAny(lower, ["evidence", "source", "release note", "verify", "verified"]) &&
    (/(?:^|\s)(?:no|not|hold|pause|wait|before)(?:\s|[,.—;:]|$)/u.test(lower) ||
      includesAny(lower, ["don't", "wouldn't", "can't", "shouldn't"]));
}

function includesAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}
