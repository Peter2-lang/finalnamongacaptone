import React, { useState, useEffect } from 'react';
import {
  Image,
  Upload,
  Sparkles,
  Check,
  RefreshCw,
  X,
  Sliders,
  Eye,
  Printer,
  SlidersHorizontal,
} from 'lucide-react';
import {
  DynamicSeal,
  SealBagongPilipinas,
  SealBarangay,
  SealDA,
  SealMunicipality,
  SealProvince,
} from '../common/OfficialSeals';
import { HINUNANGAN_BARANGAYS } from '../../data/barangays';
import { mediaApi } from '../../services/api';

export interface CertificateLogoSettings {
  leftLogoType: string;
  leftLogoUrl?: string;
  leftBarangayName: string;
  centerLogoType: string;
  centerLogoUrl?: string;
  rightLogoType: string;
  rightLogoUrl?: string;
  showWatermark: boolean;
  watermarkType: string;
  watermarkUrl?: string;
  watermarkOpacity: number;
  barangayEmail?: string;
  barangayPhone?: string;
  headerMotto?: string;
  printLogoSize?: number;
  printShowWatermark?: boolean;
  printWatermarkOpacity?: number;
  printGrayscale?: boolean;
  printHideCenterLogo?: boolean;
}

interface CertificateLogoCustomizerProps {
  settings: CertificateLogoSettings;
  onChange: (updated: CertificateLogoSettings) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const CertificateLogoCustomizer: React.FC<CertificateLogoCustomizerProps> = ({
  settings,
  onChange,
  isOpen,
  onClose,
}) => {
  const [localSettings, setLocalSettings] = useState<CertificateLogoSettings>({
    ...settings,
    printLogoSize: settings.printLogoSize ?? 72,
    printShowWatermark: settings.printShowWatermark ?? settings.showWatermark,
    printWatermarkOpacity: settings.printWatermarkOpacity ?? settings.watermarkOpacity,
    printGrayscale: settings.printGrayscale ?? false,
    printHideCenterLogo: settings.printHideCenterLogo ?? false,
  });

  const [activeTab, setActiveTab] = useState<'general' | 'print'>('general');
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  useEffect(() => {
    setLocalSettings({
      ...settings,
      printLogoSize: settings.printLogoSize ?? 72,
      printShowWatermark: settings.printShowWatermark ?? settings.showWatermark,
      printWatermarkOpacity: settings.printWatermarkOpacity ?? settings.watermarkOpacity,
      printGrayscale: settings.printGrayscale ?? false,
      printHideCenterLogo: settings.printHideCenterLogo ?? false,
    });
  }, [settings]);

  if (!isOpen) return null;

  const updateSetting = (key: keyof CertificateLogoSettings, value: any) => {
    const updated = { ...localSettings, [key]: value };
    setLocalSettings(updated);
    onChange(updated);
  };

  const applyPreset = (presetName: 'nava' | 'nueva_esperanza' | 'tuburan' | 'da_mao') => {
    let updated: CertificateLogoSettings = { ...localSettings };

    if (presetName === 'nava') {
      updated = {
        ...localSettings,
        leftLogoType: 'barangay',
        leftBarangayName: 'NAVA',
        centerLogoType: 'municipality',
        rightLogoType: 'bagong_pilipinas',
        showWatermark: true,
        watermarkType: 'municipality',
        watermarkOpacity: 0.12,
        barangayEmail: 'nava.hinunangan20@gmail.com',
        barangayPhone: '09763070221',
        headerMotto: '',
        printLogoSize: 72,
        printShowWatermark: true,
        printWatermarkOpacity: 0.10,
        printHideCenterLogo: false,
      };
    } else if (presetName === 'nueva_esperanza') {
      updated = {
        ...localSettings,
        leftLogoType: 'barangay',
        leftBarangayName: 'NUEVA ESPERANZA',
        centerLogoType: 'none',
        rightLogoType: 'none',
        showWatermark: true,
        watermarkType: 'municipality',
        watermarkOpacity: 0.15,
        barangayEmail: 'brgy.nuevaesperanza@hinunangan.gov.ph',
        barangayPhone: '(053) 578-2011',
        headerMotto: 'o0o\nOFFICE OF THE PUNONG BARANGAY',
        printLogoSize: 84,
        printShowWatermark: true,
        printWatermarkOpacity: 0.12,
        printHideCenterLogo: true,
      };
    } else if (presetName === 'tuburan') {
      updated = {
        ...localSettings,
        leftLogoType: 'barangay',
        leftBarangayName: 'TUBURAN',
        centerLogoType: 'none',
        rightLogoType: 'municipality',
        showWatermark: false,
        watermarkType: 'municipality',
        watermarkOpacity: 0.10,
        barangayEmail: 'tuburan.hinunangan@gmail.com',
        barangayPhone: '0917-888-9999',
        headerMotto: 'OFFICE OF THE PUNONG BARANGAY',
        printLogoSize: 76,
        printShowWatermark: false,
        printWatermarkOpacity: 0.08,
        printHideCenterLogo: true,
      };
    } else if (presetName === 'da_mao') {
      updated = {
        ...localSettings,
        leftLogoType: 'da',
        leftBarangayName: 'POBLACION',
        centerLogoType: 'municipality',
        rightLogoType: 'bagong_pilipinas',
        showWatermark: true,
        watermarkType: 'municipality',
        watermarkOpacity: 0.12,
        barangayEmail: 'agri.hinunangan@gmail.com',
        barangayPhone: '(053) 578-2011',
        headerMotto: 'OFFICE OF THE MUNICIPAL AGRICULTURAL SERVICES (OMAS)',
        printLogoSize: 72,
        printShowWatermark: true,
        printWatermarkOpacity: 0.09,
        printHideCenterLogo: false,
      };
    }

    setLocalSettings(updated);
    onChange(updated);
  };

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    field: 'leftLogoUrl' | 'centerLogoUrl' | 'rightLogoUrl' | 'watermarkUrl'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingField(field);
      const asset = await mediaApi.uploadFile(file, 'certificates/logos');
      const updated = { ...localSettings, [field]: asset.fileUrl };
      setLocalSettings(updated);
      onChange(updated);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to upload certificate logo to Supabase Storage.');
    } finally {
      setUploadingField(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-white max-w-2xl w-full rounded-2xl p-6 shadow-2xl border border-stone-200 space-y-5 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">
                Official Seals & Logo Customizer
              </h3>
              <p className="text-xs text-stone-500">
                Configure screen display, print seals, background watermarks, and header info
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex rounded-xl bg-slate-100 p-1 border border-stone-200">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'general'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            Logos & Content
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('print')}
            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'print'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Printer className="w-3.5 h-3.5" />
            Print Calibration & Sizing
          </button>
        </div>

        {activeTab === 'general' ? (
          <>
            {/* Template Presets */}
            <div className="space-y-2">
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600">
                QUICK AUTHENTIC TEMPLATE PRESETS (FROM PHOTO FORMATS)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => applyPreset('nava')}
                  className="p-2.5 rounded-xl border border-blue-200 bg-blue-50/60 hover:bg-blue-100 text-left transition cursor-pointer flex flex-col items-center text-center"
                >
                  <div className="flex items-center gap-1 mb-1">
                    <SealBarangay barangayName="NAVA" className="w-5 h-5" />
                    <SealMunicipality className="w-5 h-5" />
                    <SealBagongPilipinas className="w-5 h-5" />
                  </div>
                  <span className="text-[11px] font-bold text-blue-900">Barangay Nava</span>
                  <span className="text-[9px] text-blue-600">3 Seals (Nava + Mun + BP)</span>
                </button>

                <button
                  type="button"
                  onClick={() => applyPreset('nueva_esperanza')}
                  className="p-2.5 rounded-xl border border-amber-200 bg-amber-50/60 hover:bg-amber-100 text-left transition cursor-pointer flex flex-col items-center text-center"
                >
                  <div className="flex items-center gap-1 mb-1">
                    <SealBarangay barangayName="NUEVA ESPERANZA" className="w-6 h-6" />
                  </div>
                  <span className="text-[11px] font-bold text-amber-900">Nueva Esperanza</span>
                  <span className="text-[9px] text-amber-700">1 Seal + Watermark</span>
                </button>

                <button
                  type="button"
                  onClick={() => applyPreset('tuburan')}
                  className="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100 text-left transition cursor-pointer flex flex-col items-center text-center"
                >
                  <div className="flex items-center gap-1 mb-1">
                    <SealBarangay barangayName="TUBURAN" className="w-5 h-5" />
                    <SealMunicipality className="w-5 h-5" />
                  </div>
                  <span className="text-[11px] font-bold text-emerald-900">Barangay Tuburan</span>
                  <span className="text-[9px] text-emerald-700">Tuburan + Mun Seals</span>
                </button>

                <button
                  type="button"
                  onClick={() => applyPreset('da_mao')}
                  className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left transition cursor-pointer flex flex-col items-center text-center"
                >
                  <div className="flex items-center gap-1 mb-1">
                    <SealDA className="w-5 h-5" />
                    <SealMunicipality className="w-5 h-5" />
                  </div>
                  <span className="text-[11px] font-bold text-slate-900">MAO / DA Office</span>
                  <span className="text-[9px] text-slate-600">DA + Mun + BP</span>
                </button>
              </div>
            </div>

            {/* 1. Left Logo */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-stone-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-slate-800">
                  1. Left Logo / Seal
                </span>
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-white shadow-2xs border border-stone-200 overflow-hidden">
                  {localSettings.leftLogoType === 'barangay' ? (
                    <SealBarangay
                      barangayName={localSettings.leftBarangayName}
                      className="w-7 h-7"
                      customUrl={localSettings.leftLogoUrl}
                    />
                  ) : localSettings.leftLogoType === 'da' ? (
                    <SealDA className="w-7 h-7" customUrl={localSettings.leftLogoUrl} />
                  ) : localSettings.leftLogoType === 'municipality' ? (
                    <SealMunicipality className="w-7 h-7" customUrl={localSettings.leftLogoUrl} />
                  ) : localSettings.leftLogoUrl ? (
                    <img
                      src={localSettings.leftLogoUrl}
                      alt="Left Seal"
                      className="w-7 h-7 object-contain rounded-full"
                    />
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400">None</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-1">Seal Type</label>
                  <select
                    value={localSettings.leftLogoType}
                    onChange={e => updateSetting('leftLogoType', e.target.value)}
                    className="w-full bg-white border border-stone-300 rounded-lg p-2 font-semibold text-slate-800"
                  >
                    <option value="barangay">Barangay Official Seal (Customizable)</option>
                    <option value="da">Department of Agriculture (DA)</option>
                    <option value="municipality">Municipality of Hinunangan</option>
                    <option value="custom">Custom Uploaded Image</option>
                    <option value="none">None / Hidden</option>
                  </select>
                </div>

                {localSettings.leftLogoType === 'barangay' && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">
                      Select Barangay
                    </label>
                    <select
                      value={localSettings.leftBarangayName}
                      onChange={e => updateSetting('leftBarangayName', e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-lg p-2 font-bold text-slate-800"
                    >
                      {HINUNANGAN_BARANGAYS.map(b => (
                        <option key={b.name} value={b.name}>
                          Barangay {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-1">
                  Upload Custom Left Seal (Optional Replacement)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => handleFileUpload(e, 'leftLogoUrl')}
                  disabled={uploadingField === 'leftLogoUrl'}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer disabled:opacity-50"
                />
              </div>
            </div>

            {/* 2. Center Logo */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-stone-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-slate-800">
                  2. Center Logo / Seal
                </span>
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-white shadow-2xs border border-stone-200 overflow-hidden">
                  {localSettings.centerLogoType === 'municipality' ? (
                    <SealMunicipality className="w-7 h-7" customUrl={localSettings.centerLogoUrl} />
                  ) : localSettings.centerLogoType === 'da' ? (
                    <SealDA className="w-7 h-7" customUrl={localSettings.centerLogoUrl} />
                  ) : localSettings.centerLogoType === 'bagong_pilipinas' ? (
                    <SealBagongPilipinas
                      className="w-7 h-7"
                      customUrl={localSettings.centerLogoUrl}
                    />
                  ) : localSettings.centerLogoUrl ? (
                    <img
                      src={localSettings.centerLogoUrl}
                      alt="Center Seal"
                      className="w-7 h-7 object-contain rounded-full"
                    />
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400">None</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-1">Seal Type</label>
                  <select
                    value={localSettings.centerLogoType}
                    onChange={e => updateSetting('centerLogoType', e.target.value)}
                    className="w-full bg-white border border-stone-300 rounded-lg p-2 font-semibold text-slate-800"
                  >
                    <option value="municipality">Municipality of Hinunangan</option>
                    <option value="da">Department of Agriculture (DA)</option>
                    <option value="bagong_pilipinas">Bagong Pilipinas</option>
                    <option value="none">None / Hidden</option>
                    <option value="custom">Custom Uploaded Image</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-1">
                    Upload Custom Center Seal
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => handleFileUpload(e, 'centerLogoUrl')}
                    disabled={uploadingField === 'centerLogoUrl'}
                    className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {/* 3. Right Logo */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-stone-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-slate-800">
                  3. Right Logo / Seal
                </span>
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-white shadow-2xs border border-stone-200 overflow-hidden">
                  {localSettings.rightLogoType === 'bagong_pilipinas' ? (
                    <SealBagongPilipinas
                      className="w-7 h-7"
                      customUrl={localSettings.rightLogoUrl}
                    />
                  ) : localSettings.rightLogoType === 'municipality' ? (
                    <SealMunicipality className="w-7 h-7" customUrl={localSettings.rightLogoUrl} />
                  ) : localSettings.rightLogoType === 'province' ? (
                    <SealProvince className="w-7 h-7" customUrl={localSettings.rightLogoUrl} />
                  ) : localSettings.rightLogoType === 'da' ? (
                    <SealDA className="w-7 h-7" customUrl={localSettings.rightLogoUrl} />
                  ) : localSettings.rightLogoUrl ? (
                    <img
                      src={localSettings.rightLogoUrl}
                      alt="Right Seal"
                      className="w-7 h-7 object-contain rounded-full"
                    />
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400">None</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-1">Seal Type</label>
                  <select
                    value={localSettings.rightLogoType}
                    onChange={e => updateSetting('rightLogoType', e.target.value)}
                    className="w-full bg-white border border-stone-300 rounded-lg p-2 font-semibold text-slate-800"
                  >
                    <option value="bagong_pilipinas">Bagong Pilipinas</option>
                    <option value="municipality">Municipality of Hinunangan</option>
                    <option value="province">Province of Southern Leyte</option>
                    <option value="da">Department of Agriculture (DA)</option>
                    <option value="none">None / Hidden</option>
                    <option value="custom">Custom Uploaded Image</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-1">
                    Upload Custom Right Seal
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => handleFileUpload(e, 'rightLogoUrl')}
                    disabled={uploadingField === 'rightLogoUrl'}
                    className="w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {/* 4. Background Watermark */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-stone-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-slate-800">
                  4. Background Watermark Seal
                </span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={localSettings.showWatermark}
                    onChange={e => updateSetting('showWatermark', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {localSettings.showWatermark && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">
                      Watermark Opacity: {Math.round(localSettings.watermarkOpacity * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0.05"
                      max="0.30"
                      step="0.01"
                      value={localSettings.watermarkOpacity}
                      onChange={e => updateSetting('watermarkOpacity', parseFloat(e.target.value))}
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">
                      Watermark Insignia
                    </label>
                    <select
                      value={localSettings.watermarkType}
                      onChange={e => updateSetting('watermarkType', e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-lg p-2 font-semibold text-slate-800"
                    >
                      <option value="municipality">Municipality of Hinunangan</option>
                      <option value="da">Department of Agriculture</option>
                      <option value="barangay">Barangay Seal</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* 5. Contact Details */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-stone-200 space-y-3">
              <span className="text-xs font-black uppercase text-slate-800">
                5. Header Contact Details (e.g. Nava Style)
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-1">
                    📧 Barangay Email
                  </label>
                  <input
                    type="email"
                    value={localSettings.barangayEmail || ''}
                    onChange={e => updateSetting('barangayEmail', e.target.value)}
                    placeholder="e.g. nava.hinunangan20@gmail.com"
                    className="w-full bg-white border border-stone-300 rounded-lg p-2 font-bold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-1">
                    📞 Barangay Phone / Mobile
                  </label>
                  <input
                    type="text"
                    value={localSettings.barangayPhone || ''}
                    onChange={e => updateSetting('barangayPhone', e.target.value)}
                    placeholder="e.g. 09763070221"
                    className="w-full bg-white border border-stone-300 rounded-lg p-2 font-bold text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-1">
                  Header Motto / Subtitle (Optional)
                </label>
                <textarea
                  rows={2}
                  value={localSettings.headerMotto || ''}
                  onChange={e => updateSetting('headerMotto', e.target.value)}
                  placeholder="e.g. OFFICE OF THE PUNONG BARANGAY"
                  className="w-full bg-white border border-stone-300 rounded-lg p-2 text-xs font-medium text-slate-800"
                />
              </div>
            </div>
          </>
        ) : (
          /* Print Calibration Tab */
          <div className="space-y-4">
            <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3 text-xs text-blue-900 leading-relaxed">
              <strong>Print Calibration Mode:</strong> Adjust the physical scale and ink distribution of the seals when sending certificates to thermal, inkjet, or laser printers.
            </div>

            {/* Print Logo Size */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-stone-200 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-black uppercase text-slate-800">
                    Printed Seal Dimensions
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Current Print Target: {localSettings.printLogoSize || 72}px
                  </p>
                </div>
                <div
                  style={{ width: `${(localSettings.printLogoSize || 72) / 2}px`, height: `${(localSettings.printLogoSize || 72) / 2}px` }}
                  className="rounded-full bg-blue-100 border border-blue-300 flex items-center justify-center transition-all"
                >
                  <Printer className="w-3.5 h-3.5 text-blue-600" />
                </div>
              </div>
              <input
                type="range"
                min="48"
                max="120"
                step="4"
                value={localSettings.printLogoSize || 72}
                onChange={e => updateSetting('printLogoSize', parseInt(e.target.value, 10))}
                className="w-full accent-blue-600 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                <span>Compact (48px)</span>
                <span>Standard Official (72px)</span>
                <span>Large Seal (120px)</span>
              </div>
            </div>

            {/* Print Watermark Controls */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-stone-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-black uppercase text-slate-800">
                    Include Watermark on Print
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Control background seal ink to prevent obscuring text on printed paper
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={localSettings.printShowWatermark ?? true}
                    onChange={e => updateSetting('printShowWatermark', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {localSettings.printShowWatermark && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-1">
                    Printer Watermark Density: {Math.round((localSettings.printWatermarkOpacity ?? 0.10) * 100)}%
                  </label>
                  <input
                    type="range"
                    min="0.03"
                    max="0.25"
                    step="0.01"
                    value={localSettings.printWatermarkOpacity ?? 0.10}
                    onChange={e => updateSetting('printWatermarkOpacity', parseFloat(e.target.value))}
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-400">
                    Recommended 8%–12% for crisp black-text legibility
                  </span>
                </div>
              )}
            </div>

            {/* Print Adjustments */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-stone-200 space-y-3">
              <span className="text-xs font-black uppercase text-slate-800">
                Print Output Adjustments
              </span>

              <div className="flex items-center justify-between py-1">
                <div>
                  <span className="text-xs font-bold text-slate-800">Black & White Print Optimization</span>
                  <p className="text-[10px] text-slate-500">Render all logos in high-contrast monochrome</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={localSettings.printGrayscale ?? false}
                    onChange={e => updateSetting('printGrayscale', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between py-1 border-t border-stone-200">
                <div>
                  <span className="text-xs font-bold text-slate-800">Hide Center Logo on Print</span>
                  <p className="text-[10px] text-slate-500">Leave space for traditional 2-seal (Left / Right) certificates</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={localSettings.printHideCenterLogo ?? false}
                    onChange={e => updateSetting('printHideCenterLogo', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex justify-between items-center pt-2 border-t border-stone-100">
          <div className="text-[11px] text-stone-500 flex items-center gap-1">
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            Changes sync automatically
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer text-xs shadow-sm transition"
            >
              Apply & Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};