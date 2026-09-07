import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export async function buildFixture() {
  const { build } = await import("esbuild");
  const actions = new Set<string>();
  // Only server actions, auth and the local data cache are replaced. Components,
  // CommandLayer, focus management, renderers and CSS are the production modules.
  const files = readdirSync("src", { recursive: true }) as string[];
  for (const file of files.filter(file => /\.tsx?$/.test(file)).map(file => `src/${file}`)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']@\/app\/editor\/[^"']+["']/g)) {
      for (const name of match[1].split(",")) if (!name.trim().startsWith("type ")) actions.add(name.trim().split(/\s/)[0]);
    }
  }
  const bundle = await build({ entryPoints: [resolve("src/components/accessibility/__tests__/a11y-fixture.tsx")], bundle: true,
    write: false, outdir: "a11y-memory", format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "a11y-boundaries", setup(api) {
      api.onResolve({ filter: /^(@\/app\/editor\/|@\/auth$|next-auth\/react$|next\/navigation$|next\/link$|@\/lib\/pool\/store$)/ }, args => ({ path: args.path, namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => {
        let contents = "";
        if (path.startsWith("@/app/editor/")) contents = [...actions].filter(Boolean).map(name => `export const ${name} = (...args) => window.a11yAction(${JSON.stringify(name)}, args);`).join("\n");
        else if (path === "@/auth") contents = "export const hasAppleProvider=true, hasGoogleProvider=true, devLoginEnabled=false;";
        else if (path === "next-auth/react") contents = 'export const signIn = provider => window.a11yCalls.push("signin:" + provider);';
        else if (path === "next/navigation") contents = 'export const useRouter=()=>({push:()=>{},refresh:()=>{}});';
        else if (path === "next/link") contents = 'import React from "react"; export default function Link(props){ return React.createElement("a", props); }';
        else contents = 'export const useWorkspacePool=()=>({pool:null}); export const addPost=()=>{},getWorkspacePost=()=>null,movePost=()=>{},removePost=()=>{},replacePost=()=>{},updatePost=()=>{};';
        return { contents, loader: "js", resolveDir: process.cwd() };
      });
    } }],
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text;
  return { js, css };
}
