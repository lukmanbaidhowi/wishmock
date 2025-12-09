#!/usr/bin/env node

/**
 * Connect RPC Node.js Client Example
 * 
 * This example demonstrates how to call Wishmock using Connect RPC from Node.js.
 * It shows both unary and server streaming RPCs.
 * 
 * Prerequisites:
 * - Wishmock server running with Connect RPC enabled (CONNECT_ENABLED=true)
 * - Default Connect port: 50052
 * 
 * Usage:
 *   node examples/connect-client/node.mjs
 *   node examples/connect-client/node.mjs --server http://localhost:50052
 */

// Using native fetch API instead of Connect RPC client library
// This makes the example simpler and doesn't require additional dependencies

// Parse command line arguments
const args = process.argv.slice(2);
const serverUrl = args.includes('--server') 
  ? args[args.indexOf('--server') + 1] 
  : 'http://localhost:50052';

console.log('🔌 Connect RPC Node.js Client Example');
console.log('=====================================\n');
console.log(`Server URL: ${serverUrl}\n`);

/**
 * Example 1: Unary RPC - SayHello
 * 
 * Simple request-response call to helloworld.Greeter/SayHello
 */
async function callUnaryRPC() {
  console.log('📞 Example 1: Unary RPC - SayHello');
  console.log('-----------------------------------');
  
  try {
    const response = await fetch(`${serverUrl}/helloworld.Greeter/SayHello`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      },
      body: JSON.stringify({
        name: 'NodeJS'
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`${error.code}: ${error.message}`);
    }
    
    const result = await response.json();
    console.log('✅ Success!');
    console.log('Request:', { name: 'NodeJS' });
    console.log('Response:', result);
    console.log();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log();
  }
}

/**
 * Example 2: Unary RPC with validation
 * 
 * Call SayHello with a name that should pass validation
 */
async function callUnaryWithValidation() {
  console.log('📞 Example 2: Unary RPC with Validation');
  console.log('----------------------------------------');
  
  try {
    const request = {
      name: 'ValidUser123',
      email: 'user@example.com',
      age: 25
    };
    
    const response = await fetch(`${serverUrl}/helloworld.Greeter/SayHello`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`${error.code}: ${error.message}`);
    }
    
    const result = await response.json();
    console.log('✅ Success!');
    console.log('Request:', request);
    console.log('Response:', result);
    console.log();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log();
  }
}

/**
 * Example 3: Unary RPC with validation error
 * 
 * Call SayHello with invalid data to trigger validation error
 */
async function callUnaryWithValidationError() {
  console.log('📞 Example 3: Unary RPC with Validation Error');
  console.log('----------------------------------------------');
  
  try {
    const request = {
      name: 'ab', // Too short (min_len: 3)
      email: 'invalid-email', // Invalid email format
      age: 200 // Too high (max: 150)
    };
    
    const response = await fetch(`${serverUrl}/helloworld.Greeter/SayHello`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.log('⚠️  Expected validation error received:');
      console.log('Request:', request);
      console.log('Error:', error);
      console.log();
      return;
    }
    
    const result = await response.json();
    console.log('⚠️  Unexpected success (validation should have failed):');
    console.log('Response:', result);
    console.log();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log();
  }
}

/**
 * Example 4: Server Streaming RPC - GetMessages
 * 
 * Server streaming call that receives multiple messages
 */
async function callServerStreamRPC() {
  console.log('📞 Example 4: Server Streaming RPC - GetMessages');
  console.log('------------------------------------------------');
  
  try {
    const request = {
      user_id: 'user123',
      limit: 5
    };
    
    console.log('Request:', request);
    console.log('📡 Receiving messages...\n');
    
    const response = await fetch(`${serverUrl}/streaming.StreamService/GetMessages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'Connect-Accept-Encoding': 'identity',
      },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`${error.code}: ${error.message}`);
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
            console.log(`Message ${messageCount}:`, message);
          } catch (e) {
            console.error('Failed to parse message:', line);
          }
        }
      }
    }
    
    console.log(`\n✅ Stream completed. Received ${messageCount} messages.`);
    console.log();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log();
  }
}

/**
 * Example 5: Server Streaming RPC - WatchEvents
 * 
 * Another server streaming example with different message types
 */
async function callWatchEventsRPC() {
  console.log('📞 Example 5: Server Streaming RPC - WatchEvents');
  console.log('------------------------------------------------');
  
  try {
    const request = {
      topic: 'notifications',
      filters: ['important', 'urgent']
    };
    
    console.log('Request:', request);
    console.log('📡 Watching events...\n');
    
    const response = await fetch(`${serverUrl}/streaming.StreamService/WatchEvents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'Connect-Accept-Encoding': 'identity',
      },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`${error.code}: ${error.message}`);
    }
    
    // Read the stream
    let eventCount = 0;
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
            const event = JSON.parse(line);
            eventCount++;
            console.log(`Event ${eventCount}:`, event);
          } catch (e) {
            console.error('Failed to parse event:', line);
          }
        }
      }
    }
    
    console.log(`\n✅ Stream completed. Received ${eventCount} events.`);
    console.log();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log();
  }
}

/**
 * Example 6: Health Check
 * 
 * Check if the Connect RPC server is healthy
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
    
    // Run unary examples
    await callUnaryRPC();
    await callUnaryWithValidation();
    await callUnaryWithValidationError();
    
    // Run streaming examples
    await callServerStreamRPC();
    await callWatchEventsRPC();
    
    console.log('✅ All examples completed!');
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run examples
runExamples();
