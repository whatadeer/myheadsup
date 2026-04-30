export function describeRequestError(error: unknown, fallbackMessage: string) {
  if (!(error instanceof Error)) {
    return fallbackMessage;
  }

  const message = error.message.trim();

  if (!message || /^(fetch failed|failed to fetch)$/i.test(message)) {
    return fallbackMessage;
  }

  return message;
}
