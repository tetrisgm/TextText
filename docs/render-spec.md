# The TextText render spec

The template language. One page, so a person can read it before hand editing a
look and the assistant can be handed it before designing one.

Status: reference for what is on `main`. `src/lib/presentation/schema.ts` is the
authority; this document is checked against it by
`src/lib/presentation/__tests__/render-spec-doc.test.ts`, which fails if the
schema gains a primitive this page does not list, or this page lists one the
schema does not have. Neither can drift alone.

Who this is for: people, and any code that reads or writes a
`TemplateDefinition` directly. It is deliberately NOT fed to the item-type
assistant. The only thing a model ever writes is a BLUEPRINT, which is a
simpler authoring shape that compiles into the vocabulary below; no workspace
tool accepts a render spec from a model at all. Handing it this page would
teach it a vocabulary it cannot emit. Examples of blueprints, and of good
field sets, are what help there: `src/lib/ai/item-type-examples.ts`.

## What a template is

A template is data, not code. It is one validated `TemplateDefinition`:

| Key | What it carries |
| --- | --- |
| `schemaVersion`, `engineVersion` | Pinned. A document renders against the exact version it was written for. |
| `id`, `version`, `name`, `description` | Identity. Versions are additive; retiring one never deletes it. |
| `fields` | The data schema: what a document of this type holds beyond title and body. |
| `item` | One render node tree: how a single document reads. |
| `collection` | How a folder of them renders, plus its saved views. |
| `theme` | Ten presentational axes. Tokens, never CSS. |
| `example` | Sample content, so a look previews before any real item uses it. |

Both halves matter and travel together. A reading list and a blog are different
kinds of thing, not one page at two font sizes.

There is no template author API. You create a look by making a document and
saving it (`Save as look`, or `save_item_as_look` for an agent), or by
describing the kind of thing you want and letting the assistant compile a
blueprint into one. Owner ruling 2026-08-15: the operations-based authoring API
was removed because a person could not author a look with it at all.

## Bindings

A node reads content through a binding, and the grammar is closed:

```
content.title
content.subtitle
content.body
content.tags
content.assets
content.fields.<fieldId>
```

Inside a node bound to a `rows` field, sub-fields address the row instead:

```
row.<subFieldId>
```

Nothing else parses. There is no expression language, no function call, no
path into arbitrary application state. That restriction is the whole reason a
render spec can be authored by a model and stored as user data: the worst a
malformed spec can do is fail validation.

Every node also accepts `showWhen`, a binding that hides the node when its
value is empty, and an optional `id`.

## Field types

Ten. Each carries `id`, `label`, `required`, `visibility`, `help`, plus its own:

| Type | Adds |
| --- | --- |
| -> `text` | `maxLength` |
| `richtext` | `maxLength`. Markdown, edited as styled source. |
| `image` | `allowedContentTypes` |
| `date` | |
| `url` | |
| `enum` | `options` (value, label, tone), `multiple`, `semantic`, `workflow` (initial, completed, transitions) |
| `number` | `min`, `max`, `step`, `format` |
| `boolean` | |
| `reference` | `target`, `multiple`, `semantic` |
| -> `rows` | `fields` (sub-fields), `maxRows`. A repeating group: checklist items, ingredients, attendees. |

A blueprint may also declare a `computed` field. It is not stored as a field; it
compiles to a `facts` entry `derive` or a `progress` `source`, both of which read
from a `rows` field. Count, sum, and done-of are the available operations.

## Render nodes

Twenty-two types. Grouped here by what they are for; the schema is one flat
discriminated union.

### Structure

| Node | Properties |
| --- | --- |
| -> `stack` | `direction` (vertical, horizontal), `align` (start, center, end, stretch), `gap`, `children` |
| `group` | `gap`, `children` |
| `masthead` | `gap`, `children`. A group that reads as a document header. |
| `space` | `size`, `rule`. True draws a rule, false leaves the gap empty. `divider` and `spacer` normalise into it. |

Spacing tokens everywhere: `none`, `xs`, `sm`, `md`, `lg`, `xl`.

### Text

| Node | Properties |
| --- | --- |
| `text` | `bind`, `role`, `fallback`, `href` |
| `prose` | `bind`. Renders Markdown. |
| `quote` | `bind`, `variant` (block, pull, attributed), `attributionBind` |
| `callout` | `tone` (note, tip, success, warning, danger, decision), `title`, `icon`, `children` |

`text.role` is the type scale, not a font size: `eyebrow`, `title`, `subtitle`,
`heading`, `body`, `caption`, `meta`, `icon`. A look says which role a value
plays and the theme decides how that role sets.

### Media

