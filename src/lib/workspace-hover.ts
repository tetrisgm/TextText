type WorkspaceHoverTracker = {
  disarm: () => void;
  moved: (clientX: number, clientY: number) => boolean;
};

export function createWorkspaceHoverTracker(): WorkspaceHoverTracker {
  let lastPoint: { x: number; y: number } | null = null;
  let armed = false;

  return {
    disarm() {
      armed = false;
    },
    moved(clientX, clientY) {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
      const changed =
        !lastPoint || lastPoint.x !== clientX || lastPoint.y !== clientY;
      lastPoint = { x: clientX, y: clientY };
      if (changed) armed = true;
      return armed && changed;
    },
  };
}

const workspaceHoverTracker = createWorkspaceHoverTracker();

export function disarmWorkspaceHover() {
  workspaceHoverTracker.disarm();
}

export function workspaceMouseMoved(clientX: number, clientY: number) {
  return workspaceHoverTracker.moved(clientX, clientY);
}
