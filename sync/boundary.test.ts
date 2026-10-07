import { expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const seams = {
  'src/local-vault/collaboration-client.ts': 'client',
  'src/lib/vault/collaboration.ts': 'collaboration',
  'src/lib/vault/reconcile.ts': 'reconcile',
  'src/lib/vault/pack-reconcile.ts': 'pack-reconcile',
  'src/lib/vault/server-store.ts': 'store',
};

it('old application import paths remain implementation-free compatibility seams', () => {
  for (const [file, module] of Object.entries(seams)) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    expect(source.statements).toHaveLength(1);
    const declaration = source.statements[0];
    expect(ts.isExportDeclaration(declaration)).toBe(true);
    expect((declaration as ts.ExportDeclaration).moduleSpecifier?.getText(source)).toBe(`"@/sync/engine/${module}"`);
  }
});

for (const entry of ['client', 'server']) {
  it(`${entry} has no runtime dependency on UI, app routes or authentication`, () => {
    const seen = new Set<string>();
    function visit(file: string, chain: string[]) {
      if (seen.has(file)) return; seen.add(file);
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function dependency(specifier: string) {
        const trace = [...chain, file, specifier].join(' -> ');
        expect(/^(react(?:-dom)?(?:\/|$)|next(?:\/|$))/.test(specifier), trace).toBe(false);
        if (entry === 'client') expect(specifier.startsWith('node:'), trace).toBe(false);
        const base = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2))
          : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null;
        if (!base) return;
        const relative = path.relative(root, base).replaceAll('\\', '/');
        expect(/^src\/(components|app)\//.test(relative), trace).toBe(false);
        expect(/^src\/lib\/(auth|store|db)([/.]|$)/.test(relative), trace).toBe(false);
        const resolved = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(existsSync);
        if (resolved) visit(resolved, [...chain, file]);
      }
      function walk(node: ts.Node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
          if (!typeOnly) dependency(node.moduleSpecifier.text);
        }
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          expect(node.arguments.length && ts.isStringLiteral(node.arguments[0]), `Uninspectable dependency in ${file}`).toBeTruthy();
          if (ts.isStringLiteral(node.arguments[0])) dependency(node.arguments[0].text);
        }
        ts.forEachChild(node, walk);
      }
      walk(source);
    }
    visit(path.join(root, `src/sync/${entry}.ts`), []);
  });
}


it('native file-sync implementation stays independent of application UI frameworks', () => {
  const directory = 'mac/Sources/TextTextFileProviderKit';
  for (const file of readdirSync(directory).filter(name => /^LocalVault.*\.swift$/.test(name))) {
    const source = readFileSync(path.join(directory, file), 'utf8');
    expect(/\bimport\s+(AppKit|SwiftUI|WebKit|TextText)\b/.test(source), file).toBe(false);
  }
});
