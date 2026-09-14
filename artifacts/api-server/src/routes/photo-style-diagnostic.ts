import { createRequire } from "node:module";
import crypto from "node:crypto";
import { Router, type Response } from "express";
import { cloudinaryRuntimeSummary, configureCloudinary, type CloudinaryClient } from "../lib/cloudinary-config";

const router = Router();
const require = createRequire(import.meta.url);
const cloudinarySdkVersion = String(require("cloudinary/package.json").version ?? "unknown");

type CloudinaryDiagnosticError = {
  cloudinaryHttpCode: number | null;
  cloudinaryErrorCode: string | null;
  cloudinaryMessage: string;
};

type DiagnosticFailure = CloudinaryDiagnosticError & {
  success: false;
  stage: string;
  folder: string | null;
  resourceType?: string;
};

function errorDetails(error: any): CloudinaryDiagnosticError {
  const nested = error?.error ?? {};
  const httpValue = error?.http_code ?? error?.statusCode ?? error?.status ?? nested?.http_code ?? nested?.statusCode;
  const httpCode = Number.isFinite(Number(httpValue)) ? Number(httpValue) : null;
  const codeValue = error?.code ?? nested?.code ?? error?.error_code ?? nested?.error_code;
  const message = String(error?.message ?? nested?.message ?? error ?? "Unknown Cloudinary error");
  return {
    cloudinaryHttpCode: httpCode,
    cloudinaryErrorCode: codeValue == null ? null : String(codeValue),
    cloudinaryMessage: message,
  };
}

function failure(
  response: Response,
  status: number,
  stage: string,
  folder: string | null,
  error: unknown,
  extra: Record<string, unknown> = {},
) {
  const details = errorDetails(error);
  const body: DiagnosticFailure & Record<string, unknown> = {
    success: false,
    stage,
    folder,
    ...details,
    ...extra,
  };
  return response.status(status).json(body);
}

function sameSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(req: any): boolean {
  const expected = process.env.PHOTO_STYLE_DIAGNOSTIC_TOKEN?.trim() || process.env.SESSION_SECRET?.trim() || "";
  const provided = String(req.get("x-photo-style-diagnostic-token") ?? "").trim()
    || String(req.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return Boolean(expected && provided && sameSecret(provided, expected));
}

function childName(root: string, rawName: unknown): string {
  const value = String(rawName ?? "").replace(/^\/+|\/+$/g, "");
  const prefix = `${root}/`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

async function listSubFolders(c: CloudinaryClient, root: string): Promise<string[]> {
  const names: string[] = [];
  let nextCursor: string | undefined;
  do {
    const options: Record<string, unknown> = { max_results: 500 };
    if (nextCursor) options.next_cursor = nextCursor;
    const page = await (c.api as any).sub_folders(root, options);
    for (const folder of page?.folders ?? []) {
      const name = childName(root, folder?.name);
      if (name && !names.includes(name)) names.push(name);
    }
    nextCursor = page?.next_cursor;
  } while (nextCursor);
  return names.sort((a, b) => a.localeCompare(b));
}

function safeResource(resource: any) {
  return {
    publicId: String(resource?.public_id ?? ""),
    resourceType: String(resource?.resource_type ?? ""),
    deliveryType: String(resource?.type ?? ""),
    assetFolder: resource?.asset_folder == null ? null : String(resource.asset_folder),
    bytes: Number.isFinite(Number(resource?.bytes)) ? Number(resource.bytes) : null,
    format: resource?.format == null ? null : String(resource.format),
    secureUrl: resource?.secure_url == null ? null : String(resource.secure_url),
  };
}

async function listResources(c: CloudinaryClient, folder: string, resourceType: string) {
  const resources: ReturnType<typeof safeResource>[] = [];
  let nextCursor: string | undefined;
  do {
    const options: Record<string, unknown> = {
      type: "upload",
      resource_type: resourceType,
      prefix: `${folder}/`,
      max_results: 500,
    };
    if (nextCursor) options.next_cursor = nextCursor;
    const page = await (c.api as any).resources(options);
    resources.push(...(page?.resources ?? []).map(safeResource));
    nextCursor = page?.next_cursor;
  } while (nextCursor);
  return resources;
}

function compactDeleteResult(result: any) {
  return {
    deletedCount: Object.keys(result?.deleted ?? {}).length,
    deleted: Object.keys(result?.deleted ?? {}),
    partial: result?.partial == null ? null : Boolean(result.partial),
    nextCursor: result?.next_cursor == null ? null : String(result.next_cursor),
  };
}

function compactFolderResult(result: any) {
  return {
    success: result?.success == null ? null : Boolean(result.success),
    deleted: Array.isArray(result?.deleted) ? result.deleted.map(String) : [],
  };
}

async function ping(c: CloudinaryClient) {
  return (c.api as any).ping();
}

const BUILTIN_FOLDER_NAMES = new Set([
  "normal",
  "nude",
  "seminude",
  "breast",
  "halfbreast",
  "cleavage",
  "lowneck",
  "lingerie",
  "buttocks",
  "highslit",
  "seductive",
  "wet",
  "legs",
  "saree",
  "sleeping",
]);

function normalizeRequestedFolder(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^\/+|\/+$/g, "") : "";
}

function chooseTestFolder(
  requested: string,
  globalFolders: string[],
  girlFolders: Array<{ girl: string; folders: string[] }>,
) {
  const allFolders = [
    ...globalFolders,
    ...girlFolders.flatMap((girl) => girl.folders),
  ];
  if (requested) {
    return allFolders.includes(requested) ? requested : null;
  }
  return globalFolders.find((folder) => {
    const styleName = folder.split("/").pop() ?? "";
    return !BUILTIN_FOLDER_NAMES.has(styleName.toLowerCase())
      && /(test|diagnostic|e2e)/i.test(styleName);
  }) ?? null;
}

function logStage(req: any, payload: Record<string, unknown>, message: string) {
  req.log?.info(payload, message);
}

/**
 * Temporary, destructive Cloudinary diagnostic.
 *
 * It is protected by PHOTO_STYLE_DIAGNOSTIC_TOKEN or SESSION_SECRET and is
 * intentionally not mounted under the public app's normal photo-style UI.
 * Remove this route after the live cleanup problem is identified.
 */
router.post("/admin/photo-styles/cloudinary-diagnostic", async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: "Diagnostic authorization required" });
  }

  const runtime = cloudinaryRuntimeSummary();
  const sdk = {
    package: "cloudinary",
    version: cloudinarySdkVersion,
    methodsChecked: [
      "api.ping",
      "api.sub_folders",
      "api.resources",
      "api.delete_resources_by_prefix",
      "api.delete_folder",
    ],
  };
  let c: CloudinaryClient;
  try {
    c = configureCloudinary("Photo Style diagnostic");
  } catch (error) {
    return failure(res, 503, "configure", null, error, { runtime, sdk });
  }

  try {
    await ping(c);
    logStage(req, { stage: "authenticate", success: true, runtime, sdk }, "Cloudinary diagnostic authentication succeeded");
  } catch (error) {
    const details = errorDetails(error);
    logStage(req, { stage: "authenticate", success: false, runtime, sdk, ...details }, "Cloudinary diagnostic authentication failed");
    return failure(res, 502, "authenticate", null, error, { runtime, sdk });
  }

  let globalStyleNames: string[];
  let girlNames: string[];
  try {
    globalStyleNames = await listSubFolders(c, "my-girls/global_styles");
    logStage(
      req,
      { stage: "list_global_style_folders", folder: "my-girls/global_styles", folders: globalStyleNames },
      "Cloudinary diagnostic listed global Photo Style folders",
    );
  } catch (error) {
    return failure(res, 502, "list_global_style_folders", "my-girls/global_styles", error, { runtime, sdk });
  }

  try {
    girlNames = (await listSubFolders(c, "my-girls"))
      .filter((name) => name !== "global_styles" && name !== "meta");
    logStage(
      req,
      { stage: "list_girls", folder: "my-girls", girls: girlNames },
      "Cloudinary diagnostic listed girl folders",
    );
  } catch (error) {
    return failure(res, 502, "list_girls", "my-girls", error, { runtime, sdk, globalStyleNames });
  }

  const globalFolders = globalStyleNames.map((name) => `my-girls/global_styles/${name}`);
  const girlFolders: Array<{ girl: string; folders: string[] }> = [];
  for (const girl of girlNames) {
    const root = `my-girls/${girl}`;
    try {
      const names = await listSubFolders(c, root);
      const folders = names.map((name) => `${root}/${name}`);
      girlFolders.push({ girl, folders });
      logStage(req, { stage: "list_girl_style_folders", folder: root, folders }, "Cloudinary diagnostic listed girl Photo Style folders");
    } catch (error) {
      return failure(res, 502, "list_girl_style_folders", root, error, {
        runtime,
        sdk,
        globalStyleFolders: globalFolders,
        girlFolders,
      });
    }
  }

  const requestedFolder = normalizeRequestedFolder(req.body?.folder ?? req.query?.folder);
  const selectedFolder = chooseTestFolder(requestedFolder, globalFolders, girlFolders);
  const inventory = {
    globalStyleFolders: globalFolders,
    girlStyleFolders: girlFolders,
  };
  if (!selectedFolder) {
    return res.status(400).json({
      success: false,
      stage: requestedFolder ? "select_test_folder" : "find_test_folder",
      folder: requestedFolder || null,
      cloudinaryHttpCode: null,
      cloudinaryErrorCode: null,
      cloudinaryMessage: requestedFolder
        ? "The requested folder was not found in the live Cloudinary folder inventory"
        : "No non-built-in test/diagnostic folder was found; create one in the app and pass its exact folder path",
      runtime,
      sdk,
      inventory,
    });
  }

  const resourcesBefore: Record<string, ReturnType<typeof safeResource>[]> = {};
  const operations: Array<Record<string, unknown>> = [];
  const failures: DiagnosticFailure[] = [];

  for (const resourceType of ["image", "video", "raw"]) {
    try {
      resourcesBefore[resourceType] = await listResources(c, selectedFolder, resourceType);
      logStage(
        req,
        { stage: "list_resources", folder: selectedFolder, resourceType, resourcesFound: resourcesBefore[resourceType].length, resources: resourcesBefore[resourceType] },
        "Cloudinary diagnostic listed resources",
      );
    } catch (error) {
      const details = errorDetails(error);
      const item: DiagnosticFailure = { success: false, stage: "list_resources", folder: selectedFolder, resourceType, ...details };
      failures.push(item);
      operations.push(item);
      logStage(req, item, "Cloudinary diagnostic resource listing failed");
      continue;
    }

    try {
      const deleteResult = await (c.api as any).delete_resources_by_prefix(`${selectedFolder}/`, {
        resource_type: resourceType,
        type: "upload",
        invalidate: true,
      });
      const compact = compactDeleteResult(deleteResult);
      const operation = {
        stage: "delete_resources_by_prefix",
        folder: selectedFolder,
        resourceType,
        cloudinaryHttpCode: null,
        cloudinaryErrorCode: null,
        cloudinaryMessage: "Cloudinary accepted delete_resources_by_prefix",
        ...compact,
      };
      operations.push(operation);
      logStage(req, operation, "Cloudinary diagnostic deleted resources by prefix");
    } catch (error) {
      const details = errorDetails(error);
      const item: DiagnosticFailure = { success: false, stage: "delete_resources_by_prefix", folder: selectedFolder, resourceType, ...details };
      failures.push(item);
      operations.push(item);
      logStage(req, item, "Cloudinary diagnostic resource deletion failed");
    }
  }

  try {
    const deleteFolderResult = await (c.api as any).delete_folder(selectedFolder);
    const compact = compactFolderResult(deleteFolderResult);
    const operation = {
      stage: "delete_folder",
      folder: selectedFolder,
      cloudinaryHttpCode: null,
      cloudinaryErrorCode: null,
      cloudinaryMessage: "Cloudinary accepted delete_folder",
      ...compact,
    };
    operations.push(operation);
    logStage(req, operation, "Cloudinary diagnostic deleted folder");
  } catch (error) {
    const details = errorDetails(error);
    const item: DiagnosticFailure = { success: false, stage: "delete_folder", folder: selectedFolder, ...details };
    failures.push(item);
    operations.push(item);
    logStage(req, item, "Cloudinary diagnostic folder deletion failed");
  }

  const resourcesAfter: Record<string, ReturnType<typeof safeResource>[]> = {};
  for (const resourceType of ["image", "video", "raw"]) {
    try {
      resourcesAfter[resourceType] = await listResources(c, selectedFolder, resourceType);
    } catch (error) {
      const details = errorDetails(error);
      failures.push({ success: false, stage: "verify_resources_after_cleanup", folder: selectedFolder, resourceType, ...details });
    }
  }

  const firstFailure = failures[0];
  if (firstFailure) {
    return res.status(502).json({
      success: false,
      stage: firstFailure.stage,
      folder: firstFailure.folder,
      ...(firstFailure.resourceType ? { resourceType: firstFailure.resourceType } : {}),
      cloudinaryHttpCode: firstFailure.cloudinaryHttpCode,
      cloudinaryErrorCode: firstFailure.cloudinaryErrorCode,
      cloudinaryMessage: firstFailure.cloudinaryMessage,
      runtime,
      sdk,
      inventory,
      selectedFolder,
      resourcesBefore,
      operations,
      failures,
      resourcesAfter,
    });
  }

  return res.json({
    success: true,
    stage: "complete",
    folder: selectedFolder,
    cloudinaryHttpCode: null,
    cloudinaryErrorCode: null,
    cloudinaryMessage: "Cloudinary authentication, inventory, resource cleanup, folder cleanup, and post-cleanup verification succeeded",
    runtime,
    sdk,
    inventory,
    selectedFolder,
    resourcesBefore,
    operations,
    resourcesAfter,
  });
});

export default router;