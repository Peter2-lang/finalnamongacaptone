/** Demo identities use the normal Supabase login and existing role permissions. */
export const DEMO_ACCOUNTS = [
  { username: 'demo_admin', email: 'demo.admin@hinunangan.example.com', name: 'Demo Municipal Admin', role: 'admin', label: 'Admin', assignedBarangay: undefined },
  { username: 'demo_barangay', email: 'demo.barangay@hinunangan.example.com', name: 'Demo Ambacon Focal Person', role: 'focal', label: 'Barangay · Ambacon', assignedBarangay: 'Ambacon' },
  { username: 'demo_agent', email: 'demo.agent@hinunangan.example.com', name: 'Demo Marketing Agent', role: 'agent', label: 'Agent', assignedBarangay: undefined },
] as const;
