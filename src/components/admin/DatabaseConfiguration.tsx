import React, { useCallback, useEffect, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { requestJson } from '../../services/http.ts';

interface DatabaseHealth {
  database?: string;
  database_project_ref?: string;
  supabase_auth_project_ref?: string;
}

export const DatabaseConfiguration: React.FC = () => {
  const [health, setHealth] = useState<DatabaseHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setHealth(await requestJson<DatabaseHealth>('/api/health', {}, false)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to check database connection.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    // Remove credentials left by older versions without reading their values.
    for (const key of ['da_db_host', 'da_db_port', 'da_db_name', 'da_db_user', 'da_db_password', 'da_db_url', 'da_db_ssl']) localStorage.removeItem(key);
    void refresh();
  }, [refresh]);
  return <section className="p-6 space-y-4 rounded-2xl bg-white border border-stone-200">
    <h2 className="flex gap-2 items-center text-xl font-bold"><Database /> Database connection</h2>
    <p>Configure DATABASE_URL in .env.local for local development and in Vercel environment variables for deployments. Database credentials are managed on the server.</p>
    <p role="status">{loading ? 'Checking connection…' : `Database: ${health?.database || 'unknown'}`}</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <button type="button" onClick={() => void refresh()} disabled={loading} className="flex gap-2 items-center px-4 py-2 rounded-lg bg-green-700 text-white disabled:opacity-50"><RefreshCw className={loading ? 'animate-spin' : ''} /> Test connection</button>
  </section>;
};
