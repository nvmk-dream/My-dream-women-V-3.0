import { Router } from "express";
import { google, type drive_v3 } from "googleapis";
import multer from "multer";
import { Readable } from "node:stream";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 },
});

const DEFAULT_DRIVE_FOLDER_ID = "1ikAYcKgLyJlm12EEX-gBg7KqiVsA9kbo";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const DEFAULT_OAUTH_REDIRECT_URI =
  "https://my-dream-women-v-3-0.onrender.com/api/google-drive/oauth/callback";
const DRIVE_READ_TIMEOUT_MS = 45_000;
const DRIVE_UPLOAD_TIMEOUT_MS = 180_000;

type DriveAuthMode = "oauth" | "service-account";
type DriveConnection = {
  drive: drive_v3.Drive;
  authMode: DriveAuthMode;
  configuredAccountEmail: string | null;
};
type DriveTarget = {
  folderId: string;
  folderName: string;
  folderMimeType: string;
  accountEmail: string | null;
  authMode: DriveAuthMode;
};

function getDriveFolderId() {
  return process.env["GOOGLE_DRIVE_FOLDER_ID"] || DEFAULT_DRIVE_FOLDER_ID;
}

function getOAuthClient() {
  const clientId = process.env["GOOGLE_DRIVE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_DRIVE_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google Drive OAuth is not configured: GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET are required",
    );
  }
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    process.env["GOOGLE_DRIVE_OAUTH_REDIRECT_URI"] || DEFAULT_OAUTH_REDIRECT_URI,
  );
}

function getDriveConnection(): DriveConnection {
  const refreshToken = process.env["GOOGLE_DRIVE_REFRESH_TOKEN"]?.trim();
  if (refreshToken) {
    const auth = getOAuthClient();
    auth.setCredentials({ refresh_token: refreshToken });
    return {
      drive: google.drive({ version: "v3", auth }),
      authMode: "oauth",
      configuredAccountEmail: null,
    };
  }

  // Keep legacy Service Account support for existing backups, but expose it
  // explicitly. OAuth and Service Account identities have separate Drive views.
  const raw = process.env["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"];
  if (!raw) {
    throw new Error(
      "Google Drive OAuth is not connected on Render. Set GOOGLE_DRIVE_REFRESH_TOKEN (OAuth) and redeploy.",
    );
  }
  let credentials: { client_email?: string; private_key?: string };
  try {
    credentials = JSON.parse(raw) as { client_email?: string; private_key?: string };
  } catch {
    throw new Error("Google Drive legacy Service Account JSON is invalid");
  }
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google Drive legacy Service Account JSON is invalid");
  }
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key.replace(/\\n/g, "\n"),
    scopes: [DRIVE_SCOPE],
  });
  return {
    drive: google.drive({ version: "v3", auth }),
    authMode: "service-account",
    configuredAccountEmail: credentials.client_email,
  };
}

function withDriveTimeout<T>(
  request: Promise<T>,
  operation: string,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Google Drive ${operation} timed out after ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
  });
  return Promise.race([request, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function googleErrorMessage(error: unknown): string {
  const value = error as {
    message?: string;
    response?: { data?: { error?: { message?: string; errors?: Array<{ reason?: string }> } } };
    code?: number;
  } | null;
  return value?.response?.data?.error?.message || value?.message || String(error);
}

function safeDriveError(error: unknown): string {
  const message = googleErrorMessage(error);
  if (/timed out after/i.test(message)) return message;
  if (/has not been used in project|SERVICE_DISABLED|drive\.googleapis\.com.*disabled/i.test(message)) {
    const project = message.match(/project (\d+)/i)?.[1];
    return `Google Drive API disabled for the active Google project${project ? ` ${project}` : ""}. Enable Drive API in the same project used by the OAuth client, wait a few minutes, then retry.`;
  }
  if (/storage quota|storageQuota|Service Accounts do not have storage quota/i.test(message)) {
    return "Google Drive legacy Service Account-க்கு storage quota இல்லை. OAuth user account பயன்படுத்தவும் அல்லது Shared Drive பயன்படுத்தவும்.";
  }
  if (/permission|forbidden|access|notFound|file not found|insufficient/i.test(message)) {
    return "Target Google Drive folder-க்கு active account access இல்லை. OAuth account-ஐ அந்த folder-ல் Editor ஆக share செய்யவும் அல்லது GOOGLE_DRIVE_FOLDER_ID-ஐ சரியான folder ID-ஆக மாற்றவும்.";
  }
  if (/invalid_grant|unauthorized_client|invalid_client|token/i.test(message)) {
    return "Google Drive OAuth token invalid அல்லது expired. OAuth account-ஐ மீண்டும் connect செய்து புதிய GOOGLE_DRIVE_REFRESH_TOKEN-ஐ Render-ல் update செய்யவும்.";
  }
  return message.slice(0, 300);
}

async function inspectDriveTarget(connection: DriveConnection): Promise<DriveTarget> {
  const folderId = getDriveFolderId();
  const about = await withDriveTimeout(
    connection.drive.about.get({ fields: "user(emailAddress,displayName,permissionId)" }),
    "OAuth account validation",
    DRIVE_READ_TIMEOUT_MS,
  );
  const folder = await withDriveTimeout(
    connection.drive.files.get({
      fileId: folderId,
      fields: "id,name,mimeType,capabilities(canAddChildren),trashed",
      supportsAllDrives: true,
    }),
    "target folder access check",
    DRIVE_READ_TIMEOUT_MS,
  );
  const folderData = folder.data;
  if (!folderData.id || folderData.trashed || folderData.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("Configured Google Drive target is not an active folder");
  }
  const accountEmail = connection.authMode === "oauth"
    ? about.data.user?.emailAddress || null
    : connection.configuredAccountEmail;
  if (!accountEmail) throw new Error("Google Drive active account email could not be verified");
  if (folderData.capabilities?.canAddChildren === false) {
    throw new Error(`Google Drive account ${accountEmail} can read the target folder but cannot upload into it`);
  }
  return {
    folderId,
    folderName: folderData.name || "Google Drive backup folder",
    folderMimeType: folderData.mimeType,
    accountEmail,
    authMode: connection.authMode,
  };
}

async function getVerifiedDrive(): Promise<{ connection: DriveConnection; target: DriveTarget }> {
  const connection = getDriveConnection();
  const target = await inspectDriveTarget(connection);
  return { connection, target };
}

router.get("/google-drive/oauth/start", (_req, res) => {
  try {
    const auth = getOAuthClient();
    const url = auth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [DRIVE_SCOPE],
    });
    return res.redirect(url);
  } catch (error) {
    return res.status(503).json({ error: safeDriveError(error) });
  }
});

