namespace TextText.Windows;

// Stable identity belongs to this exact credential, never to a token hash.
public sealed record Account(string Token, string WorkspaceId, string Name, string? AccountId = null);
