import path from 'path';
import { loadProtos } from '../src/infrastructure/protoLoader.js';

const { root } = await loadProtos(path.resolve('protos'));
const type = root.lookupType('helloworld.BufMessageOneof');
console.log('Type options keys:', Object.keys(type.options || {}));
console.log('Raw options:', JSON.stringify(type.options, null, 2));
