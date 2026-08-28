import { z } from "zod";

export const appHealthIdentifierSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/);

export const appHealthReleaseValueSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/);

export const appHealthStatusSchema = z.enum(["pass", "warning", "fail"]);

export const appHealthTriggerSchema = z.enum([
  "versionLaunch",
  "periodic",
  "manual",
  "releaseVerification",
]);

export const appHealthCheckSchema = z
  .object({
    id: appHealthIdentifierSchema,
    status: appHealthStatusSchema,
    durationMilliseconds: z.number().int().min(0).max(15 * 60 * 1_000),
    metrics: z
      .record(
        appHealthIdentifierSchema,
        z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
      )
      .refine((value) => Object.keys(value).length <= 32),
  })
  .strict();

const appHealthReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    appIdentifier: appHealthIdentifierSchema,
    appVersion: appHealthReleaseValueSchema,
    buildNumber: appHealthReleaseValueSchema,
    installationId: z.string().uuid(),
    operatingSystemVersion: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 ._()+-]*$/),
    trigger: appHealthTriggerSchema,
    generatedAt: z.string().datetime({ offset: true }),
    status: appHealthStatusSchema,
    checks: z
      .array(appHealthCheckSchema)
      .min(1)
      .max(100)
      .refine(
        (checks) => new Set(checks.map((check) => check.id)).size === checks.length,
      ),
  })
  .strict();

export type AppHealthReport = z.infer<typeof appHealthReportSchema>;

export function parseAppHealthReport(value: unknown): AppHealthReport | null {
  const parsed = appHealthReportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
