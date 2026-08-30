export type ConfirmAttempt = {
  inviteId: string;
  revision: number;
  key: string;
};

export function confirmAttemptFor(
  current: ConfirmAttempt | null,
  inviteId: string,
  revision: number,
  createKey: () => string,
): ConfirmAttempt {
  if (current?.inviteId === inviteId && current.revision === revision) return current;
  return { inviteId, revision, key: createKey() };
}
