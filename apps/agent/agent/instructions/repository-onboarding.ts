import { defineDynamic, defineInstructions } from "eve/instructions";

import { resolveRepositoryConfigurationStore } from "../../repositories/configuration/database";
import {
  repositoryConfigurationSessionState,
} from "../../repositories/configuration/draft";
import {
  summarizeRepositoryConfiguration,
} from "../../repositories/configuration/service";

export default defineDynamic({
  events: {
    "turn.started": async (_event, _ctx) => {
      const session = repositoryConfigurationSessionState.get();
      const active = await resolveRepositoryConfigurationStore()
        .asyncAndThen((store) => store.get());
      if (active.isErr()) throw active.error;

      if (session.proposal !== undefined) {
        const proposal = summarizeRepositoryConfiguration(
          session.proposal.configuration,
        );
        return defineInstructions({
          markdown: proposalInstructions(proposal),
        });
      }

      if (active.value !== undefined) {
        return defineInstructions({
          markdown:
            "This agent has an active repository setup. Use repository_configuration read when the user asks to see or change it. Any change must be proposed as a complete summary and activated only after the user confirms that summary.",
        });
      }

      return defineInstructions({
        markdown: session.deferred
          ? deferredInstructions
          : firstRunInstructions,
      });
    },
  },
});

const firstRunInstructions = `
This agent has not connected repositories yet.

Guide setup one step at a time:

1. In at most two short sentences, say that connecting repositories lets Paige
   maintain the documentation and check it against the product, then ask if the
   user wants to set it up. Do not ask for URLs yet.
2. If they agree, ask only for the documentation repository's GitHub URL.
3. After they provide it, ask for any optional product repository URLs, or let
   them skip this step.
4. Only after both answers, call repository_configuration with propose.

Each reply should contain only the current step and one direct question. Do not
list capabilities, repeat explanations, add reassurance, or use filler. If the
user declines setup, call repository_configuration with defer before replying
and do not bring setup up again during ordinary conversation.

Keep the explanation in normal product language. Never mention internal roles,
scopes, catalogs, tokens, worktrees, databases, or runtime architecture.
`;

const deferredInstructions = `
This agent has no repository setup, and someone already chose not to
set it up for now. Do not mention setup during ordinary conversation. If the
current request actually needs repository access, briefly explain why
connecting repositories is needed and offer to resume setup.
`;

function proposalInstructions(proposal: {
  documentationRepository: string;
  evidenceRepositories: string[];
}): string {
  const evidence = proposal.evidenceRepositories.length === 0
    ? "No product repositories"
    : proposal.evidenceRepositories.join(", ");
  return `
There is an unconfirmed repository setup for this agent:

- Documentation to maintain: ${proposal.documentationRepository}
- Product repositories to check: ${evidence}

Present this clearly and ask whether it looks right. Call
repository_configuration confirm only after the user explicitly confirms.
If they correct anything, collect the correction and call propose again with
the complete desired setup. Do not expose internal implementation terms.
`;
}
