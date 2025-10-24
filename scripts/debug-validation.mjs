#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { loadProtos } from "../dist/infrastructure/protoLoader.js";
import { buildDescriptorInfo, getAllMessageTypes } from "../dist/infrastructure/validation/descriptors.js";
import { extractAllRules } from "../dist/domain/validation/ruleExtractor.js";
import { validate } from "../dist/domain/validation/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

console.log("🔍 VALIDATION DEBUG TOOL\n");
console.log("=".repeat(60));

try {
  console.log("\n1️⃣  PHASE 1: Loading Protos");
  console.log("-".repeat(60));

  const protoDir = path.resolve(rootDir, "protos");
  console.log(`Proto directory: ${protoDir}`);

  const { root: protoRoot } = await loadProtos(protoDir);
  console.log("✓ Protos loaded successfully");

  console.log(`\n📦 Loaded message types:`);
  const messages = Object.keys(protoRoot.nestedNamespace?.helloworld?.nested || {});
  const calendarMessages = Object.keys(protoRoot.nestedNamespace?.calendar?.nested || {});
  
  console.log("  - helloworld:", messages.length > 0 ? messages.join(", ") : "none");
  console.log("  - calendar:", calendarMessages.length > 0 ? calendarMessages.join(", ") : "none");

  console.log("\n2️⃣  PHASE 2: Building Descriptor Info");
  console.log("-".repeat(60));

  const descriptorInfo = buildDescriptorInfo(protoRoot);
  console.log(`✓ Descriptor info built`);
  console.log(`  - Message types: ${descriptorInfo.messages.size}`);
  console.log(`  - Enum types: ${descriptorInfo.enums.size}`);

  const allMessageTypes = getAllMessageTypes(descriptorInfo);
  if (allMessageTypes.length > 0) {
    console.log("\n📄 Message types in descriptor:");
    allMessageTypes.forEach((msg) => {
      console.log(`  - ${msg}`);
    });
  }

  console.log("\n3️⃣  PHASE 3: Extracting Validation Rules");
  console.log("-".repeat(60));

  const irMap = extractAllRules(descriptorInfo.messages);
  console.log(`✓ Rule extraction complete`);
  console.log(`  - Total types with rules: ${irMap.size}`);

  if (irMap.size === 0) {
    console.log("\n⚠️  WARNING: No validation rules found in descriptors!");
    console.log("    - Check if protos have (validate.rules) or (buf.validate.field) annotations");
    console.log("    - Sample: grep -r 'validate.rules' protos/");
  } else {
    console.log("\n📋 Extracted Validation Rules (IR):");
    let idx = 1;
    for (const [typeName, ir] of irMap) {
      console.log(`\n  [${idx++}] ${typeName}`);
      console.log(`      Fields with constraints: ${ir.fields.size}`);
      
      ir.fields.forEach((constraint, fieldPath) => {
        console.log(`      ├─ ${fieldPath}`);
        console.log(`         Kind: ${constraint.kind}`);
        console.log(`         Source: ${constraint.source}`);
        console.log(`         Type: ${constraint.fieldType}`);
        console.log(`         Rules: ${JSON.stringify(constraint.ops)}`);
      });
    }
  }

  // Inspect raw options for inField/notInField to understand shapes
  const vsType = protoRoot.lookupType('helloworld.ValidationStringRequest');
  if (vsType) {
    console.log("\n🔎 Inspecting ValidationStringRequest field options (raw):");
    vsType.fieldsArray.forEach((f) => {
      if (f.name.toLowerCase().includes('in')) {
        console.log('  Field', f.name, 'repeated=', f.repeated, 'type=', f.type);
        console.log('   Options keys:', f.options ? Object.keys(f.options) : []);
        if (f.options) {
          const o = f.options;
          if (o['(validate.rules)']) console.log('   has (validate.rules)');
          if (o['(validate.rules).string']) console.log('   has (validate.rules).string object');
          if (o['(validate.rules).repeated']) console.log('   has (validate.rules).repeated object');
          if (o['(validate.rules).string.in']) console.log('   has (validate.rules).string.in');
        }
      }
    });
  }

  console.log("\n4️⃣  PHASE 4: Test Validation Engine");
  console.log("-".repeat(60));

  const helloRequestIR = irMap.get("helloworld.HelloRequest");
  const numIR = irMap.get("helloworld.ValidationNumberRequest");
  const repIR = irMap.get("helloworld.ValidationRepeatedRequest");
  
  if (!helloRequestIR) {
    console.log("⚠️  HelloRequest IR not found. Skipping engine tests.");
  } else {
    console.log("Testing HelloRequest validation:\n");

    const testCases = [
      {
        name: "Valid: name='Tom', age=25, email='user@example.com'",
        data: { name: "Tom", age: 25, email: "user@example.com" },
        expectOk: true,
      },
      {
        name: "Invalid: name too short ('ab')",
        data: { name: "ab", age: 25, email: "user@example.com" },
        expectOk: false,
      },
      {
        name: "Invalid: age too low (-1)",
        data: { name: "Tom", age: -1, email: "user@example.com" },
        expectOk: false,
      },
      {
        name: "Invalid: age too high (151)",
        data: { name: "Tom", age: 151, email: "user@example.com" },
        expectOk: false,
      },
      {
        name: "Invalid: bad email format",
        data: { name: "Tom", age: 25, email: "not-an-email" },
        expectOk: false,
      },
    ];

    let validationTestsPassed = 0;
    let validationTestsFailed = 0;

    testCases.forEach((testCase, idx) => {
      console.log(`  Test ${idx + 1}: ${testCase.name}`);
      const result = validate(helloRequestIR, testCase.data);
      const pass = result.ok === !!testCase.expectOk;

      if (pass) {
        if (result.ok) {
          console.log(`    ✓ Expected pass`);
        } else {
          console.log(`    ✓ Expected fail`);
          if (result.violations?.length) {
            result.violations.forEach((v) => {
              console.log(`       - ${v.field}: ${v.rule} (${v.description})`);
            });
          }
        }
        validationTestsPassed++;
      } else {
        if (result.ok) {
          console.log(`    ✗ Unexpected pass (should fail)`);
        } else {
          console.log(`    ✗ Unexpected fail (should pass):`);
          result.violations.forEach((v) => {
            console.log(`       - ${v.field}: ${v.rule} (${v.description})`);
          });
        }
        validationTestsFailed++;
      }
    });

    console.log(`\n  Summary: ${validationTestsPassed} passed (expected), ${validationTestsFailed} failed (unexpected)`);
  }

  if (numIR) {
    console.log("\nTesting ValidationNumberRequest (gt/gte):\n");
    const cases = [
      { name: 'gt valid (1 > 0)', data: { gtField: 1 } },
      { name: 'gt invalid (0 !> 0)', data: { gtField: 0 } },
      { name: 'gte valid (0 >= 0)', data: { gteField: 0 } },
      { name: 'gte invalid (-1 < 0)', data: { gteField: -1 } },
    ];
    for (const c of cases) {
      const r = validate(numIR, c.data);
      console.log(' ', c.name, '=>', r.ok ? 'OK' : 'ERR', r.ok ? '' : JSON.stringify(r.violations));
    }
  }

  if (repIR) {
    console.log("\nTesting ValidationRepeatedRequest (min_items/unique):\n");
    const cases = [
      { name: 'min_items valid (2)', data: { minItems: ['a','b'] } },
      { name: 'unique valid', data: { uniqueItems: ['a','b','c'] } },
    ];
    for (const c of cases) {
      const r = validate(repIR, c.data);
      console.log(' ', c.name, '=>', r.ok ? 'OK' : 'ERR', r.ok ? '' : JSON.stringify(r.violations));
    }
  }

  console.log("\n5️⃣  PHASE 5: Environment Check");
  console.log("-".repeat(60));

  const env = {
    VALIDATION_ENABLED: process.env.VALIDATION_ENABLED || "false",
    VALIDATION_SOURCE: process.env.VALIDATION_SOURCE || "auto",
    VALIDATION_MODE: process.env.VALIDATION_MODE || "per_message",
  };

  console.log("Current environment variables:");
  Object.entries(env).forEach(([key, value]) => {
    console.log(`  ${key}=${value}`);
  });

  console.log("\n" + "=".repeat(60));
  console.log("✅ DEBUG REPORT COMPLETE\n");

  console.log("📝 Next steps:");
  console.log("  1. Run: npm run dev");
  console.log("  2. In another terminal: npm run validation:test");
  console.log("  3. Check /tmp/validation.test.results for results\n");

} catch (error) {
  console.error("\n❌ ERROR during debug:", error.message);
  console.error(error.stack);
  process.exit(1);
}
