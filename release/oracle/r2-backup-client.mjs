// Private R2 object access for encrypted off-box backups. The r2:// locator is
// internal to this process; no backup bucket URL is made public.
const backupKey = /^backups\/oracle\/texttext\/texttext-\d{8}T\d{6}Z-[a-f0-9]{8}\.dump\.aes256gcm$/;
const accountId = /^[a-f0-9]{32}$/i;
const accessKey = /^[A-Za-z0-9_-]{8,128}$/;
const bucketName = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

function settings(environment) {
  const account = environment.TEXTTEXT_R2_ACCOUNT_ID;
  const bucket = environment.TEXTTEXT_BACKUP_R2_BUCKET || "texttext-backups";
  const keyId = environment.TEXTTEXT_R2_ACCESS_KEY_ID;
  const secret = environment.TEXTTEXT_R2_SECRET_ACCESS_KEY;
  if (!accountId.test(account || "") || !bucketName.test(bucket) ||
      !accessKey.test(keyId || "") || typeof secret !== "string" || secret.length < 16) {
    throw new Error("Private R2 backup store credentials are not configured.");
  }
  return { account, bucket, keyId, secret };
}

function keyFromLocator(locator, bucket) {
  const prefix = `r2://${bucket}/`;
  const key = typeof locator === "string" && locator.startsWith(prefix) ? locator.slice(prefix.length) : "";
  if (!backupKey.test(key)) throw new Error("Invalid private backup locator.");
  return key;
}

export async function createR2BackupClient(environment, injected = {}) {
  const { account, bucket, keyId, secret } = settings(environment);
  const sdk = injected.sdk ?? await import("@aws-sdk/client-s3");
  const client = injected.client ?? new sdk.S3Client({
    region: "auto", endpoint: `https://${account}.r2.cloudflarestorage.com`, forcePathStyle: true,
    credentials: { accessKeyId: keyId, secretAccessKey: secret },
  });
  const send = (command, options) => client.send(command, { abortSignal: options?.abortSignal });
  const locator = key => `r2://${bucket}/${key}`;
  return {
    async list(options = {}) {
      if (options.prefix !== "backups/oracle/texttext/" || options.limit !== 100) throw new Error("Invalid backup inventory request.");
      const result = await send(new sdk.ListObjectsV2Command({ Bucket: bucket, Prefix: options.prefix, MaxKeys: 101 }), options);
      const blobs = (result.Contents ?? []).map(entry => {
        if (typeof entry.Key !== "string" || !backupKey.test(entry.Key) ||
            !Number.isSafeInteger(entry.Size) || entry.Size < 0) throw new Error("Unexpected backup object in R2.");
        return { pathname: entry.Key, url: locator(entry.Key), size: entry.Size, uploadedAt: entry.LastModified?.toISOString() };
      });
      return { blobs, hasMore: Boolean(result.IsTruncated || result.NextContinuationToken || blobs.length > 100) };
    },
    async put(key, body, options = {}) {
      if (!backupKey.test(key) || options.allowOverwrite !== false || options.addRandomSuffix !== false ||
          !Number.isSafeInteger(options.contentLength) || options.contentLength < 37) {
        throw new Error("Invalid private backup upload.");
      }
      await send(new sdk.PutObjectCommand({ Bucket: bucket, Key: key, Body: body,
        ContentLength: options.contentLength, ContentType: "application/octet-stream", IfNoneMatch: "*" }), options);
      return { pathname: key, url: locator(key) };
    },
    async get(url, options = {}) {
      const key = keyFromLocator(url, bucket);
      const result = await send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }), options);
      if (!result.Body) throw new Error("R2 returned an empty backup body.");
      return { statusCode: result.$metadata?.httpStatusCode ?? 200, stream: result.Body };
    },
    async del(urls, options = {}) {
      const targets = Array.isArray(urls) ? urls : [urls];
      if (!targets.length || targets.length > 100) throw new Error("Invalid backup cleanup batch.");
      for (const url of targets) {
        await send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: keyFromLocator(url, bucket) }), options);
      }
    },
  };
}
