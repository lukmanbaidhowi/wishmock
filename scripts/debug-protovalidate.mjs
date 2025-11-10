import path from 'path';
import { loadProtos } from '../src/infrastructure/protoLoader.js';
import { buildDescriptorInfo } from '../src/infrastructure/validation/descriptors.js';

const protoDir = path.resolve('protos');
const { root } = await loadProtos(protoDir);
const info = buildDescriptorInfo(root);

const protovalidateStringType = info.messages.get('helloworld.BufValidationStringRequest');
console.log('Type found:', !!protovalidateStringType);

if (protovalidateStringType) {
  console.log('Message:', protovalidateStringType.name);
  console.log('fieldsArray:', protovalidateStringType.fieldsArray.map(f => f.name));
  
  const field = protovalidateStringType.fieldsArray[0];
  console.log('\nFirst field:', field.name);
  console.log('  type:', field.type);
  console.log('  has options:', !!field.options);
  
  if (field.options) {
    const keys = Object.keys(field.options);
    console.log('  option keys:', keys);
    keys.forEach(k => {
      console.log(`    ${k}:`, JSON.stringify(field.options[k], null, 2));
    });
  }
}
