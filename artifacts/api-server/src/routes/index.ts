import { Router, type IRouter } from "express";
import path from "path";
import healthRouter from "./health";
import cloudinaryRouter from "./cloudinary";
import chatRouter from "./chat";
import guideRouter from "./project-guide";
import pushRouter from "./push";
import faceswapRouter from "./faceswap";
import imageToPromptRouter from "./image-to-prompt";
import generateImageRouter from "./generate-image";
import analyzeFileRouter from "./analyze-file";
import mediaChatRouter from "./media-chat";
import appConfigRouter from "./app-config";
import avatarProfileRouter from "./avatar-profile";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cloudinaryRouter);
router.use(chatRouter);
router.use(guideRouter);
router.use(pushRouter);
router.use(faceswapRouter);
router.use(imageToPromptRouter);
router.use(generateImageRouter);
router.use(analyzeFileRouter);
router.use(mediaChatRouter);
router.use(appConfigRouter);
router.use(avatarProfileRouter);

// Temporary backup download route
router.get("/download/backup", (_req, res) => {
  const file = path.join(process.cwd(), "backup.zip");
  res.download(file, "replit-my girles.zip");
});

export default router;
