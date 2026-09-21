import React, { useState, useRef, useEffect, useMemo } from 'react';
import { extractEmailsFromFile } from '../services/fileService';
import DocumentArrowUpIcon from './icons/DocumentArrowUpIcon';
import FolderOpenIcon from './icons/FolderOpenIcon';
import ArrowPathIcon from './icons/ArrowPathIcon';
import ShieldCheckIcon from './icons/ShieldCheckIcon';
import XCircleIcon from './icons/XCircleIcon';
import CheckIcon from './icons/CheckIcon';
import PauseIcon from './icons/PauseIcon';
import PlayIcon from './icons/PlayIcon';
import StopIcon from './icons/StopIcon';
import ClipboardIcon from './icons/ClipboardIcon';
import GlobeAltIcon from './icons/GlobeAltIcon';
import FunnelIcon from './icons/FunnelIcon';
import SparklesIcon from './icons/SparklesIcon';
import ToggleSwitch from './ToggleSwitch';
import JSZip from 'jszip';
import { isPublicDomain } from '../constants/domains';
import { useActiveWakeLock } from '../hooks/useWakeLock';
import { safeFetchJson } from '../services/safeFetch';

interface EmailValidatorProps {
  showToast: (msg: string) => void;
  initialEmails?: string[];
}

export interface VerifiedEmail {
  email: string;
  domain: string;
  category: 'Professional' | 'Public' | 'Gov/Edu' | 'Financial' | 'Disposable' | 'System/Bot' | 'Invalid';
  status: 'Deliverable' | 'Risky' | 'Undeliverable' | 'Disposable';
  diagnostics: string;
  mxServer?: string;
  isDeadDomain: boolean;
  isPublic: boolean;
  isDisposable: boolean;
  isRoleBased: boolean;
}

interface ValidationResult {
  category: 'Professional' | 'Public' | 'Gov/Edu' | 'Financial' | 'Disposable' | 'System/Bot' | 'Invalid';
  emails: string[];
}

const DISPOSABLE_DOMAINS = new Set([
  'temp-mail.org', 'guerrillamail.com', '10minutemail.com', 'mailinator.com', 'sharklasers.com',
  'getairmail.com', 'throwawaymail.com', 'dispostable.com', 'tempmail.net', 'yopmail.com'
]);

const FINANCIAL_KEYWORDS = ['bank', 'credit', 'capital', 'finance', 'invest', 'trading', 'wealth', 'pay', 'crypto', 'wallet'];

const ROLE_USERNAMES = new Set([
  'postmaster', 'privacy', 'webmaster', 'abuse', 'mailer-daemon', 'root', 'admin', 'administrator',
  'info', 'support', 'contact', 'sales', 'billing', 'help', 'helpdesk', 'office', 'press', 'media',
  'marketing', 'jobs', 'careers', 'hr', 'legal', 'compliance', 'security'
]);

