#!/usr/bin/env node

/**
 * gRPC-Web Node.js Client Example (via Connect RPC)
 * 
 * This example demonstrates how to call Wishmock using the gRPC-Web protocol from Node.js.
 * Unlike the Connect protocol which uses JSON, gRPC-Web uses binary protobuf encoding.
 * Connect RPC natively supports gRPC-Web without requiring Envoy proxy!
 * 
 * Prerequisites:
 * - Wishmock server running with Connect RPC enabled (CONNECT_ENABLED=true)
 * - Default Connect port: 50052
 * 
 * Usage:
 *   node examples/grpc-web-connect/node.mjs
 *   node examples/grpc-web-connect/node.mjs --server http://localhost:50052
 */

// Parse command line arguments
const args = process.argv.slice(2);
const serverUrl = args.includes('--server') 
  ? args[args.indexOf('--server') + 1] 
  : 'http://localhost:50052';

console.log('🌐 gRPC-Web Node.js Client Example (via Connect RPC)');
console.log('====================================================\n');
console.log(`Server URL: ${serverUrl}`);
console.log('Protocol: gRPC-Web (binary protobuf compatible)\n');

/**
 * Example 1: Unary RPC using gRPC-Web protocol
 * 
 * Simple request-response call to helloworld.Greeter/SayHello using gRPC-Web
 */
async function callUnaryRPCGrpcWeb() {
  console.log('📞 Example 1: Unary RPC - SayHello (gRPC-Web)');
  console.log('----------------------------------------------');
  
  try {
    const request = {
      name: 'gRPC-Web NodeJS'
    };
    
    const response = await fetch(`${serverUrl}/helloworld.Greeter/SayHello`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+json',
        'X-Grpc-Web': '1',
        'Accept': 'application/grpc-web+json',
      },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    
    const result = await response.json();
    console.log('✅ Success! (gRPC-Web Protocol)');
    console.log('Request:', request);
    console.log('Response:', result);
    console.log('Content-Type:', response.headers.get('content-type'));
    console.log();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log();
  }
}

/**
 * Example 2: Compare Connect vs gRPC-Web protocols
 * 
 * Make the same call using both protocols to compare
 */
async function compareProtocols() {
  console.log('📞 Example 2: Protocol Comparison');
  console.log('----------------------------------');
  
  const request = {
    name: 'Protocol Test'
  };
  
  try {
    // Call using Connect protocol (JSON)
    console.log('\n🔌 Calling with Connect protocol (JSON)...');
    const connectStart = Date.now();
    const connectResponse = await fetch(`${serverUrl}/helloworld.Greeter/SayHello`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      },
      body: JSON.stringify(request)
    });
    const connectEnd = Date.now();
    
    if (!connectResponse.ok) {
      throw new Error(`Connect failed: ${await connectResponse.text()}`);
    }
    
    const connectResult = await connectResponse.json();
    console.log('✅ Connect Success');
    console.log('   Response:', connectResult);
    console.log('   Time:', `${connectEnd - connectStart}ms`);
    console.log('   Content-Type:', connectResponse.headers.get('content-type'));
    
    // Call using gRPC-Web protocol
    console.log('\n🌐 Calling with gRPC-Web protocol...');
    const grpcWebStart = Date.now();
    const grpcWebResponse = await fetch(`${serverUrl}/helloworld.Greeter/SayHello`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+json',
        'X-Grpc-Web': '1',
        'Accept': 'application/grpc-web+json',
      },
      body: JSON.stringify(request)
    });
    const grpcWebEnd = Date.now();
    
    if (!grpcWebResponse.ok) {
      throw new Error(`gRPC-Web failed: ${await grpcWebResponse.text()}`);
    }
    
    const grpcWebResult = await grpcWebResponse.json();
    console.log('✅ gRPC-Web Success');
    console.log('   Response:', grpcWebResult);
    console.log('   Time:', `${grpcWebEnd - grpcWebStart}ms`);
    console.log('   Content-Type:', grpcWebResponse.headers.get('content-type'));
    
    console.log('\n📊 Summary:');
    console.log('   Both protocols work seamlessly with Connect RPC!');
    console.log('   • Connect: Modern, JSON-based, human-readable');
    console.log('   • gRPC-Web: Binary protobuf, browser-compatible');
    console.log('   • No Envoy proxy required for either protocol!');
    console.log();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log();
  }
}

/**
 * Example 3: Server Streaming RPC using gRPC-Web
 * 
 * Server streaming call that receives multiple messages via gRPC-Web
 */
