import path from "path";
import { listFiles, readFile, writeFile } from '../../infrastructure/file/fileService.js';
import { sendError, sendNotFound, sendSuccess } from './responseHelper.js';
import { validateFilename, validateContent, validateUploadData } from './validator.js';
import { FILE_EXTENSIONS } from './constants.js';

function createFileHandlers(protoDir: string, ruleDir: string, onRuleUpdated: () => void) {
  return {
    listProtos: (_req: any, res: any) => {
      try {
        const files = listFiles(protoDir, FILE_EXTENSIONS.PROTO);
        sendSuccess(res, { files });
      } catch (error) {
        sendError(res, error, "Failed to list proto files");
      }
    },

    getProto: (req: any, res: any) => {
      const filename = String(req.params.filename || "");
      if (!validateFilename(filename, res)) return;
      
      try {
        const content = readFile(protoDir, filename);
        sendSuccess(res, { filename, content });
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          sendNotFound(res, `proto file not found: ${filename}`);
        } else {
          sendError(res, error, "Failed to read proto file");
        }
      }
    },

    updateProto: (req: any, res: any) => {
      const filename = String(req.params.filename || "");
      const { content } = req.body;
      if (!validateFilename(filename, res) || !validateContent(content, res)) return;
      
      try {
        const saved = writeFile(protoDir, filename, content);
        sendSuccess(res, { ok: true, filename, saved });
      } catch (error) {
        sendError(res, error, "Failed to update proto file");
      }
    },

    listRules: (_req: any, res: any) => {
      try {
        const files = listFiles(ruleDir, FILE_EXTENSIONS.RULES);
        sendSuccess(res, { files });
      } catch (error) {
        sendError(res, error, "Failed to list rule files");
      }
    },

    getRule: (req: any, res: any) => {
      const filename = String(req.params.filename || "");
      if (!validateFilename(filename, res)) return;
      
      try {
        const content = readFile(ruleDir, filename);
        sendSuccess(res, { filename, content });
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          sendNotFound(res, `rule file not found: ${filename}`);
        } else {
          sendError(res, error, "Failed to read rule file");
        }
      }
    },

    updateRule: (req: any, res: any) => {
      const filename = String(req.params.filename || "");
      const { content } = req.body;
      if (!validateFilename(filename, res) || !validateContent(content, res)) return;
      
      try {
        const saved = writeFile(ruleDir, filename, content);
        onRuleUpdated();
        sendSuccess(res, { ok: true, filename, saved });
      } catch (error) {
        sendError(res, error, "Failed to update rule file");
      }
    },

    uploadProto: (req: any, res: any) => {
      const { filename, content } = req.body;
      if (!validateUploadData(filename, content, res)) return;
      
      try {
        const saved = writeFile(protoDir, path.basename(filename), content);
        sendSuccess(res, { ok: true, saved });
      } catch (error) {
        sendError(res, error, "Failed to upload proto file");
      }
    },

    uploadRule: (req: any, res: any) => {
      const { filename, content } = req.body;
      if (!validateUploadData(filename, content, res)) return;
      
      try {
        const saved = writeFile(ruleDir, path.basename(filename), content);
        onRuleUpdated();
        sendSuccess(res, { ok: true, saved });
      } catch (error) {
        sendError(res, error, "Failed to upload rule file");
      }
    }
  };
}

export function setupFileRoutes(app: any, protoDir: string, ruleDir: string, onRuleUpdated: () => void) {
  const handlers = createFileHandlers(protoDir, ruleDir, onRuleUpdated);
  
  app.get("/admin/protos", handlers.listProtos);
  app.get("/admin/proto/:filename", handlers.getProto);
  app.put("/admin/proto/:filename", handlers.updateProto);
  app.post("/admin/upload/proto", handlers.uploadProto);
  
  app.get("/admin/rules", handlers.listRules);
  app.get("/admin/rule/:filename", handlers.getRule);
  app.put("/admin/rule/:filename", handlers.updateRule);
  app.post("/admin/upload/rule", handlers.uploadRule);
}