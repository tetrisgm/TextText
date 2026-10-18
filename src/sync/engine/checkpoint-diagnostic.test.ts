import { describe, expect, it } from "vitest";
import { checkpointFailureDiagnostic } from "./checkpoint-diagnostic";
import { readFileSync } from "node:fs";
import ts from "typescript";

const context = { journalGeneration: 1, epoch: 1, seq: 0, pendingCount: 0, hasBatch: false, unqueuedDirty: false, clean: true };
describe("safe checkpoint failure export", () => {
  it("retains only known original code, exact native message and scalar context", () => {
    const error = Object.assign(new Error("A newer shared editing checkpoint is already saved."), { code: "503", request: { path: "/private/fixture", authorization: "sensitive-value" }, stack: "sensitive-stack" });
    const result = checkpointFailureDiagnostic(error, context);
    expect(result).toEqual({ version: 1, code: "503", message: "A newer shared editing checkpoint is already saved.", ...context });
    expect(JSON.stringify(result)).not.toMatch(/private|sensitive|request|stack|authorization/);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it("withholds arbitrary message, code and exception payload even when bounded", () => {
    const result = checkpointFailureDiagnostic({ code: "sensitive-value", message: "Could not open /private/fixture?credential=sensitive-value", status: 503, path: "/private/fixture" }, context);
    expect(result.code).toBe("503"); expect(result.message).toBe("Details withheld.");
    expect(JSON.stringify(result)).not.toMatch(/private|sensitive|credential/);
    expect(checkpointFailureDiagnostic("sensitive-value", context)).toMatchObject({ code: "unknown", message: "Details withheld." });
    expect(checkpointFailureDiagnostic({ code: "503\n", message: "A newer shared editing checkpoint is already saved.\n" }, context)).toMatchObject({ code: "unknown", message: "Details withheld." });
  });
  it("never invokes error getters or stringification", () => {
    let invoked = 0;
    const error = { get code() { invoked++; throw Error("do not read"); }, get message() { invoked++; throw Error("do not read"); }, toString() { invoked++; throw Error("do not stringify"); } };
    expect(checkpointFailureDiagnostic(error, context)).toMatchObject({ code: "unknown", message: "Details withheld." });
    expect(invoked).toBe(0);
    let traps = 0;
    const proxy = new Proxy({}, { getOwnPropertyDescriptor() { traps++; throw Error("withheld"); } });
    expect(checkpointFailureDiagnostic(proxy, context)).toMatchObject({ code: "unknown", message: "Details withheld." });
    expect(traps).toBe(3); // Reflection can invoke proxy traps; their errors stay contained.
  });
  it("bounds context to safe scalar values without reflecting other fields", () => {
    const result = checkpointFailureDiagnostic({ code: "local_changed", message: "The file changed outside shared editing." }, { ...context, journalGeneration: Infinity, epoch: -1, seq: 0.5, pendingCount: Number.MAX_SAFE_INTEGER + 1 });
    expect(result).toMatchObject({ code: "local_changed", journalGeneration: null, epoch: null, seq: null, pendingCount: null });
    expect(Object.keys(result).sort()).toEqual(["version", "code", "message", ...Object.keys(context)].sort());
  });
  it("registers only the safe diagnostic getter in the existing recovery download", () => {
    const source = readFileSync(new URL("../../local-vault/CollaborativeVaultEditor.tsx", import.meta.url), "utf8");
    const file = ts.createSourceFile("CollaborativeVaultEditor.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function find(node: ts.Node, test: (value: ts.Node) => boolean): ts.Node | undefined {
      if (test(node)) return node;
      let found: ts.Node | undefined;
      node.forEachChild(child => { found ??= find(child, test); });
      return found;
    }
    const download = find(file, node => ts.isVariableDeclaration(node) && node.name.getText(file) === "downloadRecovery");
    expect(download).toBeDefined();
    const diagnostic = find(download!, node => ts.isVariableDeclaration(node) && node.name.getText(file) === "checkpointFailure") as ts.VariableDeclaration;
    expect(diagnostic.initializer?.getText(file)).toBe("clientRef.current?.recoveryCheckpointFailure ?? null");
    const stringify = find(download!, node => ts.isCallExpression(node) && node.expression.getText(file) === "JSON.stringify") as ts.CallExpression;
    expect(ts.isObjectLiteralExpression(stringify.arguments[0])).toBe(true);
    const fields = (stringify.arguments[0] as ts.ObjectLiteralExpression).properties;
    expect(fields.map(field => field.name?.getText(file))).toEqual(["document", "journal", "rawJournal", "checkpointFailure"]);
    expect(ts.isShorthandPropertyAssignment(fields[3])).toBe(true);
  });
});
