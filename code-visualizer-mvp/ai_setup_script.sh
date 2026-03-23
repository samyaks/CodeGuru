#!/bin/bash

# AI Integration Setup Script
# Run this from your code-visualizer-mvp directory

echo "🤖 Setting up Real AI Integration..."
echo "====================================="

# 1. Install OpenAI package
echo "📦 Installing OpenAI package..."
npm install openai

# 2. Update .env file with API key placeholder
echo "🔧 Setting up environment variables..."

if [ ! -f .env ]; then
    touch .env
fi

# Add OpenAI API key placeholder if not exists
if ! grep -q "OPENAI_API_KEY" .env; then
    echo "" >> .env
    echo "# OpenAI API Integration" >> .env
    echo "OPENAI_API_KEY=your_openai_api_key_here" >> .env
    echo "✅ Added OPENAI_API_KEY placeholder to .env"
else
    echo "✅ OPENAI_API_KEY already in .env"
fi

# 3. Create backup of current server
echo "💾 Creating backup of current server..."
cp server/app.js server/app.js.backup
echo "✅ Backup created: server/app.js.backup"

# 4. Instructions for user
echo ""
echo "🎯 Next Steps:"
echo "=============="
echo ""
echo "1. Get OpenAI API Key:"
echo "   - Go to https://platform.openai.com/api-keys"
echo "   - Create a new API key"
echo "   - Copy the key (sk-...)"
echo ""
echo "2. Add your API key to .env:"
echo "   nano .env"
echo "   # Replace 'your_openai_api_key_here' with your actual key"
echo ""
echo "3. Update server/app.js:"
echo "   - Add the Real AI Integration code to your server/app.js"
echo "   - Replace the simulation functions with AI functions"
echo ""
echo "4. Test real AI:"
echo "   npm run dev"
echo "   # Try: 'Build me a calculator app'"
echo "   # Try: 'Create a weather dashboard'"
echo "   # Try: 'Make a quiz game'"
echo ""
echo "📝 Your .env file should look like:"
echo "PORT=3001"
echo "NODE_ENV=development"
echo "OPENAI_API_KEY=sk-your-actual-key-here"
echo ""
echo "🚨 Important: Never commit your API key to git!"
echo "✅ .env is already in .gitignore"
echo ""
echo "Ready to add real AI integration! 🚀"
