#!/bin/bash
# Start script that handles environment file detection

# Detect which env file to use (priority: .env.local > .env.tls > .env)
ENV_FILE=""
if [ -f ".env.local" ]; then
  ENV_FILE=".env.local"
elif [ -f ".env.tls" ]; then
  ENV_FILE=".env.tls"
elif [ -f ".env" ]; then
  ENV_FILE=".env"
fi

# Run bun with env file if found
if [ -n "$ENV_FILE" ]; then
  exec bun --env-file "$ENV_FILE" dist/app.js "$@"
else
  exec bun dist/app.js "$@"
fi