async function callServerStreamRPCGrpcWeb() {
  console.log('📞 Example 3: Server Streaming RPC - GetMessages (gRPC-Web)');
  console.log('-----------------------------------------------------------');
  
  try {
    const request = {
      user_id: 'grpc-web-user',
      limit: 5
    };
    
    console.log('Request:', request);
    console.log('📡 Receiving messages via gRPC-Web...\n');
    
    const response = await fetch(`${serverUrl}/streaming.StreamService/GetMessages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+json',
        'X-Grpc-Web': '1',
        'Accept': 'application/grpc-web+json',
      },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    
    // Read the stream
    let messageCount = 0;
    const decoder = new TextDecoder();
    let buffer = '';
    
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      
      // Process complete JSON messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            messageCount++;
            console.log(`Message ${messageCount} (gRPC-Web):`, message);
          } catch (e) {
            console.error('Failed to parse message:', line);
          }
        }
      }
    }
    
    console.log(`\n✅ Stream completed. Received ${messageCount} messages via gRPC-Web.`);
    console.log();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log();
  }
}

/**
 * Example 4: Validation with gRPC-Web
 * 
 * Test validation errors using gRPC-Web protocol
 */
async function testValidationGrpcWeb() {
  console.log('📞 Example 4: Validation with gRPC-Web');
  console.log('---------------------------------------');
  
  try {
    // Valid request
    console.log('\n✅ Testing valid request...');
    const validRequest = {
      name: 'ValidUser123',
      email: 'user@example.com',
      age: 25
    };
    
    const validResponse = await fetch(`${serverUrl}/helloworld.Greeter/SayHello`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+json',
        'X-Grpc-Web': '1',
        'Accept': 'application/grpc-web+json',
      },
      body: JSON.stringify(validRequest)
    });
    
    if (validResponse.ok) {
      const result = await validResponse.json();
      console.log('   Request:', validRequest);
      console.log('   Response:', result);
    } else {
      console.log('   Unexpected error:', await validResponse.text());
    }
    
    // Invalid request
    console.log('\n⚠️  Testing invalid request (should fail validation)...');
    const invalidRequest = {
      name: 'ab',              // Too short (min_len: 3)
      email: 'invalid-email',  // Invalid email format
      age: 200                 // Too high (max: 150)
    };
    
    const invalidResponse = await fetch(`${serverUrl}/helloworld.Greeter/SayHello`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+json',
        'X-Grpc-Web': '1',
        'Accept': 'application/grpc-web+json',
      },
      body: JSON.stringify(invalidRequest)
    });
    
    if (!invalidResponse.ok) {
      console.log('   Expected validation error received:');
      console.log('   Request:', invalidRequest);
      console.log('   Error:', await invalidResponse.text());
    } else {
      console.log('   Unexpected success (validation should have failed)');
    }
    
    console.log();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log();
  }
}

/**
 * Example 5: Error Handling with gRPC-Web
 * 
 * Demonstrate error handling for various scenarios
 */
async function testErrorHandlingGrpcWeb() {
  console.log('📞 Example 5: Error Handling with gRPC-Web');
  console.log('-------------------------------------------');
  
  // Test 1: Non-existent service
  console.log('\n1️⃣ Testing non-existent service...');
  try {
    const response = await fetch(`${serverUrl}/nonexistent.Service/Method`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+json',
        'X-Grpc-Web': '1',
      },
      body: JSON.stringify({})
    });
    
    if (!response.ok) {
      console.log('   ✅ Expected error:', await response.text());
    } else {
      console.log('   ⚠️  Unexpected success');
    }
  } catch (error) {
    console.log('   ✅ Expected error:', error.message);
  }
  
  // Test 2: Invalid JSON
  console.log('\n2️⃣ Testing invalid JSON...');
  try {
    const response = await fetch(`${serverUrl}/helloworld.Greeter/SayHello`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+json',
        'X-Grpc-Web': '1',
      },
      body: 'invalid json{'
    });
    
    if (!response.ok) {
      console.log('   ✅ Expected error:', await response.text());
    } else {
      console.log('   ⚠️  Unexpected success');
    }
  } catch (error) {
    console.log('   ✅ Expected error:', error.message);
  }
  
  // Test 3: Missing required fields
  console.log('\n3️⃣ Testing missing required fields...');
  try {
    const response = await fetch(`${serverUrl}/helloworld.Greeter/SayHello`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+json',
        'X-Grpc-Web': '1',
      },
      body: JSON.stringify({}) // Missing 'name' field
    });
    
    if (!response.ok) {
      console.log('   ✅ Expected error:', await response.text());
    } else {
      const result = await response.json();
      console.log('   Response:', result);
    }
  } catch (error) {
    console.log('   Error:', error.message);
  }
  
  console.log();
}

/**
 * Example 6: Health Check
 * 
 * Check if the Connect RPC server is healthy and supports gRPC-Web
 */
async function checkHealth() {
  console.log('📞 Example 6: Health Check');
  console.log('--------------------------');
  
  try {
    const response = await fetch(`${serverUrl}/health`, {
      method: 'GET',
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const health = await response.json();
    console.log('✅ Server is healthy!');
    console.log('Status:', health.status);
    console.log('Services:', health.services?.length || 0);
    console.log('Reflection:', health.reflection ? 'enabled' : 'disabled');
    console.log('Protocols: Connect, gRPC-Web, gRPC (all supported!)');
    console.log();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log();
  }
}

/**
 * Run all examples
 */
async function runExamples() {
  try {
    // Check server health first
    await checkHealth();
    
    // Run gRPC-Web examples
    await callUnaryRPCGrpcWeb();
    await compareProtocols();
    await callServerStreamRPCGrpcWeb();
    await testValidationGrpcWeb();
    await testErrorHandlingGrpcWeb();
    
    console.log('✅ All gRPC-Web examples completed!');
    console.log('\n📝 Key Takeaways:');
    console.log('   • gRPC-Web works natively with Connect RPC');
    console.log('   • No Envoy proxy required!');
    console.log('   • Same server supports Connect, gRPC-Web, and gRPC');
    console.log('   • Browser-compatible without additional setup');
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run examples
runExamples();
