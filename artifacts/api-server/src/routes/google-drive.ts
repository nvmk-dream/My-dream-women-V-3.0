import { Router } from "express";
import { google } from "googleapis";
import multer from "multer";
import { Readable } from "node:stream";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 },
});

const DEFAULT_DRIVE_FOLDER_ID = "1xAuu-RB1v2fAR9-fCfVRXPikigILXss0";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const DEFAULT_OAUTH_REDIRECT_URI =
  "https://my-dream-women-v-3-0.onrender.com/api/google-drive/oauth/callback";

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

function getDrive() {
  const refreshToken = process.env["GOOGLE_DRIVE_REFRESH_TOKEN"];
  if (refreshToken) {
    const auth = getOAuthClient();
    auth.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: "v3", auth });
  }

  const raw = process.env["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"];
  if (!raw) {
    throw new Error(
      "Google Drive is not connected. Complete OAuth setup and set GOOGLE_DRIVE_REFRESH_TOKEN",
    );
  }
  const credentials = JSON.parse(raw) as {
    client_email?: string;
    private_key?: string;
  };
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google Drive service account JSON is invalid");
  }
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key.replace(/\\n/g, "\n"),
    scopes: [DRIVE_SCOPE],
  });
  return google.drive({ version: "v3", auth });
}

function safeDriveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/storage quota|storageQuota|Service Accounts do not have storage quota/i.test(message)) {
    return "Google Drive Service Account-க்கு storage quota இல்லை. OAuth user account இணைப்பை முடிக்கவும் அல்லது Shared Drive பயன்படுத்தவும்.";
  }
  if (/permission|forbidden|access/i.test(message)) {
    return "Google Drive folder access இல்லை. Service-account email-ஐ folder-க்கு Editor ஆக share செய்யவும்.";
  }
  return message.slice(0, 240);
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
    const { tokens } = await auth.getToken(code);
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

router.get("/google-drive/backups", async (_req, res) => {
  try {
    const drive = getDrive();
    const folderId = getDriveFolderId();
    const result = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 100,
      orderBy: "modifiedTime desc",
      fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink)",
      spaces: "drive",
    });
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
      folderId,
      folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    });
  } catch (error) {
    return res.status(503).json({ error: safeDriveError(error) });
  }
});

router.post("/google-drive/backups", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Backup file missing" });
    const drive = getDrive();
    const folderId = getDriveFolderId();
    const created = await drive.files.create({
      requestBody: {
        name: req.file.originalname || "MyDreamWoman_Backup.zip",
        parents: [folderId],
      },
      media: {
        mimeType: req.file.mimetype || "application/octet-stream",
        body: Readable.from(req.file.buffer),
      },
      fields: "id,name,mimeType,size,modifiedTime,webViewLink,webContentLink",
    });
    const file = created.data;
    return res.json({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType || req.file.mimetype,
      sizeBytes: Number(file.size || req.file.size || 0),
      modifiedTime: file.modifiedTime || new Date().toISOString(),
      webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      webContentLink: file.webContentLink || null,
    });
  } catch (error) {
    return res.status(503).json({ error: safeDriveError(error) });
  }
});

export default router;