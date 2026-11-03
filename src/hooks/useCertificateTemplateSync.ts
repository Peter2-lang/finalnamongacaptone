import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type CertificateTemplateSyncStatus = 'live' | 'reconnecting' | 'polling';

export function useCertificateTemplateSync(
  refresh: () => Promise<void>,
  enabled = true
): CertificateTemplateSyncStatus {
  const [status, setStatus] = useState<CertificateTemplateSyncStatus>(supabase ? 'reconnecting' : 'polling');

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    const intervalId = window.setInterval(refreshIfVisible, 30_000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);

    const channel = supabase?.channel(`certificate-templates-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'certificate_templates',
      }, () => {
        if (active) void refresh();
      })
      .subscribe(subscriptionStatus => {
        if (!active) return;
        setStatus(subscriptionStatus === 'SUBSCRIBED' ? 'live' : 'reconnecting');
      });

    if (!channel) setStatus('polling');
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [enabled, refresh]);

  return status;
}
