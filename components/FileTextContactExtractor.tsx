import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  extractContactsFromText,
  extractContactsFromFile,
  checkDomainMX,
  type ExtractedContactItem,
  type ContactExtractionFilterOptions,
  type ContactType,
  type MXCheckResult,
  type MXStatus
} from '../services/contactExtractorService';
import type { ExtractedEmail } from '../types';
import {
  evaluateCleanTarget,
  CleanFilterConfig,
  DEFAULT_CLEAN_FILTER_CONFIG
} from '../services/businessEmailFilter';
import {
  Mail,
  Phone,
  Globe,
  FileText,
  Upload,
  Clipboard,
  Check,
  Download,
  Trash2,
  RefreshCw,
  Search,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Send,
  Sparkles,
  Info,
  Filter,
  Shield
} from 'lucide-react';

interface FileTextContactExtractorProps {
  showToast: (message: string) => void;
  onSendToValidator?: (emails: string[]) => void;
  onPushToMainLeads?: (leads: ExtractedEmail[]) => void;
}

const SAMPLE_CONTACT_TEXT = `--- Industrial Supplier & Partner Contacts ---
Bavaria Steel GmbH & Co. KG
Contact: info@bavaria-steel.de
Sales: sales.europe@bavaria-steel.de
HQ Telephone: +49 (0) 89 1234-5678
Mobile WhatsApp: +49 170 9876543
Webmail Login: https://webmail.bavaria-steel.de
Corporate Website: https://www.bavaria-steel.de/contact

Apex Industrial Tooling Ltd (UK)
Procurement Manager: david.h@apex-industrial.co.uk
Direct Office: +44 20 7946 0919
UK Toll-Free: 0800 123 4567
Exchange Webmail: https://mail.apex-industrial.co.uk/owa
Website: http://www.apex-industrial.co.uk

Shanghai Precision Casting Corp
Export Representative: contact@shanghai-casting.cn
Overseas Hotline: +86 21 6888 1234
Cell: +86 138 0013 8000
Webmail Server: mail.shanghai-casting.cn
Portal: www.shanghai-casting.cn/en

American Fasteners & Alloys Inc
Customer Service: support@fastenersalloys.com
Orders: orders@fastenersalloys.com
Toll-Free USA: 1-800-555-0199
Main Office: (312) 555-0143
Webmail Client: https://roundcube.fastenersalloys.com
Website: https://fastenersalloys.com/about-us`;

