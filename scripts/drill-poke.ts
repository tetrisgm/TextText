// Companion to trunk-drill: bump the drill post so the change cursor moves.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true, { info() {}, error() {} } as never);

async function main() {
  const store = await import("../src/lib/store");
  const post = await store.getPostById(
    "trunk-drill",
    process.argv[2] ?? "8f554471-38bb-451f-a563-afbdba3c0d33",
  );
  if (!post) throw new Error("drill post missing");
  await store.savePost("trunk-drill", {
    ...post,
    title: `poked ${Date.now().toString(36)}`,
  });
  console.log("edited");
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
