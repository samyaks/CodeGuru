import { useLocation } from 'react-router-dom';
import { isV2EnabledForLocation } from '../config/flags';
import ProjectView from './ProjectView';
import ProjectV2 from './v2/Project';

/**
 * Phase 6a: `/projects/:id` defaults to v2. Pass `?v1=true` for the legacy
 * page. The choice is per-load (not sticky) so users can toggle freely.
 */
export default function ProjectRouter() {
  const location = useLocation();
  return isV2EnabledForLocation(location.search) ? <ProjectV2 /> : <ProjectView />;
}
