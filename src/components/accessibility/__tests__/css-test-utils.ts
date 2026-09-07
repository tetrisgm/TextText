import { createRequire } from "node:module";

// Resolve PostCSS through Next, which declares it as a production dependency.
// Collection must not depend on a transitive package being hoisted at the root.
const nextRequire = createRequire(createRequire(import.meta.url).resolve("next/package.json"));
type Declaration = { prop: string; value: string; important?: boolean };
type Rule = {
  selector: string;
  // `params` is the at-rule prelude when the parent is one, e.g. a media query.
  parent?: { type: string; params?: string };
  walkDecls(callback: (declaration: Declaration) => void): void;
  walkDecls(prop: string, callback: (declaration: Declaration) => void): void;
};
type AtRule = { params: string; toString(): string };
type Root = {
  walkRules(callback: (rule: Rule) => void): void;
  walkDecls(callback: (declaration: Declaration) => void): void;
  walkAtRules(name: string, callback: (rule: AtRule) => void): void;
};
export const postcss = nextRequire("postcss") as { parse(source: string): Root };
