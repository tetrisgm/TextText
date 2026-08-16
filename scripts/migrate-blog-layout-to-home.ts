import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/**
 * Move the stored layout choice from the blog row to where it now governs.
 *
 * Until this ran, `blogs.home_layout` decided how the Blog page rendered, and
 * a second control on Home decided how Home rendered. Folder looks decided
 * neither. Now a folder's look decides how that folder's index renders, and
 * `blogs.home_layout` is Home's own layout.
 *
 * So each workspace whose Blog page was set to something other than the
 * default gets a look on its Blog folder that renders the same way, and its
 * stored value is rewritten into Home's vocabulary. A workspace that never
 * changed the setting needs neither: the Blog folder's built-in look already
 * renders cards.
 *
 * Idempotent. The second run finds every value already in Home's vocabulary
 * and does nothing.
 */

const PAGE_LAYOUTS = new Map<string, { layout: string; home: string; name: string }>([
  ["single", { layout: "single", home: "column", name: "Single" }],
  ["timeline", { layout: "timeline", home: "list", name: "Timeline" }],
  ["index", { layout: "index", home: "list", name: "Index" }],
]);

async function main() {
  const { db } = await import("../src/lib/db/client");
  if (!db) throw new Error("DATABASE_URL is not set");
  const { blogs, folders, documentTemplates } = await import(
    "../src/lib/db/schema"
  );
  const { getBuiltinTemplate } = await import("../src/lib/presentation/templates");
  const { validateTemplateDefinition } = await import(
    "../src/lib/presentation/schema"
  );
  const { and, eq } = await import("drizzle-orm");

  const rows = await db
    .select({ id: blogs.id, handle: blogs.handle, homeLayout: blogs.homeLayout })
    .from(blogs);

  let looks = 0;
  let rewritten = 0;

  for (const row of rows) {
    const move = PAGE_LAYOUTS.get(row.homeLayout);
    if (!move) continue;

    const blogFolder = (
      await db
        .select({
          id: folders.id,
          templateId: folders.defaultTemplateId,
          version: folders.defaultTemplateVersion,
        })
        .from(folders)
        .where(and(eq(folders.blogId, row.id), eq(folders.path, "blog")))
        .limit(1)
    )[0];

    if (blogFolder) {
      // The look is written from the folder's current one, so a workspace that
      // had already customized its Blog folder keeps everything but the layout.
      const current =
        getBuiltinTemplate(blogFolder.templateId, blogFolder.version) ??
        (
          await db
            .select({ definition: documentTemplates.definition })
            .from(documentTemplates)
            .where(
              and(
                eq(documentTemplates.blogId, row.id),
                eq(documentTemplates.templateId, blogFolder.templateId),
                eq(documentTemplates.version, blogFolder.version),
              ),
            )
            .limit(1)
        )[0]?.definition;

      if (!current) {
        console.warn(
          `  ${row.handle}: the Blog folder's look could not be read; layout left on the blog row`,
        );
        continue;
      }

      const templateId = `blog-${move.layout}`;
      const definition = validateTemplateDefinition({
        ...current,
        id: templateId,
        version: 1,
        name: move.name,
        collection: { ...current.collection, layout: move.layout },
      });

      await db
        .insert(documentTemplates)
        .values({
          blogId: row.id,
          templateId,
          version: 1,
          name: definition.name,
          definition,
        })
        .onConflictDoNothing();
      await db
        .update(folders)
        .set({ defaultTemplateId: templateId, defaultTemplateVersion: 1 })
        .where(eq(folders.id, blogFolder.id));
      looks += 1;
      console.log(`  ${row.handle}: Blog folder now wears the ${move.name} look`);
    }

    await db
      .update(blogs)
      .set({ homeLayout: move.home })
      .where(eq(blogs.id, row.id));
    rewritten += 1;
  }

  console.log(
    `blog layout to home: ${looks} Blog folders given a look, ${rewritten} blog rows rewritten, ${rows.length} workspaces read`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
