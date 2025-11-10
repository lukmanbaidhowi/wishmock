import { describe, it, expect, beforeAll } from "bun:test";
import path from "path";
import protobuf from "protobufjs";
import { loadProtos } from "../src/infrastructure/protoLoader.js";
import { buildDescriptorInfo } from "../src/infrastructure/validation/descriptors.js";
import { extractMessageRules } from "../src/domain/validation/ruleExtractor.js";

describe("Oneof Validation - Rule Extractor", () => {
  let root: protobuf.Root;
  let oneofReqType: protobuf.Type;

  beforeAll(async () => {
    const { root: loadedRoot } = await loadProtos(path.resolve("protos"));
    root = loadedRoot;
    const info = buildDescriptorInfo(root);
    oneofReqType = info.messages.get("helloworld.OneofValidationRequest")!;
  });

  it("extracts oneof groups and required annotation (PGV)", () => {
    const ir = extractMessageRules(oneofReqType);
    expect(ir.oneofs && ir.oneofs.length).toBeGreaterThan(0);

    const byName = new Map(ir.oneofs!.map(o => [o.name, o]));
    const contact = byName.get("contact");
    // protobufjs may camelCase oneof group/field names
    const contactReq = byName.get("contact_req") || byName.get("contactReq");

    expect(contact).toBeDefined();
    expect(contact?.required).toBeFalsy();
    expect(contact?.fields.sort()).toEqual(["email", "phone"].sort());

    expect(contactReq).toBeDefined();
    expect(contactReq?.required).toBeTruthy();
    expect(contactReq?.source).toBe("pgv");
    const reqFields = (contactReq?.fields || []).map((s) => s.toString());
    expect(reqFields.sort()).toEqual(["emailReq", "phoneReq"].sort());
  });
});
