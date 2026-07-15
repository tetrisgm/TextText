import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/);

export const appHealthReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    appIdentifier: identifier,
    appVersion: z.string().min(1).max(32),
    buildNumber: z.string().min(1).max(32),
    installationId: z.string().uuid(),
    operatingSystemVersion: z.string().min(1).max(160),
    trigger: z.enum([
      "versionLaunch",
      "periodic",
      "manual",
      "releaseVerification",
    ]),
    generatedAt: z.string().datetime({ offset: true }),
    status: z.enum(["pass", "warning", "fail"]),
    checks: z
      .array(
        z
          .object({
            id: identifier,
            status: z.enum(["pass", "warning", "fail"]),
            durationMilliseconds: z.number().int().min(0).max(15 * 60 * 1_000),
            metrics: z
              .record(
                identifier,
                z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
              )
              .refine((value) => Object.keys(value).length <= 32),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export type AppHealthReport = z.infer<typeof appHealthReportSchema>;

export function parseAppHealthReport(value: unknown): AppHealthReport | null {
  const parsed = appHealthReportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
