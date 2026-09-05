import {
  ASSISTANT_SIDEBAR_DEFAULT_WIDTH,
  ASSISTANT_SIDEBAR_MAX_WIDTH,
  ASSISTANT_SIDEBAR_MIN_WIDTH,
} from "./constants";

function positiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resolveAssistantSidebarDimensions({
  availableWidth,
  maxWidth,
  minWidth,
  width,
}: {
  availableWidth?: number | null;
  maxWidth: number;
  minWidth: number;
  width: number;
}) {
  const configuredMin = Math.round(
    positiveNumber(minWidth, ASSISTANT_SIDEBAR_MIN_WIDTH),
  );
  const configuredMax = Math.max(
    configuredMin,
    Math.round(positiveNumber(maxWidth, ASSISTANT_SIDEBAR_MAX_WIDTH)),
  );
  const viewportLimit =
    availableWidth !== null &&
    availableWidth !== undefined &&
    Number.isFinite(availableWidth) &&
    availableWidth > 0
      ? Math.max(1, Math.floor(availableWidth))
      : null;
  const resolvedMinWidth = viewportLimit
    ? Math.min(configuredMin, viewportLimit)
    : configuredMin;
  const resolvedMaxWidth = viewportLimit
    ? Math.max(resolvedMinWidth, Math.min(configuredMax, viewportLimit))
    : configuredMax;
  const resolvedWidth = Math.round(
    clamp(
      positiveNumber(width, ASSISTANT_SIDEBAR_DEFAULT_WIDTH),
      resolvedMinWidth,
      resolvedMaxWidth,
    ),
  );

  return { resolvedMaxWidth, resolvedMinWidth, resolvedWidth };
}
