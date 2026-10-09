namespace TextText.Windows;

/// <summary>Native workspace identity handed to the bridge. Kept free of WPF so bridge tests run without a desktop.</summary>
public sealed record WorkspaceContext(string Root, string WorkspaceId, Uri Origin, Func<Task<string>> TokenProvider, Func<string,object?,Task> Emit, string Access = "owner");
