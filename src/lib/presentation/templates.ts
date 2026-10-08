import { GENERATED_BUILTIN_TEMPLATES, HISTORICAL_BUILTIN_TEMPLATES } from "./generated-builtin-templates";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { validateTemplateDefinition } from "@/lib/presentation/schema";

// Retired definitions below remain resolvable so existing documents keep
// rendering, but only the active catalog is offered for new documents.

const meeting = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.meeting",
  version: 1,
  name: "Meeting notes",
  description:
    "Who met, what was discussed, what was decided, and who owes what by when.",
  fields: [
    { id: "date", label: "Date", type: "date", required: true },
    {
      id: "meetingType",
      label: "Type",
      type: "enum",
      options: [
        { value: "standup", label: "Standup", tone: "info", icon: "☀️" },
        {
          value: "one-on-one",
          label: "One on one",
          tone: "accent",
          icon: "👥",
        },
        { value: "planning", label: "Planning", tone: "warning", icon: "🗺️" },
        { value: "general", label: "General", tone: "neutral", icon: "📋" },
      ],
    },
    {
      id: "attendees",
      label: "Attendees",
      type: "text",
      help: "Names, separated by commas.",
    },
    { id: "project", label: "Project", type: "reference", target: "document" },
    { id: "decisions", label: "Decisions", type: "richtext" },
    {
      id: "actions",
      label: "Action items",
      type: "rows",
      fields: [
        { id: "item", label: "Action", type: "text", required: true },
        { id: "done", label: "Done", type: "boolean" },
        { id: "owner", label: "Owner", type: "text" },
        { id: "due", label: "Due", type: "date" },
      ],
    },
  ],
  theme: { typography: "system", measure: "reading", alignment: "start" },
  item: {
    type: "stack",
    gap: "md",
    children: [
      {
        type: "text",
        bind: "content.title",
        role: "title",
        fallback: "Untitled meeting",
      },
      {
        type: "badge",
        bind: "content.fields.meetingType",
        variant: "pill",
        showWhen: "content.fields.meetingType",
      },
      {
        type: "facts",
        variant: "strip",
        entries: [
          { bind: "content.fields.date", label: "Date", format: "date" },
          { bind: "content.fields.attendees", label: "Attendees" },
          { bind: "content.fields.project", label: "Project" },
        ],
      },
      { type: "prose", bind: "content.body" },
      {
        type: "callout",
        tone: "decision",
        title: "Decisions",
        showWhen: "content.fields.decisions",
        children: [{ type: "prose", bind: "content.fields.decisions" }],
      },
      {
        type: "checklist",
        bind: "content.fields.actions",
        doneBind: "row.done",
        labelBind: "row.item",
        meta: ["row.owner", "row.due"],
        mode: "document",
        sortCheckedLast: true,
        rollup: true,
        showWhen: "content.fields.actions",
      },
    ],
  },
  collection: {
    layout: "list",
    columns: 1,
    gap: "sm",
    sort: [{ field: "content.fields.date", direction: "desc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled meeting",
        },
        {
          type: "facts",
          variant: "strip",
          entries: [{ bind: "content.fields.date", format: "date" }],
        },
        {
          type: "badge",
          bind: "content.fields.meetingType",
          variant: "pill",
          showWhen: "content.fields.meetingType",
        },
        {
          type: "progress",
          variant: "fraction",
          source: {
            checklistBind: "content.fields.actions",
            doneBind: "row.done",
          },
          showWhen: "content.fields.actions",
        },
      ],
    },
  },
} as const;

const journal = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.journal",
  version: 1,
  name: "Journal",
  description: "One dated entry per day with a mood and room for photos.",
  fields: [
    { id: "date", label: "Date", type: "date", required: true },
    {
      id: "mood",
      label: "Mood",
      type: "enum",
      options: [
        { value: "great", label: "Great", tone: "success", icon: "😄" },
        { value: "good", label: "Good", tone: "success", icon: "🙂" },
        { value: "ok", label: "Okay", tone: "neutral", icon: "😐" },
        { value: "low", label: "Low", tone: "warning", icon: "🙁" },
        { value: "rough", label: "Rough", tone: "danger", icon: "😞" },
      ],
    },
    { id: "location", label: "Location", type: "text" },
  ],
  theme: { typography: "editorial", measure: "reading", alignment: "start" },
  item: {
    type: "stack",
    gap: "md",
    children: [
      {
        type: "text",
        bind: "content.title",
        role: "title",
        fallback: "Journal entry",
      },
      {
        type: "facts",
        variant: "strip",
        entries: [
          { bind: "content.fields.date", format: "date" },
          { bind: "content.fields.location" },
        ],
      },
      {
        type: "badge",
        bind: "content.fields.mood",
        variant: "pill",
        showWhen: "content.fields.mood",
      },
      { type: "prose", bind: "content.body" },
      {
        type: "gallery",
        bind: "content.assets",
        columns: 2,
        showWhen: "content.assets",
      },
    ],
  },
  collection: {
    layout: "heatmap",
    columns: 1,
    gap: "sm",
    dateBy: "content.fields.date",
    sort: [{ field: "content.fields.date", direction: "desc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "facts",
          variant: "strip",
          entries: [{ bind: "content.fields.date", format: "date" }],
        },
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Journal entry",
        },
        {
          type: "badge",
          bind: "content.fields.mood",
          variant: "pill",
          showWhen: "content.fields.mood",
        },
      ],
    },
  },
} as const;

