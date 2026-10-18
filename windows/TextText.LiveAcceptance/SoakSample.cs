using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
// Read-only private actor protocol, not product telemetry.
static class SoakSample {
    internal static JsonElement Validate(JsonElement value, string? runId) {
        if(runId is null || !Regex.IsMatch(runId,"^[A-Za-z0-9_-]{1,100}\\z") || value.ValueKind!=JsonValueKind.Object || value.EnumerateObject().Select(p=>p.Name).Order().SequenceEqual(new[]{"id","version"})!=true || !value.TryGetProperty("version",out var version) || version.ValueKind!=JsonValueKind.Number || !version.TryGetInt32(out var number) || number!=1 || !value.TryGetProperty("id",out var id) || id.ValueKind!=JsonValueKind.String) throw new InvalidDataException("Invalid soak sample");
        var text=id.GetString()!;var prefix=runId+":soak:";
        if(!text.StartsWith(prefix,StringComparison.Ordinal) || !int.TryParse(text[prefix.Length..],out var n) || n<0 || n>120 || n.ToString(System.Globalization.CultureInfo.InvariantCulture)!=text[prefix.Length..]) throw new InvalidDataException("Foreign or noncanonical soak sample");
        return value.Clone();
    }
}
