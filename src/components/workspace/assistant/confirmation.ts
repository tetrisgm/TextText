export type AssistantConfirmationRequest = {
  description: string;
};

export type AssistantConfirmationController = {
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
      if (resolvePending) settle(false);
      return new Promise<boolean>((resolve) => {
        resolvePending = resolve;
        onChange({ description });
      });
    },
  };
}