const bookshelf = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.bookshelf",
  version: 1,
  name: "Bookshelf",
  description:
    "A reading log with shelves, ratings, progress, and a favorite quote per book.",
  fields: [
    { id: "author", label: "Author", type: "text" },
    { id: "cover", label: "Cover", type: "image" },
    {
      id: "status",
      label: "Shelf",
      type: "enum",
      options: [
        { value: "want", label: "Want to read", tone: "neutral", icon: "📚" },
        { value: "reading", label: "Reading", tone: "info", icon: "📖" },
        { value: "finished", label: "Finished", tone: "success", icon: "✅" },
        { value: "abandoned", label: "Abandoned", tone: "danger", icon: "🚫" },
      ],
    },
    {
      id: "rating",
      label: "Rating",
      type: "number",
      min: 0,
      max: 5,
      step: 0.5,
      format: "rating",
    },
    { id: "pages", label: "Pages", type: "number", min: 1, step: 1 },
    {
      id: "currentPage",
      label: "Current page",
      type: "number",
      min: 0,
      step: 1,
    },
    { id: "startedAt", label: "Started", type: "date" },
    { id: "finishedAt", label: "Finished", type: "date" },
    {
      id: "moods",
      label: "Moods",
      type: "enum",
      multiple: true,
      options: [
        { value: "cozy", label: "Cozy", tone: "success" },
        { value: "tense", label: "Tense", tone: "warning" },
        { value: "funny", label: "Funny", tone: "accent" },
        { value: "moving", label: "Moving", tone: "info" },
        { value: "strange", label: "Strange", tone: "neutral" },
      ],
    },
    { id: "favoriteQuote", label: "Favorite quote", type: "text" },
  ],
  theme: { typography: "system", measure: "reading", alignment: "start" },
  item: {
    type: "stack",
    gap: "lg",
    children: [
      {
        type: "stack",
        direction: "horizontal",
        gap: "lg",
        align: "start",
        children: [
          {
            type: "image",
            bind: "content.fields.cover",
            alt: "content.title",
            fit: "contain",
            height: "medium",
            showWhen: "content.fields.cover",
          },
          {
            type: "group",
            gap: "sm",
            children: [
              {
                type: "text",
                bind: "content.title",
                role: "title",
                fallback: "Untitled book",
              },
              {
                type: "text",
                bind: "content.fields.author",
                role: "subtitle",
                showWhen: "content.fields.author",
              },
              {
                type: "badge",
                bind: "content.fields.status",
                variant: "pill",
                showWhen: "content.fields.status",
              },
              {
                type: "text",
                bind: "content.fields.rating",
                role: "meta",
                showWhen: "content.fields.rating",
              },
              {
                type: "facts",
                variant: "table",
                entries: [
                  { bind: "content.fields.pages", label: "Pages" },
                  {
                    bind: "content.fields.startedAt",
                    label: "Started",
                    format: "date",
                  },
                  {
                    bind: "content.fields.finishedAt",
                    label: "Finished",
                    format: "date",
                  },
                ],
              },
              {
                type: "progress",
                variant: "bar",
                source: {
                  currentBind: "content.fields.currentPage",
                  targetBind: "content.fields.pages",
                },
                showWhen: "content.fields.currentPage",
              },
              {
                type: "badge",
                bind: "content.fields.moods",
                variant: "chips",
                showWhen: "content.fields.moods",
              },
            ],
          },
        ],
      },
      { type: "prose", bind: "content.body", showWhen: "content.body" },
      {
        type: "quote",
        bind: "content.fields.favoriteQuote",
        variant: "attributed",
        attributionBind: "content.fields.author",
        showWhen: "content.fields.favoriteQuote",
      },
    ],
  },
  collection: {
    layout: "cards",
    columns: 3,
    gap: "md",
    sort: [
      { field: "content.fields.rating", direction: "desc" },
      { field: "updatedAt", direction: "desc" },
    ],
    item: {
      type: "stack",
      gap: "sm",
      children: [
        {
          type: "image",
          bind: "content.fields.cover",
          alt: "content.title",
          fit: "contain",
          height: "medium",
          showWhen: "content.fields.cover",
        },
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled book",
        },
        {
          type: "text",
          bind: "content.fields.author",
          role: "caption",
          showWhen: "content.fields.author",
        },
        {
          type: "badge",
          bind: "content.fields.status",
          variant: "pill",
          showWhen: "content.fields.status",
        },
        {
          type: "text",
          bind: "content.fields.rating",
          role: "meta",
          showWhen: "content.fields.rating",
        },
      ],
    },
  },
} as const;

const watchlist = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.watchlist",
  version: 1,
  name: "Watchlist",
  description:
    "A film diary with posters, stars, and a heart for the ones you loved.",
  fields: [
    {
      id: "year",
      label: "Year",
      type: "number",
      min: 1888,
      max: 2100,
      step: 1,
    },
    { id: "poster", label: "Poster", type: "image" },
    {
      id: "status",
      label: "Status",
      type: "enum",
      options: [
        { value: "watchlist", label: "Watchlist", tone: "neutral", icon: "🍿" },
        { value: "watched", label: "Watched", tone: "success", icon: "🎬" },
      ],
    },
    { id: "watchedAt", label: "Watched", type: "date" },
    {
      id: "rating",
      label: "Rating",
      type: "number",
      min: 0,
      max: 5,
      step: 0.5,
      format: "rating",
    },
    { id: "liked", label: "Loved it", type: "boolean" },
    { id: "rewatch", label: "Rewatch", type: "boolean" },
  ],
  theme: { typography: "system", measure: "reading", alignment: "start" },
  item: {
    type: "stack",
    gap: "lg",
    children: [
      {
        type: "stack",
        direction: "horizontal",
        gap: "lg",
        align: "start",
        children: [
          {
            type: "image",
            bind: "content.fields.poster",
            alt: "content.title",
            fit: "contain",
            height: "medium",
            showWhen: "content.fields.poster",
          },
          {
            type: "group",
            gap: "sm",
            children: [
              {
                type: "text",
                bind: "content.title",
                role: "title",
                fallback: "Untitled film",
              },
              {
                type: "facts",
                variant: "strip",
                entries: [
                  { bind: "content.fields.year" },
                  {
                    bind: "content.fields.watchedAt",
                    label: "Watched",
                    format: "date",
                  },
                ],
              },
              {
                type: "text",
                bind: "content.fields.rating",
                role: "meta",
                showWhen: "content.fields.rating",
              },
              {
                type: "stack",
                direction: "horizontal",
                gap: "sm",
                align: "center",
                children: [
                  {
                    type: "badge",
                    bind: "content.fields.status",
                    variant: "pill",
                    showWhen: "content.fields.status",
                  },
                  {
                    type: "badge",
                    bind: "content.fields.liked",
                    variant: "glyph",
                    showWhen: "content.fields.liked",
                  },
                  {
                    type: "badge",
                    bind: "content.fields.rewatch",
                    variant: "glyph",
                    showWhen: "content.fields.rewatch",
                  },
                ],
              },
            ],
          },
        ],
      },
      { type: "prose", bind: "content.body", showWhen: "content.body" },
    ],
  },
  collection: {
    layout: "cards",
    columns: 4,
    gap: "sm",
    sort: [{ field: "content.fields.watchedAt", direction: "desc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "image",
          bind: "content.fields.poster",
          alt: "content.title",
          fit: "contain",
          height: "medium",
          showWhen: "content.fields.poster",
        },
        {
          type: "text",
          bind: "content.title",
          role: "caption",
          fallback: "Untitled film",
        },
        {
          type: "text",
          bind: "content.fields.rating",
          role: "meta",
          showWhen: "content.fields.rating",
        },
      ],
    },
  },
} as const;

