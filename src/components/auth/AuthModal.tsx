import React, { useState, useEffect } from 'react';
import {
  Lock,
  User,
  Eye,
  EyeOff,
  X,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { UserAccount, UserRole } from '../../types';
import { authApi } from '../../services/api';
import { storageService } from '../../services/storageService';
import { useOfficialLogos } from '../common/OfficialSeals';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: UserAccount) => void;
  initialRole?: UserRole;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  initialRole,
}) => {
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [dbConnectionStatus, setDbConnectionStatus] = useState<'connected' | 'disconnected'>('disconnected');

  useEffect(() => {
    let isMounted = true;

    const checkConnection = async () => {
      try {
        const response = await fetch('/api/health');
        const health = await response.json();
        if (!response.ok || health.database !== 'connected') throw new Error('Database unavailable');

        if (isMounted) setDbConnectionStatus('connected');
      } catch {
        if (isMounted) setDbConnectionStatus('disconnected');
      }
    };

    checkConnection();
    return () => {
      isMounted = false;
    };
  }, []);

  const logos = useOfficialLogos();
  const authLogo =
    logos['logo-login'] ||
    logos['logo-system'] ||
    logos['logo-da'] ||
    logos['logo-header'] ||
    '/icon.svg';

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);
    try {
      const result = await authApi.login(usernameOrEmail.trim(), password);
      if (result.role === 'super_admin') {
        storageService.setSessionToken(null);
        setErrorMsg('Super Admin accounts must sign in through the dedicated /superadmin route.');
        return;
      }
      onLoginSuccess(result.user);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Sign-in failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 bg-stone-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-2xl">
        {/* Header Ribbon */}
        <div className="bg-gradient-to-r from-emerald-950 via-emerald-900 to-teal-950 text-white p-6 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full text-emerald-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3">
            <img
              src={authLogo}
              alt="DA Seal"
              className="w-12 h-12 rounded-xl object-contain bg-white/10 p-1 border border-emerald-400/30 shadow-md"
              referrerPolicy="no-referrer"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="bg-emerald-800 text-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wider uppercase border border-emerald-600/50">
                  Official Portal
                </span>
                <span className="text-emerald-400/80 text-[11px] flex items-center gap-1 font-mono">
                  <ShieldCheck className="w-3 h-3" /> Database Sign-In
                </span>
              </div>
              <h2 className="text-lg font-black tracking-tight text-white mt-1">
                DA Hinunangan Sign In
              </h2>
              <p className="text-xs text-emerald-200/90 font-normal">
                Municipal Swine Registry & Biosurveillance
              </p>
            </div>
          </div>
        </div>

        {/* Form Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full border bg-white/90 px-2 py-1 text-[10px] font-semibold shadow-sm backdrop-blur-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${dbConnectionStatus === 'connected' ? 'bg-emerald-500' : 'bg-red-500'} shadow-sm`} />
            <span className={dbConnectionStatus === 'connected' ? 'text-emerald-700' : 'text-red-700'}>
              {dbConnectionStatus === 'connected' ? 'Connected to Database' : 'Database Disconnected'}
            </span>
          </div>
          {/* Error Banner */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span className="leading-snug">{errorMsg}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-stone-700 mb-1">
                Username or Official Email
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-3 text-stone-400" />
                <input
                  type="text"
                  required
                  value={usernameOrEmail}
                  onChange={e => setUsernameOrEmail(e.target.value)}
                  placeholder="Enter username or official email"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-stone-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 text-xs text-stone-900 font-medium placeholder:text-stone-400 outline-hidden transition"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-stone-700">Password</label>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-stone-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-stone-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 text-xs text-stone-900 font-medium placeholder:text-stone-400 outline-hidden transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-stone-400 hover:text-stone-600 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 text-stone-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  className="rounded border-stone-300 text-emerald-700 focus:ring-emerald-600 accent-emerald-700"
                />
                <span>Remember session for offline work</span>
              </label>

              <button
                type="button"
                onClick={() => {
                  alert(
                    'To reset your password in the field, contact the Municipal Agriculture Officer (MAO) or use the Municipal Admin portal.'
                  );
                }}
                className="text-emerald-800 hover:text-emerald-900 font-semibold cursor-pointer"
              >
                Need Help?
              </button>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-800 to-teal-800 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-xs shadow-md hover:shadow-lg transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isLoading ? (
                <span>Authenticating credentials...</span>
              ) : (
                <>
                  <span>Sign In to Registry Portal</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Bottom Security Note */}
          <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-[11px] text-stone-400">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> 256-Bit Local Session Encryption
            </span>
            <span>Hinunangan LGU</span>
          </div>
        </div>
      </div>
    </div>
  );
};
