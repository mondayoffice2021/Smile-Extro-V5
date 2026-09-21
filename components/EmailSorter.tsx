
import React, { useState, useRef } from 'react';
import { identifyCountriesForDomains, identifyUnknownDomainsDeeply, type CountryResolutionItem } from '../services/geminiService';
import { classifyCountryOffline } from '../services/offlineClassifier';
import { extractEmailsFromFile } from '../services/fileService';
import { getCountryFlag } from '../services/countryDetector';
import { 
  filterBusinessEmailsBulk, 
  DEFAULT_BUSINESS_FILTER_OPTIONS, 
  type BusinessFilterOptions, 
  type BusinessBatchFilterSummary 
} from '../services/businessEmailFilter';
import DocumentArrowUpIcon from './icons/DocumentArrowUpIcon';
import ArrowPathIcon from './icons/ArrowPathIcon';
import FolderOpenIcon from './icons/FolderOpenIcon';
import PauseIcon from './icons/PauseIcon';
import PlayIcon from './icons/PlayIcon';
import StopIcon from './icons/StopIcon';
import ShieldCheckIcon from './icons/ShieldCheckIcon';
import FunnelIcon from './icons/FunnelIcon';
import XCircleIcon from './icons/XCircleIcon';
import CheckIcon from './icons/CheckIcon';
import GlobeAltIcon from './icons/GlobeAltIcon';
import MagnifyingGlassIcon from './icons/MagnifyingGlassIcon';
import JSZip from 'jszip';
import ToggleSwitch from './ToggleSwitch';
import { useActiveWakeLock } from '../hooks/useWakeLock';

interface EmailSorterProps {
  showToast: (msg: string) => void;
}

interface SortedGroup {
  country: string;
  emails: string[];
}