const recipe = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.recipe",
  version: 1,
  name: "Recipe",
  description:
    "A cookable card with check-off ingredients beside numbered steps.",
  fields: [
    { id: "photo", label: "Photo", type: "image" },
    { id: "source", label: "Source", type: "url" },
    { id: "servings", label: "Servings", type: "number", min: 1, step: 1 },
    {
      id: "prepMinutes",
      label: "Prep time",
      type: "number",
      min: 0,
      format: "minutes",
    },
    {
      id: "cookMinutes",
      label: "Cook time",
      type: "number",
      min: 0,
      format: "minutes",
    },
    {
      id: "difficulty",
      label: "Difficulty",
      type: "enum",
      options: [
        { value: "easy", label: "Easy", tone: "success" },
        { value: "medium", label: "Medium", tone: "warning" },
        { value: "hard", label: "Hard", tone: "danger" },
      ],
    },
    {
      id: "rating",
      label: "Rating",
      type: "number",
      min: 0,
      max: 5,
      step: 0.5,
      format: "rating",
    },
    {
      id: "ingredients",
      label: "Ingredients",
      type: "rows",
      fields: [
        { id: "item", label: "Ingredient", type: "text", required: true },
        { id: "have", label: "Have it", type: "boolean" },
        { id: "section", label: "Section", type: "text" },
      ],
    },
    {
      id: "steps",
      label: "Steps",
      type: "rows",
      fields: [
        {
          id: "instruction",
          label: "Instruction",
          type: "text",
          required: true,
        },
        {
          id: "minutes",
          label: "Time",
          type: "number",
          min: 0,
          format: "minutes",
        },
      ],
    },
  ],
  theme: { typography: "system", measure: "reading", alignment: "start" },
  item: {
    type: "stack",
    gap: "lg",
    children: [
      {
        type: "cover",
        bind: "content.fields.photo",
        alt: "content.title",
        height: "large",
        showWhen: "content.fields.photo",
      },
      {
        type: "masthead",
        gap: "sm",
        children: [
          {
            type: "text",
            bind: "content.title",
            role: "title",
            fallback: "Untitled recipe",
          },
          {
            type: "text",
            bind: "content.subtitle",
            role: "subtitle",
            showWhen: "content.subtitle",
          },
          {
            type: "facts",
            variant: "strip",
            entries: [
              { bind: "content.fields.prepMinutes", label: "Prep" },
              { bind: "content.fields.cookMinutes", label: "Cook" },
              {
                bind: "content.fields.steps",
                label: "Steps",
                derive: { op: "sum", of: "row.minutes" },
              },
              { bind: "content.fields.servings", label: "Serves" },
              { bind: "content.fields.rating", label: "Rating" },
            ],
          },
          {
            type: "badge",
            bind: "content.fields.difficulty",
            variant: "pill",
            showWhen: "content.fields.difficulty",
          },
        ],
      },
      {
        type: "checklist",
        bind: "content.fields.ingredients",
        doneBind: "row.have",
        labelBind: "row.item",
        meta: ["row.section"],
        mode: "reader",
        sortCheckedLast: false,
        showWhen: "content.fields.ingredients",
      },
      {
        type: "rows",
        bind: "content.fields.steps",
        variant: "steps",
        columns: [
          { bind: "row.instruction" },
          { bind: "row.minutes", label: "Time" },
        ],
        showWhen: "content.fields.steps",
      },
      { type: "prose", bind: "content.body", showWhen: "content.body" },
      {
        type: "text",
        bind: "content.fields.source",
        href: "content.fields.source",
        role: "caption",
        showWhen: "content.fields.source",
      },
    ],
  },
  collection: {
    layout: "cards",
    columns: 3,
    gap: "md",
    sort: [
      { field: "content.fields.rating", direction: "desc" },
      { field: "updatedAt", direction: "desc" },
    ],
    item: {
      type: "stack",
      gap: "sm",
      children: [
        {
          type: "cover",
          bind: "content.fields.photo",
          alt: "content.title",
          height: "compact",
          showWhen: "content.fields.photo",
        },
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled recipe",
        },
        {
          type: "facts",
          variant: "strip",
          entries: [
            { bind: "content.fields.cookMinutes", label: "Cook" },
            { bind: "content.fields.rating" },
          ],
        },
        {
          type: "badge",
          bind: "content.fields.difficulty",
          variant: "pill",
          showWhen: "content.fields.difficulty",
        },
      ],
    },
  },
} as const;

const changelog = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.changelog",
  version: 1,
  name: "Changelog",
  description:
    "A release entry with categorized changes and the story behind them.",
  fields: [
    { id: "version", label: "Version", type: "text", required: true },
    { id: "date", label: "Date", type: "date" },
    {
      id: "releaseStatus",
      label: "Status",
      type: "enum",
      options: [
        {
          value: "unreleased",
          label: "Unreleased",
          tone: "warning",
          icon: "🚧",
        },
        { value: "released", label: "Released", tone: "success", icon: "🚀" },
        { value: "yanked", label: "Yanked", tone: "danger", icon: "⛔" },
      ],
    },
    { id: "cover", label: "Cover", type: "image" },
    { id: "breaking", label: "Breaking changes", type: "boolean" },
    { id: "compareUrl", label: "Compare link", type: "url" },
    {
      id: "changes",
      label: "Changes",
      type: "rows",
      fields: [
        {
          id: "kind",
          label: "Kind",
          type: "enum",
          options: [
            { value: "added", label: "Added", tone: "success", icon: "✨" },
            { value: "changed", label: "Changed", tone: "info", icon: "✏️" },
            { value: "fixed", label: "Fixed", tone: "accent", icon: "🔧" },
            { value: "removed", label: "Removed", tone: "neutral", icon: "🗑️" },
            {
              value: "security",
              label: "Security",
              tone: "danger",
              icon: "🛡️",
            },
          ],
        },
        { id: "note", label: "Change", type: "text", required: true },
      ],
    },
  ],
  theme: { typography: "system", measure: "reading", alignment: "start" },
  item: {
    type: "stack",
    gap: "lg",
    children: [
      {
        type: "masthead",
        gap: "sm",
        children: [
          {
            type: "text",
            bind: "content.title",
            role: "title",
            fallback: "Release",
          },
          {
            type: "facts",
            variant: "strip",
            entries: [
              { bind: "content.fields.version", label: "Version" },
              { bind: "content.fields.date", format: "date" },
            ],
          },
          {
            type: "badge",
            bind: "content.fields.releaseStatus",
            variant: "pill",
            showWhen: "content.fields.releaseStatus",
          },
          {
            type: "badge",
            bind: "content.fields.breaking",
            variant: "glyph",
            showWhen: "content.fields.breaking",
          },
        ],
      },
      {
        type: "cover",
        bind: "content.fields.cover",
        alt: "content.title",
        height: "medium",
        showWhen: "content.fields.cover",
      },
      { type: "prose", bind: "content.body", showWhen: "content.body" },
      {
        type: "rows",
        bind: "content.fields.changes",
        variant: "table",
        columns: [
          { bind: "row.kind", label: "Kind" },
          { bind: "row.note", label: "Change" },
        ],
        showWhen: "content.fields.changes",
      },
      {
        type: "text",
        bind: "content.fields.compareUrl",
        href: "content.fields.compareUrl",
        role: "caption",
        showWhen: "content.fields.compareUrl",
      },
    ],
  },
  collection: {
    layout: "timeline",
    columns: 1,
    gap: "sm",
    sort: [{ field: "content.fields.date", direction: "desc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Release",
        },
        {
          type: "facts",
          variant: "strip",
          entries: [
            { bind: "content.fields.version" },
            { bind: "content.fields.date", format: "date" },
          ],
        },
        {
          type: "badge",
          bind: "content.fields.releaseStatus",
          variant: "pill",
          showWhen: "content.fields.releaseStatus",
        },
      ],
    },
  },
} as const;

