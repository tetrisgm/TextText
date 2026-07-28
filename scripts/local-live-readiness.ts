export const localLiveReadinessPaths = [
  "/signin",
  "/.well-known/oauth-authorization-server",
] as const;

export type LocalLiveReadinessProbe = {
  path: (typeof localLiveReadinessPaths)[number];
  status: number | "error";
};

export function isLocalLiveServerReady(
  probes: readonly LocalLiveReadinessProbe[],
): boolean {
  if (probes.length !== localLiveReadinessPaths.length) return false;

  return localLiveReadinessPaths.every((path) => {
    const probe = probes.find((candidate) => candidate.path === path);
    return (
      probe !== undefined &&
      typeof probe.status === "number" &&
      probe.status >= 200 &&
      probe.status < 400
    );
  });
}

export function formatLocalLiveReadiness(
  probes: readonly LocalLiveReadinessProbe[],
): string {
  return probes
    .map((probe) => `${probe.path}=${String(probe.status)}`)
    .join(", ");
}
