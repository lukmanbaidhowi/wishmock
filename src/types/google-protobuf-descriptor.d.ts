declare module 'google-protobuf/google/protobuf/descriptor_pb.js' {
  export class FileDescriptorProto {
    static deserializeBinary(bytes: Uint8Array | ArrayBuffer | Buffer): FileDescriptorProto;
    getName(): string;
    getPackage(): string;
    getServiceList(): Array<{ getName(): string }>;
    getMessageTypeList(): Array<{ getName(): string }>;
    getEnumTypeList(): Array<{ getName(): string }>;
    getDependencyList(): string[];
  }
}

