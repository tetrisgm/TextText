export type AssistantConfirmationRequest = {
  description: string;
};

type AssistantConfirmationController = {
  cancel: () => void;
  confirm: () => void;
  dispose: () => void;
  request: (description: string) => Promise<boolean>;
};

export function createAssistantConfirmationController(
  onChange: (request: AssistantConfirmationRequest | null) => void,
): AssistantConfirmationController {
  let resolvePending: ((allowed: boolean) => void) | null = null;

  const settle = (allowed: boolean) => {
    const resolve = resolvePending;
    if (!resolve) return;
    resolvePending = null;
    onChange(null);
    resolve(allowed);
  };

  return {
    cancel: () => settle(false),
    confirm: () => settle(true),
    dispose: () => settle(false),
    request: (description) => {
      const normalized = description.trim();
      if (!normalized) return Promise.resolve(false);
      if (resolvePending) settle(false);
      return new Promise<boolean>((resolve) => {
        resolvePending = resolve;
        try {
          onChange({ description: normalized });
        } catch {
          settle(false);
        }
      });
    },
  };
}