const decision = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.decision",
  version: 1,
  name: "Decision log",
  description:
    "A decision record with the options weighed and the outcome that governs.",
  fields: [
    { id: "seq", label: "Number", type: "number", min: 1, step: 1 },
    {
      id: "status",
      label: "Status",
      type: "enum",
      options: [
        { value: "proposed", label: "Proposed", tone: "info", icon: "💭" },
        { value: "accepted", label: "Accepted", tone: "success", icon: "✅" },
        { value: "rejected", label: "Rejected", tone: "danger", icon: "❌" },
        {
          value: "superseded",
          label: "Superseded",
          tone: "neutral",
          icon: "🔁",
        },
      ],
    },
    { id: "decidedAt", label: "Decided", type: "date" },
    {
      id: "deciders",
      label: "Deciders",
      type: "text",
      help: "Names, separated by commas.",
    },
    {
      id: "supersededBy",
      label: "Superseded by",
      type: "reference",
      target: "document",
    },
    {
      id: "options",
      label: "Options considered",
      type: "rows",
      fields: [
        { id: "option", label: "Option", type: "text", required: true },
        {
          id: "verdict",
          label: "Verdict",
          type: "enum",
          options: [
            { value: "chosen", label: "Chosen", tone: "success" },
            { value: "rejected", label: "Rejected", tone: "neutral" },
          ],
        },
        { id: "because", label: "Because", type: "text" },
      ],
    },
    { id: "outcome", label: "Outcome", type: "richtext" },
  ],
  theme: {
    typography: "system",
    measure: "reading",
    alignment: "start",
    density: "compact",
  },
  item: {
    type: "stack",
    gap: "md",
    children: [
      {
        type: "text",
        bind: "content.title",
        role: "title",
        fallback: "Untitled decision",
      },
      {
        type: "badge",
        bind: "content.fields.status",
        variant: "pill",
        showWhen: "content.fields.status",
      },
      {
        type: "facts",
        variant: "table",
        entries: [
          { bind: "content.fields.seq", label: "Number" },
          {
            bind: "content.fields.decidedAt",
            label: "Decided",
            format: "date",
          },
          { bind: "content.fields.deciders", label: "Deciders" },
          { bind: "content.fields.supersededBy", label: "Superseded by" },
        ],
      },
      { type: "prose", bind: "content.body" },
      {
        type: "rows",
        bind: "content.fields.options",
        variant: "table",
        columns: [
          { bind: "row.option", label: "Option" },
          { bind: "row.verdict", label: "Verdict" },
          { bind: "row.because", label: "Because" },
        ],
        showWhen: "content.fields.options",
      },
      {
        type: "callout",
        tone: "decision",
        title: "Outcome",
        showWhen: "content.fields.outcome",
        children: [{ type: "prose", bind: "content.fields.outcome" }],
      },
    ],
  },
  collection: {
    layout: "index",
    columns: 1,
    gap: "sm",
    sort: [{ field: "content.fields.seq", direction: "asc" }],
    filters: [
      { field: "content.fields.status", op: "neq", value: "superseded" },
    ],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled decision",
        },
        {
          type: "badge",
          bind: "content.fields.status",
          variant: "pill",
          showWhen: "content.fields.status",
        },
        {
          type: "facts",
          variant: "strip",
          entries: [
            { bind: "content.fields.seq", label: "Number" },
            { bind: "content.fields.decidedAt", format: "date" },
          ],
        },
      ],
    },
  },
} as const;

const wiki = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.wiki",
  version: 1,
  name: "Wiki page",
  description:
    "A living reference page with an owner and a visible last-reviewed date.",
  fields: [
    { id: "owner", label: "Owner", type: "text" },
    {
      id: "pageStatus",
      label: "Status",
      type: "enum",
      options: [
        { value: "draft", label: "Draft", tone: "neutral", icon: "✏️" },
        { value: "current", label: "Current", tone: "success", icon: "✅" },
        {
          value: "needs-review",
          label: "Needs review",
          tone: "warning",
          icon: "🔍",
        },
        { value: "archived", label: "Archived", tone: "neutral", icon: "📦" },
      ],
    },
    { id: "lastReviewed", label: "Last reviewed", type: "date" },
    {
      id: "related",
      label: "Related pages",
      type: "reference",
      target: "document",
      multiple: true,
    },
  ],
  theme: { typography: "system", measure: "wide", alignment: "start" },
  item: {
    type: "stack",
    gap: "md",
    children: [
      {
        type: "masthead",
        gap: "sm",
        children: [
          {
            type: "text",
            bind: "content.title",
            role: "title",
            fallback: "Untitled page",
          },
          {
            type: "text",
            bind: "content.subtitle",
            role: "subtitle",
            showWhen: "content.subtitle",
          },
          {
            type: "badge",
            bind: "content.fields.pageStatus",
            variant: "pill",
            showWhen: "content.fields.pageStatus",
          },
          {
            type: "facts",
            variant: "strip",
            entries: [
              { bind: "content.fields.owner", label: "Owner" },
              {
                bind: "content.fields.lastReviewed",
                label: "Last reviewed",
                format: "relative",
              },
            ],
          },
        ],
      },
      { type: "prose", bind: "content.body" },
      { type: "divider", showWhen: "content.fields.related" },
      {
        type: "badge",
        bind: "content.fields.related",
        variant: "chips",
        showWhen: "content.fields.related",
      },
    ],
  },
  collection: {
    layout: "index",
    columns: 1,
    gap: "sm",
    sort: [{ field: "title", direction: "asc" }],
    filters: [
      { field: "content.fields.pageStatus", op: "neq", value: "archived" },
    ],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled page",
        },
        {
          type: "badge",
          bind: "content.fields.pageStatus",
          variant: "pill",
          showWhen: "content.fields.pageStatus",
        },
        {
          type: "facts",
          variant: "strip",
          entries: [
            {
              bind: "content.fields.lastReviewed",
              label: "Reviewed",
              format: "relative",
            },
          ],
        },
      ],
    },
  },
} as const;

const spec = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.spec",
  version: 1,
  name: "Spec",
  description:
    "A one-page spec with scope, requirements, and open questions in one place.",
  fields: [
    {
      id: "specStatus",
      label: "Status",
      type: "enum",
      options: [
        { value: "draft", label: "Draft", tone: "neutral", icon: "📝" },
        { value: "in-review", label: "In review", tone: "info", icon: "👀" },
        { value: "approved", label: "Approved", tone: "success", icon: "✅" },
        { value: "shipped", label: "Shipped", tone: "accent", icon: "🚀" },
      ],
    },
    { id: "owner", label: "Owner", type: "text" },
    { id: "targetDate", label: "Target", type: "date" },
    {
      id: "summary",
      label: "Summary",
      type: "text",
      help: "One or two lines on what this is and why now.",
    },
    {
      id: "requirements",
      label: "Requirements",
      type: "rows",
      fields: [
        {
          id: "requirement",
          label: "Requirement",
          type: "text",
          required: true,
        },
        {
          id: "priority",
          label: "Priority",
          type: "enum",
          options: [
            { value: "must", label: "Must", tone: "danger" },
            { value: "should", label: "Should", tone: "warning" },
            { value: "could", label: "Could", tone: "neutral" },
          ],
        },
        { id: "done", label: "Done", type: "boolean" },
      ],
    },
    {
      id: "openQuestions",
      label: "Open questions",
      type: "rows",
      fields: [
        { id: "question", label: "Question", type: "text", required: true },
        { id: "resolved", label: "Resolved", type: "boolean" },
        { id: "answer", label: "Answer", type: "text" },
      ],
    },
  ],
  theme: { typography: "system", measure: "reading", alignment: "start" },
  item: {
    type: "stack",
    gap: "md",
    children: [
      {
        type: "masthead",
        gap: "sm",
        children: [
          {
            type: "text",
            bind: "content.title",
            role: "title",
            fallback: "Untitled spec",
          },
          {
            type: "text",
            bind: "content.fields.summary",
            role: "subtitle",
            showWhen: "content.fields.summary",
          },
          {
            type: "badge",
            bind: "content.fields.specStatus",
            variant: "pill",
            showWhen: "content.fields.specStatus",
          },
          {
            type: "facts",
            variant: "strip",
            entries: [
              { bind: "content.fields.owner", label: "Owner" },
              {
                bind: "content.fields.targetDate",
                label: "Target",
                format: "date",
              },
            ],
          },
        ],
      },
      { type: "prose", bind: "content.body" },
      {
        type: "progress",
        variant: "bar",
        source: {
          checklistBind: "content.fields.requirements",
          doneBind: "row.done",
        },
        showWhen: "content.fields.requirements",
      },
      {
        type: "checklist",
        bind: "content.fields.requirements",
        doneBind: "row.done",
        labelBind: "row.requirement",
        meta: ["row.priority"],
        mode: "document",
        sortCheckedLast: false,
        rollup: true,
        showWhen: "content.fields.requirements",
      },
      {
        type: "callout",
        tone: "note",
        title: "Open questions",
        showWhen: "content.fields.openQuestions",
        children: [
          {
            type: "checklist",
            bind: "content.fields.openQuestions",
            doneBind: "row.resolved",
            labelBind: "row.question",
            meta: ["row.answer"],
            mode: "document",
            sortCheckedLast: true,
          },
        ],
      },
    ],
  },
  collection: {
    layout: "list",
    columns: 1,
    gap: "sm",
    sort: [{ field: "updatedAt", direction: "desc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled spec",
        },
        {
          type: "badge",
          bind: "content.fields.specStatus",
          variant: "pill",
          showWhen: "content.fields.specStatus",
        },
        {
          type: "facts",
          variant: "strip",
          entries: [
            { bind: "content.fields.owner" },
            {
              bind: "content.fields.targetDate",
              label: "Target",
              format: "date",
            },
          ],
        },
      ],
    },
  },
} as const;

