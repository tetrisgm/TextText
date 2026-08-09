export const DOCUMENT_ENGINE_CSS = String.raw`
.tt-document{--tt-accent:#0071e3;--tt-gap-none:0;--tt-gap-xs:.35rem;--tt-gap-sm:.75rem;--tt-gap-md:1.25rem;--tt-gap-lg:2rem;--tt-gap-xl:3.5rem;--tt-measure:46rem;color:var(--ink,#1d1d1f);background:var(--paper,#fff);min-height:100%;padding-bottom:5rem;font-family:var(--tt-font,-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif)}
.tt-document[data-typography="editorial"]{--tt-font:Iowan Old Style,Palatino Linotype,Book Antiqua,Palatino,serif}
.tt-document[data-typography="mono"]{--tt-font:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
.tt-document[data-surface="paper"]{--paper:#fffdf8;--ink:#201f1c;--muted:#6d6a62}.tt-document[data-surface="soft"]{--paper:#f5f5f7}.tt-document[data-surface="ink"]{--paper:#1d1d1f;--ink:#f5f5f7;--muted:#a1a1a6}
.tt-document[data-measure="narrow"]{--tt-measure:36rem}.tt-document[data-measure="wide"]{--tt-measure:64rem}.tt-document[data-measure="full"]{--tt-measure:none}
.tt-document[data-density="compact"]{--tt-gap-sm:.5rem;--tt-gap-md:.85rem;--tt-gap-lg:1.35rem;--tt-gap-xl:2rem}.tt-document[data-density="spacious"]{--tt-gap-sm:1rem;--tt-gap-md:1.75rem;--tt-gap-lg:3rem;--tt-gap-xl:5rem}
.tt-stack,.tt-group,.tt-masthead{display:flex;box-sizing:border-box}.tt-stack[data-direction="vertical"],.tt-group,.tt-masthead{flex-direction:column}.tt-stack[data-direction="horizontal"]{flex-direction:row}.tt-stack,.tt-group{align-items:stretch}.tt-masthead{width:min(var(--tt-measure),calc(100% - 2rem));margin-inline:auto;text-align:center;align-items:center}
.tt-gap-none{gap:var(--tt-gap-none)}.tt-gap-xs{gap:var(--tt-gap-xs)}.tt-gap-sm{gap:var(--tt-gap-sm)}.tt-gap-md{gap:var(--tt-gap-md)}.tt-gap-lg{gap:var(--tt-gap-lg)}.tt-gap-xl{gap:var(--tt-gap-xl)}
.tt-align-start{align-items:flex-start}.tt-align-center{align-items:center}.tt-align-end{align-items:flex-end}.tt-align-stretch{align-items:stretch}
.tt-text{margin:0;overflow-wrap:anywhere}.tt-text-eyebrow,.tt-text-meta{font-size:.75rem;font-weight:600;color:color-mix(in srgb,var(--tt-accent) 60%,var(--ink,#1d1d1f));text-transform:uppercase}.tt-text-title{font-size:clamp(2.5rem,6vw,5.5rem);line-height:.95;font-weight:750}.tt-text-subtitle{font-size:clamp(1.1rem,2.2vw,1.55rem);line-height:1.35;color:var(--muted,#6e6e73)}.tt-text-heading{font-size:1.45rem;line-height:1.15;font-weight:700}.tt-text-body{font-size:1rem;line-height:1.6}.tt-text-caption,.tt-metadata{font-size:.85rem;line-height:1.45;color:var(--muted,#6e6e73)}
.tt-document[data-title-scale="compact"] .tt-text-title{font-size:clamp(2rem,4vw,3.75rem)}.tt-document[data-title-scale="large"] .tt-text-title{font-size:clamp(3rem,8vw,7rem)}
.tt-document[data-alignment="start"] .tt-masthead{text-align:left;align-items:flex-start}.tt-document[data-alignment="start"] .tt-byline,.tt-document[data-alignment="start"] .tt-metadata{justify-content:flex-start}
.tt-prose{width:min(var(--tt-measure),calc(100% - 2rem));margin-inline:auto;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:1.06rem;line-height:1.7}.tt-prose>*:first-child{margin-top:0}.tt-prose h1,.tt-prose h2,.tt-prose h3{line-height:1.15;margin:2em 0 .65em}.tt-prose img,.tt-prose video{display:block;max-width:100%;height:auto;margin:1.75rem auto}.tt-prose a{color:color-mix(in srgb,var(--tt-accent) 60%,var(--ink,#1d1d1f));text-underline-offset:.18em}.tt-prose pre{overflow:auto;white-space:pre-wrap;overflow-wrap:break-word;padding:1rem;background:color-mix(in srgb,var(--ink,#1d1d1f) 7%,transparent)}
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
.tt-rows-steps{list-style:none;margin-block:0;padding:0;counter-reset:tt-step;display:flex;flex-direction:column;gap:1rem}
.tt-rows-step{counter-increment:tt-step;display:flex;gap:1rem;align-items:flex-start}
.tt-rows-step::before{content:counter(tt-step);font-size:1.6rem;font-weight:750;line-height:1.1;min-width:2rem;color:color-mix(in srgb,var(--tt-accent) 60%,var(--ink,#1d1d1f))}
.tt-rows-step-body{display:flex;flex-direction:column;gap:.15rem}
.tt-rows-step-lead{font-weight:600}
.tt-rows-step-detail{font-size:.85rem;color:var(--muted,#6e6e73)}
.tt-rows-timeline{list-style:none;margin-block:0;padding:0 0 0 1.1rem;border-left:2px solid color-mix(in srgb,var(--ink,#1d1d1f) 14%,transparent);display:flex;flex-direction:column;gap:1rem}
.tt-rows-timeline li{position:relative}
.tt-rows-timeline li::before{content:"";position:absolute;left:-1.42rem;top:.35rem;width:.55rem;height:.55rem;border-radius:50%;background:color-mix(in srgb,var(--tt-accent) 60%,var(--ink,#1d1d1f))}
.tt-rows-timeline-date{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:color-mix(in srgb,var(--tt-accent) 60%,var(--ink,#1d1d1f))}
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
.tt-quote{margin-block:0;overflow-wrap:anywhere}
.tt-quote p{margin:0}
.tt-quote[data-variant="block"],.tt-quote[data-variant="attributed"]{border-left:3px solid color-mix(in srgb,var(--ink,#1d1d1f) 18%,transparent);padding-left:1rem;font-size:1.02rem;line-height:1.6;color:color-mix(in srgb,var(--ink,#1d1d1f) 78%,transparent)}
.tt-quote[data-variant="pull"]{text-align:center;font-size:clamp(1.4rem,3vw,2rem);line-height:1.3;font-weight:600}
.tt-quote-attribution{margin-top:.5rem;font-size:.85rem;font-weight:600;color:var(--muted,#6e6e73)}
.tt-document.tt-collection-item{padding-bottom:0}

/* Article */
.tt-document[data-template="texttext.article"]{--tt-accent:#1a8917;--tt-measure:42.5rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.article"]>.tt-stack{gap:2.75rem;padding:clamp(2.5rem,7vw,6rem) 0 5rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.article"] .tt-masthead{gap:1rem}
.tt-document[data-template="texttext.article"] .tt-text-title{font-family:Charter,"Iowan Old Style","Palatino Linotype",Palatino,serif;font-size:clamp(3rem,7vw,5.75rem);font-weight:700;line-height:.96;letter-spacing:-.025em}
.tt-document[data-template="texttext.article"] .tt-text-subtitle{font-family:Charter,"Iowan Old Style","Palatino Linotype",Palatino,serif;font-size:clamp(1.25rem,2vw,1.55rem);line-height:1.35}
.tt-document[data-template="texttext.article"] .tt-prose{font-family:Charter,"Iowan Old Style","Palatino Linotype",Palatino,serif;font-size:1.22rem;line-height:1.78}
.tt-document[data-template="texttext.article"] .tt-cover{width:min(72rem,calc(100% - 2rem));height:auto;aspect-ratio:16/9;border-radius:0}
.tt-document.tt-collection-item[data-template="texttext.article"] .tt-text-title{font-size:1.55rem;line-height:1.12;letter-spacing:-.01em}
.tt-document.tt-collection-item[data-template="texttext.article"] .tt-text-subtitle{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:.94rem;line-height:1.45}

/* Note */
.tt-document[data-template="texttext.note"]{--tt-accent:#ffb900;--paper:#fffef8;--ink:#1c1c1e;--muted:#8e8e93;--tt-measure:44rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.note"]>.tt-stack{gap:1.15rem;padding:clamp(2.25rem,7vw,5.25rem) 0}
.tt-document[data-template="texttext.note"] .tt-text-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;font-size:clamp(2rem,4.5vw,3.35rem);font-weight:700;line-height:1.08;letter-spacing:0}
.tt-document[data-template="texttext.note"] .tt-metadata{justify-content:center;font-size:.78rem;color:#8e8e93}
.tt-document[data-template="texttext.note"] .tt-prose{font-size:1.08rem;line-height:1.62}
.tt-document[data-template="texttext.note"] .tt-prose a{color:#c78800}
.tt-document.tt-collection-item[data-template="texttext.note"]{background:#fffef8}
.tt-document.tt-collection-item[data-template="texttext.note"] .tt-text-title{font-size:1.3rem}
.tt-document.tt-collection-item[data-template="texttext.note"] .tt-metadata{justify-content:flex-start}

/* Bookmark */
.tt-document[data-template="texttext.bookmark"]{--tt-accent:#835f42;--paper:#f6f1e7;--ink:#26231f;--muted:#7a7167;--tt-measure:39rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.bookmark"]>.tt-stack{gap:2.1rem;padding:clamp(2.75rem,8vw,6.5rem) 0 5rem}
.tt-document[data-template="texttext.bookmark"] .tt-text-title{font-family:Georgia,"Iowan Old Style",serif;font-size:clamp(2.7rem,6vw,4.8rem);font-weight:700;line-height:1.02;letter-spacing:-.015em}
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
.tt-document[data-template="texttext.gallery"] .tt-text-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;font-size:clamp(2.6rem,6vw,5rem);font-weight:750;line-height:1;letter-spacing:0}
.tt-document[data-template="texttext.gallery"] [data-tt-node="gallery-media"]{grid-template-columns:repeat(auto-fill,minmax(12rem,1fr));gap:1rem;width:min(78rem,100%);margin-inline:auto}
.tt-document[data-template="texttext.gallery"] .tt-gallery figure{break-inside:avoid}
.tt-document[data-template="texttext.gallery"] .tt-gallery img,.tt-document[data-template="texttext.gallery"] .tt-gallery video{aspect-ratio:4/5;border-radius:.5rem}
.tt-document[data-template="texttext.gallery"] .tt-gallery figure:nth-child(3n+2) img,.tt-document[data-template="texttext.gallery"] .tt-gallery figure:nth-child(3n+2) video{aspect-ratio:1/1}
.tt-document[data-template="texttext.gallery"] .tt-gallery figure:nth-child(3n) img,.tt-document[data-template="texttext.gallery"] .tt-gallery figure:nth-child(3n) video{aspect-ratio:3/4}
.tt-document.tt-collection-item[data-template="texttext.gallery"] .tt-text-title{font-size:1.4rem}
.tt-document.tt-collection-item[data-template="texttext.gallery"] .tt-gallery{grid-template-columns:repeat(2,minmax(0,1fr));gap:.35rem}
.tt-document.tt-collection-item[data-template="texttext.gallery"] .tt-gallery img,.tt-document.tt-collection-item[data-template="texttext.gallery"] .tt-gallery video{border-radius:.35rem}

/* Talk */
.tt-document[data-template="texttext.talk"]{--tt-accent:#ff0033;--tt-measure:68rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.talk"]>.tt-stack{gap:1.4rem;padding:clamp(1.5rem,4vw,3rem) 0 5rem}
.tt-document[data-template="texttext.talk"] .tt-video{width:min(76rem,calc(100% - 2rem));height:auto;aspect-ratio:16/9;border-radius:.5rem;background:#000}
.tt-document[data-template="texttext.talk"] .tt-text-title{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;font-size:clamp(1.8rem,3.5vw,2.6rem);font-weight:700;line-height:1.12;letter-spacing:0}
.tt-document[data-template="texttext.talk"] .tt-masthead{gap:.55rem}
.tt-document[data-template="texttext.talk"] .tt-byline{margin-top:.35rem}
.tt-document[data-template="texttext.talk"] .tt-prose{font-size:1rem;line-height:1.65}
.tt-document.tt-collection-item[data-template="texttext.talk"] .tt-text-title{font-size:1.3rem}

/* Checklist */
.tt-document[data-template="texttext.todo"]{--tt-accent:#0a84ff;--paper:#f2f2f7;--ink:#1c1c1e;--muted:#8e8e93;--tt-measure:42rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.todo"]>.tt-stack{gap:1.25rem;padding:clamp(2rem,6vw,4.5rem) 0 5rem}
.tt-document[data-template="texttext.todo"] .tt-text-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;font-size:clamp(2.4rem,5vw,4.1rem);font-weight:750;line-height:1;letter-spacing:0;color:#0a84ff}
.tt-document[data-template="texttext.todo"] .tt-checklist{padding:.25rem 1rem;background:#fff;border-radius:.5rem}
.tt-document[data-template="texttext.todo"] .tt-checklist-items{gap:0}
.tt-document[data-template="texttext.todo"] .tt-checklist-item{min-height:2.9rem;padding:.55rem 0;border-bottom:1px solid #e5e5ea;flex-wrap:nowrap}
.tt-document[data-template="texttext.todo"] .tt-checklist-item:last-child{border-bottom:0}
.tt-document[data-template="texttext.todo"] .tt-checkbox{width:1.35rem;height:1.35rem;border-radius:50%;border-color:#0a84ff}
.tt-document.tt-collection-item[data-template="texttext.todo"] .tt-text-title{font-size:1.45rem;color:#0a84ff}
.tt-document.tt-collection-item[data-template="texttext.todo"] .tt-checklist{padding:.15rem .75rem}

/* Project */
.tt-document[data-template="texttext.project"]{--tt-accent:#2383e2;--tt-measure:52rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.project"]>.tt-stack{gap:1.35rem;padding:clamp(3rem,8vw,7rem) 0 5rem}
.tt-document[data-template="texttext.project"] .tt-text-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;font-size:clamp(2.6rem,5vw,4.6rem);font-weight:700;line-height:1.05;letter-spacing:-.015em}
.tt-document[data-template="texttext.project"] .tt-masthead{gap:.7rem}
.tt-document[data-template="texttext.project"] .tt-facts-table{padding:.85rem 0;border-top:1px solid color-mix(in srgb,var(--ink) 12%,transparent);border-bottom:1px solid color-mix(in srgb,var(--ink) 12%,transparent)}
.tt-document[data-template="texttext.project"] .tt-prose{font-size:1rem;line-height:1.65}
.tt-document[data-template="texttext.project"] .tt-checklist,.tt-document[data-template="texttext.project"] .tt-rows{padding:.9rem 1rem;border:1px solid color-mix(in srgb,var(--ink) 12%,transparent);border-radius:.35rem}
.tt-document.tt-collection-item[data-template="texttext.project"] .tt-text-title{font-size:1.45rem}
.tt-document.tt-collection-item[data-template="texttext.project"] .tt-facts{font-size:.8rem}

/* Newsletter */
.tt-document[data-template="texttext.newsletter"]{--tt-accent:#ff6719;--tt-measure:42rem}
.tt-document:not(.tt-collection-item)[data-template="texttext.newsletter"]>.tt-stack{gap:2rem;padding:clamp(2.5rem,7vw,6rem) 0 5rem}
.tt-document[data-template="texttext.newsletter"] .tt-masthead{text-align:center;align-items:center}
.tt-document[data-template="texttext.newsletter"] .tt-text-title{font-family:Georgia,"Iowan Old Style",serif;font-size:clamp(2.8rem,6vw,5rem);font-weight:700;line-height:1;letter-spacing:-.015em}
.tt-document[data-template="texttext.newsletter"] .tt-text-subtitle{font-family:Georgia,"Iowan Old Style",serif;font-size:1.2rem}
.tt-document[data-template="texttext.newsletter"] .tt-cover{width:min(52rem,calc(100% - 2rem));height:auto;aspect-ratio:16/9;border-radius:0}
.tt-document[data-template="texttext.newsletter"] .tt-prose{font-family:Georgia,"Iowan Old Style",serif;font-size:1.16rem;line-height:1.78}
.tt-document[data-template="texttext.newsletter"] .tt-rows-tiles{display:flex;flex-direction:column;gap:0}
.tt-document[data-template="texttext.newsletter"] .tt-rows-tile{padding:1.1rem 0;border-radius:0;border-bottom:1px solid color-mix(in srgb,var(--ink) 14%,transparent);background:transparent}
.tt-document[data-template="texttext.newsletter"] .tt-rows-tile-value{font-family:Georgia,"Iowan Old Style",serif;font-size:1.2rem}
.tt-document.tt-collection-item[data-template="texttext.newsletter"] .tt-text-title{font-size:1.5rem}

@media(max-width:720px){.tt-stack[data-direction="horizontal"]{flex-direction:column}.tt-text-title{font-size:clamp(2.3rem,13vw,4rem)}.tt-height-large{height:38vh}.tt-document[data-template="texttext.gallery"] [data-tt-node="gallery-media"]{grid-template-columns:repeat(2,minmax(0,1fr))}.tt-document[data-template="texttext.article"] .tt-prose,.tt-document[data-template="texttext.bookmark"] .tt-prose,.tt-document[data-template="texttext.newsletter"] .tt-prose{font-size:1.08rem}.tt-document[data-template="texttext.todo"] .tt-checklist{border-radius:0}}
@media(prefers-color-scheme:dark){
  .tt-document{--ink:#f5f5f7;--paper:#1c1c1e;--muted:#a1a1a6;--tt-tone-neutral:#98989d;--tt-tone-info:#409cff;--tt-tone-success:#30d158;--tt-tone-warning:#ffd60a;--tt-tone-danger:#ff453a}
  .tt-document[data-template="texttext.note"]{--paper:#1c1c1e;--ink:#f5f5f7;--muted:#98989d}.tt-document.tt-collection-item[data-template="texttext.note"]{background:#1c1c1e}
  .tt-document[data-template="texttext.bookmark"]{--paper:#211f1a;--ink:#f3eee4;--muted:#aaa094}
  .tt-document[data-template="texttext.todo"]{--paper:#000;--ink:#f5f5f7;--muted:#8e8e93}.tt-document[data-template="texttext.todo"] .tt-checklist{background:#1c1c1e}.tt-document[data-template="texttext.todo"] .tt-checklist-item{border-color:#38383a}
}
@media(prefers-reduced-motion:reduce){.tt-document *{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}
`;