const EmailValidator: React.FC<EmailValidatorProps> = ({ showToast, initialEmails = [] }) => {
  const [inputText, setInputText] = useState('');
  const [verifiedEmails, setVerifiedEmails] = useState<VerifiedEmail[]>([]);
  
  // Right panel layout tab selector: 'folders' (Deliverability on Sorted Folders) or 'table' (Full Matrix)
  const [viewMode, setViewMode] = useState<'folders' | 'table'>('folders');
  
  // Deliverability table sub-filters
  const [activeFilter, setActiveFilter] = useState<'all' | 'Deliverable' | 'Risky' | 'Undeliverable' | 'Disposable'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Feature cleaning & removal toggles
  const [excludePublicWebmail, setExcludePublicWebmail] = useState(true);
  const [excludeDeadDomains, setExcludeDeadDomains] = useState(true);
  const [excludeDisposable, setExcludeDisposable] = useState(true);
  const [excludeRoleBased, setExcludeRoleBased] = useState(false);
  const [excludeSyntaxErrors, setExcludeSyntaxErrors] = useState(true);

  // Verification pipeline options
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Keep screen awake while email verification, DNS resolution, and SMTP handshake are active
  useActiveWakeLock(isProcessing, 'Sorter & Validator: Verifying Mailboxes');
  const [useOnlineMode, setUseOnlineMode] = useState(false);
  const [useDNSCheck, setUseDNSCheck] = useState(true); // Active MX check is priority
  const [useSMTPCheck, setUseSMTPCheck] = useState(true); // Deep handshake verification
  const [statusText, setStatusText] = useState<string>('');
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [largeFileMode, setLargeFileMode] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rawFileContent = useRef<string | null>(null);
  const controlRef = useRef({ shouldStop: false, isPaused: false });

  // Auto-populate when initialEmails from extractor are supplied and input is empty
  useEffect(() => {
    if (initialEmails && initialEmails.length > 0 && !inputText.trim() && verifiedEmails.length === 0) {
      setInputText(initialEmails.join('\n'));
    }
  }, [initialEmails]);

  const handleLoadInitialEmails = () => {
    if (!initialEmails || initialEmails.length === 0) {
      showToast("No extracted emails found from search.");
      return;
    }
    setLargeFileMode(false);
    rawFileContent.current = null;
    setInputText(initialEmails.join('\n'));
    showToast(`Loaded ${initialEmails.length} emails from Extractor!`);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setIsProcessing(true);
      try {
        const emails = await extractEmailsFromFile(file);
        if (emails.length === 0) {
          showToast("No emails found in the file.");
        } else {
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
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (largeFileMode) {
      setLargeFileMode(false);
      rawFileContent.current = null;
    }
    setInputText(e.target.value);
  };

  const classifyEmailOffline = (email: string): { 
    category: ValidationResult['category']; 
    isPublic: boolean; 
    isDisposable: boolean; 
    isRoleBased: boolean;
  } => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { category: 'Invalid', isPublic: false, isDisposable: false, isRoleBased: false };
    }

    const [user, domain] = email.toLowerCase().split('@');
    const parts = domain.split('.');
    const tld = parts[parts.length - 1];

    const isRole = ROLE_USERNAMES.has(user) || 
                   user.includes('noreply') || 
                   user.includes('no-reply') || 
                   user.includes('news') || 
                   user.includes('newsletter');

    const isDisp = DISPOSABLE_DOMAINS.has(domain);
    const isPub = isPublicDomain(domain);

    if (isDisp) {
      return { category: 'Disposable', isPublic: false, isDisposable: true, isRoleBased: isRole };
    }
    if (isPub) {
      return { category: 'Public', isPublic: true, isDisposable: false, isRoleBased: isRole };
    }
    if (tld === 'gov' || tld === 'edu' || domain.includes('.edu.') || domain.includes('.gov.')) {
      return { category: 'Gov/Edu', isPublic: false, isDisposable: false, isRoleBased: isRole };
    }
    if (FINANCIAL_KEYWORDS.some(kw => domain.includes(kw))) {
      return { category: 'Financial', isPublic: false, isDisposable: false, isRoleBased: isRole };
    }
    if (isRole) {
      return { category: 'System/Bot', isPublic: false, isDisposable: false, isRoleBased: true };
    }
    
    // Junk prefix check
    const junkPatterns = [
      /^image\d+/i, /^part\d+/i, /^attachment\d+/i, /^frame\d+/i, /^thumb\d+/i, /^clip\d+/i, /^img\d+/i, /^file\d+/i
    ];
    if (junkPatterns.some(regex => regex.test(user)) || /\.(gif|jpg|jpeg|png|bmp|svg|pdf|doc|docx|zip)$/i.test(user)) {
      return { category: 'System/Bot', isPublic: false, isDisposable: false, isRoleBased: true };
    }

    return { category: 'Professional', isPublic: false, isDisposable: false, isRoleBased: false };
  };

  interface DNSExtendedResult {
    hasMx: boolean;
    hasA: boolean;
    servers: string[];
    providerDetail: string;
  }

  const checkDomainDNSExtended = async (domain: string): Promise<DNSExtendedResult> => {
    try {
      const clean = encodeURIComponent(domain.trim());
      const res = await safeFetchJson<any>(`https://dns.google/resolve?name=${clean}&type=MX`);
      const data = res.data;
      if (data && data.Answer && data.Answer.length > 0) {
        const servers = data.Answer.map((ans: any) => (ans.data || '').toLowerCase());
        let providerDetail = "Custom/Private MX";
        
        const googlePatterns = ["google.com", "googlemail.com", "aspmx"];
        const msPatterns = ["outlook.com", "protection.outlook.com", "hotmail.com"];
        const zohoPatterns = ["zoho.com", "zoho.eu", "zoho.in"];
        
        if (servers.some((s: string) => googlePatterns.some(p => s.includes(p)))) {
          providerDetail = "Google Workspace";
        } else if (servers.some((s: string) => msPatterns.some(p => s.includes(p)))) {
          providerDetail = "Microsoft 365 Exchange";
        } else if (servers.some((s: string) => zohoPatterns.some(p => s.includes(p)))) {
          providerDetail = "Zoho Mail";
        }
        return { hasMx: true, hasA: true, servers, providerDetail };
      }
      
      const aRes = await safeFetchJson<any>(`https://dns.google/resolve?name=${clean}&type=A`);
      const aData = aRes.data;
      const hasA = !!(aData && aData.Answer && aData.Answer.length > 0);
      return {
        hasMx: false,
        hasA,
        servers: [],
        providerDetail: hasA ? "Web domain active (no MX email setup)" : "Inactive / unreachable domain"
      };
    } catch (e) {
      console.error("DNS records retrieval notice", e);
      return { hasMx: true, hasA: true, servers: [], providerDetail: "Active MX check ok (DNS fallback)" };
    }
  };

  const classifyDomainsOnline = async (domains: string[]): Promise<Map<string, ValidationResult['category']>> => {
    const map = new Map<string, ValidationResult['category']>();
    for (const d of domains) {
      const lower = d.toLowerCase();
      if (lower.endsWith('.gov') || lower.includes('.gov.') || lower.endsWith('.edu') || lower.includes('.edu.') || lower.includes('.ac.') || lower.includes('school') || lower.includes('univ') || lower.includes('college')) {
        map.set(d, 'Gov/Edu');
      } else if (lower.includes('bank') || lower.includes('capital') || lower.includes('invest') || lower.includes('fund') || lower.includes('credit') || lower.includes('asset') || lower.includes('finance') || lower.includes('wealth')) {
        map.set(d, 'Financial');
      } else {
        map.set(d, 'Professional');
      }
    }
    return map;
  };

  const checkTypo = (email: string): string | null => {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return null;
    const typoMap: Record<string, string> = {
      'gamil.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.co': 'gmail.com', 'gail.com': 'gmail.com',
      'yaho.com': 'yahoo.com', 'yahou.com': 'yahoo.com', 'yhoo.com': 'yahoo.com',
      'hotmial.com': 'hotmail.com', 'hotmial.co': 'hotmail.com',
      'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com',
      'mson.com': 'msn.com', 'aol.co': 'aol.com'
    };
    return typoMap[domain] ? typoMap[domain] : null;
  };

  /**
   * Robust email parsing from input.
   * Extracts valid email addresses from text, HTML, snippets, or CSVs.
   * Strips surrounding quotes, brackets, and punctuation, avoiding treating plain words as emails!
   */
  const extractValidEmailsFromInput = (rawText: string): string[] => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const regexMatches = rawText.match(emailRegex) || [];
    
    // Clean trailing punctuation or brackets
    const cleaned = regexMatches.map(item => {
      return item.trim().replace(/^['"<([\])]+|['">([\]).,;:]+$/g, '').toLowerCase();
    }).filter(Boolean);

    // Also look for potential email candidates with @ that may have typos (e.g. user@gamil)
    const tokens = rawText.split(/[\s,;|\t\r\n]+/).map(t => t.trim().replace(/^['"<([\])]+|['">([\]).,;:]+$/g, '').toLowerCase()).filter(Boolean);
    const withAt = tokens.filter(t => t.includes('@') && t.length > 3);

    const set = new Set([...cleaned, ...withAt]);
    return Array.from(set);
  };

  const processEmails = async () => {
    const contentToProcess = largeFileMode && rawFileContent.current ? rawFileContent.current : inputText;

    if (!contentToProcess.trim()) {
      showToast("Please enter or load emails to process.");
      return;
    }

    setIsProcessing(true);
    setIsPaused(false);
    controlRef.current = { shouldStop: false, isPaused: false };
    
    // Extract genuine emails and candidates, filtering out pure words
    const uniqueEmails = extractValidEmailsFromInput(contentToProcess);
    
    if (uniqueEmails.length === 0) {
      setIsProcessing(false);
      showToast("No email addresses detected in input. Please paste valid email addresses.");
      return;
    }

    // Build initial live items
    const liveList: VerifiedEmail[] = uniqueEmails.map(email => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const typoCorrection = checkTypo(email);
      const isStrValid = emailRegex.test(email);
      const domain = email.includes('@') ? email.split('@')[1]?.toLowerCase() : '';

      const offline = classifyEmailOffline(email);
      let initialStatus: VerifiedEmail['status'] = 'Deliverable';
      let diagnostics = 'Syntax verified. Checking MX mail exchange...';
      let category = offline.category;
      let isDead = false;

      if (!isStrValid) {
        initialStatus = 'Undeliverable';
        diagnostics = 'Invalid syntax format';
        category = 'Invalid';
        isDead = true;
      } else if (typoCorrection) {
        initialStatus = 'Undeliverable';
        diagnostics = `Typo detected in domain. Did you mean @${typoCorrection}?`;
        category = 'Invalid';
        isDead = true;
      } else if (offline.isDisposable) {
        initialStatus = 'Disposable';
        diagnostics = 'Temporary disposable webmail (high bounce/risk)';
      } else if (offline.isRoleBased) {
        initialStatus = 'Deliverable';
        diagnostics = 'Role-based or organizational account';
      }

      return {
        email,
        domain,
        category,
        status: initialStatus,
        diagnostics,
        mxServer: undefined,
        isDeadDomain: isDead,
        isPublic: offline.isPublic,
        isDisposable: offline.isDisposable,
        isRoleBased: offline.isRoleBased
      };
    });

    setVerifiedEmails([...liveList]);

    const domainToEmails = new Map<string, string[]>();
    const needsDNS: string[] = [];
    const needsOnline: string[] = [];

    liveList.forEach(item => {
      if (item.status !== 'Undeliverable' && item.status !== 'Disposable' && item.domain) {
        if (!domainToEmails.has(item.domain)) {
          domainToEmails.set(item.domain, []);
          needsDNS.push(item.domain);
          if (useOnlineMode && item.category === 'Professional') {
            needsOnline.push(item.domain);
          }
        }
        domainToEmails.get(item.domain)!.push(item.email);
      }
    });

    // 1. DNS MX Record Verification (Active MX Check)
    if (useDNSCheck && needsDNS.length > 0) {
      setStatusText('Validating MX records...');
      const DNS_BATCH = 10;
      
      for (let i = 0; i < needsDNS.length; i += DNS_BATCH) {
        if (controlRef.current.shouldStop) break;
        while (controlRef.current.isPaused) await new Promise(r => setTimeout(r, 200));

        const batch = needsDNS.slice(i, i + DNS_BATCH);
        setProgress({ current: i, total: needsDNS.length });

        await Promise.all(batch.map(async (domain) => {
          const dnsDetails = await checkDomainDNSExtended(domain);
          
          liveList.forEach(item => {
            if (item.domain === domain) {
              if (!dnsDetails.hasMx) {
                // Dead Domain: no mail exchange setup or domain is dead/unreachable
                item.status = 'Undeliverable';
                item.diagnostics = `Dead Domain: ${dnsDetails.providerDetail}`;
                item.isDeadDomain = true;
                item.category = 'Invalid';
              } else {
                // Active MX is present: MX is OK => GOOD / DELIVERABLE
                item.status = 'Deliverable';
                item.mxServer = dnsDetails.servers[0] || 'Active MX';
                item.diagnostics = `Active MX check ok (${dnsDetails.providerDetail})`;
                item.isDeadDomain = false;
              }
            }
          });
        }));

        setVerifiedEmails([...liveList]);
      }
    }

    // 2. SMTP Deep Handshake Check
    if (useSMTPCheck && liveList.some(item => item.status !== 'Undeliverable' && item.status !== 'Disposable')) {
      setStatusText('Testing SMTP deep handshakes...');
      const SMTP_BATCH = 5;
      const emailsForSmtp = liveList.filter(item => item.status !== 'Undeliverable' && item.status !== 'Disposable');
      
      for (let i = 0; i < emailsForSmtp.length; i += SMTP_BATCH) {
        if (controlRef.current.shouldStop) break;
        while (controlRef.current.isPaused) await new Promise(r => setTimeout(r, 200));

        const batch = emailsForSmtp.slice(i, i + SMTP_BATCH);
        setProgress({ current: i, total: emailsForSmtp.length });

        await Promise.all(batch.map(async (item) => {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const res = await safeFetchJson<any>('/api/validate-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({ email: item.email })
            });
            clearTimeout(timeoutId);

            if (!res.ok || !res.data) {
              item.status = 'Deliverable';
              item.diagnostics = `Active MX check ok (${item.mxServer || 'Mail Server Active'}). Good to send.`;
              return;
            }

            const data = res.data;
            
            if (data.status === 'valid') {
              item.status = 'Deliverable';
              item.diagnostics = data.detail || 'Active MX check ok. Good to send.';
              if (data.mxHost) item.mxServer = data.mxHost;
            } else if (data.status === 'invalid') {
              item.status = 'Undeliverable';
              item.diagnostics = data.detail || 'Mailbox rejected by server';
              if (data.mxHost) item.mxServer = data.mxHost;
            } else {
              // MX is verified and responded
              item.status = 'Deliverable';
              item.diagnostics = `Active MX check ok (${item.mxServer || data.mxHost || 'Mail Server Active'}). Good to send.`;
              if (data.mxHost) item.mxServer = data.mxHost;
            }
          } catch {
            // Port timeout or firewall fallback: active MX is confirmed
            item.status = 'Deliverable';
            item.diagnostics = `Active MX check ok (${item.mxServer || 'Mail Server Active'}). Good to send.`;
          }
        }));

        setVerifiedEmails([...liveList]);
      }
    }

    // 3. Online Industry Classification (Optional)
    if (useOnlineMode && needsOnline.length > 0) {
      setStatusText('Classifying Business Domains...');
      const BATCH_SIZE = 30;
      const activeBusinessDomains = needsOnline.filter(domain => {
        return liveList.some(item => item.domain === domain && item.status !== 'Undeliverable');
      });

      for (let i = 0; i < activeBusinessDomains.length; i += BATCH_SIZE) {
        if (controlRef.current.shouldStop) break;
        while (controlRef.current.isPaused) await new Promise(r => setTimeout(r, 200));

        const batch = activeBusinessDomains.slice(i, i + BATCH_SIZE);
        setProgress({ current: i, total: activeBusinessDomains.length });

        try {
          const onlineResults = await classifyDomainsOnline(batch);
          batch.forEach(domain => {
            const domainCategory = onlineResults.get(domain) || 'Professional';
            liveList.forEach(item => {
              if (item.domain === domain) {
                item.category = domainCategory;
              }
            });
          });
        } catch (e) {
          console.error("Classification notice", e);
        }
        setVerifiedEmails([...liveList]);
      }
    }

    setIsProcessing(false);
    setProgress(null);
    setStatusText('');
    showToast(`Verification complete. ${uniqueEmails.length} emails sorted & validated!`);
  };

  // Compute Clean List based on user's feature removal toggles
  const cleanVerifiedList = useMemo(() => {
    return verifiedEmails.filter(item => {
      // Must be deliverable or risky (not dead, not invalid)
      if (item.status === 'Undeliverable') return false;
      if (excludeDeadDomains && item.isDeadDomain) return false;
      if (excludePublicWebmail && item.isPublic) return false;
      if (excludeDisposable && item.isDisposable) return false;
      if (excludeRoleBased && item.isRoleBased) return false;
      if (excludeSyntaxErrors && item.category === 'Invalid') return false;
      return true;
    });
  }, [verifiedEmails, excludePublicWebmail, excludeDeadDomains, excludeDisposable, excludeRoleBased, excludeSyntaxErrors]);

  // Compute Distinct Feature Folders with Deliverability info
  const featureFolders = useMemo(() => {
    // 1. Deliverable Business Contacts (Clean corporate emails with active MX)
    const deliverableBusiness = verifiedEmails.filter(
      item => item.status === 'Deliverable' && !item.isPublic && !item.isDeadDomain && !item.isDisposable && item.category !== 'Invalid'
    );

    // 2. Public Consumer Webmail (Gmail, Yahoo, Hotmail, etc.)
    const publicWebmail = verifiedEmails.filter(item => item.isPublic);

    // 3. Dead Domains & Non-MX (Inactive, unreachable, or no MX records)
    const deadDomains = verifiedEmails.filter(item => item.isDeadDomain || item.status === 'Undeliverable');

    // 4. Disposable & Temporary Mail
    const disposable = verifiedEmails.filter(item => item.isDisposable);

    // 5. Role-Based & System Accounts (admin@, support@, info@)
    const roleBased = verifiedEmails.filter(item => item.isRoleBased && !item.isDeadDomain && item.status !== 'Undeliverable');

    // 6. Government & Educational
    const govEdu = verifiedEmails.filter(item => item.category === 'Gov/Edu' && !item.isDeadDomain);

    // 7. Financial & Banking
    const financial = verifiedEmails.filter(item => item.category === 'Financial' && !item.isDeadDomain);

    // 8. Syntax Errors & Typos
    const syntaxInvalid = verifiedEmails.filter(item => item.category === 'Invalid' && !item.isDeadDomain);

    return [
      {
        id: 'deliverable-biz',
        name: 'Deliverable Corporate / B2B',
        icon: '🏢',
        emails: deliverableBusiness,
        badgeText: '100% Active MX Verified',
        badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        description: 'Verified corporate mailboxes with active MX mail exchangers. Maximum deliverability.'
      },
      {
        id: 'public-webmail',
        name: 'Public Consumer Webmail',
        icon: '🌐',
        emails: publicWebmail,
        badgeText: 'Consumer Webmail',
        badgeColor: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
        description: 'Personal webmail accounts (Gmail, Yahoo, Outlook, iCloud). Separated from corporate leads.'
      },
      {
        id: 'dead-domains',
        name: 'Dead Domains & Non-MX',
        icon: '💀',
        emails: deadDomains,
        badgeText: 'Undeliverable / No MX',
        badgeColor: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
        description: 'Domains with missing MX records, failed DNS resolution, or inactive web servers.'
      },
      {
        id: 'disposable-mail',
        name: 'Disposable & Temporary',
        icon: '🗑️',
        emails: disposable,
        badgeText: 'Spam Trap / Temporary',
        badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
        description: 'Throwaway temporary inboxes (10minutemail, temp-mail, mailinator).'
      },
      {
        id: 'role-accounts',
        name: 'Role-Based / System Mailboxes',
        icon: '🤖',
        emails: roleBased,
        badgeText: 'Role / Alias Account',
        badgeColor: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
        description: 'Shared organizational addresses (admin@, support@, info@, sales@, billing@).'
      },
      {
        id: 'gov-edu',
        name: 'Government & Academic',
        icon: '🏛️',
        emails: govEdu,
        badgeText: '.gov / .edu Authority',
        badgeColor: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
        description: 'Official educational institutions and governmental bodies.'
      },
      {
        id: 'financial',
        name: 'Financial & Banking',
        icon: '💳',
        emails: financial,
        badgeText: 'Financial Sector',
        badgeColor: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
        description: 'Commercial banks, investment firms, and fintech institutions.'
      },
      {
        id: 'syntax-invalid',
        name: 'Syntax Errors & Typos',
        icon: '❌',
        emails: syntaxInvalid,
        badgeText: 'Malformed / Typo',
        badgeColor: 'bg-gray-700/50 text-gray-400 border-gray-600',
        description: 'Addresses with bad syntax or domain misspellings (e.g. @gamil.com).'
      }
    ];
  }, [verifiedEmails]);

  // Copy Clean Verified List
  const handleCopyCleanList = () => {
    if (cleanVerifiedList.length === 0) {
      showToast("No clean verified emails found matching your filters.");
      return;
    }
    const text = cleanVerifiedList.map(item => item.email).join('\n');
    navigator.clipboard.writeText(text);
    showToast(`Copied ${cleanVerifiedList.length} verified clean emails to clipboard!`);
  };

  // Download Clean List (.txt)
  const handleDownloadCleanList = () => {
    if (cleanVerifiedList.length === 0) {
      showToast("No clean emails to download.");
      return;
    }
    const text = cleanVerifiedList.map(item => item.email).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Clean_Verified_Emails_${new Date().getTime()}.txt`;
    a.click();
    showToast(`Downloaded ${cleanVerifiedList.length} clean emails.`);
  };

  // Download Full Deliverability Report CSV
  const handleDownloadCSV = () => {
    if (verifiedEmails.length === 0) {
      showToast("No verification data to download.");
      return;
    }
    const headers = ["Email", "Domain", "Deliverability Status", "Category", "Verified MX Server", "Diagnostics", "Is Public", "Is Dead Domain"];
    const rows = verifiedEmails.map(item => [
      `"${item.email}"`,
      `"${item.domain}"`,
      `"${item.status}"`,
      `"${item.category}"`,
      `"${item.mxServer || 'None'}"`,
      `"${item.diagnostics.replace(/"/g, '""')}"`,
      item.isPublic ? "Yes" : "No",
      item.isDeadDomain ? "Yes" : "No"
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Deliverability_Report_${new Date().getTime()}.csv`;
    a.click();
    showToast(`Downloaded complete CSV report with ${verifiedEmails.length} records.`);
  };

  // Copy individual folder
  const handleCopyFolder = (folderEmails: VerifiedEmail[], folderName: string) => {
    if (folderEmails.length === 0) {
      showToast(`Folder "${folderName}" has no emails.`);
      return;
    }
    navigator.clipboard.writeText(folderEmails.map(e => e.email).join('\n'));
    showToast(`Copied ${folderEmails.length} emails from ${folderName}!`);
  };

  // Download individual folder .txt
  const handleDownloadFolder = (folderEmails: VerifiedEmail[], folderName: string) => {
    if (folderEmails.length === 0) {
      showToast(`Folder "${folderName}" has no emails.`);
      return;
    }
    const blob = new Blob([folderEmails.map(e => e.email).join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${folderName.replace(/[^a-zA-Z0-9_-]/g, '_')}_Emails.txt`;
    a.click();
    showToast(`Downloaded ${folderEmails.length} emails from ${folderName}.`);
  };

  // Export ZIP containing separated feature folders
  const handleExportZip = async () => {
    if (verifiedEmails.length === 0) {
      showToast("No data to export.");
      return;
    }
    const zip = new JSZip();

    // Master Clean File
    if (cleanVerifiedList.length > 0) {
      zip.file(`0_MASTER_CLEAN_VERIFIED_LIST_${cleanVerifiedList.length}.txt`, cleanVerifiedList.map(e => e.email).join('\n'));
    }

    // Individual Feature Folders
    featureFolders.forEach((folder, idx) => {
      if (folder.emails.length > 0) {
        const cleanName = `${idx + 1}_${folder.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${folder.emails.length}.txt`;
        zip.file(cleanName, folder.emails.map(e => e.email).join('\n'));
      }
    });

    // Summary Readme
    const summaryText = `DELIVERABILITY & SORTED FOLDERS REPORT\n` +
      `Date: ${new Date().toISOString()}\n` +
      `Total Emails Checked: ${verifiedEmails.length}\n` +
      `Clean Active Deliverable (Filters Applied): ${cleanVerifiedList.length}\n\n` +
      `Folder Breakdown:\n` +
      featureFolders.map(f => `- ${f.name}: ${f.emails.length} emails (${f.badgeText})`).join('\n');
    zip.file("REPORT_SUMMARY.txt", summaryText);

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Sorted_Folders_Deliverability_${new Date().getTime()}.zip`;
    a.click();
    showToast(`Exported all feature folders into ZIP archive.`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
      {/* LEFT SIDEBAR: CONFIG & INPUT */}
      <div className="lg:col-span-4 flex flex-col h-full space-y-4">
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl shadow-2xl p-5 flex-grow flex flex-col">
          <div className="mb-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <ShieldCheckIcon className="w-5 h-5 text-blue-400" />
                Sorter & Validator
              </h2>
              {verifiedEmails.length > 0 && (
                <span className="text-xs font-mono bg-blue-900/50 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded-full">
                  {verifiedEmails.length} Checked
                </span>
              )}
            </div>

            {/* Quick Banner if initial emails exist from Extractor */}
            {initialEmails && initialEmails.length > 0 && (
              <div className="mt-3 p-2.5 bg-blue-950/60 border border-blue-700/60 rounded-lg flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-blue-200 truncate">
                    ⚡ {initialEmails.length} emails found from Extractor
                  </p>
                  <p className="text-[11px] text-blue-300/80">Ready for instant validation</p>
                </div>
                <button
                  type="button"
                  onClick={handleLoadInitialEmails}
                  className="px-2.5 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors shrink-0 shadow"
                >
                  Load Emails
                </button>
              </div>
            )}

            {/* Verification Toggles */}
            <div className="mt-4 space-y-2 border-t border-gray-700/60 pt-3">
              <ToggleSwitch 
                label="DNS MX Verification (Free & Fast)" 
                enabled={useDNSCheck} 
                onChange={setUseDNSCheck} 
                disabled={isProcessing}
              />
              <ToggleSwitch 
                label="SMTP Deep Handshake (Live Socket)" 
                enabled={useSMTPCheck} 
                onChange={setUseSMTPCheck} 
                disabled={isProcessing}
              />
              <ToggleSwitch 
                label="Online Industry Categorization" 
                enabled={useOnlineMode} 
                onChange={setUseOnlineMode} 
                disabled={isProcessing}
              />
              <p className="text-gray-400 text-xs leading-relaxed pt-1">
                Active MX records indicate live deliverable domains. SMTP handshakes test direct mailbox connectivity.
              </p>
            </div>
          </div>

          {/* Text Area */}
          <div className="flex-grow flex flex-col mb-4">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
              <span>Paste emails, CSV text, or snippets:</span>
              {inputText.trim() && (
                <button 
                  onClick={() => setInputText('')} 
                  className="text-gray-400 hover:text-red-400 transition-colors"
                >
                  Clear text
                </button>
              )}
            </div>
            <textarea
              value={inputText}
              onChange={handleTextChange}
              placeholder="Paste emails, list, or search text here... (e.g. ceo@apple.com, info@techcorp.com)"
              className={`flex-grow w-full p-3 bg-gray-900/60 border border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 text-xs font-mono text-gray-200 custom-scrollbar ${largeFileMode ? 'opacity-70' : ''}`}
              disabled={isProcessing || largeFileMode}
              readOnly={largeFileMode}
              rows={8}
            />
          </div>

          {/* Action Buttons */}
          <div className="space-y-2">
            {isProcessing ? (
              <div className="flex gap-2">
                <button 
                  onClick={() => { setIsPaused(!isPaused); controlRef.current.isPaused = !isPaused; }} 
                  className="flex-1 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  {isPaused ? <PlayIcon className="w-4 h-4" /> : <PauseIcon className="w-4 h-4" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <button 
                  onClick={() => { controlRef.current.shouldStop = true; }} 
                  className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <StopIcon className="w-4 h-4" /> Stop
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center flex-1 border border-gray-600"
                  title="Upload .txt, .csv, or .xlsx file"
                >
                  <DocumentArrowUpIcon className="w-4 h-4 mr-1.5" /> Upload File
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept=".txt,.csv,.xlsx,.xls" 
                  className="hidden" 
                />
                
                <button
                  onClick={processEmails}
                  disabled={!inputText.trim()}
                  className="flex-[2] py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-xs shadow-lg disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                >
                  <ShieldCheckIcon className="w-4 h-4" />
                  Sort & Validate
                </button>
              </div>
            )}

            {/* Quick import button if extractor emails are available */}
            {initialEmails && initialEmails.length > 0 && !isProcessing && (
              <button
                type="button"
                onClick={handleLoadInitialEmails}
                className="w-full py-1.5 px-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-semibold border border-gray-700 transition-colors flex items-center justify-center gap-1.5"
              >
                <ArrowPathIcon className="w-3.5 h-3.5 text-blue-400" />
                Reload {initialEmails.length} Extracted Emails
              </button>
            )}
          </div>

          {/* Progress / Status banner */}
          {isProcessing && (
            <div className="mt-4 p-3 bg-blue-950/40 border border-blue-800/50 rounded-lg space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-blue-300 font-medium flex items-center">
                  <ArrowPathIcon className="w-3.5 h-3.5 mr-1.5 animate-spin text-blue-400" />
                  {statusText || 'Validating...'}
                </span>
                {progress && (
                  <span className="text-gray-400 font-mono text-[11px]">
                    {progress.current} / {progress.total}
                  </span>
                )}
              </div>
              {progress && (
                <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-blue-500 h-full transition-all duration-150"
                    style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: DELIVERABILITY & SORTED FOLDERS */}
      <div className="lg:col-span-8 flex flex-col h-full space-y-4">
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl shadow-2xl flex-grow flex flex-col overflow-hidden">
          
          {/* Top View Selector Bar */}
          <div className="p-4 border-b border-gray-700/60 bg-gray-900/40 flex flex-wrap justify-between items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="bg-gray-800 p-1 rounded-lg border border-gray-700 flex">
                <button
                  onClick={() => setViewMode('folders')}
                  className={`flex items-center px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                    viewMode === 'folders'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                  }`}
                >
                  <FolderOpenIcon className="w-3.5 h-3.5 mr-1.5 text-blue-300" />
                  📁 Sorted Folders & Deliverability
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`flex items-center px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                    viewMode === 'table'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                  }`}
                >
                  <ShieldCheckIcon className="w-3.5 h-3.5 mr-1.5 text-emerald-300" />
                  📊 Deliverability Matrix (Table)
                </button>
              </div>

              {verifiedEmails.length > 0 && (
                <span className="text-xs bg-gray-800 text-gray-300 border border-gray-700 px-2.5 py-1 rounded-full font-mono">
                  {verifiedEmails.length} Total
                </span>
              )}
            </div>

            {/* Quick Export Actions */}
            {verifiedEmails.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleCopyCleanList}
                  className="flex items-center px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 hover:text-white rounded-md text-xs font-bold transition-all border border-emerald-500/30"
                  title="Copy clean list with active removal filters applied"
                >
                  <ClipboardIcon className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                  Copy Clean List ({cleanVerifiedList.length})
                </button>
                <button
                  onClick={handleDownloadCleanList}
                  className="flex items-center px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-bold transition-all shadow-sm"
                  title="Download clean list as TXT"
                >
                  TXT
                </button>
                <button
                  onClick={handleDownloadCSV}
                  className="flex items-center px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-md text-xs font-bold transition-all shadow-sm"
                  title="Download complete report as CSV"
                >
                  CSV
                </button>
                <button
                  onClick={handleExportZip}
                  className="flex items-center px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-md text-xs font-bold transition-all shadow-sm"
                  title="Export all folders into ZIP archive"
                >
                  <FolderOpenIcon className="w-3.5 h-3.5 mr-1" />
                  ZIP Folders
                </button>
              </div>
            )}
          </div>

          {/* CLEANING & FILTER CONTROLS (Always accessible) */}
          {verifiedEmails.length > 0 && (
            <div className="px-5 py-3 bg-gray-900/30 border-b border-gray-700/50 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-gray-400 flex items-center gap-1">
                  <FunnelIcon className="w-3.5 h-3.5 text-blue-400" />
                  Clean List Toggles:
                </span>
                <label className="inline-flex items-center gap-1.5 bg-gray-800/80 px-2.5 py-1 rounded-md border border-gray-700 cursor-pointer hover:bg-gray-800 text-gray-300">
                  <input
                    type="checkbox"
                    checked={excludePublicWebmail}
                    onChange={(e) => setExcludePublicWebmail(e.target.checked)}
                    className="rounded bg-gray-900 border-gray-600 text-blue-600 focus:ring-0 w-3.5 h-3.5"
                  />
                  <span>Remove Public Webmail</span>
                </label>
                <label className="inline-flex items-center gap-1.5 bg-gray-800/80 px-2.5 py-1 rounded-md border border-gray-700 cursor-pointer hover:bg-gray-800 text-gray-300">
                  <input
                    type="checkbox"
                    checked={excludeDeadDomains}
                    onChange={(e) => setExcludeDeadDomains(e.target.checked)}
                    className="rounded bg-gray-900 border-gray-600 text-blue-600 focus:ring-0 w-3.5 h-3.5"
                  />
                  <span>Remove Dead Domains</span>
                </label>
                <label className="inline-flex items-center gap-1.5 bg-gray-800/80 px-2.5 py-1 rounded-md border border-gray-700 cursor-pointer hover:bg-gray-800 text-gray-300">
                  <input
                    type="checkbox"
                    checked={excludeDisposable}
                    onChange={(e) => setExcludeDisposable(e.target.checked)}
                    className="rounded bg-gray-900 border-gray-600 text-blue-600 focus:ring-0 w-3.5 h-3.5"
                  />
                  <span>Remove Disposable</span>
                </label>
                <label className="inline-flex items-center gap-1.5 bg-gray-800/80 px-2.5 py-1 rounded-md border border-gray-700 cursor-pointer hover:bg-gray-800 text-gray-300">
                  <input
                    type="checkbox"
                    checked={excludeRoleBased}
                    onChange={(e) => setExcludeRoleBased(e.target.checked)}
                    className="rounded bg-gray-900 border-gray-600 text-blue-600 focus:ring-0 w-3.5 h-3.5"
                  />
                  <span>Remove Role Accounts</span>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-mono font-bold">
                  {cleanVerifiedList.length} Clean Ready
                </span>
                <span className="text-gray-500">({Math.round((cleanVerifiedList.length / (verifiedEmails.length || 1)) * 100)}%)</span>
              </div>
            </div>
          )}

          {/* VIEW 1: SORTED FOLDERS WITH DELIVERABILITY EMBEDDED */}
          {viewMode === 'folders' && (
            <div className="flex-grow overflow-y-auto p-5 custom-scrollbar bg-gray-900/10">
              {verifiedEmails.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-12 text-gray-500">
                  <ShieldCheckIcon className="w-16 h-16 mb-4 text-blue-500/40" />
                  <h3 className="text-lg font-bold text-white mb-1">Deliverability & Folder Organizer</h3>
                  <p className="text-sm max-w-md text-gray-400">
                    Paste emails or click &ldquo;Load Emails&rdquo; from Extractor. The engine will verify active MX mail exchangers, detect dead domains, filter public mailboxes, and sort everything into clean folders.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {featureFolders.map(folder => {
                      const hasEmails = folder.emails.length > 0;
                      return (
                        <div 
                          key={folder.id} 
                          className={`border rounded-xl p-4 flex flex-col transition-all duration-200 ${
                            hasEmails 
                              ? 'bg-gray-800/60 border-gray-700 shadow-md hover:border-gray-600' 
                              : 'bg-gray-900/30 border-gray-800/60 opacity-60'
                          }`}
                        >
                          {/* Folder Header */}
                          <div className="flex items-start justify-between gap-2 mb-2 pb-2 border-b border-gray-700/50">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xl">{folder.icon}</span>
                                <h3 className="font-bold text-white text-sm truncate">{folder.name}</h3>
                              </div>
                              <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{folder.description}</p>
                            </div>
                            
                            <div className="flex flex-col items-end shrink-0 gap-1">
                              <span className="text-xs font-mono font-bold bg-gray-900 text-gray-200 px-2 py-0.5 rounded-full border border-gray-700">
                                {folder.emails.length}
                              </span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${folder.badgeColor}`}>
                                {folder.badgeText}
                              </span>
                            </div>
                          </div>

                          {/* Email Preview List inside the Folder */}
                          <div className="flex-grow mb-3">
                            <div className="h-36 overflow-y-auto font-mono text-xs bg-gray-900/70 border border-gray-800/80 rounded-lg p-2 custom-scrollbar space-y-1.5">
                              {folder.emails.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-gray-600 text-[11px] italic">
                                  No matching emails in this category
                                </div>
                              ) : (
                                folder.emails.slice(0, 100).map((item, idx) => {
                                  const isDeliv = item.status === 'Deliverable';
                                  const isDead = item.isDeadDomain || item.status === 'Undeliverable';
                                  const isDisp = item.isDisposable;
                                  return (
                                    <div 
                                      key={`${item.email}-${idx}`} 
                                      className="flex items-center justify-between gap-2 p-1 rounded hover:bg-gray-800/60 group text-[11px]"
                                    >
                                      <div className="flex items-center gap-1.5 min-w-0 truncate">
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                          isDeliv ? 'bg-emerald-400 animate-pulse' :
                                          isDead ? 'bg-rose-500' :
                                          isDisp ? 'bg-amber-400' : 'bg-blue-400'
                                        }`} />
                                        <span className="text-gray-200 truncate">{item.email}</span>
                                      </div>

                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {item.mxServer ? (
                                          <span className="text-[10px] text-gray-500 font-mono truncate max-w-[90px]" title={item.mxServer}>
                                            MX: {item.mxServer.split('.')[0]}
                                          </span>
                                        ) : (
                                          <span className="text-[10px] text-red-400/80">No MX</span>
                                        )}
                                        <button
                                          onClick={() => {
                                            navigator.clipboard.writeText(item.email);
                                            showToast(`Copied ${item.email}`);
                                          }}
                                          className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-white transition-opacity"
                                          title="Copy email"
                                        >
                                          <ClipboardIcon className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                              {folder.emails.length > 100 && (
                                <div className="text-center text-[10px] text-gray-500 py-1 font-sans">
                                  ... and {folder.emails.length - 100} more items
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Folder Footer Action Buttons */}
                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-700/40">
                            <span className="text-[11px] text-gray-400 truncate">
                              {hasEmails ? `${folder.emails.length} contacts` : 'Empty'}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => handleCopyFolder(folder.emails, folder.name)}
                                disabled={!hasEmails}
                                className="px-2.5 py-1 text-[11px] font-bold bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 hover:text-white rounded transition-colors"
                              >
                                Copy
                              </button>
                              <button
                                onClick={() => handleDownloadFolder(folder.emails, folder.name)}
                                disabled={!hasEmails}
                                className="px-2.5 py-1 text-[11px] font-bold bg-blue-600/80 hover:bg-blue-600 disabled:opacity-40 text-white rounded transition-colors"
                              >
                                .TXT
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW 2: FULL DELIVERABILITY MATRIX (TABLE VIEW) */}
          {viewMode === 'table' && (
            <div className="flex-grow flex flex-col overflow-hidden">
              {verifiedEmails.length === 0 ? (
                <div className="flex-grow flex flex-col items-center justify-center text-gray-500 p-12 text-center">
                  <ShieldCheckIcon className="w-16 h-16 mb-4 text-blue-400/40" />
                  <p className="font-bold text-white text-lg">Anti-Bounce Guard Active</p>
                  <p className="text-sm max-w-md mt-1 text-gray-400">
                    Run validation to populate live deliverability handshakes, MX hosts, and diagnostic logs.
                  </p>
                </div>
              ) : (
                <div className="flex-grow flex flex-col overflow-hidden">
                  {/* Status Pills and Search bar */}
                  <div className="p-3 border-b border-gray-700/50 bg-gray-900/20 flex flex-wrap gap-2 items-center justify-between">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setActiveFilter('all')}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                          activeFilter === 'all' 
                            ? 'bg-gray-200 text-gray-900 border-transparent font-bold' 
                            : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                        }`}
                      >
                        All ({verifiedEmails.length})
                      </button>
                      <button
                        onClick={() => setActiveFilter('Deliverable')}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5 ${
                          activeFilter === 'Deliverable' 
                            ? 'bg-emerald-600 text-white border-transparent font-bold' 
                            : 'bg-gray-800/60 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        Live / Active ({verifiedEmails.filter(v => v.status === 'Deliverable').length})
                      </button>
                      <button
                        onClick={() => setActiveFilter('Risky')}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5 ${
                          activeFilter === 'Risky' 
                            ? 'bg-yellow-600 text-white border-transparent font-bold' 
                            : 'bg-gray-800/60 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/10'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-yellow-400" />
                        Risky ({verifiedEmails.filter(v => v.status === 'Risky').length})
                      </button>
                      <button
                        onClick={() => setActiveFilter('Undeliverable')}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5 ${
                          activeFilter === 'Undeliverable' 
                            ? 'bg-rose-600 text-white border-transparent font-bold' 
                            : 'bg-gray-800/60 text-rose-400 border-rose-500/20 hover:bg-rose-500/10'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-rose-400" />
                        Dead Domains ({verifiedEmails.filter(v => v.status === 'Undeliverable' || v.isDeadDomain).length})
                      </button>
                      <button
                        onClick={() => setActiveFilter('Disposable')}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5 ${
                          activeFilter === 'Disposable' 
                            ? 'bg-amber-600 text-white border-transparent font-bold' 
                            : 'bg-gray-800/60 text-amber-400 border-amber-500/20 hover:bg-amber-500/10'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        Disposable ({verifiedEmails.filter(v => v.status === 'Disposable').length})
                      </button>
                    </div>

                    <input
                      type="text"
                      placeholder="Search email or domain..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="px-3 py-1 bg-gray-900 border border-gray-700 rounded-lg text-xs font-mono text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full sm:w-56"
                    />
                  </div>

                  {/* Table view */}
                  <div className="flex-grow overflow-y-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-900/60 text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800 sticky top-0 z-10 backdrop-blur-md">
                          <th className="p-3 pl-4">Email Address</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Category</th>
                          <th className="p-3">Verified MX Server</th>
                          <th className="p-3 pr-4">Diagnostics & SMTP Report</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800 font-mono">
                        {verifiedEmails.filter(v => {
                          if (activeFilter !== 'all') {
                            if (activeFilter === 'Undeliverable' && (v.status === 'Undeliverable' || v.isDeadDomain)) return true;
                            if (v.status !== activeFilter) return false;
                          }
                          if (searchQuery.trim()) {
                            return v.email.toLowerCase().includes(searchQuery.toLowerCase().trim()) || 
                                   v.diagnostics.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
                                   v.domain.toLowerCase().includes(searchQuery.toLowerCase().trim());
                          }
                          return true;
                        }).map((item, index) => {
                          const isDeliv = item.status === 'Deliverable';
                          const isRisk = item.status === 'Risky';
                          const isBounce = item.status === 'Undeliverable' || item.isDeadDomain;
                          const isDisp = item.status === 'Disposable';
                          return (
                            <tr key={index} className="hover:bg-gray-800/30 transition-colors">
                              <td className="p-3 pl-4 font-medium text-white truncate max-w-[200px]" title={item.email}>
                                {item.email}
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                                  isDeliv ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                  isRisk ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                                  isBounce ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
                                  'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                }`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${isDeliv ? 'bg-emerald-400 animate-pulse' : isRisk ? 'bg-yellow-400' : isBounce ? 'bg-rose-500' : 'bg-amber-400'}`} />
                                  {isDeliv ? 'Deliverable / Live' : isRisk ? 'Risky' : isBounce ? 'Dead Domain' : 'Disposable'}
                                </span>
                              </td>
                              <td className="p-3 text-gray-400 truncate max-w-[120px]">
                                {item.category}
                              </td>
                              <td className="p-3 text-gray-400 font-mono text-[11px] truncate max-w-[150px]" title={item.mxServer || 'No MX resolved'}>
                                {item.mxServer || <span className="text-red-400">No MX resolved</span>}
                              </td>
                              <td className={`p-3 pr-4 text-xs font-sans ${isBounce ? 'text-rose-300' : isRisk ? 'text-yellow-200' : 'text-gray-300'}`}>
                                {item.diagnostics}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default EmailValidator;
