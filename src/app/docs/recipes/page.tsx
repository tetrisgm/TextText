import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PromptCopyButton } from "@/components/docs/PromptCopyButton";

export const metadata: Metadata = {
  title: "TextText writing recipes",
  description:
    "Six exact prompts for useful, visible agentic writing workflows.",
};

const recipes = [
  {
    title: "Draft from notes",
    prerequisite:
      "Open the notes folder or the source notes, and connect an agent.",
    prompt:
      "Read the notes in this folder. Create a new article that preserves the concrete facts, groups related ideas, and marks any unanswered questions. Do not publish it.",
    success:
      "A new article appears with the source ideas organized into a readable draft.",
    recovery:
      "Open the new article to review it. Move the draft to Trash if you do not want to keep it.",
  },
  {
    title: "Rewrite a selection",
    prerequisite:
      "Use the in-app assistant, open a document, and select only the passage you want to change.",
    prompt:
      "Rewrite the selected text for clarity and rhythm. Preserve its meaning, facts, links, and point of view. Change nothing outside the selection.",
    success:
      "The proposal names the selected passage and previews the replacement before it is applied.",
    recovery:
      "Choose Undo beside the applied proposal to restore the original selection.",
  },
  {
    title: "Find related work",
    prerequisite: "Open the document whose subject should guide the search.",
    prompt:
      "Find the TextText items most closely related to this document. Return a short list with one sentence explaining each connection. Do not change any documents.",
    success:
      "The response names specific workspace items and explains why each one is relevant.",
    recovery:
      "No document changes are made. Narrow the topic or folder and ask again if the list is too broad.",
  },
  {
    title: "Capture a conversation",
    prerequisite: "Use a connected AI app with a conversation worth keeping.",
    prompt:
      "Save this conversation to TextText as a note. Use a clear title, keep the useful decisions and context, and include the source conversation link when available.",
    success:
      "A new note appears in TextText with a readable title and the useful conversation context.",
    recovery:
      "Move the captured note to Trash, or edit it directly if only part of the capture is wrong.",
  },
  {
    title: "Publish and collaborate",
    prerequisite:
      "Use the standalone native assistant or hosted MCP, open a finished article, and know who should receive access.",
    prompt:
      "Prepare this article for publication, then ask for confirmation before publishing it. After it is live, invite editor@example.com as an editor and report the public link.",
    success:
      "The agent asks before the guarded actions, then shows the public link and collaborator after confirmation.",
    recovery:
      "Unpublish the article or remove the collaborator from Share settings.",
  },
  {
    title: "Update a project changelog",
    prerequisite:
      "Open the project record or tell the agent its exact TextText path.",
    prompt:
      "Update this project's TextText changelog with the work completed today. Add one concise user-facing entry, do not duplicate an existing entry, and keep the previous history intact.",
    success:
      "The project record gains exactly one new entry that describes the completed outcome.",
    recovery:
      "Edit the entry directly, or ask the agent to remove the duplicate and read back the final changelog.",
  },
] as const;

export default function WritingRecipesPage() {
  return (
    <div className="connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Writing recipes</p>
        <h1 className="connect-title">Start with a visible result</h1>
        <p className="connect-lede">
          Each recipe names the context, the exact request, what success looks
          like, and how to recover. The screenshots use the in-app assistant,
          where the context chip names its scope. The rewrite example uses the
          selection quick action, so that result has proposal, Apply, and Undo
          controls. An ordinary freeform request may update the document
          directly. In the standalone Mac edition, the local Claude or Codex
          plugin can run the same document recipes. Name the exact TextText path
          in your request, read the updated document, and ask for a smaller
          correction if needed.
        </p>
        <div className="docs-recipes">
          {recipes.map((recipe, index) => (
            <article className="docs-recipe" key={recipe.title}>
              <p className="docs-recipe-number">
                {String(index + 1).padStart(2, "0")}
              </p>
              <div>
                <h2>{recipe.title}</h2>
                <dl>
                  <div>
                    <dt>Before you start</dt>
                    <dd>{recipe.prerequisite}</dd>
                  </div>
                  <div>
                    <dt>Ask</dt>
                    <dd className="docs-recipe-prompt">
                      <span>{recipe.prompt}</span>
                      <PromptCopyButton prompt={recipe.prompt} />
                    </dd>
                  </div>
                  <div>
                    <dt>Success</dt>
                    <dd>{recipe.success}</dd>
                  </div>
                  <div>
                    <dt>Undo or recover</dt>
                    <dd>{recipe.recovery}</dd>
                  </div>
                </dl>
                {index === 0 ? (
                  <figure className="docs-recipe-proof">
                    <div className="docs-recipe-proof-pair">
                      <Image
                        src="/docs/agentic-writing/folder-to-draft.jpg"
                        alt="TextText Notes folder beside Claude after a request to draft an article in Blog"
                        width={1280}
                        height={720}
                      />
                      <Image
                        src="/docs/agentic-writing/folder-to-draft-result.jpg"
                        alt="TextText Blog showing the newly created article What makes quiet tools work"
                        width={1280}
                        height={720}
                      />
                    </div>
                    <figcaption>
                      Left: the source folder stays visible while the assistant
                      completes the request. Right: the finished result is a
                      real, private draft in Blog.
                    </figcaption>
                  </figure>
                ) : null}
                {index === 1 ? (
                  <figure className="docs-recipe-proof">
                    <div className="docs-recipe-proof-pair">
                      <Image
                        src="/docs/agentic-writing/rewrite-proposal.jpg"
                        alt="TextText rewrite preview comparing the selected original sentence with a clearer replacement before Apply"
                        width={1280}
                        height={720}
                      />
                      <Image
                        src="/docs/agentic-writing/rewrite-undo.jpg"
                        alt="TextText after applying the clearer sentence, with Undo still available beside the proposal"
                        width={1280}
                        height={720}
                      />
                    </div>
                    <figcaption>
                      Review the exact replacement, apply it, and keep Undo
                      within reach.
                    </figcaption>
                  </figure>
                ) : null}
              </div>
            </article>
          ))}
        </div>
        <section className="connect-section">
          <h2 className="connect-section-title">Keep the request small</h2>
          <p>
            Start with one document and one outcome. Review the visible result,
            then continue. For setup, use the{" "}
            <Link href="/docs/ai">AI connection guide</Link>. For exact tool
            behavior, use the <Link href="/docs/mcp">MCP reference</Link>.
          </p>
        </section>
      </main>
    </div>
  );
}
