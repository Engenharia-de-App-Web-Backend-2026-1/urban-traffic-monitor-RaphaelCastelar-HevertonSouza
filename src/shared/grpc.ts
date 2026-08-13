import path from 'node:path';
import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const protoPath = path.resolve(currentDir, '../../proto/traffic.proto');
const definition = protoLoader.loadSync(protoPath, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

export const trafficPackage = grpc.loadPackageDefinition(definition).traffic as any;
export { grpc };