const goals = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.goals",
  version: 1,
  name: "Goals",
  description: "An objective with measurable key results and an honest score.",
  fields: [
    {
      id: "period",
      label: "Period",
      type: "text",
      help: "For example 2026 Q3.",
    },
    {
      id: "goalStatus",
      label: "Status",
      type: "enum",
      options: [
        { value: "on-track", label: "On track", tone: "success", icon: "🟢" },
        { value: "at-risk", label: "At risk", tone: "warning", icon: "🟡" },
        { value: "off-track", label: "Off track", tone: "danger", icon: "🔴" },
        { value: "achieved", label: "Achieved", tone: "accent", icon: "🏆" },
      ],
    },
    { id: "owner", label: "Owner", type: "text" },
    {
      id: "score",
      label: "Score",
      type: "number",
      min: 0,
      max: 1,
      step: 0.05,
      format: "percent",
    },
    {
      id: "keyResults",
      label: "Key results",
      type: "rows",
      fields: [
        { id: "result", label: "Key result", type: "text", required: true },
        { id: "current", label: "Current", type: "number" },
        { id: "target", label: "Target", type: "number" },
        { id: "unit", label: "Unit", type: "text" },
      ],
    },
  ],
  theme: { typography: "system", measure: "reading", alignment: "start" },
  item: {
    type: "stack",
    gap: "md",
    children: [
      {
        type: "masthead",
        gap: "sm",
        children: [
          {
            type: "text",
            bind: "content.title",
            role: "title",
            fallback: "Untitled objective",
          },
          {
            type: "text",
            bind: "content.subtitle",
            role: "subtitle",
            showWhen: "content.subtitle",
          },
          {
            type: "badge",
            bind: "content.fields.goalStatus",
            variant: "pill",
            showWhen: "content.fields.goalStatus",
          },
          {
            type: "facts",
            variant: "strip",
            entries: [
              { bind: "content.fields.period", label: "Period" },
              { bind: "content.fields.owner", label: "Owner" },
            ],
          },
        ],
      },
      {
        type: "progress",
        variant: "ring",
        source: { bind: "content.fields.score" },
        showWhen: "content.fields.score",
      },
      { type: "prose", bind: "content.body", showWhen: "content.body" },
      {
        type: "rows",
        bind: "content.fields.keyResults",
        variant: "table",
        columns: [
          { bind: "row.result", label: "Key result" },
          { bind: "row.current", label: "Current" },
          { bind: "row.target", label: "Target" },
          { bind: "row.unit", label: "Unit" },
        ],
        showWhen: "content.fields.keyResults",
      },
    ],
  },
  collection: {
    layout: "cards",
    columns: 2,
    gap: "md",
    sort: [{ field: "updatedAt", direction: "desc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled objective",
        },
        {
          type: "badge",
          bind: "content.fields.goalStatus",
          variant: "pill",
          showWhen: "content.fields.goalStatus",
        },
        {
          type: "progress",
          variant: "bar",
          source: { bind: "content.fields.score" },
          showWhen: "content.fields.score",
        },
      ],
    },
  },
} as const;

const postmortem = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.postmortem",
  version: 1,
  name: "Postmortem",
  description:
    "An incident record with severity, timeline, root cause, and follow-ups.",
  fields: [
    {
      id: "incidentDate",
      label: "Incident date",
      type: "date",
      required: true,
    },
    {
      id: "severity",
      label: "Severity",
      type: "enum",
      options: [
        { value: "sev1", label: "Sev 1", tone: "danger", icon: "🔴" },
        { value: "sev2", label: "Sev 2", tone: "warning", icon: "🟠" },
        { value: "sev3", label: "Sev 3", tone: "info", icon: "🟡" },
      ],
    },
    {
      id: "durationMinutes",
      label: "Duration",
      type: "number",
      min: 0,
      format: "minutes",
    },
    {
      id: "impact",
      label: "Impact",
      type: "text",
      help: "Who felt this and how badly, in one line.",
    },
    {
      id: "timeline",
      label: "Timeline",
      type: "rows",
      fields: [
        { id: "time", label: "Time", type: "text", required: true },
        { id: "event", label: "What happened", type: "text", required: true },
      ],
    },
    { id: "rootCause", label: "Root cause", type: "richtext" },
    {
      id: "actionItems",
      label: "Follow-ups",
      type: "rows",
      fields: [
        { id: "item", label: "Follow-up", type: "text", required: true },
        { id: "done", label: "Done", type: "boolean" },
        { id: "owner", label: "Owner", type: "text" },
      ],
    },
  ],
  theme: { typography: "system", measure: "reading", alignment: "start" },
  item: {
    type: "stack",
    gap: "md",
    children: [
      {
        type: "masthead",
        gap: "sm",
        children: [
          {
            type: "text",
            bind: "content.title",
            role: "title",
            fallback: "Untitled incident",
          },
          {
            type: "badge",
            bind: "content.fields.severity",
            variant: "pill",
            showWhen: "content.fields.severity",
          },
          {
            type: "facts",
            variant: "strip",
            entries: [
              { bind: "content.fields.incidentDate", format: "date" },
              { bind: "content.fields.durationMinutes", label: "Duration" },
              { bind: "content.fields.impact", label: "Impact" },
            ],
          },
        ],
      },
      { type: "prose", bind: "content.body" },
      {
        type: "rows",
        bind: "content.fields.timeline",
        variant: "timeline",
        columns: [
          { bind: "row.time", label: "Time" },
          { bind: "row.event", label: "What happened" },
        ],
        showWhen: "content.fields.timeline",
      },
      {
        type: "callout",
        tone: "danger",
        title: "Root cause",
        showWhen: "content.fields.rootCause",
        children: [{ type: "prose", bind: "content.fields.rootCause" }],
      },
      {
        type: "checklist",
        bind: "content.fields.actionItems",
        doneBind: "row.done",
        labelBind: "row.item",
        meta: ["row.owner"],
        mode: "document",
        sortCheckedLast: true,
        rollup: true,
        showWhen: "content.fields.actionItems",
      },
    ],
  },
  collection: {
    layout: "list",
    columns: 1,
    gap: "sm",
    sort: [{ field: "content.fields.incidentDate", direction: "desc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled incident",
        },
        {
          type: "badge",
          bind: "content.fields.severity",
          variant: "pill",
          showWhen: "content.fields.severity",
        },
        {
          type: "facts",
          variant: "strip",
          entries: [{ bind: "content.fields.incidentDate", format: "date" }],
        },
        {
          type: "progress",
          variant: "fraction",
          source: {
            checklistBind: "content.fields.actionItems",
            doneBind: "row.done",
          },
          showWhen: "content.fields.actionItems",
        },
      ],
    },
  },
} as const;

