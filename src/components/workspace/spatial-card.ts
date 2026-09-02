import type { PointerEvent as ReactPointerEvent } from "react";

const CARD_TILT_X = 8.25;
const CARD_TILT_Y = 9;

type CardMotionState = {
  bounds: DOMRect;
  frame: number | null;
  tilts: boolean;
  x: number;
  y: number;
};

const cardMotion = new WeakMap<HTMLElement, CardMotionState>();

/** Only grid-view cards render the tilt vars; everywhere else the writes
 * would dirty style on every mouse move for nothing. Checked once per hover
 * (the closest() walk), not once per move. */
function cardTilts(card: HTMLElement): boolean {
  return Boolean(
    card.closest(
      ".workspace-recent.is-view-grid, .universal-item-collection.is-grid",
    ),
  );
}

export function updateSpatialCardTilt(
  event: ReactPointerEvent<HTMLDivElement>,
) {
  if (event.pointerType === "touch") return;

  const card = event.currentTarget;
  let state = cardMotion.get(card);
  if (!state) {
    state = {
      bounds: card.getBoundingClientRect(),
      frame: null,
      tilts: cardTilts(card),
      x: event.clientX,
      y: event.clientY,
    };
    cardMotion.set(card, state);
    if (state.tilts) card.classList.add("is-spatial-hover");
  }
  if (!state.tilts) return;
  state.x = event.clientX;
  state.y = event.clientY;

  if (state.frame !== null) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = null;
    const x = Math.max(
      0,
      Math.min(1, (state.x - state.bounds.left) / state.bounds.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (state.y - state.bounds.top) / state.bounds.height),
    );
    card.style.setProperty(
      "--card-rx",
      `${(0.5 - y) * CARD_TILT_X * 2}deg`,
    );
    card.style.setProperty(
      "--card-ry",
      `${(x - 0.5) * CARD_TILT_Y * 2}deg`,
    );
  });
}

export function resetSpatialCardTilt(
  event: ReactPointerEvent<HTMLDivElement>,
) {
  const card = event.currentTarget;
  const state = cardMotion.get(card);
  if (!state) return;
  if (state.frame !== null) cancelAnimationFrame(state.frame);
  cardMotion.delete(card);
  if (!state.tilts) return;
  card.classList.remove("is-spatial-hover");
  card.style.setProperty("--card-rx", "0deg");
  card.style.setProperty("--card-ry", "0deg");
}
