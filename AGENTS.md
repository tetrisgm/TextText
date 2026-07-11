<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI approach (binding)

Full architecture: docs/ai-sidebar-architecture.md. The short contract every
agent working here follows:

- **The provider ladder, in order.** (1) Apple on-device foundation models
  are the DEFAULT AI layer on Apple devices (the Mac app's `nativeAI` bridge,
  `mac/Sources/Write/NativeAI.swift` + `src/lib/ai/native.ts`): free,
  private, offline; it owns the instant utility ops (title, tags, excerpt,
  summarize, rewrite, categorize, OCR). (2) Bring-your-own cloud keys
  (workspace settings) augment it for long-context, tool-calling, and web
  research. (3) External agents connect via MCP (`/api/mcp`,
  click-to-approve OAuth). Never send content to a cloud model when the
  local layer can do the job.
- **One command surface, three consumers.** The UI, the in-app assistant,
  and the MCP server call the same workspace commands. The app never
  consumes its own MCP server over the network.
- **Release gates.** `python3 scripts/test-oauth-mcp-loop.py` must pass for
  any change touching OAuth, the well-known documents, or the MCP handler.
  Never use `Response.redirect()` in the OAuth approve route (immutable
  headers 500 the approval).
- **Privacy invariants live below the tool layer**: notes and bookmarks stay
  unlisted forever, every mutation writes `action_audit`, and
  `src/lib/store.ts` remains the only content access point, no matter which
  AI is calling.
- **Reusable versions** of this surface live in `~/dev/stack` (`mcp-kit`,
  `mac-kit/templates/native-ai`). Improvements flow product to kit; port
  hardening back and note it in the kit README.
