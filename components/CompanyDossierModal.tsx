import React, { useState } from 'react';
import type { CompanyIntel } from '../types';
import XCircleIcon from './icons/XCircleIcon';
import GlobeAltIcon from './icons/GlobeAltIcon';
import BriefcaseIcon from './icons/BriefcaseIcon';
import ShieldCheckIcon from './icons/ShieldCheckIcon';
import BuildingOfficeIcon from './icons/BuildingOfficeIcon';
import ClipboardIcon from './icons/ClipboardIcon';
import CheckIcon from './icons/CheckIcon';
import SparklesIcon from './icons/SparklesIcon';
import LinkIcon from './icons/LinkIcon';
import TagIcon from './icons/TagIcon';

interface CompanyDossierModalProps {
  company: CompanyIntel | null;
  onClose: () => void;
  showToast: (msg: string) => void;
}

const CompanyDossierModal: React.FC<CompanyDossierModalProps> = ({
  company,
  onClose,
  showToast
}) => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  if (!company) return null;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(label);
    showToast(`Copied ${label} to clipboard!`);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const copyFullDossier = () => {
    const text = [
      `Company: ${company.companyName} (${company.domain})`,
      `Industry: ${company.industry}${company.subCategory ? ` - ${company.subCategory}` : ''}`,
      company.productCategory ? `Product Category: ${company.productCategory}` : '',
      company.primaryProducts && company.primaryProducts.length > 0 ? `Primary Products: ${company.primaryProducts.join(', ')}` : '',
      `Business Model: ${company.businessModel || 'B2B'}`,
      `Headquarters: ${company.headquarters || 'Global'}`,
      `Website: ${company.websiteUrl || `https://${company.domain}`} [${company.websiteStatus}]`,
      `Confidence Score: ${company.confidenceScore || 90}%`,
      `\nOverview:`,
      company.overview,
      company.title ? `\nPage Title:\n${company.title}` : '',
      company.metaDescription ? `\nMeta Description:\n${company.metaDescription}` : '',
      company.searchSnippet ? `\nSearch Engine Snippet:\n${company.searchSnippet}` : '',
      `\nDiscovered Emails (${company.emails.length}):`,
      company.emails.join('\n')
    ].filter(Boolean).join('\n');

    copyToClipboard(text, 'Full Dossier');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in">
      <div 
        className="bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* MODAL HEADER */}
        <div className="p-5 border-b border-gray-700 bg-gray-900/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center overflow-hidden p-1 shadow-inner">
              <img 
                src={`https://www.google.com/s2/favicons?domain=${company.domain}&sz=64`}
                alt={company.companyName}
                className="w-7 h-7 object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white tracking-tight">{company.companyName}</h3>
                {company.isAiEnhanced && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-900/60 text-purple-300 border border-purple-700/50">
                    <SparklesIcon className="w-3 h-3 text-purple-400" /> AI Verified
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                <span className="font-mono text-purple-300">{company.domain}</span>
                <span>•</span>
                <span className={`flex items-center gap-1 ${company.websiteStatus === 'online' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${company.websiteStatus === 'online' ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                  {company.websiteStatus === 'online' ? 'Live Website' : 'Search Grounded'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={company.websiteUrl || `https://${company.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/60 rounded-lg transition"
              title="Open Website"
            >
              <LinkIcon className="w-5 h-5" />
            </a>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/60 rounded-lg transition"
            >
              <XCircleIcon className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* MODAL BODY */}
        <div className="p-6 overflow-y-auto space-y-5 custom-scrollbar text-sm">
          {/* BADGES ROW */}
          <div className="flex flex-wrap gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1 bg-purple-950/60 border border-purple-700/40 text-purple-300 rounded-lg text-xs font-semibold">
              <BriefcaseIcon className="w-3.5 h-3.5 text-purple-400" />
              {company.industry}
            </span>
            {company.subCategory && (
              <span className="flex items-center gap-1.5 px-3 py-1 bg-blue-950/60 border border-blue-700/40 text-blue-300 rounded-lg text-xs font-semibold">
                <BuildingOfficeIcon className="w-3.5 h-3.5 text-blue-400" />
                {company.subCategory}
              </span>
            )}
            {company.productCategory && (
              <span className="flex items-center gap-1.5 px-3 py-1 bg-amber-950/60 border border-amber-700/40 text-amber-300 rounded-lg text-xs font-semibold">
                <TagIcon className="w-3.5 h-3.5 text-amber-400" />
                {company.productCategory}
              </span>
            )}
            {company.businessModel && (
              <span className="flex items-center gap-1.5 px-3 py-1 bg-indigo-950/60 border border-indigo-700/40 text-indigo-300 rounded-lg text-xs font-medium">
                {company.businessModel}
              </span>
            )}
            {company.headquarters && (
              <span className="flex items-center gap-1.5 px-3 py-1 bg-gray-700/60 border border-gray-600/40 text-gray-300 rounded-lg text-xs font-medium">
                <GlobeAltIcon className="w-3.5 h-3.5 text-cyan-400" />
                {company.headquarters}
              </span>
            )}
            <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-950/60 border border-emerald-700/40 text-emerald-300 rounded-lg text-xs font-semibold ml-auto">
              <ShieldCheckIcon className="w-3.5 h-3.5 text-emerald-400" />
              {company.confidenceScore || 95}% Accuracy
            </span>
          </div>

          {/* OVERVIEW */}
          <div className="bg-gray-900/50 border border-gray-700/70 rounded-xl p-4 space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wider font-bold text-gray-400 mb-2 flex items-center gap-1.5">
                <SparklesIcon className="w-3.5 h-3.5 text-purple-400" />
                Company Intelligence & What They Do
              </div>
              <p className="text-gray-200 text-sm leading-relaxed">
                {company.overview}
              </p>
            </div>

            {company.primaryProducts && company.primaryProducts.length > 0 && (
              <div className="pt-2 border-t border-gray-800">
                <span className="text-xs text-amber-400 font-semibold block mb-1.5 flex items-center gap-1">
                  <TagIcon className="w-3.5 h-3.5 text-amber-400" />
                  Primary Products & Services Identified
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {company.primaryProducts.map((prod, idx) => (
                    <span key={idx} className="text-xs px-2.5 py-1 bg-amber-950/40 text-amber-200 rounded-lg border border-amber-800/40 font-medium">
                      {prod}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* METADATA & WEB GROUNDING INSPECTION */}
          <div className="bg-gray-900/40 border border-gray-700/50 rounded-xl p-4 space-y-3">
            <div className="text-xs uppercase tracking-wider font-bold text-gray-400 flex items-center justify-between">
              <span>Website Content & Search Engine Grounding</span>
              <span className="text-[11px] text-purple-300 font-medium px-2 py-0.5 rounded bg-purple-950/80 border border-purple-800/40">
                {company.groundingSource || 'Live Web Crawl & Index'}
              </span>
            </div>

            {company.title && (
              <div>
                <span className="text-xs text-gray-400 font-semibold block mb-0.5">Page Title (&lt;title&gt;)</span>
                <div className="text-xs text-gray-200 bg-gray-800/80 p-2.5 rounded-lg border border-gray-700/50 font-mono">
                  {company.title}
                </div>
              </div>
            )}

            {company.headings && company.headings.length > 0 && (
              <div>
                <span className="text-xs text-gray-400 font-semibold block mb-0.5">Key Product & Service Headings (H1 / H2)</span>
                <div className="flex flex-wrap gap-1.5 p-2 bg-gray-800/80 rounded-lg border border-gray-700/50">
                  {company.headings.map((h, idx) => (
                    <span key={idx} className="text-[11px] px-2 py-0.5 bg-gray-700/70 text-gray-200 rounded border border-gray-600/40">
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {company.metaDescription && (
              <div>
                <span className="text-xs text-gray-400 font-semibold block mb-0.5">Website Meta Description (HTML Tag)</span>
                <div className="text-xs text-gray-300 bg-gray-800/80 p-2.5 rounded-lg border border-gray-700/50 leading-relaxed">
                  {company.metaDescription}
                </div>
              </div>
            )}

            {company.websiteSnippet && (
              <div>
                <span className="text-xs text-gray-400 font-semibold block mb-0.5">Extracted Website Body Text (Products & Operations)</span>
                <div className="text-xs text-gray-300 bg-gray-800/80 p-2.5 rounded-lg border border-gray-700/50 leading-relaxed italic">
                  "{company.websiteSnippet}"
                </div>
              </div>
            )}

            {company.searchSnippet && (
              <div>
                <span className="text-xs text-gray-400 font-semibold block mb-0.5">Google / Search Engine Snippet</span>
                <div className="text-xs text-emerald-300/90 bg-gray-800/80 p-2.5 rounded-lg border border-emerald-800/40 leading-relaxed">
                  {company.searchSnippet}
                </div>
              </div>
            )}
          </div>

          {/* ASSOCIATED EMAILS */}
          <div className="bg-gray-900/40 border border-gray-700/50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs uppercase tracking-wider font-bold text-gray-400">
                Discovered Corporate Emails ({company.emails.length})
              </span>
              <button
                onClick={() => copyToClipboard(company.emails.join('\n'), 'Emails')}
                className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 font-medium"
              >
                {copiedSection === 'Emails' ? (
                  <>
                    <CheckIcon className="w-3.5 h-3.5 text-green-400" /> Copied!
                  </>
                ) : (
                  <>
                    <ClipboardIcon className="w-3.5 h-3.5" /> Copy All
                  </>
                )}
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1.5 custom-scrollbar pr-1">
              {company.emails.map((email, idx) => (
                <div
                  key={`${email}-${idx}`}
                  className="flex items-center justify-between text-xs font-mono text-gray-300 bg-gray-800/60 px-3 py-1.5 rounded border border-gray-700/40 hover:border-gray-600 transition"
                >
                  <span className="truncate">{email}</span>
                  <button
                    onClick={() => copyToClipboard(email, email)}
                    className="text-gray-400 hover:text-white ml-2 shrink-0"
                    title="Copy this email"
                  >
                    <ClipboardIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* MODAL FOOTER */}
        <div className="p-4 border-t border-gray-700 bg-gray-900/60 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            Domain: <strong className="text-gray-200">{company.domain}</strong>
          </span>

          <div className="flex items-center gap-3">
            <button
              onClick={copyFullDossier}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs font-semibold transition border border-gray-600"
            >
              {copiedSection === 'Full Dossier' ? (
                <>
                  <CheckIcon className="w-4 h-4 text-green-400" /> Copied Dossier!
                </>
              ) : (
                <>
                  <ClipboardIcon className="w-4 h-4" /> Copy Full Dossier
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition shadow-lg"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyDossierModal;
