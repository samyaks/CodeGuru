-- UpdateAI Row Level Security (RLS) Policies
-- This ensures users can only access data they're authorized to see

-- ============================================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Check if user is member of a team
CREATE OR REPLACE FUNCTION public.is_team_member(team_uuid UUID, user_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = team_uuid
    AND user_id = user_uuid
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Check if user has access to workspace
CREATE OR REPLACE FUNCTION public.can_access_workspace(workspace_uuid UUID, user_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces w
    LEFT JOIN public.workspace_members wm ON w.id = wm.workspace_id
    WHERE w.id = workspace_uuid
    AND (
      w.created_by = user_uuid
      OR wm.user_id = user_uuid
      OR (w.team_id IS NOT NULL AND public.is_team_member(w.team_id, user_uuid))
    )
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Check workspace role
CREATE OR REPLACE FUNCTION public.get_workspace_role(workspace_uuid UUID, user_uuid UUID)
RETURNS workspace_role AS $$
  SELECT CASE
    WHEN w.created_by = user_uuid THEN 'owner'::workspace_role
    WHEN wm.role IS NOT NULL THEN wm.role
    ELSE NULL
  END
  FROM public.workspaces w
  LEFT JOIN public.workspace_members wm ON w.id = wm.workspace_id AND wm.user_id = user_uuid
  WHERE w.id = workspace_uuid
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- Check if user can edit workspace
CREATE OR REPLACE FUNCTION public.can_edit_workspace(workspace_uuid UUID, user_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT public.get_workspace_role(workspace_uuid, user_uuid) IN ('owner', 'editor');
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================================
-- USERS POLICIES
-- ============================================================================

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (auth.uid() = id);

-- Users can view profiles of team members
CREATE POLICY "Users can view team member profiles"
  ON public.users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm1
      INNER JOIN public.team_members tm2 ON tm1.team_id = tm2.team_id
      WHERE tm1.user_id = auth.uid()
      AND tm2.user_id = users.id
    )
  );

-- ============================================================================
-- TEAMS POLICIES
-- ============================================================================

-- Users can view teams they're members of
CREATE POLICY "Users can view their teams"
  ON public.teams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_id = teams.id
      AND user_id = auth.uid()
    )
  );

-- Users can create teams
CREATE POLICY "Users can create teams"
  ON public.teams FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Team owners/admins can update team
CREATE POLICY "Team admins can update team"
  ON public.teams FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_id = teams.id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

-- Only owners can delete team
CREATE POLICY "Team owners can delete team"
  ON public.teams FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_id = teams.id
      AND user_id = auth.uid()
      AND role = 'owner'
    )
  );

-- ============================================================================
-- TEAM MEMBERS POLICIES
-- ============================================================================

-- Users can view members of their teams
CREATE POLICY "Users can view team members"
  ON public.team_members FOR SELECT
  USING (public.is_team_member(team_id, auth.uid()));

-- Team admins can add members
CREATE POLICY "Team admins can add members"
  ON public.team_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_id = team_members.team_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

-- Team admins can update member roles
CREATE POLICY "Team admins can update member roles"
  ON public.team_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = team_members.team_id
      AND tm.user_id = auth.uid()
      AND tm.role IN ('owner', 'admin')
    )
  );

-- Team admins can remove members (except owners)
CREATE POLICY "Team admins can remove members"
  ON public.team_members FOR DELETE
  USING (
    role != 'owner' AND
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = team_members.team_id
      AND tm.user_id = auth.uid()
      AND tm.role IN ('owner', 'admin')
    )
  );

-- Users can remove themselves from teams
CREATE POLICY "Users can leave teams"
  ON public.team_members FOR DELETE
  USING (user_id = auth.uid() AND role != 'owner');

-- ============================================================================
-- CAPTURES POLICIES
-- ============================================================================

-- Users can view their own captures
CREATE POLICY "Users can view own captures"
  ON public.captures FOR SELECT
  USING (user_id = auth.uid());

-- Users can view team captures
CREATE POLICY "Users can view team captures"
  ON public.captures FOR SELECT
  USING (
    team_id IS NOT NULL
    AND public.is_team_member(team_id, auth.uid())
  );

-- Users can create captures
CREATE POLICY "Users can create captures"
  ON public.captures FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own captures
CREATE POLICY "Users can update own captures"
  ON public.captures FOR UPDATE
  USING (user_id = auth.uid());

-- Users can delete their own captures
CREATE POLICY "Users can delete own captures"
  ON public.captures FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- WORKSPACES POLICIES
-- ============================================================================

-- Users can view workspaces they have access to
CREATE POLICY "Users can view accessible workspaces"
  ON public.workspaces FOR SELECT
  USING (public.can_access_workspace(id, auth.uid()));

-- Users can create workspaces
CREATE POLICY "Users can create workspaces"
  ON public.workspaces FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- Users can update workspaces they can edit
CREATE POLICY "Users can update editable workspaces"
  ON public.workspaces FOR UPDATE
  USING (public.can_edit_workspace(id, auth.uid()));

-- Workspace owners can delete workspace
CREATE POLICY "Workspace owners can delete"
  ON public.workspaces FOR DELETE
  USING (created_by = auth.uid());

-- ============================================================================
-- WORKSPACE MEMBERS POLICIES
-- ============================================================================

-- Users can view members of accessible workspaces
CREATE POLICY "Users can view workspace members"
  ON public.workspace_members FOR SELECT
  USING (public.can_access_workspace(workspace_id, auth.uid()));

