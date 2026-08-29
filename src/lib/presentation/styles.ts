export const DOCUMENT_ENGINE_CSS = String.raw`
.tt-document{--tt-accent:#0071e3;--tt-gap-none:0;--tt-gap-xs:.35rem;--tt-gap-sm:.75rem;--tt-gap-md:1.25rem;--tt-gap-lg:2rem;--tt-gap-xl:3.5rem;--tt-measure:46rem;color:var(--ink,#1d1d1f);background:var(--paper,#fff);min-height:100%;padding-bottom:5rem;font-family:var(--tt-font,-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif)}
.tt-document[data-typography="editorial"]{--tt-font:Iowan Old Style,Palatino Linotype,Book Antiqua,Palatino,serif}
.tt-document[data-typography="mono"]{--tt-font:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
.tt-document[data-surface="paper"]{--paper:#fffdf8;--ink:#201f1c;--muted:#6d6a62}.tt-document[data-surface="soft"]{--paper:#f5f5f7}.tt-document[data-surface="ink"]{--paper:#1d1d1f;--ink:#f5f5f7;--muted:#a1a1a6}
/* Every look gets a page to sit on. Each built-in declares its own padding in
   the sections below, so this was never missed - but a look an agent authors
   has no such section, and started at y=0 with its title running under the
   app's toolbar. A default here is what makes an authored look land as a page
   rather than as content pressed against the chrome. Built-ins still win: they
   set the same property with a heavier per-template selector. */
.tt-document:not(.tt-collection-item):not([data-preview])>.tt-stack{padding:clamp(2rem,5vw,3.5rem) 0 5rem}
.tt-document[data-measure="narrow"]{--tt-measure:36rem}.tt-document[data-measure="wide"]{--tt-measure:64rem}.tt-document[data-measure="full"]{--tt-measure:none}
.tt-document[data-density="compact"]{--tt-gap-sm:.5rem;--tt-gap-md:.85rem;--tt-gap-lg:1.35rem;--tt-gap-xl:2rem}.tt-document[data-density="spacious"]{--tt-gap-sm:1rem;--tt-gap-md:1.75rem;--tt-gap-lg:3rem;--tt-gap-xl:5rem}
.tt-stack,.tt-group,.tt-masthead{display:flex;box-sizing:border-box}.tt-stack[data-direction="vertical"],.tt-group,.tt-masthead{flex-direction:column}.tt-stack[data-direction="horizontal"]{flex-direction:row}.tt-stack,.tt-group{align-items:stretch}.tt-masthead{width:min(var(--tt-measure),calc(100% - 2rem));margin-inline:auto;text-align:center;align-items:center}
.tt-gap-none{gap:var(--tt-gap-none)}.tt-gap-xs{gap:var(--tt-gap-xs)}.tt-gap-sm{gap:var(--tt-gap-sm)}.tt-gap-md{gap:var(--tt-gap-md)}.tt-gap-lg{gap:var(--tt-gap-lg)}.tt-gap-xl{gap:var(--tt-gap-xl)}
.tt-align-start{align-items:flex-start}.tt-align-center{align-items:center}.tt-align-end{align-items:flex-end}.tt-align-stretch{align-items:stretch}
.tt-text{margin:0;overflow-wrap:anywhere}.tt-text-eyebrow,.tt-text-meta{font-size:.75rem;font-weight:600;color:color-mix(in srgb,var(--tt-accent) 60%,var(--ink,#1d1d1f));text-transform:uppercase}
/* A title is the name of a document, not a billboard. Measured against the
   things these looks stand next to: Notion 40px, Apple Notes 34px, Medium
   42px, Substack 44px, a YouTube title 20px. Every look here used to render
   between 1.6x and 2.1x its reference, which is most of why they all read as
   one page in different fonts. Tracking tightens as the size grows. */
.tt-text-title{font-size:clamp(1.75rem,2.8vw,2.25rem);line-height:1.12;font-weight:700;letter-spacing:-.019em}.tt-text-subtitle{font-size:clamp(1.1rem,2.2vw,1.55rem);line-height:1.35;color:var(--muted,#6e6e73)}.tt-text-heading{font-size:1.45rem;line-height:1.15;font-weight:700}.tt-text-body{font-size:1rem;line-height:1.6}.tt-text-caption,.tt-metadata{font-size:.85rem;line-height:1.45;color:var(--muted,#6e6e73)}
/* A page icon. Large, and it sits half over the cover directly above it when
   a look pairs the two, which is the arrangement the reference uses. */
.tt-text-icon{width:min(var(--tt-measure),calc(100% - 2rem));margin-inline:auto;font-size:4rem;line-height:1;letter-spacing:0}
/* The icon overlaps the cover above it whether it sits directly after it or
   leads the masthead that follows, because a look expresses that block either
   way and the arrangement should not depend on which. */
.tt-cover+.tt-text-icon,.tt-image+.tt-text-icon,
.tt-cover+.tt-masthead>.tt-text-icon:first-child,
.tt-image+.tt-masthead>.tt-text-icon:first-child{position:relative;z-index:1;margin-top:-2.1rem}
.tt-collection-item .tt-text-icon{width:auto;margin-inline:0;font-size:1.5rem}
.tt-document[data-title-scale="compact"] .tt-text-title{font-size:clamp(1.3rem,1.75vw,1.5rem);line-height:1.25;letter-spacing:-.011em}.tt-document[data-title-scale="large"] .tt-text-title{font-size:clamp(2rem,3.45vw,2.75rem);line-height:1.08;letter-spacing:-.023em}
/* Body scale. A reading-first look sets larger, looser text - the thing that
   makes a long piece feel like something to sit with rather than something to
   scan. Applies to the prose and to body-role text so a look moves together. */
.tt-document[data-body-scale="compact"] .tt-prose,.tt-document[data-body-scale="compact"] .tt-text-body{font-size:.95rem;line-height:1.55}
.tt-document[data-body-scale="relaxed"] .tt-prose,.tt-document[data-body-scale="relaxed"] .tt-text-body{font-size:1.3rem;line-height:1.68}
.tt-document[data-alignment="start"] .tt-masthead{text-align:left;align-items:flex-start}.tt-document[data-alignment="start"] .tt-byline,.tt-document[data-alignment="start"] .tt-metadata{justify-content:flex-start}
/* A look that asks for start alignment means the whole document, not only the
   parts that happen to sit in a masthead. Note asks for start alignment and
   puts its title straight in the stack, so the rule above never reached it. */
.tt-document[data-alignment="start"]>.tt-stack>.tt-text{text-align:left}
/* The paper is the page, not a panel. A min-height of 100% resolves against a
   parent with no definite height, so a short document painted its paper down
   to the last line and let the app's own background show underneath. It was
   visible on exactly the two looks whose paper is not white. A fixed layer
   behind the content fills the window at any document length and costs no
   layout. Miniatures and collection rows are not pages, so they keep painting
   only themselves. */
.tt-document:not(.tt-collection-item):not([data-preview]){position:relative;z-index:0}
/* HAZARD, and the reason this rule carries a warning. The sheet is FIXED and
   covers the whole window, so a document rendered INSIDE another page paints
   over everything above it in that page. The landing page shipped blank above
   the fold this way: its hero laid out, hit-tested and reported opacity 1
   while painting nothing, because the look demo further down the page had
   thrown this sheet over it. Any embedded document must pass the preview prop. */
.tt-document:not(.tt-collection-item):not([data-preview])::before{content:"";position:fixed;inset:0;z-index:-1;background:var(--paper,#fff);pointer-events:none}
.tt-prose{width:min(var(--tt-measure),calc(100% - 2rem));margin-inline:auto;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:1.06rem;line-height:1.7}.tt-prose>*:first-child{margin-top:0}
/* Lists keep the document's left edge. The browser indents a list by 40px,
   which pushed every bullet off the edge the title sets - measured at exactly
   40px on Note. Both references this engine answers to put the marker ON the
   shared edge with the words flowing after it, and wrapped lines lining up
   with the words rather than the marker. */
.tt-prose :is(ul,ol){list-style:none;padding-inline-start:0;margin-block:.7em}
.tt-prose :is(ul,ol)>li{position:relative;padding-inline-start:1.5em}
.tt-prose :is(ul,ol)>li+li{margin-top:.3em}
.tt-prose ul>li::before{content:"\2022";position:absolute;inset-inline-start:.15em;color:color-mix(in srgb,currentColor 55%,transparent)}
.tt-prose ol{counter-reset:tt-ol}
.tt-prose ol>li{counter-increment:tt-ol}
.tt-prose ol>li::before{content:counter(tt-ol) ".";position:absolute;inset-inline-start:0;color:color-mix(in srgb,currentColor 55%,transparent);font-variant-numeric:tabular-nums}
/* A task list already carries its own marker, so it must not get a second. */
.tt-prose li:has(>input[type="checkbox"])::before{content:none}.tt-prose h1,.tt-prose h2,.tt-prose h3{line-height:1.15;margin:2em 0 .65em}.tt-prose img,.tt-prose video{display:block;max-width:100%;height:auto;margin:1.75rem auto}.tt-prose a{color:color-mix(in srgb,var(--tt-accent) 60%,var(--ink,#1d1d1f));text-underline-offset:.18em}.tt-prose pre{overflow:auto;white-space:pre-wrap;overflow-wrap:break-word;padding:1rem;background:color-mix(in srgb,var(--ink,#1d1d1f) 7%,transparent)}
.tt-cover,.tt-image,.tt-video{position:relative;overflow:hidden;width:100%;background:color-mix(in srgb,var(--ink,#1d1d1f) 5%,transparent)}.tt-cover img,.tt-cover video,.tt-image img,.tt-video video,.tt-video iframe{display:block;width:100%;height:100%;border:0;object-fit:var(--tt-media-fit,cover)}.tt-height-compact{height:14rem}.tt-height-medium{height:26rem}.tt-height-large{height:min(56vh,42rem)}.tt-height-viewport{height:calc(100vh - 3rem)}
.tt-document[data-media="contained"] .tt-cover,.tt-document[data-media="contained"] .tt-image,.tt-document[data-media="contained"] .tt-video{width:min(64rem,calc(100% - 2rem));margin-inline:auto;border-radius:.5rem}.tt-document[data-media="bleed"] .tt-cover,.tt-document[data-media="bleed"] .tt-image,.tt-document[data-media="bleed"] .tt-video{width:100vw;margin-left:calc(50% - 50vw)}
.tt-byline,.tt-metadata{display:flex;align-items:center;justify-content:center;gap:.5rem;flex-wrap:wrap}.tt-byline-avatar{display:grid;place-items:center;width:2rem;height:2rem;border-radius:50%;background:var(--ink,#1d1d1f);color:var(--paper,#fff);font-size:.75rem;font-weight:700}.tt-byline-separator{color:var(--muted,#6e6e73)}
.tt-gallery{display:grid;grid-template-columns:repeat(var(--tt-gallery-columns,3),minmax(0,1fr));gap:var(--tt-gap-sm);width:100%}.tt-gallery figure{margin:0;min-width:0}.tt-gallery img,.tt-gallery video{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}.tt-gallery figcaption{padding:.5rem 0;color:var(--muted,#6e6e73);font-size:.8rem}
.tt-divider{border:0;border-top:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 16%,transparent);width:min(var(--tt-measure),calc(100% - 2rem));margin:0 auto}.tt-spacer{height:var(--tt-gap-md)}
.tt-text,.tt-byline,.tt-metadata,.tt-badge,.tt-facts,.tt-checklist,.tt-rows,.tt-progress,.tt-poll,.tt-callout,.tt-quote,.tt-gallery,.tt-group,.tt-stack[data-direction="horizontal"]{width:min(var(--tt-measure),calc(100% - 2rem));margin-inline:auto;box-sizing:border-box}
:is(.tt-masthead,.tt-group,.tt-callout-body,.tt-stack[data-direction="horizontal"],.tt-rows,.tt-checklist,.tt-collection-item) :is(.tt-text,.tt-byline,.tt-metadata,.tt-badge,.tt-facts,.tt-checklist,.tt-rows,.tt-progress,.tt-poll,.tt-callout,.tt-quote,.tt-gallery,.tt-group,.tt-stack[data-direction="horizontal"]){width:auto;margin-inline:0}
.tt-callout-body :is(.tt-text,.tt-prose,.tt-badge,.tt-facts,.tt-checklist,.tt-rows,.tt-progress,.tt-quote){width:100%;margin-inline:0}
.tt-document{--tt-tone-neutral:#6e6e73;--tt-tone-info:#0071e3;--tt-tone-success:#1f8a3b;--tt-tone-warning:#9a6b00;--tt-tone-danger:#d70015}
.tt-document[data-surface="ink"]{--tt-tone-neutral:#98989d;--tt-tone-info:#409cff;--tt-tone-success:#30d158;--tt-tone-warning:#ffd60a;--tt-tone-danger:#ff453a}
.tt-tone-neutral{--tt-tone:var(--tt-tone-neutral)}.tt-tone-info{--tt-tone:var(--tt-tone-info)}.tt-tone-success{--tt-tone:var(--tt-tone-success)}.tt-tone-warning{--tt-tone:var(--tt-tone-warning)}.tt-tone-danger{--tt-tone:var(--tt-tone-danger)}.tt-tone-accent{--tt-tone:var(--tt-accent)}
.tt-badge{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem}.tt-rows-table .tt-badge,.tt-checklist-item .tt-badge{display:inline-flex}
.tt-pill{display:inline-flex;align-items:center;gap:.35rem;padding:.16rem .62rem;border-radius:999px;font-size:.75rem;font-weight:600;line-height:1.45;background:color-mix(in srgb,var(--tt-tone,var(--tt-tone-neutral)) 13%,transparent);color:color-mix(in srgb,var(--tt-tone,var(--tt-tone-neutral)) 60%,var(--ink,#1d1d1f))}
.tt-pill-icon{font-size:.85em;line-height:1}
.tt-badge-glyph{font-size:.9rem;line-height:1;color:color-mix(in srgb,var(--tt-tone,var(--tt-accent)) 60%,var(--ink,#1d1d1f))}
.tt-cell-check{font-weight:700;color:color-mix(in srgb,var(--tt-accent) 60%,var(--ink,#1d1d1f))}
.tt-facts{font-size:.9rem;line-height:1.5}
.tt-facts-table{display:grid;grid-template-columns:auto 1fr;gap:.4rem 1.25rem;margin-block:0}
.tt-facts-table dt{font-weight:600;color:var(--muted,#6e6e73)}.tt-facts-table dd{margin:0}
.tt-facts-strip{display:flex;flex-wrap:wrap;align-items:baseline;gap:.55rem}
.tt-fact-label{color:var(--muted,#6e6e73);font-weight:600;margin-right:.35rem}
.tt-facts-sep{color:var(--muted,#6e6e73)}
.tt-facts-pills{display:flex;flex-wrap:wrap;gap:.4rem}
.tt-facts-pills .tt-fact-label{color:inherit;margin-right:0}
.tt-checklist{min-width:0}
.tt-checklist-rollup{font-size:.8rem;font-weight:600;color:var(--muted,#6e6e73);margin-bottom:.5rem}
.tt-checklist-items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.45rem}
.tt-checklist-item{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.tt-checkbox{display:inline-grid;place-items:center;width:1.15rem;height:1.15rem;border-radius:.35rem;border:1.5px solid color-mix(in srgb,var(--ink,#1d1d1f) 35%,transparent);font-size:.72rem;line-height:1;flex:none}
.tt-checkbox-done{background:var(--tt-accent);border-color:var(--tt-accent);color:#fff}
.tt-checklist[data-mode="document"] .tt-checklist-item[data-done] .tt-checklist-label{color:var(--muted,#6e6e73);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--ink,#1d1d1f) 30%,transparent)}
.tt-rows{min-width:0}
.tt-rows-table-wrap{overflow-x:auto}
.tt-rows-table{width:100%;border-collapse:collapse;font-size:.92rem}
.tt-rows-table th{text-align:left;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#6e6e73);padding:.45rem .75rem .45rem 0;border-bottom:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 16%,transparent)}
.tt-rows-table td{padding:.55rem .75rem .55rem 0;border-bottom:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 8%,transparent);vertical-align:top}
.tt-rows-table th[data-kind="number"],.tt-rows-table td[data-kind="number"]{text-align:right}
.tt-cell-link{color:var(--tt-accent);text-decoration:none;text-underline-offset:.16em;overflow-wrap:anywhere}.tt-cell-link:hover{text-decoration:underline}
.tt-rows-steps{list-style:none;margin-block:0;padding:0;counter-reset:tt-step;display:flex;flex-direction:column;gap:1rem}
.tt-rows-step{counter-increment:tt-step;display:flex;gap:1rem;align-items:flex-start}
.tt-rows-step::before{content:counter(tt-step);font-size:1.6rem;font-weight:750;line-height:1.1;min-width:2rem;color:color-mix(in srgb,var(--tt-accent) 60%,var(--ink,#1d1d1f))}
.tt-rows-step-body{display:flex;flex-direction:column;gap:.15rem}
.tt-rows-step-lead{font-weight:600}
.tt-rows-step-detail{font-size:.85rem;color:var(--muted,#6e6e73)}
.tt-rows-timeline{list-style:none;margin-block:0;padding:0 0 0 1.1rem;border-left:2px solid color-mix(in srgb,var(--ink,#1d1d1f) 14%,transparent);display:flex;flex-direction:column;gap:1rem}
.tt-rows-timeline li{position:relative}
.tt-rows-timeline li::before{content:"";position:absolute;left:-1.42rem;top:.35rem;width:.55rem;height:.55rem;border-radius:50%;background:color-mix(in srgb,var(--tt-accent) 60%,var(--ink,#1d1d1f))}
.tt-rows-timeline-date{font-size:.8rem;font-weight:500;color:var(--muted,#6e6e73)}
/* A reached milestone fills its own dot. That is the whole statement, and it
   replaces the bare tick that used to sit on a line of its own. */
.tt-rows-timeline li[data-reached]::before{background:var(--tt-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--tt-accent) 18%,transparent)}
.tt-rows-timeline li[data-reached] .tt-rows-step-lead{color:var(--muted,#6e6e73)}
.tt-rows-timeline-body{display:flex;flex-direction:column;gap:.15rem}
.tt-rows-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:var(--tt-gap-sm)}
.tt-rows-tile{padding:.9rem 1rem;border-radius:.6rem;background:color-mix(in srgb,var(--ink,#1d1d1f) 5%,transparent);display:flex;flex-direction:column;gap:.2rem}
.tt-rows-tile-value{font-size:1.5rem;font-weight:750;line-height:1.1}
.tt-rows-tile-label{font-size:.78rem;font-weight:600;color:var(--muted,#6e6e73)}
.tt-progress{display:flex;align-items:center;gap:.6rem}
.tt-progress-track{flex:1;height:.5rem;border-radius:999px;background:color-mix(in srgb,var(--ink,#1d1d1f) 10%,transparent);overflow:hidden}
.tt-progress-fill{height:100%;border-radius:999px;background:var(--tt-accent)}
.tt-progress-ring svg{width:3rem;height:3rem;transform:rotate(-90deg)}
.tt-progress-ring-track{stroke:color-mix(in srgb,var(--ink,#1d1d1f) 10%,transparent)}
.tt-progress-ring-fill{stroke:var(--tt-accent);stroke-linecap:round}
.tt-progress-label{font-size:.8rem;font-weight:600;color:var(--muted,#6e6e73);white-space:nowrap}
.tt-progress-fraction{font-size:.95rem;font-weight:600}
.tt-poll-options{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem}
.tt-poll-option{position:relative;display:flex;align-items:center;justify-content:space-between;gap:.75rem;width:100%;padding:.6rem .85rem;border:1.5px solid color-mix(in srgb,var(--ink,#1d1d1f) 18%,transparent);border-radius:.6rem;background:transparent;color:inherit;font:inherit;font-size:.95rem;text-align:left;cursor:pointer;overflow:hidden}
.tt-poll-option:disabled{cursor:default}
.tt-poll-option[data-chosen]{border-color:var(--tt-accent)}
.tt-poll-option[data-chosen] .tt-poll-mark{color:var(--tt-accent)}
.tt-poll-fill{position:absolute;inset:0 auto 0 0;background:color-mix(in srgb,var(--tt-accent) 14%,transparent);transition:width .35s ease}
.tt-poll-label{position:relative;display:flex;align-items:center;gap:.55rem;font-weight:600}
.tt-poll-mark{color:color-mix(in srgb,var(--ink,#1d1d1f) 40%,transparent);font-size:.8rem}
.tt-poll-count{position:relative;font-size:.8rem;font-weight:600;color:var(--muted,#6e6e73);white-space:nowrap}
.tt-poll-footer{display:flex;align-items:center;gap:.75rem;margin-top:.6rem;min-height:1.2rem}
.tt-poll-submit{padding:.4rem 1rem;border:0;border-radius:999px;background:var(--tt-accent);color:#fff;font:inherit;font-size:.85rem;font-weight:700;cursor:pointer}
.tt-poll-submit:disabled{opacity:.5;cursor:default}
.tt-poll-meta{font-size:.8rem;color:var(--muted,#6e6e73)}
.tt-poll-notice{font-size:.8rem;font-weight:600;color:var(--tt-tone-danger)}
.tt-callout{--tt-tone:var(--tt-tone-neutral);margin-block:0;padding:1rem 1.15rem;border-radius:.6rem;background:color-mix(in srgb,var(--tt-tone) 9%,transparent);border-left:3px solid color-mix(in srgb,var(--tt-tone) 55%,transparent);display:flex;flex-direction:column;gap:.5rem}
.tt-callout-tip{--tt-tone:var(--tt-tone-info)}.tt-callout-success{--tt-tone:var(--tt-tone-success)}.tt-callout-warning{--tt-tone:var(--tt-tone-warning)}.tt-callout-danger{--tt-tone:var(--tt-tone-danger)}.tt-callout-decision{--tt-tone:var(--tt-accent)}
.tt-callout-title{display:flex;align-items:center;gap:.5rem;font-weight:700;color:color-mix(in srgb,var(--tt-tone) 60%,var(--ink,#1d1d1f))}
.tt-callout-icon{line-height:1}
.tt-callout-body{display:flex;flex-direction:column;gap:.5rem}
/* One boolean, drawn as the mark a person recognises. A ticked thing recedes:
   the label greys and strikes, the way a finished task does everywhere. */
.tt-toggle{display:inline-flex;align-items:center;gap:.6rem;min-width:0}
.tt-toggle-mark{flex:none;display:grid;place-items:center;width:1.3rem;height:1.3rem;border:1.5px solid color-mix(in srgb,var(--tt-accent) 70%,transparent);border-radius:50%}
.tt-toggle[data-variant="square"] .tt-toggle-mark{border-radius:.3rem}
.tt-toggle[data-on] .tt-toggle-mark{background:var(--tt-accent);border-color:var(--tt-accent)}
.tt-toggle[data-on] .tt-toggle-mark::after{content:"";width:.42rem;height:.72rem;margin-top:-.14rem;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.tt-toggle-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tt-toggle[data-on] .tt-toggle-label{color:var(--muted,#6e6e73);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--ink,#1d1d1f) 30%,transparent)}
.tt-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.tt-quote{margin-block:0;overflow-wrap:anywhere}
.tt-quote p{margin:0}
.tt-quote[data-variant="block"],.tt-quote[data-variant="attributed"]{border-left:3px solid color-mix(in srgb,var(--ink,#1d1d1f) 18%,transparent);padding-left:1rem;font-size:1.02rem;line-height:1.6;color:color-mix(in srgb,var(--ink,#1d1d1f) 78%,transparent)}
.tt-quote[data-variant="pull"]{text-align:center;font-size:clamp(1.4rem,3vw,2rem);line-height:1.3;font-weight:600}
.tt-quote-attribution{margin-top:.5rem;font-size:.85rem;font-weight:600;color:var(--muted,#6e6e73)}
.tt-document.tt-collection-item{padding-bottom:0}

/* Article - the reading view an article gets when it is published, and the
   look whose editor should feel like a blank page and nothing else. The
   masthead is centred and the body is not; the display face is a serif and
   the body is the system sans, which is the combination the reference uses
   and the reason it reads as an article rather than a blog post. */
.tt-document[data-style-family="article"]{--tt-accent:#1a8917;--tt-measure:44rem}
.tt-document:not(.tt-collection-item)[data-style-family="article"]>.tt-stack{gap:2.25rem;padding:clamp(2.5rem,7vw,5rem) 0 5rem}
.tt-document:not(.tt-collection-item)[data-style-family="article"] .tt-masthead{gap:.85rem}
.tt-document[data-style-family="article"] .tt-text-title{font-family:Charter,"Iowan Old Style","Palatino Linotype",Palatino,serif;font-size:clamp(2.1rem,3.6vw,3rem);font-weight:700;line-height:1.08;letter-spacing:-.022em;text-wrap:balance}
.tt-document[data-style-family="article"] .tt-text-subtitle{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:1.02rem;line-height:1.45;color:var(--muted,#6e6e73)}
/* A hairline closes the masthead, the way a rule separates the title block
   from the story in the reference. It is drawn on the masthead so it only
   exists where there is a masthead to close. */
.tt-document:not(.tt-collection-item)[data-style-family="article"] .tt-masthead::after{content:"";width:min(26rem,58%);height:1px;margin:1.1rem auto 0;background:color-mix(in srgb,var(--ink,#1d1d1f) 17%,transparent)}
.tt-document[data-style-family="article"] .tt-prose{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:1.15rem;line-height:1.62}
/* The byline is metadata, not the first line of the story. Left in the
   editorial serif at body size it read as an opening sentence. */
.tt-document[data-style-family="article"] .tt-byline{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:.875rem;line-height:1.45;letter-spacing:0;color:var(--muted,#6e6e73)}
/* Section headings are centred serif, which is what makes a long piece feel
   set rather than typed. */
.tt-document[data-style-family="article"] .tt-prose h2,.tt-document[data-style-family="article"] .tt-prose h3{font-family:Charter,"Iowan Old Style","Palatino Linotype",Palatino,serif;text-align:center;font-size:1.32rem;letter-spacing:-.008em;margin:2.4em 0 .8em}
.tt-document[data-style-family="article"] .tt-cover{width:min(52rem,calc(100% - 2rem));height:auto;aspect-ratio:16/10;border-radius:.85rem}
.tt-document.tt-collection-item[data-style-family="article"] .tt-text-title{font-size:1.55rem;line-height:1.12;letter-spacing:-.01em}
.tt-document.tt-collection-item[data-style-family="article"] .tt-text-subtitle{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:.94rem;line-height:1.45}

/* Note */
/* Apple Notes is white paper. The yellow lives in the app's chrome, never
   behind the words; a cream page is a sticky note, which is a different and
   much noisier idea. */
.tt-document[data-template="texttext.note"]{--tt-accent:#ffb900;--paper:#fff;--ink:#1c1c1e;--muted:#6b6b70;--tt-measure:50rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.note"]>.tt-stack{gap:.9rem;padding:clamp(1.5rem,4vw,2.75rem) 0 4rem}
.tt-document[data-template="texttext.note"] .tt-text-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;font-size:clamp(1.6rem,2.6vw,2.1rem);font-weight:700;line-height:1.16;letter-spacing:-.017em}
.tt-document[data-template="texttext.note"] .tt-metadata{justify-content:center;font-size:.78rem;color:var(--muted)}
.tt-document[data-template="texttext.note"] .tt-prose{font-size:1.15rem;line-height:1.5}
.tt-document[data-template="texttext.note"] .tt-prose a{color:#c78800}
.tt-document.tt-collection-item[data-template="texttext.note"]{background:#fff}
.tt-document.tt-collection-item[data-template="texttext.note"] .tt-text-title{font-size:1.3rem}
.tt-document.tt-collection-item[data-template="texttext.note"] .tt-metadata{justify-content:flex-start}

/* Case study - argument on the left, evidence on the right. The reading
   column is fixed at a comfortable measure rather than a percentage, so the
   line length stays right and the evidence takes whatever is left. */
.tt-document[data-template="texttext.casestudy"]{--tt-accent:#1d1d1f;--tt-measure:none}
.tt-document:not(.tt-collection-item)[data-template="texttext.casestudy"]>.tt-stack{gap:clamp(2rem,4vw,3.5rem);padding:clamp(2rem,5vw,3.5rem) clamp(1rem,4vw,3rem) 5rem;align-items:flex-start}
.tt-document[data-template="texttext.casestudy"] [data-tt-node="case-copy"]{flex:0 1 34rem;min-width:0}
.tt-document[data-template="texttext.casestudy"] [data-tt-node="case-evidence"]{flex:1 1 30rem;min-width:0;position:sticky;top:2rem}
.tt-document[data-template="texttext.casestudy"] .tt-masthead{width:100%;margin-inline:0;text-align:left;align-items:flex-start}
.tt-document[data-template="texttext.casestudy"] .tt-prose{width:100%;margin-inline:0;font-size:1.12rem;line-height:1.6}
.tt-document[data-template="texttext.casestudy"] .tt-text-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;font-size:clamp(1.9rem,3.1vw,2.5rem);font-weight:700;line-height:1.1;letter-spacing:-.021em}
/* The role sits under the tags as a quiet italic line, the way a dek does. */
.tt-document[data-template="texttext.casestudy"] .tt-text-caption{font-style:italic;font-size:1.05rem;line-height:1.5;text-transform:none;letter-spacing:0}
/* .tt-badge is the row; .tt-pill is each tag. Styling the row as if it were a
   pill drew one rectangle around the whole set. */
.tt-document[data-template="texttext.casestudy"] .tt-badge{gap:.45rem}
.tt-document[data-template="texttext.casestudy"] .tt-pill{border:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 24%,transparent);background:transparent;color:var(--muted,#6e6e73);text-transform:uppercase;letter-spacing:.07em;font-size:.68rem;font-weight:700;padding:.28rem .7rem}
.tt-document[data-template="texttext.casestudy"] .tt-cover,.tt-document[data-template="texttext.casestudy"] .tt-video{width:100%;height:auto;aspect-ratio:16/10;border-radius:.75rem}
.tt-document[data-template="texttext.casestudy"] [data-tt-node="case-evidence"] .tt-text-caption{font-style:normal;text-align:center;font-size:.95rem;color:var(--muted,#6e6e73)}
.tt-document[data-template="texttext.casestudy"] .tt-prose h2{font-size:1.2rem;margin:1.9em 0 .5em}
@media(max-width:900px){
  .tt-document:not(.tt-collection-item)[data-template="texttext.casestudy"]>.tt-stack{flex-direction:column}
  .tt-document[data-template="texttext.casestudy"] [data-tt-node="case-copy"],.tt-document[data-template="texttext.casestudy"] [data-tt-node="case-evidence"]{flex:1 1 auto;width:100%;position:static}
}

/* Bookmark */
/* One serif for the whole document. The title and prose named Georgia while
   the caption and date inherited Iowan Old Style from the editorial default,
   so the source line was set in a different face from the words beside it. */
.tt-document[data-template="texttext.bookmark"]{--tt-accent:#835f42;--paper:#f6f1e7;--ink:#26231f;--muted:#7a7167;--tt-measure:39rem;--tt-font:Georgia,"Iowan Old Style","Palatino Linotype",serif}
.tt-document:not(.tt-collection-item)[data-template="texttext.bookmark"]>.tt-stack{gap:2.1rem;padding:clamp(2.75rem,8vw,6.5rem) 0 5rem}
.tt-document[data-template="texttext.bookmark"] .tt-text-title{font-family:Georgia,"Iowan Old Style",serif;font-size:clamp(1.75rem,2.8vw,2.25rem);font-weight:700;line-height:1.14;letter-spacing:-.018em}
.tt-document[data-template="texttext.bookmark"] .tt-text-subtitle{font-family:Georgia,"Iowan Old Style",serif;font-size:1.18rem}
.tt-document[data-template="texttext.bookmark"] .tt-text-caption{text-transform:uppercase;letter-spacing:.06em;font-size:.7rem;font-weight:700}
.tt-document[data-template="texttext.bookmark"] .tt-cover{width:min(52rem,calc(100% - 2rem));height:auto;aspect-ratio:3/2;border-radius:0}
.tt-document[data-template="texttext.bookmark"] .tt-prose{font-family:Georgia,"Iowan Old Style",serif;font-size:1.18rem;line-height:1.82}
.tt-document.tt-collection-item[data-template="texttext.bookmark"] .tt-text-title{font-size:1.45rem;line-height:1.16}
.tt-document.tt-collection-item[data-template="texttext.bookmark"] .tt-text-subtitle{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:.9rem}

/* Gallery */
.tt-document[data-template="texttext.gallery"]{--tt-accent:#e60023;--tt-measure:78rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.gallery"]>.tt-stack{gap:2.5rem;padding:clamp(2rem,6vw,5rem) clamp(1rem,4vw,3.5rem) 5rem}
.tt-document[data-template="texttext.gallery"] [data-tt-node="gallery-copy"]{text-align:center;align-items:center}
/* The pictures lead, so the words do not run the full 78rem grid width at
   full ink. A short centred measure under a centred title. */
.tt-document[data-template="texttext.gallery"] .tt-prose{width:min(34rem,calc(100% - 2rem));margin-inline:auto;text-align:center;font-size:.98rem;line-height:1.6;color:var(--muted,#6e6e73)}
.tt-document[data-template="texttext.gallery"] .tt-text-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;font-size:clamp(1.75rem,2.8vw,2.25rem);font-weight:700;line-height:1.14;letter-spacing:-.018em}
.tt-document[data-template="texttext.gallery"] [data-tt-node="gallery-media"]{grid-template-columns:repeat(auto-fill,minmax(12rem,1fr));gap:1rem;width:min(78rem,100%);margin-inline:auto}
.tt-document[data-template="texttext.gallery"] .tt-gallery figure{break-inside:avoid}
.tt-document[data-template="texttext.gallery"] .tt-gallery img,.tt-document[data-template="texttext.gallery"] .tt-gallery video{aspect-ratio:4/5;border-radius:.5rem}
.tt-document[data-template="texttext.gallery"] .tt-gallery figure:nth-child(3n+2) img,.tt-document[data-template="texttext.gallery"] .tt-gallery figure:nth-child(3n+2) video{aspect-ratio:1/1}
.tt-document[data-template="texttext.gallery"] .tt-gallery figure:nth-child(3n) img,.tt-document[data-template="texttext.gallery"] .tt-gallery figure:nth-child(3n) video{aspect-ratio:3/4}
.tt-document.tt-collection-item[data-template="texttext.gallery"] .tt-text-title{font-size:1.4rem}
.tt-document.tt-collection-item[data-template="texttext.gallery"] .tt-gallery{grid-template-columns:repeat(2,minmax(0,1fr));gap:.35rem}
.tt-document.tt-collection-item[data-template="texttext.gallery"] .tt-gallery img,.tt-document.tt-collection-item[data-template="texttext.gallery"] .tt-gallery video{border-radius:.35rem}

/* Video - the recording leads, then its name, then who and how long, then the
   writing. The title sits under the video at reading weight, not over it as a
   headline: by the time you read it you have already seen the thing. */
.tt-document[data-template="texttext.talk"]{--tt-accent:#ff0033;--tt-measure:56rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.talk"]>.tt-stack{gap:1.5rem;padding:clamp(1.5rem,4vw,3rem) 0 5rem}
.tt-document[data-template="texttext.talk"] .tt-video,.tt-document[data-template="texttext.talk"] .tt-cover{width:min(56rem,calc(100% - 2rem));height:auto;aspect-ratio:16/9;border-radius:.75rem;background:#000}
.tt-document[data-template="texttext.talk"] .tt-text-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;font-size:clamp(1.6rem,2.6vw,2.1rem);font-weight:700;line-height:1.16;letter-spacing:-.017em}
.tt-document[data-template="texttext.talk"] .tt-masthead{gap:.4rem}
.tt-document[data-template="texttext.talk"] .tt-byline,.tt-document[data-template="texttext.talk"] .tt-metadata{margin-top:.1rem;font-size:.95rem}
.tt-document[data-template="texttext.talk"] .tt-text-subtitle{font-size:1.05rem}
.tt-document[data-template="texttext.talk"] .tt-prose{font-size:1.15rem;line-height:1.55}
.tt-document.tt-collection-item[data-template="texttext.talk"] .tt-text-title{font-size:1.3rem}

/* Tasks - a list on a tinted page, in white cards. The accent is a variable
   so a look can be recoloured; it used to be hardcoded into the title, which
   made --tt-accent decorative here. #007aff is the light-mode system blue
   (#0a84ff is the dark-mode one, and was being used in both). */
.tt-document[data-template="texttext.todo"]{--tt-accent:#007aff;--paper:#f2f2f7;--ink:#1c1c1e;--muted:#6b6b70;--tt-measure:42rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.todo"]>.tt-stack{gap:1.25rem;padding:clamp(2rem,6vw,4.5rem) 0 5rem}
.tt-document[data-template="texttext.todo"] .tt-text-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;font-size:clamp(1.6rem,2.6vw,2.1rem);font-weight:700;line-height:1.16;letter-spacing:-.017em;color:var(--tt-accent)}
/* The card holds no horizontal padding; each row does. That is what lets a
   separator start under the task text and run to the card's right edge,
   instead of floating inset on both sides. */
.tt-document[data-template="texttext.todo"] .tt-checklist{padding:.25rem 0;background:#fff;border-radius:.5rem}
.tt-document[data-template="texttext.todo"] .tt-checklist-items{gap:0}
.tt-document[data-template="texttext.todo"] .tt-checklist-item{position:relative;min-height:2.9rem;padding:.55rem 1rem;flex-wrap:nowrap}
.tt-document[data-template="texttext.todo"] .tt-checklist-item::after{content:"";position:absolute;left:2.95rem;right:0;bottom:0;height:1px;background:#e5e5ea}
.tt-document[data-template="texttext.todo"] .tt-checklist-item:last-child::after{display:none}
.tt-document[data-template="texttext.todo"] .tt-checkbox{width:1.35rem;height:1.35rem;border-radius:50%;border-color:var(--tt-accent)}
/* A due date is small grey text and a priority is coloured text. Rendering
   them as filled capsules turns a reminders list into a database table, which
   is a different product's vocabulary. */
.tt-document[data-template="texttext.todo"] .tt-checklist-item .tt-pill{padding:0;border:0;border-radius:0;background:none;font-size:.8125rem;font-weight:400;line-height:1.3;color:var(--muted,#6e6e73)}
.tt-document[data-template="texttext.todo"] .tt-checklist-item .tt-pill-icon{display:none}
.tt-document[data-template="texttext.todo"] .tt-checklist-item .tt-tone-danger{color:var(--tt-tone-danger);font-weight:600}
/* A finished task recedes whole. Striking the label while its date and
   priority stayed at full strength left the loudest part of a completed row
   louder than the task still to do above it. */
.tt-document[data-template="texttext.todo"] .tt-checklist-item[data-done] .tt-pill,.tt-document[data-template="texttext.todo"] .tt-checklist-item[data-done] .tt-tone-danger{color:color-mix(in srgb,var(--muted,#6e6e73) 70%,transparent);font-weight:400}
.tt-document.tt-collection-item[data-template="texttext.todo"] .tt-text-title{font-size:1.45rem;color:var(--tt-accent)}
.tt-document.tt-collection-item[data-template="texttext.todo"] .tt-checklist{padding:.15rem 0}

/* Page - a cover, an icon that sits half over it, a name, and what you wrote.
   Everything below the cover shares one left edge, including the icon. The
   restraint is the whole design: no rules, no boxes, no widgets. */
.tt-document[data-template="texttext.page"]{--tt-accent:#2383e2;--tt-measure:46rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.page"]>.tt-stack{gap:0;padding:0 0 6rem}
.tt-document[data-template="texttext.page"] .tt-cover{height:clamp(9rem,22vh,14rem);border-radius:0}
/* position/z-index so the icon sits over the cover rather than behind it. */
.tt-document[data-template="texttext.page"] [data-tt-node="page-icon"]{position:relative;z-index:1;width:min(var(--tt-measure),calc(100% - 2rem));margin:0 auto;font-size:4.5rem;line-height:1;letter-spacing:0}
/* Half over the cover when there is one, and simply near the top when there
   is not. */
.tt-document[data-template="texttext.page"] .tt-cover+[data-tt-node="page-icon"]{margin-top:-2.4rem}
.tt-document[data-template="texttext.page"]>.tt-stack>[data-tt-node="page-icon"]:first-child{margin-top:clamp(2rem,5vw,3.5rem)}
.tt-document[data-template="texttext.page"] .tt-masthead{margin-top:.65rem}
.tt-document[data-template="texttext.page"]>.tt-stack>.tt-masthead:first-child{margin-top:clamp(2.5rem,6vw,4.5rem)}
.tt-document[data-template="texttext.page"] .tt-text-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;font-size:clamp(1.9rem,3.1vw,2.5rem);font-weight:700;line-height:1.12;letter-spacing:-.021em}
.tt-document[data-template="texttext.page"] .tt-text-subtitle{font-size:1rem;line-height:1.5}
.tt-document[data-template="texttext.page"] .tt-prose{margin-top:1.1rem;font-size:1rem;line-height:1.5}
.tt-document[data-template="texttext.page"] .tt-prose p{margin:.5em 0}
.tt-document[data-template="texttext.page"] .tt-prose h1,.tt-document[data-template="texttext.page"] .tt-prose h2,.tt-document[data-template="texttext.page"] .tt-prose h3{margin:1.6em 0 .25em;letter-spacing:-.014em}
.tt-document.tt-collection-item[data-template="texttext.page"] .tt-text-title{font-size:1.35rem}

/* Project - a project dashboard, not a page. Its own thing: one left edge, a
   restrained title, and no boxes drawn around blocks; but it carries a
   restrained title, and no boxes. The reference draws no border around any
   block; hierarchy comes from weight and space alone, which is why it stays
   calm as a page grows. */
.tt-document[data-template="texttext.project"]{--tt-accent:#2383e2;--tt-measure:44rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.project"]>.tt-stack{gap:1.15rem;padding:clamp(1.75rem,4vw,3rem) 0 5rem}
.tt-document[data-template="texttext.project"] .tt-text-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;font-size:clamp(1.9rem,3.1vw,2.5rem);font-weight:700;line-height:1.12;letter-spacing:-.021em}
.tt-document[data-template="texttext.project"] .tt-masthead{gap:.7rem}
.tt-document[data-template="texttext.project"] .tt-facts{font-size:.9rem}
.tt-document[data-template="texttext.project"] .tt-facts-table{padding:.15rem 0;border:0;gap:.35rem 1.5rem;grid-template-columns:minmax(5.5rem,auto) 1fr}
.tt-document[data-template="texttext.project"] .tt-facts-table dt{color:var(--muted,#6e6e73);font-weight:400}
.tt-document[data-template="texttext.project"] .tt-prose{font-size:1rem;line-height:1.5}
.tt-document[data-template="texttext.project"] .tt-prose p{margin:.55em 0}
.tt-document[data-template="texttext.project"] .tt-prose h1,.tt-document[data-template="texttext.project"] .tt-prose h2,.tt-document[data-template="texttext.project"] .tt-prose h3{margin:1.5em 0 .3em;letter-spacing:-.014em}
.tt-document[data-template="texttext.project"] .tt-checklist,.tt-document[data-template="texttext.project"] .tt-rows{padding:0;border:0;border-radius:0}
/* No boxes means no boxes: an owner and a due date on a task row are plain
   supporting text, not filled capsules. */
.tt-document[data-template="texttext.project"] .tt-checklist-item .tt-pill{padding:0;border:0;border-radius:0;background:none;font-size:.8125rem;font-weight:400;color:var(--muted,#6e6e73)}
.tt-document.tt-collection-item[data-template="texttext.project"] .tt-text-title{font-size:1.45rem}
.tt-document.tt-collection-item[data-template="texttext.project"] .tt-facts{font-size:.8rem}

/* Living brief - the prose remains the document. Grounding is a quiet ledger
   beneath it, not a dashboard wrapped around it. */
.tt-document[data-template="texttext.brief"]{--tt-accent:#0a66c2;--tt-measure:52rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.brief"]>.tt-stack{gap:1.45rem;padding:clamp(2rem,5vw,4rem) 0 5rem}
.tt-document[data-template="texttext.brief"] .tt-text-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;font-size:clamp(2rem,3.6vw,3rem);font-weight:720;line-height:1.08;letter-spacing:-.026em}
.tt-document[data-template="texttext.brief"] .tt-text-subtitle{font-size:1.08rem;line-height:1.5}
.tt-document[data-template="texttext.brief"] .tt-prose{font-size:1.04rem;line-height:1.7}
.tt-document[data-template="texttext.brief"] .tt-prose h2{margin:1.7em 0 .35em;font-size:1.08rem;letter-spacing:-.01em}
.tt-document[data-template="texttext.brief"] [data-tt-node$="-heading"]{margin-top:.6rem;padding-top:1.15rem;border-top:1px solid color-mix(in srgb,var(--ink,#1d1d1f) 12%,transparent)}
.tt-document[data-template="texttext.brief"] [data-tt-node$="-heading"] .tt-text-heading{font-size:.78rem;font-weight:680;text-transform:uppercase;letter-spacing:.075em;color:var(--muted,#6e6e73)}
.tt-document[data-template="texttext.brief"] .tt-rows-table{font-size:.88rem}
.tt-document[data-template="texttext.brief"] .tt-rows-table th{font-size:.68rem;font-weight:650;letter-spacing:.055em}
.tt-document[data-template="texttext.brief"] .tt-rows-table td{padding-block:.72rem;line-height:1.42}
.tt-document[data-template="texttext.brief"] [data-tt-node="claims-ledger"] .tt-rows-table td:first-child{min-width:15rem;font-weight:550;color:var(--ink,#1d1d1f)}
.tt-document[data-template="texttext.brief"] [data-tt-node="claims-ledger"] .tt-rows-table td:last-child{min-width:15rem;color:var(--muted,#6e6e73)}
.tt-document[data-template="texttext.brief"] [data-tt-node="sources-ledger"] .tt-rows-table td:first-child{min-width:11rem;font-weight:550;color:var(--ink,#1d1d1f)}
.tt-document[data-template="texttext.brief"] [data-tt-node="writing-rules"]{padding:0;border:0;border-radius:0}
.tt-document[data-template="texttext.brief"] [data-tt-node="writing-rules"] .tt-checklist-item{padding-inline:0}
.tt-document.tt-collection-item[data-template="texttext.brief"] .tt-text-heading{font-size:1.08rem;letter-spacing:-.01em}

/* Newsletter */
.tt-document[data-template="texttext.newsletter"]{--tt-accent:#ff6719;--tt-measure:42rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.newsletter"]>.tt-stack{gap:2rem;padding:clamp(2.5rem,7vw,6rem) 0 5rem}
.tt-document[data-template="texttext.newsletter"] .tt-masthead{text-align:center;align-items:center}
.tt-document[data-template="texttext.newsletter"] .tt-text-title{font-family:Georgia,"Iowan Old Style",serif;font-size:clamp(2.05rem,3.45vw,2.75rem);font-weight:700;line-height:1.08;letter-spacing:-.023em}
.tt-document[data-template="texttext.newsletter"] .tt-text-subtitle{font-family:Georgia,"Iowan Old Style",serif;font-size:1.2rem}
.tt-document[data-template="texttext.newsletter"] .tt-cover{width:min(52rem,calc(100% - 2rem));height:auto;aspect-ratio:16/9;border-radius:0}
.tt-document[data-template="texttext.newsletter"] .tt-prose{font-family:Georgia,"Iowan Old Style",serif;font-size:1.16rem;line-height:1.78}
.tt-document[data-template="texttext.newsletter"] .tt-rows-tiles{display:flex;flex-direction:column;gap:0}
.tt-document[data-template="texttext.newsletter"] .tt-rows-tile{padding:1.1rem 0;border-radius:0;border-bottom:1px solid color-mix(in srgb,var(--ink) 14%,transparent);background:transparent}
.tt-document[data-template="texttext.newsletter"] .tt-rows-tile-value{font-family:Georgia,"Iowan Old Style",serif;font-size:1.2rem}
.tt-document.tt-collection-item[data-template="texttext.newsletter"] .tt-text-title{font-size:1.5rem}

@media(max-width:720px){.tt-stack[data-direction="horizontal"]{flex-direction:column}.tt-text-title{font-size:clamp(2.3rem,13vw,4rem)}.tt-height-large{height:38vh}.tt-document[data-template="texttext.gallery"] [data-tt-node="gallery-media"]{grid-template-columns:repeat(2,minmax(0,1fr))}.tt-document[data-style-family="article"] .tt-prose,.tt-document[data-template="texttext.bookmark"] .tt-prose,.tt-document[data-template="texttext.newsletter"] .tt-prose{font-size:1.08rem}.tt-document[data-template="texttext.todo"] .tt-checklist{border-radius:0}.tt-document[data-template="texttext.brief"]{--tt-measure:100%}.tt-document[data-template="texttext.brief"] .tt-rows-table{min-width:42rem}}
@media(prefers-color-scheme:dark){
  .tt-document{--ink:#f5f5f7;--paper:#1c1c1e;--muted:#a1a1a6;--tt-tone-neutral:#98989d;--tt-tone-info:#409cff;--tt-tone-success:#30d158;--tt-tone-warning:#ffd60a;--tt-tone-danger:#ff453a}
  /* Neutral, not the warm brown a cream paper turns into when it is darkened.
     The yellow belongs in the accent, never behind the words. */
  .tt-document[data-template="texttext.note"]{--paper:#1c1c1e;--ink:#f5f5f7;--muted:#98989d}.tt-document.tt-collection-item[data-template="texttext.note"]{background:#1c1c1e}
  .tt-document[data-template="texttext.bookmark"]{--paper:#211f1a;--ink:#f3eee4;--muted:#aaa094}
  /* The dark accent is the dark-mode system blue, and the separator now lives
     on the row's ::after rather than a border. */
  .tt-document[data-template="texttext.todo"]{--tt-accent:#0a84ff;--paper:#141416;--ink:#f5f5f7;--muted:#9b9ba1}.tt-document[data-template="texttext.todo"] .tt-checklist{background:#1c1c1e}.tt-document[data-template="texttext.todo"] .tt-checklist-item::after{background:#38383a}
}
@media(prefers-reduced-motion:reduce){.tt-document *{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}

/* A miniature never loads a player: media renders as a still stand-in. */
.tt-document .tt-video.tt-media-still,.tt-document .tt-cover.tt-media-still,.tt-document .tt-image.tt-media-still{display:grid;place-items:center;background:color-mix(in srgb,var(--ink,#1d1d1f) 9%,var(--paper,#fff))}
.tt-document .tt-media-still>span{width:2.5rem;height:2.5rem;background:color-mix(in srgb,var(--ink,#1d1d1f) 26%,transparent);clip-path:polygon(30% 16%,30% 84%,84% 50%)}
`;