const retro = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.retro",
  version: 1,
  name: "Retrospective",
  description:
    "A team look back at what went well, what could improve, and what happens next.",
  fields: [
    { id: "date", label: "Date", type: "date", required: true },
    { id: "team", label: "Team", type: "text" },
    {
      id: "wentWell",
      label: "What went well",
      type: "rows",
      fields: [{ id: "item", label: "Item", type: "text", required: true }],
    },
    {
      id: "couldImprove",
      label: "What could improve",
      type: "rows",
      fields: [{ id: "item", label: "Item", type: "text", required: true }],
    },
    {
      id: "actions",
      label: "Actions",
      type: "rows",
      fields: [
        { id: "item", label: "Action", type: "text", required: true },
        { id: "done", label: "Done", type: "boolean" },
        { id: "owner", label: "Owner", type: "text" },
      ],
    },
  ],
  theme: { typography: "system", measure: "reading", alignment: "start" },
  item: {
    type: "stack",
    gap: "md",
    children: [
      {
        type: "masthead",
        gap: "sm",
        children: [
          {
            type: "text",
            bind: "content.title",
            role: "title",
            fallback: "Untitled retro",
          },
          {
            type: "facts",
            variant: "strip",
            entries: [
              { bind: "content.fields.date", format: "date" },
              { bind: "content.fields.team", label: "Team" },
            ],
          },
        ],
      },
      { type: "prose", bind: "content.body", showWhen: "content.body" },
      {
        type: "callout",
        tone: "success",
        title: "What went well",
        showWhen: "content.fields.wentWell",
        children: [
          {
            type: "rows",
            bind: "content.fields.wentWell",
            variant: "table",
            columns: [{ bind: "row.item" }],
          },
        ],
      },
      {
        type: "callout",
        tone: "warning",
        title: "What could improve",
        showWhen: "content.fields.couldImprove",
        children: [
          {
            type: "rows",
            bind: "content.fields.couldImprove",
            variant: "table",
            columns: [{ bind: "row.item" }],
          },
        ],
      },
      {
        type: "checklist",
        bind: "content.fields.actions",
        doneBind: "row.done",
        labelBind: "row.item",
        meta: ["row.owner"],
        mode: "document",
        sortCheckedLast: true,
        rollup: true,
        showWhen: "content.fields.actions",
      },
    ],
  },
  collection: {
    layout: "timeline",
    columns: 1,
    gap: "sm",
    sort: [{ field: "content.fields.date", direction: "desc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "facts",
          variant: "strip",
          entries: [{ bind: "content.fields.date", format: "date" }],
        },
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled retro",
        },
        {
          type: "progress",
          variant: "fraction",
          source: {
            checklistBind: "content.fields.actions",
            doneBind: "row.done",
          },
          showWhen: "content.fields.actions",
        },
      ],
    },
  },
} as const;

const calendar = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.calendar",
  version: 1,
  name: "Editorial calendar",
  description:
    "A planned piece of writing with its status, channel, and publish date.",
  fields: [
    { id: "publishDate", label: "Publish date", type: "date" },
    {
      id: "pieceStatus",
      label: "Status",
      type: "enum",
      options: [
        { value: "idea", label: "Idea", tone: "neutral", icon: "💡" },
        { value: "drafting", label: "Drafting", tone: "info", icon: "✍️" },
        { value: "editing", label: "Editing", tone: "warning", icon: "🔍" },
        { value: "scheduled", label: "Scheduled", tone: "accent", icon: "📆" },
        { value: "published", label: "Published", tone: "success", icon: "✅" },
      ],
    },
    {
      id: "channel",
      label: "Channel",
      type: "enum",
      options: [
        { value: "blog", label: "Blog", tone: "info", icon: "📰" },
        {
          value: "newsletter",
          label: "Newsletter",
          tone: "accent",
          icon: "✉️",
        },
        { value: "social", label: "Social", tone: "neutral", icon: "📣" },
      ],
    },
    { id: "author", label: "Author", type: "text" },
    {
      id: "piece",
      label: "Finished piece",
      type: "reference",
      target: "document",
    },
  ],
  theme: {
    typography: "system",
    measure: "reading",
    alignment: "start",
    density: "compact",
  },
  item: {
    type: "stack",
    gap: "md",
    children: [
      {
        type: "masthead",
        gap: "sm",
        children: [
          {
            type: "text",
            bind: "content.title",
            role: "title",
            fallback: "Untitled piece",
          },
          {
            type: "text",
            bind: "content.subtitle",
            role: "subtitle",
            showWhen: "content.subtitle",
          },
          {
            type: "badge",
            bind: "content.fields.pieceStatus",
            variant: "pill",
            showWhen: "content.fields.pieceStatus",
          },
          {
            type: "facts",
            variant: "strip",
            entries: [
              {
                bind: "content.fields.publishDate",
                label: "Publish",
                format: "countdown",
              },
              { bind: "content.fields.author", label: "Author" },
              { bind: "content.fields.piece", label: "Piece" },
            ],
          },
          {
            type: "badge",
            bind: "content.fields.channel",
            variant: "pill",
            showWhen: "content.fields.channel",
          },
        ],
      },
      { type: "prose", bind: "content.body" },
    ],
  },
  collection: {
    layout: "calendar",
    columns: 1,
    gap: "sm",
    dateBy: "content.fields.publishDate",
    sort: [{ field: "content.fields.publishDate", direction: "asc" }],
    filters: [],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "facts",
          variant: "strip",
          entries: [{ bind: "content.fields.publishDate", format: "date" }],
        },
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled piece",
        },
        {
          type: "badge",
          bind: "content.fields.pieceStatus",
          variant: "pill",
          showWhen: "content.fields.pieceStatus",
        },
        {
          type: "badge",
          bind: "content.fields.channel",
          variant: "pill",
          showWhen: "content.fields.channel",
        },
      ],
    },
  },
} as const;

const newsletter = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.newsletter",
  version: 1,
  name: "Newsletter",
  description: "A numbered issue you send and publish.",
  fields: [
    { id: "issueNumber", label: "Issue", type: "number", min: 1, step: 1 },
    { id: "sentAt", label: "Sent", type: "date" },
    { id: "cover", label: "Cover", type: "image" },
    {
      id: "links",
      label: "Links",
      type: "rows",
      fields: [
        { id: "title", label: "Title", type: "text", required: true },
        { id: "url", label: "Link", type: "url", required: true },
        { id: "blurb", label: "Why it matters", type: "text" },
      ],
    },
  ],
  theme: { typography: "editorial", measure: "reading", alignment: "center" },
  item: {
    type: "stack",
    gap: "lg",
    children: [
      {
        type: "masthead",
        gap: "sm",
        children: [
          {
            type: "facts",
            variant: "strip",
            entries: [
              { bind: "content.fields.issueNumber", label: "Issue" },
              { bind: "content.fields.sentAt", format: "date" },
            ],
          },
          {
            type: "text",
            bind: "content.title",
            role: "title",
            fallback: "Untitled issue",
          },
          {
            type: "text",
            bind: "content.subtitle",
            role: "subtitle",
            showWhen: "content.subtitle",
          },
        ],
      },
      {
        type: "cover",
        bind: "content.fields.cover",
        alt: "content.title",
        height: "medium",
        showWhen: "content.fields.cover",
      },
      { type: "prose", bind: "content.body" },
      { type: "divider", showWhen: "content.fields.links" },
      {
        type: "rows",
        bind: "content.fields.links",
        variant: "tiles",
        columns: [
          { bind: "row.title", label: "Title" },
          { bind: "row.blurb", label: "Why it matters" },
          { bind: "row.url", label: "Link" },
        ],
        showWhen: "content.fields.links",
      },
    ],
  },
  collection: {
    layout: "timeline",
    columns: 1,
    gap: "sm",
    sort: [{ field: "content.fields.issueNumber", direction: "desc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled issue",
        },
        {
          type: "facts",
          variant: "strip",
          entries: [
            { bind: "content.fields.issueNumber", label: "Issue" },
            { bind: "content.fields.sentAt", format: "date" },
          ],
        },
      ],
    },
  },
} as const;

