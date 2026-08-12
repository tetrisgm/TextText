// The claim behind dynamic document types is that an agent can DESCRIBE a new
// kind of document and it then exists: fields, layout, collection behavior,
// and a rendered public page, with no code change. This proof performs that
// loop against a live server over the real hosted MCP endpoint:
//
//   1. customize_document_template composes a "Wine log" type that ships
//      nowhere in the built-in catalog: nine typed fields, a replaced item
//      layout, a replaced collection card, rating-sorted and skip-filtered
//      collection behavior.
//   2. create_item + set_item_template + update_item(fields) +
//      set_item_status publish a real tasting entry with it.
//   3. get_item proves the typed values round-trip.
//   4. The PUBLIC reader page is fetched and must contain the engine's
//      rendered markers: the verdict pill, the formatted rating, the facts
//      strip values, and the aroma pills.
//
// Runs against TEXTTEXT_ORIGIN (the live eval harness) or localhost:3000.
//
//   node --env-file=.env.local --import tsx scripts/verify-generation-live.ts

import { TextTextClient } from "./texttext-live-client";
import { requestPublicLiveUrl } from "./public-live-request";
import { workspacePublicPostUrl } from "@/lib/public-paths";

const ORIGIN = process.env.TEXTTEXT_ORIGIN ?? "http://localhost:3000";
const ITEM_TITLE = "Chateau Musar 2017";

const OPERATIONS = [
  {
    op: "set-description",
    description: "A cellar diary: one bottle per entry, rated and shelved.",
  },
  {
    op: "set-fields",
    fields: [
      { id: "winery", label: "Winery", type: "text", required: true },
      { id: "vintage", label: "Vintage", type: "number", min: 1900, max: 2100, step: 1 },
      { id: "region", label: "Region", type: "text" },
      { id: "grapes", label: "Grapes", type: "text" },
      { id: "rating", label: "Rating", type: "number", min: 0, max: 5, step: 0.5, format: "rating" },
      { id: "price", label: "Price", type: "number", min: 0, format: "currency" },
      { id: "tastedAt", label: "Tasted", type: "date" },
      {
        id: "verdict",
        label: "Verdict",
        type: "enum",
        options: [
          { value: "cellar", label: "Cellar it", tone: "info", icon: "🕰️" },
          { value: "drink-now", label: "Drink now", tone: "success", icon: "🍷" },
          { value: "skip", label: "Skip", tone: "danger", icon: "🚫" },
        ],
      },
      {
        id: "aromas",
        label: "Aromas",
        type: "enum",
        multiple: true,
        options: [
          { value: "cherry", label: "Cherry", tone: "danger" },
          { value: "citrus", label: "Citrus", tone: "warning" },
          { value: "oak", label: "Oak", tone: "neutral" },
          { value: "floral", label: "Floral", tone: "accent" },
          { value: "spice", label: "Spice", tone: "info" },
        ],
      },
    ],
  },
  {
    op: "set-theme",
    theme: { typography: "editorial", measure: "reading", alignment: "start" },
  },
  {
    op: "replace-item",
    item: {
      type: "stack",
      gap: "lg",
      children: [
        {
          type: "masthead",
          gap: "sm",
          children: [
            { type: "text", bind: "content.title", role: "title", fallback: "Untitled bottle" },
            { type: "text", bind: "content.subtitle", role: "subtitle", showWhen: "content.subtitle" },
            {
              type: "stack",
              direction: "horizontal",
              gap: "sm",
              align: "center",
              children: [
                { type: "badge", bind: "content.fields.verdict", variant: "pill", showWhen: "content.fields.verdict" },
                { type: "badge", bind: "content.fields.aromas", variant: "pill", showWhen: "content.fields.aromas" },
              ],
            },
            { type: "text", bind: "content.fields.rating", role: "meta", showWhen: "content.fields.rating" },
            {
              type: "facts",
              variant: "strip",
              entries: [
                { bind: "content.fields.winery", label: "Winery" },
                { bind: "content.fields.vintage", label: "Vintage" },
                { bind: "content.fields.region", label: "Region" },
                { bind: "content.fields.grapes", label: "Grapes" },
              ],
            },
            {
              type: "facts",
              variant: "strip",
              entries: [
                { bind: "content.fields.price", label: "Price" },
                { bind: "content.fields.tastedAt", label: "Tasted", format: "date" },
              ],
            },
          ],
        },
        { type: "prose", bind: "content.body", showWhen: "content.body" },
      ],
    },
  },
  {
    op: "replace-collection-item",
    item: {
      type: "stack",
      gap: "xs",
      children: [
        { type: "text", bind: "content.title", role: "heading", fallback: "Untitled bottle" },
        { type: "text", bind: "content.fields.rating", role: "meta", showWhen: "content.fields.rating" },
        { type: "badge", bind: "content.fields.verdict", variant: "pill", showWhen: "content.fields.verdict" },
      ],
    },
  },
  {
    op: "set-collection-sort",
    sort: [
      { field: "content.fields.rating", direction: "desc" },
      { field: "updatedAt", direction: "desc" },
    ],
  },
  {
    op: "set-collection-filters",
    filters: [{ field: "content.fields.verdict", op: "neq", value: "skip" }],
  },
];

