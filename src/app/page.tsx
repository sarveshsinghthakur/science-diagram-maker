import { Dashboard } from '@/components/Dashboard';
import { CONCEPTS, type GenerationResult } from '@/lib/constants';
import savedResults from '../../results.json';

/**
 * The 5 saved results are bundled at build time, so the page always renders the
 * table (with diagrams, checks, cost and retries) on first load without making
 * any API call. The "Generate" buttons then hit the API routes for live results.
 */
const initialResults = savedResults as GenerationResult[];

export default function Page() {
  return <Dashboard concepts={CONCEPTS} initialResults={initialResults} />;
}