const now = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.now",
  version: 1,
  name: "Now page",
  description: "A public snapshot of what you are focused on right now.",
  fields: [
    { id: "location", label: "Location", type: "text" },
    { id: "lastUpdated", label: "Updated", type: "date" },
    {
      id: "currently",
      label: "Currently",
      type: "rows",
      fields: [
        {
          id: "area",
          label: "Area",
          type: "text",
          required: true,
          help: "For example Reading, Building, Listening.",
        },
        { id: "detail", label: "Detail", type: "text", required: true },
      ],
    },
  ],
  theme: { typography: "editorial", measure: "narrow", alignment: "start" },
  item: {
    type: "stack",
    gap: "md",
    children: [
      {
        type: "masthead",
        gap: "sm",
        children: [
          {
            type: "text",
            bind: "content.title",
            role: "title",
            fallback: "Now",
          },
          {
            type: "text",
            bind: "content.subtitle",
            role: "subtitle",
            showWhen: "content.subtitle",
          },
          {
            type: "facts",
            variant: "strip",
            entries: [
              { bind: "content.fields.location" },
              {
                bind: "content.fields.lastUpdated",
                label: "Updated",
                format: "relative",
              },
            ],
          },
        ],
      },
      { type: "prose", bind: "content.body" },
      {
        type: "rows",
        bind: "content.fields.currently",
        variant: "table",
        columns: [{ bind: "row.area" }, { bind: "row.detail" }],
        showWhen: "content.fields.currently",
      },
    ],
  },
  collection: {
    layout: "single",
    columns: 1,
    gap: "md",
    sort: [{ field: "updatedAt", direction: "desc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Now",
        },
        {
          type: "facts",
          variant: "strip",
          entries: [
            {
              bind: "content.fields.lastUpdated",
              label: "Updated",
              format: "relative",
            },
          ],
        },
      ],
    },
  },
} as const;

const prompts = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.prompts",
  version: 1,
  name: "Prompt library",
  description:
    "A reusable prompt with its variables, model notes, and provenance.",
  fields: [
    {
      id: "model",
      label: "Model",
      type: "text",
      help: "The model or client this works best with.",
    },
    {
      id: "useCase",
      label: "Use case",
      type: "enum",
      options: [
        { value: "writing", label: "Writing", tone: "info", icon: "✍️" },
        { value: "coding", label: "Coding", tone: "accent", icon: "💻" },
        { value: "research", label: "Research", tone: "neutral", icon: "🔍" },
        { value: "images", label: "Images", tone: "warning", icon: "🎨" },
      ],
    },
    { id: "proven", label: "Battle tested", type: "boolean" },
    { id: "sourceUrl", label: "Source", type: "url" },
    {
      id: "variables",
      label: "Variables",
      type: "rows",
      fields: [
        { id: "name", label: "Variable", type: "text", required: true },
        { id: "purpose", label: "What to put there", type: "text" },
      ],
    },
  ],
  theme: { typography: "mono", measure: "reading", alignment: "start" },
  item: {
    type: "stack",
    gap: "md",
    children: [
      {
        type: "masthead",
        gap: "sm",
        children: [
          {
            type: "text",
            bind: "content.title",
            role: "title",
            fallback: "Untitled prompt",
          },
          {
            type: "text",
            bind: "content.subtitle",
            role: "subtitle",
            showWhen: "content.subtitle",
          },
          {
            type: "stack",
            direction: "horizontal",
            gap: "sm",
            align: "center",
            children: [
              {
                type: "badge",
                bind: "content.fields.useCase",
                variant: "pill",
                showWhen: "content.fields.useCase",
              },
              {
                type: "badge",
                bind: "content.fields.proven",
                variant: "glyph",
                showWhen: "content.fields.proven",
              },
            ],
          },
          {
            type: "facts",
            variant: "strip",
            entries: [
              { bind: "content.fields.model", label: "Model" },
              { bind: "content.fields.sourceUrl", label: "Source" },
            ],
          },
        ],
      },
      { type: "prose", bind: "content.body" },
      {
        type: "rows",
        bind: "content.fields.variables",
        variant: "table",
        columns: [
          { bind: "row.name", label: "Variable" },
          { bind: "row.purpose", label: "What to put there" },
        ],
        showWhen: "content.fields.variables",
      },
    ],
  },
  collection: {
    layout: "index",
    columns: 1,
    gap: "sm",
    sort: [{ field: "updatedAt", direction: "desc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled prompt",
        },
        {
          type: "badge",
          bind: "content.fields.useCase",
          variant: "pill",
          showWhen: "content.fields.useCase",
        },
        {
          type: "text",
          bind: "content.fields.model",
          role: "meta",
          showWhen: "content.fields.model",
        },
      ],
    },
  },
} as const;

const poll = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.poll",
  version: 1,
  name: "Poll",
  description: "One question, reader voting, live results.",
  fields: [
    {
      id: "options",
      label: "Options",
      type: "rows",
      fields: [{ id: "option", label: "Option", type: "text", required: true }],
    },
    { id: "closesAt", label: "Closes", type: "date" },
  ],
  theme: { typography: "system", measure: "narrow", alignment: "center" },
  item: {
    type: "stack",
    gap: "lg",
    children: [
      {
        type: "masthead",
        gap: "sm",
        children: [
          {
            type: "text",
            bind: "content.title",
            role: "title",
            fallback: "Untitled poll",
          },
          {
            type: "text",
            bind: "content.subtitle",
            role: "subtitle",
            showWhen: "content.subtitle",
          },
          {
            type: "facts",
            variant: "strip",
            entries: [
              {
                bind: "content.fields.closesAt",
                label: "Closes",
                format: "countdown",
              },
            ],
          },
        ],
      },
      { type: "prose", bind: "content.body", showWhen: "content.body" },
      {
        type: "poll",
        bind: "content.fields.options",
        labelBind: "row.option",
        multiple: false,
        closesBind: "content.fields.closesAt",
      },
    ],
  },
  collection: {
    layout: "list",
    columns: 1,
    gap: "sm",
    sort: [{ field: "updatedAt", direction: "desc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled poll",
        },
        {
          type: "facts",
          variant: "strip",
          entries: [
            {
              bind: "content.fields.closesAt",
              label: "Closes",
              format: "countdown",
            },
          ],
        },
      ],
    },
  },
} as const;

