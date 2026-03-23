# UpdateAI Extension - Setup Guide

This guide will help you set up Supabase authentication and API integration for the UpdateAI Chrome extension.

## Prerequisites

- Node.js 16+ and npm
- Chrome browser (for testing)
- A Supabase account (free tier is sufficient)

## Step 1: Supabase Project Setup

### 1.1 Create a Supabase Project

1. Go to [https://app.supabase.com](https://app.supabase.com)
2. Click "New Project"
3. Fill in:
   - **Project name**: `UpdateAI` (or your preferred name)
   - **Database password**: Generate a strong password and save it
   - **Region**: Choose closest to your users
4. Wait for the project to be created (2-3 minutes)

### 1.2 Get Your API Credentials

1. In your Supabase project dashboard, go to **Settings > API**
2. Copy the following values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **Anon/Public Key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (long string)

### 1.3 Set Up Database Schema

1. Go to **SQL Editor** in your Supabase dashboard
2. Run the schema migration from `backend/migrations/001_initial_schema.sql`
3. This creates all necessary tables:
   - `users` - User profiles
   - `captures` - Content captures from web pages
   - `workspaces` - Collaborative workspaces
   - `workspace_members` - Workspace membership
   - `workspace_captures` - Link captures to workspaces
   - `comments` - Workspace comments
   - `collaboration_sessions` - Real-time collaboration

### 1.4 Configure Authentication

1. Go to **Authentication > Providers** in Supabase
2. Enable **Email** provider
3. Configure Email Auth settings:
   - ✅ Enable Email provider
   - ✅ Enable Email OTP (Magic Link)
   - ✅ Confirm email (optional, disable for development)
4. (Optional) Customize email templates:
   - Go to **Authentication > Email Templates**
   - Customize "Magic Link" template with your branding

### 1.5 Set Up Row Level Security (RLS)

The migration script includes RLS policies, but verify they're enabled:

1. Go to **Table Editor**
2. For each table, click on the table name → **RLS** tab
3. Ensure RLS is **enabled** for all tables
4. Verify policies exist:
   - Users can only access their own data
   - Workspace members can access workspace data
   - Public read for shared workspaces (if applicable)

## Step 2: Configure the Extension

### 2.1 Set Environment Variables

Create a `.env` file in the project root:

```bash
# .env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

⚠️ **Important**: Never commit `.env` to git. It's already in `.gitignore`.

### 2.2 Update Config File

If not using a build system that injects environment variables, update `src/api/config.js` directly:

```javascript
export const API_CONFIG = {
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key-here',
  // ... rest of config
};
```

### 2.3 Install Dependencies

```bash
npm install
```

Required dependencies:
- `@supabase/supabase-js` - Supabase client library
- Chrome extension APIs (built-in)

## Step 3: Build and Load Extension

### 3.1 Build the Extension

```bash
npm run build
```

This will:
1. Bundle all JavaScript files
2. Inject environment variables
3. Create a `dist/` folder ready for loading

### 3.2 Load in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `dist/` folder (or project root if not using build)
5. The extension should now appear in your extensions list

### 3.3 Verify Installation

1. Click the UpdateAI extension icon in Chrome toolbar
2. The popup should open without errors
3. Check the console for any error messages:
   - Right-click on popup → **Inspect**
   - Look for `[Supabase] Session restored` or `[Supabase] User not authenticated`

## Step 4: Test Authentication

### 4.1 Test Magic Link Sign-In

1. Open the extension popup
2. You should see a sign-in screen (if not already signed in)
3. Enter your email address
4. Click "Send Magic Link"
5. Check your email for the magic link
6. Click the link in your email
7. You should be redirected and automatically signed in
8. The popup should show your profile at the top

### 4.2 Verify Auth State

Check the browser console:
```javascript
// In popup console (Inspect > Console):
chrome.storage.local.get(['supabase.auth.token', 'user'], (result) => {
  console.log('Auth token:', result['supabase.auth.token'] ? 'Present' : 'Missing');
  console.log('User:', result.user);
});
```

### 4.3 Test Sign Out

1. Click the **Logout** button in the popup
2. Verify you're redirected to sign-in screen
3. Check storage is cleared:
```javascript
chrome.storage.local.get(null, (items) => {
  console.log('All storage:', items);
  // Should not contain auth tokens
});
```

## Step 5: Test Data Operations

### 5.1 Test Project Creation

1. Sign in to the extension
2. Create a new project with a test name
3. Check Supabase dashboard:
   - Go to **Table Editor > captures**
   - You should see a new row with `type = 'project'`
   - The `metadata` field should contain your project data

### 5.2 Test Adding Links

1. Navigate to any webpage (e.g., `github.com`)
2. Open the extension popup
3. Click "Add to Project"
4. The link should appear in your project list
5. Verify in Supabase that the project's `metadata.links` array updated

### 5.3 Test Offline Mode

1. Sign in and create some data
2. Disconnect from internet (or use Chrome DevTools offline mode)
3. Create more data (add links, etc.)
4. Reconnect to internet
5. Wait 30 seconds for automatic sync
6. Verify data appears in Supabase dashboard

## Step 6: Test Sync Functionality

### 6.1 Test Background Sync

1. Sign in on Device A
2. Create a project with some links
3. Sign in on Device B (different browser/machine)
4. Wait up to 10 minutes for automatic sync
5. Or manually trigger: Click "Sync Now" in popup
6. Verify data appears on Device B

### 6.2 Check Sync Status

In the popup, you should see a sync status indicator:
- ✓ **All synced** (green) - Everything is in sync
- 🔄 **Syncing...** (yellow) - Sync in progress
- 📴 **Offline** (gray) - No internet connection
- 🔓 **Not signed in** (gray) - Sign in to enable sync

### 6.3 Test Conflict Resolution

1. Go offline on Device A
2. Edit the same project
3. Go offline on Device B
4. Edit the same project differently
5. Reconnect both devices
6. The latest edit should win (last-write-wins strategy)

## Common Issues and Solutions

### Issue: "Missing Supabase credentials"

**Solution**: 
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set correctly
- Check the config file has been updated
- Rebuild the extension with `npm run build`

### Issue: Magic link not received

**Solution**:
- Check spam folder
- Verify email provider is enabled in Supabase
- Check Supabase logs: **Authentication > Logs**
- Verify email template is configured correctly

### Issue: "Authentication failed" error

**Solution**:
- Clear extension storage: `chrome://extensions/` → UpdateAI → "Clear storage"
- Sign out and sign back in
- Check Supabase session hasn't expired (7 days default)
- Verify RLS policies allow user access

### Issue: Data not syncing

**Solution**:
- Check internet connection
- Verify you're signed in (check auth status in popup)
- Check browser console for errors
- Check service worker console: `chrome://extensions/` → UpdateAI → "service worker" → Inspect
- Manually trigger sync with "Sync Now" button

### Issue: RLS policy errors

**Solution**:
- Go to Supabase dashboard → **Table Editor**
- Click on table → **RLS** tab
- Ensure policies exist and are enabled
- Common policy for user-owned data:
  ```sql
  CREATE POLICY "Users can access own data"
  ON captures FOR ALL
  USING (auth.uid() = user_id);
  ```

### Issue: Extension not loading

**Solution**:
- Check manifest.json is valid
- Verify all files are in dist/ folder
- Check browser console for syntax errors
- Try reloading extension: `chrome://extensions/` → UpdateAI → Reload

## Development Tips

### Enable Verbose Logging

In `src/api/supabase-client.js`:

```javascript
// Add at top of file
const DEBUG = true;

// Then add debug logs throughout:
if (DEBUG) console.log('[Supabase Debug]', ...);
```

### Test in Incognito Mode

Testing in incognito mode ensures clean state:
1. `Ctrl+Shift+N` (or `Cmd+Shift+N` on Mac)
2. Enable extension in incognito: `chrome://extensions/` → UpdateAI → "Allow in incognito"
3. Test authentication flow

### Use Supabase Studio

Supabase Studio is great for debugging:
- View real-time logs: **Logs Explorer**
- Query data directly: **SQL Editor**
- Monitor API usage: **API Docs**
- Check auth sessions: **Authentication > Users**

### Test Service Worker

Service worker handles background sync:
1. Go to `chrome://extensions/`
2. Find UpdateAI extension
3. Click "service worker" link
4. Inspect the console for background logs
5. Manually trigger sync: Call functions from console

## Production Deployment

### 1. Environment Configuration

For production, use environment variables:

```bash
# .env.production
SUPABASE_URL=https://your-production-project.supabase.co
SUPABASE_ANON_KEY=your-production-anon-key
```

### 2. Build for Production

```bash
npm run build:production
```

This will:
- Minify code
- Remove debug logs
- Inject production environment variables
- Create optimized bundle

### 3. Test Production Build

1. Load the production build in Chrome
2. Test all features thoroughly
3. Check for console errors
4. Monitor Supabase usage in dashboard

### 4. Submit to Chrome Web Store

Follow [Chrome Web Store publishing guide](https://developer.chrome.com/docs/webstore/publish/)

## Security Checklist

Before going to production:

- [ ] Supabase RLS policies are enabled on all tables
- [ ] Email confirmation is enabled (optional but recommended)
- [ ] API keys are not committed to git
- [ ] Production environment uses different Supabase project than development
- [ ] CORS is properly configured in Supabase
- [ ] Rate limiting is configured in Supabase
- [ ] User data is encrypted at rest (Supabase default)
- [ ] HTTPS is enforced (Supabase default)
- [ ] Sensitive data is not logged to console in production

## Support

Need help? Check these resources:

- **Supabase Docs**: https://supabase.com/docs
- **Supabase Discord**: https://discord.supabase.com
- **Chrome Extension Docs**: https://developer.chrome.com/docs/extensions/
- **Project Issues**: Open an issue on GitHub

## Next Steps

Now that you have the basic setup working:

1. Customize the UI in `src/popup/`
2. Add more capture types (Notion, Linear, etc.)
3. Implement workspace collaboration features
4. Add export functionality
5. Set up analytics (optional)

Happy coding! 🚀
