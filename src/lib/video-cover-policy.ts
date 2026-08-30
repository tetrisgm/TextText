export type VideoCoverActivation = {
  nearViewport: boolean;
  pageVisible: boolean;
  reducedMotion: boolean;
};

/** Video covers are decoration, so they never consume media resources in the
 * background, far offscreen, or when motion has been disabled. */
export function shouldActivateVideoCover({
  nearViewport,
  pageVisible,
  reducedMotion,
}: VideoCoverActivation): boolean {
  return nearViewport && pageVisible && !reducedMotion;
}
