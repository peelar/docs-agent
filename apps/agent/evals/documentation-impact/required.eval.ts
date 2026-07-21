import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { repositoryEvalFixture } from "../repository-fixture";
import {
  hasAtMostWords,
  hasDescriptiveMarkdownLink,
  onlyLinksTo,
} from "./assertions";

const pullRequestUrl = repositoryEvalFixture.pullRequest.url;
const documentationUrl = "https://docs.example.com/setup/cache";

export default defineEval({
  description: "A user-visible setup change is classified as required documentation",
  tags: ["behavior", "documentation-impact"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send([
      "Does this change need documentation? The evidence below is verified and complete.",
      `Change: ${pullRequestUrl}`,
      "The CACHE_URL environment variable is replaced by CACHE_ENDPOINT. Deployments using CACHE_URL stop at startup with a migration message.",
      `Current guide: ${documentationUrl}`,
      "The setup guide tells operators to configure CACHE_URL and does not mention CACHE_ENDPOINT or the migration.",
    ].join("\n"));

    t.succeeded();
    t.noFailedActions();
    t.loadedSkill("assess-documentation-impact");
    t.maxToolCalls(1);
    t.check(
      t.reply,
      satisfies(
        (reply) => /(?:documentation|docs).{0,25}(?:required|needed)|needs? (?:a )?(?:documentation|docs) (?:change|update)/i.test(String(reply)),
        "decision class is required documentation",
      ),
    );
    t.check(
      t.reply,
      satisfies(
        (reply) => /CACHE_URL/.test(String(reply)) && /CACHE_ENDPOINT/.test(String(reply)),
        "decision is grounded in the setup migration",
      ),
    );
    t.check(
      t.reply,
      satisfies(
        (reply) =>
          hasDescriptiveMarkdownLink(reply, pullRequestUrl) &&
          hasDescriptiveMarkdownLink(reply, documentationUrl) &&
          onlyLinksTo(reply, [pullRequestUrl, documentationUrl]),
        "supplied sources are linked without inventing sources",
      ),
    );
    t.check(t.reply, satisfies((reply) => hasAtMostWords(reply, 180), "concise teammate response")).soft();
  },
});
