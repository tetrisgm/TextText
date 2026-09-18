import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Home is a port of a particular news app's design, and what makes it
 * that app rather than a generic reader is a handful of proportions that were
 * measured off its screenshots rather than chosen. They are easy to lose to a
 * well meant tidy-up, so they are written down here with their measurements.
 *
 * Source: iPhone captures at 3x on a 393pt screen. Cap heights were measured
 * off the pixels and divided by SF Pro's cap ratio (0.7046) to recover the
 * font size, which is why these numbers have decimals.
 *
 *   tab strip      cap 37px -> 52.5px -> 17.5pt
 *   headline       cap 37px -> 52.5px -> 17.5pt, line height 67px -> 1.28
 *   section title  cap 58px -> 82.3px -> 27.4pt
 *   publisher      cap 32px -> 45.4px -> 15.1pt
 *   meta           asc 30px -> 40px   -> 13.3pt
 */

const dir = join(import.meta.dirname, "..");
const css = readFileSync(join(dir, "Home.module.css"), "utf8");
const tsx = readFileSync(join(dir, "HomeNews.tsx"), "utf8");

/** The `font:` shorthand's size in rem, for the first rule matching a selector. */
function fontRem(selector: string): number {
  const block = new RegExp(`\\n${selector.replace(/[.[\]="*]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`).exec(css);
  expect(block, `no rule for ${selector}`).not.toBeNull();
  const declared = /font(?:-size)?:[^;]*?([\d.]+)rem/.exec(block![1]);
  expect(declared, `no font size in ${selector}`).not.toBeNull();
  return Number(declared![1]);
}

describe("the proportions the design is made of", () => {
  const headline = fontRem(".headline");
  const tab = fontRem(".tab");

  it("sets the channel strip at the same size as a headline", () => {
    // 52.5px against 52.5px in the original: the strip is not a caption over
    // the news, it is the same voice as the news. This one ratio is most of
    // what makes the surface recognisable.
    expect(tab).toBe(headline);
  });

  it("makes a section title about half again a headline", () => {
    // 27.4pt against 17.5pt is 1.57. Anything under about 1.4 and the strip
    // of cards stops reading as a different kind of thing from the list.
    const ratio = fontRem(".sectionTitle") / headline;
    expect(ratio).toBeGreaterThanOrEqual(1.4);
    expect(ratio).toBeLessThanOrEqual(1.7);
  });

  it("keeps the publisher clearly under the headline and clearly over the meta", () => {
    // 15.1/17.5 = 0.86 in the original, ported a little quieter because a
    // desktop column shows twice as many rows at once.
    const publisher = fontRem(".eyebrow") / headline;
    expect(publisher).toBeGreaterThanOrEqual(0.7);
    expect(publisher).toBeLessThan(1);
  });

  it("gives a row about nine tenths of a headline in air, top and bottom", () => {
    const padding = /\n\.unit\s*\{[^}]*padding:\s*([\d.]+)rem/.exec(css);
    expect(padding).not.toBeNull();
    const ratio = Number(padding![1]) / headline;
    expect(ratio).toBeGreaterThanOrEqual(0.75);
    expect(ratio).toBeLessThanOrEqual(1.1);
  });

  it("keeps the thumbnail a share of the column, not a fixed square", () => {
    // Measured against the reference: a 68pt square on a 358pt column, which
    // is 0.19 of it. A fixed rem was right on a desktop column and half again
    // too large at phone width, where the column shrinks and the thumbnail
    // did not. npm run home:design-compare is what caught it and what reads
    // 0.19 against 0.19 now.
    const thumb = /\n\.thumb\s*\{([^}]*)\}/.exec(css);
    expect(thumb).not.toBeNull();
    expect(thumb![1], "the thumbnail has to follow the column").toContain("cqi");
    const share = /([\d.]+)cqi/.exec(thumb![1]);
    expect(share).not.toBeNull();
    expect(Number(share![1])).toBeGreaterThanOrEqual(17);
    expect(Number(share![1])).toBeLessThanOrEqual(21);
    // Square, and the same rule on both axes.
    expect(thumb![1].match(/cqi/g)?.length).toBe(2);
  });

  it("rules the list with hairlines and gives the rows no other chrome", () => {
    expect(css).toContain("border-bottom: 1px solid var(--news-line)");
    // No card: a row is separated by a line, never boxed.
    expect(/\n\.unit\s*\{[^}]*box-shadow:\s*(?!inset)/.test(css)).toBe(false);
    expect(/\n\.unit\s*\{[^}]*border-radius/.test(css)).toBe(false);
  });
});