-- Workspace owners/editors can add members
CREATE POLICY "Workspace editors can add members"
  ON public.workspace_members FOR INSERT
  WITH CHECK (
    public.get_workspace_role(workspace_id, auth.uid()) IN ('owner', 'editor')
  );

-- Workspace owners/editors can update member roles
CREATE POLICY "Workspace editors can update members"
  ON public.workspace_members FOR UPDATE
  USING (
    public.get_workspace_role(workspace_id, auth.uid()) IN ('owner', 'editor')
  );

-- Workspace owners/editors can remove members
CREATE POLICY "Workspace editors can remove members"
  ON public.workspace_members FOR DELETE
  USING (
    public.get_workspace_role(workspace_id, auth.uid()) IN ('owner', 'editor')
  );

-- Users can remove themselves from workspaces
CREATE POLICY "Users can leave workspaces"
  ON public.workspace_members FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- WORKSPACE CAPTURES POLICIES
-- ============================================================================

-- Users can view captures in accessible workspaces
CREATE POLICY "Users can view workspace captures"
  ON public.workspace_captures FOR SELECT
  USING (public.can_access_workspace(workspace_id, auth.uid()));

-- Workspace editors can add captures
CREATE POLICY "Workspace editors can add captures"
  ON public.workspace_captures FOR INSERT
  WITH CHECK (
    public.can_edit_workspace(workspace_id, auth.uid())
  );

-- Workspace editors can update captures
CREATE POLICY "Workspace editors can update captures"
  ON public.workspace_captures FOR UPDATE
  USING (public.can_edit_workspace(workspace_id, auth.uid()));

-- Workspace editors can remove captures
CREATE POLICY "Workspace editors can remove captures"
  ON public.workspace_captures FOR DELETE
  USING (public.can_edit_workspace(workspace_id, auth.uid()));

-- ============================================================================
-- PROMPT SECTIONS POLICIES
-- ============================================================================

-- Users can view sections in accessible workspaces
CREATE POLICY "Users can view prompt sections"
  ON public.prompt_sections FOR SELECT
  USING (public.can_access_workspace(workspace_id, auth.uid()));

-- Workspace editors can create sections
CREATE POLICY "Workspace editors can create sections"
  ON public.prompt_sections FOR INSERT
  WITH CHECK (
    public.can_edit_workspace(workspace_id, auth.uid())
    AND created_by = auth.uid()
  );

-- Workspace editors can update sections
CREATE POLICY "Workspace editors can update sections"
  ON public.prompt_sections FOR UPDATE
  USING (public.can_edit_workspace(workspace_id, auth.uid()));

-- Workspace editors can delete sections
CREATE POLICY "Workspace editors can delete sections"
  ON public.prompt_sections FOR DELETE
  USING (public.can_edit_workspace(workspace_id, auth.uid()));

-- ============================================================================
-- COLLABORATION SESSIONS POLICIES
-- ============================================================================

-- Users can view active sessions in workspaces they can access
CREATE POLICY "Users can view collaboration sessions"
  ON public.collaboration_sessions FOR SELECT
  USING (
    public.can_access_workspace(workspace_id, auth.uid())
    AND ended_at IS NULL
  );

-- Users can create their own sessions
CREATE POLICY "Users can create own sessions"
  ON public.collaboration_sessions FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own sessions
CREATE POLICY "Users can update own sessions"
  ON public.collaboration_sessions FOR UPDATE
  USING (user_id = auth.uid());

-- Users can delete their own sessions
CREATE POLICY "Users can delete own sessions"
  ON public.collaboration_sessions FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================================
-- COMMENTS POLICIES
-- ============================================================================

-- Users can view comments in accessible workspaces
CREATE POLICY "Users can view comments"
  ON public.comments FOR SELECT
  USING (public.can_access_workspace(workspace_id, auth.uid()));

-- Users can create comments in accessible workspaces
CREATE POLICY "Users can create comments"
  ON public.comments FOR INSERT
  WITH CHECK (
    public.can_access_workspace(workspace_id, auth.uid())
    AND user_id = auth.uid()
  );

-- Users can update their own comments
CREATE POLICY "Users can update own comments"
  ON public.comments FOR UPDATE
  USING (user_id = auth.uid());

-- Users can delete their own comments
CREATE POLICY "Users can delete own comments"
  ON public.comments FOR DELETE
  USING (user_id = auth.uid());

-- Workspace editors can resolve comments
CREATE POLICY "Workspace editors can resolve comments"
  ON public.comments FOR UPDATE
  USING (
    public.can_edit_workspace(workspace_id, auth.uid())
    AND (is_resolved != OLD.is_resolved) -- Only allow changing resolution status
  );

-- ============================================================================
-- ACTIVITY LOG POLICIES
-- ============================================================================

-- Users can view activity log of accessible workspaces
CREATE POLICY "Users can view activity log"
  ON public.activity_log FOR SELECT
  USING (
    workspace_id IS NULL
    OR public.can_access_workspace(workspace_id, auth.uid())
  );

-- System can insert activity logs (via service role)
CREATE POLICY "Service role can insert activity logs"
  ON public.activity_log FOR INSERT
  WITH CHECK (true);

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

-- Grant usage on custom types
GRANT USAGE ON TYPE team_role TO authenticated;
GRANT USAGE ON TYPE workspace_role TO authenticated;
GRANT USAGE ON TYPE capture_type TO authenticated;
GRANT USAGE ON TYPE workspace_status TO authenticated;
GRANT USAGE ON TYPE section_type TO authenticated;
GRANT USAGE ON TYPE activity_type TO authenticated;

-- Grant execute on helper functions
GRANT EXECUTE ON FUNCTION public.is_team_member TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_workspace TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_role TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_workspace TO authenticated;
