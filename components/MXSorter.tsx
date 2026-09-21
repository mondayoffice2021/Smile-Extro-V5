import React, { useState, useRef, useMemo } from 'react';
import DocumentArrowUpIcon from './icons/DocumentArrowUpIcon';
import FolderOpenIcon from './icons/FolderOpenIcon';
import ArrowPathIcon from './icons/ArrowPathIcon';
import ArrowsRightLeftIcon from './icons/ArrowsRightLeftIcon';
import PauseIcon from './icons/PauseIcon';
import PlayIcon from './icons/PlayIcon';
import StopIcon from './icons/StopIcon';
import ClipboardIcon from './icons/ClipboardIcon';
import CheckIcon from './icons/CheckIcon';
import XCircleIcon from './icons/XCircleIcon';
import MagnifyingGlassIcon from './icons/MagnifyingGlassIcon';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { useActiveWakeLock } from '../hooks/useWakeLock';
import { extractTargetsForMXFromFile, type MXFileExtractResult } from '../services/fileService';
import { safeFetchJson } from '../services/safeFetch';
import {
  cleanAndDeduplicateTargets,
  DEFAULT_CLEAN_FILTER_CONFIG,
  type CleanFilterConfig,
  type CleanAndDeduplicateResult
} from '../services/businessEmailFilter';

interface MXSorterProps {
  showToast: (msg: string) => void;
}

interface MXGroup {
  provider: string;
  emails: string[];
}

// Enterprise & Global MX Pattern Matching
const MX_PATTERNS: { [key: string]: string[] } = {
  'Google Workspace': ['google.com', 'googlemail.com', 'aspmx.l.google.com', 'l.google.com'],
  'Microsoft 365': ['outlook.com', 'protection.outlook.com', 'hotmail.com', 'microsoft.com', 'office365.com', 'mail.protection.outlook.com'],
  'Zoho Mail': ['zoho.com', 'zoho.eu', 'zoho.in'],
  'Mimecast': ['mimecast.com'],
  'Proofpoint': ['pphosted.com', 'ppe-hosted.com', 'proofpoint.com'],
  'GoDaddy': ['secureserver.net'],
  'Namecheap / PrivateEmail': ['registrar-servers.com', 'oxcs.net', 'privateemail.com'],
  'Fastmail': ['fastmail.com', 'messagingengine.com'],
  'ProtonMail': ['protonmail.ch', 'proton.me'],
  'Yandex': ['yandex.net', 'yandex.com', 'yandex.ru'],
  'Amazon SES / WorkMail': ['amazonses.com', 'awsapps.com'],
  'Rackspace': ['emailsrvr.com'],
  'OVHcloud': ['ovh.net', 'ovh.com', 'ovh.ca'],
  'Mailgun': ['mailgun.org', 'mailgun.com'],
  'SendGrid': ['sendgrid.net'],
  'Brevo / Sendinblue': ['sendinblue.com', 'brevo.com'],
  'Cisco IronPort': ['iphmx.com', 'ironport.com'],
  'Barracuda': ['barracudanetworks.com', 'ess.barracuda.com'],
  'Apple iCloud': ['icloud.com', 'apple.com']
};

const PROVIDER_COLORS: { [key: string]: { bg: string; border: string; text: string; badge: string } } = {
  'Google Workspace': { bg: 'bg-emerald-950/30', border: 'border-emerald-500/40', text: 'text-emerald-300', badge: 'bg-emerald-900/60 text-emerald-300 border-emerald-600/50' },
  'Microsoft 365': { bg: 'bg-blue-950/30', border: 'border-blue-500/40', text: 'text-blue-300', badge: 'bg-blue-900/60 text-blue-300 border-blue-600/50' },
  'Zoho Mail': { bg: 'bg-amber-950/30', border: 'border-amber-500/40', text: 'text-amber-300', badge: 'bg-amber-900/60 text-amber-300 border-amber-600/50' },
  'Mimecast': { bg: 'bg-purple-950/30', border: 'border-purple-500/40', text: 'text-purple-300', badge: 'bg-purple-900/60 text-purple-300 border-purple-600/50' },
  'Proofpoint': { bg: 'bg-indigo-950/30', border: 'border-indigo-500/40', text: 'text-indigo-300', badge: 'bg-indigo-900/60 text-indigo-300 border-indigo-600/50' },
  'GoDaddy': { bg: 'bg-teal-950/30', border: 'border-teal-500/40', text: 'text-teal-300', badge: 'bg-teal-900/60 text-teal-300 border-teal-600/50' },
  'Namecheap / PrivateEmail': { bg: 'bg-orange-950/30', border: 'border-orange-500/40', text: 'text-orange-300', badge: 'bg-orange-900/60 text-orange-300 border-orange-600/50' },
  'Fastmail': { bg: 'bg-cyan-950/30', border: 'border-cyan-500/40', text: 'text-cyan-300', badge: 'bg-cyan-900/60 text-cyan-300 border-cyan-600/50' },
  'ProtonMail': { bg: 'bg-violet-950/30', border: 'border-violet-500/40', text: 'text-violet-300', badge: 'bg-violet-900/60 text-violet-300 border-violet-600/50' },
  'Yandex': { bg: 'bg-red-950/30', border: 'border-red-500/40', text: 'text-red-300', badge: 'bg-red-900/60 text-red-300 border-red-600/50' },
  'Amazon SES / WorkMail': { bg: 'bg-yellow-950/30', border: 'border-yellow-500/40', text: 'text-yellow-300', badge: 'bg-yellow-900/60 text-yellow-300 border-yellow-600/50' },
  'Rackspace': { bg: 'bg-rose-950/30', border: 'border-rose-500/40', text: 'text-rose-300', badge: 'bg-rose-900/60 text-rose-300 border-rose-600/50' }
};

const DEFAULT_COLOR = {
  bg: 'bg-gray-800/40',
  border: 'border-gray-700',
  text: 'text-gray-300',
  badge: 'bg-gray-800 text-gray-300 border-gray-700'
};

