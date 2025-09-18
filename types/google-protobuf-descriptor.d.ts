declare module "google-protobuf/google/protobuf/descriptor_pb.js" {
  export class FileDescriptorProto {
    static deserializeBinary(bytes: Uint8Array | ArrayBuffer | Buffer): FileDescriptorProto;
    getName(): string;
    setName(value: string): void;
    getPackage(): string;
    setPackage(value: string): void;
    getServiceList(): ServiceDescriptorProto[];
    getMessageTypeList(): DescriptorProto[];
    getEnumTypeList(): EnumDescriptorProto[];
    getDependencyList(): string[];
    setDependencyList(value: readonly string[]): void;
    addService(value?: ServiceDescriptorProto, index?: number): ServiceDescriptorProto;
    addMessageType(value?: DescriptorProto, index?: number): DescriptorProto;
    setServiceList(value: ServiceDescriptorProto[]): void;
    setMessageTypeList(value: DescriptorProto[]): void;
    serializeBinary(): Uint8Array;
  }

  export class DescriptorProto {
    constructor();
    getName(): string;
    setName(value: string): void;
    getFieldList(): FieldDescriptorProto[];
    getNestedTypeList(): DescriptorProto[];
    getEnumTypeList(): EnumDescriptorProto[];
    setFieldList(value: FieldDescriptorProto[]): void;
    setNestedTypeList(value: DescriptorProto[]): void;
    addField(value?: FieldDescriptorProto, index?: number): FieldDescriptorProto;
    addNestedType(value?: DescriptorProto, index?: number): DescriptorProto;
  }

  export class ServiceDescriptorProto {
    constructor();
    getName(): string;
    setName(value: string): void;
    getMethodList(): MethodDescriptorProto[];
    addMethod(value?: MethodDescriptorProto, index?: number): MethodDescriptorProto;
  }

  export class MethodDescriptorProto {
    constructor();
    getName(): string;
    setName(value: string): void;
    getInputType(): string;
    setInputType(value: string): void;
    getOutputType(): string;
    setOutputType(value: string): void;
  }

  export class FieldDescriptorProto {
    getTypeName(): string;
    setTypeName(value: string): void;
  }

  export class EnumDescriptorProto {
    getName(): string;
  }
}