const EmailSorter: React.FC<EmailSorterProps> = ({ showToast }) => {
  const [inputText, setInputText] = useState('');
  const [sortedResults, setSortedResults] = useState<SortedGroup[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Keep screen awake while country sorting and business filtering are in progress
  useActiveWakeLock(isProcessing, 'Country Sorter: Sorting & Filtering');
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [statusText, setStatusText] = useState<string>('Initializing...');
  const [largeFileMode, setLargeFileMode] = useState(false);
  const [useOfflineMode, setUseOfflineMode] = useState(false);
  
  // Deep country resolution states (.com, contact page crawling & search engine grounding)
  const [enableDeepResolution, setEnableDeepResolution] = useState<boolean>(true);
  const [domainAuditMap, setDomainAuditMap] = useState<Map<string, CountryResolutionItem>>(new Map());
  const [showAuditModal, setShowAuditModal] = useState<boolean>(false);
  const [auditSearchQuery, setAuditSearchQuery] = useState<string>('');
  const [selectedCountryAudit, setSelectedCountryAudit] = useState<string>('all');
  
  // Business relevance filter states
  const [enableBusinessFilter, setEnableBusinessFilter] = useState<boolean>(true);
  const [filterOptions, setFilterOptions] = useState<BusinessFilterOptions>(DEFAULT_BUSINESS_FILTER_OPTIONS);
  const [showFilterSettings, setShowFilterSettings] = useState<boolean>(false);
  const [filterSummary, setFilterSummary] = useState<BusinessBatchFilterSummary | null>(null);
  const [showExcludedModal, setShowExcludedModal] = useState<boolean>(false);
  const [excludedCategoryFilter, setExcludedCategoryFilter] = useState<string>('all');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rawFileContent = useRef<string | null>(null);
  const controlRef = useRef({ shouldStop: false, isPaused: false });

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setIsProcessing(true);
      setStatusText("Reading file...");
      try {
        const emails = await extractEmailsFromFile(file);
        if (emails.length === 0) {
          showToast("No emails found in the file.");
        } else {
          // 1MB threshold for "Large File Mode"
          const isLarge = file.size > 1024 * 1024 || emails.length > 5000; 
          setLargeFileMode(isLarge);

          if (isLarge) {
              rawFileContent.current = emails.join('\n');
              setInputText(`[LARGE FILE LOADED]\nName: ${file.name}\nEmails found: ${emails.length}\nSize: ${(file.size / 1024 / 1024).toFixed(2)} MB\n\nContent hidden for performance. Ready to process.`);
          } else {
              rawFileContent.current = null;
              setInputText(emails.join('\n'));
          }
          showToast(`${emails.length} emails loaded successfully.`);
        }
      } catch (err: any) {
        showToast(err.message || "Error loading file.");
      } finally {
        setIsProcessing(false);
        setStatusText("Idle");
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportGroup = (group: SortedGroup) => {
    const dateStr = new Date().toISOString().split('T')[0];
    const safeCountry = group.country.replace(/[^a-z0-9]/gi, '_');
    const filename = `${safeCountry}_${dateStr}.txt`;
    const content = group.emails.join('\n');
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    downloadBlob(blob, filename);
  };

  const handleExportZip = async () => {
    if (sortedResults.length === 0) return;
    
    try {
        const zip = new JSZip();
        const dateStr = new Date().toISOString().split('T')[0];
        const folderName = `Country_Sorted_${dateStr}`;
        const folder = zip.folder(folderName);

        if (!folder) {
            showToast("Failed to create zip folder.");
            return;
        }

        sortedResults.forEach(group => {
            const safeCountry = group.country.replace(/[^a-z0-9]/gi, '_');
            const filename = `${safeCountry}_${dateStr}.txt`;
            const content = group.emails.join('\n');
            folder.file(filename, content);
        });

        // Add Country Detection Audit Report if available
        if (domainAuditMap.size > 0) {
            const auditReport = [
              `# COUNTRY DETECTION & RESOLUTION AUDIT REPORT`,
              `# Exported: ${new Date().toISOString()}`,
              `# Total Domains Classified: ${domainAuditMap.size}`,
              `# Deep Search & Website Contact Crawling: ${enableDeepResolution ? 'Enabled' : 'Disabled'}`,
              '',
              `Domain\tCountry\tConfidence\tMethod\tEvidence`,
              ...Array.from<CountryResolutionItem>(domainAuditMap.values()).map((item: CountryResolutionItem) => 
                `${item.domain}\t${item.country}\t${item.confidence || 0}%\t${item.method || 'unknown'}\t${item.evidence || ''}`
              )
            ].join('\n');
            folder.file(`_COUNTRY_DETECTION_REPORT_${dateStr}.txt`, auditReport);
        }

        if (filterSummary && filterSummary.excludedEmails.length > 0) {
            const excludedContent = [
              `# EXCLUDED NON-BUSINESS EMAILS (${filterSummary.excludedEmails.length} total)`,
              `# Exported: ${new Date().toISOString()}`,
              `# Counts: Bank: ${filterSummary.counts.bank} | Gov: ${filterSummary.counts.government} | Edu: ${filterSummary.counts.education} | News: ${filterSummary.counts.news} | Webmaster/Bots: ${filterSummary.counts.webmaster_bot}`,
              '',
              ...filterSummary.excludedEmails.map(item => `${item.email}\t[${item.category.toUpperCase()}]\t${item.reason || ''}`)
            ].join('\n');
            folder.file(`_EXCLUDED_NON_BUSINESS_EMAILS_${dateStr}.txt`, excludedContent);
        }

        const content = await zip.generateAsync({ type: "blob" });
        downloadBlob(content, `${folderName}.zip`);
        showToast("Downloaded all files as ZIP (clean business emails + audit report).");

    } catch (e) {
        console.error("Zip generation failed", e);
        showToast("Failed to generate ZIP file.");
    }
  };

  const handleExportAuditTxt = () => {
    if (domainAuditMap.size === 0) {
      showToast("No domain audit records available yet.");
      return;
    }
    const dateStr = new Date().toISOString().split('T')[0];
    const auditContent = [
      `# COUNTRY DETECTION & RESOLUTION AUDIT REPORT`,
      `# Date: ${dateStr}`,
      `# Total Domains Classified: ${domainAuditMap.size}`,
      `# Deep Search & Contact Crawling Mode: ${enableDeepResolution ? 'Enabled' : 'Disabled'}`,
      '',
      `Domain\tCountry\tConfidence\tMethod\tEvidence`,
      ...Array.from<CountryResolutionItem>(domainAuditMap.values()).map((item: CountryResolutionItem) => 
        `${item.domain}\t${item.country}\t${item.confidence || 0}%\t${item.method || 'unknown'}\t${item.evidence || ''}`
      )
    ].join('\n');
    const blob = new Blob([auditContent], { type: 'text/plain;charset=utf-8;' });
    downloadBlob(blob, `country_detection_audit_${dateStr}.txt`);
    showToast("Downloaded country detection audit report.");
  };

  const handleExportExcludedTxt = () => {
    if (!filterSummary || filterSummary.excludedEmails.length === 0) return;
    const dateStr = new Date().toISOString().split('T')[0];
    const excludedContent = [
      `# EXCLUDED NON-BUSINESS EMAILS (${filterSummary.excludedEmails.length} total)`,
      `# Date: ${dateStr}`,
      `# Breakdown: Bank: ${filterSummary.counts.bank} | Gov: ${filterSummary.counts.government} | Edu: ${filterSummary.counts.education} | News: ${filterSummary.counts.news} | Webmaster/Bots: ${filterSummary.counts.webmaster_bot} | Public: ${filterSummary.counts.public_webmail}`,
      '',
      ...filterSummary.excludedEmails.map(item => `${item.email}\t[${item.category.toUpperCase()}]\t${item.reason || ''}`)
    ].join('\n');
    const blob = new Blob([excludedContent], { type: 'text/plain;charset=utf-8;' });
    downloadBlob(blob, `excluded_non_business_emails_${dateStr}.txt`);
    showToast("Downloaded excluded non-business list.");
  };

  const handleStop = () => {
    controlRef.current.shouldStop = true;
    controlRef.current.isPaused = false;
    setIsPaused(false);
    showToast("Stopping process...");
  };

  const handlePauseToggle = () => {
    const nextState = !isPaused;
    setIsPaused(nextState);
    controlRef.current.isPaused = nextState;
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (largeFileMode) {
          // If user edits manually in large mode, we reset large mode and use the input text
          setLargeFileMode(false);
          rawFileContent.current = null;
      }
      setInputText(e.target.value);
  };

  // Robust Retry with wider error catching
  const processBatchWithRetry = async <T,>(
      fn: () => Promise<T>,
      retries = 4,
      delayMs = 3000
  ): Promise<T | null> => {
      try {
          return await fn();
      } catch (error: any) {
          const msg = (error?.message || '').toLowerCase() + ' ' + JSON.stringify(error || '').toLowerCase();
          console.warn("API Error:", msg);
          
          const isRateLimit = msg.includes('429') || msg.includes('quota') || msg.includes('rate_limit') || msg.includes('exhausted') || msg.includes('resource_exhausted') || msg.includes('limit');
          const isServerError = msg.includes('500') || msg.includes('503') || msg.includes('unavailable') || msg.includes('server error');
          
          if (retries > 0 && (isRateLimit || isServerError)) {
              const waitTime = isRateLimit ? Math.max(delayMs * 3.5, 8000) : delayMs; 
              
              setStatusText(isRateLimit 
                ? `Quota limit reached (429). cooling down for ${Math.round(waitTime/1000)}s... Enable 'Offline Mode' or add your API key in settings if this persists.` 
                : `Temporary server issue. Retrying in ${Math.round(waitTime/1000)}s...`
              );
              
              await new Promise(res => setTimeout(res, waitTime));
              return processBatchWithRetry(fn, retries - 1, waitTime * 1.5);
          }
          console.error("Batch processing failed finally", error);
          return null;
      }
  };

  const processEmails = async () => {
    const contentToProcess = largeFileMode && rawFileContent.current ? rawFileContent.current : inputText;

    if (!contentToProcess.trim()) {
      showToast("Please enter emails to sort.");
      return;
    }

    controlRef.current = { shouldStop: false, isPaused: false };
    setIsPaused(false);
    setIsProcessing(true);
    setSortedResults([]);
    setStatusText('Preparing batch...');
    
    try {
      // 1. Parse Emails
      const rawEmails = contentToProcess.split(/[\s,;]+/).map(e => e.trim()).filter(e => e.includes('@'));
      const uniqueEmails: string[] = Array.from(new Set(rawEmails));
      
      if (uniqueEmails.length === 0) {
        showToast("No valid emails found in input.");
        setIsProcessing(false);
        return;
      }

      // 2. Business Relevance Filter (Remove Bank, Gov, Edu, News, Webmaster, Bot emails)
      let emailsToProcess = uniqueEmails;
      if (enableBusinessFilter) {
        setStatusText("Filtering out non-business emails (bank, gov, edu, news, webmasters)...");
        const summary = filterBusinessEmailsBulk(uniqueEmails, filterOptions);
        setFilterSummary(summary);
        emailsToProcess = summary.businessEmails;

        if (emailsToProcess.length === 0) {
          showToast(`All ${uniqueEmails.length} emails were identified as non-business (${summary.counts.bank} Bank, ${summary.counts.government} Gov, ${summary.counts.education} Edu, ${summary.counts.news} News, ${summary.counts.webmaster_bot} Webmasters). Check your filter settings.`);
          setIsProcessing(false);
          setStatusText('Idle');
          return;
        }
      } else {
        setFilterSummary(null);
      }

      const domainMap = new Map<string, string[]>();
      emailsToProcess.forEach((email) => {
        const domain = email.split('@')[1].toLowerCase();
        if (!domainMap.has(domain)) {
          domainMap.set(domain, []);
        }
        domainMap.get(domain)?.push(email);
      });

      const allDomains = Array.from(domainMap.keys());
      const totalDomains = allDomains.length;

      let currentResultsMap = new Map<string, string[]>(); 
      const currentAuditMap = new Map<string, CountryResolutionItem>();

      // --- STEP 1: Pre-classify country offline (Extremely Fast) ---
      setStatusText('Pre-classifying domains offline...');
      const unresolvedDomains: string[] = [];

      allDomains.forEach(domain => {
          const offlineCountry = classifyCountryOffline(domain);
          if (offlineCountry) {
              const emailsForDomain = domainMap.get(domain) || [];
              if (!currentResultsMap.has(offlineCountry)) {
                  currentResultsMap.set(offlineCountry, []);
              }
              currentResultsMap.get(offlineCountry)?.push(...emailsForDomain);
              currentAuditMap.set(domain, {
                  domain,
                  country: offlineCountry,
                  confidence: 98,
                  method: 'cctld',
                  evidence: `Matched ccTLD or global enterprise corporate registry (${offlineCountry})`,
                  flag: getCountryFlag(offlineCountry)
              });
          } else {
              unresolvedDomains.push(domain);
          }
      });

      setDomainAuditMap(new Map(currentAuditMap));

      // Update UI with initial offline-sorted results immediately
      const initialResults: SortedGroup[] = Array.from(currentResultsMap.entries())
          .map(([country, emails]) => ({ country, emails }))
          .sort((a, b) => b.emails.length - a.emails.length);
      setSortedResults(initialResults);

      if (unresolvedDomains.length === 0 || useOfflineMode || !enableDeepResolution) {
          // If there are no unresolved domains, or deep mode is disabled, resolve remaining as Unknown
          if (unresolvedDomains.length > 0) {
              unresolvedDomains.forEach(domain => {
                  const emailsForDomain = domainMap.get(domain) || [];
                  if (!currentResultsMap.has('Unknown')) {
                      currentResultsMap.set('Unknown', []);
                  }
                  currentResultsMap.get('Unknown')?.push(...emailsForDomain);
                  currentAuditMap.set(domain, {
                      domain,
                      country: 'Unknown',
                      confidence: 0,
                      method: 'unknown',
                      evidence: 'Generic domain extension (.com/.net/.org) without deep crawling enabled',
                      flag: '🌐'
                  });
              });

              setDomainAuditMap(new Map(currentAuditMap));
              const finalOfflineResults: SortedGroup[] = Array.from(currentResultsMap.entries())
                  .map(([country, emails]) => ({ country, emails }))
                  .sort((a, b) => b.emails.length - a.emails.length);
              setSortedResults(finalOfflineResults);
          }
          showToast(`Offline sorting complete! Processed ${uniqueEmails.length} emails instantly.`);
          setIsProcessing(false);
          setStatusText('Idle');
          return;
      }

      // --- STEP 2: Deep Domain Resolution (Crawls website contact pages & queries multi-engine search) ---
      const BATCH_SIZE = 20;
      const totalUnresolved = unresolvedDomains.length;

      for (let i = 0; i < totalUnresolved; i += BATCH_SIZE) {
        if (controlRef.current.shouldStop) break;

        while (controlRef.current.isPaused) {
          await new Promise(resolve => setTimeout(resolve, 300));
          if (controlRef.current.shouldStop) break;
        }
        if (controlRef.current.shouldStop) break;

        const batch = unresolvedDomains.slice(i, i + BATCH_SIZE);
        setProgress({ current: Math.min(i + BATCH_SIZE, totalUnresolved), total: totalUnresolved });
        
        const sampleText = batch.slice(0, 3).join(', ') + (batch.length > 3 ? ` +${batch.length - 3} more` : '');
        setStatusText(`Deep contact crawling & search grounding: ${sampleText}...`);
        
        const batchResults = new Map<string, string>();
        
        // Resolve remaining domains using deep website crawling and multi-engine search
        const identified = await processBatchWithRetry(() => 
          identifyCountriesForDomains(batch, { deepResolve: true })
        );
        
        if (identified) {
            identified.forEach(item => {
                currentAuditMap.set(item.domain.toLowerCase(), item);
                if (item.country && item.country !== 'Unknown') {
                    batchResults.set(item.domain.toLowerCase(), item.country);
                }
            });
            setDomainAuditMap(new Map(currentAuditMap));
        }
        
        // Fill in 'Unknown' or any identified country
        batch.forEach(domain => {
            const country = batchResults.get(domain) || 'Unknown';
            const emailsForDomain = domainMap.get(domain) || [];
            if (!currentResultsMap.has(country)) {
                currentResultsMap.set(country, []);
            }
            currentResultsMap.get(country)?.push(...emailsForDomain);

            if (!currentAuditMap.has(domain)) {
                currentAuditMap.set(domain, {
                    domain,
                    country,
                    confidence: country === 'Unknown' ? 0 : 80,
                    method: country === 'Unknown' ? 'unknown' : 'search_engine',
                    evidence: country === 'Unknown' ? 'No public address or headquarters found' : 'Resolved',
                    flag: getCountryFlag(country)
                });
            }
        });

        setDomainAuditMap(new Map(currentAuditMap));

        const partialResults: SortedGroup[] = Array.from(currentResultsMap.entries())
            .map(([country, emails]) => ({ country, emails }))
            .sort((a, b) => b.emails.length - a.emails.length);

        setSortedResults(partialResults);
      }

      if (controlRef.current.shouldStop) {
        showToast("Processing stopped by user.");
      } else {
        const filterMsg = enableBusinessFilter && filterSummary 
          ? ` (${filterSummary.excludedEmails.length} non-business excluded)` 
          : '';
        showToast(`Sorting complete! Processed ${emailsToProcess.length} business emails.${filterMsg}`);
      }

    } catch (error: any) {
      showToast("An error occurred. Check console.");
      console.error(error);
    } finally {
      setIsProcessing(false);
      setIsPaused(false);
      setProgress(null);
      setStatusText('Idle');
      controlRef.current.shouldStop = false;
      controlRef.current.isPaused = false;
    }
  };

  const visibleExcludedEmails = filterSummary 
    ? (excludedCategoryFilter === 'all' 
        ? filterSummary.excludedEmails 
        : filterSummary.excludedEmails.filter(e => e.category === excludedCategoryFilter))
    : [];

  const auditItems: CountryResolutionItem[] = Array.from(domainAuditMap.values());
  const filteredAuditList: CountryResolutionItem[] = auditItems.filter((item: CountryResolutionItem) => {
    if (selectedCountryAudit !== 'all' && item.country !== selectedCountryAudit) {
      return false;
    }
    if (!auditSearchQuery.trim()) return true;
    const q = auditSearchQuery.toLowerCase();
    return (
      item.domain.toLowerCase().includes(q) ||
      item.country.toLowerCase().includes(q) ||
      Boolean(item.evidence && item.evidence.toLowerCase().includes(q)) ||
      Boolean(item.method && item.method.toLowerCase().includes(q))
    );
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
      {/* LEFT PANEL */}
      <div className="lg:col-span-4 flex flex-col h-full space-y-4">
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl shadow-2xl p-6 flex-grow flex flex-col">
          <h2 className="text-2xl font-bold text-white mb-2">Input Emails</h2>

          {/* Business Relevance Filter Master Toggle */}
          <div className="mb-4 p-3 bg-blue-950/40 border border-blue-800/60 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheckIcon className="w-5 h-5 text-blue-400" />
                <span className="text-sm font-semibold text-white">Business Relevance Filter</span>
              </div>
              <ToggleSwitch 
                label="" 
                enabled={enableBusinessFilter} 
                onChange={setEnableBusinessFilter} 
                disabled={isProcessing}
              />
            </div>
            <p className="text-gray-300 text-xs mt-1.5 leading-relaxed">
              Strips out non-business addresses (<span className="text-yellow-400 font-medium">Bank</span>, <span className="text-emerald-400 font-medium">Gov</span>, <span className="text-indigo-400 font-medium">Edu</span>, <span className="text-pink-400 font-medium">News</span>, <span className="text-red-400 font-medium">Webmaster/Bots</span>) so only genuine commercial leads are sorted.
            </p>

            {enableBusinessFilter && (
              <div className="mt-2.5 pt-2.5 border-t border-blue-900/60">
                <button
                  type="button"
                  onClick={() => setShowFilterSettings(!showFilterSettings)}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium transition-colors"
                >
                  <FunnelIcon className="w-3.5 h-3.5" />
                  {showFilterSettings ? "Hide Filter Options" : "Customize Excluded Categories"}
                </button>

                {showFilterSettings && (
                  <div className="mt-2.5 space-y-2 bg-gray-900/80 p-2.5 rounded border border-gray-700 text-xs">
                    <label className="flex items-center justify-between text-gray-300 cursor-pointer">
                      <span className="flex items-center gap-1.5">
                        <span>🏦</span> Exclude Banks & Financial
                      </span>
                      <input 
                        type="checkbox" 
                        checked={filterOptions.filterBank} 
                        onChange={(e) => setFilterOptions({...filterOptions, filterBank: e.target.checked})}
                        className="rounded bg-gray-800 border-gray-700 text-blue-600 focus:ring-0"
                      />
                    </label>

                    <label className="flex items-center justify-between text-gray-300 cursor-pointer">
                      <span className="flex items-center gap-1.5">
                        <span>🏛️</span> Exclude Government & Military (.gov)
                      </span>
                      <input 
                        type="checkbox" 
                        checked={filterOptions.filterGovernment} 
                        onChange={(e) => setFilterOptions({...filterOptions, filterGovernment: e.target.checked})}
                        className="rounded bg-gray-800 border-gray-700 text-blue-600 focus:ring-0"
                      />
                    </label>

                    <label className="flex items-center justify-between text-gray-300 cursor-pointer">
                      <span className="flex items-center gap-1.5">
                        <span>🎓</span> Exclude Education (.edu, .ac)
                      </span>
                      <input 
                        type="checkbox" 
                        checked={filterOptions.filterEducation} 
                        onChange={(e) => setFilterOptions({...filterOptions, filterEducation: e.target.checked})}
                        className="rounded bg-gray-800 border-gray-700 text-blue-600 focus:ring-0"
                      />
                    </label>

                    <label className="flex items-center justify-between text-gray-300 cursor-pointer">
                      <span className="flex items-center gap-1.5">
                        <span>📰</span> Exclude News & Media (Reuters, CNN, etc.)
                      </span>
                      <input 
                        type="checkbox" 
                        checked={filterOptions.filterNews} 
                        onChange={(e) => setFilterOptions({...filterOptions, filterNews: e.target.checked})}
                        className="rounded bg-gray-800 border-gray-700 text-blue-600 focus:ring-0"
                      />
                    </label>

                    <label className="flex items-center justify-between text-gray-300 cursor-pointer">
                      <span className="flex items-center gap-1.5">
                        <span>🤖</span> Exclude Webmasters, Noreply & Bots
                      </span>
                      <input 
                        type="checkbox" 
                        checked={filterOptions.filterWebmasterBot} 
                        onChange={(e) => setFilterOptions({...filterOptions, filterWebmasterBot: e.target.checked})}
                        className="rounded bg-gray-800 border-gray-700 text-blue-600 focus:ring-0"
                      />
                    </label>

                    <label className="flex items-center justify-between text-gray-300 cursor-pointer">
                      <span className="flex items-center gap-1.5">
                        <span>🌐</span> Exclude Consumer Webmail (Gmail/Yahoo)
                      </span>
                      <input 
                        type="checkbox" 
                        checked={filterOptions.filterPublicWebmail} 
                        onChange={(e) => setFilterOptions({...filterOptions, filterPublicWebmail: e.target.checked})}
                        className="rounded bg-gray-800 border-gray-700 text-blue-600 focus:ring-0"
                      />
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
          
          <div className="mb-4 p-3.5 bg-gradient-to-br from-indigo-950/50 to-blue-950/30 border border-indigo-700/60 rounded-xl shadow-inner">
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                     <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center">
                        <GlobeAltIcon className="w-4 h-4 text-indigo-300" />
                     </div>
                     <div>
                        <span className="text-sm font-semibold text-white block">Deep Country Classifier</span>
                        <span className="text-[11px] text-indigo-300">For .com & generic extensions</span>
                     </div>
                  </div>
                  <ToggleSwitch 
                     label="" 
                     enabled={enableDeepResolution} 
                     onChange={setEnableDeepResolution} 
                     disabled={isProcessing}
                  />
               </div>
               <p className="text-gray-300 text-xs mt-2.5 leading-relaxed">
                  {enableDeepResolution 
                     ? "Active: Crawls live website contact & impressum pages, parses Schema.org addresses & phone codes, and grounds on search engine headquarters snippets." 
                     : "Fast mode: Restricted to ccTLD extensions (.de, .fr, .uk) and built-in enterprise database only."}
               </p>
          </div>
          
          <textarea
            value={inputText}
            onChange={handleTextChange}
            placeholder="alice@company.fr&#10;bob@startup.io&#10;charlie@enterprise.com&#10;webmaster@test.com (will be filtered)&#10;info@cityhall.gov (will be filtered)"
            className={`flex-grow w-full p-4 bg-gray-900/50 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm font-mono text-gray-300 custom-scrollbar mb-4 ${largeFileMode ? 'opacity-70' : ''}`}
            disabled={isProcessing || largeFileMode}
            readOnly={largeFileMode}
          />
          
          <div className="flex gap-3">
             {isProcessing ? (
                 <>
                    <button
                        onClick={handlePauseToggle}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex-1 shadow-lg flex items-center justify-center border ${
                            isPaused 
                            ? 'bg-green-600 hover:bg-green-700 text-white border-green-500' 
                            : 'bg-yellow-600 hover:bg-yellow-700 text-white border-yellow-500'
                        }`}
                    >
                        {isPaused ? <><PlayIcon className="w-4 h-4 mr-2" /> Resume</> : <><PauseIcon className="w-4 h-4 mr-2" /> Pause</>}
                    </button>
                    <button
                        onClick={handleStop}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold transition-all flex-1 shadow-lg flex items-center justify-center border border-red-500"
                    >
                        <StopIcon className="w-4 h-4 mr-2" /> Stop
                    </button>
                 </>
             ) : (
                 <>
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center flex-1 border border-gray-600"
                    >
                    <DocumentArrowUpIcon className="w-4 h-4 mr-2" /> Load List
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".txt,.csv,.xlsx,.xls" className="hidden" />
                    
                    <button
                        onClick={processEmails}
                        disabled={!inputText.trim()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all flex-1 shadow-lg shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                    Start Sorting
                    </button>
                 </>
             )}
          </div>
          
          {isProcessing && progress && (
            <div className={`mt-4 bg-gray-700/30 rounded-lg p-3 border border-gray-700 transition-opacity ${isPaused ? 'opacity-70' : 'opacity-100'}`}>
               <div className="flex justify-between text-xs text-blue-300 mb-1">
                 <span>{isPaused ? 'Paused' : statusText}</span>
                 <span>{Math.round((progress.current / progress.total) * 100)}%</span>
               </div>
               <div className="w-full bg-gray-700 rounded-full h-2">
                 <div 
                    className={`h-2 rounded-full transition-all duration-500 ${isPaused ? 'bg-yellow-500' : 'bg-blue-500'}`}
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                 ></div>
               </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: RESULTS */}
      <div className="lg:col-span-8 flex flex-col h-full">
         <div className="bg-gray-800/40 backdrop-blur-md border border-gray-700 rounded-xl shadow-2xl flex flex-col h-[80vh]">
            <div className="p-5 border-b border-gray-700/50 bg-gray-800/30 flex flex-wrap justify-between items-center gap-3">
               <div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    Categorized Results
                    {filterSummary && (
                      <span className="px-2 py-0.5 text-xs font-semibold bg-blue-900/60 text-blue-300 border border-blue-700 rounded-full">
                        Business Cleaned
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">
                     {sortedResults.length > 0 
                        ? `${sortedResults.reduce((acc, g) => acc + g.emails.length, 0)} business emails sorted into ${sortedResults.length} locations` 
                        : "Results will appear here dynamically"}
                  </p>
               </div>
               
               <div className="flex items-center gap-2">
                 {domainAuditMap.size > 0 && (
                   <>
                     <button
                       onClick={() => {
                         setSelectedCountryAudit('all');
                         setShowAuditModal(true);
                       }}
                       className="flex items-center px-3 py-2 text-xs font-medium rounded-md bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 border border-indigo-700/60 transition-all duration-200 shadow-sm"
                       title="View exact evidence, search engine groundings, and contact page scrapes for each domain"
                     >
                       <MagnifyingGlassIcon className="w-4 h-4 mr-1.5 text-indigo-400" />
                       Audit ({domainAuditMap.size})
                     </button>
                     <button
                       onClick={handleExportAuditTxt}
                       className="flex items-center px-2.5 py-2 text-xs font-medium rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600 transition-all"
                       title="Download country detection audit report as .txt"
                     >
                       <DocumentArrowUpIcon className="w-3.5 h-3.5 mr-1" />
                       Audit (.txt)
                     </button>
                   </>
                 )}

                 {filterSummary && filterSummary.excludedEmails.length > 0 && (
                   <>
                     <button
                       onClick={() => setShowExcludedModal(true)}
                       className="flex items-center px-3 py-2 text-xs font-medium rounded-md bg-gray-700 hover:bg-gray-600 text-yellow-300 border border-yellow-600/40 transition-all duration-200"
                     >
                       <XCircleIcon className="w-4 h-4 mr-1.5 text-yellow-400" />
                       View Excluded ({filterSummary.excludedEmails.length})
                     </button>
                     <button
                       onClick={handleExportExcludedTxt}
                       className="flex items-center px-2.5 py-2 text-xs font-medium rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600 transition-all"
                       title="Download excluded non-business emails as .txt"
                     >
                       <DocumentArrowUpIcon className="w-3.5 h-3.5 mr-1" />
                       Export Excluded (.txt)
                     </button>
                   </>
                 )}

                 {sortedResults.length > 0 && (
                     <button 
                        onClick={handleExportZip}
                        className="flex items-center px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-md bg-green-600/80 hover:bg-green-600 text-white transition-all duration-200 shadow-lg"
                     >
                        <FolderOpenIcon className="w-4 h-4 mr-1.5" /> Export All (ZIP)
                     </button>
                 )}
               </div>
            </div>

            {/* Filter Summary Banner */}
            {filterSummary && (
              <div className="bg-gray-900/70 border-b border-gray-700/60 px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-green-400 font-semibold flex items-center gap-1">
                    <CheckIcon className="w-3.5 h-3.5" /> {filterSummary.counts.business} Business Retained
                  </span>
                  <span className="text-gray-500">|</span>
                  <span className="text-yellow-400 font-medium">
                    {filterSummary.excludedEmails.length} Non-Business Excluded:
                  </span>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {filterSummary.counts.bank > 0 && (
                      <span className="px-1.5 py-0.5 bg-yellow-950/60 text-yellow-300 border border-yellow-800/60 rounded">
                        🏦 {filterSummary.counts.bank} Bank
                      </span>
                    )}
                    {filterSummary.counts.government > 0 && (
                      <span className="px-1.5 py-0.5 bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 rounded">
                        🏛️ {filterSummary.counts.government} Gov
                      </span>
                    )}
                    {filterSummary.counts.education > 0 && (
                      <span className="px-1.5 py-0.5 bg-indigo-950/60 text-indigo-300 border border-indigo-800/60 rounded">
                        🎓 {filterSummary.counts.education} Edu
                      </span>
                    )}
                    {filterSummary.counts.news > 0 && (
                      <span className="px-1.5 py-0.5 bg-pink-950/60 text-pink-300 border border-pink-800/60 rounded">
                        📰 {filterSummary.counts.news} News
                      </span>
                    )}
                    {filterSummary.counts.webmaster_bot > 0 && (
                      <span className="px-1.5 py-0.5 bg-red-950/60 text-red-300 border border-red-800/60 rounded">
                        🤖 {filterSummary.counts.webmaster_bot} Webmaster/Bots
                      </span>
                    )}
                    {filterSummary.counts.public_webmail > 0 && (
                      <span className="px-1.5 py-0.5 bg-blue-950/60 text-blue-300 border border-blue-800/60 rounded">
                        🌐 {filterSummary.counts.public_webmail} Public Webmail
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setShowExcludedModal(true)}
                  className="text-blue-400 hover:text-blue-300 underline font-medium"
                >
                  Review exclusions
                </button>
              </div>
            )}

            <div className="flex-grow overflow-y-auto p-4 custom-scrollbar space-y-4 bg-gray-900/20">
               {sortedResults.length === 0 && !isProcessing ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 opacity-60">
                     <ArrowPathIcon className="w-12 h-12 mb-3" />
                     <p>Enter emails to see country breakdown</p>
                  </div>
               ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     {sortedResults.map((group) => (
                        <div key={group.country} className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors animate-fade-in">
                           <div className="flex justify-between items-start mb-3">
                              <div className="flex items-center">
                                 <span className="text-2xl mr-2.5 select-none" role="img" aria-label="flag">
                                    {getCountryFlag(group.country)}
                                 </span>
                                 <div>
                                    <h3 className="font-bold text-white text-sm flex items-center gap-1.5">
                                      {group.country}
                                    </h3>
                                    <span className="text-xs text-gray-400">{group.emails.length} emails</span>
                                 </div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                 {domainAuditMap.size > 0 && (
                                   <button
                                      onClick={() => {
                                        setSelectedCountryAudit(group.country);
                                        setShowAuditModal(true);
                                      }}
                                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-gray-800 hover:bg-indigo-900/70 text-indigo-300 border border-gray-700 rounded transition-all"
                                      title={`Inspect evidence for ${group.country}`}
                                   >
                                      <MagnifyingGlassIcon className="w-3 h-3 text-indigo-400" /> Evidence
                                   </button>
                                 )}
                                 <button 
                                    onClick={() => handleExportGroup(group)}
                                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-gray-700 hover:bg-blue-600 text-gray-300 hover:text-white rounded transition-all"
                                 >
                                    <DocumentArrowUpIcon className="w-3 h-3" /> Export
                                 </button>
                              </div>
                           </div>
                           <div className="bg-gray-900/50 rounded p-2 max-h-48 overflow-y-auto custom-scrollbar">
                              {group.emails.map((email, idx) => (
                                 <div key={`${email}-${idx}`} className="text-xs text-gray-300 font-mono py-0.5 truncate border-b border-gray-800 last:border-0">
                                    {email}
                                 </div>
                              ))}
                           </div>
                        </div>
                     ))}
                  </div>
               )}
            </div>
         </div>
      </div>

      {/* EXCLUDED EMAILS AUDIT MODAL */}
      {showExcludedModal && filterSummary && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-850">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <XCircleIcon className="w-5 h-5 text-yellow-400" />
                  Excluded Non-Business Contacts ({filterSummary.excludedEmails.length})
                </h3>
                <p className="text-xs text-gray-400">
                  These emails were removed from country sorting to keep your lead lists purely commercial.
                </p>
              </div>
              <button 
                onClick={() => setShowExcludedModal(false)}
                className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded bg-gray-800 hover:bg-gray-700"
              >
                ✕ Close
              </button>
            </div>

            {/* Category Filter Pills */}
            <div className="px-4 py-3 bg-gray-950/80 border-b border-gray-800 flex flex-wrap gap-2 text-xs">
              <button
                onClick={() => setExcludedCategoryFilter('all')}
                className={`px-2.5 py-1 rounded-full font-medium transition-colors ${
                  excludedCategoryFilter === 'all' 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                All ({filterSummary.excludedEmails.length})
              </button>

              {filterSummary.counts.bank > 0 && (
                <button
                  onClick={() => setExcludedCategoryFilter('bank')}
                  className={`px-2.5 py-1 rounded-full font-medium transition-colors ${
                    excludedCategoryFilter === 'bank' 
                      ? 'bg-yellow-600 text-white' 
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  🏦 Bank ({filterSummary.counts.bank})
                </button>
              )}

              {filterSummary.counts.government > 0 && (
                <button
                  onClick={() => setExcludedCategoryFilter('government')}
                  className={`px-2.5 py-1 rounded-full font-medium transition-colors ${
                    excludedCategoryFilter === 'government' 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  🏛️ Gov ({filterSummary.counts.government})
                </button>
              )}

              {filterSummary.counts.education > 0 && (
                <button
                  onClick={() => setExcludedCategoryFilter('education')}
                  className={`px-2.5 py-1 rounded-full font-medium transition-colors ${
                    excludedCategoryFilter === 'education' 
                      ? 'bg-indigo-600 text-white' 
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  🎓 Edu ({filterSummary.counts.education})
                </button>
              )}

              {filterSummary.counts.news > 0 && (
                <button
                  onClick={() => setExcludedCategoryFilter('news')}
                  className={`px-2.5 py-1 rounded-full font-medium transition-colors ${
                    excludedCategoryFilter === 'news' 
                      ? 'bg-pink-600 text-white' 
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  📰 News ({filterSummary.counts.news})
                </button>
              )}

              {filterSummary.counts.webmaster_bot > 0 && (
                <button
                  onClick={() => setExcludedCategoryFilter('webmaster_bot')}
                  className={`px-2.5 py-1 rounded-full font-medium transition-colors ${
                    excludedCategoryFilter === 'webmaster_bot' 
                      ? 'bg-red-600 text-white' 
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  🤖 Webmaster/Bots ({filterSummary.counts.webmaster_bot})
                </button>
              )}
            </div>

            {/* List */}
            <div className="flex-grow overflow-y-auto p-4 custom-scrollbar space-y-2">
              {visibleExcludedEmails.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No emails found in this category.</p>
              ) : (
                <div className="divide-y divide-gray-800">
                  {visibleExcludedEmails.map((item, idx) => (
                    <div key={`${item.email}-${idx}`} className="py-2.5 flex items-center justify-between text-xs font-mono">
                      <span className="text-gray-200 select-all">{item.email}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 text-[11px]">{item.reason}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                          item.category === 'bank' ? 'bg-yellow-900/60 text-yellow-300' :
                          item.category === 'government' ? 'bg-emerald-900/60 text-emerald-300' :
                          item.category === 'education' ? 'bg-indigo-900/60 text-indigo-300' :
                          item.category === 'news' ? 'bg-pink-900/60 text-pink-300' :
                          'bg-red-900/60 text-red-300'
                        }`}>
                          {item.category.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-800 bg-gray-950 flex justify-between items-center">
              <span className="text-xs text-gray-400">
                Showing {visibleExcludedEmails.length} of {filterSummary.excludedEmails.length} items
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleExportExcludedTxt}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium flex items-center gap-1.5"
                >
                  <DocumentArrowUpIcon className="w-3.5 h-3.5" />
                  Download Excluded (.txt)
                </button>
                <button
                  onClick={() => setShowExcludedModal(false)}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* COUNTRY DETECTION AUDIT & EVIDENCE MODAL */}
      {showAuditModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-indigo-700/60 rounded-xl shadow-2xl max-w-4xl w-full max-h-[88vh] flex flex-col overflow-hidden animate-fade-in">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-850">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <GlobeAltIcon className="w-5 h-5 text-indigo-400" />
                  Country Detection & Evidence Audit
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-700 font-semibold">
                    {domainAuditMap.size} domains classified
                  </span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Full intelligence trace: website /contact & impressum scrapes, phone dialing codes, Schema.org addresses, and search engine headquarters groundings.
                </p>
              </div>
              <button 
                onClick={() => setShowAuditModal(false)}
                className="text-gray-400 hover:text-white text-sm px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 transition-colors"
              >
                ✕ Close
              </button>
            </div>

            {/* Filter and Search Bar */}
            <div className="p-3 bg-gray-950/80 border-b border-gray-800 flex flex-wrap gap-3 items-center justify-between">
              <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                <div className="relative w-full">
                  <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search by domain, country, or evidence text..."
                    value={auditSearchQuery}
                    onChange={(e) => setAuditSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Country Filter Selector */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400">Filter Location:</label>
                <select
                  value={selectedCountryAudit}
                  onChange={(e) => setSelectedCountryAudit(e.target.value)}
                  className="bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="all">All Countries ({domainAuditMap.size})</option>
                  {sortedResults.map(g => (
                    <option key={g.country} value={g.country}>
                      {getCountryFlag(g.country)} {g.country} ({g.emails.length})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Audit List */}
            <div className="flex-grow overflow-y-auto p-4 custom-scrollbar space-y-2.5 bg-gray-950/30">
              {filteredAuditList.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-xs">
                  No domain records match your filter criteria.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredAuditList.map((item: CountryResolutionItem) => (
                    <div 
                      key={item.domain}
                      className="bg-gray-850/80 border border-gray-800 hover:border-gray-700 rounded-lg p-3 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-[210px]">
                        <span className="text-2xl select-none" role="img" aria-label="flag">
                          {item.flag || getCountryFlag(item.country)}
                        </span>
                        <div>
                          <span className="font-mono text-xs font-bold text-white block select-all">
                            {item.domain}
                          </span>
                          <span className="text-xs text-indigo-300 font-medium">
                            {item.country}
                          </span>
                        </div>
                      </div>

                      <div className="flex-1 text-xs bg-gray-900/70 rounded p-2.5 border border-gray-800">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                            item.method === 'contact_page' ? 'bg-blue-950 text-blue-300 border border-blue-800/60' :
                            item.method === 'search_engine' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' :
                            item.method === 'cctld' ? 'bg-purple-950 text-purple-300 border border-purple-800/60' :
                            item.method === 'ai_grounded' ? 'bg-amber-950 text-amber-300 border border-amber-800/60' :
                            'bg-gray-800 text-gray-400 border border-gray-700'
                          }`}>
                            {item.method === 'contact_page' ? '🏢 Website Contact / Impressum' :
                             item.method === 'search_engine' ? '🔍 Search Engine Grounding' :
                             item.method === 'cctld' ? '🌐 ccTLD Extension' :
                             item.method === 'ai_grounded' ? '🤖 AI Headquarters Match' :
                             'Generic Domain'}
                          </span>
                          {item.confidence ? (
                            <span className="text-[11px] text-gray-400">
                              Confidence: <strong className="text-white">{item.confidence}%</strong>
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[11px] text-gray-300 leading-relaxed font-mono">
                          {item.evidence || 'No detailed evidence record available.'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-800 bg-gray-950 flex justify-between items-center">
              <span className="text-xs text-gray-400">
                Showing {filteredAuditList.length} of {domainAuditMap.size} domains
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleExportAuditTxt}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium flex items-center gap-1.5 shadow-md"
                >
                  <DocumentArrowUpIcon className="w-3.5 h-3.5" />
                  Download Audit Report (.txt)
                </button>
                <button
                  onClick={() => setShowAuditModal(false)}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailSorter;
