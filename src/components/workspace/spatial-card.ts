import type { PointerEvent as ReactPointerEvent } from "react";

const CARD_TILT_X = 8.25;
const CARD_TILT_Y = 9;

type CardMotionState = {
  bounds: DOMRect;
  frame: number | null;
  x: number;
  y: number;
};

const cardMotion = new WeakMap<HTMLElement, CardMotionState>();

export function updateSpatialCardTilt(
  event: ReactPointerEvent<HTMLDivElement>,
) {
  if (event.pointerType === "touch") return;

  const card = event.currentTarget;
  card.classList.add("is-spatial-hover");
  const state = cardMotion.get(card) ?? {
    bounds: card.getBoundingClientRect(),
    frame: null,
    x: event.clientX,
    y: event.clientY,
  };
  state.x = event.clientX;
  state.y = event.clientY;
  cardMotion.set(card, state);

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
  if (state?.frame !== null && state?.frame !== undefined) {
    cancelAnimationFrame(state.frame);
  }
  cardMotion.delete(card);
  card.classList.remove("is-spatial-hover");
  card.style.setProperty("--card-rx", "0deg");
  card.style.setProperty("--card-ry", "0deg");
}
