import express from "express";
import fs from "fs";
import path from "path";

export function createAdminApp(params: {
  httpPort: number | string;
  protoDir: string;
  ruleDir: string;
  uploadsDir: string;
  getStatus: () => {
    grpc_port: number | string;
    loaded_services: string[];
    rules: string[];
    protos?: {
      loaded: string[];
      skipped: { file: string; status?: string; error?: string }[];
    };
  };
  listServices: () => { services: { name: string; package: string; service: string; methods: { name: string; full_method: string; rule_key: string; request_type: string; response_type: string; }[] }[] };
  getSchema: (typeName: string) => any | null | undefined;
  onRuleUpdated: () => void;
}) {
  const { httpPort, protoDir, ruleDir, getStatus, listServices, getSchema, onRuleUpdated } = params;
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Serve static frontend (if present) under /app
  try {
    const frontendDir = path.resolve("frontend");
    if (fs.existsSync(frontendDir)) {
      app.use("/app", express.static(frontendDir));
      // SPA-style fallback for nested routes under /app
      app.get("/app/*", (_req: any, res: any) => {
        res.sendFile(path.join(frontendDir, "index.html"));
      });
    }
  } catch {}

  app.post("/admin/upload/proto", (req: any, res: any) => {
    const { filename, content } = (req.body || {}) as { filename?: string; content?: string };
    if (!filename || !content) return res.status(400).json({ error: "filename & content required" });
    const p = path.join(protoDir, path.basename(filename));
    fs.writeFileSync(p, content, "utf8");
    res.json({ ok: true, saved: p });
  });

  app.post("/admin/upload/rule", (req: any, res: any) => {
    const { filename, content } = (req.body || {}) as { filename?: string; content?: string };
    if (!filename || !content) return res.status(400).json({ error: "filename & content required" });
    const p = path.join(ruleDir, path.basename(filename));
    fs.writeFileSync(p, content, "utf8");
    onRuleUpdated();
    res.json({ ok: true, saved: p });
  });

  app.get("/admin/status", (_req: any, res: any) => {
    res.json(getStatus());
  });

  // List services and methods (read-only)
  app.get("/admin/services", (_req: any, res: any) => {
    try {
      res.json(listServices());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Inspect message schema by fully-qualified type name (e.g., helloworld.HelloRequest)
  app.get("/admin/schema/:typeName", (req: any, res: any) => {
    const typeName = String(req.params?.typeName || "");
    if (!typeName) return res.status(400).json({ error: "typeName required" });
    try {
      const info = getSchema(typeName);
      if (info === null) return res.status(503).json({ error: "schema unavailable (no protos loaded)" });
      if (typeof info === "undefined") return res.status(404).json({ error: `type not found: ${typeName}` });
      res.json(info);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Health check endpoints
  app.get("/", (_req: any, res: any) => {
    res.status(200).json({ ok: true });
  });

  app.get("/liveness", (_req: any, res: any) => {
    res.status(200).json({ status: "alive" });
  });

  app.get("/readiness", (_req: any, res: any) => {
    res.status(200).json({ status: "ready" });
  });

  app.listen(httpPort, () => console.log(`[grpc-server-mock] HTTP admin on ${httpPort}`));
  return app;
}
