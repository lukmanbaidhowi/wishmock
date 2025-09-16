import express from "express";
import fs from "fs";
import path from "path";
import { setupFileRoutes } from './http/fileRoutes.js';
import { sendError, sendNotFound, sendSuccess } from './http/responseHelper.js';
import { validateFilename } from './http/validator.js';
import { HTTP_STATUS } from './http/constants.js';
import { StatusResponse, ServicesResponse } from './types.js';

interface AdminAppParams {
  httpPort: number | string;
  protoDir: string;
  ruleDir: string;
  uploadsDir: string;
  getStatus: () => StatusResponse;
  listServices: () => ServicesResponse;
  getSchema: (typeName: string) => unknown | null | undefined;
  onRuleUpdated: () => void;
}

function setupServiceRoutes(app: any, params: AdminAppParams) {
  const { getStatus, listServices, getSchema } = params;

  app.get("/admin/status", (_req: any, res: any) => {
    sendSuccess(res, getStatus());
  });

  app.get("/admin/services", (_req: any, res: any) => {
    try {
      sendSuccess(res, listServices());
    } catch (error) {
      sendError(res, error, "Failed to list services");
    }
  });

  app.get("/admin/schema/:typeName", (req: any, res: any) => {
    const typeName = String(req.params.typeName || "");
    if (!validateFilename(typeName, res)) return;
    
    try {
      const info = getSchema(typeName);
      if (info === null) {
        return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({ error: "schema unavailable (no protos loaded)" });
      }
      if (typeof info === "undefined") {
        return sendNotFound(res, `type not found: ${typeName}`);
      }
      sendSuccess(res, info);
    } catch (error) {
      sendError(res, error, "Failed to get schema");
    }
  });
}

function setupStaticFiles(app: any) {
  try {
    const frontendDir = path.resolve("frontend");
    if (fs.existsSync(frontendDir)) {
      app.use("/app", express.static(frontendDir));
      app.get("/app/*", (_req: any, res: any) => {
        res.sendFile(path.join(frontendDir, "index.html"));
      });
    }
  } catch {}
}

function setupHealthChecks(app: any) {
  app.get("/", (_req: any, res: any) => {
    sendSuccess(res, { ok: true });
  });

  app.get("/liveness", (_req: any, res: any) => {
    sendSuccess(res, { status: "alive" });
  });

  app.get("/readiness", (_req: any, res: any) => {
    sendSuccess(res, { status: "ready" });
  });
}

export function createAdminApp(params: AdminAppParams) {
  const { httpPort, protoDir, ruleDir, onRuleUpdated } = params;
  const app = express();
  
  app.use(express.json({ limit: "10mb" }));
  
  setupStaticFiles(app);
  setupFileRoutes(app, protoDir, ruleDir, onRuleUpdated);
  setupServiceRoutes(app, params);
  setupHealthChecks(app);
  
  app.listen(httpPort, '0.0.0.0', () => console.log(`[wishmock] HTTP admin on ${httpPort}`));
  return app;
}
