# Supabase Setup Guide for UpdateAI Extension

This guide walks you through setting up Supabase authentication and database for the UpdateAI Chrome extension.

## Prerequisites

- A Supabase account (sign up at https://supabase.com)
- Node.js installed (for npm install)
- Basic understanding of SQL

## Step 1: Create a Supabase Project

1. Go to https://supabase.com/dashboard
2. Click "New Project"
3. Fill in project details:
   - **Name**: UpdateAI Extension
   - **Database Password**: Save this securely
   - **Region**: Choose closest to your users
4. Click "Create new project"
5. Wait for project to be provisioned (~2 minutes)

## Step 2: Get Your API Credentials

1. In your Supabase project dashboard, go to **Settings** > **API**
2. Copy these values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon (public) key**: `eyJhbGc...` (long string)
3. Open `src/api/config.js` in the extension
4. Replace the placeholder values:

```javascript
const API_CONFIG = {
  SUPABASE_URL: 'https://your-project-id.supabase.co',  // Paste your Project URL
  SUPABASE_ANON_KEY: 'eyJhbGc...',  // Paste your anon key
  // ... rest of config
};
```

## Step 3: Set Up Database Schema

Go to the SQL Editor in Supabase and run the following SQL commands:

### Enable UUID Extension

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Create Users Table

```sql
-- Users are automatically created by Supabase Auth
-- We just extend the built-in auth.users table with a profiles view
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

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users can read all profiles
CREATE POLICY "Users can view all profiles" ON public.users
  FOR SELECT USING (true);

-- Users can only update their own profile
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);
```

### Create Captures Table

```sql
CREATE TABLE IF NOT EXISTS public.captures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('jira', 'slack', 'google-docs', 'github', 'figma', 'notion', 'custom', 'project')),
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

-- Create index for performance
CREATE INDEX captures_user_id_idx ON public.captures(user_id);
CREATE INDEX captures_type_idx ON public.captures(type);
CREATE INDEX captures_captured_at_idx ON public.captures(captured_at DESC);

-- Enable Row Level Security
ALTER TABLE public.captures ENABLE ROW LEVEL SECURITY;

-- Users can only see their own captures
CREATE POLICY "Users can view own captures" ON public.captures
  FOR SELECT USING (auth.uid() = user_id);

-- Users can create their own captures
CREATE POLICY "Users can create own captures" ON public.captures
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own captures
CREATE POLICY "Users can update own captures" ON public.captures
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own captures
CREATE POLICY "Users can delete own captures" ON public.captures
  FOR DELETE USING (auth.uid() = user_id);
```

### Create Workspaces Table

```sql
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'review', 'completed', 'archived')),
  template JSONB DEFAULT '{}',
  team_id UUID,
  created_by UUID REFERENCES public.users(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for performance
CREATE INDEX workspaces_created_by_idx ON public.workspaces(created_by);
CREATE INDEX workspaces_status_idx ON public.workspaces(status);
CREATE INDEX workspaces_last_activity_idx ON public.workspaces(last_activity_at DESC);

-- Enable Row Level Security
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- Users can see workspaces they're members of (handled by workspace_members table)
```

### Create Workspace Members Table

```sql
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'commenter', 'viewer')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

-- Create index
CREATE INDEX workspace_members_workspace_id_idx ON public.workspace_members(workspace_id);
CREATE INDEX workspace_members_user_id_idx ON public.workspace_members(user_id);

-- Enable Row Level Security
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- Users can see members of workspaces they belong to
CREATE POLICY "Users can view workspace members" ON public.workspace_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_members.workspace_id
      AND wm.user_id = auth.uid()
    )
  );
```

### Create Database Function for User Creation

```sql
-- Create a function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create user profile
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

### Create RPC Function for Workspace Creation

```sql
-- Function to create workspace and add user as owner
CREATE OR REPLACE FUNCTION public.create_workspace(
  workspace_name TEXT,
  workspace_description TEXT DEFAULT NULL,
  workspace_team_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  new_workspace_id UUID;
BEGIN
  -- Create workspace
  INSERT INTO public.workspaces (name, description, team_id, created_by)
  VALUES (workspace_name, workspace_description, workspace_team_id, auth.uid())
  RETURNING id INTO new_workspace_id;
  
  -- Add creator as owner
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace_id, auth.uid(), 'owner');
  
  RETURN new_workspace_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

## Step 4: Configure Email Authentication

1. In Supabase Dashboard, go to **Authentication** > **Providers**
2. Ensure **Email** provider is enabled
3. Configure Email Templates (optional):
   - Go to **Authentication** > **Email Templates**
   - Customize the "Magic Link" template for your brand
4. Set **Site URL** in **Authentication** > **URL Configuration**:
   - For development: `chrome-extension://[your-extension-id]`
   - You'll get the extension ID after loading it in Chrome

## Step 5: Install Extension Dependencies

```bash
cd knowledge-graph-extension
npm install
```

This will install `@supabase/supabase-js` and other required packages.

## Step 6: Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `knowledge-graph-extension` folder
5. Note the Extension ID (e.g., `abcdefghijklmnop...`)
6. Go back to Supabase → **Authentication** → **URL Configuration**
7. Add to **Redirect URLs**: `chrome-extension://[your-extension-id]/*`

## Step 7: Test Authentication

1. Click the UpdateAI extension icon in Chrome
2. Click "Sign in" or the sign-in prompt
3. Enter your email address
4. Click "Send Magic Link"
5. Check your email for the magic link
6. Click the link - you should be automatically signed in!

## Troubleshooting

### "Invalid API credentials" Error

- Double-check your `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `config.js`
- Make sure there are no extra spaces or quotes
- Verify the project is fully provisioned in Supabase dashboard

### Magic Link Doesn't Work

- Check **Authentication** > **URL Configuration** has correct redirect URL
- Verify email provider is enabled
- Check spam folder for magic link email
- Check browser console for errors (F12)

### Data Not Syncing

- Check browser console for errors
- Verify Row Level Security policies are correct
- Ensure you're authenticated (check extension popup)
- Test network connectivity

### Extension Shows "Offline Mode"

- This means the Supabase config is missing or invalid
- Review `config.js` and ensure credentials are correct
- Check browser network tab for failed requests

## Security Best Practices

1. **Never commit real credentials** to git
   - The `.env.example` file is safe (contains no real values)
   - Never commit actual `config.js` with real keys

2. **Use Row Level Security (RLS)**
   - All tables should have RLS enabled
   - Users should only access their own data

3. **Anon Key is Public**
   - The anon key can be exposed in the extension
   - RLS policies protect your data even if key is public
   - Never use the service_role key in the extension

4. **Email Rate Limiting**
   - Supabase limits magic link emails (4 per hour per IP)
   - Consider social auth for production

## Next Steps

- [ ] Test creating captures
- [ ] Test creating workspaces
- [ ] Test offline sync functionality
- [ ] Set up collaboration features
- [ ] Configure real-time subscriptions
- [ ] Add team support

## Need Help?

- Supabase Docs: https://supabase.com/docs
- Supabase Discord: https://discord.supabase.com
- Extension Issues: Create an issue in the repository

## Production Deployment

For production:

1. Upgrade Supabase plan if needed (free tier has limits)
2. Set up custom domain for Supabase project
3. Configure email SMTP for better deliverability
4. Set up monitoring and alerts
5. Review and optimize RLS policies
6. Consider implementing refresh token rotation
7. Add analytics and error tracking
