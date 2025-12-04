# Wishmock Documentation Index

Complete documentation for Wishmock gRPC mock server.

## Getting Started

### For New Users

1. **[Quick Reference](quick-reference.md)** ⚡
   - Command cheatsheet
   - Common patterns
   - Quick troubleshooting
   - **Start here for fastest setup**

2. **[Global Installation Guide](global-installation.md)** 📦
   - Install with `npm install -g wishmock`
   - Complete setup walkthrough
   - Configuration options
   - Use cases and examples

3. **[Main README](../README.md)** 📖
   - Full feature overview
   - Development setup
   - All usage modes (Bun/Node/Docker)

## Core Documentation

### API & Integration

- **[Admin API Reference](../API.md)** 🔌
  - REST endpoints
  - Upload/delete operations
  - Status and health checks
  - Schema introspection

### Rules & Mocking

- **[Rule Examples](rule-examples.md)** 📝
  - Comprehensive rule patterns
  - Matching operators
  - Templating examples
  - Streaming configurations
  - Error simulation

### Validation

- **[Protovalidate Validation](protovalidate-validation.md)** ✅
  - Buf Protovalidate integration
  - Field constraints
  - Message-level CEL
  - Well-known types (Timestamp, Duration, Any)

- **[PGV Validation](pgv-validation.md)** 🔍
  - Legacy protoc-gen-validate
  - Migration guide
  - Constraint examples

- **[Oneof Validation](oneof-validation.md)** 🔀
  - Oneof field validation
  - Required oneof constraints
  - Examples and patterns

### Advanced Topics

- **[Reflection & Descriptors](reflection-descriptor-generation.md)** 🔧
  - Server reflection setup
  - Descriptor generation
  - grpcurl integration
  - Troubleshooting

## Quick Links by Use Case

### I want to...

**Get started quickly**
→ [Quick Reference](quick-reference.md)

**Install globally and use anywhere**
→ [Global Installation Guide](global-installation.md)

**Learn rule syntax**
→ [Rule Examples](rule-examples.md)

**Set up validation**
→ [Protovalidate Validation](protovalidate-validation.md)

**Use the Admin API**
→ [Admin API Reference](../API.md)

**Understand reflection**
→ [Reflection & Descriptors](reflection-descriptor-generation.md)

**Run in Docker**
→ [Main README - Docker Section](../README.md#docker)

**Integrate with CI/CD**
→ [Global Installation Guide - CI/CD Section](global-installation.md#4-cicd-integration)

**Use with AI assistants (MCP)**
→ [Main README - MCP Section](../README.md#mcp-server-model-context-protocol)

## Documentation Structure

```
docs/
├── INDEX.md                              # This file
├── quick-reference.md                    # Quick command reference
├── global-installation.md                # npm global install guide
├── rule-examples.md                      # Rule patterns and examples
├── protovalidate-validation.md           # Buf Protovalidate guide
├── pgv-validation.md                     # PGV validation guide
├── oneof-validation.md                   # Oneof validation
└── reflection-descriptor-generation.md   # Reflection setup

../
├── README.md                             # Main documentation
└── API.md                                # Admin API reference
```

## External Resources

- **GitHub Repository**: https://github.com/lukmanbaidhowi/wishmock
- **npm Package**: https://www.npmjs.com/package/wishmock
- **Issue Tracker**: https://github.com/lukmanbaidhowi/wishmock/issues

## Contributing

Found an issue or want to improve documentation?

1. Check existing issues
2. Open a new issue or PR
3. Follow the contribution guidelines

## Version

This documentation is for Wishmock v0.9.2

Last updated: 2024-12-04
