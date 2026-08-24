import { Router } from "express";
import { google } from "googleapis";
import multer from "multer";
import { Readable } from "node:stream";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 },
});

const DRIVE_FOLDER_ID = "1xAuu-RB1v2fAR9-fCfVRXPikigILXss0";

function getDrive() {
  const raw = process.env["GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"];
  if (!raw) throw new Error("Google Drive service account is not configured on the server");
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
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

function safeDriveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/permission|forbidden|access/i.test(message)) {
    return "Google Drive folder access இல்லை. Service-account email-ஐ folder-க்கு Editor ஆக share செய்யவும்.";
  }
  return message.slice(0, 240);
}

router.get("/google-drive/backups", async (_req, res) => {
  try {
    const drive = getDrive();
    const result = await drive.files.list({
      q: `'${DRIVE_FOLDER_ID}' in parents and trashed = false`,
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
      folderId: DRIVE_FOLDER_ID,
      folderUrl: `https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}`,
    });
  } catch (error) {
    return res.status(503).json({ error: safeDriveError(error) });
  }
});

router.post("/google-drive/backups", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Backup file missing" });
    const drive = getDrive();
    const created = await drive.files.create({
      requestBody: {
        name: req.file.originalname || "MyDreamWoman_Backup.zip",
        parents: [DRIVE_FOLDER_ID],
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