const FIELD_VALUES = {
  winery: "Chateau Musar",
  vintage: 2017,
  region: "Bekaa Valley, Lebanon",
  grapes: "Cabernet Sauvignon, Cinsault, Carignan",
  rating: 4.5,
  price: 38,
  tastedAt: "2026-07-26",
  verdict: "cellar",
  aromas: ["cherry", "oak", "spice"],
};

function assertContains(haystack: string, needle: string, label: string) {
  if (!haystack.includes(needle)) {
    throw new Error(`Public page is missing ${label}: expected "${needle}".`);
  }
}

async function main() {
  const client = new TextTextClient(ORIGIN);
  await client.signIn("generation@texttext.dev", "Generation Proof");
  const token = await client.mintToken("generation-proof");

  // 1. Compose the new type. Every call mints the next immutable version, so
  //    re-runs are new versions, never mutations of a published one.
  const customized = (await client.tool(token, "customize_document_template", {
    base_template_id: "texttext.note",
    base_template_version: 1,
    template_id: "wine-log",
    name: "Wine log",
    operations: OPERATIONS,
  })) as { template: { id: string; version: number } };
  const templateRef = customized.template;
  if (templateRef.id !== "wine-log" || !(templateRef.version >= 1)) {
    throw new Error(`unexpected template ref ${JSON.stringify(templateRef)}`);
  }

  // 2. The catalog must now offer it beside the built-ins.
  const listed = (await client.tool(token, "list_document_templates", {})) as {
    templates: { id: string; version: number }[];
  };
  if (
    !listed.templates.some(
      (entry) => entry.id === "wine-log" && entry.version === templateRef.version,
    )
  ) {
    throw new Error("wine-log is missing from list_document_templates");
  }

  // 3. Create, shape, fill, and publish an entry (reused when re-running).
  const existing = (await client.tool(token, "list_items", {
    folder_path: "blog",
    limit: 100,
  })) as { items?: { id: string; slug: string; title: string }[] };
  let item = (existing.items ?? []).find((entry) => entry.title === ITEM_TITLE);
  if (!item) {
    const created = (await client.tool(token, "create_item", {
      folder_path: "blog",
      title: ITEM_TITLE,
      body: "Still tannic at nine years old. Decanted two hours and it kept unfolding: leather, cedar, dried cherry. A wine that argues for patience.",
    })) as { item: { id: string; slug: string; title: string } };
    item = created.item;
  }
  await client.tool(token, "set_item_template", {
    id: item.id,
    template_id: templateRef.id,
    template_version: templateRef.version,
  });
  await client.tool(token, "update_item", { id: item.id, fields: FIELD_VALUES });
  await client.tool(token, "set_item_status", { id: item.id, status: "published" });

  // 4. Typed values round-trip through the store.
  const fetched = (await client.tool(token, "read_item", { id: item.id })) as {
    item: { fields?: Record<string, unknown>; template?: { id: string } };
  };
  const roundTrip = fetched.item.fields ?? {};
  if (roundTrip.rating !== 4.5 || roundTrip.verdict !== "cellar") {
    throw new Error(`fields did not round-trip: ${JSON.stringify(roundTrip)}`);
  }

  // 5. The PUBLIC page renders the composed layout with formatted values.
  const workspace = (await client.tool(token, "get_workspace", {})) as {
    workspace: { handle: string };
  };
  const pageUrl = workspacePublicPostUrl(
    workspace.workspace.handle,
    "blog",
    item.slug,
  );
  if (!pageUrl) throw new Error("could not construct the public page URL");
  const page = await requestPublicLiveUrl(pageUrl, ORIGIN);
  if (!page.ok) throw new Error(`public page ${pageUrl} returned ${page.status}`);
  const html = await page.text();
  assertContains(html, "Cellar it", "the verdict pill");
  assertContains(html, "★★★★½", "the formatted half-star rating");
  assertContains(html, "Bekaa Valley, Lebanon", "the region fact");
  assertContains(html, "Cherry", "the aroma pills");
  assertContains(html, "tt-facts", "the facts strip markup");
  assertContains(html, "Jul 26, 2026", "the formatted tasting date");

  console.log(
    JSON.stringify({
      status: "pass",
      template: templateRef,
      item: { id: item.id, url: pageUrl },
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
