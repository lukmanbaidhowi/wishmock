#!/usr/bin/env node
// Debug script to check if timestamp validation rules are being extracted
import protobuf from 'protobufjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, '..', 'protos');

// Load the proto
const root = new protobuf.Root();
root.resolvePath = (origin, target) => {
  const exists = (p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  };
  
  if (path.isAbsolute(target) && exists(target)) return target;
  
  if (origin) {
    const rel = path.resolve(path.dirname(origin), target);
    if (exists(rel)) return rel;
  }
  
  const fromRoot = path.resolve(PROTO_DIR, target);
  if (exists(fromRoot)) return fromRoot;
  
  return path.resolve(path.dirname(origin || PROTO_DIR), target);
};

try {
  await root.load(path.join(PROTO_DIR, 'validation_examples.proto'));
  
  // Check if TimestampExample exists
  const timestampExample = root.lookupType('validation.TimestampExample');
  console.log('✓ Found TimestampExample');
  console.log('  Full name:', timestampExample.fullName);
  console.log('  Fields:', timestampExample.fieldsArray.map(f => f.name));
  
  // Check the ts field options
  const tsField = timestampExample.fields['ts'];
  console.log('\nField "ts":');
  console.log('  Type:', tsField.type);
  console.log('  Resolve:', tsField.resolve ? tsField.resolve().resolvedType : 'n/a');
  console.log('  ID:', tsField.id);
  console.log('  Repeated:', tsField.repeated);
  console.log('  Map:', tsField.map);
  console.log('  Options:', JSON.stringify(tsField.options, null, 2));
  
  // Look for buf.validate options
  const bufValidateKeys = Object.keys(tsField.options || {}).filter(k => 
    k.includes('buf.validate') || k.includes('timestamp')
  );
  console.log('\n  Relevant option keys:', bufValidateKeys);
  
  if (bufValidateKeys.length > 0) {
    for (const key of bufValidateKeys) {
      console.log(`\n  ${key}:`, JSON.stringify(tsField.options[key], null, 2));
    }
  }
  
  // Now test rule extraction
  console.log('\n\n=== Testing Rule Extraction ===');
  const { extractAllRules } = await import('../dist/domain/validation/ruleExtractor.js');
  const { buildDescriptorInfo } = await import('../dist/infrastructure/validation/descriptors.js');
  
  const descriptorInfo = buildDescriptorInfo(root);
  console.log('Messages found:', Array.from(descriptorInfo.messages.keys()));
  
  const irMap = extractAllRules(descriptorInfo.messages, 'protovalidate');
  console.log('\nValidation IR extracted for:', Array.from(irMap.keys()));
  
  const timestampIR = irMap.get('validation.TimestampExample');
  if (timestampIR) {
    console.log('\nTimestampExample IR:');
    console.log(JSON.stringify(timestampIR, null, 2));
  } else {
    console.log('\n⚠️  No IR extracted for TimestampExample!');
  }
  
  // Now manually test the extractFieldRules function
  console.log('\n\n=== Manual Field Rule Extraction Test ===');
  const { extractFieldRules } = await import('../dist/domain/validation/ruleExtractor.js');
  
  const timestampMsg = descriptorInfo.messages.get('validation.TimestampExample');
  const tsFieldFromMsg = timestampMsg.fields['ts'];
  console.log('\nField from message:');
  console.log('  Name:', tsFieldFromMsg.name);
  console.log('  Type:', tsFieldFromMsg.type);
  console.log('  Has options:', !!tsFieldFromMsg.options);
  console.log('  Options keys:', Object.keys(tsFieldFromMsg.options || {}).slice(0, 5));
  
  const extractedRule = extractFieldRules(tsFieldFromMsg, 'protovalidate');
  console.log('\nExtracted rule:');
  console.log(JSON.stringify(extractedRule, null, 2));
  
  // Now test extractMessageRules directly
  console.log('\n\n=== Testing extractMessageRules ===');
  const { extractMessageRules } = await import('../dist/domain/validation/ruleExtractor.js');
  const msgIR = extractMessageRules(timestampMsg, 'protovalidate');
  console.log('Message IR (raw):');
  console.log('  typeName:', msgIR.typeName);
  console.log('  fields type:', msgIR.fields.constructor.name);
  console.log('  fields size:', msgIR.fields.size);
  console.log('  fields keys:', Array.from(msgIR.fields.keys()));
  console.log('  fields values:', Array.from(msgIR.fields.values()));
  console.log('\nMessage IR (JSON):');
  console.log(JSON.stringify(msgIR, null, 2));
  
  console.log('\nDebug: messageType.fieldsArray:');
  console.log('  Length:', timestampMsg.fieldsArray.length);
  console.log('  Fields:', timestampMsg.fieldsArray.map(f => ({ name: f.name, type: f.type })));
  
  console.log('\n\n=== Comparing field access methods ===');
  const fieldViaMap = timestampMsg.fields['ts'];
  const fieldViaArray = timestampMsg.fieldsArray[0];
  console.log('Via map === Via array:', fieldViaMap === fieldViaArray);
  console.log('Via map has options:', !!fieldViaMap.options);
  console.log('Via array has options:', !!fieldViaArray.options);
  console.log('Via array options keys:', Object.keys(fieldViaArray.options || {}).slice(0, 3));
  
  const ruleViaArray = extractFieldRules(fieldViaArray, 'protovalidate');
  console.log('\nRule from fieldsArray[0]:');
  console.log(JSON.stringify(ruleViaArray, null, 2));
  
} catch (e) {
  console.error('Error:', e.message);
  console.error(e.stack);
  process.exit(1);
}

