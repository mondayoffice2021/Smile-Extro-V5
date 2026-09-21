import React from 'react';
import XCircleIcon from './icons/XCircleIcon';
import ShieldCheckIcon from './icons/ShieldCheckIcon';
import CheckIcon from './icons/CheckIcon';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (key: string) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 animate-fade-in-up">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="w-6 h-6 text-emerald-400" />
            <h2 className="text-xl font-bold text-white">System Architecture</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>
        
        <div className="space-y-4">
          <div className="p-4 bg-emerald-950/40 border border-emerald-500/40 rounded-lg">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm mb-1">
              <CheckIcon className="w-5 h-5" />
              Native Direct Engine — Zero Limitations
            </div>
            <p className="text-xs text-emerald-200/80 leading-relaxed">
              This application runs entirely on authentic search engine dorking, direct web scrapers, 200+ ccTLD heuristic mapping, Google DNS MX lookups, and native SMTP server handshakes.
            </p>
          </div>

          <div className="space-y-2 text-xs text-gray-300">
            <div className="flex items-start gap-2">
              <span className="text-blue-400 font-bold">•</span>
              <span><strong>No API Keys:</strong> You do not need to provide or purchase any third-party keys.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-blue-400 font-bold">•</span>
              <span><strong>No Rate Limits:</strong> No quota exhaustion or daily usage restrictions.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-blue-400 font-bold">•</span>
              <span><strong>Original Web Crawling:</strong> Scrapes live HTML and search indices directly for verified business emails.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-blue-400 font-bold">•</span>
              <span><strong>Native SMTP Verification:</strong> Real socket handshakes directly with mail exchange servers.</span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-lg transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
