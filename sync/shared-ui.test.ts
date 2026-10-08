import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
function inspect(source: string) {
  const file = ts.createSourceFile("entry.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports: string[] = [], rendered: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) rendered.push(node.tagName.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file); return { imports, rendered };
}
function assertSharedEntry(source: string) {
  const entry = inspect(source);
  expect(entry.imports).toContain("./VaultApp");
  expect(entry.rendered).toContain("VaultApp");
  expect(entry.imports.filter(path => /(?:DocumentEditor|DocumentGrid|DocumentRenderer|StoryDisplay|NoteDisplay)$/.test(path))).toEqual([]);
}

describe("shared product UI boundary", () => {
  it.each(["main.tsx", "windows-main.tsx", "WebVault.tsx"])("%s mounts the common app, without a parallel product renderer", entry => {
    assertSharedEntry(read(`src/local-vault/${entry}`));
  });
  it("detects a platform fork even if its shared import was left behind", () => {
    expect(() => assertSharedEntry('import { VaultApp } from "./VaultApp"; render(<WindowsApp />)')).toThrow();
  });
  it("keeps editor, collection and collaboration composition in the shared app", () => {
    const app = inspect(read("src/local-vault/VaultApp.tsx"));
    for (const component of ["UnifiedDocumentEditor", "WorkspaceOverview", "CollaborativeVaultEditor"]) expect(app.rendered).toContain(component);
    for (const file of ["WorkspaceOverview.tsx", "FolderPresentation.tsx"]) expect(inspect(read(`src/local-vault/${file}`)).rendered).toContain("VaultDocumentGrid");
    expect(inspect(read("src/local-vault/CollaborativeVaultEditor.tsx")).rendered).toContain("UnifiedDocumentEditor");
  });
  it("both native build paths package the same builder output, with transport-only entry selection", () => {
    const builder=read("scripts/build-local-vault.mjs");
    expect(builder).toContain('entry = "src/local-vault/main.tsx"');
    const mac=read("mac/scripts/build-app.sh");
    expect(mac).toContain('node "$MAC/../scripts/build-local-vault.mjs"');
    expect(mac).toContain('cp -R "$MAC/build/LocalVault" "$APP/Contents/Resources/LocalVault"');
    const windows=read("windows/scripts/build-ui.mjs");
    expect(windows).toContain("import { buildLocalVault } from '../../scripts/build-local-vault.mjs'");
    expect(windows).toContain("entry:'src/local-vault/windows-main.tsx'");
    expect(windows).toContain("../TextText.Windows/Assets/");
    expect(read("windows/TextText.Windows/TextText.Windows.csproj")).toContain('Content Include="Assets\\**\\*"');
  });
});