| Node | Properties |
| --- | --- |
| `cover` | `bind`, `alt`, `fit` (cover, contain), `height` (compact, medium, large, viewport) |
| `image` | same |
| `video` | same. Gives a video asset a real player. |
| `gallery` | `bind`, `columns` (1 to 4) |

### Data

| Node | Properties |
| --- | --- |
| `facts` | `variant` (table, strip, pills), `entries` (bind, label, format, derive) |
| `badge` | `bind`, `variant` (pill, chips, glyph), `showIcon` |
| `toggle` | `bind`, `labelBind`, `variant` (circle, square) |
| `checklist` | `bind`, `doneBind`, `labelBind`, `meta`, `mode` (document, reader), `sortCheckedLast`, `rollup` |
| `rows` | `bind`, `variant` (table, steps, timeline, tiles), `columns`, `sort` |
| `progress` | `variant` (bar, ring, fraction), `source` |
| `poll` | `bind`, `labelBind`, `multiple`, `closesBind` |

`facts.entries[].format` accepts `date`, `relative`, and `countdown`. Numbers
format through the field's own `format`, which includes `currency`, `percent`,
`minutes`, and `rating`. Those are number formats, not node types.

### Identity

| Node | Properties |
| --- | --- |
| `meta` | `variant` (byline, metadata). The byline is author and date; the metadata line is the document's own. |

`byline` and `metadata` are still accepted on input and normalise to `meta`
before anything downstream sees them. They are not removed, and will not be: a
`.textpack` exported at any time in the past carries a whole look inside it,
lives outside the database, and never expires.

## Collections

How a folder of these documents renders.

| Key | Values |
| --- | --- |
| `layout` | `list`, `cards`, `timeline`, `index`, `single`, `board`, `calendar`, `heatmap` |
| `columns` | 1 to 4 |
| `gap` | spacing token |
| `groupBy` | `content.fields.<id>`. Board columns, one per option of a single-select enum, plus an unsorted column. |
| `dateBy` | `content.fields.<id>`. Which date puts an item on a day. |
| `sort` | Ordering |
| `filters` | Which items appear |
| `views`, `defaultView` | Saved views over the same collection |
| `item` | The render node tree for one entry in the collection |

Two layouts have a hard requirement: `board` needs a `groupBy` naming a
single-select enum, and `calendar` and `heatmap` need a `dateBy` naming a date
field. A spec that asks for those layouts without the field it needs does not
validate.

## Theme

Ten axes. Tokens only, so a look can never smuggle in CSS.

| Axis | Values |
| --- | --- |
| `accent` | One hex color |
| `typography` | `system`, `editorial`, `mono` |
| `density` | `compact`, `comfortable`, `spacious` |
| `measure` | `narrow`, `reading`, `wide`, `full` |
| `corners` | `square`, `subtle`, `rounded` |
| `surface` | `system`, `paper`, `soft`, `ink` |
| `titleScale` | `compact`, `standard`, `large` |
| `bodyScale` | `compact`, `standard`, `relaxed` |
| `alignment` | `start`, `center` |
| -> `media` | `full`, `contained`, `bleed` |

`bodyScale` exists because a look could once say how large its title was and not
how large its text was, so a reading-first look, which is the entire point of
something like Medium, could not be expressed.

## The reduction this grammar is heading for

The schema accepts **24 spellings** today: 22 original names plus `meta` and
`space`, the first two targets. Nothing emits the new ones yet.

**Reader first.** `meta` and `space` are accepted and rendered, and
`byline`/`metadata` and `divider`/`spacer` normalise into them AT THE RENDERER,
not on parse. Normalising on parse would rewrite the object every serializer
downstream writes out, so sync, look export and newly compiled types would all
start emitting the new names immediately, and a `.textpack` exported after that
could not be read by an earlier build. No database migration reaches a bundle
already on someone's disk. Reading both and writing neither keeps a rollback
safe.

The legacy spellings are accepted permanently, not until a migration finishes,
for the same reason.

The remaining merges, and what each costs, are in
`docs/plans/primitive-reduction.md`. The target is 13 names, not 10: `field`
and `rows` need nested unions rather than flat flags, and `quote`, `progress`
and `poll` stay separate.

## What is not in the language

No HTML, CSS, JavaScript, or component names. No expressions, no loops, no
conditionals beyond `showWhen`. No access to anything outside the document's own
content. A render spec is validated data end to end, and
`DocumentRenderer.tsx` is the only thing that turns it into a page.

## Versioning

Documents pin the exact template version they were written against, so a look
that changes never reformats an existing document underneath its author. Adding
a version is additive. Retiring a template stops it being offered and deletes
nothing.
