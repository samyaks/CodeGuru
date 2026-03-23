# UpdateAI Security Documentation

Comprehensive security architecture, policies, and best practices.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Row-Level Security (RLS)](#row-level-security-rls)
- [API Security](#api-security)
- [Input Validation](#input-validation)
- [Rate Limiting](#rate-limiting)
- [Data Privacy](#data-privacy)
- [Security Best Practices](#security-best-practices)

---

## Overview

UpdateAI implements defense-in-depth security with multiple layers:

1. **Authentication** - Supabase Auth with JWT tokens
2. **Row-Level Security** - PostgreSQL RLS for data isolation
3. **API Authorization** - Service role key protection
4. **Input Validation** - Database constraints + application validation
5. **Rate Limiting** - Supabase built-in limits
6. **Encryption** - TLS in transit, AES-256 at rest

---

## Authentication

### JWT Tokens

Supabase Auth issues JWT tokens with claims:

```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "role": "authenticated",
  "iat": 1706299200,
  "exp": 1706302800
}
```

**Token Lifecycle:**
- **Access Token**: Valid for 1 hour
- **Refresh Token**: Valid for 30 days
- Auto-refresh before expiration

### Session Management

```typescript
// Client automatically manages sessions
const { data, error } = await supabase.auth.getSession()

// Listen for auth changes
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN') {
    // User signed in
  } else if (event === 'SIGNED_OUT') {
    // User signed out
  } else if (event === 'TOKEN_REFRESHED') {
    // Token was refreshed
  }
})
```

### Password Requirements

Enforce in application:
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

### Multi-Factor Authentication (MFA)

Enable via Supabase Auth:

```typescript
// Enable MFA
const { data, error } = await supabase.auth.mfa.enroll({
  factorType: 'totp'
})

// Verify MFA
await supabase.auth.mfa.verify({
  factorId: data.id,
  code: '123456'
})
```

---

## Row-Level Security (RLS)

All tables have RLS enabled. Users can only access data they're authorized to see.

### Users Table

```sql
-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

-- Users can view team member profiles
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
```

**Protection:**
- Users cannot see other users' profiles unless in same team
- Email addresses only visible to team members
- Preferences are private

### Teams Table

```sql
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

-- Team owners can delete teams
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
```

**Protection:**
- Only team members can view team details
- Only owners can delete teams
- Admins can manage members and settings

### Captures Table

```sql
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
```

**Protection:**
- Personal captures are private by default
- Team captures visible to all team members
- Cannot modify other users' captures

### Workspaces Table

```sql
-- Users can view workspaces they have access to
CREATE POLICY "Users can view accessible workspaces"
  ON public.workspaces FOR SELECT
  USING (public.can_access_workspace(id, auth.uid()));

-- Users can update workspaces they can edit
CREATE POLICY "Users can update editable workspaces"
  ON public.workspaces FOR UPDATE
  USING (public.can_edit_workspace(id, auth.uid()));
```

**Access Levels:**
1. **Creator**: Full access
2. **Workspace Member**: Role-based access (owner/editor/commenter/viewer)
3. **Team Member**: Access if workspace belongs to team

**Helper Functions:**

```sql
-- Check workspace access
CREATE FUNCTION public.can_access_workspace(workspace_uuid UUID, user_uuid UUID)
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
```

---

## API Security

### API Keys

Two types of keys:

1. **Anonymous Key** (anon key)
   - Used in client applications
   - Respects RLS policies
   - Safe to expose in frontend code

2. **Service Role Key** (service_role)
   - Full database access
   - Bypasses RLS
   - **NEVER expose in client code**
   - Use only in backend services

```typescript
// ✅ CORRECT: Frontend using anon key
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// ❌ WRONG: Never expose service role key
const supabase = createClient(
  url,
  process.env.SUPABASE_SERVICE_ROLE_KEY // DO NOT DO THIS
)
```

### CORS Configuration

Configure allowed origins in Supabase dashboard:

```
https://updateai.com
https://*.updateai.com
chrome-extension://[extension-id]
```

### API Authorization

All database operations go through RLS:

```typescript
// This query is automatically filtered by RLS
const { data } = await supabase
  .from('workspaces')
  .select('*')
// User only sees workspaces they have access to
```

---

## Input Validation

### Database Constraints

```sql
-- Email format
CONSTRAINT email_format CHECK (
  email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
)

-- Length limits
CONSTRAINT name_length CHECK (
  char_length(name) >= 2 AND char_length(name) <= 100
)

-- Slug format
CONSTRAINT slug_format CHECK (
  slug ~* '^[a-z0-9-]+$'
)
```

### Application Validation

```typescript
// Validate before API call
function validateWorkspaceName(name: string): boolean {
  if (!name || name.length < 1 || name.length > 200) {
    throw new Error('Name must be 1-200 characters')
  }
  return true
}

// Sanitize user input
function sanitizeContent(content: string): string {
  // Remove null bytes
  content = content.replace(/\0/g, '')
  
  // Trim whitespace
  content = content.trim()
  
  // Enforce max length
  if (content.length > 50000) {
    throw new Error('Content too long')
  }
  
  return content
}
```

### XSS Prevention

All user content should be escaped when rendering:

```typescript
// React automatically escapes
<div>{userContent}</div>

// For dangerouslySetInnerHTML, use DOMPurify
import DOMPurify from 'dompurify'
<div dangerouslySetInnerHTML={{
  __html: DOMPurify.sanitize(userContent)
}} />
```

### SQL Injection Prevention

Supabase client uses parameterized queries:

```typescript
// ✅ SAFE: Parameterized
const { data } = await supabase
  .from('workspaces')
  .select('*')
  .eq('id', workspaceId)

// ❌ UNSAFE: String concatenation (don't do this)
const query = `SELECT * FROM workspaces WHERE id = '${workspaceId}'`
```

---

## Rate Limiting

### Supabase Limits

**Free Tier:**
- 500 requests per second
- 2GB database size
- 500MB storage
- 5GB bandwidth/month

**Pro Tier:**
- No rate limits
- 8GB database size
- 100GB storage
- 250GB bandwidth/month

### Custom Rate Limiting

Implement in application:

```typescript
import rateLimit from 'express-rate-limit'

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later'
})

app.use('/api/', limiter)
```

### Per-User Rate Limiting

```typescript
const userLimiter = new Map<string, number>()

async function checkUserLimit(userId: string): Promise<boolean> {
  const now = Date.now()
  const key = `${userId}:${Math.floor(now / 60000)}` // per minute
  
  const count = userLimiter.get(key) || 0
  if (count >= 60) {
    throw new Error('Rate limit exceeded')
  }
  
  userLimiter.set(key, count + 1)
  return true
}
```

---

## Data Privacy

### Personal Data

Collected personal data:
- Email address
- Display name (optional)
- Avatar URL (optional)
- Last seen timestamp

**GDPR Compliance:**
- Users can update profile anytime
- Users can export their data
- Users can delete their account
- 30-day soft delete before permanent deletion

### Data Retention

| Data Type | Retention |
|-----------|-----------|
| Active workspaces | Indefinite |
| Archived workspaces | 1 year |
| Deleted workspaces | 30 days (soft delete) |
| Activity logs | 2 years |
| Session logs | 90 days |

### Data Export

```typescript
async function exportUserData(userId: string) {
  const [captures, workspaces, teams] = await Promise.all([
    supabase.from('captures').select('*').eq('user_id', userId),
    supabase.from('workspaces').select('*').eq('created_by', userId),
    supabase.from('team_members').select('*, team:teams(*)').eq('user_id', userId)
  ])
  
  return {
    captures: captures.data,
    workspaces: workspaces.data,
    teams: teams.data,
    exported_at: new Date().toISOString()
  }
}
```

### Data Deletion

```typescript
async function deleteUserAccount(userId: string) {
  // 1. Soft delete (set deleted_at)
  await supabase
    .from('users')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', userId)
  
  // 2. After 30 days, hard delete via scheduled job
  // - Delete from captures
  // - Transfer or delete workspaces
  // - Remove from teams
  // - Delete user record
}
```

---

## Security Best Practices

### 1. Never Expose Service Role Key

```typescript
// ❌ WRONG
const SUPABASE_SERVICE_KEY = 'your-service-role-key'

// ✅ CORRECT
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
```

### 2. Use Environment Variables

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Add to .gitignore
.env*.local
```

### 3. Validate All Input

```typescript
function createCapture(data: unknown) {
  // Validate before processing
  const schema = z.object({
    type: z.enum(['jira', 'slack', 'google-docs']),
    title: z.string().min(1).max(500),
    content: z.string().min(1).max(50000),
    url: z.string().url().optional()
  })
  
  const validated = schema.parse(data)
  return api.captures.create(validated)
}
```

### 4. Use HTTPS Only

```typescript
// Enforce HTTPS in production
if (process.env.NODE_ENV === 'production' && 
    !request.protocol.includes('https')) {
  return response.redirect(`https://${request.hostname}${request.url}`)
}
```

### 5. Implement CSP Headers

```typescript
// Content Security Policy
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://*.supabase.co"
  )
  next()
})
```

### 6. Log Security Events

```typescript
async function logSecurityEvent(event: {
  type: 'auth_failure' | 'access_denied' | 'rate_limit'
  userId?: string
  ip: string
  details: any
}) {
  await supabase.from('security_logs').insert({
    event_type: event.type,
    user_id: event.userId,
    ip_address: event.ip,
    details: event.details,
    created_at: new Date().toISOString()
  })
}
```

### 7. Regular Security Audits

- Run `npm audit` regularly
- Update dependencies monthly
- Review RLS policies quarterly
- Penetration testing annually

### 8. Monitor for Anomalies

Set up alerts for:
- Failed login attempts (>5 in 5 minutes)
- Mass data exports
- Unusual API usage patterns
- RLS policy violations

### 9. Secure Extension Installation

```json
// manifest.json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  },
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "https://*.supabase.co/*"
  ]
}
```

### 10. Use Least Privilege

Grant minimum permissions needed:

```sql
-- Read-only role for analytics
CREATE ROLE analytics_readonly;
GRANT CONNECT ON DATABASE postgres TO analytics_readonly;
GRANT USAGE ON SCHEMA public TO analytics_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_readonly;
```

---

## Incident Response

### Security Incident Checklist

1. **Detect**: Monitor logs for suspicious activity
2. **Contain**: Revoke compromised API keys immediately
3. **Investigate**: Review audit logs to determine scope
4. **Remediate**: Patch vulnerabilities, reset passwords
5. **Communicate**: Notify affected users within 72 hours
6. **Learn**: Document incident and update security measures

### Emergency Contacts

- **Security Lead**: security@updateai.com
- **Supabase Support**: support@supabase.com
- **On-call**: [PagerDuty/Oncall system]

---

## Compliance

### GDPR

- ✅ Right to access
- ✅ Right to rectification
- ✅ Right to erasure
- ✅ Right to data portability
- ✅ Privacy by design

### SOC 2 (Future)

When scaling:
- Implement audit logging
- Access reviews
- Encryption key rotation
- Annual penetration testing

---

## Security Updates

Subscribe to:
- [Supabase Security Advisories](https://github.com/supabase/supabase/security/advisories)
- [PostgreSQL Security](https://www.postgresql.org/support/security/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

## Contact

Report security vulnerabilities: security@updateai.com

PGP Key: [Include PGP public key]
