import type { PointerEvent as ReactPointerEvent } from "react";

const CARD_TILT_X = 8.25;
const CARD_TILT_Y = 9;

export function updateSpatialCardTilt(
  event: ReactPointerEvent<HTMLDivElement>,
) {
  if (event.pointerType === "touch") return;

  const card = event.currentTarget;
  card.classList.add("is-spatial-hover");
  const bounds = card.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));

  card.style.setProperty(
    "--card-rx",
    `${(0.5 - y) * CARD_TILT_X * 2}deg`,
  );
  card.style.setProperty(
    "--card-ry",
    `${(x - 0.5) * CARD_TILT_Y * 2}deg`,
  );
}

export function resetSpatialCardTilt(
  event: ReactPointerEvent<HTMLDivElement>,
) {
  const card = event.currentTarget;
  card.classList.remove("is-spatial-hover");
  card.style.setProperty("--card-rx", "0deg");
  card.style.setProperty("--card-ry", "0deg");
}
