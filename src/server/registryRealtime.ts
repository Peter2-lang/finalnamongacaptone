/** Conservative capability gate; never enable a stream solely because a socket connects. */
export async function loadRegistryRealtimeCapability(query: (sql: string) => Promise<{rows: {supported?: boolean}[]}>) {
  try {
    const result = await query(`SELECT (
      EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
        AND schemaname='public' AND tablename='swine_records')
      AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='swine_records' AND c.relrowsecurity)
      AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='swine_records'
        AND cmd='SELECT' AND roles && ARRAY['authenticated','public']::name[])
      AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='swine_records'
        AND cmd='ALL' AND roles && ARRAY['authenticated','public']::name[])
    ) AS supported`);
    return result.rows[0]?.supported === true;
  } catch {
    return false;
  }
}
