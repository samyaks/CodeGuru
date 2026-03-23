-- UpdateAI Database Functions
-- Complex operations and business logic

-- ============================================================================
-- USER MANAGEMENT
-- ============================================================================

-- Create user profile on signup (called via trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update last seen timestamp
CREATE OR REPLACE FUNCTION public.update_last_seen()
RETURNS void AS $$
BEGIN
  UPDATE public.users
  SET last_seen_at = NOW()
  WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- TEAM MANAGEMENT
-- ============================================================================

-- Create team and make creator the owner
CREATE OR REPLACE FUNCTION public.create_team(
  team_name TEXT,
  team_slug TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  new_team_id UUID;
  generated_slug TEXT;
BEGIN
  -- Generate slug if not provided
  IF team_slug IS NULL THEN
    generated_slug := lower(regexp_replace(team_name, '[^a-zA-Z0-9]+', '-', 'g'));
    generated_slug := trim(both '-' from generated_slug);
  ELSE
    generated_slug := team_slug;
  END IF;
  
  -- Create team
  INSERT INTO public.teams (name, slug, created_by)
  VALUES (team_name, generated_slug, auth.uid())
  RETURNING id INTO new_team_id;
  
  -- Add creator as owner
  INSERT INTO public.team_members (team_id, user_id, role, invited_by)
  VALUES (new_team_id, auth.uid(), 'owner', auth.uid());
  
  RETURN new_team_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- WORKSPACE MANAGEMENT
-- ============================================================================

-- Create workspace with automatic membership
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
  INSERT INTO public.workspaces (name, description, created_by, team_id)
  VALUES (workspace_name, workspace_description, auth.uid(), workspace_team_id)
  RETURNING id INTO new_workspace_id;
  
  -- Add creator as owner
  INSERT INTO public.workspace_members (workspace_id, user_id, role, invited_by)
  VALUES (new_workspace_id, auth.uid(), 'owner', auth.uid());
  
  -- Log activity
  INSERT INTO public.activity_log (workspace_id, user_id, activity_type, description)
  VALUES (
    new_workspace_id,
    auth.uid(),
    'workspace_created',
    'Created workspace: ' || workspace_name
  );
  
  RETURN new_workspace_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add capture to workspace
CREATE OR REPLACE FUNCTION public.add_capture_to_workspace(
  workspace_uuid UUID,
  capture_uuid UUID,
  section_name TEXT DEFAULT NULL,
  capture_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  new_link_id UUID;
  max_position INTEGER;
BEGIN
  -- Check access
  IF NOT public.can_edit_workspace(workspace_uuid, auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  
  -- Get max position
  SELECT COALESCE(MAX(position), -1) + 1
  INTO max_position
  FROM public.workspace_captures
  WHERE workspace_id = workspace_uuid;
  
  -- Link capture
  INSERT INTO public.workspace_captures (
    workspace_id,
    capture_id,
    position,
    section,
    notes,
    added_by
  )
  VALUES (
    workspace_uuid,
    capture_uuid,
    max_position,
    section_name,
    capture_notes,
    auth.uid()
  )
  RETURNING id INTO new_link_id;
  
  -- Log activity
  INSERT INTO public.activity_log (workspace_id, user_id, activity_type, description, metadata)
  VALUES (
    workspace_uuid,
    auth.uid(),
    'capture_added',
    'Added capture to workspace',
    jsonb_build_object('capture_id', capture_uuid, 'section', section_name)
  );
  
  RETURN new_link_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reorder captures in workspace
CREATE OR REPLACE FUNCTION public.reorder_workspace_captures(
  workspace_uuid UUID,
  capture_order UUID[]
)
RETURNS void AS $$
DECLARE
  capture_uuid UUID;
  idx INTEGER := 0;
BEGIN
  -- Check access
  IF NOT public.can_edit_workspace(workspace_uuid, auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  
  -- Update positions
  FOREACH capture_uuid IN ARRAY capture_order
  LOOP
    UPDATE public.workspace_captures
    SET position = idx
    WHERE workspace_id = workspace_uuid
    AND capture_id = capture_uuid;
    
    idx := idx + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Duplicate workspace
CREATE OR REPLACE FUNCTION public.duplicate_workspace(
  workspace_uuid UUID,
  new_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  new_workspace_id UUID;
  old_workspace RECORD;
  capture_record RECORD;
  section_record RECORD;
BEGIN
  -- Check access
  IF NOT public.can_access_workspace(workspace_uuid, auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  
  -- Get original workspace
  SELECT * INTO old_workspace
  FROM public.workspaces
  WHERE id = workspace_uuid;
  
  -- Create new workspace
  INSERT INTO public.workspaces (
    name,
    description,
    status,
    created_by,
    team_id,
    template,
    settings
  )
  VALUES (
    COALESCE(new_name, old_workspace.name || ' (Copy)'),
    old_workspace.description,
    'draft',
    auth.uid(),
    old_workspace.team_id,
    old_workspace.template,
    old_workspace.settings
  )
  RETURNING id INTO new_workspace_id;
  
  -- Add creator as owner
  INSERT INTO public.workspace_members (workspace_id, user_id, role, invited_by)
  VALUES (new_workspace_id, auth.uid(), 'owner', auth.uid());
  
  -- Copy captures
  FOR capture_record IN
    SELECT * FROM public.workspace_captures
    WHERE workspace_id = workspace_uuid
    ORDER BY position
  LOOP
    INSERT INTO public.workspace_captures (
      workspace_id,
      capture_id,
      position,
      section,
      notes,
      added_by
    )
    VALUES (
      new_workspace_id,
      capture_record.capture_id,
      capture_record.position,
      capture_record.section,
      capture_record.notes,
      auth.uid()
    );
  END LOOP;
  
  -- Copy sections
  FOR section_record IN
    SELECT * FROM public.prompt_sections
    WHERE workspace_id = workspace_uuid
    ORDER BY position
  LOOP
    INSERT INTO public.prompt_sections (
      workspace_id,
      type,
      title,
      content,
      position,
      created_by
    )
    VALUES (
      new_workspace_id,
      section_record.type,
      section_record.title,
      section_record.content,
      section_record.position,
      auth.uid()
    );
  END LOOP;
  
  -- Log activity
  INSERT INTO public.activity_log (workspace_id, user_id, activity_type, description, metadata)
  VALUES (
    new_workspace_id,
    auth.uid(),
    'workspace_created',
    'Duplicated workspace',
    jsonb_build_object('original_workspace_id', workspace_uuid)
  );
  
  RETURN new_workspace_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Archive workspace
CREATE OR REPLACE FUNCTION public.archive_workspace(workspace_uuid UUID)
RETURNS void AS $$
BEGIN
  -- Check access (owner only)
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = workspace_uuid
    AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  
  UPDATE public.workspaces
  SET status = 'archived', archived_at = NOW()
  WHERE id = workspace_uuid;
  
  -- Log activity
  INSERT INTO public.activity_log (workspace_id, user_id, activity_type, description)
  VALUES (workspace_uuid, auth.uid(), 'status_changed', 'Archived workspace');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SEARCH
-- ============================================================================

-- Search captures
CREATE OR REPLACE FUNCTION public.search_captures(
  search_query TEXT,
  limit_count INTEGER DEFAULT 20,
  team_uuid UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  type capture_type,
  source TEXT,
  title TEXT,
  content TEXT,
  url TEXT,
  captured_at TIMESTAMPTZ,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.type,
    c.source,
    c.title,
    c.content,
    c.url,
    c.captured_at,
    ts_rank(c.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM public.captures c
  WHERE c.user_id = auth.uid()
    AND (team_uuid IS NULL OR c.team_id = team_uuid)
    AND c.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC, c.captured_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Search workspaces
CREATE OR REPLACE FUNCTION public.search_workspaces(
  search_query TEXT,
  limit_count INTEGER DEFAULT 20,
  team_uuid UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  status workspace_status,
  created_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.id,
    w.name,
    w.description,
    w.status,
    w.created_at,
    w.last_activity_at,
    ts_rank(w.search_vector, websearch_to_tsquery('english', search_query)) AS rank
  FROM public.workspaces w
  WHERE public.can_access_workspace(w.id, auth.uid())
    AND (team_uuid IS NULL OR w.team_id = team_uuid)
    AND w.search_vector @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC, w.last_activity_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- COLLABORATION
-- ============================================================================

-- Start collaboration session
CREATE OR REPLACE FUNCTION public.start_collaboration_session(
  workspace_uuid UUID
)
RETURNS UUID AS $$
DECLARE
  session_id UUID;
BEGIN
  -- Check access
  IF NOT public.can_access_workspace(workspace_uuid, auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  
  -- End any existing sessions
  UPDATE public.collaboration_sessions
  SET ended_at = NOW()
  WHERE workspace_id = workspace_uuid
  AND user_id = auth.uid()
  AND ended_at IS NULL;
  
  -- Create new session
  INSERT INTO public.collaboration_sessions (workspace_id, user_id)
  VALUES (workspace_uuid, auth.uid())
  RETURNING id INTO session_id;
  
  RETURN session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update session heartbeat
CREATE OR REPLACE FUNCTION public.update_session_heartbeat(
  session_uuid UUID,
  cursor_pos JSONB DEFAULT NULL,
  active_sec TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  UPDATE public.collaboration_sessions
  SET
    last_heartbeat_at = NOW(),
    cursor_position = COALESCE(cursor_pos, cursor_position),
    active_section = COALESCE(active_sec, active_section)
  WHERE id = session_uuid
  AND user_id = auth.uid()
  AND ended_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- End collaboration session
CREATE OR REPLACE FUNCTION public.end_collaboration_session(session_uuid UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.collaboration_sessions
  SET ended_at = NOW()
  WHERE id = session_uuid
  AND user_id = auth.uid()
  AND ended_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get active collaborators
CREATE OR REPLACE FUNCTION public.get_active_collaborators(workspace_uuid UUID)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  cursor_position JSONB,
  active_section TEXT,
  last_heartbeat_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.display_name,
    u.avatar_url,
    cs.cursor_position,
    cs.active_section,
    cs.last_heartbeat_at
  FROM public.collaboration_sessions cs
  JOIN public.users u ON cs.user_id = u.id
  WHERE cs.workspace_id = workspace_uuid
  AND cs.ended_at IS NULL
  AND cs.last_heartbeat_at > NOW() - INTERVAL '60 seconds'
  AND u.id != auth.uid(); -- Exclude current user
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- ANALYTICS & STATS
-- ============================================================================

-- Get workspace stats
CREATE OR REPLACE FUNCTION public.get_workspace_stats(workspace_uuid UUID)
RETURNS TABLE (
  total_captures INTEGER,
  total_sections INTEGER,
  total_comments INTEGER,
  total_members INTEGER,
  unresolved_comments INTEGER,
  last_activity_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT public.can_access_workspace(workspace_uuid, auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  
  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::INTEGER FROM public.workspace_captures WHERE workspace_id = workspace_uuid),
    (SELECT COUNT(*)::INTEGER FROM public.prompt_sections WHERE workspace_id = workspace_uuid),
    (SELECT COUNT(*)::INTEGER FROM public.comments WHERE workspace_id = workspace_uuid),
    (SELECT COUNT(*)::INTEGER FROM public.workspace_members WHERE workspace_id = workspace_uuid),
    (SELECT COUNT(*)::INTEGER FROM public.comments WHERE workspace_id = workspace_uuid AND is_resolved = FALSE),
    (SELECT w.last_activity_at FROM public.workspaces w WHERE w.id = workspace_uuid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get user stats
CREATE OR REPLACE FUNCTION public.get_user_stats()
RETURNS TABLE (
  total_captures INTEGER,
  total_workspaces INTEGER,
  total_teams INTEGER,
  captures_this_week INTEGER,
  workspaces_this_week INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::INTEGER FROM public.captures WHERE user_id = auth.uid()),
    (SELECT COUNT(*)::INTEGER FROM public.workspace_members WHERE user_id = auth.uid()),
    (SELECT COUNT(*)::INTEGER FROM public.team_members WHERE user_id = auth.uid()),
    (SELECT COUNT(*)::INTEGER FROM public.captures WHERE user_id = auth.uid() AND captured_at > NOW() - INTERVAL '7 days'),
    (SELECT COUNT(*)::INTEGER FROM public.workspaces WHERE created_by = auth.uid() AND created_at > NOW() - INTERVAL '7 days');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- CLEANUP
-- ============================================================================

-- Clean up stale collaboration sessions (run via cron)
CREATE OR REPLACE FUNCTION public.cleanup_stale_sessions()
RETURNS void AS $$
BEGIN
  UPDATE public.collaboration_sessions
  SET ended_at = last_heartbeat_at
  WHERE ended_at IS NULL
  AND last_heartbeat_at < NOW() - INTERVAL '5 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