const MXSorter: React.FC<MXSorterProps> = ({ showToast }) => {
  const [inputText, setInputText] = useState('');
  const [results, setResults] = useState<MXGroup[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Clean Filter & Deduplication State (User requested: remove public email, banks, junk users webmaster/user etc, leave info/sales/order, remove .gov/.edu, remove duplicates, one clean results after separations)
  const [enableAutoClean, setEnableAutoClean] = useState<boolean>(true);
  const [cleanFilterConfig, setCleanFilterConfig] = useState<CleanFilterConfig>({
    ...DEFAULT_CLEAN_FILTER_CONFIG
  });
  const [showCleanConfig, setShowCleanConfig] = useState<boolean>(false);
  const [cleanStats, setCleanStats] = useState<CleanAndDeduplicateResult['counts'] | null>(null);
  const [excludedItems, setExcludedItems] = useState<{ item: string; reason: string; category: string }[]>([]);
  const [cleanConsolidatedList, setCleanConsolidatedList] = useState<{ target: string; domain: string; provider: string; type: 'email' | 'domain' }[]>([]);
  const [viewMode, setViewMode] = useState<'clean-consolidated' | 'categorized' | 'excluded'>('clean-consolidated');

  // File Upload State
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<MXFileExtractResult | null>(null);
  const [isLargeFileMode, setIsLargeFileMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const rawFileContent = useRef<string | null>(null);

  // Results Filter State
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Keep screen awake while resolving MX DNS queries and sorting
  useActiveWakeLock(isProcessing, 'MX Sorter: Resolving DNS Records');
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [statusText, setStatusText] = useState('Idle');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlRef = useRef({ shouldStop: false, isPaused: false });
  const domainCache = useRef<Map<string, string>>(new Map());

  // Format file size
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Handle uploaded file (Excel .xlsx/.xls, CSV .csv/.cvs, TXT .txt)
  const processUploadedFile = async (file: File) => {
    setIsReadingFile(true);
    setStatusText(`Reading ${file.name}...`);
    try {
      const extracted = await extractTargetsForMXFromFile(file);
      if (extracted.items.length === 0) {
        showToast(`No email addresses or domain names found in ${file.name}.`);
        return;
      }

      setUploadedFile(extracted);

      const isLarge = file.size > 1024 * 1024 || extracted.items.length > 3000;
      setIsLargeFileMode(isLarge);

      if (isLarge) {
        rawFileContent.current = extracted.items.join('\n');
        setInputText(
          `[LOADED: ${file.name}]\n` +
          `Format: ${extracted.fileType.toUpperCase()} | Size: ${formatBytes(file.size)}\n` +
          `Targets Found: ${extracted.totalUnique.toLocaleString()} (${extracted.emailsCount.toLocaleString()} emails, ${extracted.domainsCount.toLocaleString()} domains)\n\n` +
          `Preview (first 10 items):\n${extracted.items.slice(0, 10).join('\n')}\n` +
          `...plus ${(extracted.items.length - 10).toLocaleString()} more items.\n\n` +
          `Ready to analyze MX records!`
        );
      } else {
        rawFileContent.current = null;
        setInputText(extracted.items.join('\n'));
      }

      showToast(`Loaded ${extracted.totalUnique.toLocaleString()} targets from ${file.name}`);
    } catch (err: any) {
      console.error("Error reading file:", err);
      showToast(err?.message || `Failed to process ${file.name}`);
    } finally {
      setIsReadingFile(false);
      setStatusText('Idle');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processUploadedFile(file);
    }
  };

  // Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      await processUploadedFile(file);
    }
  };

  const handleClearFile = () => {
    setUploadedFile(null);
    setIsLargeFileMode(false);
    rawFileContent.current = null;
    setInputText('');
    showToast("Cleared uploaded file.");
  };

  // Query DNS over HTTPS for MX records (Google DoH with Cloudflare DoH fallback)
  const fetchMX = async (domain: string): Promise<string> => {
    if (domainCache.current.has(domain)) return domainCache.current.get(domain)!;

    try {
      const cleanDomain = domain.toLowerCase().trim();
      let records: string[] = [];

      // 1. Google DNS over HTTPS
      const gRes = await safeFetchJson<any>(`https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=MX`);
      if (gRes.data && Array.isArray(gRes.data.Answer) && gRes.data.Answer.length > 0) {
        records = gRes.data.Answer.map((ans: any) => (ans.data || '').toLowerCase());
      } else {
        // 2. Cloudflare DNS over HTTPS fallback
        const cfRes = await safeFetchJson<any>(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(cleanDomain)}&type=MX`,
          { headers: { Accept: 'application/dns-json' } }
        );
        if (cfRes.data && Array.isArray(cfRes.data.Answer) && cfRes.data.Answer.length > 0) {
          records = cfRes.data.Answer.map((ans: any) => (ans.data || '').toLowerCase());
        }
      }
      
      if (records.length === 0) {
        domainCache.current.set(domain, 'Private / Custom Server');
        return 'Private / Custom Server';
      }

      let detectedProvider = 'Private / Custom Server';

      for (const [provider, patterns] of Object.entries(MX_PATTERNS)) {
        if (records.some(rec => patterns.some(p => rec.includes(p)))) {
          detectedProvider = provider;
          break;
        }
      }

      domainCache.current.set(domain, detectedProvider);
      return detectedProvider;
    } catch {
      return 'Private / Custom Server';
    }
  };

  // Core MX Analysis Runner
  const processEmails = async () => {
    const contentToProcess = isLargeFileMode && rawFileContent.current 
      ? rawFileContent.current 
      : inputText;

    if (!contentToProcess.trim()) {
      showToast("Please enter emails or upload an Excel, CSV, or TXT file.");
      return;
    }

    const rawLines = contentToProcess
      .split(/[\r\n,;]+/)
      .map(e => e.trim())
      .filter(item => {
        if (!item) return false;
        // Ignore preview header lines from large file preview
        if (item.startsWith('[LOADED:') || item.startsWith('Format:') || item.startsWith('Targets Found:') || item.startsWith('Preview') || item.startsWith('...plus') || item.startsWith('Ready to')) {
          return false;
        }
        return true;
      });

    if (rawLines.length === 0) {
      showToast("No valid input items found to process.");
      return;
    }

    let targetItemsToProcess = rawLines;

    // Apply Smart Clean Filter and Deduplication if enabled
    // User requested: "remove all public email, banks, junk email like webmaster, user etc, but leave info, sales, order. remove .gov and edu etc. we have one clean resullts after seperations, consider removing dublicates"
    if (enableAutoClean) {
      const cleanResult = cleanAndDeduplicateTargets(rawLines, cleanFilterConfig);
      targetItemsToProcess = cleanResult.cleanTargets;
      setCleanStats(cleanResult.counts);
      setExcludedItems(cleanResult.excludedTargets);

      if (cleanResult.cleanTargets.length === 0) {
        showToast(`All ${rawLines.length} items were filtered out based on your clean settings (Public emails, Banks, Junk users, or .Gov/.Edu). Check the Excluded tab.`);
        setViewMode('excluded');
        return;
      }
    } else {
      // Basic deduplication if auto-clean is disabled but duplicate removal is requested
      if (cleanFilterConfig.removeDuplicates) {
        const uniqueSet = new Set(rawLines.map(l => l.toLowerCase()));
        targetItemsToProcess = Array.from(uniqueSet);
      }
      setCleanStats(null);
      setExcludedItems([]);
    }

    const domainMap = new Map<string, string[]>();

    targetItemsToProcess.forEach(item => {
      let domain = '';
      let target = item;

      if (item.includes('@')) {
        const parts = item.split('@');
        domain = (parts[1] || '').toLowerCase().trim();
        target = item.toLowerCase().trim();
      } else {
        // Standalone domain or URL
        let cleaned = item.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0].split('?')[0].split('#')[0].toLowerCase().trim();
        cleaned = cleaned.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
        if (cleaned.includes('.')) {
          domain = cleaned;
          target = cleaned;
        }
      }

      if (domain && domain.includes('.')) {
        if (!domainMap.has(domain)) {
          domainMap.set(domain, []);
        }
        if (!domainMap.get(domain)!.includes(target)) {
          domainMap.get(domain)!.push(target);
        }
      }
    });

    const domains: string[] = Array.from(domainMap.keys());
    const totalDomains = domains.length;

    if (totalDomains === 0) {
      showToast("No valid email addresses or domains found to analyze.");
      return;
    }

    setIsProcessing(true);
    setIsPaused(false);
    controlRef.current = { shouldStop: false, isPaused: false };
    setResults([]);
    setCleanConsolidatedList([]);
    setSelectedCategory('all');
    setSearchQuery('');
    setViewMode('clean-consolidated');

    const providerMap = new Map<string, string[]>();
    const BATCH_SIZE = 12;

    for (let i = 0; i < domains.length; i += BATCH_SIZE) {
      if (controlRef.current.shouldStop) break;
      while (controlRef.current.isPaused) {
        await new Promise(r => setTimeout(r, 200));
        if (controlRef.current.shouldStop) break;
      }

      const batch = domains.slice(i, i + BATCH_SIZE);
      setProgress({ current: i, total: totalDomains });
      setStatusText(`Querying MX records for ${batch.length} domains (batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(totalDomains / BATCH_SIZE)})...`);

      const batchPromises = batch.map(async (domain: string) => {
        const provider = await fetchMX(domain);
        const targets = domainMap.get(domain)!;
        if (!providerMap.has(provider)) providerMap.set(provider, []);
        providerMap.get(provider)!.push(...targets);
      });

      await Promise.all(batchPromises);

      // Live partial UI update
      const currentGroups = Array.from(providerMap.entries()).map(([provider, emails]) => ({
        provider,
        emails: Array.from(new Set(emails))
      })).sort((a, b) => b.emails.length - a.emails.length);

      setResults(currentGroups);

      // Build Clean Consolidated List
      const consolidated: { target: string; domain: string; provider: string; type: 'email' | 'domain' }[] = [];
      providerMap.forEach((targets, prov) => {
        const uniqueInProv = Array.from(new Set(targets));
        uniqueInProv.forEach(t => {
          const isEmail = t.includes('@');
          const d = isEmail ? t.split('@')[1] : t;
          consolidated.push({
            target: t,
            domain: d,
            provider: prov,
            type: isEmail ? 'email' : 'domain'
          });
        });
      });
      setCleanConsolidatedList(consolidated);
    }

    setProgress({ current: totalDomains, total: totalDomains });
    setIsProcessing(false);
    setStatusText('Analysis Complete');

    const totalTargetsResolved = Array.from(providerMap.values()).reduce((sum, list) => sum + list.length, 0);
    showToast(`Categorized ${totalTargetsResolved.toLocaleString()} clean targets across ${providerMap.size} MX providers.`);
  };

  // Helper: Trigger file download in browser
  const triggerBrowserDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Export Clean Master List (TXT)
  const handleExportCleanTxt = () => {
    if (cleanConsolidatedList.length === 0) return;
    const dateStr = new Date().toISOString().split('T')[0];
    const header = `# Clean Business Contacts (Deduplicated)\n# Clean Count: ${cleanConsolidatedList.length}\n# Exported: ${new Date().toISOString()}\n\n`;
    const content = header + cleanConsolidatedList.map(c => c.target).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    triggerBrowserDownload(blob, `Clean_Contacts_${dateStr}.txt`);
    showToast(`Exported ${cleanConsolidatedList.length} clean contacts to TXT.`);
  };

  // Export Clean Master List (CSV)
  const handleExportCleanCsv = () => {
    if (cleanConsolidatedList.length === 0) return;
    const dateStr = new Date().toISOString().split('T')[0];
    const header = "Target,Domain,MX_Provider,Type\n";
    const rows = cleanConsolidatedList.map(item =>
      `"${item.target.replace(/"/g, '""')}","${item.domain.replace(/"/g, '""')}","${item.provider.replace(/"/g, '""')}","${item.type}"`
    ).join("\n");
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    triggerBrowserDownload(blob, `Clean_Contacts_${dateStr}.csv`);
    showToast(`Exported ${cleanConsolidatedList.length} clean contacts to CSV.`);
  };

  // Export Clean Master List (Excel .xlsx)
  const handleExportCleanExcel = () => {
    if (cleanConsolidatedList.length === 0) return;
    const dateStr = new Date().toISOString().split('T')[0];
    const wb = XLSX.utils.book_new();

    // Sheet 1: Clean Master Contacts
    const cleanRows = cleanConsolidatedList.map(item => ({
      'Contact / Target': item.target,
      'Domain': item.domain,
      'MX Provider': item.provider,
      'Type': item.type === 'email' ? 'Email Address' : 'Domain',
      'Clean Status': 'Verified Business'
    }));
    const cleanSheet = XLSX.utils.json_to_sheet(cleanRows);
    XLSX.utils.book_append_sheet(wb, cleanSheet, "Clean Contacts");

    // Sheet 2: Separation & Filter Summary
    const summaryRows = [
      { Metric: 'Clean Unique Targets', Count: cleanConsolidatedList.length },
      { Metric: 'Duplicates Removed', Count: cleanStats?.duplicates || 0 },
      { Metric: 'Public Webmails Filtered', Count: cleanStats?.publicWebmail || 0 },
      { Metric: 'Banks / Financial Filtered', Count: cleanStats?.bank || 0 },
      { Metric: 'Junk Emails Filtered (info/sales/order preserved)', Count: cleanStats?.junkUser || 0 },
      { Metric: 'Government & Educational Filtered', Count: cleanStats?.govEdu || 0 },
      { Metric: 'Total Original Inputs Evaluated', Count: cleanStats?.total || cleanConsolidatedList.length }
    ];
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, summarySheet, "Filter Summary");

    // Sheet 3: Provider Breakdown
    const providerCounts: { [p: string]: number } = {};
    cleanConsolidatedList.forEach(c => {
      providerCounts[c.provider] = (providerCounts[c.provider] || 0) + 1;
    });
    const providerRows = Object.entries(providerCounts)
      .map(([provider, count]) => ({
        'MX Provider': provider,
        'Clean Targets': count,
        'Share': `${((count / cleanConsolidatedList.length) * 100).toFixed(1)}%`
      }))
      .sort((a, b) => b['Clean Targets'] - a['Clean Targets']);
    const providerSheet = XLSX.utils.json_to_sheet(providerRows);
    XLSX.utils.book_append_sheet(wb, providerSheet, "MX Breakdown");

    XLSX.writeFile(wb, `Clean_Contacts_${dateStr}.xlsx`);
    showToast(`Exported ${cleanConsolidatedList.length} clean contacts to Excel (.xlsx)!`);
  };

  // Export Excluded Audit Log (CSV)
  const handleExportExcludedCsv = () => {
    if (excludedItems.length === 0) return;
    const dateStr = new Date().toISOString().split('T')[0];
    const header = "Excluded_Target,Category,Reason\n";
    const rows = excludedItems.map(item =>
      `"${item.item.replace(/"/g, '""')}","${item.category.replace(/"/g, '""')}","${item.reason.replace(/"/g, '""')}"`
    ).join("\n");
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    triggerBrowserDownload(blob, `Excluded_Contacts_Audit_${dateStr}.csv`);
    showToast(`Exported ${excludedItems.length} excluded items to audit CSV.`);
  };

  // Copy All Clean Targets to Clipboard
  const handleCopyCleanList = async () => {
    if (cleanConsolidatedList.length === 0) return;
    const text = cleanConsolidatedList.map(c => c.target).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey('clean-all');
      setTimeout(() => setCopiedKey(null), 2000);
      showToast(`Copied ${cleanConsolidatedList.length} clean unique contacts to clipboard!`);
    } catch {
      showToast("Clipboard write permission unavailable.");
    }
  };

  // Export 1: ZIP of .txt files per category
  const handleExportZip = async () => {
    if (results.length === 0) return;
    const zip = new JSZip();
    const dateStr = new Date().toISOString().split('T')[0];
    const folder = zip.folder(`MX_Categories_${dateStr}`);
    if (!folder) return;

    results.forEach(group => {
      const safeName = group.provider.replace(/[^a-z0-9]/gi, '_');
      const header = `# MX CATEGORY: ${group.provider}\n# Total Targets: ${group.emails.length}\n# Exported: ${new Date().toISOString()}\n\n`;
      folder.file(`${safeName}.txt`, header + group.emails.join('\n'));
    });

    const blob = await zip.generateAsync({ type: "blob" });
    triggerBrowserDownload(blob, `MX_Categories_${dateStr}.zip`);
    showToast("Downloaded all categories as ZIP!");
  };

  // Export 2: Excel (.xlsx) spreadsheet with category sheets & metadata
  const handleExportExcel = () => {
    if (results.length === 0) return;
    const dateStr = new Date().toISOString().split('T')[0];

    const wb = XLSX.utils.book_new();

    // Summary Sheet
    const summaryRows = results.map(g => ({
      'MX Provider': g.provider,
      'Total Targets': g.emails.length,
      'Share of Total': `${((g.emails.length / totalResultsCount) * 100).toFixed(1)}%`
    }));
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

    // Master List Sheet
    const masterRows: any[] = [];
    results.forEach(group => {
      group.emails.forEach(target => {
        const domain = target.includes('@') ? target.split('@')[1] : target;
        masterRows.push({
          'Target Email / Domain': target,
          'Domain': domain,
          'MX Provider': group.provider,
          'Identified On': dateStr
        });
      });
    });

    const masterSheet = XLSX.utils.json_to_sheet(masterRows);
    XLSX.utils.book_append_sheet(wb, masterSheet, "All Targets");

    XLSX.writeFile(wb, `MX_Categories_${dateStr}.xlsx`);
    showToast("Exported MX Categories to Excel (.xlsx)!");
  };

  // Export 3: Clean CSV
  const handleExportCSV = () => {
    if (results.length === 0) return;
    const dateStr = new Date().toISOString().split('T')[0];

    const header = "Target,Domain,MX_Provider\n";
    const rows = results.flatMap(g => 
      g.emails.map(t => {
        const dom = t.includes('@') ? t.split('@')[1] : t;
        return `"${t.replace(/"/g, '""')}","${dom.replace(/"/g, '""')}","${g.provider.replace(/"/g, '""')}"`;
      })
    ).join("\n");

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    triggerBrowserDownload(blob, `MX_Categories_${dateStr}.csv`);
    showToast("Exported MX Categories to CSV!");
  };

  // Export single category as TXT
  const handleExportCategoryTxt = (group: MXGroup) => {
    const safeName = group.provider.replace(/[^a-z0-9]/gi, '_');
    const content = `# MX Provider: ${group.provider}\n# Count: ${group.emails.length}\n\n` + group.emails.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    triggerBrowserDownload(blob, `${safeName}_emails.txt`);
    showToast(`Downloaded ${group.provider} list.`);
  };

  // Copy category targets to clipboard
  const handleCopyCategory = async (group: MXGroup) => {
    try {
      await navigator.clipboard.writeText(group.emails.join('\n'));
      setCopiedKey(group.provider);
      setTimeout(() => setCopiedKey(null), 2000);
      showToast(`Copied ${group.emails.length} items from ${group.provider} to clipboard!`);
    } catch (e) {
      showToast("Clipboard write permission unavailable.");
    }
  };

  // Copy all results
  const handleCopyAll = async () => {
    if (results.length === 0) return;
    const text = results.map(g => `=== ${g.provider} (${g.emails.length}) ===\n${g.emails.join('\n')}`).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey('all');
      setTimeout(() => setCopiedKey(null), 2000);
      showToast("Copied all categorized items to clipboard!");
    } catch (e) {
      showToast("Unable to copy to clipboard.");
    }
  };

  // Computed summary metrics
  const totalResultsCount = useMemo(() => {
    return results.reduce((sum, g) => sum + g.emails.length, 0);
  }, [results]);

  // Filtered clean list by search query and category
  const filteredCleanList = useMemo(() => {
    let list = cleanConsolidatedList;
    if (selectedCategory !== 'all') {
      list = list.filter(item => item.provider === selectedCategory);
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(item =>
      item.target.toLowerCase().includes(q) ||
      item.domain.toLowerCase().includes(q) ||
      item.provider.toLowerCase().includes(q)
    );
  }, [cleanConsolidatedList, selectedCategory, searchQuery]);

  // Filtered excluded items by search query
  const filteredExcludedItems = useMemo(() => {
    if (!searchQuery.trim()) return excludedItems;
    const q = searchQuery.toLowerCase();
    return excludedItems.filter(item =>
      item.item.toLowerCase().includes(q) ||
      item.reason.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  }, [excludedItems, searchQuery]);

  // Filtered results by category and search term
  const filteredResults = useMemo(() => {
    return results
      .filter(g => selectedCategory === 'all' || g.provider === selectedCategory)
      .map(g => {
        if (!searchQuery.trim()) return g;
        const q = searchQuery.toLowerCase();
        return {
          ...g,
          emails: g.emails.filter(e => e.toLowerCase().includes(q))
        };
      })
      .filter(g => g.emails.length > 0);
  }, [results, selectedCategory, searchQuery]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
      {/* LEFT PANEL: INPUT & CONTROLS */}
      <div className="lg:col-span-4 flex flex-col h-full space-y-4">
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl shadow-2xl p-6 flex-grow flex flex-col">
          <div className="mb-4 pb-3 border-b border-gray-700/60">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <ArrowsRightLeftIcon className="w-6 h-6 text-blue-400" />
              MX Provider Sorter
            </h2>
            <p className="text-gray-400 text-xs mt-1.5 leading-relaxed">
              Identify host servers (Google Workspace, Microsoft 365, Zoho, etc.) for business emails and domains via live DNS MX lookup.
            </p>
          </div>

          {/* DRAG & DROP UPLOAD ZONE (EXCEL, CSV, TXT) */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`mb-4 p-4 rounded-xl border-2 border-dashed transition-all cursor-pointer text-center ${
              isDragging
                ? 'border-blue-400 bg-blue-900/40 scale-[1.01]'
                : uploadedFile
                ? 'border-emerald-500/60 bg-emerald-950/20'
                : 'border-gray-600/80 bg-gray-900/40 hover:border-blue-500 hover:bg-gray-900/70'
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              accept=".xlsx,.xls,.csv,.cvs,.txt,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
            />

            {uploadedFile ? (
              <div className="flex flex-col items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                  <CheckIcon className="w-5 h-5" />
                  <span className="truncate max-w-[200px]">{uploadedFile.fileName}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded uppercase font-mono font-bold bg-emerald-900/80 text-emerald-300 border border-emerald-500/40">
                    {uploadedFile.fileType}
                  </span>
                </div>
                <p className="text-xs text-gray-300">
                  {uploadedFile.totalUnique.toLocaleString()} items ({uploadedFile.emailsCount.toLocaleString()} emails, {uploadedFile.domainsCount.toLocaleString()} domains) • {formatBytes(uploadedFile.fileSize)}
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition"
                  >
                    Change File
                  </button>
                  <button
                    type="button"
                    onClick={handleClearFile}
                    className="text-xs px-2.5 py-1 rounded bg-red-900/50 hover:bg-red-800 text-red-300 border border-red-700 transition flex items-center gap-1"
                  >
                    <XCircleIcon className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-2">
                <DocumentArrowUpIcon className="w-8 h-8 text-blue-400 mb-2 animate-pulse" />
                <p className="text-sm font-bold text-white mb-0.5">
                  Upload Excel, CSV, or TXT
                </p>
                <p className="text-xs text-gray-400">
                  Drag & drop file here, or click to browse
                </p>
                <div className="flex items-center gap-1.5 mt-2.5">
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-700/50">
                    .XLSX / .XLS
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono font-semibold bg-blue-950/80 text-blue-300 border border-blue-700/50">
                    .CSV
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono font-semibold bg-purple-950/80 text-purple-300 border border-purple-700/50">
                    .TXT
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* MANUAL TEXT INPUT / PREVIEW AREA */}
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-gray-300">
              {uploadedFile ? 'File Content Preview' : 'Or Paste Emails / Domains:'}
            </span>
            {inputText && !isProcessing && (
              <button
                type="button"
                onClick={() => { setInputText(''); setUploadedFile(null); rawFileContent.current = null; }}
                className="text-xs text-gray-400 hover:text-red-400 transition"
              >
                Clear
              </button>
            )}
          </div>

          <textarea
            value={inputText}
            onChange={(e) => {
              if (isLargeFileMode) {
                showToast("Large file mode active. Use 'Change File' or 'Remove' to reload.");
                return;
              }
              setInputText(e.target.value);
            }}
            placeholder="ceo@microsoft.com&#10;sales@google.com&#10;admin@company.fr&#10;apple.com&#10;tesla.com"
            className={`flex-grow w-full p-3.5 bg-gray-900/60 border border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none text-xs font-mono text-gray-300 custom-scrollbar mb-3 ${
              isLargeFileMode ? 'opacity-80 bg-gray-950' : ''
            }`}
            disabled={isProcessing}
            readOnly={isLargeFileMode}
            rows={6}
          />

          {/* SMART CLEAN & DEDUPLICATION CONFIGURATION PANEL */}
          <div className="mb-4 p-3 bg-gradient-to-br from-gray-900/90 to-indigo-950/40 border border-indigo-500/30 rounded-xl space-y-2.5 shadow-md">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={enableAutoClean}
                  onChange={(e) => setEnableAutoClean(e.target.checked)}
                  disabled={isProcessing}
                  className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 w-4 h-4 bg-gray-800"
                />
                <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                  🛡️ Clean Filter & Deduplication
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
              Filters public emails, banks, junk users (<code className="text-indigo-300">webmaster</code>, <code className="text-indigo-300">user</code>, etc. while preserving <code className="text-emerald-300">info</code>, <code className="text-emerald-300">sales</code>, <code className="text-emerald-300">order</code>), removes .gov/.edu, and removes duplicates.
            </p>

            {/* Quick Badge Indicators */}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <span className={`text-[10px] px-2 py-0.5 rounded font-mono border transition ${
                enableAutoClean && cleanFilterConfig.removePublicEmails
                  ? 'bg-red-950/60 text-red-300 border-red-800/60'
                  : 'bg-gray-800 text-gray-500 border-gray-700 line-through'
              }`}>
                No Public Webmail
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-mono border transition ${
                enableAutoClean && cleanFilterConfig.removeBanks
                  ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
                  : 'bg-gray-800 text-gray-500 border-gray-700 line-through'
              }`}>
                No Banks/Finance
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-mono border transition ${
                enableAutoClean && cleanFilterConfig.removeJunkBotEmails
                  ? 'bg-purple-950/60 text-purple-300 border-purple-800/60'
                  : 'bg-gray-800 text-gray-500 border-gray-700 line-through'
              }`}>
                No Junk Users (Keeps Info/Sales/Order)
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-mono border transition ${
                enableAutoClean && cleanFilterConfig.removeGovEdu
                  ? 'bg-blue-950/60 text-blue-300 border-blue-800/60'
                  : 'bg-gray-800 text-gray-500 border-gray-700 line-through'
              }`}>
                No .Gov/.Edu
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-mono border transition ${
                enableAutoClean && cleanFilterConfig.removeDuplicates
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                  : 'bg-gray-800 text-gray-500 border-gray-700 line-through'
              }`}>
                Deduplicated
              </span>
            </div>

            {/* EXPANDABLE INDIVIDUAL RULES CHECKLIST */}
            {showCleanConfig && (
              <div className="pt-2 border-t border-gray-800 space-y-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-gray-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={cleanFilterConfig.removePublicEmails}
                    onChange={(e) => setCleanFilterConfig(prev => ({ ...prev, removePublicEmails: e.target.checked }))}
                    disabled={!enableAutoClean || isProcessing}
                    className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 bg-gray-800"
                  />
                  <span>Remove consumer webmails (Gmail, Yahoo, Outlook, Hotmail, etc.)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-gray-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={cleanFilterConfig.removeBanks}
                    onChange={(e) => setCleanFilterConfig(prev => ({ ...prev, removeBanks: e.target.checked }))}
                    disabled={!enableAutoClean || isProcessing}
                    className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 bg-gray-800"
                  />
                  <span>Remove banks and financial institutions (Chase, Citi, .bank, etc.)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-gray-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={cleanFilterConfig.removeJunkBotEmails}
                    onChange={(e) => setCleanFilterConfig(prev => ({ ...prev, removeJunkBotEmails: e.target.checked }))}
                    disabled={!enableAutoClean || isProcessing}
                    className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 bg-gray-800"
                  />
                  <span>Remove junk/bot users (webmaster, user, admin — leaves info, sales, order)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-gray-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={cleanFilterConfig.removeGovEdu}
                    onChange={(e) => setCleanFilterConfig(prev => ({ ...prev, removeGovEdu: e.target.checked }))}
                    disabled={!enableAutoClean || isProcessing}
                    className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 bg-gray-800"
                  />
                  <span>Remove Government (.gov, .mil) & Education (.edu, .ac.*)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-gray-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={cleanFilterConfig.removeDuplicates}
                    onChange={(e) => setCleanFilterConfig(prev => ({ ...prev, removeDuplicates: e.target.checked }))}
                    disabled={!enableAutoClean || isProcessing}
                    className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 bg-gray-800"
                  />
                  <span>Remove duplicate contacts & domains (Normalized deduplication)</span>
                </label>
              </div>
            )}
          </div>

          {/* ACTION BUTTONS & PROCESSING CONTROLS */}
          <div className="flex gap-2">
            {isProcessing ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const nextPaused = !isPaused;
                    setIsPaused(nextPaused);
                    controlRef.current.isPaused = nextPaused;
                  }}
                  className={`px-4 py-2.5 rounded-lg text-sm font-bold flex-1 flex items-center justify-center border transition-all ${
                    isPaused
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500'
                      : 'bg-yellow-600 hover:bg-yellow-700 text-white border-yellow-500'
                  }`}
                >
                  {isPaused ? <PlayIcon className="w-4 h-4 mr-2" /> : <PauseIcon className="w-4 h-4 mr-2" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <button
                  type="button"
                  onClick={() => { controlRef.current.shouldStop = true; }}
                  className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold flex-1 flex items-center justify-center border border-red-500 transition-all"
                >
                  <StopIcon className="w-4 h-4 mr-2" /> Stop
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={processEmails}
                disabled={!inputText.trim() || isReadingFile}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-lg shadow-blue-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                <ArrowsRightLeftIcon className="w-4 h-4" />
                {uploadedFile 
                  ? `Start MX Analysis (${uploadedFile.totalUnique.toLocaleString()} items)` 
                  : 'Start MX Analysis'}
              </button>
            )}
          </div>

          {/* REALTIME DNS PROGRESS BAR */}
          {isProcessing && progress && (
            <div className="mt-4 p-3 bg-gray-900/80 rounded-lg border border-gray-700">
              <div className="flex justify-between text-xs text-blue-300 mb-1.5 font-medium">
                <span className="truncate max-w-[220px]">{statusText}</span>
                <span>{Math.round((progress.current / progress.total) * 100)}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-teal-400 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.round((progress.current / progress.total) * 100))}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: MX CATEGORIES & CLEAN CONSOLIDATED RESULTS */}
      <div className="lg:col-span-8 flex flex-col h-full">
        <div className="bg-gray-800/40 backdrop-blur-md border border-gray-700 rounded-xl shadow-2xl flex flex-col h-[85vh]">
          {/* HEADER BAR & TAB SELECTOR */}
          <div className="p-4 sm:p-5 border-b border-gray-700/60 bg-gray-800/50 flex flex-wrap justify-between items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white">
                  {viewMode === 'clean-consolidated' ? 'Clean Consolidated Results' : viewMode === 'categorized' ? 'MX Provider Categories' : 'Excluded & Filtered Audit'}
                </h2>
                {cleanConsolidatedList.length > 0 && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-900/80 text-emerald-300 border border-emerald-500/40">
                    {cleanConsolidatedList.length.toLocaleString()} clean targets
                  </span>
                )}
              </div>
              <p className="text-gray-400 text-xs mt-0.5">
                {viewMode === 'clean-consolidated'
                  ? 'Unified clean business contacts after separations, free of public mailboxes, banks, junk users & duplicate URLs'
                  : viewMode === 'categorized'
                  ? 'Target organizations grouped by host email server & enterprise mail gateway'
                  : 'Complete audit log of filtered public webmails, banks, junk mailboxes, .gov/.edu, and duplicates'}
              </p>
            </div>

            {/* TAB SELECTOR BUTTONS */}
            <div className="flex items-center gap-1 bg-gray-900/80 p-1 rounded-lg border border-gray-700">
              <button
                type="button"
                onClick={() => setViewMode('clean-consolidated')}
                className={`text-xs px-3 py-1.5 rounded-md font-bold transition flex items-center gap-1.5 ${
                  viewMode === 'clean-consolidated'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <span>⭐ Clean Results</span>
                {cleanConsolidatedList.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-950 text-emerald-300 font-mono">
                    {cleanConsolidatedList.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setViewMode('categorized')}
                className={`text-xs px-3 py-1.5 rounded-md font-bold transition flex items-center gap-1.5 ${
                  viewMode === 'categorized'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <span>🗂️ Categories</span>
                {results.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-950 text-blue-300 font-mono">
                    {results.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setViewMode('excluded')}
                className={`text-xs px-3 py-1.5 rounded-md font-bold transition flex items-center gap-1.5 ${
                  viewMode === 'excluded'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <span>🛡️ Excluded ({excludedItems.length})</span>
              </button>
            </div>
          </div>

          {/* DYNAMIC SUB-BAR / EXPORT ACTIONS */}
          <div className="p-3 bg-gray-900/70 border-b border-gray-800 flex flex-wrap items-center justify-between gap-2.5">
            {/* SEARCH INPUT */}
            <div className="relative w-full sm:w-64">
              <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={viewMode === 'excluded' ? 'Search excluded items...' : 'Search contacts or domains...'}
                className="w-full pl-8 pr-7 py-1 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <XCircleIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* EXPORT OPTIONS DEPENDING ON ACTIVE TAB */}
            {viewMode === 'clean-consolidated' && cleanConsolidatedList.length > 0 && (
              <div className="flex items-center flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportCleanExcel}
                  className="flex items-center px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold transition shadow"
                  title="Download clean contacts as Excel workbook"
                >
                  <DocumentArrowUpIcon className="w-3.5 h-3.5 mr-1.5" />
                  Excel (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={handleExportCleanCsv}
                  className="flex items-center px-3 py-1.5 bg-teal-700 hover:bg-teal-600 text-white rounded-lg text-xs font-bold transition shadow"
                  title="Download clean CSV"
                >
                  CSV
                </button>
                <button
                  type="button"
                  onClick={handleExportCleanTxt}
                  className="flex items-center px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-xs font-bold transition shadow"
                  title="Download clean TXT"
                >
                  TXT
                </button>
                <button
                  type="button"
                  onClick={handleCopyCleanList}
                  className="flex items-center px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-xs font-bold transition border border-gray-600"
                  title="Copy all clean contacts to clipboard"
                >
                  {copiedKey === 'clean-all' ? (
                    <CheckIcon className="w-3.5 h-3.5 text-green-400 mr-1" />
                  ) : (
                    <ClipboardIcon className="w-3.5 h-3.5 mr-1" />
                  )}
                  {copiedKey === 'clean-all' ? 'Copied' : 'Copy All Clean'}
                </button>
              </div>
            )}

            {viewMode === 'categorized' && results.length > 0 && (
              <div className="flex items-center flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="flex items-center px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold transition shadow"
                  title="Download formatted Excel workbook"
                >
                  <DocumentArrowUpIcon className="w-3.5 h-3.5 mr-1.5" />
                  Excel (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="flex items-center px-3 py-1.5 bg-teal-700 hover:bg-teal-600 text-white rounded-lg text-xs font-bold transition shadow"
                  title="Download CSV"
                >
                  CSV
                </button>
                <button
                  type="button"
                  onClick={handleExportZip}
                  className="flex items-center px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-xs font-bold transition shadow"
                  title="Download individual category TXT files in ZIP"
                >
                  <FolderOpenIcon className="w-3.5 h-3.5 mr-1.5" />
                  ZIP
                </button>
                <button
                  type="button"
                  onClick={handleCopyAll}
                  className="flex items-center px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-xs font-bold transition border border-gray-600"
                  title="Copy all targets with provider headers"
                >
                  {copiedKey === 'all' ? (
                    <CheckIcon className="w-3.5 h-3.5 text-green-400 mr-1" />
                  ) : (
                    <ClipboardIcon className="w-3.5 h-3.5 mr-1" />
                  )}
                  {copiedKey === 'all' ? 'Copied' : 'Copy All'}
                </button>
              </div>
            )}

            {viewMode === 'excluded' && excludedItems.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportExcludedCsv}
                  className="flex items-center px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white rounded-lg text-xs font-bold transition shadow"
                >
                  Download Excluded Log (.csv)
                </button>
              </div>
            )}
          </div>

          {/* MAIN RESULTS DISPLAY AREA */}
          <div className="flex-grow overflow-y-auto p-4 custom-scrollbar bg-gray-900/20">
            {results.length === 0 && cleanConsolidatedList.length === 0 && excludedItems.length === 0 && !isProcessing ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 py-12">
                <ArrowPathIcon className="w-14 h-14 mb-4 opacity-20 text-blue-400" />
                <h3 className="text-base font-bold text-gray-300 mb-1">
                  No Sorter Analysis Performed Yet
                </h3>
                <p className="text-xs text-gray-400 max-w-md text-center leading-relaxed">
                  Upload your target list from <strong>Excel (.xlsx)</strong>, <strong>CSV</strong>, or <strong>TXT</strong>, or paste emails / domains on the left, then click <strong>Start MX Analysis</strong>.
                </p>
                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-semibold text-blue-400 border border-gray-700 flex items-center gap-1.5 transition"
                  >
                    <DocumentArrowUpIcon className="w-4 h-4" />
                    Upload Excel / CSV / TXT
                  </button>
                </div>
              </div>
            ) : viewMode === 'clean-consolidated' ? (
              /* TAB 1: CLEAN CONSOLIDATED RESULTS VIEW */
              <div className="space-y-4">
                {/* CLEAN STATS BANNER */}
                {cleanStats && (
                  <div className="p-3.5 bg-emerald-950/40 border border-emerald-500/40 rounded-xl space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                        ✓ Clean Separation & Deduplication Applied
                      </span>
                      <span className="text-[11px] font-mono text-gray-300">
                        Evaluated {cleanStats.total.toLocaleString()} raw items → <strong className="text-emerald-400">{cleanConsolidatedList.length.toLocaleString()} clean unique business contacts</strong>
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                      <span className="px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-200 border border-emerald-600/40">
                        {cleanStats.duplicates.toLocaleString()} Duplicates Removed
                      </span>
                      <span className="px-2 py-0.5 rounded bg-red-950/60 text-red-300 border border-red-800/40">
                        {cleanStats.publicWebmail.toLocaleString()} Public Webmails Filtered
                      </span>
                      <span className="px-2 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/40">
                        {cleanStats.bank.toLocaleString()} Banks & Finance Filtered
                      </span>
                      <span className="px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/40" title="Webmaster, user, admin filtered; info, sales, order kept">
                        {cleanStats.junkUser.toLocaleString()} Junk Users Filtered (info/sales/order preserved)
                      </span>
                      <span className="px-2 py-0.5 rounded bg-blue-950/60 text-blue-300 border border-blue-800/40">
                        {cleanStats.govEdu.toLocaleString()} .Gov & .Edu Filtered
                      </span>
                    </div>
                  </div>
                )}

                {/* CATEGORY FILTER PILLS FOR CLEAN LIST */}
                <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar max-w-full pb-1">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('all')}
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold transition whitespace-nowrap ${
                      selectedCategory === 'all'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    All Providers ({cleanConsolidatedList.length})
                  </button>
                  {results.map(group => (
                    <button
                      key={group.provider}
                      type="button"
                      onClick={() => setSelectedCategory(group.provider)}
                      className={`text-xs px-2.5 py-1 rounded-full font-semibold transition whitespace-nowrap flex items-center gap-1 ${
                        selectedCategory === group.provider
                          ? 'bg-emerald-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
                      }`}
                    >
                      <span>{group.provider}</span>
                      <span className="text-[10px] opacity-75">
                        ({cleanConsolidatedList.filter(c => c.provider === group.provider).length})
                      </span>
                    </button>
                  ))}
                </div>

                {/* CLEAN CONTACTS TABLE */}
                {filteredCleanList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-gray-500">
                    <p className="text-xs text-gray-400">No clean contacts match your filter.</p>
                  </div>
                ) : (
                  <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden shadow-lg">
                    <div className="grid grid-cols-12 px-4 py-2.5 bg-gray-900/90 border-b border-gray-800 text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <div className="col-span-5">Clean Contact / Target</div>
                      <div className="col-span-3">Domain</div>
                      <div className="col-span-3">MX Provider</div>
                      <div className="col-span-1 text-right">Action</div>
                    </div>
                    <div className="divide-y divide-gray-800/80 max-h-[52vh] overflow-y-auto custom-scrollbar font-mono text-xs text-gray-300">
                      {filteredCleanList.map((item, idx) => {
                        const color = PROVIDER_COLORS[item.provider] || DEFAULT_COLOR;
                        const isCopied = copiedKey === item.target;
                        return (
                          <div key={idx} className="grid grid-cols-12 px-4 py-2 hover:bg-gray-800/50 items-center transition">
                            <div className="col-span-5 flex items-center gap-2 truncate font-medium text-emerald-300 select-all" title={item.target}>
                              <span className="text-[10px] text-gray-500 font-mono w-6 text-right shrink-0">{idx + 1}.</span>
                              <span className="truncate">{item.target}</span>
                            </div>
                            <div className="col-span-3 text-gray-400 truncate" title={item.domain}>
                              {item.domain}
                            </div>
                            <div className="col-span-3">
                              <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-bold truncate max-w-full ${color.badge}`}>
                                {item.provider}
                              </span>
                            </div>
                            <div className="col-span-1 text-right">
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(item.target);
                                    setCopiedKey(item.target);
                                    setTimeout(() => setCopiedKey(null), 1500);
                                  } catch {}
                                }}
                                className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition"
                                title="Copy contact"
                              >
                                {isCopied ? (
                                  <CheckIcon className="w-3.5 h-3.5 text-green-400" />
                                ) : (
                                  <ClipboardIcon className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : viewMode === 'categorized' ? (
              /* TAB 2: CATEGORIZED PROVIDER CARDS VIEW */
              <div className="space-y-4">
                {/* CATEGORY FILTER PILLS */}
                <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar max-w-full pb-1">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('all')}
                    className={`text-xs px-2.5 py-1 rounded-full font-semibold transition whitespace-nowrap ${
                      selectedCategory === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    All ({totalResultsCount.toLocaleString()})
                  </button>
                  {results.map(group => (
                    <button
                      key={group.provider}
                      type="button"
                      onClick={() => setSelectedCategory(group.provider)}
                      className={`text-xs px-2.5 py-1 rounded-full font-semibold transition whitespace-nowrap flex items-center gap-1 ${
                        selectedCategory === group.provider
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
                      }`}
                    >
                      <span>{group.provider}</span>
                      <span className="text-[10px] opacity-75">({group.emails.length})</span>
                    </button>
                  ))}
                </div>

                {filteredResults.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 py-12">
                    <p className="text-sm text-gray-400">No targets matched your search query.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredResults.map((group) => {
                      const color = PROVIDER_COLORS[group.provider] || DEFAULT_COLOR;
                      const isCopied = copiedKey === group.provider;

                      return (
                        <div
                          key={group.provider}
                          className={`${color.bg} border ${color.border} rounded-xl p-4 flex flex-col shadow-lg transition-all hover:border-blue-500/50`}
                        >
                          {/* CATEGORY CARD HEADER */}
                          <div className="flex justify-between items-start mb-2.5 pb-2 border-b border-gray-700/50">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-bold ${color.text}`}>
                                  {group.provider}
                                </span>
                                <span className={`text-[11px] px-2 py-0.5 rounded-full font-mono font-bold ${color.badge}`}>
                                  {group.emails.length.toLocaleString()}
                                </span>
                              </div>
                              <span className="text-[10px] text-gray-400">
                                {((group.emails.length / totalResultsCount) * 100).toFixed(1)}% of targets
                              </span>
                            </div>

                            {/* CARD ACTION BUTTONS */}
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleCopyCategory(group)}
                                className="p-1.5 rounded bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white transition text-xs border border-gray-700"
                                title={`Copy ${group.provider} targets`}
                              >
                                {isCopied ? (
                                  <CheckIcon className="w-3.5 h-3.5 text-green-400" />
                                ) : (
                                  <ClipboardIcon className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExportCategoryTxt(group)}
                                className="p-1.5 rounded bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white transition text-xs border border-gray-700"
                                title={`Download ${group.provider} as TXT`}
                              >
                                <FolderOpenIcon className="w-3.5 h-3.5 text-blue-400" />
                              </button>
                            </div>
                          </div>

                          {/* SCROLLABLE TARGETS LIST */}
                          <div className="flex-grow h-40 overflow-y-auto font-mono text-[11px] text-gray-300 bg-gray-950/70 p-2.5 rounded-lg border border-gray-800 custom-scrollbar space-y-1">
                            {group.emails.map((item, idx) => (
                              <div
                                key={idx}
                                className="truncate hover:text-white hover:bg-gray-800/50 px-1 py-0.5 rounded transition select-all"
                                title={item}
                              >
                                {item}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* TAB 3: EXCLUDED & FILTERED AUDIT VIEW */
              <div className="space-y-4">
                <div className="p-3 bg-purple-950/40 border border-purple-600/40 rounded-xl flex items-center justify-between text-xs text-purple-200">
                  <span>
                    Excluded targets filtered by business quality rules (public webmails, financial banks, junk users like webmaster/user, gov/edu, or duplicate entries).
                  </span>
                  <span className="font-bold font-mono text-purple-300">
                    {excludedItems.length} Excluded
                  </span>
                </div>

                {filteredExcludedItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-gray-500">
                    <p className="text-xs text-gray-400">No excluded items found.</p>
                  </div>
                ) : (
                  <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden shadow-lg">
                    <div className="grid grid-cols-12 px-4 py-2.5 bg-gray-900/90 border-b border-gray-800 text-xs font-bold text-gray-400 uppercase tracking-wider">
                      <div className="col-span-5">Excluded Item / Target</div>
                      <div className="col-span-3">Category</div>
                      <div className="col-span-4">Reason</div>
                    </div>
                    <div className="divide-y divide-gray-800/80 max-h-[55vh] overflow-y-auto custom-scrollbar font-mono text-xs text-gray-300">
                      {filteredExcludedItems.map((item, idx) => (
                        <div key={idx} className="grid grid-cols-12 px-4 py-2 hover:bg-gray-800/40 items-center transition">
                          <div className="col-span-5 truncate text-red-300 select-all" title={item.item}>
                            <span className="text-[10px] text-gray-500 w-6 inline-block">{idx + 1}.</span>
                            {item.item}
                          </div>
                          <div className="col-span-3">
                            <span className="inline-block text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-950 text-purple-300 border border-purple-800/50 uppercase">
                              {item.category.replace('_', ' ')}
                            </span>
                          </div>
                          <div className="col-span-4 text-gray-400 text-[11px] truncate" title={item.reason}>
                            {item.reason}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MXSorter;
