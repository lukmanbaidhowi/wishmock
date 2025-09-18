import { describe, it, expect, beforeEach, vi } from "bun:test";
import { setupFileRoutes } from "../src/interfaces/http/fileRoutes.js";
import * as FileService from "../src/infrastructure/fileService.js";
import { HTTP_STATUS } from "../src/interfaces/http/constants.js";

// Reusable mock response
const createMockResponse = () => {
  const jsonMock = vi.fn();
  const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
  return {
    status: statusMock,
    json: jsonMock,
    _statusMock: statusMock,
    _jsonMock: jsonMock,
  } as any;
};

describe("fileRoutes - update & upload handlers", () => {
  let mockApp: any;
  let mockRes: any;
  let mockReq: any;
  let onRuleUpdated: any;

  beforeEach(() => {
    mockApp = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
    mockRes = createMockResponse();
    mockReq = { params: {}, body: {} };
    onRuleUpdated = vi.fn();
  });

  describe("Success - updateProto", () => {
    it("updates existing proto and returns saved path", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.put.mock.calls.find((c: any) => c[0] === "/admin/proto/:filename")[1];

      const savedPath = "/proto/dir/sample.proto";
      const spy = vi.spyOn(FileService, "writeFile").mockReturnValue(savedPath);

      mockReq.params.filename = "sample.proto";
      mockReq.body.content = "syntax=proto3;";

      handler(mockReq, mockRes);

      expect(spy).toHaveBeenCalledWith("/proto/dir", "sample.proto", "syntax=proto3;");
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ ok: true, filename: "sample.proto", saved: savedPath });
      spy.mockRestore();
    });
  });

  describe("Success - updateRule", () => {
    it("updates existing rule, triggers reload, returns saved path", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.put.mock.calls.find((c: any) => c[0] === "/admin/rule/:filename")[1];

      const savedPath = "/rule/dir/greeter.sayhello.yaml";
      const spy = vi.spyOn(FileService, "writeFile").mockReturnValue(savedPath);

      mockReq.params.filename = "greeter.sayhello.yaml";
      mockReq.body.content = "responses: []";

      handler(mockReq, mockRes);

      expect(spy).toHaveBeenCalledWith("/rule/dir", "greeter.sayhello.yaml", "responses: []");
      expect(onRuleUpdated).toHaveBeenCalledTimes(1);
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ ok: true, filename: "greeter.sayhello.yaml", saved: savedPath });
      spy.mockRestore();
    });
  });

  describe("Success - uploadProto", () => {
    it("uploads proto and returns saved path", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.post.mock.calls.find((c: any) => c[0] === "/admin/upload/proto")[1];

      const savedPath = "/proto/dir/uploaded.proto";
      const spy = vi.spyOn(FileService, "writeFile").mockReturnValue(savedPath);

      mockReq.body = { filename: "uploaded.proto", content: "syntax=proto3;" };

      handler(mockReq, mockRes);

      expect(spy).toHaveBeenCalledWith("/proto/dir", "uploaded.proto", "syntax=proto3;");
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ ok: true, saved: savedPath });
      spy.mockRestore();
    });
  });

  describe("Success - uploadRule", () => {
    it("uploads rule, triggers reload, returns saved path", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.post.mock.calls.find((c: any) => c[0] === "/admin/upload/rule")[1];

      const savedPath = "/rule/dir/helloworld.greeter.sayhello.yaml";
      const spy = vi.spyOn(FileService, "writeFile").mockReturnValue(savedPath);

      mockReq.body = { filename: "helloworld.greeter.sayhello.yaml", content: "responses: []" };

      handler(mockReq, mockRes);

      expect(spy).toHaveBeenCalledWith("/rule/dir", "helloworld.greeter.sayhello.yaml", "responses: []");
      expect(onRuleUpdated).toHaveBeenCalledTimes(1);
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ ok: true, saved: savedPath });
      spy.mockRestore();
    });
  });

  describe("Validation - update handlers", () => {
    it("rejects updateProto with empty filename", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.put.mock.calls.find((c: any) => c[0] === "/admin/proto/:filename")[1];

      mockReq.params.filename = "";
      mockReq.body.content = "content";

      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "filename required" });
      expect(onRuleUpdated).not.toHaveBeenCalled();
    });

    it("rejects updateProto with empty content", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.put.mock.calls.find((c: any) => c[0] === "/admin/proto/:filename")[1];

      mockReq.params.filename = "file.proto";
      mockReq.body.content = "";

      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "content required" });
    });

    it("rejects updateRule with empty filename", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.put.mock.calls.find((c: any) => c[0] === "/admin/rule/:filename")[1];

      mockReq.params.filename = "";
      mockReq.body.content = "x";

      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "filename required" });
      expect(onRuleUpdated).not.toHaveBeenCalled();
    });

    it("rejects updateRule with empty content", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.put.mock.calls.find((c: any) => c[0] === "/admin/rule/:filename")[1];

      mockReq.params.filename = "rule.yaml";
      mockReq.body.content = "";

      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "content required" });
      expect(onRuleUpdated).not.toHaveBeenCalled();
    });
  });

  describe("Validation - upload handlers", () => {
    it("rejects uploadProto with empty filename", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.post.mock.calls.find((c: any) => c[0] === "/admin/upload/proto")[1];

      mockReq.body = { filename: "", content: "abc" };
      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "filename & content required" });
    });

    it("rejects uploadProto with empty content", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.post.mock.calls.find((c: any) => c[0] === "/admin/upload/proto")[1];

      mockReq.body = { filename: "file.proto", content: "" };
      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "filename & content required" });
    });

    it("rejects uploadRule with empty filename", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.post.mock.calls.find((c: any) => c[0] === "/admin/upload/rule")[1];

      mockReq.body = { filename: "", content: "x" };
      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "filename & content required" });
      expect(onRuleUpdated).not.toHaveBeenCalled();
    });

    it("rejects uploadRule with empty content", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.post.mock.calls.find((c: any) => c[0] === "/admin/upload/rule")[1];

      mockReq.body = { filename: "r.yaml", content: "" };
      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "filename & content required" });
      expect(onRuleUpdated).not.toHaveBeenCalled();
    });
  });

  describe("writeFile error -> sendError", () => {
    it("handles write error on updateProto", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.put.mock.calls.find((c: any) => c[0] === "/admin/proto/:filename")[1];

      const spy = vi.spyOn(FileService, "writeFile").mockImplementation(() => {
        throw new Error("disk full");
      });

      mockReq.params.filename = "file.proto";
      mockReq.body.content = "abc";

      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "disk full" });
      expect(onRuleUpdated).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("handles write error on uploadRule", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.post.mock.calls.find((c: any) => c[0] === "/admin/upload/rule")[1];

      const spy = vi.spyOn(FileService, "writeFile").mockImplementation(() => {
        throw new Error("permission denied");
      });

      mockReq.body = { filename: "k.yaml", content: "x" };

      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "permission denied" });
      expect(onRuleUpdated).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("handles write error on updateRule", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.put.mock.calls.find((c: any) => c[0] === "/admin/rule/:filename")[1];

      const spy = vi.spyOn(FileService, "writeFile").mockImplementation(() => {
        throw new Error("io error");
      });

      mockReq.params.filename = "bad.yaml";
      mockReq.body.content = "x";

      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "io error" });
      expect(onRuleUpdated).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("listRules success & error", () => {
    it("lists rules successfully", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.get.mock.calls.find((c: any) => c[0] === "/admin/rules")[1];

      const files = [{ filename: "a.yaml", path: "/rule/dir/a.yaml" }];
      const spy = vi.spyOn(FileService, "listFiles").mockReturnValue(files as any);

      handler(mockReq, mockRes);

      expect(spy).toHaveBeenCalledWith("/rule/dir", [".yaml", ".yml", ".json"]);
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ files });
      spy.mockRestore();
    });

    it("handles error when listing rules", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.get.mock.calls.find((c: any) => c[0] === "/admin/rules")[1];

      const spy = vi.spyOn(FileService, "listFiles").mockImplementation(() => {
        throw new Error("rules dir missing");
      });

      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "rules dir missing" });
      spy.mockRestore();
    });
  });

  describe("listProtos success & error", () => {
    it("lists protos successfully", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.get.mock.calls.find((c: any) => c[0] === "/admin/protos")[1];

      const files = [{ filename: "a.proto", path: "/proto/dir/a.proto" }];
      const spy = vi.spyOn(FileService, "listFiles").mockReturnValue(files as any);

      handler(mockReq, mockRes);

      expect(spy).toHaveBeenCalledWith("/proto/dir", [".proto"]);
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ files });
      spy.mockRestore();
    });

    it("handles error when listing protos", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.get.mock.calls.find((c: any) => c[0] === "/admin/protos")[1];

      const spy = vi.spyOn(FileService, "listFiles").mockImplementation(() => {
        throw new Error("proto dir missing");
      });

      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "proto dir missing" });
      spy.mockRestore();
    });
  });

  describe("uploadProto error branch", () => {
    it("handles write error on uploadProto", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.post.mock.calls.find((c: any) => c[0] === "/admin/upload/proto")[1];

      const spy = vi.spyOn(FileService, "writeFile").mockImplementation(() => {
        throw new Error("disk quota exceeded");
      });

      mockReq.body = { filename: "bad.proto", content: "x" };
      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "disk quota exceeded" });
      expect(onRuleUpdated).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("uploadProtoAtPath handlers", () => {
    it("uploads proto to relative path and returns saved path", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.post.mock.calls.find((c: any) => c[0] === "/admin/upload/proto/path")[1];

      const savedPath = "/proto/dir/nested/ok.proto";
      const spy = vi.spyOn(FileService, "writeFileAtPath").mockReturnValue(savedPath);

      mockReq.body = { path: "nested/ok.proto", content: "syntax=proto3;" };
      handler(mockReq, mockRes);

      expect(spy).toHaveBeenCalledWith("/proto/dir", "nested/ok.proto", "syntax=proto3;");
      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ ok: true, saved: savedPath });
      spy.mockRestore();
    });

    it("rejects non-.proto extension with internal error", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.post.mock.calls.find((c: any) => c[0] === "/admin/upload/proto/path")[1];

      mockReq.body = { path: "nested/file.txt", content: "hello" };
      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "only .proto files allowed" });
    });

    it("handles write error when uploading at path", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.post.mock.calls.find((c: any) => c[0] === "/admin/upload/proto/path")[1];

      const spy = vi.spyOn(FileService, "writeFileAtPath").mockImplementation(() => {
        throw new Error("write failed");
      });
      mockReq.body = { path: "nested/bad.proto", content: "x" };

      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "write failed" });
      spy.mockRestore();
    });
  });

  describe("getRule branches", () => {
    it("returns NOT_FOUND for missing rule", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.get.mock.calls.find((c: any) => c[0] === "/admin/rule/:filename")[1];

      const spy = vi.spyOn(FileService, "readFile").mockImplementation(() => {
        throw new Error("File not found: missing.yaml");
      });

      mockReq.params.filename = "missing.yaml";
      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "rule file not found: missing.yaml" });
      spy.mockRestore();
    });

    it("handles general read error for rule", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.get.mock.calls.find((c: any) => c[0] === "/admin/rule/:filename")[1];

      const spy = vi.spyOn(FileService, "readFile").mockImplementation(() => {
        throw new Error("EACCES");
      });

      mockReq.params.filename = "rule.yaml";
      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "EACCES" });
      spy.mockRestore();
    });
  });

  describe("getProto success & not found", () => {
    it("returns content for existing proto", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.get.mock.calls.find((c: any) => c[0] === "/admin/proto/:filename")[1];

      const content = "syntax = \"proto3\";";
      const spy = vi.spyOn(FileService, "readFile").mockReturnValue(content as any);

      mockReq.params.filename = "test.proto";
      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ filename: "test.proto", content });
      spy.mockRestore();
    });

    it("returns NOT_FOUND for missing proto", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.get.mock.calls.find((c: any) => c[0] === "/admin/proto/:filename")[1];

      const spy = vi.spyOn(FileService, "readFile").mockImplementation(() => {
        throw new Error("File not found: missing.proto");
      });

      mockReq.params.filename = "missing.proto";
      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.NOT_FOUND);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "proto file not found: missing.proto" });
      spy.mockRestore();
    });
  });

  describe("getProto general read error", () => {
    it("handles non-not-found error for proto", () => {
      setupFileRoutes(mockApp, "/proto/dir", "/rule/dir", onRuleUpdated);
      const handler = mockApp.get.mock.calls.find((c: any) => c[0] === "/admin/proto/:filename")[1];

      const spy = vi.spyOn(FileService, "readFile").mockImplementation(() => {
        throw new Error("EIO read failure");
      });

      mockReq.params.filename = "abc.proto";
      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
      expect(mockRes._jsonMock).toHaveBeenCalledWith({ error: "EIO read failure" });
      spy.mockRestore();
    });
  });
});
