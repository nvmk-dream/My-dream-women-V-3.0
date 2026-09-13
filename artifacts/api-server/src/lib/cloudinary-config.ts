import { v2 as cloudinary } from "cloudinary";

function firstConfigured(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * Configure Cloudinary from the Render environment.
 *
 * API_KEY/API_SECRET are the current Render variable names used by this
 * project. The other names are kept only for older deployments.
 */
export function configureCloudinary(context = "Cloudinary") {
  const cloudName = firstConfigured("CLOUDINARY_CLOUD_NAME", "CLOUDNARY_USER_NAME");
  const apiKey = firstConfigured("API_KEY", "CLOUDINARY_API_KEY", "Cloudinary_abi_key");
  const apiSecret = firstConfigured("API_SECRET", "CLOUDINARY_API_SECRET", "Cloudinary_secret");

  const missing: string[] = [];
  if (!cloudName) missing.push("CLOUDINARY_CLOUD_NAME");
  if (!apiKey) missing.push("API_KEY");
  if (!apiSecret) missing.push("API_SECRET");
  if (missing.length > 0) {
    throw new Error(`${context} configuration is missing: ${missing.join(", ")}`);
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  return cloudinary;
}

export type CloudinaryClient = ReturnType<typeof configureCloudinary>;