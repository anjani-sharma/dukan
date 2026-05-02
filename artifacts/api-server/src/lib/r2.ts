import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { logger } from "./logger";

function getR2Client() {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<string | null> {
  const client = getR2Client();
  const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;

  if (!client || !bucket || !publicUrl) {
    logger.warn("R2 not configured — falling back to base64 storage");
    return null;
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  return `${publicUrl.replace(/\/$/, "")}/${key}`;
}

export async function deleteFromR2(key: string): Promise<void> {
  const client = getR2Client();
  const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  if (!client || !bucket) return;

  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    logger.warn({ err, key }, "Failed to delete R2 object");
  }
}

export function keyFromUrl(url: string): string | null {
  const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;
  if (!publicUrl || !url.startsWith(publicUrl)) return null;
  return url.replace(`${publicUrl.replace(/\/$/, "")}/`, "");
}
