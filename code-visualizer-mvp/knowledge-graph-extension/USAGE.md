# UpdateAI Extension - Usage Guide

## Getting Started

### 1. Install the Extension

Load the extension in Chrome:
1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the extension directory

### 2. First Time Setup

When you open the extension popup for the first time:

#### Option A: Sign In (Recommended)
1. Click on the extension icon
2. Enter your email address
3. Click "Send Magic Link"
4. Check your email for the magic link
5. Click the link to sign in
6. Extension will automatically sync your data

#### Option B: Continue Offline
1. Click "Continue Offline"
2. Extension works locally without sync
3. Sign in later to enable sync

### 3. Capturing Context

#### From Jira
1. Navigate to any Jira issue
2. Highlight text you want to capture (at least 20 characters)
3. Click the "✨ Add to UpdateAI" button that appears
4. Context is saved with issue metadata

#### From Slack
1. Navigate to any Slack channel
2. Highlight important messages or text
3. Click the "✨ Add to UpdateAI" button
4. Context is saved with channel info

#### From Google Docs
1. Open any Google Doc, Sheet, or Slide
2. Highlight relevant content
3. Click the "✨ Add to UpdateAI" button
4. Context is saved with document info

### 4. Managing Captures

#### View Captures
1. Click the extension icon
2. See all your captures in the popup
3. Captures show:
   - Source (Jira/Slack/Docs)
   - Timestamp
   - Sync status (if signed in)

#### Sync Status Indicators
- **✓ All synced** - Everything backed up
- **🔄 Syncing...** - Upload in progress
- **📴 Offline** - No internet connection
- **🔓 Not signed in** - Local only

#### Manual Sync
If you have pending syncs:
1. Click "Sync Now" button in status bar
2. Wait for sync to complete
3. Status updates automatically

### 5. Working with Workspaces

#### Create a Workspace
1. Click extension icon
2. Click "🚀 Open Workspace" button
3. Enter workspace name and description
4. Click "Create & Open"
5. Workspace opens in new tab

#### Add Capture to Workspace
1. In the captures list, find the capture
2. Click on the capture
3. Select "Add to Workspace"
4. Choose existing workspace or create new
5. Capture is added to workspace

#### View Workspace Activity
- Extension checks for new activity every 15 minutes
- Badge shows number of new items
- Click badge to see details
- Chrome notification for team updates

### 6. Organizing Captures

#### Categorize Captures
1. Click on a capture in the list
2. Click "Categorize" button
3. Choose category:
   - ✅ Progress - Completed work
   - 💡 Decision - Important choices
   - ⚠️ Blocker - Issues preventing progress
   - ➡️ Next Step - Upcoming work
4. Categories help structure summaries

#### Add Notes
1. Click on a capture
2. Click "Add Note" button
3. Enter what happened
4. Notes appear in summaries

#### Generate Summary
1. Organize and categorize your captures
2. Click "✨ Generate Summary" button
3. Summary groups captures by category
4. Copy summary to clipboard
5. Paste in Slack, email, or docs

### 7. Project Tracking

#### Create Project
1. First time: Enter project name
2. Current page is auto-added
3. Project tracks related links

#### Add Pages to Project
1. Navigate to relevant page
2. Extension shows "New page detected!"
3. Click "Add to Project"
4. Page is tracked with project

#### Manage Project
- View all tracked pages
- Remove pages from project
- Reset and start new project
- Generate project summaries

## Advanced Features

### Offline Mode

Extension works fully offline:
- Captures saved locally
- Sync queue holds pending changes
- Auto-syncs when connection restored
- Never lose data

### Conflict Resolution

If you edit on multiple devices:
- Timestamp-based resolution
- Server version wins for synced items
- Local changes preserved as pending
- Manual merge if needed

### Keyboard Shortcuts

In popup:
- `Enter` - Submit forms
- `Escape` - Close modals
- `Cmd/Ctrl + Enter` - Save note

### Badge Notifications

Extension badge shows:
- `!` - New page detected
- Number - Pending syncs or new activity
- Yellow - Pending syncs
- Blue - New workspace activity

### Chrome Notifications

You'll get notifications for:
- Capture added successfully
- Workspace activity from team
- Sync failures (with retry option)

## Tips & Tricks

### 1. Quick Capture Workflow
- Keep extension popup open while working
- Capture as you go, categorize later
- Use notes for quick context
- Generate summary at end of week

### 2. Team Collaboration
- Share workspace links with team
- Everyone captures independently
- View team activity in real-time
- Consolidated workspace view

### 3. Project Updates
1. Track all project pages
2. Add notes throughout week
3. Categorize before Friday
4. Generate summary in 2 minutes
5. Share with team

### 4. Context Switching
- Different project? Create new project
- Old project data stays safe
- Switch back anytime
- All projects synced if signed in

### 5. Mobile Access
- Sign in on desktop extension
- Access workspaces on any device
- Captures sync automatically
- Full workspace features on web

## Troubleshooting

### Captures Not Syncing
1. Check internet connection
2. Check sign-in status
3. Click "Sync Now" button
4. Check console for errors
5. Retry after a few minutes

### Magic Link Not Received
1. Check spam/junk folder
2. Wait 2-3 minutes
3. Try again with different email
4. Contact support if persists

### Workspace Not Loading
1. Check sign-in status
2. Refresh workspace list
3. Check workspace permissions
4. Clear cache and retry

### Extension Not Detecting Page
1. Refresh the page
2. Check if site is supported
3. Look for page type in console
4. Report unsupported sites

### Sync Conflicts
1. Check sync status
2. Manual sync if needed
3. Review conflict items
4. Keep latest version
5. Contact support if stuck

## Privacy & Security

### What We Store
- Captured text and metadata
- Auth tokens (encrypted)
- User preferences
- Workspace memberships

### What We Don't Store
- Passwords
- Full page content
- Browsing history
- Personal data (beyond email)

### Data Control
- Export all data anytime
- Delete account and data
- Choose what to sync
- Offline mode available

## Support

### Get Help
- Check this guide first
- Look at README.md for technical details
- GitHub Issues: [repository-url]
- Email: support@updateai.app

### Report Issues
Include:
- What you were doing
- What happened vs expected
- Browser console errors
- Screenshots if helpful

### Request Features
We love feedback! Tell us:
- What you're trying to do
- Current workarounds
- How it would help you
- Example use cases

## Updates

Extension auto-updates from Chrome Web Store.

To update manually in development:
1. Pull latest code
2. Click "Reload" in chrome://extensions/
3. Extension updates immediately

## Next Steps

1. ✅ Install extension
2. ✅ Sign in or continue offline
3. ✅ Make your first capture
4. ✅ Create a workspace
5. ✅ Generate your first summary
6. 🎉 Share with team!

---

Happy capturing! 🚀
