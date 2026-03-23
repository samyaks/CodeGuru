#!/bin/bash

# Claude API Integration Setup Script
echo "🤖 Setting up Claude AI Integration..."
echo "======================================"

# 1. Remove OpenAI and install Claude
echo "📦 Installing Claude AI package..."
npm uninstall openai
npm install @anthropic-ai/sdk

# 2. Update .env file for Claude
echo "🔧 Setting up Claude environment variables..."

# Remove old OpenAI key line if it exists
sed -i.bak '/OPENAI_API_KEY/d' .env

# Add Claude API key
if ! grep -q "CLAUDE_API_KEY" .env; then
    echo "" >> .env
    echo "# Claude AI Integration" >> .env
    echo "CLAUDE_API_KEY=your_claude_api_key_here" >> .env
    echo "✅ Added CLAUDE_API_KEY to .env"
else
    echo "✅ CLAUDE_API_KEY already in .env"
fi

echo ""
echo "🎯 Next Steps:"
echo "=============="
echo ""
echo "1. Get Claude API Key:"
echo "   - Go to https://console.anthropic.com/"
echo "   - Navigate to 'API Keys'"
echo "   - Create a new API key"
echo "   - Copy the key (sk-ant-...)"
echo ""
echo "2. Add your Claude API key to .env:"
echo "   nano .env"
echo ""
echo "3. Update server/app.js with Claude functions"
echo ""
echo "4. Test Claude AI:"
echo "   npm run dev"
echo ""
echo "Ready for Claude AI integration! 🚀"