const rsvp = {
  schemaVersion: 1,
  engineVersion: 1,
  id: "texttext.rsvp",
  version: 1,
  name: "Event invite",
  description: "When, where, and a one-tap RSVP that closes at showtime.",
  fields: [
    { id: "when", label: "When", type: "date", required: true },
    { id: "where", label: "Where", type: "text" },
    { id: "host", label: "Host", type: "text" },
    {
      id: "options",
      label: "RSVP choices",
      type: "rows",
      fields: [{ id: "option", label: "Choice", type: "text", required: true }],
    },
  ],
  theme: { typography: "editorial", measure: "narrow", alignment: "center" },
  item: {
    type: "stack",
    gap: "lg",
    children: [
      {
        type: "masthead",
        gap: "sm",
        children: [
          {
            type: "text",
            bind: "content.title",
            role: "title",
            fallback: "You are invited",
          },
          {
            type: "text",
            bind: "content.subtitle",
            role: "subtitle",
            showWhen: "content.subtitle",
          },
          {
            type: "facts",
            variant: "strip",
            entries: [
              { bind: "content.fields.when", label: "When", format: "date" },
              { bind: "content.fields.where", label: "Where" },
              { bind: "content.fields.host", label: "Host" },
            ],
          },
          {
            type: "facts",
            variant: "strip",
            entries: [
              {
                bind: "content.fields.when",
                label: "RSVP closes",
                format: "countdown",
              },
            ],
          },
        ],
      },
      { type: "prose", bind: "content.body", showWhen: "content.body" },
      {
        type: "poll",
        bind: "content.fields.options",
        labelBind: "row.option",
        multiple: false,
        closesBind: "content.fields.when",
      },
    ],
  },
  collection: {
    layout: "list",
    columns: 1,
    gap: "sm",
    sort: [{ field: "content.fields.when", direction: "asc" }],
    item: {
      type: "stack",
      gap: "xs",
      children: [
        {
          type: "text",
          bind: "content.title",
          role: "heading",
          fallback: "Untitled event",
        },
        {
          type: "facts",
          variant: "strip",
          entries: [
            { bind: "content.fields.when", label: "When", format: "date" },
            { bind: "content.fields.where", label: "Where" },
          ],
        },
      ],
    },
  },
} as const;

const activeIds = new Set(["texttext.article", "texttext.note", "texttext.bookmark", "texttext.gallery", "texttext.talk", "texttext.todo"]);
const activeDefinitions = GENERATED_BUILTIN_TEMPLATES.filter(template => activeIds.has(template.id)).map(validateTemplateDefinition);
const retiredGeneratedDefinitions = GENERATED_BUILTIN_TEMPLATES.filter(template => !activeIds.has(template.id)).map(validateTemplateDefinition);

const legacyDefinitions = [
  // Retired from the catalogue at the owner's request. Kept resolvable so any
  // document already pinned to it still renders; retiring a look must never
  // break a document that chose it.
  newsletter,
  meeting,
  journal,
  bookshelf,
  watchlist,
  recipe,
  changelog,
  decision,
  wiki,
  spec,
  goals,
  postmortem,
  retro,
  calendar,
  now,
  prompts,
  poll,
  rsvp,
].map((entry) => validateTemplateDefinition(entry));

/**
 * Which built-in's presentation a look wears.
 *
 * Presentation was keyed to the template ID, so a look got the built-in
 * treatment only if it WAS that built-in. Timeline is Article with a different
 * id - the same document field for field, listed as a timeline instead of as
 * cards - and because the renderer emits the id, none of Article's styling
 * matched it. Anyone choosing Timeline got a visibly poorer Article.
 *
 * Derived here rather than stored on the definition. A `TemplateDefinition` is
 * strict and travels inside sync envelopes and exported bundles that older
 * builds still read, so adding a field to it would change a format that has
 * already left this machine, to fix something the renderer can answer on its
 * own.
 *
 * Only the families that are actually shared. A look with no entry keys on
 * nothing and gets the shared base treatment, which is what it got before.
 */
const STYLE_FAMILIES: Record<string, string> = {
  "texttext.article": "article",
  "texttext.timeline": "article",
};

export function styleFamilyFor(templateId: string): string | undefined {
  return STYLE_FAMILIES[templateId];
}

export type TemplateExperience = "article" | "note" | "bookmark" | "gallery";

export function templateExperience(template: Pick<TemplateDefinition, "id" | "experience">): TemplateExperience | null {
  if (template.experience) return template.experience;
  const builtIn = /^texttext\.(article|note|bookmark|gallery)$/.exec(template.id);
  return builtIn ? builtIn[1] as TemplateExperience : null;
}

export const BUILTIN_TEMPLATES: readonly TemplateDefinition[] =
  Object.freeze(activeDefinitions);

/**
 * Active plus retired. A document pinned to a retired look still renders, so
 * anything that checks rendering has to walk these, not just the catalogue.
 */
export const ALL_RESOLVABLE_TEMPLATES: readonly TemplateDefinition[] =
  Object.freeze([...activeDefinitions, ...retiredGeneratedDefinitions, ...legacyDefinitions, ...HISTORICAL_BUILTIN_TEMPLATES]);

const templatesByKey = new Map(
  [...activeDefinitions, ...retiredGeneratedDefinitions, ...legacyDefinitions, ...HISTORICAL_BUILTIN_TEMPLATES].map((template) => [
    `${template.id}@${template.version}`,
    template,
  ]),
);

export function templateKey(id: string, version: number): string {
  return `${id}@${version}`;
}

export function getBuiltinTemplate(
  id: string,
  version?: number,
): TemplateDefinition | null {
  return version === undefined ? activeDefinitions.find(template => template.id === id) ?? [...templatesByKey.values()].find(template => template.id === id) ?? null : templatesByKey.get(templateKey(id, version)) ?? null;
}

function sameTemplateValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameTemplateValue(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(right)) return false;
  const leftValues = left as Record<string, unknown>;
  const rightValues = right as Record<string, unknown>;
  const keys = Object.keys(leftValues);
  return keys.length === Object.keys(rightValues).length &&
    keys.every((key) => Object.hasOwn(rightValues, key) && sameTemplateValue(leftValues[key], rightValues[key]));
}

const styleTemplateIds = new WeakMap<TemplateDefinition, string>();

/** Built-in CSS belongs to the built-in definition, not every imported look that reuses its id. */
export function styleTemplateIdFor(template: TemplateDefinition): string {
  const cached = styleTemplateIds.get(template);
  if (cached) return cached;
  const builtin = getBuiltinTemplate(template.id, template.version);
  const styleId = builtin && !sameTemplateValue(template, builtin)
    ? `custom:${template.id}`
    : template.id;
  styleTemplateIds.set(template, styleId);
  return styleId;
}

export function requireBuiltinTemplate(
  id: string,
  version?: number,
): TemplateDefinition {
  const template = getBuiltinTemplate(id, version);
  if (!template) throw new Error(`Unknown built-in template ${id}@${version}`);
  return template;
}

export const TEMPLATE_CATEGORIES = [
  "Text",
  "Plan",
  "Collect",
  "Publish",
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** Gallery grouping: every active built-in template appears exactly once. */
export const TEMPLATE_CATALOG: readonly {
  id: string;
  category: TemplateCategory;
}[] = Object.freeze([
  { id: "texttext.article", category: "Text" },
  { id: "texttext.note", category: "Text" },
  { id: "texttext.todo", category: "Plan" },
  { id: "texttext.bookmark", category: "Collect" },
  { id: "texttext.gallery", category: "Collect" },
  { id: "texttext.talk", category: "Publish" },
]);