export const FileTextContactExtractor: React.FC<FileTextContactExtractorProps> = ({
  showToast,
  onSendToValidator,
  onPushToMainLeads
}) => {
  // Input Selection: 'paste' | 'file'
  const [inputTab, setInputTab] = useState<'paste' | 'file'>('paste');
  const [pastedText, setPastedText] = useState<string>('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileRawTextCache, setFileRawTextCache] = useState<{ [name: string]: string }>({});

  // Extraction Checkboxes (User requested: "if i check email or phone or webit, it will extract the content")
  const [extractEmail, setExtractEmail] = useState<boolean>(true);
  const [extractPhone, setExtractPhone] = useState<boolean>(true);
  const [extractWeb, setExtractWeb] = useState<boolean>(true); // "webit" (Webmail + Websites)
  const [webmailOnly, setWebmailOnly] = useState<boolean>(false);
  const [deduplicate, setDeduplicate] = useState<boolean>(true);

  // Smart Clean & Deduplication Options (User requested: remove public emails, banks, junk emails like webmaster/user leaving info/sales/order, remove gov/edu and duplicate URLs)
  const [cleanBusinessFilter, setCleanBusinessFilter] = useState<boolean>(true);
  const [cleanFilterConfig, setCleanFilterConfig] = useState<CleanFilterConfig>({
    removePublicEmails: true,
    removeBanks: true,
    removeJunkUsers: true, // keeps info, sales, order!
    removeGovEdu: true,
    removeDuplicates: true
  });
  const [showCleanConfig, setShowCleanConfig] = useState<boolean>(false);
  const [cleanAuditStats, setCleanAuditStats] = useState({
    duplicatesRemoved: 0,
    publicExcluded: 0,
    banksExcluded: 0,
    junkExcluded: 0,
    govEduExcluded: 0,
    totalRawExtracted: 0
  });

  // Extracted Results State
  const [contacts, setContacts] = useState<ExtractedContactItem[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [activeFilterType, setActiveFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [allCopied, setAllCopied] = useState<boolean>(false);

  // Quick MX Check State
  const [autoCheckMX, setAutoCheckMX] = useState<boolean>(true);
  const [isCheckingMX, setIsCheckingMX] = useState<boolean>(false);
  const [mxProgress, setMxProgress] = useState<{ current: number; total: number } | null>(null);
  const domainMXCache = useRef<Map<string, MXCheckResult>>(new Map());
  const abortMXRef = useRef<boolean>(false);

  // References to eliminate circular re-render loops
  const contactsRef = useRef<ExtractedContactItem[]>([]);
  contactsRef.current = contacts;
  const pastedTextRef = useRef(pastedText);
  pastedTextRef.current = pastedText;
  const selectedFilesRef = useRef(selectedFiles);
  selectedFilesRef.current = selectedFiles;
  const fileRawTextCacheRef = useRef(fileRawTextCache);
  fileRawTextCacheRef.current = fileRawTextCache;

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Perform Quick MX Check on extracted emails (stable identity - no contacts dependency)
  const performMXCheck = useCallback(async (
    targetContacts?: ExtractedContactItem[],
    forceAll = false
  ) => {
    const list = targetContacts || contactsRef.current;
    const emailItems = list.filter(c => c.type === 'email');
    if (emailItems.length === 0) {
      if (forceAll) {
        showToast("No extracted email addresses found to check MX.");
      }
      return;
    }

    const itemsToCheck = forceAll
      ? emailItems
      : emailItems.filter(c => !c.mxStatus || c.mxStatus === 'unchecked');

    if (itemsToCheck.length === 0) {
      if (forceAll) {
        showToast("All extracted email domains have already been MX verified.");
      }
      return;
    }

    const uniqueDomains = Array.from(
      new Set(itemsToCheck.map(e => e.domain?.toLowerCase().trim()).filter(Boolean))
    ) as string[];

    if (uniqueDomains.length === 0) return;

    abortMXRef.current = false;
    setIsCheckingMX(true);
    setMxProgress({ current: 0, total: uniqueDomains.length });

    // Mark affected items as 'checking'
    setContacts(prev => prev.map(item => {
      if (item.type === 'email' && item.domain && uniqueDomains.includes(item.domain.toLowerCase())) {
        return { ...item, mxStatus: 'checking' };
      }
      return item;
    }));

    const BATCH_SIZE = 5;
    let processed = 0;
    let validCount = 0;
    let deadCount = 0;

    for (let i = 0; i < uniqueDomains.length; i += BATCH_SIZE) {
      if (abortMXRef.current) break;

      const batch = uniqueDomains.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (domain) => {
          const res = await checkDomainMX(domain, domainMXCache.current);
          return { domain, res };
        })
      );

      processed += batch.length;
      setMxProgress({ current: Math.min(processed, uniqueDomains.length), total: uniqueDomains.length });

      // Apply batch results to contacts
      setContacts(prev => prev.map(item => {
        if (item.type === 'email' && item.domain) {
          const match = batchResults.find(b => b.domain.toLowerCase() === item.domain?.toLowerCase());
          if (match) {
            if (match.res.hasMx) validCount++;
            else deadCount++;
            return {
              ...item,
              mxStatus: match.res.hasMx ? 'valid' : 'invalid',
              mxProvider: match.res.provider,
              mxDiagnostic: match.res.diagnostic,
              mxServers: match.res.servers
            };
          }
        }
        return item;
      }));
    }

    setIsCheckingMX(false);
    setMxProgress(null);
    if (!abortMXRef.current && forceAll) {
      showToast(`Quick MX check finished: ${validCount} active MX, ${deadCount} dead/no-MX.`);
    }
  }, [showToast]);

  // Check single email MX
  const checkSingleEmailMX = async (item: ExtractedContactItem) => {
    if (item.type !== 'email' || !item.domain) return;
    const domain = item.domain.toLowerCase();

    setContacts(prev => prev.map(c => c.id === item.id ? { ...c, mxStatus: 'checking' } : c));
    const res = await checkDomainMX(domain, domainMXCache.current);

    setContacts(prev => prev.map(c => {
      if (c.type === 'email' && c.domain?.toLowerCase() === domain) {
        return {
          ...c,
          mxStatus: res.hasMx ? 'valid' : 'invalid',
          mxProvider: res.provider,
          mxDiagnostic: res.diagnostic,
          mxServers: res.servers
        };
      }
      return c;
    }));

    showToast(`MX for ${domain}: ${res.hasMx ? `Active (${res.provider})` : 'Dead / No MX'}`);
  };

  // Run extraction using current filters and inputs
  const runExtraction = useCallback(async () => {
    // If no checkbox is checked
    if (!extractEmail && !extractPhone && !extractWeb) {
      setContacts([]);
      return;
    }

    const currentText = pastedTextRef.current;
    const currentFiles = selectedFilesRef.current;

    if (!currentText.trim() && currentFiles.length === 0) {
      setContacts([]);
      return;
    }

    setIsProcessing(true);
    abortMXRef.current = true;
    setIsCheckingMX(false);
    setMxProgress(null);

    const filterOptions: ContactExtractionFilterOptions = {
      extractEmail,
      extractPhone,
      extractWeb,
      webmailOnly,
      deduplicate
    };

    try {
      const allExtracted: ExtractedContactItem[] = [];

      // 1. Process Pasted Text if present
      if (currentText.trim().length > 0) {
        const textItems = extractContactsFromText(currentText, filterOptions, 'Pasted Text');
        allExtracted.push(...textItems);
      }

      // 2. Process Uploaded Files if present
      if (currentFiles.length > 0) {
        for (const file of currentFiles) {
          let rawText = fileRawTextCacheRef.current[file.name];
          if (rawText) {
            const fileItems = extractContactsFromText(rawText, filterOptions, file.name);
            allExtracted.push(...fileItems);
          } else {
            const res = await extractContactsFromFile(file, filterOptions);
            fileRawTextCacheRef.current[file.name] = res.rawText;
            setFileRawTextCache(prev => ({ ...prev, [file.name]: res.rawText }));
            allExtracted.push(...res.contacts);
          }
        }
      }

      let candidateItems: ExtractedContactItem[] = [];
      let dupCount = 0;
      let pubCount = 0;
      let bankCount = 0;
      let junkCount = 0;
      let govEduCount = 0;

      // Filter step: evaluate each item against clean criteria if enabled
      for (const item of allExtracted) {
        if (cleanBusinessFilter) {
          if (item.type === 'email') {
            const evalRes = evaluateCleanTarget(item.value, cleanFilterConfig);
            if (!evalRes.isClean) {
              if (evalRes.category === 'public_webmail') pubCount++;
              else if (evalRes.category === 'bank') bankCount++;
              else if (evalRes.category === 'webmaster_bot') junkCount++;
              else if (evalRes.category === 'government' || evalRes.category === 'education') govEduCount++;
              continue;
            }
          } else if (item.type === 'webmail' || item.type === 'website') {
            const targetDomainOrUrl = item.domain || item.value;
            const evalRes = evaluateCleanTarget(targetDomainOrUrl, cleanFilterConfig);
            if (!evalRes.isClean) {
              if (evalRes.category === 'public_webmail') pubCount++;
              else if (evalRes.category === 'bank') bankCount++;
              else if (evalRes.category === 'government' || evalRes.category === 'education') govEduCount++;
              continue;
            }
          }
        }
        candidateItems.push(item);
      }

      let finalItems: ExtractedContactItem[] = [];

      // Final deduplication (with URL protocol / trailing slash normalization)
      const shouldDeduplicate = deduplicate || (cleanBusinessFilter && cleanFilterConfig.removeDuplicates);
      if (shouldDeduplicate) {
        const seen = new Set<string>();
        finalItems = candidateItems.filter(item => {
          let normalizedKey = item.normalizedValue.toLowerCase().trim();
          if (item.type === 'website' || item.type === 'webmail') {
            // Strip protocol and trailing slashes for pristine URL deduplication
            normalizedKey = normalizedKey
              .replace(/^https?:\/\//i, '')
              .replace(/^www\./i, '')
              .replace(/\/+$/, '');
          }
          const key = `${item.type}:${normalizedKey}`;
          if (seen.has(key)) {
            dupCount++;
            return false;
          }
          seen.add(key);
          return true;
        });
      } else {
        finalItems = candidateItems;
      }

      setCleanAuditStats({
        duplicatesRemoved: dupCount,
        publicExcluded: pubCount,
        banksExcluded: bankCount,
        junkExcluded: junkCount,
        govEduExcluded: govEduCount,
        totalRawExtracted: allExtracted.length
      });

      setContacts(finalItems);

      // Auto MX Check trigger for newly extracted emails
      if (autoCheckMX && finalItems.some(item => item.type === 'email')) {
        performMXCheck(finalItems, false);
      }
    } catch (err: any) {
      console.error("Extraction error:", err);
      showToast(`Extraction notice: ${err?.message || 'Error parsing content'}`);
    } finally {
      setIsProcessing(false);
    }
  }, [
    extractEmail,
    extractPhone,
    extractWeb,
    webmailOnly,
    deduplicate,
    cleanBusinessFilter,
    cleanFilterConfig,
    autoCheckMX,
    performMXCheck,
    showToast
  ]);

  // Reactive trigger: when filter checkboxes change, re-run extraction
  useEffect(() => {
    runExtraction();
  }, [
    extractEmail,
    extractPhone,
    extractWeb,
    webmailOnly,
    deduplicate,
    cleanBusinessFilter,
    cleanFilterConfig,
    runExtraction
  ]);

  // Debounced trigger when pasted text changes (avoids re-rendering on every keystroke)
  useEffect(() => {
    const timer = setTimeout(() => {
      runExtraction();
    }, 280);
    return () => clearTimeout(timer);
  }, [pastedText, runExtraction]);

  // Reactive trigger when files are added or removed
  useEffect(() => {
    runExtraction();
  }, [selectedFiles, runExtraction]);

  // Handle file selection
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const filesArray = Array.from(e.target.files);
    setSelectedFiles(prev => [...prev, ...filesArray]);
    showToast(`Loaded ${filesArray.length} file(s). Extracting contacts...`);
    e.target.value = '';
  };

  const handleDropFiles = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files);
      setSelectedFiles(prev => [...prev, ...filesArray]);
      showToast(`Loaded ${filesArray.length} dropped file(s). Extracting contacts...`);
    }
  };

  const handleRemoveFile = (fileName: string) => {
    setSelectedFiles(prev => prev.filter(f => f.name !== fileName));
    setFileRawTextCache(prev => {
      const copy = { ...prev };
      delete copy[fileName];
      return copy;
    });
    showToast(`Removed ${fileName}`);
  };

  const handleClearAll = () => {
    abortMXRef.current = true;
    setIsCheckingMX(false);
    setMxProgress(null);
    setPastedText('');
    setSelectedFiles([]);
    setFileRawTextCache({});
    setContacts([]);
    showToast("Cleared all inputs and extracted contacts.");
  };

  const handleLoadSample = () => {
    setPastedText(SAMPLE_CONTACT_TEXT);
    setInputTab('paste');
    showToast("Loaded sample contacts with emails, phone numbers, and webmail links!");
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setPastedText(text);
        setInputTab('paste');
        showToast("Pasted text from clipboard!");
      } else {
        showToast("Clipboard is empty.");
      }
    } catch {
      showToast("Unable to read clipboard. Please paste manually into the box.");
    }
  };

  // Metrics
  const emailCount = useMemo(() => contacts.filter(c => c.type === 'email').length, [contacts]);
  const phoneCount = useMemo(() => contacts.filter(c => c.type === 'phone').length, [contacts]);
  const webmailCount = useMemo(() => contacts.filter(c => c.type === 'webmail').length, [contacts]);
  const websiteCount = useMemo(() => contacts.filter(c => c.type === 'website').length, [contacts]);
  const webTotalCount = webmailCount + websiteCount;

  // MX Check Metrics
  const validMXCount = useMemo(() => contacts.filter(c => c.type === 'email' && c.mxStatus === 'valid').length, [contacts]);
  const deadMXCount = useMemo(() => contacts.filter(c => c.type === 'email' && c.mxStatus === 'invalid').length, [contacts]);
  const uncheckedMXCount = useMemo(() => contacts.filter(c => c.type === 'email' && (!c.mxStatus || c.mxStatus === 'unchecked')).length, [contacts]);

  // Filtered Contacts List
  const filteredContacts = useMemo(() => {
    return contacts.filter(item => {
      // Type filter
      if (activeFilterType === 'email' && item.type !== 'email') return false;
      if (activeFilterType === 'phone' && item.type !== 'phone') return false;
      if (activeFilterType === 'webmail' && item.type !== 'webmail') return false;
      if (activeFilterType === 'website' && item.type !== 'website') return false;
      if (activeFilterType === 'web' && item.type !== 'webmail' && item.type !== 'website') return false;
      if (activeFilterType === 'mx-valid' && (item.type !== 'email' || item.mxStatus !== 'valid')) return false;
      if (activeFilterType === 'mx-invalid' && (item.type !== 'email' || item.mxStatus !== 'invalid')) return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.value.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.source.toLowerCase().includes(q) ||
          (item.domain && item.domain.toLowerCase().includes(q)) ||
          (item.mxProvider && item.mxProvider.toLowerCase().includes(q))
        );
      }

      return true;
    });
  }, [contacts, activeFilterType, searchQuery]);

  // Purge emails with dead / no MX records
  const handlePurgeDeadMX = () => {
    const deadEmails = contacts.filter(c => c.type === 'email' && c.mxStatus === 'invalid');
    if (deadEmails.length === 0) {
      showToast("No dead or unreachable MX emails found to remove.");
      return;
    }
    setContacts(prev => prev.filter(c => !(c.type === 'email' && c.mxStatus === 'invalid')));
    showToast(`Purged ${deadEmails.length} dead/unreachable email(s).`);
  };

  // Copy Valid MX Emails
  const handleCopyValidMX = () => {
    const validEmails = contacts.filter(c => c.type === 'email' && c.mxStatus === 'valid');
    if (validEmails.length === 0) {
      showToast("No verified active MX emails found to copy.");
      return;
    }
    navigator.clipboard.writeText(validEmails.map(c => c.value).join('\n'));
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
    showToast(`Copied ${validEmails.length} verified active MX emails!`);
  };

  // Copy Single
  const handleCopySingle = (item: ExtractedContactItem) => {
    navigator.clipboard.writeText(item.value);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1800);
    showToast(`Copied ${item.category}: ${item.value}`);
  };

  // Copy All or Filtered
  const handleCopyAll = (typeOnly?: ContactType | 'web') => {
    let toCopy = filteredContacts;
    if (typeOnly === 'web') {
      toCopy = contacts.filter(c => c.type === 'webmail' || c.type === 'website');
    } else if (typeOnly) {
      toCopy = contacts.filter(c => c.type === typeOnly);
    }

    if (toCopy.length === 0) {
      showToast("No items available to copy.");
      return;
    }

    const text = toCopy.map(c => c.value).join('\n');
    navigator.clipboard.writeText(text);
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
    showToast(`Copied ${toCopy.length} items to clipboard!`);
  };

  // Export to Excel (.xlsx)
  const handleExportExcel = () => {
    if (contacts.length === 0) {
      showToast("No extracted contacts to export.");
      return;
    }

    const rows = contacts.map((c, index) => ({
      Index: index + 1,
      Type: c.type.toUpperCase(),
      Contact: c.value,
      Normalized: c.normalizedValue,
      Category: c.category,
      'MX Status': c.type === 'email' ? (c.mxStatus === 'valid' ? 'Active MX' : c.mxStatus === 'invalid' ? 'Dead / No MX' : 'Unchecked') : 'N/A',
      'MX Provider': c.mxProvider || '',
      'MX Diagnostic': c.mxDiagnostic || '',
      Domain: c.domain || '',
      Source: c.source
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Extracted Contacts");
    XLSX.writeFile(workbook, `extracted_contacts_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast(`Exported ${contacts.length} contacts to Excel (.xlsx)!`);
  };

  // Export to CSV (.csv)
  const handleExportCSV = () => {
    if (contacts.length === 0) {
      showToast("No extracted contacts to export.");
      return;
    }

    const headers = ['Type', 'Contact', 'Normalized', 'Category', 'MX Status', 'MX Provider', 'Domain', 'Source'];
    const rows = contacts.map(c => [
      c.type,
      `"${c.value.replace(/"/g, '""')}"`,
      `"${c.normalizedValue.replace(/"/g, '""')}"`,
      `"${c.category.replace(/"/g, '""')}"`,
      `"${c.type === 'email' ? (c.mxStatus === 'valid' ? 'Active MX' : c.mxStatus === 'invalid' ? 'Dead / No MX' : 'Unchecked') : 'N/A'}"`,
      `"${(c.mxProvider || '').replace(/"/g, '""')}"`,
      `"${(c.domain || '').replace(/"/g, '""')}"`,
      `"${c.source.replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extracted_contacts_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${contacts.length} contacts to CSV!`);
  };

  // Export to Plain Text (.txt)
  const handleExportTXT = () => {
    if (contacts.length === 0) {
      showToast("No extracted contacts to export.");
      return;
    }

    const content = contacts.map(c => c.value).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extracted_contacts_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${contacts.length} contacts to TXT!`);
  };

  // Send Emails to Validator
  const handleSendEmailsToValidator = () => {
    const emails = contacts.filter(c => c.type === 'email').map(c => c.value);
    if (emails.length === 0) {
      showToast("No extracted emails found in current results.");
      return;
    }
    if (onSendToValidator) {
      onSendToValidator(emails);
    }
  };

  // Push Extracted Emails to Main Lead Extractor Results
  const handlePushToMainLeads = () => {
    const emails = contacts.filter(c => c.type === 'email');
    if (emails.length === 0) {
      showToast("No extracted emails found to push.");
      return;
    }
    if (onPushToMainLeads) {
      const converted: ExtractedEmail[] = emails.map(e => ({
        email: e.value,
        sourceUrl: e.source,
        companyName: e.domain ? e.domain.split('.')[0].toUpperCase() : 'Company Contact',
        country: 'Global / Parsed',
        isValid: true
      }));
      onPushToMainLeads(converted);
      showToast(`Merged ${converted.length} emails into the Main Lead Engine table!`);
    }
  };

  return (
    <div className="space-y-6">
      {/* HEADER CARD */}
      <div className="bg-gradient-to-r from-gray-800 via-gray-800/90 to-gray-900 border border-gray-700 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-teal-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                File & Text Multi-Contact Extractor
              </h2>
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30">
                Email • Phone • Webmail
              </span>
            </div>
            <p className="text-sm text-gray-400 mt-1">
              Select files or paste content containing emails, telephone numbers, and webmail links. Toggle checkboxes to dynamically extract and isolate contacts.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleLoadSample}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-700/70 hover:bg-gray-700 text-gray-200 border border-gray-600 transition flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              Load Sample Text
            </button>
            <button
              type="button"
              onClick={handlePasteFromClipboard}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-700/70 hover:bg-gray-700 text-gray-200 border border-gray-600 transition flex items-center gap-1.5"
            >
              <Clipboard className="w-3.5 h-3.5 text-blue-400" />
              Paste Clipboard
            </button>
            {(pastedText || selectedFiles.length > 0) && (
              <button
                type="button"
                onClick={handleClearAll}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-900/30 hover:bg-red-900/50 text-red-300 border border-red-700/50 transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* EXTRACTION CHECKBOXES BAR */}
        <div className="mt-5 pt-4 border-t border-gray-700/60 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400 mr-1 flex items-center gap-1">
              <Check className="w-3.5 h-3.5 text-teal-400" />
              Extract What:
            </span>

            {/* EMAIL CHECKBOX */}
            <label
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition text-xs font-bold ${
                extractEmail
                  ? 'bg-blue-600/30 border-blue-500 text-blue-200 shadow-sm'
                  : 'bg-gray-800/80 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              <input
                type="checkbox"
                checked={extractEmail}
                onChange={(e) => setExtractEmail(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 focus:ring-offset-0 bg-gray-900 border-gray-600"
              />
              <Mail className="w-3.5 h-3.5 text-blue-400" />
              <span>Email Addresses</span>
              {emailCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-mono">
                  {emailCount}
                </span>
              )}
            </label>

            {/* PHONE CHECKBOX */}
            <label
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition text-xs font-bold ${
                extractPhone
                  ? 'bg-emerald-600/30 border-emerald-500 text-emerald-200 shadow-sm'
                  : 'bg-gray-800/80 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              <input
                type="checkbox"
                checked={extractPhone}
                onChange={(e) => setExtractPhone(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 focus:ring-offset-0 bg-gray-900 border-gray-600"
              />
              <Phone className="w-3.5 h-3.5 text-emerald-400" />
              <span>Phone Numbers</span>
              {phoneCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
                  {phoneCount}
                </span>
              )}
            </label>

            {/* WEBMAIL & WEBIT CHECKBOX */}
            <label
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition text-xs font-bold ${
                extractWeb
                  ? 'bg-purple-600/30 border-purple-500 text-purple-200 shadow-sm'
                  : 'bg-gray-800/80 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              <input
                type="checkbox"
                checked={extractWeb}
                onChange={(e) => setExtractWeb(e.target.checked)}
                className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 focus:ring-offset-0 bg-gray-900 border-gray-600"
              />
              <Globe className="w-3.5 h-3.5 text-purple-400" />
              <span>Webmail & Websites (&quot;Webit&quot;)</span>
              {webTotalCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-mono">
                  {webTotalCount}
                </span>
              )}
            </label>

            {/* WEBMAIL ONLY SUB-OPTION */}
            {extractWeb && (
              <label className="flex items-center gap-1.5 text-[11px] text-gray-300 cursor-pointer ml-1 bg-gray-900/60 px-2 py-1 rounded border border-gray-700">
                <input
                  type="checkbox"
                  checked={webmailOnly}
                  onChange={(e) => setWebmailOnly(e.target.checked)}
                  className="w-3.5 h-3.5 rounded text-purple-500 bg-gray-800 border-gray-600"
                />
                <span>Webmail portals only</span>
              </label>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <label
              className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer select-none"
              title="Automatically test DNS MX records for all extracted email domains"
            >
              <input
                type="checkbox"
                checked={autoCheckMX}
                onChange={(e) => {
                  const val = e.target.checked;
                  setAutoCheckMX(val);
                  if (val && uncheckedMXCount > 0) {
                    performMXCheck(contacts, false);
                  }
                }}
                className="w-4 h-4 rounded text-blue-500 bg-gray-900 border-gray-600 focus:ring-0"
              />
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                Auto MX Check
              </span>
            </label>

            <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={deduplicate}
                onChange={(e) => setDeduplicate(e.target.checked)}
                className="w-4 h-4 rounded text-teal-600 bg-gray-900 border-gray-600"
              />
              <span>Deduplicate values</span>
            </label>

            <button
              type="button"
              onClick={() => performMXCheck(contacts, true)}
              disabled={isCheckingMX || emailCount === 0}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow transition flex items-center gap-1.5 disabled:opacity-50"
              title="Quickly test MX records via DNS-over-HTTPS"
            >
              {isCheckingMX ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 text-blue-200" />
              )}
              {isCheckingMX
                ? `Checking MX (${mxProgress?.current || 0}/${mxProgress?.total || 0})...`
                : 'Quick MX Check'}
            </button>

            <button
              type="button"
              onClick={() => runExtraction()}
              disabled={isProcessing}
              className="px-4 py-1.5 text-xs font-bold rounded-lg bg-teal-600 hover:bg-teal-500 text-white shadow transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
              Extract Content
            </button>
          </div>
        </div>

        {/* SMART CLEAN & DEDUPLICATION OPTIONS PANEL */}
        <div className="mt-4 pt-3.5 border-t border-gray-700/60 bg-gray-900/40 -mx-6 -mb-6 px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={cleanBusinessFilter}
                  onChange={(e) => setCleanBusinessFilter(e.target.checked)}
                  className="w-4 h-4 rounded text-teal-500 bg-gray-900 border-gray-600 focus:ring-0"
                />
                <span className="text-xs font-bold text-teal-300 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-teal-400" />
                  Smart Clean & Separation
                </span>
              </label>
              <span className="text-[11px] text-gray-400 hidden md:inline">
                • Strips public emails, banks, junk users (<code className="text-teal-300">webmaster</code>, <code className="text-teal-300">user</code>, while keeping <code className="text-emerald-300">info</code>, <code className="text-emerald-300">sales</code>, <code className="text-emerald-300">order</code>), .gov/.edu & duplicates
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowCleanConfig(!showCleanConfig)}
              className="text-xs text-teal-400 hover:text-teal-300 underline font-medium self-start sm:self-auto"
            >
              {showCleanConfig ? 'Hide Filter Rules' : 'Customize Filter Rules'}
            </button>
          </div>

          {/* Audit Metrics Badges */}
          {(cleanAuditStats.duplicatesRemoved > 0 ||
            cleanAuditStats.publicExcluded > 0 ||
            cleanAuditStats.banksExcluded > 0 ||
            cleanAuditStats.junkExcluded > 0 ||
            cleanAuditStats.govEduExcluded > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-gray-800/80 text-[10px] font-mono">
              {cleanAuditStats.duplicatesRemoved > 0 && (
                <span className="px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                  {cleanAuditStats.duplicatesRemoved} Duplicates Stripped
                </span>
              )}
              {cleanAuditStats.publicExcluded > 0 && (
                <span className="px-2 py-0.5 rounded bg-red-950/80 text-red-300 border border-red-800/60">
                  {cleanAuditStats.publicExcluded} Public Mailboxes Excluded
                </span>
              )}
              {cleanAuditStats.banksExcluded > 0 && (
                <span className="px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60">
                  {cleanAuditStats.banksExcluded} Banks Excluded
                </span>
              )}
              {cleanAuditStats.junkExcluded > 0 && (
                <span className="px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/60" title="Protected commercial addresses like info@, sales@, order@ are preserved">
                  {cleanAuditStats.junkExcluded} Junk Users Excluded (Preserved Info/Sales/Order)
                </span>
              )}
              {cleanAuditStats.govEduExcluded > 0 && (
                <span className="px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/60">
                  {cleanAuditStats.govEduExcluded} .Gov/.Edu Excluded
                </span>
              )}
            </div>
          )}

          {/* Detailed rule checkboxes */}
          {showCleanConfig && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 mt-3 pt-2.5 border-t border-gray-800 text-xs text-gray-300">
              <label className="flex items-center gap-2 cursor-pointer hover:text-white">
                <input
                  type="checkbox"
                  checked={cleanFilterConfig.removePublicEmails}
                  onChange={(e) => setCleanFilterConfig(prev => ({ ...prev, removePublicEmails: e.target.checked }))}
                  disabled={!cleanBusinessFilter}
                  className="rounded border-gray-600 text-teal-600 focus:ring-0 w-3.5 h-3.5 bg-gray-800"
                />
                <span>Remove public emails (Gmail, Yahoo, Outlook)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer hover:text-white">
                <input
                  type="checkbox"
                  checked={cleanFilterConfig.removeBanks}
                  onChange={(e) => setCleanFilterConfig(prev => ({ ...prev, removeBanks: e.target.checked }))}
                  disabled={!cleanBusinessFilter}
                  className="rounded border-gray-600 text-teal-600 focus:ring-0 w-3.5 h-3.5 bg-gray-800"
                />
                <span>Remove banks & financial institutions</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer hover:text-white">
                <input
                  type="checkbox"
                  checked={cleanFilterConfig.removeJunkUsers}
                  onChange={(e) => setCleanFilterConfig(prev => ({ ...prev, removeJunkUsers: e.target.checked }))}
                  disabled={!cleanBusinessFilter}
                  className="rounded border-gray-600 text-teal-600 focus:ring-0 w-3.5 h-3.5 bg-gray-800"
                />
                <span>Remove junk mailboxes (keeps info, sales, order)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer hover:text-white">
                <input
                  type="checkbox"
                  checked={cleanFilterConfig.removeGovEdu}
                  onChange={(e) => setCleanFilterConfig(prev => ({ ...prev, removeGovEdu: e.target.checked }))}
                  disabled={!cleanBusinessFilter}
                  className="rounded border-gray-600 text-teal-600 focus:ring-0 w-3.5 h-3.5 bg-gray-800"
                />
                <span>Remove Government (.gov) & Education (.edu)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer hover:text-white">
                <input
                  type="checkbox"
                  checked={cleanFilterConfig.removeDuplicates}
                  onChange={(e) => setCleanFilterConfig(prev => ({ ...prev, removeDuplicates: e.target.checked }))}
                  disabled={!cleanBusinessFilter}
                  className="rounded border-gray-600 text-teal-600 focus:ring-0 w-3.5 h-3.5 bg-gray-800"
                />
                <span>Remove duplicate emails and URLs</span>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* INPUT SECTION (DUAL: SELECT FILE & PASTE TEXT) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* INPUT PANEL (LEFT COLUMN) */}
        <div className="lg:col-span-5 bg-gray-800/60 border border-gray-700 rounded-xl p-5 shadow-lg space-y-4">
          {/* TAB SWITCHER */}
          <div className="flex items-center justify-between pb-3 border-b border-gray-700">
            <div className="flex rounded-lg bg-gray-900 p-1 border border-gray-700">
              <button
                type="button"
                onClick={() => setInputTab('paste')}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition flex items-center gap-1.5 ${
                  inputTab === 'paste'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Clipboard className="w-3.5 h-3.5" />
                Paste Text / Content
              </button>
              <button
                type="button"
                onClick={() => setInputTab('file')}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition flex items-center gap-1.5 ${
                  inputTab === 'file'
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                Select File(s)
                {selectedFiles.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-white/20 text-white text-[10px]">
                    {selectedFiles.length}
                  </span>
                )}
              </button>
            </div>

            <span className="text-[11px] text-gray-400">
              {inputTab === 'paste' ? `${pastedText.length.toLocaleString()} characters` : `${selectedFiles.length} files attached`}
            </span>
          </div>

          {/* PASTE TEXT VIEW */}
          {inputTab === 'paste' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">
                  Paste Text, Emails, Phone Numbers, or URLs:
                </label>
                <textarea
                  rows={13}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Paste any plain text, email lists, contact pages, phone directories, or webmail records here... The extractor will instantly harvest emails, phone numbers, and webmail links according to your checked filters above."
                  className="w-full p-3 bg-gray-900 border border-gray-700 rounded-xl font-mono text-xs text-gray-200 focus:ring-2 focus:ring-teal-500 focus:outline-none transition leading-relaxed resize-y"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-teal-400" />
                  Checks execute in real-time as you type or paste
                </span>
                {pastedText && (
                  <button
                    type="button"
                    onClick={() => setPastedText('')}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Clear Text
                  </button>
                )}
              </div>
            </div>
          )}

          {/* SELECT FILE VIEW */}
          {inputTab === 'file' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDropFiles}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-600 hover:border-teal-500/80 bg-gray-900/60 hover:bg-gray-900/90 rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center space-y-2.5 group"
              >
                <div className="w-12 h-12 rounded-full bg-teal-500/10 group-hover:bg-teal-500/20 text-teal-400 flex items-center justify-center transition">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white group-hover:text-teal-300 transition">
                    Click to select files or drag & drop here
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Supports .txt, .csv, .xlsx, .xls, .json, .html, .xml, .log
                  </p>
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFilesSelected}
                  multiple
                  accept=".txt,.csv,.xlsx,.xls,.json,.html,.htm,.xml,.log,.tsv"
                  className="hidden"
                />
              </div>

              {/* LIST OF SELECTED FILES */}
              {selectedFiles.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                      Loaded Files ({selectedFiles.length}):
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFiles([]);
                        setFileRawTextCache({});
                      }}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Remove All
                    </button>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {selectedFiles.map((file) => (
                      <div
                        key={file.name}
                        className="flex items-center justify-between p-2.5 bg-gray-900/90 border border-gray-700/80 rounded-lg text-xs"
                      >
                        <div className="flex items-center gap-2 truncate pr-2">
                          <FileText className="w-4 h-4 text-teal-400 shrink-0" />
                          <span className="text-gray-200 font-mono truncate">{file.name}</span>
                          <span className="text-[10px] text-gray-400 font-mono shrink-0">
                            ({(file.size / 1024).toFixed(1)} KB)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(file.name)}
                          className="text-gray-500 hover:text-red-400 transition p-1"
                          title="Remove file"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-gray-900/40 border border-gray-700/60 rounded-lg text-xs text-gray-400 flex items-start gap-2">
                  <Info className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />
                  <span>
                    No files loaded yet. You can attach single or multiple contact files, company lists, customer databases, or exported spreadsheets.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* DUAL MODE NOTICE */}
          {(pastedText && selectedFiles.length > 0) && (
            <div className="p-2.5 bg-teal-950/40 border border-teal-600/40 rounded-lg text-[11px] text-teal-300 flex items-center justify-between">
              <span>Extracting from both <strong>{selectedFiles.length} files</strong> AND <strong>pasted text</strong>.</span>
              <button
                type="button"
                onClick={() => runExtraction()}
                className="underline hover:text-white"
              >
                Re-sync
              </button>
            </div>
          )}
        </div>

        {/* RESULTS PANEL (RIGHT COLUMN) */}
        <div className="lg:col-span-7 bg-gray-800/60 border border-gray-700 rounded-xl p-5 shadow-lg space-y-4 flex flex-col justify-between">
          <div>
            {/* KPI STATS BAR */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
              <div className="p-3 bg-gray-900 border border-gray-700 rounded-xl text-center min-h-[76px] flex flex-col justify-center">
                <span className="text-[11px] text-gray-400 font-medium block">Total Extracted</span>
                <span className="text-xl font-extrabold text-white font-mono">{contacts.length}</span>
              </div>
              <div className="p-3 bg-gray-900 border border-blue-600/30 rounded-xl text-center min-h-[76px] flex flex-col justify-center">
                <span className="text-[11px] text-blue-400 font-medium block flex items-center justify-center gap-1">
                  <Mail className="w-3 h-3" /> Emails
                </span>
                <span className="text-xl font-extrabold text-blue-300 font-mono">{emailCount}</span>
              </div>
              <div className="p-3 bg-gray-900 border border-emerald-600/30 rounded-xl text-center min-h-[76px] flex flex-col justify-center">
                <span className="text-[11px] text-emerald-400 font-medium block flex items-center justify-center gap-1">
                  <Phone className="w-3 h-3" /> Phones
                </span>
                <span className="text-xl font-extrabold text-emerald-300 font-mono">{phoneCount}</span>
              </div>
              <div className="p-3 bg-gray-900 border border-purple-600/30 rounded-xl text-center min-h-[76px] flex flex-col justify-center">
                <span className="text-[11px] text-purple-400 font-medium block flex items-center justify-center gap-1">
                  <Globe className="w-3 h-3" /> Webit / URLs
                </span>
                <span className="text-xl font-extrabold text-purple-300 font-mono">{webTotalCount}</span>
              </div>
              <div className="p-3 bg-gray-900 border border-indigo-600/30 rounded-xl text-center flex flex-col justify-center min-h-[76px]">
                <span className="text-[11px] text-indigo-400 font-medium block flex items-center justify-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> MX Health
                </span>
                {isCheckingMX ? (
                  <span className="text-xs font-bold text-blue-300 flex items-center justify-center gap-1 mt-1">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    {mxProgress ? `${mxProgress.current}/${mxProgress.total}` : 'Checking...'}
                  </span>
                ) : validMXCount > 0 || deadMXCount > 0 ? (
                  <div className="mt-0.5">
                    <span className="text-base font-extrabold text-emerald-300 font-mono">{validMXCount}</span>
                    <span className="text-xs text-gray-400 font-mono"> / {validMXCount + deadMXCount}</span>
                    {deadMXCount > 0 && (
                      <span className="text-[10px] text-red-400 block font-semibold">({deadMXCount} dead)</span>
                    )}
                  </div>
                ) : emailCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => performMXCheck(undefined, true)}
                    className="mt-1 px-2 py-0.5 text-[10px] font-bold rounded bg-blue-900/50 hover:bg-blue-800 text-blue-300 border border-blue-600/40 transition"
                  >
                    Run Quick Check
                  </button>
                ) : (
                  <span className="text-xs text-gray-500 mt-1 font-mono">None</span>
                )}
              </div>
            </div>

            {/* FILTER PILLS & SEARCH */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-3 border-b border-gray-700">
              <div className="flex items-center gap-1 flex-wrap">
                <button
                  type="button"
                  onClick={() => setActiveFilterType('all')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition ${
                    activeFilterType === 'all'
                      ? 'bg-teal-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  All ({contacts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilterType('email')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition flex items-center gap-1 ${
                    activeFilterType === 'email'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  <Mail className="w-3 h-3" /> Emails ({emailCount})
                </button>
                {validMXCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveFilterType('mx-valid')}
                    className={`px-2.5 py-1 text-xs font-bold rounded-md transition flex items-center gap-1 ${
                      activeFilterType === 'mx-valid'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-emerald-950/40 text-emerald-300 border border-emerald-700/40 hover:text-white'
                    }`}
                  >
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Active MX ({validMXCount})
                  </button>
                )}
                {deadMXCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveFilterType('mx-invalid')}
                    className={`px-2.5 py-1 text-xs font-bold rounded-md transition flex items-center gap-1 ${
                      activeFilterType === 'mx-invalid'
                        ? 'bg-red-600 text-white'
                        : 'bg-red-950/40 text-red-300 border border-red-700/40 hover:text-white'
                    }`}
                  >
                    <XCircle className="w-3 h-3 text-red-400" /> Dead MX ({deadMXCount})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveFilterType('phone')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition flex items-center gap-1 ${
                    activeFilterType === 'phone'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  <Phone className="w-3 h-3" /> Phones ({phoneCount})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilterType('webmail')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition flex items-center gap-1 ${
                    activeFilterType === 'webmail'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  <Globe className="w-3 h-3" /> Webmail ({webmailCount})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilterType('website')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition ${
                    activeFilterType === 'website'
                      ? 'bg-amber-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  Websites ({websiteCount})
                </button>
                {deadMXCount > 0 && (
                  <button
                    type="button"
                    onClick={handlePurgeDeadMX}
                    className="px-2 py-1 text-xs font-semibold rounded-md bg-red-900/60 hover:bg-red-800 text-red-200 border border-red-600/50 transition flex items-center gap-1"
                    title="Remove all dead or missing MX email addresses"
                  >
                    <Trash2 className="w-3 h-3" />
                    Purge Dead MX ({deadMXCount})
                  </button>
                )}
              </div>

              {/* SEARCH INPUT */}
              <div className="relative min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter extracted..."
                  className="w-full pl-8 pr-2.5 py-1 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>

            {/* CONTACTS TABLE */}
            <div className="mt-3 border border-gray-700/80 rounded-xl overflow-hidden bg-gray-900/70">
              {filteredContacts.length > 0 ? (
                <div className="max-h-[380px] overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse table-fixed">
                    <thead className="bg-gray-950/90 text-gray-400 uppercase font-mono text-[10px] sticky top-0 z-10 border-b border-gray-800">
                      <tr>
                        <th className="py-2.5 px-3 w-[100px] min-w-[100px]">Type</th>
                        <th className="py-2.5 px-3 min-w-[180px]">Contact Information</th>
                        <th className="py-2.5 px-3 w-[130px] min-w-[130px]">Classification</th>
                        <th className="py-2.5 px-3 w-[170px] min-w-[170px]">MX Record</th>
                        <th className="py-2.5 px-3 w-[110px] min-w-[110px]">Source</th>
                        <th className="py-2.5 px-3 w-[85px] min-w-[85px] text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/80">
                      {filteredContacts.map((item) => (
                        <tr key={item.id} className="hover:bg-gray-800/50 transition-colors">
                          <td className="py-2.5 px-3 whitespace-nowrap w-[100px]">
                            {item.type === 'email' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-900/40 text-blue-300 border border-blue-700/50 font-mono">
                                <Mail className="w-2.5 h-2.5" /> EMAIL
                              </span>
                            )}
                            {item.type === 'phone' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-900/40 text-emerald-300 border border-emerald-700/50 font-mono">
                                <Phone className="w-2.5 h-2.5" /> PHONE
                              </span>
                            )}
                            {item.type === 'webmail' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-900/40 text-purple-300 border border-purple-700/50 font-mono">
                                <Globe className="w-2.5 h-2.5" /> WEBMAIL
                              </span>
                            )}
                            {item.type === 'website' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-900/40 text-amber-300 border border-amber-700/50 font-mono">
                                <Globe className="w-2.5 h-2.5" /> WEBIT
                              </span>
                            )}
                          </td>

                          <td className="py-2.5 px-3 font-mono text-white select-all break-all">
                            {item.type === 'email' && (
                              <a
                                href={`mailto:${item.value}`}
                                className="hover:underline text-blue-300 hover:text-blue-200"
                              >
                                {item.value}
                              </a>
                            )}
                            {item.type === 'phone' && (
                              <a
                                href={`tel:${item.normalizedValue}`}
                                className="hover:underline text-emerald-300 hover:text-emerald-200"
                              >
                                {item.value}
                              </a>
                            )}
                            {(item.type === 'webmail' || item.type === 'website') && (
                              <a
                                href={item.value}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline text-purple-300 hover:text-purple-200 inline-flex items-center gap-1"
                              >
                                {item.value}
                                <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                              </a>
                            )}
                          </td>

                          <td className="py-2.5 px-3 text-gray-400 w-[130px]">
                            <span className="text-[11px] font-medium text-gray-300 truncate block">
                              {item.category}
                            </span>
                            {item.domain && (
                              <span className="block text-[10px] text-gray-500 font-mono truncate">
                                {item.domain}
                              </span>
                            )}
                          </td>

                          <td className="py-2.5 px-3 whitespace-nowrap w-[170px]">
                            {item.type === 'email' ? (
                              item.mxStatus === 'valid' ? (
                                <div className="flex flex-col items-start justify-center min-h-[34px] gap-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/50">
                                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" /> Active MX
                                  </span>
                                  {item.mxProvider && (
                                    <span
                                      className="text-[9px] text-gray-400 font-mono pl-0.5 max-w-[140px] truncate block"
                                      title={item.mxDiagnostic || item.mxProvider}
                                    >
                                      {item.mxProvider}
                                    </span>
                                  )}
                                </div>
                              ) : item.mxStatus === 'invalid' ? (
                                <div className="flex flex-col items-start justify-center min-h-[34px] gap-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-950/80 text-red-300 border border-red-500/50">
                                    <XCircle className="w-2.5 h-2.5 text-red-400 shrink-0" /> Dead / No MX
                                  </span>
                                  <span
                                    className="text-[9px] text-red-400/80 font-mono pl-0.5 max-w-[140px] truncate block"
                                    title={item.mxDiagnostic || 'No Mail Exchanger'}
                                  >
                                    {item.mxProvider || 'No mail server'}
                                  </span>
                                </div>
                              ) : item.mxStatus === 'checking' ? (
                                <div className="flex items-center min-h-[34px]">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-950/70 text-blue-300 border border-blue-500/50">
                                    <RefreshCw className="w-2.5 h-2.5 text-blue-400 animate-spin" /> Checking DNS...
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center min-h-[34px]">
                                  <button
                                    type="button"
                                    onClick={() => checkSingleEmailMX(item)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white border border-gray-700 transition"
                                    title="Perform quick DNS MX check on this domain"
                                  >
                                    <ShieldCheck className="w-2.5 h-2.5 text-gray-400" /> Check MX
                                  </button>
                                </div>
                              )
                            ) : (
                              <div className="flex items-center min-h-[34px]">
                                <span className="text-gray-600 font-mono text-[11px]">-</span>
                              </div>
                            )}
                          </td>

                          <td className="py-2.5 px-3 text-gray-400 w-[110px]" title={item.source}>
                            <span className="text-[11px] font-mono truncate block max-w-[100px]">{item.source}</span>
                          </td>

                          <td className="py-2.5 px-3 text-right whitespace-nowrap space-x-1 w-[85px]">
                            {item.type === 'email' && (
                              <button
                                type="button"
                                onClick={() => checkSingleEmailMX(item)}
                                className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-blue-300 transition border border-gray-700 inline-flex items-center"
                                title="Re-check MX record for domain"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleCopySingle(item)}
                              className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition border border-gray-700 inline-flex items-center"
                              title="Copy to clipboard"
                            >
                              {copiedId === item.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Clipboard className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center space-y-2">
                  <Sparkles className="w-8 h-8 text-gray-600 mx-auto" />
                  <p className="text-sm font-semibold text-gray-300">
                    {contacts.length === 0
                      ? 'No contacts extracted yet'
                      : 'No items match your filter/search criteria'}
                  </p>
                  <p className="text-xs text-gray-500 max-w-sm mx-auto">
                    {contacts.length === 0
                      ? 'Select a contact file or paste any text on the left, then toggle your desired checkboxes (Email, Phone, Webit) to start extracting.'
                      : 'Try clearing the search query or selecting a different filter tab.'}
                  </p>
                  {contacts.length === 0 && (
                    <button
                      type="button"
                      onClick={handleLoadSample}
                      className="mt-2 px-3 py-1 bg-teal-600/30 hover:bg-teal-600/50 text-teal-300 border border-teal-500/40 rounded-lg text-xs font-bold transition inline-flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Load Sample to Test
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ACTION TOOLBAR AT BOTTOM */}
          {contacts.length > 0 && (
            <div className="pt-4 border-t border-gray-700/80 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleCopyAll()}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-gray-800 hover:bg-gray-700 text-white border border-gray-700 transition flex items-center gap-1.5"
                >
                  {allCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Clipboard className="w-3.5 h-3.5" />}
                  {allCopied ? 'Copied All!' : `Copy (${filteredContacts.length})`}
                </button>

                {emailCount > 0 && (
                  <button
                    type="button"
                    onClick={() => handleCopyAll('email')}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-900/40 hover:bg-blue-900/70 text-blue-200 border border-blue-700/50 transition flex items-center gap-1"
                  >
                    <Mail className="w-3 h-3" /> Copy Emails ({emailCount})
                  </button>
                )}

                {validMXCount > 0 && (
                  <button
                    type="button"
                    onClick={handleCopyValidMX}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/50 transition flex items-center gap-1"
                    title="Copy only verified emails with active MX"
                  >
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Copy Valid MX ({validMXCount})
                  </button>
                )}

                {emailCount > 0 && (
                  <button
                    type="button"
                    onClick={() => performMXCheck(contacts, true)}
                    disabled={isCheckingMX}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-900/40 hover:bg-blue-900/70 text-blue-200 border border-blue-700/50 transition flex items-center gap-1 disabled:opacity-50"
                  >
                    <ShieldCheck className={`w-3 h-3 ${isCheckingMX ? 'animate-spin' : ''}`} />
                    {isCheckingMX ? 'Checking MX...' : 'Quick MX Check'}
                  </button>
                )}

                {phoneCount > 0 && (
                  <button
                    type="button"
                    onClick={() => handleCopyAll('phone')}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-900/40 hover:bg-emerald-900/70 text-emerald-200 border border-emerald-700/50 transition flex items-center gap-1"
                  >
                    <Phone className="w-3 h-3" /> Copy Phones ({phoneCount})
                  </button>
                )}

                {webTotalCount > 0 && (
                  <button
                    type="button"
                    onClick={() => handleCopyAll('web')}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-purple-900/40 hover:bg-purple-900/70 text-purple-200 border border-purple-700/50 transition flex items-center gap-1"
                  >
                    <Globe className="w-3 h-3" /> Copy Webit ({webTotalCount})
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {emailCount > 0 && onSendToValidator && (
                  <button
                    type="button"
                    onClick={handleSendEmailsToValidator}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-orange-600 hover:bg-orange-500 text-white transition shadow flex items-center gap-1"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Validate Emails
                  </button>
                )}

                {emailCount > 0 && onPushToMainLeads && (
                  <button
                    type="button"
                    onClick={handlePushToMainLeads}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition shadow flex items-center gap-1"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Add to Leads
                  </button>
                )}

                {/* EXPORT OPTIONS */}
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white transition shadow flex items-center gap-1"
                  title="Export to Excel"
                >
                  <Download className="w-3.5 h-3.5" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition"
                  title="Export to CSV"
                >
                  CSV
                </button>
                <button
                  type="button"
                  onClick={handleExportTXT}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition"
                  title="Export to Plain Text"
                >
                  TXT
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FileTextContactExtractor;
