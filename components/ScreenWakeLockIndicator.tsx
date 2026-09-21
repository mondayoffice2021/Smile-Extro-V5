import React, { useState, useRef, useEffect } from 'react';
import { useWakeLock } from '../hooks/useWakeLock';
import { Sun, Moon, Monitor, ChevronDown, Check, Zap, ShieldAlert } from 'lucide-react';
import type { WakeLockMode } from '../services/wakeLockService';

interface ScreenWakeLockIndicatorProps {
  showToast?: (msg: string) => void;
}

export const ScreenWakeLockIndicator: React.FC<ScreenWakeLockIndicatorProps> = ({ showToast }) => {
  const { isActive, mode, isSupported, activeReasons, setMode } = useWakeLock();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectMode = (newMode: WakeLockMode) => {
    setMode(newMode, showToast);
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 border shadow-sm ${
          isActive
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25 hover:border-amber-500/60'
            : mode === 'auto'
            ? 'bg-gray-800/80 border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white'
            : 'bg-gray-900/60 border-gray-800 text-gray-500 hover:text-gray-300'
        }`}
        title="Screen Wake Lock: Controls whether your display stays awake during tasks"
      >
        {isActive ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </span>
            <Sun className="w-3.5 h-3.5 text-amber-400 animate-[spin_10s_linear_infinite]" />
            <span className="hidden sm:inline">Screen Awake</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 bg-amber-400/20 text-amber-300 rounded">
              Active
            </span>
          </>
        ) : mode === 'auto' ? (
          <>
            <Zap className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">Screen Awake</span>
            <span className="text-[10px] font-mono text-gray-400">Auto</span>
          </>
        ) : (
          <>
            <Moon className="w-3.5 h-3.5 text-gray-500" />
            <span className="hidden sm:inline">Screen Sleep</span>
            <span className="text-[10px] font-mono text-gray-500">Off</span>
          </>
        )}

        <ChevronDown className="w-3 h-3 ml-0.5 opacity-60" />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl bg-gray-900 border border-gray-700 shadow-2xl z-[120] p-3 space-y-2 animate-in fade-in zoom-in-95 duration-150">
          <div className="pb-2 border-b border-gray-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Monitor className="w-4 h-4 text-blue-400" />
                Keep Screen Awake
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                isActive ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-800 text-gray-400'
              }`}>
                {isActive ? 'Awake Active' : 'Standby'}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mt-1 leading-snug">
              Prevents your monitor and computer from sleeping while sorting files, verifying MX records, or extracting contacts.
            </p>
          </div>

          {/* Mode Selector Options */}
          <div className="space-y-1">
            {/* Auto Mode */}
            <button
              onClick={() => handleSelectMode('auto')}
              className={`w-full text-left p-2 rounded-lg text-xs flex items-start justify-between transition-colors ${
                mode === 'auto'
                  ? 'bg-blue-600/20 text-blue-200 border border-blue-500/30'
                  : 'hover:bg-gray-800 text-gray-300'
              }`}
            >
              <div>
                <div className="font-bold flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-blue-400" />
                  Auto (When in use)
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  Awake during file uploads, sorting, & deep checks.
                </div>
              </div>
              {mode === 'auto' && <Check className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />}
            </button>

            {/* Always On Mode */}
            <button
              onClick={() => handleSelectMode('always')}
              className={`w-full text-left p-2 rounded-lg text-xs flex items-start justify-between transition-colors ${
                mode === 'always'
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30'
                  : 'hover:bg-gray-800 text-gray-300'
              }`}
            >
              <div>
                <div className="font-bold flex items-center gap-1.5">
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  Always Awake
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  Display stays continuously awake at all times.
                </div>
              </div>
              {mode === 'always' && <Check className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />}
            </button>

            {/* Off Mode */}
            <button
              onClick={() => handleSelectMode('off')}
              className={`w-full text-left p-2 rounded-lg text-xs flex items-start justify-between transition-colors ${
                mode === 'off'
                  ? 'bg-gray-700/50 text-gray-200 border border-gray-600'
                  : 'hover:bg-gray-800 text-gray-400'
              }`}
            >
              <div>
                <div className="font-bold flex items-center gap-1.5">
                  <Moon className="w-3.5 h-3.5 text-gray-500" />
                  Disabled (Normal Sleep)
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  Default operating system screen timeout.
                </div>
              </div>
              {mode === 'off' && <Check className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />}
            </button>
          </div>

          {/* Active Tasks info */}
          {activeReasons.length > 0 && (
            <div className="pt-2 border-t border-gray-800">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block mb-1">
                Active Operations ({activeReasons.length}):
              </span>
              <div className="space-y-1 max-h-24 overflow-y-auto custom-scrollbar">
                {activeReasons.map((reason, idx) => (
                  <div key={idx} className="text-[11px] text-gray-300 bg-gray-800/80 px-2 py-1 rounded flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse"></span>
                    <span className="truncate">{reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isSupported && (
            <div className="pt-2 border-t border-gray-800 flex items-start gap-1.5 text-[10px] text-yellow-400/90">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Native WakeLock API not supported by this browser; using active background fallback.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
export default ScreenWakeLockIndicator;
