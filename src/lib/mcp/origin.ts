// MCP metadata, challenges and origin checks share the app's validated
// public origin, including when Next exposes an internal listener address.
export { requestPublicOrigin as publicOrigin } from "@/lib/request-origin";
