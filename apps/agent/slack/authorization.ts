type SlackAuthorizationRequired = {
  readonly authorization?: {
    readonly instructions?: string;
    readonly url?: string;
    readonly userCode?: string;
  };
  readonly description: string;
};

type SlackAuthorizationThread = {
  readonly isDM: boolean;
  post(message: { markdown: string }): Promise<unknown>;
};

/** Shows an Eve connection challenge without exposing its credential outside a DM. */
export async function postSlackAuthorizationRequired(
  event: SlackAuthorizationRequired,
  thread: SlackAuthorizationThread | null,
): Promise<void> {
  if (!thread?.isDM) {
    // The authorization URL can bind a credential to whoever opens it. Paige only
    // accepts DMs, and this check keeps a future handler from leaking it to a channel.
    throw new Error(
      "Refusing to deliver a Slack authorization challenge outside a direct message.",
    );
  }

  const authorization = event.authorization;
  const paragraphs = [
    authorization?.instructions || event.description,
    authorization?.url,
    authorization?.userCode
      ? `Code: \`${authorization.userCode}\``
      : undefined,
  ].filter((paragraph): paragraph is string => Boolean(paragraph));

  await thread.post({ markdown: paragraphs.join("\n\n") });
}
