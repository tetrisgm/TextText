namespace TextText.Core;

/// Resolves Explorer requests only inside the already authenticated workspace.
public static class FileActivation
{
    public static string Resolve(TextPackStore store, string absolutePath)
    {
        if (absolutePath.Length > 32767 || !Path.IsPathFullyQualified(absolutePath) || !absolutePath.EndsWith(".textpack", StringComparison.OrdinalIgnoreCase))
            throw new IOException("Choose a TextPack file in your workspace.");
        var full = Path.GetFullPath(absolutePath);
        if (!full.StartsWith(store.Root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new IOException("This file is outside your current workspace.");
        var relative = Path.GetRelativePath(store.Root, full).Replace('\\', '/');
        var resolved = store.Resolve(relative); // Includes containment and reparse validation.
        if (!File.Exists(resolved)) throw new FileNotFoundException("This file is not available on this device.");
        return relative;
    }
}