router.get("/google-drive/oauth/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const oauthError = typeof req.query.error === "string" ? req.query.error : "";
  if (oauthError) {
    return res.status(400).json({ error: `Google OAuth was cancelled or denied: ${oauthError}` });
  }
  if (!code) {
    return res.status(400).json({ error: "Google OAuth callback code is missing" });
  }

  try {
    const auth = getOAuthClient();
    const { tokens } = await withDriveTimeout(auth.getToken(code), "OAuth token exchange", DRIVE_READ_TIMEOUT_MS);
    if (!tokens.refresh_token) {
      return res.status(400).json({
        error: "Google did not return a refresh token. Open the OAuth start URL again with consent approval.",
      });
    }
    return res.json({
      message: "OAuth connected. Save refreshToken as GOOGLE_DRIVE_REFRESH_TOKEN in Render, then redeploy.",
      refreshToken: tokens.refresh_token,
      tokenType: tokens.token_type || "Bearer",
      scope: tokens.scope || DRIVE_SCOPE,
    });
  } catch (error) {
    return res.status(400).json({ error: safeDriveError(error) });
  }
});

router.get("/google-drive/status", async (_req, res) => {
  try {
    const { target } = await getVerifiedDrive();
    return res.json({
      connected: true,
      authMode: target.authMode,
      accountEmail: target.accountEmail,
      folderId: target.folderId,
      folderName: target.folderName,
      canUpload: true,
      folderUrl: `https://drive.google.com/drive/folders/${target.folderId}`,
    });
  } catch (error) {
    return res.status(503).json({ connected: false, error: safeDriveError(error) });
  }
});

router.get("/google-drive/backups", async (_req, res) => {
  try {
    const { connection, target } = await getVerifiedDrive();
    const result = await withDriveTimeout(
      connection.drive.files.list({
        q: `'${target.folderId}' in parents and trashed = false`,
        pageSize: 100,
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink)",
        spaces: "drive",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      }),
      "file list",
      DRIVE_READ_TIMEOUT_MS,
    );
    const files = (result.data.files ?? [])
      .filter((file) => file.id && file.name)
      .map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType || "application/octet-stream",
        sizeBytes: Number(file.size || 0),
        modifiedTime: file.modifiedTime || null,
        webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
        webContentLink: file.webContentLink || null,
      }));
    return res.json({
      files,
      authMode: target.authMode,
      accountEmail: target.accountEmail,
      folderId: target.folderId,
      folderName: target.folderName,
      folderUrl: `https://drive.google.com/drive/folders/${target.folderId}`,
    });
  } catch (error) {
    return res.status(503).json({ error: safeDriveError(error) });
  }
});

router.post("/google-drive/backups", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Backup file missing" });
    const { connection, target } = await getVerifiedDrive();
    const created = await withDriveTimeout(
      connection.drive.files.create({
        requestBody: {
          name: req.file.originalname || req.body.fileName || "MyDreamWoman_Backup.zip",
          parents: [target.folderId],
        },
        media: {
          mimeType: req.file.mimetype || "application/octet-stream",
          body: Readable.from(req.file.buffer),
        },
        fields: "id,name,mimeType,size,modifiedTime,webViewLink,webContentLink",
        supportsAllDrives: true,
      }),
      "file upload",
      DRIVE_UPLOAD_TIMEOUT_MS,
    );
    const file = created.data;
    return res.json({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType || req.file.mimetype,
      sizeBytes: Number(file.size || req.file.size || 0),
      modifiedTime: file.modifiedTime || new Date().toISOString(),
      webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      webContentLink: file.webContentLink || null,
      authMode: target.authMode,
      accountEmail: target.accountEmail,
      folderId: target.folderId,
    });
  } catch (error) {
    return res.status(503).json({ error: safeDriveError(error) });
  }
});

export default router;
