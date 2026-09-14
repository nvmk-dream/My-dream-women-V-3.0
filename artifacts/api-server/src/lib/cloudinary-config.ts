import { v2 as cloudinary } from "cloudinary";

type CloudinarySettings = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

function firstConfiguredWithSource(...names: string[]): { value: string; source: string | null } {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { value, source: name };
  }
  return { value: "", source: null };
}

function readSettings(): CloudinarySettings {
  const cloudName = firstConfiguredWithSource("CLOUDINARY_CLOUD_NAME", "CLOUDNARY_USER_NAME");
  const apiKey = firstConfiguredWithSource("API_KEY", "CLOUDINARY_API_KEY", "Cloudinary_abi_key");
  const apiSecret = firstConfiguredWithSource("API_SECRET", "CLOUDINARY_API_SECRET", "Cloudinary_secret");
  return {
    cloudName: cloudName.value,
    apiKey: apiKey.value,
    apiSecret: apiSecret.value,
  };
}

/**
 * Configure Cloudinary from the Render environment.
 *
 * API_KEY/API_SECRET are the current Render variable names used by this
 * project. The other names are kept only for older deployments.
 */
export function configureCloudinary(context = "Cloudinary") {
  const { cloudName, apiKey, apiSecret } = readSettings();

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