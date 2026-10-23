namespace TextText.Windows;

// Initial construction can validate a large retained workspace. Keep that IO
// off the dispatcher, but never abandon a constructor that may create a worker.
internal static class BridgeConstruction
{
    internal static async Task<INativeWorkspaceBridge?> CreateAsync(
        Func<INativeWorkspaceBridge?> factory, Func<bool> isCurrent, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!isCurrent()) throw new InvalidOperationException("Workspace changed while opening.");
        var candidate = await Task.Run(factory);
        // Await resumes on the caller's dispatcher; identity/UI ownership is
        // inspected there. Cancellation joins construction before retirement.
        try {
            cancellation.ThrowIfCancellationRequested();
            if (!isCurrent()) throw new InvalidOperationException("Workspace changed while opening.");
            return candidate;
        } catch (Exception openingError) {
            try { if (candidate is not null) await candidate.RetireAsync(); }
            catch (Exception retirementError) { throw new AggregateException(openingError, retirementError); }
            throw;
        }
    }
}
