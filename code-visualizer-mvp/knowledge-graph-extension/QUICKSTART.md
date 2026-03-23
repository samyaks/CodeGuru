# UpdateAI Extension - Quick Start Guide

Get the Supabase integration up and running in 15 minutes!

## Prerequisites

- Node.js installed
- Chrome browser
- Email address for testing
- 15 minutes

## Step 1: Install Dependencies (2 min)

```bash
cd knowledge-graph-extension
npm install
```

This installs `@supabase/supabase-js` and other dependencies.

## Step 2: Create Supabase Project (5 min)

1. Go to [https://supabase.com](https://supabase.com)
2. Click "Start your project" → Sign in with GitHub
3. Click "New Project"
4. Fill in:
   - **Name**: `UpdateAI-Dev`
   - **Database Password**: (generate strong password, save it)
   - **Region**: Choose closest to you
5. Click "Create new project"
6. Wait ~2 minutes for provisioning

## Step 3: Set Up Database (3 min)

1. In Supabase dashboard, click **SQL Editor** (left sidebar)
2. Click **New Query**
3. Copy/paste this SQL:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID REFERENCES auth.users PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all profiles" ON public.users FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);

-- Captures table
CREATE TABLE IF NOT EXISTS public.captures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  url TEXT,
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  team_id UUID,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX captures_user_id_idx ON public.captures(user_id);
CREATE INDEX captures_type_idx ON public.captures(type);
ALTER TABLE public.captures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own captures" ON public.captures FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own captures" ON public.captures FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own captures" ON public.captures FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own captures" ON public.captures FOR DELETE USING (auth.uid() = user_id);

-- Auto-create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

4. Click **Run** (or press Cmd/Ctrl + Enter)
5. Success! Tables created.

## Step 4: Get API Credentials (1 min)

1. In Supabase dashboard, go to **Settings** → **API** (left sidebar)
2. Find these two values:
   - **Project URL**: `https://abcdefgh.supabase.co`
   - **anon public key**: `eyJhbGc...` (long string)
3. Copy both (keep this tab open)

## Step 5: Configure Extension (2 min)

1. Open `src/api/config.js` in your code editor
2. Find these lines (near the top):

```javascript
SUPABASE_URL: 'https://your-project.supabase.co',
SUPABASE_ANON_KEY: 'your-anon-key-here',
```

3. Replace with your actual values:

```javascript
SUPABASE_URL: 'https://abcdefgh.supabase.co',  // Your Project URL
SUPABASE_ANON_KEY: 'eyJhbGc...',               // Your anon key
```

4. Save the file

## Step 6: Load Extension in Chrome (2 min)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Navigate to and select the `knowledge-graph-extension` folder
5. Extension loads successfully!
6. Copy the **Extension ID** (e.g., `abcdefgh12345...`)

## Step 7: Configure Redirect URL (1 min)

1. Go back to Supabase dashboard
2. Go to **Authentication** → **URL Configuration** (left sidebar)
3. Find **Redirect URLs** section
4. Add: `chrome-extension://[YOUR-EXTENSION-ID]/*`
   - Replace `[YOUR-EXTENSION-ID]` with the ID from Step 6
   - Example: `chrome-extension://abcdefgh12345/*`
5. Click **Save**

## Step 8: Test It! (3 min)

### Test 1: Open Extension
1. Click the UpdateAI icon in Chrome toolbar
2. Popup opens ✅
3. No errors in console ✅

### Test 2: Sign In
1. Click "Sign in" or see sign-in prompt
2. Enter your email address
3. Click "Send Magic Link"
4. Check your email (might be in spam)
5. Click the magic link
6. Extension automatically signs you in ✅
7. See your email in the popup ✅

### Test 3: Create Project
1. Enter a project name (e.g., "Test Project")
2. Click "Start Tracking"
3. Project created ✅
4. Toast notification appears ✅

### Test 4: Verify Sync
1. Open browser console (F12)
2. Look for: `[Supabase] Project synced successfully` ✅
3. Go to Supabase dashboard → **Table Editor** → **captures**
4. See your project in the table ✅

## 🎉 Success!

You now have:
- ✅ Working Supabase authentication
- ✅ Data syncing to cloud
- ✅ Offline mode enabled
- ✅ Full extension functionality

## What's Next?

### Learn More
- Read `INTEGRATION_README.md` for detailed documentation
- Check `TESTING_CHECKLIST.md` for comprehensive testing
- See `SUPABASE_SETUP.md` for advanced setup

### Add Features
- Create workspaces
- Add team members
- Set up collaboration
- Enable real-time sync

### Troubleshooting

**"Invalid API credentials" Error**
- Double-check your URL and key in `config.js`
- Make sure there are no extra spaces
- Verify values match Supabase dashboard

**Magic link not working**
- Check spam folder
- Verify redirect URL includes your extension ID
- Ensure email provider is enabled in Supabase

**Data not syncing**
- Check browser console for errors
- Verify you're signed in
- Check network tab for failed requests
- Try clicking "Sync Now" if available

**Extension not loading**
- Run `npm install` first
- Check for console errors
- Reload extension in chrome://extensions

### Get Help

- Console logs: Press F12 and check Console tab
- Service worker logs: Go to chrome://extensions → Service Worker
- Supabase logs: Dashboard → Logs (left sidebar)
- Documentation: See README files in the project

## Development Tips

1. **Enable Dev Mode**
   ```javascript
   // In src/api/config.js
   IS_DEV: true  // Shows more console logs
   ```

2. **Check Sync Status**
   - Look at extension badge (shows pending count)
   - Click extension to see detailed status
   - Check console for sync logs

3. **Test Offline**
   - Chrome DevTools → Network tab → Offline checkbox
   - Make changes while offline
   - Go back online and watch sync

4. **View Supabase Data**
   - Dashboard → Table Editor
   - See all your data in real-time
   - Can manually edit for testing

5. **Reset Everything**
   ```javascript
   // In browser console
   chrome.storage.local.clear()  // Clears all local data
   ```
   Then refresh extension

## Production Checklist

Before deploying to production:

- [ ] Use production Supabase project (not dev)
- [ ] Review and test RLS policies
- [ ] Set up proper error tracking
- [ ] Configure email SMTP for better deliverability
- [ ] Test with multiple users
- [ ] Review rate limits
- [ ] Set up monitoring
- [ ] Document API credentials securely
- [ ] Test on multiple devices
- [ ] Review security settings

## Quick Reference

### Important Files
- `src/api/config.js` - Configuration (edit this)
- `src/api/supabase-client.js` - Supabase client
- `src/popup/popup.js` - Main UI logic
- `src/background/service-worker.js` - Background sync

### Key Console Commands
```javascript
// Check auth status
supabaseClient.isAuthenticated()

// Get current user
supabaseClient.getUser()

// Check sync status
chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' })

// Clear all data
chrome.storage.local.clear()
```

### Supabase Dashboard URLs
- Project: https://supabase.com/dashboard/project/[PROJECT-ID]
- Tables: https://supabase.com/dashboard/project/[PROJECT-ID]/editor
- Auth: https://supabase.com/dashboard/project/[PROJECT-ID]/auth/users
- Logs: https://supabase.com/dashboard/project/[PROJECT-ID]/logs

## Need More Help?

Check these files:
1. `SUPABASE_SETUP.md` - Detailed setup guide
2. `INTEGRATION_README.md` - Full documentation
3. `TESTING_CHECKLIST.md` - Testing guide
4. `IMPLEMENTATION_SUMMARY.md` - Technical details

Or:
- Supabase Discord: https://discord.supabase.com
- Supabase Docs: https://supabase.com/docs
- Create a GitHub issue

---

**Happy building! 🚀**