describe("the strip", () => {
  it("is the only one: there is no second row of modes beside it", () => {
    expect(css).not.toContain("\n.modes {");
    expect(tsx).not.toContain("styles.modes");
    // One nav, and "For You" is the first tab inside it.
    expect(tsx).toContain("aria-label=\"Channels\"");
    const nav = tsx.slice(tsx.indexOf("<nav className={styles.strip}"), tsx.indexOf("</nav>"));
    expect(nav).not.toBe("");
    expect(nav.indexOf("For You")).toBeGreaterThan(-1);
    expect(nav.indexOf("For You")).toBeLessThan(nav.indexOf("data?.topics"));
  });

  it("marks the chosen tab by weight and ink, never by a pill or an underline", () => {
    const active = /\n\.tab\[aria-current="true"\]\s*\{([^}]*)\}/.exec(css);
    expect(active).not.toBeNull();
    expect(active![1]).toContain("var(--news-ink)");
    expect(active![1]).not.toContain("background");
    expect(active![1]).not.toContain("border-bottom");
    expect(active![1]).not.toContain("text-decoration");
  });

  it("puts everything that is not a subject behind the button at its end", () => {
    expect(tsx).toContain("styles.stripMore");
    expect(tsx).toContain("Newest first");
    expect(tsx).toContain("Manage sources");
  });
});

describe("the list", () => {
  it("never opens on a photograph", () => {
    // The original's first hero is the third item; two compact rows come
    // first. `previous = -1` with a gap of 3 is what produces that.
    expect(tsx).toContain("let previous = -1;");
    expect(tsx).toMatch(/const HERO_GAP = 3;/);
  });

  it("carries no excerpts under a headline", () => {
    // The original's feed rows are publisher, headline, one grey line. A
    // Summary's own written line is the one exception, and it is labelled.
    expect(tsx).not.toContain("usableExcerpt");
    expect(tsx).toContain("styles.line");
  });

  it("takes its Headlines from the server rather than from the visible page", () => {
    expect(tsx).toContain("data?.headlines");
  });

  it("dims what you asked less of, where it is, instead of pulling it out", () => {
    // The original fades a hidden publisher's card to four tenths in place
    // and leaves it in the scroll, so the list never moves under a reader.
    expect(tsx).toContain('data-dimmed=');
    expect(css).toContain('.unit[data-dimmed="true"]');
    expect(/\n\.unit\[data-dimmed="true"\]\s*\{[^}]*opacity:\s*0\.4/.test(css)).toBe(true);
    // Nothing re-ranks the page under the cursor any more.
    expect(tsx).not.toContain("removeUnit");
  });
});

describe("the strip stays", () => {
  it("docks under the workspace action bar instead of scrolling away", () => {
    const strip = /\n\.strip\s*\{([^}]*)\}/.exec(css);
    expect(strip).not.toBeNull();
    expect(strip![1]).toContain("position: sticky");
    // Not 0: the action bar is sticky above it, and at 0 the strip docks
    // behind the bar and is never seen again.
    expect(strip![1]).toContain("--workspace-action-bar-height");
    expect(strip![1]).toContain("background:");
  });

  it("can be walked from the keyboard", () => {
    expect(tsx).toContain('case "[":');
    expect(tsx).toContain('case "]":');
  });
});
