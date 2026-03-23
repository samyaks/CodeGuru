#!/usr/bin/env node

/**
 * UpdateAI Backend Setup Script
 * Initializes the development environment
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Setting up UpdateAI Backend...\n');

// Check if Supabase CLI is installed
function checkSupabaseCLI() {
  try {
    execSync('supabase --version', { stdio: 'pipe' });
    console.log('✅ Supabase CLI is installed');
    return true;
  } catch (error) {
    console.error('❌ Supabase CLI is not installed');
    console.log('\nInstall it with:');
    console.log('  macOS: brew install supabase/tap/supabase');
    console.log('  Windows: scoop bucket add supabase https://github.com/supabase/scoop-bucket.git');
    console.log('           scoop install supabase');
    console.log('  Linux: brew install supabase/tap/supabase');
    console.log('\nOr visit: https://supabase.com/docs/guides/cli');
    return false;
  }
}

// Create .env file from example
function createEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  const envExamplePath = path.join(__dirname, '..', '.env.example');

  if (fs.existsSync(envPath)) {
    console.log('⚠️  .env file already exists, skipping...');
    return;
  }

  if (!fs.existsSync(envExamplePath)) {
    console.error('❌ .env.example not found');
    return;
  }

  fs.copyFileSync(envExamplePath, envPath);
  console.log('✅ Created .env file from .env.example');
  console.log('   Edit .env with your credentials after running `supabase start`');
}

// Initialize Supabase (if not already initialized)
function initializeSupabase() {
  const supabasePath = path.join(__dirname, '..', 'supabase');

  if (fs.existsSync(supabasePath) && fs.existsSync(path.join(supabasePath, 'config.toml'))) {
    console.log('✅ Supabase is already initialized');
    return;
  }

  try {
    console.log('📦 Initializing Supabase...');
    execSync('supabase init', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
    console.log('✅ Supabase initialized');
  } catch (error) {
    console.error('❌ Failed to initialize Supabase:', error.message);
  }
}

// Start Supabase local development
function startSupabase() {
  console.log('\n📦 Starting Supabase (this may take a few minutes on first run)...');

  try {
    execSync('supabase start', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
    console.log('\n✅ Supabase is running!');
    return true;
  } catch (error) {
    console.error('❌ Failed to start Supabase:', error.message);
    return false;
  }
}

// Get Supabase connection details
function getSupabaseStatus() {
  try {
    const status = execSync('supabase status', {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf-8'
    });
    console.log('\n📋 Supabase Status:');
    console.log(status);
    console.log('\n💡 Copy the API URL and anon key to your .env file');
  } catch (error) {
    console.error('❌ Failed to get Supabase status:', error.message);
  }
}

// Main setup function
async function main() {
  // 1. Check Supabase CLI
  if (!checkSupabaseCLI()) {
    process.exit(1);
  }

  console.log('');

  // 2. Create .env file
  createEnvFile();

  console.log('');

  // 3. Initialize Supabase
  initializeSupabase();

  console.log('');

  // 4. Ask to start Supabase
  console.log('📦 Ready to start Supabase local development environment');
  console.log('');
  console.log('This will:');
  console.log('  - Start PostgreSQL database (port 54322)');
  console.log('  - Start API server (port 54321)');
  console.log('  - Start Studio UI (port 54323)');
  console.log('  - Apply database migrations');
  console.log('');

  // Start Supabase
  const started = startSupabase();

  if (started) {
    console.log('');
    getSupabaseStatus();
    console.log('');
    console.log('🎉 Setup complete!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Update .env with your Supabase credentials from above');
    console.log('  2. Open Supabase Studio: http://localhost:54323');
    console.log('  3. Start building: npm run dev');
    console.log('');
    console.log('Useful commands:');
    console.log('  npm run dev          - Start development server');
    console.log('  npm run db:reset     - Reset database and apply migrations');
    console.log('  npm run types:generate - Generate TypeScript types from schema');
    console.log('  supabase status      - Check service status');
    console.log('  supabase stop        - Stop all services');
  }
}

main().catch(console.error);
