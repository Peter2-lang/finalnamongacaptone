import React, { useState } from 'react';
import { Users, Plus, Edit, Trash2, Save, X, Key, Shield, UserCheck, Search, Eye, EyeOff } from 'lucide-react';
import { Barangay, UserAccount, UserRole } from '../../types';
import { accountsApi } from '../../services/api';

interface ManageAccountsProps {
  users: UserAccount[];
  barangays: Barangay[];
  currentUser?: UserAccount | null;
  isLoading?: boolean;
  loadError?: string | null;
  onAccountUpsert: (account: UserAccount) => void;
  onAccountDelete: (accountId: string) => void;
}

export const ManageAccounts: React.FC<ManageAccountsProps> = ({ users, barangays, currentUser, isLoading = false, loadError = null, onAccountUpsert, onAccountDelete }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isEditing, setIsEditing] = useState<UserAccount | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Form State
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('focal');
  const [assignedBarangay, setAssignedBarangay] = useState(barangays[0]?.name || 'Poblacion');
  const [contactNo, setContactNo] = useState('');
  const [active, setActive] = useState(true);
  const [initialPassword, setInitialPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserAccount | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const startEdit = (u: UserAccount) => {
    if (u.role === 'super_admin' && currentUser?.role !== 'super_admin') {
      alert('Only a Super Admin can modify a Super Admin account.');
      return;
    }
    setIsEditing(u);
    setIsAddingNew(false);
    setName(u.name);
    setUsername(u.username);
    setEmail(u.email);
    setRole(u.role);
    setAssignedBarangay(u.assignedBarangay || barangays[0]?.name || 'Poblacion');
    setContactNo(u.contactNo || '');
    setActive(u.active);
    setInitialPassword('');
    setConfirmPassword('');
    setShowInitialPassword(false);
    setShowConfirmPassword(false);
  };

  const startAddNew = () => {
    setIsAddingNew(true);
    setIsEditing(null);
    setName('');
    setUsername('');
    setEmail('');
    setRole('focal');
    setAssignedBarangay(barangays[0]?.name || 'Poblacion');
    setContactNo('');
    setActive(true);
    setInitialPassword('');
    setConfirmPassword('');
    setShowInitialPassword(false);
    setShowConfirmPassword(false);
    setSaveError('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !username.trim() || !email.trim()) {
      alert('Please fill out full name, username, and email.');
      return;
    }
    if (isAddingNew) {
      if (initialPassword.length < 12 || !/[a-z]/.test(initialPassword) || !/[A-Z]/.test(initialPassword) || !/\d/.test(initialPassword) || !/[^A-Za-z0-9]/.test(initialPassword)) {
        setSaveError('Use at least 12 characters with uppercase, lowercase, number, and symbol characters.');
        return;
      }
      if (initialPassword !== confirmPassword) {
        setSaveError('Initial password and confirmation do not match.');
        return;
      }
    }

    setSaveError('');
    try {
    if (isAddingNew) {
      const newAcc: Partial<UserAccount> = {
        name: name.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        role,
        assignedBarangay: role === 'focal' ? assignedBarangay : undefined,
        contactNo: contactNo.trim(),
        phone: contactNo.trim(),
        active,
      };
      const savedAccount = await accountsApi.create({ ...newAcc, initialPassword, confirmPassword });
      onAccountUpsert(savedAccount);
    } else if (isEditing) {
      const updatedAcc: UserAccount = {
        ...isEditing,
        name: name.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        role,
        assignedBarangay: role === 'focal' ? assignedBarangay : undefined,
        contactNo: contactNo.trim(),
        active,
      };
      const savedAccount = await accountsApi.update(updatedAcc.id, updatedAcc);
      onAccountUpsert(savedAccount);
    }

    setIsEditing(null);
    setIsAddingNew(false);
    setInitialPassword('');
    setConfirmPassword('');
    setShowInitialPassword(false);
    setShowConfirmPassword(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save account to database.');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError('');
    if (resetPassword !== confirmResetPassword) {
      setResetError('New password and confirmation do not match.');
      return;
    }
    if (resetPassword.length < 12 || !/[a-z]/.test(resetPassword) || !/[A-Z]/.test(resetPassword) || !/\d/.test(resetPassword) || !/[^A-Za-z0-9]/.test(resetPassword)) {
      setResetError('Use at least 12 characters with uppercase, lowercase, number, and symbol characters.');
      return;
    }
    setIsResetting(true);
    try {
      await accountsApi.resetPassword(resetTarget.id, resetPassword, confirmResetPassword);
      setResetTarget(null);
      setResetPassword('');
      setConfirmResetPassword('');
      setShowNewPassword(false);
      setShowConfirmNewPassword(false);
    } catch (error) {
      setResetError(error instanceof Error ? error.message : 'Unable to reset this account password.');
    } finally {
      setIsResetting(false);
    }
  };

  const handleDelete = async (id: string, accName: string) => {
    const targetUser = users.find(u => u.id === id);
    if (targetUser?.role === 'super_admin' && currentUser?.role !== 'super_admin') {
      alert('Only a Super Admin can delete or modify a Super Admin account.');
      return;
    }
    if (window.confirm(`Are you sure you want to remove account "${accName}"?`)) {
      try {
        await accountsApi.delete(id);
        onAccountDelete(id);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Unable to delete account from database.');
      }
    }
  };

  const visibleUsers = currentUser?.role === 'super_admin'
    ? users
    : users.filter(user => user.role !== 'super_admin');
  const q = searchTerm.toLowerCase();
  const filtered = visibleUsers.filter(u =>
    (u.name || '').toLowerCase().includes(q) ||
    (u.username || '').toLowerCase().includes(q) ||
    (u.email || '').toLowerCase().includes(q) ||
    (Boolean(u.assignedBarangay) && (u.assignedBarangay || '').toLowerCase().includes(q))
  );

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      {/* Header */}
      {saveError && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{saveError}</div>}
      <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-700" />
            <h2 className="text-xl font-bold text-stone-900">Manage System Accounts & Access</h2>
          </div>
          <p className="text-xs text-stone-500 mt-0.5">
            Create and manage accounts for Agricultural Extension Focal Persons, Meat Agents/Traders, and System Administrators.
          </p>
        </div>

        {(currentUser?.role === 'super_admin' || currentUser?.role === 'admin') && <button
          onClick={startAddNew}
          className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-sm transition cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Add User Account
        </button>}
      </div>

      {resetTarget && (
        <form onSubmit={handleResetPassword} className="bg-white p-5 rounded-xl border border-amber-300 shadow-xs space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-sm text-stone-900">Reset Password: {resetTarget.name}</h3>
            <button type="button" onClick={() => { setResetTarget(null); setResetPassword(''); setConfirmResetPassword(''); setShowNewPassword(false); setShowConfirmNewPassword(false); setResetError(''); }} className="p-1.5 text-stone-500 hover:bg-stone-100 rounded-lg" aria-label="Cancel password reset">
              <X className="w-4 h-4" />
            </button>
          </div>
          {resetError && <p role="alert" className="text-xs text-red-700">{resetError}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="reset-new-password" className="block font-semibold text-stone-700">New Password</label>
              <div className="relative mt-1">
                <input id="reset-new-password" type={showNewPassword ? 'text' : 'password'} required autoComplete="new-password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} className="w-full px-3 pr-10 py-2 rounded-lg border border-stone-300" />
                <button type="button" onClick={() => setShowNewPassword(value => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-stone-500 hover:text-emerald-700 rounded-md" aria-label={showNewPassword ? 'Hide password' : 'Show password'} title={showNewPassword ? 'Hide password' : 'Show password'}>
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="reset-confirm-password" className="block font-semibold text-stone-700">Confirm New Password</label>
              <div className="relative mt-1">
                <input id="reset-confirm-password" type={showConfirmNewPassword ? 'text' : 'password'} required autoComplete="new-password" value={confirmResetPassword} onChange={e => setConfirmResetPassword(e.target.value)} className="w-full px-3 pr-10 py-2 rounded-lg border border-stone-300" />
                <button type="button" onClick={() => setShowConfirmNewPassword(value => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-stone-500 hover:text-emerald-700 rounded-md" aria-label={showConfirmNewPassword ? 'Hide password' : 'Show password'} title={showConfirmNewPassword ? 'Hide password' : 'Show password'}>
                  {showConfirmNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-stone-500">At least 12 characters, including uppercase, lowercase, a number, and a symbol.</p>
          <div className="flex justify-end">
            <button type="submit" disabled={isResetting} className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white font-bold">{isResetting ? 'Resetting…' : 'Reset Password'}</button>
          </div>
        </form>
      )}

      {/* Editor / Create Form */}
      {(isAddingNew || isEditing) && (
        <form onSubmit={handleSave} className="bg-white p-6 rounded-2xl border-2 border-emerald-600/40 shadow-md space-y-4 text-xs animate-fadeIn">
          <div className="flex items-center justify-between border-b pb-3 border-stone-100">
            <h3 className="font-bold text-sm text-stone-900">
              {isAddingNew ? 'Create New User / Focal / Agent Account' : `Edit Account: ${isEditing?.name}`}
            </h3>
            <button
              type="button"
              onClick={() => {
                setIsAddingNew(false);
                setIsEditing(null);
                setInitialPassword('');
                setConfirmPassword('');
                setShowInitialPassword(false);
                setShowConfirmPassword(false);
              }}
              className="text-stone-400 hover:text-stone-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-semibold text-stone-700 mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Roland C. Mercado"
                className="w-full px-3 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Username / Login ID *</label>
              <input
                type="text"
                required
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="e.g. focal.poblacion"
                className="w-full px-3 py-2 rounded-lg border border-stone-300 font-mono focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Email Address *</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="e.g. roland@hinunangan.gov.ph"
                className="w-full px-3 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
              />
            </div>

            {isAddingNew && (
              <>
                <div>
                  <label htmlFor="initial-password" className="block font-semibold text-stone-700">Initial Password *</label>
                  <div className="relative mt-1">
                    <input id="initial-password" type={showInitialPassword ? 'text' : 'password'} required autoComplete="new-password" value={initialPassword} onChange={e => setInitialPassword(e.target.value)} className="w-full px-3 pr-10 py-2 rounded-lg border border-stone-300" />
                    <button type="button" onClick={() => setShowInitialPassword(value => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-stone-500 hover:text-emerald-700 rounded-md" aria-label={showInitialPassword ? 'Hide password' : 'Show password'} title={showInitialPassword ? 'Hide password' : 'Show password'}>
                      {showInitialPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="confirm-password" className="block font-semibold text-stone-700">Confirm Password *</label>
                  <div className="relative mt-1">
                    <input id="confirm-password" type={showConfirmPassword ? 'text' : 'password'} required autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full px-3 pr-10 py-2 rounded-lg border border-stone-300" />
                    <button type="button" onClick={() => setShowConfirmPassword(value => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-stone-500 hover:text-emerald-700 rounded-md" aria-label={showConfirmPassword ? 'Hide password' : 'Show password'} title={showConfirmPassword ? 'Hide password' : 'Show password'}>
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <p className="sm:col-span-3 -mt-2 text-[11px] text-stone-500">At least 12 characters, including uppercase, lowercase, a number, and a symbol.</p>
              </>
            )}

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Role / Permission</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value as UserRole)}
                className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white font-bold"
              >
                <option value="focal">🌾 Focal Person (Barangay Level Access)</option>
                <option value="agent">🥩 Agent / Meat Trader (View Ready to Sell Only)</option>
                <option value="admin">🏛️ Administrator (Standard Admin Access)</option>
                {currentUser?.role === 'super_admin' && (
                  <option value="super_admin">👑 Super Administrator (Master System Access)</option>
                )}
              </select>
            </div>

            {role === 'focal' && (
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Designated Barangay *
                </label>
                <select
                  value={assignedBarangay}
                  required
                  onChange={e => setAssignedBarangay(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white font-medium"
                >
                  {barangays.map(b => (
                    <option key={b.id} value={b.name}>
                      Brgy. {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Contact Phone</label>
              <input
                type="text"
                value={contactNo}
                onChange={e => setContactNo(e.target.value)}
                placeholder="0917-000-0000"
                className="w-full px-3 py-2 rounded-lg border border-stone-300 focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
              />
            </div>

            <div className="flex items-center gap-2 pt-5">
              <label className="flex items-center gap-2 cursor-pointer font-semibold text-stone-800">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={e => setActive(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded border-stone-300"
                />
                <span>Account is Active & Allowed to Sign In</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setIsAddingNew(false);
                setIsEditing(null);
                setInitialPassword('');
                setConfirmPassword('');
                setShowInitialPassword(false);
                setShowConfirmPassword(false);
              }}
              className="px-4 py-2 rounded-xl border border-stone-300 hover:bg-stone-100 font-semibold text-stone-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Save className="w-4 h-4" /> Save Account
            </button>
          </div>
        </form>
      )}

      {/* User Accounts Table */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-stone-100 flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-stone-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search user name, email, or role..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-stone-300 text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
            />
          </div>
          <span className="text-xs text-stone-500 font-medium">
            Total Accounts: <strong>{visibleUsers.length}</strong>
          </span>
        </div>

        {loadError && (
          <div className="px-4 py-3 text-sm text-red-700 bg-red-50 border-b border-red-200">{loadError}</div>
        )}

        {isLoading && !loadError && (
          <div className="px-4 py-6 text-sm text-stone-600">Loading accounts...</div>
        )}

        {!isLoading && !loadError && filtered.length === 0 && (
          <div className="px-4 py-6 text-sm text-stone-600">No accounts found.</div>
        )}

        {!isLoading && !loadError && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-100/80 text-stone-700 font-semibold border-b border-stone-200 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Account Name</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Assigned Jurisdiction</th>
                  <th className="py-3 px-4">Login Email / Username</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {filtered.map(u => (
                  <tr key={u.id} className="hover:bg-stone-50">
                    <td className="py-3 px-4">
                      <div className="font-bold text-stone-900">{u.name}</div>
                      <div className="text-[10px] text-stone-400">{u.contactNo || 'No contact'}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          u.role === 'admin'
                            ? 'bg-purple-100 text-purple-800'
                            : u.role === 'focal'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {u.role === 'super_admin'
                          ? 'SUPER ADMINISTRATOR'
                          : u.role === 'admin'
                          ? 'ADMINISTRATOR'
                          : u.role === 'focal'
                          ? 'FOCAL PERSON'
                          : 'AGENT / TRADER'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium text-stone-800">
                      {u.role === 'focal' ? `Brgy. ${u.assignedBarangay}` : 'Municipal-Wide'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-mono text-stone-800">{u.username}</div>
                      <div className="text-[11px] text-stone-500">{u.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          u.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-stone-200 text-stone-600'
                        }`}
                      >
                        {u.status === 'pending' ? 'NO PROFILE' : u.active ? 'ACTIVE' : 'DISABLED'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => startEdit(u)}
                          disabled={u.hasProfile === false}
                          className="p-1.5 rounded-lg text-stone-600 hover:bg-stone-200 transition cursor-pointer"
                          title={u.hasProfile === false ? 'This Auth user has no application profile to edit' : 'Edit Account'}
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        {currentUser?.role === 'super_admin' && u.authUserId && (
                          <button
                            type="button"
                            onClick={() => { setResetTarget(u); setResetPassword(''); setConfirmResetPassword(''); setShowNewPassword(false); setShowConfirmNewPassword(false); setResetError(''); }}
                            className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-100 transition cursor-pointer"
                            title="Reset Password"
                            aria-label={`Reset password for ${u.name}`}
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(u.id, u.name)}
                          disabled={u.hasProfile === false && currentUser?.role !== 'super_admin'}
                          className="p-1.5 rounded-lg text-red-600 hover:bg-red-100 transition cursor-pointer"
                          title={u.hasProfile === false && currentUser?.role !== 'super_admin' ? 'Only a Super Admin can remove an Auth user without a profile' : 'Delete Account'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
