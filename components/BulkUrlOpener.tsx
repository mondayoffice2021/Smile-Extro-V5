import React, { useState, useEffect, useRef, useMemo } from 'react';
import LinkIcon from './icons/LinkIcon';
import GlobeAltIcon from './icons/GlobeAltIcon';
import ArrowPathIcon from './icons/ArrowPathIcon';
import DocumentArrowUpIcon from './icons/DocumentArrowUpIcon';
import ClipboardIcon from './icons/ClipboardIcon';
import CheckIcon from './icons/CheckIcon';
import XCircleIcon from './icons/XCircleIcon';
import PlayIcon from './icons/PlayIcon';
import StopIcon from './icons/StopIcon';
import { isPublicDomain } from '../constants/domains';
import { useActiveWakeLock } from '../hooks/useWakeLock';
import { evaluateCleanTarget, CleanFilterConfig } from '../services/businessEmailFilter';

interface BulkUrlOpenerProps {
  showToast: (message: string) => void;
}

export interface ParsedItem {
  id: string;
  original: string;
  url: string;
  domain: string;
  isEmail: boolean;
  isPublicWebmail: boolean;
  status: 'ready' | 'opened' | 'blocked' | 'skipped';
}

export const BulkUrlOpener: React.FC<BulkUrlOpenerProps> = ({ showToast }) => {
  const [inputText, setInputText] = useState<string>('');
  
  // Clean filtering and deduplication states (User requested: remove public emails, banks, junk emails like webmaster/user keeping info/sales/order, remove gov/edu and duplicate URLs)
  const [enableCleanFilter, setEnableCleanFilter] = useState<boolean>(true);
  const [excludePublicWebmail, setExcludePublicWebmail] = useState<boolean>(true);
  const [excludeBanks, setExcludeBanks] = useState<boolean>(true);
  const [excludeJunkEmails, setExcludeJunkEmails] = useState<boolean>(true);
  const [excludeGovEdu, setExcludeGovEdu] = useState<boolean>(true);
  const [removeDuplicateUrls, setRemoveDuplicateUrls] = useState<boolean>(true);
  const [showCleanConfig, setShowCleanConfig] = useState<boolean>(false);

  const [delayBetweenTabs, setDelayBetweenTabs] = useState<number>(150); // ms delay to prevent browser crash
  const [isOpening, setIsOpening] = useState<boolean>(false);

  // Keep screen awake while batch URLs are being opened
  useActiveWakeLock(isOpening, 'Bulk URL Opener: Launching Targets');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [popupBlockedWarning, setPopupBlockedWarning] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'opened' | 'blocked'>('all');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortOpeningRef = useRef<boolean>(false);

  // Helper: Normalize URL or Email to clean https:// URL
  const convertToUrl = (raw: string): { url: string; domain: string; isEmail: boolean; isPublicWebmail: boolean } | null => {
    let text = raw.trim();
    if (!text) return null;

    // Clean common wrappers like < >, [ ], ( ), quotes, trailing semicolons/commas
    text = text.replace(/^[<"'\(\[]+|[>"'\)\];,]+$/g, '').trim();
    if (!text) return null;

    // Check if it's an email format
    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      const rawDomain = emailMatch[2].toLowerCase();
      const isPublic = isPublicDomain(rawDomain);
      return {
        url: `https://${rawDomain}`,
        domain: rawDomain,
        isEmail: true,
        isPublicWebmail: isPublic
      };
    }

    // Check if it's already a URL or domain
    // Strip leading protocols for domain extraction
    let cleanText = text;
    let protocol = 'https://';
    if (/^https?:\/\//i.test(cleanText)) {
      const parts = cleanText.split(/:\/\//i);
      protocol = parts[0].toLowerCase() + '://';
      cleanText = parts[1];
    }

    // Extract hostname / domain
    const hostMatch = cleanText.match(/^([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (hostMatch) {
      const domain = hostMatch[1].toLowerCase();
      const isPublic = isPublicDomain(domain);
      // Reconstruct clean URL
      const fullUrl = text.startsWith('http://') || text.startsWith('https://')
        ? text
        : `https://${text}`;
      return {
        url: fullUrl,
        domain,
        isEmail: false,
        isPublicWebmail: isPublic
      };
    }

    return null;
  };

  // Parse and deduplicate with clean filter rules
  const { parsedItems, cleanFilterStats } = useMemo(() => {
    if (!inputText.trim()) {
      return {
        parsedItems: [] as ParsedItem[],
        cleanFilterStats: {
          totalTokens: 0,
          publicExcluded: 0,
          banksExcluded: 0,
          junkExcluded: 0,
          govEduExcluded: 0,
          duplicatesRemoved: 0
        }
      };
    }

    // Split on newlines, commas, tabs, spaces
    const tokens = inputText
      .split(/[\r\n,;]+/)
      .map(t => t.trim())
      .filter(Boolean);

    const cleanConfig: CleanFilterConfig = {
      removePublicEmails: excludePublicWebmail,
      removeBanks: excludeBanks,
      removeJunkUsers: excludeJunkEmails,
      removeGovEdu: excludeGovEdu,
      removeDuplicates: removeDuplicateUrls
    };

    let pubCount = 0;
    let bankCount = 0;
    let junkCount = 0;
    let govEduCount = 0;
    let dupCount = 0;

    const seenUrls = new Set<string>();
    const items: ParsedItem[] = [];

    tokens.forEach((token, idx) => {
      // 1. Check raw token against business clean filter if enabled
      if (enableCleanFilter) {
        const evalRes = evaluateCleanTarget(token, cleanConfig);
        if (!evalRes.isClean) {
          if (evalRes.category === 'public_webmail') pubCount++;
          else if (evalRes.category === 'bank') bankCount++;
          else if (evalRes.category === 'webmaster_bot') junkCount++;
          else if (evalRes.category === 'government' || evalRes.category === 'education') govEduCount++;
          return;
        }
      }

      const res = convertToUrl(token);
      if (!res) return;

      // 2. Check resolved domain against clean rules
      if (enableCleanFilter && res.domain) {
        const domainEval = evaluateCleanTarget(res.domain, cleanConfig);
        if (!domainEval.isClean) {
          if (domainEval.category === 'public_webmail') pubCount++;
          else if (domainEval.category === 'bank') bankCount++;
          else if (domainEval.category === 'government' || domainEval.category === 'education') govEduCount++;
          return;
        }
      }

      // Legacy toggle fallback
      if (excludePublicWebmail && res.isPublicWebmail) {
        pubCount++;
        return;
      }

      // 3. Normalized URL Deduplication
      const normalizedKey = res.url.toLowerCase().replace(/\/+$/, '');
      if (removeDuplicateUrls) {
        if (seenUrls.has(normalizedKey)) {
          dupCount++;
          return;
        }
        seenUrls.add(normalizedKey);
      }

      items.push({
        id: `item-${idx}-${normalizedKey}`,
        original: token,
        url: res.url,
        domain: res.domain,
        isEmail: res.isEmail,
        isPublicWebmail: res.isPublicWebmail,
        status: 'ready'
      });
    });

    return {
      parsedItems: items,
      cleanFilterStats: {
        totalTokens: tokens.length,
        publicExcluded: pubCount,
        banksExcluded: bankCount,
        junkExcluded: junkCount,
        govEduExcluded: govEduCount,
        duplicatesRemoved: dupCount
      }
    };
  }, [
    inputText,
    enableCleanFilter,
    excludePublicWebmail,
    excludeBanks,
    excludeJunkEmails,
    excludeGovEdu,
    removeDuplicateUrls
  ]);

  // Keep selectedIds in sync: default select all parsed items
  const [itemsState, setItemsState] = useState<ParsedItem[]>([]);

  useEffect(() => {
    setItemsState(parsedItems);
    setSelectedIds(new Set(parsedItems.map(item => item.id)));
  }, [parsedItems]);

  // Global Keyboard Shortcuts: Ctrl+Enter (Open All) and Ctrl+R (Reset)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Open all on Ctrl+Enter or Cmd+Enter
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleOpenSelected();
      }

      // Reset on Ctrl+R or Cmd+R
      if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
        // Prevent default browser page refresh so user gets our dedicated reset!
        e.preventDefault();
        handleReset();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [itemsState, selectedIds, isOpening]);

  // Reset function
  const handleReset = () => {
    if (isOpening) {
      abortOpeningRef.current = true;
      setIsOpening(false);
    }
    setInputText('');
    setItemsState([]);
    setSelectedIds(new Set());
    setPopupBlockedWarning(false);
    setSearchQuery('');
    showToast('Reset complete! [Ctrl+R]');
  };

  // Single URL Opener helper
  const openSingleUrl = (url: string): boolean => {
    try {
      const newTab = window.open(url, '_blank', 'noopener,noreferrer');
      if (!newTab || newTab.closed || typeof newTab.closed === 'undefined') {
        // Popup was blocked by browser
        return false;
      }
      return true;
    } catch (err) {
      console.error('Failed to open tab', err);
      return false;
    }
  };

  // Open All / Selected URLs
  const handleOpenSelected = async () => {
    const toOpen = itemsState.filter(item => selectedIds.has(item.id));
    if (toOpen.length === 0) {
      showToast('No URLs selected to open. Please enter emails or URLs first.');
      return;
    }

    setIsOpening(true);
    abortOpeningRef.current = false;
    setPopupBlockedWarning(false);

    let openedCount = 0;
    let blockedCount = 0;

    for (let i = 0; i < toOpen.length; i++) {
      if (abortOpeningRef.current) {
        showToast(`Stopped opening. Opened ${openedCount} of ${toOpen.length} URLs.`);
        break;
      }

      const item = toOpen[i];
      const success = openSingleUrl(item.url);

      if (success) {
        openedCount++;
        setItemsState(prev => prev.map(it => it.id === item.id ? { ...it, status: 'opened' } : it));
      } else {
        blockedCount++;
        setPopupBlockedWarning(true);
        setItemsState(prev => prev.map(it => it.id === item.id ? { ...it, status: 'blocked' } : it));
      }

      // Small delay between opening tabs to prevent browser freezing
      if (delayBetweenTabs > 0 && i < toOpen.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenTabs));
      }
    }

    setIsOpening(false);

    if (blockedCount > 0) {
      showToast(`⚠️ ${blockedCount} tab(s) were blocked by browser pop-up blocker. Please enable pop-ups!`);
    } else {
      showToast(`Successfully opened ${openedCount} tab(s)!`);
    }
  };

  // Open single item manually from list
  const handleOpenOne = (item: ParsedItem) => {
    const success = openSingleUrl(item.url);
    if (success) {
      setItemsState(prev => prev.map(it => it.id === item.id ? { ...it, status: 'opened' } : it));
      showToast(`Opened: ${item.domain}`);
    } else {
      setPopupBlockedWarning(true);
      setItemsState(prev => prev.map(it => it.id === item.id ? { ...it, status: 'blocked' } : it));
      showToast('⚠️ Pop-up blocked! Please click the icon in your address bar to allow pop-ups.');
    }
  };

  // File Upload / Drop handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setInputText(content);
        showToast(`Loaded ${file.name} successfully.`);
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  // Load Sample Data for fast testing
  const handleLoadSample = () => {
    const sample = [
      '// Sample list of corporate emails and domains (Duplicates included for demo):',
      'contact@siemens.com',
      'info@bosch.de',
      'sales@siemens.com', // Duplicate domain
      'https://www.bmwgroup.com',
      'support@volkswagen.de',
      'press@mercedes-benz.com',
      'partner@sap.com',
      'john.doe@gmail.com', // Public email (filtered if toggle on)
      'contact@airbus.com',
      'https://www.basf.com/global/en.html',
      'info@thyssenkrupp.com',
      'https://www.bosch.de' // Duplicate domain
    ].join('\n');
    setInputText(sample);
    showToast('Loaded sample emails & URLs.');
  };

  // Copy All URLs to clipboard
  const handleCopyAll = () => {
    const urls = itemsState
      .filter(item => selectedIds.has(item.id))
      .map(item => item.url)
      .join('\n');
    if (!urls) {
      showToast('No URLs to copy.');
      return;
    }
    navigator.clipboard.writeText(urls);
    showToast(`Copied ${selectedIds.size} URLs to clipboard!`);
  };

  // Export URLs to .txt file
  const handleExportTxt = () => {
    const urls = itemsState
      .filter(item => selectedIds.has(item.id))
      .map(item => item.url)
      .join('\n');
    if (!urls) {
      showToast('No URLs to export.');
      return;
    }
    const blob = new Blob([urls], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `bulk_urls_${new Date().toISOString().split('T')[0]}.txt`;
    link.click();
    showToast('Exported URLs to text file.');
  };

  // Toggle selection
  const toggleSelectAll = () => {
    if (selectedIds.size === itemsState.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(itemsState.map(it => it.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Filtered display list
  const filteredList = itemsState.filter(item => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return item.url.toLowerCase().includes(q) || item.original.toLowerCase().includes(q);
    }
    return true;
  });

  const totalRawLines = inputText.split(/[\r\n,;]+/).filter(t => t.trim().length > 0).length;
  const emailsConvertedCount = itemsState.filter(it => it.isEmail).length;
  const directUrlsCount = itemsState.filter(it => !it.isEmail).length;

  return (
    <div className="space-y-6">
      {/* TOP INSTRUCTION & POPUP BANNER */}
      <div className="bg-gradient-to-r from-blue-900/40 via-indigo-900/30 to-blue-900/40 border border-blue-700/60 rounded-xl p-4 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-blue-600/30 border border-blue-500/40 rounded-lg text-blue-300 mt-0.5">
            <GlobeAltIcon className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Bulk URL Opener
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-800 text-blue-200 border border-blue-600">
                Auto Email-to-URL Conversion & Deduplication
              </span>
            </h2>
            <p className="text-sm text-yellow-300 font-medium mt-0.5 flex items-center gap-1.5">
              <span>⚠️</span>
              <span>Please allow pop-ups for this site so every URL can open in its own tab.</span>
            </p>
            <p className="text-xs text-gray-300 mt-1">
              Load emails or URLs. If only emails are loaded, they are automatically converted into their official domain URLs with all duplicates stripped.
            </p>
          </div>
        </div>

        {/* Action Shortcuts Pill */}
        <div className="flex flex-wrap items-center gap-2 bg-gray-900/80 px-3 py-2 rounded-lg border border-gray-700 text-xs text-gray-300">
          <span className="font-semibold text-gray-200">Shortcuts:</span>
          <span className="bg-gray-800 text-blue-300 px-2 py-0.5 rounded font-mono border border-gray-600">
            Open all [Ctrl+Enter]
          </span>
          <span className="bg-gray-800 text-yellow-300 px-2 py-0.5 rounded font-mono border border-gray-600">
            Reset [Ctrl+R]
          </span>
        </div>
      </div>

      {/* POP-UP BLOCKED WARNING MODAL/BANNER */}
      {popupBlockedWarning && (
        <div className="bg-red-950/80 border-2 border-red-600 rounded-xl p-4 text-red-200 shadow-2xl flex items-start justify-between gap-4 animate-pulse">
          <div className="flex items-start gap-3">
            <XCircleIcon className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="font-bold text-white text-sm">Browser Pop-up Blocker Active!</h3>
              <p className="text-xs text-red-200 leading-relaxed">
                Your browser blocked one or more tabs from opening automatically. To enable:
              </p>
              <ol className="list-decimal list-inside text-xs text-red-100 space-y-0.5 mt-1">
                <li>Look at the right side of your browser address bar for the <strong>Pop-up blocked icon</strong> (looks like a window with a red X).</li>
                <li>Click it and select <strong>"Always allow pop-ups and redirects from this site"</strong>.</li>
                <li>Click <strong>Done</strong>, then click <strong>"Open List of URLs"</strong> again.</li>
              </ol>
            </div>
          </div>
          <button
            onClick={() => setPopupBlockedWarning(false)}
            className="text-xs bg-red-800/60 hover:bg-red-700 text-white px-2.5 py-1 rounded transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* MAIN TWO-COLUMN WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: INPUT & SETTINGS */}
        <div className="lg:col-span-5 bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl shadow-2xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-gray-700">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <LinkIcon className="w-5 h-5 text-blue-400" />
                  Load Emails or URLs
                </h3>
                <span className="text-xs text-gray-400">Pastes, lists, or file uploads</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleLoadSample}
                  className="text-xs px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-blue-300 transition-colors font-medium"
                  title="Insert sample test list"
                >
                  Load Sample
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors font-medium flex items-center gap-1"
                  title="Upload .txt or .csv"
                >
                  <DocumentArrowUpIcon className="w-3.5 h-3.5" />
                  Upload
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv,.log,.json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>
            </div>

            {/* TEXTAREA INPUT */}
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste email addresses or URLs here, one per line or separated by commas:&#10;&#10;sales@company.com&#10;info@industry-corp.de&#10;https://target-domain.org&#10;support@logistics.co.uk&#10;user@gmail.com"
              className="w-full h-64 p-3.5 bg-gray-900/90 border border-gray-600 rounded-lg text-sm font-mono text-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none custom-scrollbar"
            />

            {/* REAL-TIME DEDUPLICATION STATS BAR */}
            <div className="grid grid-cols-4 gap-2 bg-gray-900/60 p-2.5 rounded-lg border border-gray-700/80 text-center text-xs">
              <div>
                <span className="text-gray-400 block text-[11px]">Raw Lines</span>
                <span className="font-bold text-white text-sm">{totalRawLines}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[11px]">Emails Converted</span>
                <span className="font-bold text-blue-400 text-sm">{emailsConvertedCount}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[11px]">Direct URLs</span>
                <span className="font-bold text-indigo-400 text-sm">{directUrlsCount}</span>
              </div>
              <div>
                <span className="text-gray-400 block text-[11px]">Unique Ready</span>
                <span className="font-bold text-green-400 text-sm">{itemsState.length}</span>
              </div>
            </div>

            {/* FILTER & SAFETY CONTROLS WITH CLEAN SEPARATION RULES */}
            <div className="p-3 bg-gradient-to-br from-gray-900/90 to-indigo-950/40 border border-indigo-500/30 rounded-xl space-y-2.5 shadow-md">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={enableCleanFilter}
                    onChange={(e) => setEnableCleanFilter(e.target.checked)}
                    className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 w-4 h-4 bg-gray-800"
                  />
                  <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                    🛡️ Clean Filter & URL Deduplication
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowCleanConfig(!showCleanConfig)}
                  className="text-[11px] text-indigo-400 hover:text-indigo-200 underline font-medium"
                >
                  {showCleanConfig ? 'Hide Rules' : 'Customize Rules'}
                </button>
              </div>

              <p className="text-[11px] text-gray-400 leading-relaxed">
                Removes consumer mailboxes, banks, junk users (<code className="text-indigo-300">webmaster</code>, <code className="text-indigo-300">user</code>, etc. while preserving <code className="text-emerald-300">info</code>, <code className="text-emerald-300">sales</code>, <code className="text-emerald-300">order</code>), filters .gov/.edu, and deduplicates URLs.
              </p>

              {/* Clean Filter Stats Badges */}
              {(cleanFilterStats.duplicatesRemoved > 0 ||
                cleanFilterStats.publicExcluded > 0 ||
                cleanFilterStats.banksExcluded > 0 ||
                cleanFilterStats.junkExcluded > 0 ||
                cleanFilterStats.govEduExcluded > 0) && (
                <div className="flex flex-wrap gap-1.5 pt-0.5 text-[10px] font-mono">
                  {cleanFilterStats.duplicatesRemoved > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                      {cleanFilterStats.duplicatesRemoved} Duplicates Stripped
                    </span>
                  )}
                  {cleanFilterStats.publicExcluded > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-red-950/80 text-red-300 border border-red-800/60">
                      {cleanFilterStats.publicExcluded} Public Webmails Filtered
                    </span>
                  )}
                  {cleanFilterStats.banksExcluded > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60">
                      {cleanFilterStats.banksExcluded} Banks Filtered
                    </span>
                  )}
                  {cleanFilterStats.junkExcluded > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/60" title="Keeps info, sales, order">
                      {cleanFilterStats.junkExcluded} Junk Users Filtered (Kept Info/Sales/Order)
                    </span>
                  )}
                  {cleanFilterStats.govEduExcluded > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/60">
                      {cleanFilterStats.govEduExcluded} .Gov/.Edu Filtered
                    </span>
                  )}
                </div>
              )}

              {/* Expandable Individual Rule Checkboxes */}
              {showCleanConfig && (
                <div className="pt-2 border-t border-gray-800 space-y-2 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer text-gray-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={excludePublicWebmail}
                      onChange={(e) => setExcludePublicWebmail(e.target.checked)}
                      disabled={!enableCleanFilter}
                      className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 bg-gray-800"
                    />
                    <span>Remove consumer webmails (Gmail, Yahoo, Hotmail, Outlook)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-gray-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={excludeBanks}
                      onChange={(e) => setExcludeBanks(e.target.checked)}
                      disabled={!enableCleanFilter}
                      className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 bg-gray-800"
                    />
                    <span>Remove banks and financial institutions (Chase, Citi, .bank)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-gray-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={excludeJunkEmails}
                      onChange={(e) => setExcludeJunkEmails(e.target.checked)}
                      disabled={!enableCleanFilter}
                      className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 bg-gray-800"
                    />
                    <span>Remove junk mailboxes (webmaster, user — preserves info, sales, order)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-gray-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={excludeGovEdu}
                      onChange={(e) => setExcludeGovEdu(e.target.checked)}
                      disabled={!enableCleanFilter}
                      className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 bg-gray-800"
                    />
                    <span>Remove Government (.gov, .mil) & Education (.edu, .ac.*)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-gray-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={removeDuplicateUrls}
                      onChange={(e) => setRemoveDuplicateUrls(e.target.checked)}
                      disabled={!enableCleanFilter}
                      className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 bg-gray-800"
                    />
                    <span>Remove duplicate URLs (Normalized URL deduplication)</span>
                  </label>
                </div>
              )}

              {/* Delay between tabs to avoid browser freeze */}
              <div className="pt-2 border-t border-gray-800 text-xs flex items-center justify-between">
                <div>
                  <span className="font-semibold text-white block">Tab Stagger Delay</span>
                  <span className="text-gray-400 text-[11px]">Prevents browser crashes when opening dozens of tabs</span>
                </div>
                <select
                  value={delayBetweenTabs}
                  onChange={(e) => setDelayBetweenTabs(Number(e.target.value))}
                  className="bg-gray-800 border border-gray-600 text-white rounded px-2 py-1 text-xs focus:ring-0"
                >
                  <option value={0}>0ms (Instant / All at once)</option>
                  <option value={100}>100ms (Fast)</option>
                  <option value={200}>200ms (Recommended)</option>
                  <option value={500}>500ms (Safe)</option>
                </select>
              </div>
            </div>
          </div>

          {/* PRIMARY BUTTONS: OPEN ALL & RESET */}
          <div className="pt-3 border-t border-gray-700 space-y-2">
            <button
              onClick={handleOpenSelected}
              disabled={isOpening || itemsState.length === 0}
              className={`w-full py-3 px-4 rounded-xl font-bold text-white text-base shadow-xl flex items-center justify-center gap-2 transition-all duration-200 ${
                isOpening
                  ? 'bg-blue-700 cursor-wait'
                  : itemsState.length === 0
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.99] shadow-blue-500/25'
              }`}
            >
              <PlayIcon className="w-5 h-5" />
              <span>Open List of URLs by just one click</span>
              <span className="text-xs px-2 py-0.5 bg-black/30 rounded border border-white/20 font-mono font-normal">
                [Ctrl+Enter]
              </span>
            </button>

            <div className="flex gap-2">
              <button
                onClick={handleReset}
                className="flex-1 py-2 px-3 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-gray-600"
                title="Clear input and reset all tabs [Ctrl+R]"
              >
                <ArrowPathIcon className="w-4 h-4 text-yellow-400" />
                <span>Reset</span>
                <span className="font-mono text-[10px] text-gray-400">[Ctrl+R]</span>
              </button>

              {isOpening && (
                <button
                  onClick={() => { abortOpeningRef.current = true; }}
                  className="py-2 px-4 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                >
                  <StopIcon className="w-4 h-4" />
                  <span>Stop</span>
                </button>
              )}

              <button
                onClick={handleCopyAll}
                disabled={itemsState.length === 0}
                className="py-2 px-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors border border-gray-700"
                title="Copy all prepared URLs"
              >
                <ClipboardIcon className="w-3.5 h-3.5" />
                <span>Copy URLs</span>
              </button>

              <button
                onClick={handleExportTxt}
                disabled={itemsState.length === 0}
                className="py-2 px-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors border border-gray-700"
                title="Export URLs to .txt file"
              >
                <DocumentArrowUpIcon className="w-3.5 h-3.5" />
                <span>Export</span>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: PREPARED URL LIST & STATUS */}
        <div className="lg:col-span-7 bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl shadow-2xl flex flex-col h-[700px] overflow-hidden">
          {/* HEADER */}
          <div className="p-4 border-b border-gray-700 bg-gray-850/70 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Prepared URLs ({itemsState.length})
                <span className="text-xs px-2 py-0.5 rounded font-normal bg-green-950 text-green-300 border border-green-700/60">
                  Deduplicated & Cleaned
                </span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {selectedIds.size} of {itemsState.length} selected to open
              </p>
            </div>

            {/* SEARCH & FILTERS */}
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search domain..."
                className="bg-gray-900 border border-gray-700 text-xs text-gray-200 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 w-36"
              />

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="bg-gray-900 border border-gray-700 text-xs text-gray-300 rounded px-2 py-1.5 focus:ring-0"
              >
                <option value="all">All Status</option>
                <option value="ready">Ready</option>
                <option value="opened">Opened</option>
                <option value="blocked">Blocked</option>
              </select>

              <button
                onClick={toggleSelectAll}
                className="text-xs px-2.5 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors font-medium"
              >
                {selectedIds.size === itemsState.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
          </div>

          {/* URL LIST ITEMS */}
          <div className="flex-grow overflow-y-auto p-3 space-y-2 custom-scrollbar bg-gray-900/30">
            {filteredList.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-gray-400">
                <GlobeAltIcon className="w-12 h-12 text-gray-600 mb-3" />
                <h4 className="text-sm font-semibold text-gray-300 mb-1">No URLs to display</h4>
                <p className="text-xs text-gray-500 max-w-sm">
                  Paste emails or website domains into the left box, or click <strong>Load Sample</strong> to see the auto-conversion in action.
                </p>
              </div>
            ) : (
              filteredList.map((item) => {
                const isSelected = selectedIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`p-2.5 rounded-lg border transition-all flex items-center justify-between gap-3 ${
                      item.status === 'opened'
                        ? 'bg-green-950/20 border-green-800/40'
                        : item.status === 'blocked'
                        ? 'bg-red-950/30 border-red-800/50'
                        : isSelected
                        ? 'bg-gray-800/90 border-blue-600/60'
                        : 'bg-gray-900/50 border-gray-800 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectOne(item.id)}
                        className="rounded bg-gray-800 border-gray-700 text-blue-600 focus:ring-0 w-4 h-4 cursor-pointer"
                      />

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-semibold text-blue-400 hover:text-blue-300 truncate hover:underline"
                            title={`Open ${item.url}`}
                          >
                            {item.url}
                          </a>

                          {item.isEmail && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300 font-mono flex-shrink-0">
                              from email
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-gray-400 truncate flex items-center gap-1 mt-0.5">
                          <span>Domain: <strong>{item.domain}</strong></span>
                          {item.original !== item.url && (
                            <span className="text-gray-500">| Source: {item.original}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {item.status === 'opened' && (
                        <span className="flex items-center text-[11px] text-green-400 font-medium gap-1 bg-green-950/60 px-2 py-0.5 rounded border border-green-800/60">
                          <CheckIcon className="w-3 h-3" /> Opened
                        </span>
                      )}

                      {item.status === 'blocked' && (
                        <span className="flex items-center text-[11px] text-red-400 font-medium gap-1 bg-red-950/60 px-2 py-0.5 rounded border border-red-800/60">
                          <XCircleIcon className="w-3 h-3" /> Blocked
                        </span>
                      )}

                      <button
                        onClick={() => handleOpenOne(item)}
                        className="px-2.5 py-1 text-xs font-semibold rounded bg-blue-600/80 hover:bg-blue-600 text-white transition-colors"
                        title="Open this single URL in new tab"
                      >
                        Open Tab
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* FOOTER STATS */}
          <div className="p-3 border-t border-gray-700 bg-gray-900/80 flex items-center justify-between text-xs text-gray-400">
            <span>
              Showing {filteredList.length} of {itemsState.length} unique URLs
            </span>
            <span>
              Opened: <strong className="text-green-400">{itemsState.filter(it => it.status === 'opened').length}</strong> | 
              Ready: <strong className="text-gray-200">{itemsState.filter(it => it.status === 'ready').length}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BulkUrlOpener;
