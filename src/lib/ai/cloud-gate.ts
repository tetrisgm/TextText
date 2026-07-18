export type ConfiguredCloudKey = { apiKey: string };

export function cloudEnabled(
  config: ConfiguredCloudKey | null,
  gatewayApiKey = process.env.AI_GATEWAY_API_KEY,
): boolean {
  return Boolean(config?.apiKey || gatewayApiKey);
}
