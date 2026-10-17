import { createMirrorPolicyHost } from "./mirror-policy-host";
declare const TEXTTEXT_MIRROR_POLICY_DIGEST: string;
const host = createMirrorPolicyHost(TEXTTEXT_MIRROR_POLICY_DIGEST, crypto.randomUUID());
Object.defineProperty(window, "texttextMirrorPolicy", { value: host, writable: false, configurable: false });
window.addEventListener("pagehide", () => host.retire(), { once: true });
