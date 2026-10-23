using System.Text.Json;
using TextText.Windows;

static class BridgeConstructionTests
{
    public static async Task Run(Action<bool,string> assert)
    {
        using var entered = new ManualResetEventSlim();
        using var release = new ManualResetEventSlim();
        var candidate = new Candidate();
        var callerThread = Environment.CurrentManagedThreadId;
        var factoryThread = callerThread;
        var open = BridgeConstruction.CreateAsync(() => {
            factoryThread = Environment.CurrentManagedThreadId; entered.Set();
            if (!release.Wait(TimeSpan.FromSeconds(5))) throw new TimeoutException("Test did not release factory.");
            return candidate;
        }, () => true, CancellationToken.None);
        assert(entered.Wait(TimeSpan.FromSeconds(5)), "staged factory entered");
        assert(!open.IsCompleted && factoryThread != callerThread, "initial constructor yields caller while retained validation runs off-thread");
        release.Set();
        assert(ReferenceEquals(await open, candidate) && candidate.Retired == 0, "current candidate is returned without retirement");

        foreach (var cancel in new[] { false, true }) {
            using var started = new ManualResetEventSlim();
            using var finish = new ManualResetEventSlim();
            using var lifetime = new CancellationTokenSource();
            var old = new Candidate(); var current = true;
            var pending = BridgeConstruction.CreateAsync(() => {
                started.Set();
                if (!finish.Wait(TimeSpan.FromSeconds(5))) throw new TimeoutException("Test did not release late factory.");
                return old;
            }, () => current, lifetime.Token);
            assert(started.Wait(TimeSpan.FromSeconds(5)), "late factory entered");
            if (cancel) lifetime.Cancel(); else current = false;
            assert(!pending.IsCompleted && old.Retired == 0, "cancellation/supersession does not abandon in-flight constructor");
            finish.Set();
            var refused = false;
            try { await pending; } catch (Exception error) when (error is InvalidOperationException or OperationCanceledException) { refused = true; }
            assert(refused && old.Retired == 1, "late candidate is retired exactly once and never returned");
        }
        var called = false;
        try { await BridgeConstruction.CreateAsync(() => { called=true; return null; }, () => false, CancellationToken.None); }
        catch (InvalidOperationException) { }
        assert(!called, "stale scope cannot start construction");
        var retirement = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var retiring = new Candidate { Retirement = retirement.Task };
        var checks = 0;
        var rejected = BridgeConstruction.CreateAsync(() => retiring, () => ++checks == 1, CancellationToken.None);
        await retiring.RetirementStarted.Task;
        assert(!rejected.IsCompleted, "stale candidate retirement is awaited before failure returns");
        retirement.SetResult();
        try { await rejected; } catch (InvalidOperationException) { }
        assert(retiring.Retired == 1, "retirement finishes exactly once");
        var retirementFailure = new IOException("retirement failed");
        var broken = new Candidate { Retirement = Task.FromException(retirementFailure) };
        checks = 0;
        try {
            await BridgeConstruction.CreateAsync(() => broken, () => ++checks == 1, CancellationToken.None);
            assert(false, "failed retirement refuses candidate");
        } catch (AggregateException errors) {
            assert(errors.InnerExceptions.Count == 2 && errors.InnerExceptions[0] is InvalidOperationException &&
                ReferenceEquals(errors.InnerExceptions[1], retirementFailure), "stale-open and retirement failures both remain visible");
        }
        var original = new IOException("fixture constructor failed");
        Exception? observed = null;
        try { await BridgeConstruction.CreateAsync(() => throw original, () => true, CancellationToken.None); }
        catch (Exception error) { observed=error; }
        assert(ReferenceEquals(original, observed), "constructor errors remain intact");
    }
    sealed class Candidate : INativeWorkspaceBridge
    {
        public int Retired;
        public Task Retirement = Task.CompletedTask;
        public TaskCompletionSource RetirementStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public void Dispose() => throw new InvalidOperationException("Retirement must be awaited.");
        public Task RetireAsync() { Retired++; RetirementStarted.TrySetResult(); return Retirement; }
        public Task<object?> InvokeAsync(string method, JsonElement parameters, CancellationToken cancellationToken) => throw new NotSupportedException();
    }
}
