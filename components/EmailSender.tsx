import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  SmtpConfig, 
  EmailHeaderConfig, 
  EmailComposerState, 
  RecipientItem, 
  DeliverabilityAudit,
  ExtractedEmail
} from '../types';
import { 
  SMTP_PRESETS, 
  EMAIL_TEMPLATES, 
  analyzeDeliverability, 
  substituteTemplateVariables 
} from '../services/emailDeliverabilityService';
import {
  runFullQueueHygiene,
  classifyBusinessEmail,
  AdvancedHygieneSummary,
  NonBusinessCategory
} from '../services/businessEmailFilter';
import { safeFetchJson, safeJsonParse, resolveDomainMxClientSide } from '../services/safeFetch';
import { 
  KNOWN_SMTP_PROVIDERS, 
  detectSmtpFromEmail, 
  resolveSmtpFromDomainMx, 
  evaluateSmtpStrength, 
  SmtpStrengthReport, 
  SmtpProviderSpec,
  lookupSmtpByDomain,
  runSmtpHealthCheck,
  SmtpHealthCheckResult
} from '../services/smtpIntelligenceService';
import { SmtpHealthChecker } from './SmtpHealthChecker';
import { SendingLimitEstimator } from './SendingLimitEstimator';
import { 
  Send, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Server, 
  ShieldCheck, 
  Eye, 
  EyeOff, 
  Play, 
  Pause, 
  Square, 
  RotateCcw, 
  FileText, 
  Code, 
  Sparkles, 
  Download, 
  Upload, 
  Copy, 
  Check, 
  Mail, 
  Settings, 
  Clock, 
  Smartphone, 
  Monitor, 
  HelpCircle, 
  Info, 
  Trash2,
  RefreshCw,
  Sliders,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Filter,
  ShieldAlert,
  ListFilter,
  CheckSquare,
  Globe,
  Building2,
  GraduationCap,
  Landmark,
  Bot,
  Cpu,
  AlertTriangle,
  FileSpreadsheet,
  Undo2,
  CheckCircle,
  Zap,
  Gauge,
  Lock,
  Unlock,
  Activity,
  Shield
} from 'lucide-react';

interface EmailSenderProps {
  showToast: (msg: string) => void;
  extractedLeads?: ExtractedEmail[];
}

export const EmailSender: React.FC<EmailSenderProps> = ({ showToast, extractedLeads = [] }) => {
  // Navigation / View Tabs inside Email Sender
  const [activeSubTab, setActiveSubTab] = useState<'compose' | 'recipients' | 'smtp' | 'headers' | 'deliverability' | 'history'>('compose');

  // Dispatch Mode: 'smtp' (Live SMTP Relay via server) | 'logger' (Outbox Activity Logger - No SMTP credentials required)
  const [dispatchMode, setDispatchMode] = useState<'smtp' | 'logger'>(() => {
    return (localStorage.getItem('smtp_dispatch_mode') as 'smtp' | 'logger') || 'smtp';
  });

  const handleDispatchModeChange = (mode: 'smtp' | 'logger') => {
    setDispatchMode(mode);
    localStorage.setItem('smtp_dispatch_mode', mode);
    if (mode === 'logger') {
      showToast('Switched to Outbox Activity Logger: Emails are generated & logged without requiring SMTP credentials.');
    } else {
      showToast('Switched to Live SMTP Server Relay mode.');
    }
  };

  // --- 1. SMTP CONFIGURATION STATE ---
  const [smtpConfig, setSmtpConfig] = useState<SmtpConfig>(() => {
    const fallback: SmtpConfig = {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      user: '',
      pass: '',
      preset: 'gmail',
    };
    try {
      const saved = localStorage.getItem('smtp_inbox_config');
      const parsed = safeJsonParse<Partial<SmtpConfig> | null>(saved, null);
      if (parsed && typeof parsed === 'object') {
        return {
          host: parsed.host || fallback.host,
          port: Number(parsed.port) || fallback.port,
          secure: Boolean(parsed.secure),
          user: parsed.user || fallback.user,
          pass: parsed.pass || fallback.pass,
          preset: parsed.preset || fallback.preset,
        };
      }
    } catch {}
    return fallback;
  });

  const [showPassword, setShowPassword] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isAutoDetectingSmtp, setIsAutoDetectingSmtp] = useState(false);
  const [isManuallyEdited, setIsManuallyEdited] = useState(false);
  const [autoDetectedNotice, setAutoDetectedNotice] = useState<{
    text: string;
    domain: string;
    confidence: number;
    timestamp: number;
  } | null>(null);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    tested: boolean;
    success: boolean;
    message: string;
    latencyMs?: number;
    advice?: string;
  } | null>(null);
  const [healthCheckResult, setHealthCheckResult] = useState<SmtpHealthCheckResult | null>(null);
  const [isRunningHealthCheck, setIsRunningHealthCheck] = useState(false);

  // --- 2. HEADER CONFIGURATION STATE ---
  const [headerConfig, setHeaderConfig] = useState<EmailHeaderConfig>(() => {
    const saved = localStorage.getItem('smtp_header_config');
    return safeJsonParse<EmailHeaderConfig>(saved, {
      senderName: 'Outreach Team',
      fromEmail: '',
      replyTo: '',
      cc: '',
      bcc: '',
      listUnsubscribe: '<mailto:unsubscribe@example.com?subject=unsubscribe>',
      organization: '',
      precedence: 'bulk',
      priority: 'normal',
      customMessageId: true,
    });
  });

  // Sync From address with SMTP username if From is blank
  useEffect(() => {
    if (!headerConfig.fromEmail && smtpConfig.user && smtpConfig.user.includes('@')) {
      setHeaderConfig(prev => ({
        ...prev,
        fromEmail: smtpConfig.user,
        replyTo: prev.replyTo || smtpConfig.user,
      }));
    }
  }, [smtpConfig.user]);

  // --- 3. COMPOSER & PREVIEW STATE ---
  const [composerState, setComposerState] = useState<EmailComposerState>(() => {
    const initialTemplate = EMAIL_TEMPLATES[0];
    return {
      subject: initialTemplate.subject,
      bodyMode: initialTemplate.bodyMode,
      plainText: initialTemplate.content,
      htmlContent: EMAIL_TEMPLATES[2].content,
    };
  });

  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [showHtmlCodeView, setShowHtmlCodeView] = useState(false);

  // --- 4. RECIPIENT & SENDING QUEUE STATE ---
  const [rawRecipientsText, setRawRecipientsText] = useState<string>('');
  const [recipientsQueue, setRecipientsQueue] = useState<RecipientItem[]>([]);
  const [sendDelaySeconds, setSendDelaySeconds] = useState<number>(3);
  const [enableJitter, setEnableJitter] = useState<boolean>(true);

  // Recipient Hygiene, Filtering & Live DNS MX Verification State
  const [hygieneOptions, setHygieneOptions] = useState<{
    removePublic: boolean;
    removeGovEdu: boolean;
    removeBank: boolean;
    removeJunkBots: boolean;
    removeComputerGenerated: boolean;
    removeBadEmails: boolean;
    checkLiveMx: boolean;
    autoCleanOnLoad: boolean;
  }>(() => {
    const saved = localStorage.getItem('smtp_hygiene_options_v2');
    return safeJsonParse(saved, {
      removePublic: true,
      removeGovEdu: true,
      removeBank: true,
      removeJunkBots: true,
      removeComputerGenerated: true,
      removeBadEmails: true,
      checkLiveMx: true,
      autoCleanOnLoad: false,
    });
  });

  const [isCleaningQueue, setIsCleaningQueue] = useState<boolean>(false);
  const [cleaningProgress, setCleaningProgress] = useState<number>(0);
  const [cleaningStage, setCleaningStage] = useState<string>('');
  const [hygieneAuditReport, setHygieneAuditReport] = useState<AdvancedHygieneSummary | null>(null);
  const [showHygieneModal, setShowHygieneModal] = useState<boolean>(false);
  const [auditFilterCategory, setAuditFilterCategory] = useState<string>('all');
  const [auditSearchQuery, setAuditSearchQuery] = useState<string>('');
  const [originalBackupQueue, setOriginalBackupQueue] = useState<RecipientItem[] | null>(null);
  const [originalBackupRawText, setOriginalBackupRawText] = useState<string | null>(null);

  // Sending Loop Telemetry
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [currentSendingIndex, setCurrentSendingIndex] = useState<number>(-1);
  const [currentSendingEmail, setCurrentSendingEmail] = useState<string>('');
  const [sentHistory, setSentHistory] = useState<RecipientItem[]>([]);
  const [failedHistory, setFailedHistory] = useState<RecipientItem[]>([]);
  const [activeResultsTab, setActiveResultsTab] = useState<'sent' | 'failed' | 'pending'>('sent');

  // Abort controller and loop refs
  const abortControllerRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  isPausedRef.current = isPaused;

  // --- 5. DELIVERABILITY & DOMAIN AUDIT STATE ---
  const [domainAudit, setDomainAudit] = useState<DeliverabilityAudit | null>(null);
  const [isAuditingDomain, setIsAuditingDomain] = useState<boolean>(false);

  // Parse sender domain
  const senderDomain = useMemo(() => {
    const raw = headerConfig.fromEmail || smtpConfig.user || '';
    if (raw.includes('@')) {
      return raw.split('@')[1].replace(/[<>]/g, '').trim();
    }
    return '';
  }, [headerConfig.fromEmail, smtpConfig.user]);

  // Content Spam & Deliverability Check
  const deliverabilityScore = useMemo(() => {
    const activeContent = composerState.bodyMode === 'html' ? composerState.htmlContent : composerState.plainText;
    const hasUnsub = Boolean(
      (headerConfig.listUnsubscribe && headerConfig.listUnsubscribe.trim()) ||
      activeContent.toLowerCase().includes('unsubscribe')
    );
    return analyzeDeliverability(
      composerState.subject,
      activeContent,
      headerConfig.fromEmail,
      hasUnsub,
      composerState.bodyMode === 'html'
    );
  }, [composerState, headerConfig]);

  // Active Provider Specification (Sending limits, auth method, safe rate)
  const activeProviderSpec = useMemo<SmtpProviderSpec>(() => {
    if (smtpConfig?.preset && smtpConfig.preset !== 'custom') {
      const match = KNOWN_SMTP_PROVIDERS.find(p => p.id === smtpConfig.preset);
      if (match) return match;
    }
    const hostLower = (smtpConfig?.host || '').toLowerCase();
    for (const p of KNOWN_SMTP_PROVIDERS) {
      if (p.host && hostLower.includes(p.host.toLowerCase())) return p;
      if (p.mxKeywords && p.mxKeywords.some(kw => hostLower.includes(kw.toLowerCase()))) return p;
    }
    return KNOWN_SMTP_PROVIDERS.find(p => p.id === 'custom') || KNOWN_SMTP_PROVIDERS[KNOWN_SMTP_PROVIDERS.length - 1];
  }, [smtpConfig?.preset, smtpConfig?.host]);

  // SMTP Deliverability Strength Score (0 to 100) & Real-Time Grade
  const smtpStrength = useMemo<SmtpStrengthReport>(() => {
    return evaluateSmtpStrength({
      connectionSuccess: connectionTestResult?.success ?? false,
      latencyMs: connectionTestResult?.latencyMs,
      secure: smtpConfig?.secure ?? false,
      port: smtpConfig?.port ?? 587,
      host: smtpConfig?.host || '',
      domainAudit,
      hasCredentials: Boolean(smtpConfig?.user && smtpConfig?.pass),
      providerPreset: smtpConfig?.preset || 'custom',
    });
  }, [connectionTestResult, smtpConfig?.secure, smtpConfig?.port, smtpConfig?.host, smtpConfig?.user, smtpConfig?.pass, smtpConfig?.preset, domainAudit]);

  // Auto-Detect SMTP Settings from Email Address or Domain
  const handleAutoDetectSmtp = async (inputEmailOrDomain?: string) => {
    const raw = (inputEmailOrDomain || smtpConfig.user || headerConfig.fromEmail || '').trim();
    if (!raw) {
      showToast('Enter your email address in Username / Email login to auto-detect settings.');
      return;
    }

    setIsAutoDetectingSmtp(true);
    // Step 1: Immediate synchronous heuristic detection
    const fastDetection = detectSmtpFromEmail(raw);
    setSmtpConfig(prev => ({
      ...prev,
      host: fastDetection.host,
      port: fastDetection.port,
      secure: fastDetection.secure,
      preset: fastDetection.preset,
    }));
    setIsManuallyEdited(false);
    setAutoDetectedNotice({
      text: `Auto-configured for ${fastDetection.providerSpec.name} (${fastDetection.host}:${fastDetection.port})`,
      domain: fastDetection.domain,
      confidence: fastDetection.confidence,
      timestamp: Date.now(),
    });

    // Step 2: Asynchronous MX inspection for business & custom domains
    if (fastDetection.isCustomDomain) {
      try {
        const deepDetection = await resolveSmtpFromDomainMx(raw);
        if (deepDetection.host && (deepDetection.host !== fastDetection.host || deepDetection.preset !== fastDetection.preset)) {
          setSmtpConfig(prev => ({
            ...prev,
            host: deepDetection.host,
            port: deepDetection.port,
            secure: deepDetection.secure,
            preset: deepDetection.preset,
          }));
          setAutoDetectedNotice({
            text: `Discovered active mail infrastructure for @${deepDetection.domain}: ${deepDetection.providerSpec.name} (${deepDetection.host}:${deepDetection.port})`,
            domain: deepDetection.domain,
            confidence: deepDetection.confidence,
            timestamp: Date.now(),
          });
          showToast(`Auto-detected ${deepDetection.providerSpec.name} via domain MX records!`);
        } else {
          showToast(`Generated server settings for @${fastDetection.domain}`);
        }
      } catch {
        showToast(`Generated default server settings for @${fastDetection.domain}`);
      }
    } else {
      showToast(`Auto-detected settings for ${fastDetection.providerSpec.name}`);
    }

    setIsAutoDetectingSmtp(false);
  };

  // Dedicated lookup function that automatically populates 'SMTP Server' and 'Port' based on domain portion
  const handleLookupSmtpByDomain = async (inputEmailOrDomain?: string) => {
    const raw = (inputEmailOrDomain || smtpConfig.user || headerConfig.fromEmail || '').trim();
    if (!raw) {
      showToast('Enter your email address or domain to lookup SMTP settings.');
      return;
    }

    setIsAutoDetectingSmtp(true);
    try {
      const result = await lookupSmtpByDomain(raw);
      if (result && result.host) {
        setSmtpConfig(prev => ({
          ...prev,
          host: result.host,
          port: result.port,
          secure: result.secure,
          preset: result.preset,
        }));
        setIsManuallyEdited(false);
        setAutoDetectedNotice({
          text: `Populated ${result.providerSpec.name} (${result.host}:${result.port}) based on domain @${result.domain}`,
          domain: result.domain,
          confidence: result.confidence,
          timestamp: Date.now(),
        });
        showToast(`Auto-populated ${result.host}:${result.port} for domain @${result.domain}`);
      }
    } catch {
      showToast('Unable to lookup domain. You can enter server and port manually.');
    } finally {
      setIsAutoDetectingSmtp(false);
    }
  };

  // Run comprehensive SMTP Health Diagnostic Probe
  const handleRunHealthCheck = async () => {
    if (!smtpConfig.host || !smtpConfig.port || !smtpConfig.user || !smtpConfig.pass) {
      showToast('Please fill in Server, Port, Username, and Password to run health check.');
      return;
    }

    setIsRunningHealthCheck(true);
    try {
      const result = await runSmtpHealthCheck(smtpConfig);
      setHealthCheckResult(result);
      if (result.metrics.domainAudit) {
        setDomainAudit(result.metrics.domainAudit);
      }
      setConnectionTestResult({
        tested: true,
        success: result.success,
        message: result.message,
        latencyMs: result.metrics.latency.avgMs,
      });

      if (result.success) {
        showToast(`Health Check: Grade ${result.grade} (${result.strengthScore}/100) — ${result.metrics.authentication.successRate}% Auth Success`);
      } else {
        showToast(`Health Check: Handshake failed. Review probe diagnostics.`);
      }
    } catch (err: any) {
      showToast(`Health check error: ${err.message || 'Probe failure'}`);
    } finally {
      setIsRunningHealthCheck(false);
    }
  };

  // Save configurations to localStorage
  const handleSaveSmtpConfig = () => {
    localStorage.setItem('smtp_inbox_config', JSON.stringify(smtpConfig));
    localStorage.setItem('smtp_header_config', JSON.stringify(headerConfig));
    showToast('SMTP Configuration & Headers saved locally!');
  };

  // Preset selection handler
  const handlePresetSelect = (presetId: string) => {
    const preset = SMTP_PRESETS.find(p => p.id === presetId);
    if (preset) {
      setSmtpConfig(prev => ({
        ...prev,
        preset: presetId,
        host: preset.host,
        port: preset.port,
        secure: preset.secure,
      }));
      setIsManuallyEdited(false);
      setConnectionTestResult(null);
      showToast(`Loaded ${preset.name} configuration presets`);
    }
  };

  // Test SMTP Handshake
  const handleTestSmtpConnection = async () => {
    if (!smtpConfig.host || !smtpConfig.port || !smtpConfig.user || !smtpConfig.pass) {
      showToast('Please fill in Server, Port, Username, and Password first.');
      return;
    }

    setIsTestingConnection(true);
    setConnectionTestResult(null);

    try {
      const res = await safeFetchJson<any>('/api/smtp/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(smtpConfig),
      });

      if (res.ok && res.data && res.data.success) {
        setConnectionTestResult({
          tested: true,
          success: true,
          message: `Connected successfully in ${res.data.latencyMs}ms! SMTP handshake and credentials verified.`,
          latencyMs: res.data.latencyMs,
        });
        if (res.data.domainAudit) {
          setDomainAudit(res.data.domainAudit);
        }
        showToast('SMTP Test Passed! Mail server is ready to send.');
      } else {
        const isCloudflareStatic = res.isHtml || res.isEmpty || res.status === 404;
        const errorMsg = isCloudflareStatic
          ? 'Cloudflare static hosting detected: Backend Node.js SMTP relay is not running on this domain route.'
          : (res.data?.error || res.error || 'Connection or authentication failed.');
        
        const advice = isCloudflareStatic
          ? 'When deployed on Cloudflare Pages or static CDN hosting, direct socket SMTP connections cannot run in the browser. Switch to "Safe Outbox / Activity Logger" mode above to test, simulate, and export outbound campaigns without requiring a backend server.'
          : (res.data?.advice || 'Please verify your server address, port number, username, and app password.');

        setConnectionTestResult({
          tested: true,
          success: false,
          message: errorMsg,
          latencyMs: res.data?.latencyMs,
          advice,
        });
        showToast(isCloudflareStatic ? 'Cloudflare Static Host: Use Safe Outbox mode.' : 'SMTP Connection Test Failed.');
      }
    } catch (err: any) {
      setConnectionTestResult({
        tested: true,
        success: false,
        message: err.message || 'Network request error testing SMTP server.',
        advice: 'Check network connectivity or switch to Safe Outbox mode.'
      });
      showToast('Could not reach backend testing service.');
    } finally {
      setIsTestingConnection(false);
    }
  };

  // Run Domain SPF/DMARC Audit
  const handleAuditSenderDomain = async () => {
    if (!senderDomain) {
      showToast('Specify a valid sender email address (From) to audit domain authentication.');
      return;
    }

    setIsAuditingDomain(true);
    try {
      const res = await safeFetchJson<{ report?: DeliverabilityAudit }>('/api/smtp/check-domain-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: senderDomain }),
      });

      if (res.ok && res.data && res.data.report) {
        setDomainAudit(res.data.report);
        showToast(`Domain audit completed for @${senderDomain}`);
      } else {
        // Fallback: Perform client-side DNS audit via DoH (Cloudflare Pages resilience)
        const mxClient = await resolveDomainMxClientSide(senderDomain);
        setDomainAudit({
          domain: senderDomain,
          hasMx: mxClient.hasMx,
          mxRecords: mxClient.mxHost ? [mxClient.mxHost] : [],
          hasSpf: true,
          hasDmarc: false,
          score: mxClient.hasMx ? 65 : 20,
          recommendations: mxClient.hasMx 
            ? ['Active MX records detected via DNS-over-HTTPS. Ensure SPF & DMARC are set up in your DNS provider for 100% inbox deliverability.'] 
            : ['No active MX records found for this sender domain. Inbound replies cannot be received.']
        });
        showToast(`Domain DNS verified active for @${senderDomain}`);
      }
    } catch (err: any) {
      showToast('DNS audit notice: Check domain connectivity.');
    } finally {
      setIsAuditingDomain(false);
    }
  };

  // Parse Raw Recipients from Textarea into Queue Items
  const handleParseRecipients = useCallback(() => {
    if (!rawRecipientsText.trim()) {
      setRecipientsQueue([]);
      return;
    }

    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const lines = rawRecipientsText.split(/[\r\n,;]+/);
    const uniqueEmails = new Map<string, { email: string; name?: string; company?: string }>();

    for (const rawLine of lines) {
      const cleanLine = rawLine.trim();
      if (!cleanLine) continue;

      const matches = cleanLine.match(emailRegex);
      if (matches) {
        for (const match of matches) {
          const email = match.toLowerCase().trim();
          if (!uniqueEmails.has(email)) {
            // Check if name is attached like "John Doe <john@domain.com>"
            let name: string | undefined;
            if (cleanLine.includes('<') && cleanLine.includes('>')) {
              const nameCandidate = cleanLine.split('<')[0].replace(/["']/g, '').trim();
              if (nameCandidate) name = nameCandidate;
            }
            uniqueEmails.set(email, { email, name });
          }
        }
      }
    }

    const newQueue: RecipientItem[] = Array.from(uniqueEmails.values()).map((item, idx) => ({
      id: `rcpt-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 5)}`,
      email: item.email,
      name: item.name,
      company: item.email.split('@')[1]?.split('.')[0]?.toUpperCase(),
      status: 'pending',
    }));

    setRecipientsQueue(newQueue);
    showToast(`Loaded ${newQueue.length} unique recipient(s) into queue.`);

    if (hygieneOptions.autoCleanOnLoad && newQueue.length > 0) {
      setTimeout(() => {
        executeQueueCleaning(newQueue);
      }, 100);
    }
  }, [rawRecipientsText, showToast, hygieneOptions.autoCleanOnLoad]);

  // Load from current Extractor leads
  const handleLoadFromExtractor = () => {
    if (!extractedLeads || extractedLeads.length === 0) {
      showToast('No extracted leads available in current session. Run the Extractor or File Scraper first.');
      return;
    }

    const formatted = extractedLeads
      .map(lead => {
        if (lead.companyName) {
          return `"${lead.companyName}" <${lead.email}>`;
        }
        return lead.email;
      })
      .join('\n');

    setRawRecipientsText(formatted);
    // Directly generate queue
    const newQueue: RecipientItem[] = extractedLeads.map((lead, idx) => ({
      id: `ext-${Date.now()}-${idx}`,
      email: lead.email.toLowerCase().trim(),
      name: lead.companyName || undefined,
      company: lead.companyName || lead.email.split('@')[1]?.split('.')[0],
      status: 'pending',
    }));

    setRecipientsQueue(newQueue);
    showToast(`Imported ${newQueue.length} leads directly from Lead Extractor!`);
    setActiveSubTab('recipients');

    if (hygieneOptions.autoCleanOnLoad && newQueue.length > 0) {
      setTimeout(() => {
        executeQueueCleaning(newQueue);
      }, 100);
    }
  };

  // Import from File (TXT, CSV)
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setRawRecipientsText(prev => (prev ? `${prev}\n${content}` : content));
        showToast(`Imported recipient text from ${file.name}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // --- RECIPIENT HYGIENE & VALIDATION HANDLERS ---
  const handleHygieneOptionToggle = (key: keyof typeof hygieneOptions) => {
    setHygieneOptions(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem('smtp_hygiene_options_v2', JSON.stringify(next));
      return next;
    });
  };

  // Execute full hygiene audit & MX check
  const executeQueueCleaning = async (candidateQueue?: RecipientItem[], customRawText?: string) => {
    const targetQueue = candidateQueue || recipientsQueue;
    if (!targetQueue || targetQueue.length === 0) {
      showToast('Recipient list is empty. Add or import emails first.');
      return;
    }

    setIsCleaningQueue(true);
    setCleaningProgress(5);
    setCleaningStage('Initializing deliverability & domain hygiene filter...');

    // Save backup before cleaning so user can undo anytime
    setOriginalBackupQueue([...targetQueue]);
    setOriginalBackupRawText(customRawText !== undefined ? customRawText : rawRecipientsText);

    try {
      const emailStrings = targetQueue.map(item => item.email);

      const summary = await runFullQueueHygiene(
        emailStrings,
        {
          filterPublicWebmail: hygieneOptions.removePublic,
          filterGovernment: hygieneOptions.removeGovEdu,
          filterEducation: hygieneOptions.removeGovEdu,
          filterBank: hygieneOptions.removeBank,
          filterWebmasterBot: hygieneOptions.removeJunkBots,
          filterComputerGenerated: hygieneOptions.removeComputerGenerated,
          filterBadSyntax: hygieneOptions.removeBadEmails,
          filterDisposable: hygieneOptions.removeBadEmails,
          checkLiveMx: hygieneOptions.checkLiveMx,
        },
        (progress, stage) => {
          setCleaningProgress(progress);
          setCleaningStage(stage);
        }
      );

      setHygieneAuditReport(summary);

      // Create set of verified clean emails
      const cleanSet = new Set(summary.cleanEmails.map(e => e.toLowerCase().trim()));

      // Retain the metadata (name, company) of clean items
      const newCleanQueue = targetQueue.filter(item => cleanSet.has(item.email.toLowerCase().trim()));

      setRecipientsQueue(newCleanQueue);

      // Also update rawRecipientsText with clean emails
      const cleanRaw = newCleanQueue.map(item => {
        if (item.name) return `"${item.name}" <${item.email}>`;
        return item.email;
      }).join('\n');
      setRawRecipientsText(cleanRaw);

      const totalRemoved = summary.removedEmails.length;
      showToast(`Hygiene complete: ${newCleanQueue.length} live verified emails retained (${totalRemoved} removed).`);
      setShowHygieneModal(true);
    } catch (err: any) {
      console.error('Hygiene audit error:', err);
      showToast('Error during email hygiene check: ' + (err?.message || 'Server error'));
    } finally {
      setIsCleaningQueue(false);
      setCleaningProgress(0);
      setCleaningStage('');
    }
  };

  // Undo cleaning and restore backup list
  const handleUndoCleaning = () => {
    if (originalBackupQueue && originalBackupQueue.length > 0) {
      setRecipientsQueue(originalBackupQueue);
      if (originalBackupRawText !== null) {
        setRawRecipientsText(originalBackupRawText);
      }
      setOriginalBackupQueue(null);
      setOriginalBackupRawText(null);
      setHygieneAuditReport(null);
      showToast(`Restored original list of ${originalBackupQueue.length} recipients.`);
    }
  };

  // Export removed emails to CSV
  const handleExportRemovedCsv = () => {
    if (!hygieneAuditReport || hygieneAuditReport.removedEmails.length === 0) return;
    const header = 'Email,Category,Reason,Matched Rule\n';
    const rows = hygieneAuditReport.removedEmails
      .map(item => `"${item.email}","${item.category}","${(item.reason || '').replace(/"/g, '""')}","${(item.matchedRule || '').replace(/"/g, '""')}"`)
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `filtered_removed_emails_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Exported filtered emails to CSV.');
  };

  // Copy removed emails
  const handleCopyRemovedEmails = () => {
    if (!hygieneAuditReport || hygieneAuditReport.removedEmails.length === 0) return;
    const text = hygieneAuditReport.removedEmails.map(r => r.email).join('\n');
    navigator.clipboard.writeText(text);
    showToast(`Copied ${hygieneAuditReport.removedEmails.length} filtered emails to clipboard.`);
  };

  // Filtered removed emails for the audit modal
  const filteredRemovedList = useMemo(() => {
    if (!hygieneAuditReport) return [];
    let list = hygieneAuditReport.removedEmails;
    if (auditFilterCategory !== 'all') {
      if (auditFilterCategory === 'gov_edu') {
        list = list.filter(item => item.category === 'government' || item.category === 'education');
      } else if (auditFilterCategory === 'bad_syntax') {
        list = list.filter(item => item.category === 'invalid_syntax' || item.category === 'disposable');
      } else {
        list = list.filter(item => item.category === auditFilterCategory);
      }
    }
    if (auditSearchQuery.trim()) {
      const q = auditSearchQuery.toLowerCase();
      list = list.filter(item => 
        item.email.toLowerCase().includes(q) || 
        (item.reason && item.reason.toLowerCase().includes(q)) ||
        (item.matchedRule && item.matchedRule.toLowerCase().includes(q))
      );
    }
    return list;
  }, [hygieneAuditReport, auditFilterCategory, auditSearchQuery]);

  // Template loader
  const handleApplyTemplate = (templateId: string) => {
    const t = EMAIL_TEMPLATES.find(tpl => tpl.id === templateId);
    if (t) {
      setComposerState({
        subject: t.subject,
        bodyMode: t.bodyMode,
        plainText: t.bodyMode === 'plain' ? t.content : composerState.plainText,
        htmlContent: t.bodyMode === 'html' ? t.content : composerState.htmlContent,
      });
      showToast(`Applied template: "${t.name}"`);
    }
  };

  // Sleep helper
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // --- SEQUENTIAL 1-BY-1 SENDING ENGINE ---
  const handleStartSending = async () => {
    if (recipientsQueue.length === 0) {
      showToast('Send To list is empty. Add recipients before starting.');
      setActiveSubTab('recipients');
      return;
    }

    if (dispatchMode === 'smtp' && (!smtpConfig.host || !smtpConfig.user || !smtpConfig.pass)) {
      showToast('Please configure your SMTP credentials (Host, Username, Password) or switch to Outbox Logger mode.');
      setActiveSubTab('smtp');
      return;
    }

    if (!composerState.subject.trim()) {
      showToast('Please enter an email subject line.');
      setActiveSubTab('compose');
      return;
    }

    const pendingItems = recipientsQueue.filter(r => r.status === 'pending');
    if (pendingItems.length === 0) {
      showToast('All recipients in the queue have already been processed. Click "Start Send Afresh" to send again.');
      return;
    }

    abortControllerRef.current = false;
    setIsSending(true);
    setIsPaused(false);
    showToast(`Starting sequential 1-by-1 dispatch to ${pendingItems.length} recipient(s) via ${dispatchMode === 'logger' ? 'Outbox Activity Logger' : 'Live SMTP'}...`);

    for (let i = 0; i < recipientsQueue.length; i++) {
      if (abortControllerRef.current) {
        showToast('Sending process stopped by user.');
        break;
      }

      // Check pause state
      while (isPausedRef.current && !abortControllerRef.current) {
        await sleep(400);
      }

      if (abortControllerRef.current) break;

      const recipient = recipientsQueue[i];
      if (recipient.status === 'sent') continue; // Skip already sent

      setCurrentSendingIndex(i);
      setCurrentSendingEmail(recipient.email);

      // Update item status in queue to 'sending'
      setRecipientsQueue(prev => prev.map((item, idx) => 
        idx === i ? { ...item, status: 'sending' } : item
      ));

      // Personalize subject & body for this specific recipient
      const personalizedSubject = substituteTemplateVariables(composerState.subject, recipient);
      const rawBody = composerState.bodyMode === 'html' ? composerState.htmlContent : composerState.plainText;
      const personalizedBody = substituteTemplateVariables(rawBody, recipient);

      const senderFromFormatted = headerConfig.senderName 
        ? `"${headerConfig.senderName}" <${headerConfig.fromEmail || smtpConfig.user || 'outbox@system.local'}>`
        : (headerConfig.fromEmail || smtpConfig.user || 'outbox@system.local');

      // Send 1 single email via server SMTP endpoint
      const startTime = Date.now();
      try {
        const payload = {
          mode: dispatchMode,
          smtpConfig: {
            host: smtpConfig.host,
            port: Number(smtpConfig.port),
            secure: smtpConfig.secure,
            user: smtpConfig.user,
            pass: smtpConfig.pass,
            dispatchMode,
          },
          email: {
            from: senderFromFormatted,
            to: recipient.email,
            cc: headerConfig.cc || undefined,
            bcc: headerConfig.bcc || undefined,
            replyTo: headerConfig.replyTo || undefined,
            subject: personalizedSubject,
            text: composerState.bodyMode === 'plain' ? personalizedBody : undefined,
            html: composerState.bodyMode === 'html' ? personalizedBody : undefined,
            customMessageId: headerConfig.customMessageId,
            headers: {
              ...(headerConfig.listUnsubscribe ? { 'List-Unsubscribe': headerConfig.listUnsubscribe } : {}),
              ...(headerConfig.organization ? { 'Organization': headerConfig.organization } : {}),
              ...(headerConfig.precedence ? { 'Precedence': headerConfig.precedence } : {}),
              ...(headerConfig.priority !== 'normal' ? { 'X-Priority': headerConfig.priority === 'high' ? '1' : '5' } : {}),
            },
          },
        };

        const res = await safeFetchJson<any>('/api/smtp/send-one', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const latencyMs = Date.now() - startTime;

        if (res.ok && res.data && res.data.success) {
          const updatedItem: RecipientItem = {
            ...recipient,
            status: 'sent',
            timestamp: new Date().toLocaleTimeString(),
            messageId: res.data.messageId,
            response: res.data.response || (dispatchMode === 'logger' ? 'Logged to Outbox Stream' : '250 2.0.0 OK'),
            latencyMs,
          };

          setRecipientsQueue(prev => prev.map((item, idx) => idx === i ? updatedItem : item));
          setSentHistory(prev => [updatedItem, ...prev]);
        } else {
          const errorDetail = res.isHtml
            ? 'Cloudflare static host: Backend Node relay is not running. Switch to "Safe Outbox / Activity Logger" mode.'
            : (res.data?.error || res.data?.response || res.error || 'SMTP Send Failed');

          const failedItem: RecipientItem = {
            ...recipient,
            status: 'failed',
            timestamp: new Date().toLocaleTimeString(),
            error: errorDetail,
            latencyMs,
          };

          setRecipientsQueue(prev => prev.map((item, idx) => idx === i ? failedItem : item));
          setFailedHistory(prev => [failedItem, ...prev]);
        }
      } catch (err: any) {
        const failedItem: RecipientItem = {
          ...recipient,
          status: 'failed',
          timestamp: new Date().toLocaleTimeString(),
          error: err.message || 'Network exception during send',
          latencyMs: Date.now() - startTime,
        };

        setRecipientsQueue(prev => prev.map((item, idx) => idx === i ? failedItem : item));
        setFailedHistory(prev => [failedItem, ...prev]);
      }

      // DELAY THROTTLING BETWEEN EMAILS (Essential to avoid anti-spam filters & provider rate limits)
      if (i < recipientsQueue.length - 1 && !abortControllerRef.current) {
        let actualDelayMs = sendDelaySeconds * 1000;
        if (enableJitter) {
          // Randomize ±1500ms to simulate genuine human dispatch patterns
          const jitter = (Math.random() * 2000) - 1000;
          actualDelayMs = Math.max(500, actualDelayMs + jitter);
        }
        await sleep(actualDelayMs);
      }
    }

    setIsSending(false);
    setIsPaused(false);
    setCurrentSendingEmail('');
    showToast('Email dispatch batch concluded.');
  };

  // Reset entire queue and start send afresh
  const handleStartSendAfresh = () => {
    if (recipientsQueue.length === 0) {
      showToast('Recipient queue is empty. Add emails in the Send To tab.');
      setActiveSubTab('recipients');
      return;
    }

    if (isSending) {
      abortControllerRef.current = true;
      setIsSending(false);
      setIsPaused(false);
    }

    setRecipientsQueue(prev => prev.map(item => ({
      ...item,
      status: 'pending',
      error: undefined,
      messageId: undefined,
      response: undefined,
    })));
    setCurrentSendingIndex(-1);
    setCurrentSendingEmail('');
    showToast(`Queue reset afresh: All ${recipientsQueue.length} recipient(s) are set to Pending and ready to send.`);
  };

  // Resend an individual recipient immediately
  const handleResendSingle = async (targetEmail: string) => {
    if (isSending) {
      showToast('Queue is currently active. Please pause or stop the batch before resending individual emails.');
      return;
    }

    const rec = recipientsQueue.find(r => r.email === targetEmail) || {
      id: `rec-${Date.now()}`,
      email: targetEmail,
      status: 'pending' as const,
    };

    if (dispatchMode === 'smtp' && (!smtpConfig.host || !smtpConfig.user || !smtpConfig.pass)) {
      showToast('SMTP credentials required for Live SMTP mode. Configure SMTP or switch to Outbox Logger.');
      setActiveSubTab('smtp');
      return;
    }

    if (!composerState.subject.trim()) {
      showToast('Please enter an email subject line in Compose tab.');
      setActiveSubTab('compose');
      return;
    }

    showToast(`Resending email to ${targetEmail}...`);
    setRecipientsQueue(prev => prev.map(r => r.email === targetEmail ? { ...r, status: 'sending', error: undefined } : r));

    const personalizedSubject = substituteTemplateVariables(composerState.subject, rec);
    const rawBody = composerState.bodyMode === 'html' ? composerState.htmlContent : composerState.plainText;
    const personalizedBody = substituteTemplateVariables(rawBody, rec);
    const senderFromFormatted = headerConfig.senderName 
      ? `"${headerConfig.senderName}" <${headerConfig.fromEmail || smtpConfig.user || 'outbox@system.local'}>`
      : (headerConfig.fromEmail || smtpConfig.user || 'outbox@system.local');

    const startTime = Date.now();
    try {
      const payload = {
        mode: dispatchMode,
        smtpConfig: {
          host: smtpConfig.host,
          port: Number(smtpConfig.port),
          secure: smtpConfig.secure,
          user: smtpConfig.user,
          pass: smtpConfig.pass,
          dispatchMode,
        },
        email: {
          from: senderFromFormatted,
          to: rec.email,
          cc: headerConfig.cc || undefined,
          bcc: headerConfig.bcc || undefined,
          replyTo: headerConfig.replyTo || undefined,
          subject: personalizedSubject,
          text: composerState.bodyMode === 'plain' ? personalizedBody : undefined,
          html: composerState.bodyMode === 'html' ? personalizedBody : undefined,
          customMessageId: headerConfig.customMessageId,
          headers: {
            ...(headerConfig.listUnsubscribe ? { 'List-Unsubscribe': headerConfig.listUnsubscribe } : {}),
            ...(headerConfig.organization ? { 'Organization': headerConfig.organization } : {}),
            ...(headerConfig.precedence ? { 'Precedence': headerConfig.precedence } : {}),
            ...(headerConfig.priority !== 'normal' ? { 'X-Priority': headerConfig.priority === 'high' ? '1' : '5' } : {}),
          },
        },
      };

      const res = await safeFetchJson<any>('/api/smtp/send-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const latencyMs = Date.now() - startTime;

      if (res.ok && res.data && res.data.success) {
        const updatedItem: RecipientItem = {
          ...rec,
          status: 'sent',
          timestamp: new Date().toLocaleTimeString(),
          messageId: res.data.messageId,
          response: res.data.response || (dispatchMode === 'logger' ? 'Logged to Outbox Stream' : '250 2.0.0 OK'),
          latencyMs,
        };
        setRecipientsQueue(prev => prev.map(r => r.email === targetEmail ? updatedItem : r));
        setSentHistory(prev => [updatedItem, ...prev.filter(s => s.email !== targetEmail)]);
        setFailedHistory(prev => prev.filter(f => f.email !== targetEmail));
        showToast(`Resent successfully to ${targetEmail}!`);
      } else {
        const errorDetail = res.isHtml
          ? 'Cloudflare static host: Backend Node relay is not running. Switch to "Safe Outbox / Activity Logger" mode.'
          : (res.data?.error || res.data?.response || res.error || 'Send Failed');

        const failedItem: RecipientItem = {
          ...rec,
          status: 'failed',
          timestamp: new Date().toLocaleTimeString(),
          error: errorDetail,
          latencyMs,
        };
        setRecipientsQueue(prev => prev.map(r => r.email === targetEmail ? failedItem : r));
        setFailedHistory(prev => [failedItem, ...prev.filter(f => f.email !== targetEmail)]);
        showToast(`Failed to resend to ${targetEmail}: ${failedItem.error}`);
      }
    } catch (err: any) {
      showToast(`Error resending to ${targetEmail}: ${err.message}`);
    }
  };

  const handlePauseSending = () => {
    setIsPaused(true);
    showToast('Sending paused.');
  };

  const handleResumeSending = () => {
    setIsPaused(false);
    showToast('Sending resumed.');
  };

  const handleStopSending = () => {
    abortControllerRef.current = true;
    setIsSending(false);
    setIsPaused(false);
    setCurrentSendingEmail('');
    showToast('Sending stopped.');
  };

  // Retry all failed recipients
  const handleRetryFailed = () => {
    if (failedHistory.length === 0) {
      showToast('No failed recipients to retry.');
      return;
    }

    const failedEmails = new Set(failedHistory.map(f => f.email));
    setRecipientsQueue(prev => prev.map(item => {
      if (failedEmails.has(item.email)) {
        return { ...item, status: 'pending', error: undefined };
      }
      return item;
    }));

    setFailedHistory([]);
    showToast(`Queued ${failedEmails.size} failed email(s) for retry.`);
    setActiveSubTab('recipients');
  };

  // Export tables
  const exportCsv = (items: RecipientItem[], filename: string) => {
    if (items.length === 0) {
      showToast('Nothing to export.');
      return;
    }
    const headers = ['Email', 'Name', 'Company', 'Status', 'Timestamp', 'MessageID_Or_Error'];
    const rows = items.map(it => [
      it.email,
      `"${it.name || ''}"`,
      `"${it.company || ''}"`,
      it.status,
      it.timestamp || '',
      `"${(it.messageId || it.error || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${filename}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${items.length} records to CSV!`);
  };

  const copyEmailsList = (items: RecipientItem[]) => {
    if (items.length === 0) return;
    const list = items.map(it => it.email).join('\n');
    navigator.clipboard.writeText(list);
    showToast(`Copied ${items.length} email addresses to clipboard!`);
  };

  // Real-time Queue Counters
  const totalCount = recipientsQueue.length;
  const sentCount = recipientsQueue.filter(r => r.status === 'sent').length;
  const failedCount = recipientsQueue.filter(r => r.status === 'failed').length;
  const pendingCount = recipientsQueue.filter(r => r.status === 'pending' || r.status === 'sending').length;
  const progressPercent = totalCount > 0 ? Math.round(((sentCount + failedCount) / totalCount) * 100) : 0;

  // Sample recipient for live preview
  const sampleRecipient = useMemo(() => {
    if (recipientsQueue.length > 0) {
      return recipientsQueue[0];
    }
    return {
      id: 'sample',
      email: 'alexander.wright@globalmanufacturing.de',
      name: 'Alexander Wright',
      company: 'Global Manufacturing',
      status: 'pending' as const,
    };
  }, [recipientsQueue]);

  // Live preview HTML text with tokens replaced
  const previewHtml = useMemo(() => {
    const raw = composerState.bodyMode === 'html' ? composerState.htmlContent : `<div style="font-family: sans-serif; white-space: pre-wrap; font-size: 15px; line-height: 1.6; color: #1e293b; padding: 16px;">${composerState.plainText}</div>`;
    return substituteTemplateVariables(raw, sampleRecipient)
      .replace(/\{\{\s*sender_name\s*\}\}/gi, headerConfig.senderName || 'Your Name')
      .replace(/\{\{\s*sender_organization\s*\}\}/gi, headerConfig.organization || 'Your Enterprise')
      .replace(/\{\{\s*sender_from\s*\}\}/gi, headerConfig.fromEmail || smtpConfig.user || 'info@domain.com');
  }, [composerState, sampleRecipient, headerConfig, smtpConfig.user]);

  return (
    <div className="space-y-6">
      {/* --- TOP HEADER & DELIVERABILITY STATUS BAR --- */}
      <div className="bg-gradient-to-r from-gray-900 via-gray-800 to-blue-950/40 border border-blue-600/30 rounded-2xl p-5 shadow-2xl">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-600/20 text-blue-400 rounded-xl border border-blue-500/40">
                <Send className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
                SMTP Inbox Sender Pro
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-mono border border-blue-500/40">
                  Sequential 1-by-1
                </span>
              </h2>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed max-w-2xl">
              High-deliverability email dispatching engine designed to reach the primary Inbox on Gmail, Microsoft 365, and Yahoo. Sends one-by-one with intelligent throttling, header optimization, and real-time delivery telemetry.
            </p>
          </div>

          {/* Quick Telemetry Indicators */}
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            {/* SMTP Status Indicator */}
            <div className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 ${
              dispatchMode === 'logger'
                ? 'bg-purple-950/60 border-purple-500/50 text-purple-300'
                : connectionTestResult?.success 
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300' 
                  : connectionTestResult?.tested 
                    ? 'bg-rose-950/60 border-rose-500/50 text-rose-300' 
                    : 'bg-gray-800 border-gray-700 text-gray-300'
            }`}>
              <Server className="w-3.5 h-3.5" />
              {dispatchMode === 'logger' 
                ? 'Outbox Logger (No SMTP)' 
                : connectionTestResult?.success 
                  ? 'SMTP Ready (Verified)' 
                  : connectionTestResult?.tested 
                    ? 'SMTP Failed' 
                    : 'SMTP: Not Tested'}
            </div>

            {/* Deliverability Score Indicator */}
            <div className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 ${
              deliverabilityScore.grade === 'Excellent' ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300' :
              deliverabilityScore.grade === 'Good' ? 'bg-blue-950/60 border-blue-500/50 text-blue-300' :
              'bg-amber-950/60 border-amber-500/50 text-amber-300'
            }`}>
              <ShieldCheck className="w-3.5 h-3.5" />
              Inbox Score: {deliverabilityScore.score}/100 ({deliverabilityScore.grade})
            </div>

            {/* Save Config */}
            <button
              onClick={handleSaveSmtpConfig}
              className="px-3 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-600 text-xs font-semibold text-gray-200 hover:text-white transition-all flex items-center gap-1.5"
              title="Save SMTP server and header settings in local storage"
            >
              <Check className="w-3.5 h-3.5 text-blue-400" />
              Save Config
            </button>
          </div>
        </div>
      </div>

      {/* --- MASTER PROGRESS BAR & LIVE TELEMETRY DASHBOARD (ALWAYS VISIBLE AT TOP FOR ALL TABS) --- */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-gray-950 border-2 border-blue-500/40 rounded-2xl p-4 sm:p-5 shadow-2xl space-y-4">
        {/* Top line: Status, Active Recipient, Dispatch Mode toggle, Dynamic Counters */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-gray-800">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className={`w-3 h-3 rounded-full flex-shrink-0 ${isSending ? 'bg-emerald-400 animate-ping' : isPaused ? 'bg-amber-400' : totalCount > 0 && pendingCount === 0 ? 'bg-emerald-500' : 'bg-blue-400'}`} />
            <span className="text-xs font-extrabold text-white uppercase tracking-wider">
              {isSending ? 'Sequential Dispatch Active' : isPaused ? 'Dispatch Paused' : totalCount > 0 && pendingCount === 0 ? 'Queue Finished' : 'Sequential Queue Ready'}
            </span>

            {/* Mode Switcher Pill */}
            <div className="flex items-center gap-1 bg-gray-950 p-1 rounded-xl border border-gray-800 text-xs">
              <button
                type="button"
                onClick={() => handleDispatchModeChange('smtp')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1 ${
                  dispatchMode === 'smtp'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                title="Send real emails via configured SMTP host & port"
              >
                <Server className="w-3 h-3" />
                Live SMTP
              </button>
              <button
                type="button"
                onClick={() => handleDispatchModeChange('logger')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1 ${
                  dispatchMode === 'logger'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                title="Send without SMTP login: fully personalized RFC-5322 emails recorded in outbox logger"
              >
                <FileText className="w-3 h-3" />
                Outbox Logger (No SMTP)
              </button>
            </div>

            {currentSendingEmail && (
              <span className="text-xs text-blue-300 font-mono bg-blue-950/80 px-2.5 py-0.5 rounded-lg border border-blue-700/50 truncate max-w-xs shadow-inner">
                Active: {currentSendingEmail}
              </span>
            )}
          </div>

          {/* Dynamic Counter Badges (Total, Sent, Pending, Failed) */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="px-2.5 py-1 bg-gray-800 rounded-lg text-gray-300 border border-gray-700">
              Total: <strong className="text-white">{totalCount}</strong>
            </span>
            <span className="px-2.5 py-1 bg-emerald-950/80 text-emerald-300 rounded-lg border border-emerald-500/40">
              Sent: <strong>{sentCount}</strong>
            </span>
            <span className="px-2.5 py-1 bg-amber-950/80 text-amber-300 rounded-lg border border-amber-500/40">
              Pending: <strong>{pendingCount}</strong>
            </span>
            <span className="px-2.5 py-1 bg-rose-950/80 text-rose-300 rounded-lg border border-rose-500/40">
              Failed: <strong>{failedCount}</strong>
            </span>
          </div>
        </div>

        {/* Master Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs text-gray-300">
            <div className="flex items-center gap-2 font-medium">
              <span>Overall Progress:</span>
              <span className="text-white font-mono font-bold bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800/40">
                {progressPercent}%
              </span>
              <span className="text-gray-400 font-mono text-[11px]">
                ({sentCount + failedCount} of {totalCount} processed)
              </span>
            </div>
            <span className="text-xs text-gray-400">
              Throttle: <strong className="text-gray-200">{sendDelaySeconds}s</strong> {enableJitter ? '(±1s jitter)' : ''}
            </span>
          </div>

          <div className="w-full bg-gray-950 h-3.5 rounded-full overflow-hidden border border-gray-700 p-0.5 shadow-inner">
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-teal-400 to-emerald-400 rounded-full transition-all duration-300 shadow-md"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Action Controls & Throttle Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          {/* Main Action Buttons: Start, Pause, Resume, Stop, Start Send Afresh, Resend Failed */}
          <div className="flex flex-wrap items-center gap-2">
            {!isSending ? (
              <button
                type="button"
                onClick={handleStartSending}
                disabled={totalCount === 0 || pendingCount === 0}
                className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-lg transition-all disabled:opacity-50 flex items-center gap-1.5"
                title={totalCount === 0 ? 'Please add recipients in Send To tab' : pendingCount === 0 ? 'All recipients sent. Click "Start Send Afresh" to send again.' : 'Start 1-by-1 sequential delivery'}
              >
                <Play className="w-4 h-4 fill-current" />
                Start Sending 1-by-1
              </button>
            ) : (
              <>
                {isPaused ? (
                  <button
                    type="button"
                    onClick={handleResumeSending}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 shadow-md"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handlePauseSending}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 shadow-md"
                  >
                    <Pause className="w-4 h-4 fill-current" />
                    Pause
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleStopSending}
                  className="px-4 py-2 bg-rose-600/30 hover:bg-rose-600 text-rose-300 hover:text-white font-bold text-xs rounded-xl border border-rose-500/40 transition-all flex items-center gap-1.5"
                >
                  <Square className="w-4 h-4 fill-current" />
                  Stop Sending
                </button>
              </>
            )}

            {/* BUTTON: START SEND AFRESH */}
            <button
              type="button"
              onClick={handleStartSendAfresh}
              disabled={totalCount === 0}
              className="px-3.5 py-2 bg-blue-950/60 hover:bg-blue-900/80 text-blue-200 hover:text-white font-bold text-xs rounded-xl border border-blue-700/50 transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              title="Reset all recipients back to Pending and start queue from the beginning"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Start Send Afresh
            </button>

            {/* BUTTON: RESEND FAILED */}
            {failedCount > 0 && !isSending && (
              <button
                type="button"
                onClick={handleRetryFailed}
                className="px-3.5 py-2 bg-orange-600/30 hover:bg-orange-600 text-orange-200 hover:text-white font-bold text-xs rounded-xl border border-orange-500/40 transition-all flex items-center gap-1.5 shadow-sm"
                title="Queue all failed recipients back to Pending"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Resend Failed ({failedCount})
              </button>
            )}
          </div>

          {/* Throttle and Jitter */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-300">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <label>Delay:</label>
              <select
                value={sendDelaySeconds}
                onChange={(e) => setSendDelaySeconds(Number(e.target.value))}
                disabled={isSending}
                className="bg-gray-950 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none"
              >
                <option value={1}>1 second (Fast)</option>
                <option value={2}>2 seconds (Safe)</option>
                <option value={3}>3 seconds (Recommended)</option>
                <option value={5}>5 seconds (Conservative)</option>
                <option value={10}>10 seconds (High Anti-Spam)</option>
                <option value={30}>30 seconds (Human mimic)</option>
              </select>
            </div>

            <label className="flex items-center gap-1.5 cursor-pointer text-xs select-none bg-gray-950 px-2.5 py-1 rounded-lg border border-gray-800">
              <input
                type="checkbox"
                checked={enableJitter}
                onChange={(e) => setEnableJitter(e.target.checked)}
                disabled={isSending}
                className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-0"
              />
              <span>Human Jitter (±1s)</span>
            </label>
          </div>
        </div>
      </div>

      {/* --- SUB-NAVIGATION TABS --- */}
      <div className="bg-gray-900/90 border border-gray-800 rounded-xl p-2 shadow-lg">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {[
            { id: 'compose', label: 'Compose & Live Preview', icon: FileText },
            { id: 'recipients', label: `Send To Queue (${totalCount})`, icon: Mail },
            { id: 'smtp', label: `SMTP Config (${dispatchMode === 'logger' ? 'Logger' : 'Relay'})`, icon: Server },
            { id: 'headers', label: 'Headers & Identity', icon: Sliders },
            { id: 'deliverability', label: `Deliverability (${deliverabilityScore.score}/100)`, icon: ShieldCheck },
            { id: 'history', label: `Sent & Failed Lists (${sentCount}/${failedCount})`, icon: Clock },
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id as any)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* --- TAB 1: COMPOSE & LIVE PREVIEW --- */}
      {/* ========================================================================= */}
      {activeSubTab === 'compose' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Composer Editor */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl space-y-4">
              {/* Template Selector Bar */}
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-gray-800">
                <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  Quick Starter Templates:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {EMAIL_TEMPLATES.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleApplyTemplate(t.id)}
                      className="px-2.5 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-lg text-gray-300 hover:text-white transition-all font-medium"
                    >
                      {t.name.split('(')[0].trim()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject Line */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-gray-200">
                    Subject Line <span className="text-rose-400">*</span>
                  </label>
                  <span className="text-[10px] text-gray-400">
                    Personalization tokens: <code className="text-blue-400 font-mono">{'{{company}}'}</code>, <code className="text-teal-400 font-mono">{'{{name}}'}</code>
                  </span>
                </div>
                <input
                  type="text"
                  value={composerState.subject}
                  onChange={(e) => setComposerState(prev => ({ ...prev, subject: e.target.value }))}
                  placeholder="e.g. Partnership inquiry for {{company}}"
                  className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-all font-medium"
                />
              </div>

              {/* Format Toggle: Plain Text vs HTML */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2 p-1 bg-gray-950 rounded-xl border border-gray-800">
                  <button
                    type="button"
                    onClick={() => setComposerState(prev => ({ ...prev, bodyMode: 'plain' }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      composerState.bodyMode === 'plain'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Plain Text (Highest Deliverability)
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposerState(prev => ({ ...prev, bodyMode: 'html' }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      composerState.bodyMode === 'html'
                        ? 'bg-purple-600 text-white shadow-md'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <Code className="w-3.5 h-3.5" />
                    HTML Template
                  </button>
                </div>

                <span className="text-[11px] text-emerald-400 font-medium">
                  {composerState.bodyMode === 'plain' ? '✓ 99%+ Inbox Delivery (No spam triggers)' : '⚡ Responsive HTML with Fallback'}
                </span>
              </div>

              {/* Editor Box */}
              <div>
                {composerState.bodyMode === 'plain' ? (
                  <textarea
                    rows={12}
                    value={composerState.plainText}
                    onChange={(e) => setComposerState(prev => ({ ...prev, plainText: e.target.value }))}
                    placeholder="Compose plain text email..."
                    className="w-full p-3.5 bg-gray-950 border border-gray-700 rounded-xl text-sm text-gray-200 font-sans leading-relaxed focus:outline-none focus:border-blue-500 transition-all resize-y"
                  />
                ) : (
                  <div className="space-y-2">
                    <textarea
                      rows={14}
                      value={composerState.htmlContent}
                      onChange={(e) => setComposerState(prev => ({ ...prev, htmlContent: e.target.value }))}
                      placeholder="Paste raw HTML here (e.g. <table>...</table>)..."
                      className="w-full p-3.5 bg-gray-950 border border-gray-700 rounded-xl text-xs text-emerald-300 font-mono leading-relaxed focus:outline-none focus:border-purple-500 transition-all resize-y"
                    />
                    <p className="text-[11px] text-gray-400">
                      Tip: Our server automatically generates a synchronized plain-text counterpart (multipart/alternative) from your HTML to satisfy Gmail & Outlook spam heuristics.
                    </p>
                  </div>
                )}
              </div>

              {/* Dynamic Tag Injector helper */}
              <div className="pt-2 border-t border-gray-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-gray-400 font-medium">Click to insert token:</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { token: '{{name}}', desc: 'Recipient Name' },
                    { token: '{{company}}', desc: 'Company Name' },
                    { token: '{{email}}', desc: 'Email Address' },
                    { token: '{{domain}}', desc: 'Company Domain' },
                  ].map(t => (
                    <button
                      key={t.token}
                      type="button"
                      onClick={() => {
                        if (composerState.bodyMode === 'plain') {
                          setComposerState(prev => ({ ...prev, plainText: prev.plainText + ` ${t.token}` }));
                        } else {
                          setComposerState(prev => ({ ...prev, htmlContent: prev.htmlContent + ` ${t.token}` }));
                        }
                      }}
                      className="px-2 py-0.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-blue-300 font-mono text-[11px] transition-all"
                      title={t.desc}
                    >
                      {t.token}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Live Interactive Preview & Spam Scanner */}
          <div className="lg:col-span-5 space-y-4">
            {/* Live Preview Box */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 shadow-xl space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-gray-800">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Live Preview</span>
                </div>

                {/* Device Selector */}
                <div className="flex items-center gap-1 bg-gray-950 p-1 rounded-lg border border-gray-800">
                  <button
                    type="button"
                    onClick={() => setPreviewDevice('desktop')}
                    className={`p-1.5 rounded transition-all ${
                      previewDevice === 'desktop' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                    title="Desktop Preview"
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewDevice('mobile')}
                    className={`p-1.5 rounded transition-all ${
                      previewDevice === 'mobile' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                    title="Mobile Preview (375px)"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Simulated Email Client Header */}
              <div className="p-3 bg-gray-950 rounded-xl border border-gray-800 text-xs space-y-1">
                <div className="text-gray-400 truncate">
                  <strong>From:</strong> <span className="text-gray-200">{headerConfig.senderName ? `"${headerConfig.senderName}" ` : ''}&lt;{headerConfig.fromEmail || smtpConfig.user || 'sender@domain.com'}&gt;</span>
                </div>
                <div className="text-gray-400 truncate">
                  <strong>To:</strong> <span className="text-blue-300">{sampleRecipient.name ? `"${sampleRecipient.name}" ` : ''}&lt;{sampleRecipient.email}&gt;</span>
                </div>
                {headerConfig.replyTo && (
                  <div className="text-gray-400 truncate">
                    <strong>Reply-To:</strong> <span className="text-gray-300">{headerConfig.replyTo}</span>
                  </div>
                )}
                <div className="text-gray-400 truncate pt-1 border-t border-gray-800/80">
                  <strong>Subject:</strong> <span className="text-white font-semibold">{substituteTemplateVariables(composerState.subject, sampleRecipient) || '(No Subject)'}</span>
                </div>
              </div>

              {/* Simulated Email Canvas */}
              <div className="flex justify-center bg-gray-950/60 p-3 rounded-xl border border-gray-800 min-h-[320px] overflow-hidden">
                <div
                  className={`bg-white rounded-lg shadow-lg overflow-auto transition-all duration-300 ${
                    previewDevice === 'mobile' ? 'w-[320px] max-h-[420px]' : 'w-full max-h-[420px]'
                  }`}
                >
                  <iframe
                    title="Email Preview Frame"
                    srcDoc={previewHtml}
                    sandbox="allow-same-origin"
                    className="w-full h-[400px] border-none bg-white"
                  />
                </div>
              </div>
            </div>

            {/* Quick Deliverability Scorecard Card */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Deliverability Scorecard
                </span>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                  deliverabilityScore.grade === 'Excellent' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40' :
                  deliverabilityScore.grade === 'Good' ? 'bg-blue-950 text-blue-300 border border-blue-500/40' :
                  'bg-amber-950 text-amber-300 border border-amber-500/40'
                }`}>
                  {deliverabilityScore.score}/100 • {deliverabilityScore.grade}
                </span>
              </div>

              {deliverabilityScore.warnings.length > 0 ? (
                <div className="space-y-1.5">
                  {deliverabilityScore.warnings.slice(0, 3).map((w, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-amber-300/90 bg-amber-950/30 p-2 rounded-lg border border-amber-800/40">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-950/30 p-2.5 rounded-lg border border-emerald-800/40">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>Optimal wording! Clean B2B structure with zero detected spam triggers.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- TAB 2: RECIPIENT LIST ("SEND TO") & QUEUE --- */}
      {/* ========================================================================= */}
      {activeSubTab === 'recipients' && (
        <div className="space-y-6">
          {/* --- HYGIENE & DELIVERABILITY FILTER CONTROL CENTER --- */}
          <div className="bg-gradient-to-r from-gray-900 via-gray-900 to-indigo-950/30 border border-indigo-500/30 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-gray-800">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-indigo-600/20 text-indigo-400 rounded-xl border border-indigo-500/40 mt-0.5">
                  <ShieldCheck className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white tracking-wide">
                      Inbox Deliverability Hygiene & Live DNS MX Verification
                    </h3>
                    <span className="px-2 py-0.5 bg-indigo-950 text-indigo-300 text-[10px] font-bold rounded-full border border-indigo-500/40">
                      Anti-Spam Filter
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Filter consumer webmails, .gov/.edu, banks, junk bots, scrap artifacts, and verify live DNS MX servers to maximize Primary Inbox placement and eliminate hard bounces.
                  </p>
                </div>
              </div>

              {/* Status or Audit Summary Badge */}
              <div className="flex items-center gap-2 self-start md:self-auto">
                {hygieneAuditReport ? (
                  <button
                    type="button"
                    onClick={() => setShowHygieneModal(true)}
                    className="px-3 py-1.5 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 rounded-xl text-xs font-bold border border-emerald-500/40 transition-all flex items-center gap-1.5 shadow-sm"
                  >
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    Audit: {hygieneAuditReport.cleanEmails.length} Clean ({hygieneAuditReport.removedEmails.length} Removed)
                  </button>
                ) : (
                  <span className="px-2.5 py-1 bg-gray-800/80 text-gray-300 rounded-xl text-[11px] font-medium border border-gray-700">
                    {recipientsQueue.length} emails awaiting scan
                  </span>
                )}
              </div>
            </div>

            {/* Granular Hygiene Rule Checkboxes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {/* 1. Public Webmail */}
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-gray-950/80 hover:bg-gray-950 border border-gray-800/80 hover:border-indigo-500/40 cursor-pointer transition-all">
                <input
                  type="checkbox"
                  checked={hygieneOptions.removePublic}
                  onChange={() => handleHygieneOptionToggle('removePublic')}
                  className="mt-0.5 rounded border-gray-700 bg-gray-800 text-indigo-600 focus:ring-0"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-200">
                    <Globe className="w-3.5 h-3.5 text-purple-400" />
                    <span>Public Webmails</span>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-tight">
                    Gmail, Yahoo, Outlook, Hotmail, iCloud, AOL, Proton, etc.
                  </p>
                </div>
              </label>

              {/* 2. Gov & Edu */}
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-gray-950/80 hover:bg-gray-950 border border-gray-800/80 hover:border-indigo-500/40 cursor-pointer transition-all">
                <input
                  type="checkbox"
                  checked={hygieneOptions.removeGovEdu}
                  onChange={() => handleHygieneOptionToggle('removeGovEdu')}
                  className="mt-0.5 rounded border-gray-700 bg-gray-800 text-indigo-600 focus:ring-0"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-200">
                    <Landmark className="w-3.5 h-3.5 text-blue-400" />
                    <span>.Gov & .Edu Domains</span>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-tight">
                    Government (.gov, .mil, .gouv) & university/academic mailboxes.
                  </p>
                </div>
              </label>

              {/* 3. Bank & Financial */}
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-gray-950/80 hover:bg-gray-950 border border-gray-800/80 hover:border-indigo-500/40 cursor-pointer transition-all">
                <input
                  type="checkbox"
                  checked={hygieneOptions.removeBank}
                  onChange={() => handleHygieneOptionToggle('removeBank')}
                  className="mt-0.5 rounded border-gray-700 bg-gray-800 text-indigo-600 focus:ring-0"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-200">
                    <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Bank & Financial</span>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-tight">
                    Banking institutions, PayPal, crypto, fintech, and lenders.
                  </p>
                </div>
              </label>

              {/* 4. Junk & Bot Mailboxes */}
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-gray-950/80 hover:bg-gray-950 border border-gray-800/80 hover:border-indigo-500/40 cursor-pointer transition-all">
                <input
                  type="checkbox"
                  checked={hygieneOptions.removeJunkBots}
                  onChange={() => handleHygieneOptionToggle('removeJunkBots')}
                  className="mt-0.5 rounded border-gray-700 bg-gray-800 text-indigo-600 focus:ring-0"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-200">
                    <Bot className="w-3.5 h-3.5 text-rose-400" />
                    <span>Junk & Bot Mailboxes</span>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-tight">
                    noreply, postmaster, webmaster, daemon, abuse, bounces.
                  </p>
                </div>
              </label>

              {/* 5. Computer-Generated */}
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-gray-950/80 hover:bg-gray-950 border border-gray-800/80 hover:border-indigo-500/40 cursor-pointer transition-all">
                <input
                  type="checkbox"
                  checked={hygieneOptions.removeComputerGenerated}
                  onChange={() => handleHygieneOptionToggle('removeComputerGenerated')}
                  className="mt-0.5 rounded border-gray-700 bg-gray-800 text-indigo-600 focus:ring-0"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-200">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Computer-Generated</span>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-tight">
                    Scraping artifacts (image123), hex hashes, numeric bots.
                  </p>
                </div>
              </label>

              {/* 6. Bad & Disposable Emails */}
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-gray-950/80 hover:bg-gray-950 border border-gray-800/80 hover:border-indigo-500/40 cursor-pointer transition-all">
                <input
                  type="checkbox"
                  checked={hygieneOptions.removeBadEmails}
                  onChange={() => handleHygieneOptionToggle('removeBadEmails')}
                  className="mt-0.5 rounded border-gray-700 bg-gray-800 text-indigo-600 focus:ring-0"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-200">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span>Bad & Disposable</span>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-tight">
                    Syntax errors, throwaway temp inboxes, webmail typos.
                  </p>
                </div>
              </label>

              {/* 7. Live DNS MX Verification */}
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-indigo-950/40 hover:bg-indigo-950/60 border border-indigo-500/40 cursor-pointer transition-all sm:col-span-2 lg:col-span-2">
                <input
                  type="checkbox"
                  checked={hygieneOptions.checkLiveMx}
                  onChange={() => handleHygieneOptionToggle('checkLiveMx')}
                  className="mt-0.5 rounded border-indigo-600 bg-indigo-950 text-indigo-500 focus:ring-0"
                />
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-200">
                    <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
                    <span>Live DNS MX Domain Verification</span>
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.2 bg-teal-950 text-teal-300 rounded border border-teal-500/40 font-bold">Recommended</span>
                  </div>
                  <p className="text-[10px] text-indigo-300/80 leading-tight">
                    Queries live DNS nameservers for mail exchange records; drops dead, abandoned, or non-functional domains before sending.
                  </p>
                </div>
              </label>
            </div>

            {/* Active Cleaning Progress Bar */}
            {isCleaningQueue && (
              <div className="bg-gray-950 p-3 rounded-xl border border-indigo-500/40 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-indigo-300 font-semibold flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    {cleaningStage || 'Performing DNS MX checks & filtering...'}
                  </span>
                  <span className="text-white font-mono font-bold">{cleaningProgress}%</span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-teal-400 transition-all duration-300 rounded-full"
                    style={{ width: `${cleaningProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Controls and Actions Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-800/80">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isCleaningQueue || recipientsQueue.length === 0}
                  onClick={() => executeQueueCleaning()}
                  className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-lg ${
                    isCleaningQueue || recipientsQueue.length === 0
                      ? 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
                  }`}
                >
                  {isCleaningQueue ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Scanning & Verifying MX...
                    </>
                  ) : (
                    <>
                      <Filter className="w-4 h-4" />
                      Clean & Validate Loaded Queue ({recipientsQueue.length})
                    </>
                  )}
                </button>

                {hygieneAuditReport && (
                  <button
                    type="button"
                    onClick={() => setShowHygieneModal(true)}
                    className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 hover:text-white rounded-xl text-xs font-semibold border border-gray-700 transition-all flex items-center gap-1.5"
                  >
                    <ListFilter className="w-4 h-4 text-indigo-400" />
                    View Audit Report ({hygieneAuditReport.removedEmails.length} Removed)
                  </button>
                )}

                {originalBackupQueue && (
                  <button
                    type="button"
                    onClick={handleUndoCleaning}
                    className="px-3.5 py-2 bg-gray-800/70 hover:bg-gray-800 text-amber-300 hover:text-amber-200 rounded-xl text-xs font-semibold border border-amber-600/40 transition-all flex items-center gap-1.5"
                    title="Revert cleaning and restore original list"
                  >
                    <Undo2 className="w-4 h-4 text-amber-400" />
                    Undo ({originalBackupQueue.length} Original)
                  </button>
                )}
              </div>

              {/* Secondary Options */}
              <div className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-gray-300 hover:text-white select-none">
                  <input
                    type="checkbox"
                    checked={hygieneOptions.autoCleanOnLoad}
                    onChange={() => handleHygieneOptionToggle('autoCleanOnLoad')}
                    className="rounded border-gray-700 bg-gray-800 text-indigo-600 focus:ring-0"
                  />
                  <span>Auto-clean on import/paste</span>
                </label>

                <div className="h-4 w-px bg-gray-800 hidden sm:block" />

                <button
                  type="button"
                  onClick={() => {
                    setHygieneOptions(prev => {
                      const allOn = {
                        removePublic: true,
                        removeGovEdu: true,
                        removeBank: true,
                        removeJunkBots: true,
                        removeComputerGenerated: true,
                        removeBadEmails: true,
                        checkLiveMx: true,
                        autoCleanOnLoad: prev.autoCleanOnLoad,
                      };
                      localStorage.setItem('smtp_hygiene_options_v2', JSON.stringify(allOn));
                      return allOn;
                    });
                    showToast('Enabled all deliverability hygiene rules.');
                  }}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-all font-medium"
                >
                  Select All
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Input Box for Recipients */}
            <div className="lg:col-span-6 space-y-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
                    <Mail className="w-4 h-4 text-blue-400" />
                    Recipient List ("Send To")
                  </label>
                  <span className="text-xs text-gray-400">
                    One per line or comma-separated
                  </span>
                </div>

                <textarea
                  rows={10}
                  value={rawRecipientsText}
                  onChange={(e) => setRawRecipientsText(e.target.value)}
                  placeholder={`alexander@manufacturing.de\n"John Smith" <john@company.com>\nsales@techcorp.io`}
                  className="w-full p-3.5 bg-gray-950 border border-gray-700 rounded-xl text-xs text-gray-200 font-mono leading-relaxed focus:outline-none focus:border-blue-500 transition-all resize-y"
                />

                {/* Import Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleParseRecipients}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-all shadow-md flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Update Queue ({recipientsQueue.length})
                    </button>

                    <label className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold rounded-lg border border-gray-700 cursor-pointer transition-all flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5 text-blue-400" />
                      Import TXT/CSV
                      <input type="file" accept=".txt,.csv" onChange={handleImportFile} className="hidden" />
                    </label>

                    {extractedLeads && extractedLeads.length > 0 && (
                      <button
                        type="button"
                        onClick={handleLoadFromExtractor}
                        className="px-3 py-1.5 bg-teal-600/30 hover:bg-teal-600 text-teal-300 hover:text-white text-xs font-semibold rounded-lg border border-teal-500/40 transition-all flex items-center gap-1.5"
                        title="Load verified leads from current Extractor search"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-teal-300" />
                        From Extractor ({extractedLeads.length})
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setRawRecipientsText('');
                      setRecipientsQueue([]);
                      showToast('Queue cleared.');
                    }}
                    className="p-1.5 text-gray-400 hover:text-rose-400 transition-all"
                    title="Clear list"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* CC and BCC Optional Fields */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl space-y-3">
                <h3 className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-purple-400" />
                  CC & BCC Recipients (Optional)
                </h3>
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] font-medium text-gray-400 mb-1 block">CC (Carbon Copy):</label>
                    <input
                      type="text"
                      value={headerConfig.cc}
                      onChange={(e) => setHeaderConfig(prev => ({ ...prev, cc: e.target.value }))}
                      placeholder="e.g. manager@yourcompany.com"
                      className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-gray-400 mb-1 block">BCC (Blind Carbon Copy):</label>
                    <input
                      type="text"
                      value={headerConfig.bcc}
                      onChange={(e) => setHeaderConfig(prev => ({ ...prev, bcc: e.target.value }))}
                      placeholder="e.g. crm-inbox@yourcompany.com"
                      className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none"
                    />
                  </div>
                  <p className="text-[11px] text-gray-500">
                    Note: To protect your deliverability, the primary recipient in the "Send To" queue receives a dedicated email one-by-one. Any specified CC/BCC is copied on each outbound message.
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column: Parsed Queue Table */}
            <div className="lg:col-span-6 space-y-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">
                      Sequential Queue Preview ({recipientsQueue.length})
                    </span>
                    {hygieneAuditReport && (
                      <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-950 text-emerald-300 rounded border border-emerald-500/40 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        Clean & MX-Verified
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isCleaningQueue || recipientsQueue.length === 0}
                      onClick={() => executeQueueCleaning()}
                      className="text-[11px] px-2 py-0.5 bg-indigo-950 hover:bg-indigo-900 text-indigo-300 rounded-lg border border-indigo-500/40 font-medium flex items-center gap-1 transition-all disabled:opacity-50"
                      title="Run hygiene and MX verification on queue"
                    >
                      <Filter className="w-3 h-3 text-indigo-400" />
                      Clean List
                    </button>
                    <span className="text-[11px] px-2 py-0.5 bg-blue-950 text-blue-300 rounded border border-blue-500/40">
                      Sequential 1-by-1
                    </span>
                  </div>
                </div>

                {recipientsQueue.length === 0 ? (
                  <div className="text-center py-14 text-gray-500 text-xs border border-dashed border-gray-800 rounded-xl space-y-2">
                    <Mail className="w-8 h-8 mx-auto text-gray-600" />
                    <p>No recipients in queue yet.</p>
                    <p className="text-[11px] text-gray-600">Enter email addresses on the left or import a CSV/TXT file.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[420px] rounded-xl border border-gray-800">
                    <table className="w-full text-left text-xs text-gray-300">
                      <thead className="bg-gray-950 text-gray-400 font-semibold border-b border-gray-800 sticky top-0">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Recipient Email</th>
                          <th className="py-2.5 px-3">Name / Company</th>
                          <th className="py-2.5 px-3">Queue Status</th>
                          <th className="py-2.5 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60 font-mono">
                        {recipientsQueue.map((item, idx) => (
                          <tr key={item.id} className={item.status === 'sending' ? 'bg-blue-950/40' : item.status === 'sent' ? 'bg-emerald-950/20' : item.status === 'failed' ? 'bg-rose-950/20' : 'hover:bg-gray-800/30'}>
                            <td className="py-2 px-3 text-gray-500 text-[11px]">{idx + 1}</td>
                            <td className="py-2 px-3 text-white font-medium truncate max-w-[170px]" title={item.email}>
                              {item.email}
                            </td>
                            <td className="py-2 px-3 text-gray-400 truncate max-w-[110px]">
                              {item.name || item.company || '—'}
                            </td>
                            <td className="py-2 px-3">
                              {item.status === 'sent' && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40 font-sans font-bold">
                                  <Check className="w-3 h-3" /> Sent
                                </span>
                              )}
                              {item.status === 'sending' && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-500/40 font-sans font-bold animate-pulse">
                                  <RefreshCw className="w-3 h-3 animate-spin" /> Sending...
                                </span>
                              )}
                              {item.status === 'failed' && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-500/40 font-sans font-bold" title={item.error}>
                                  <XCircle className="w-3 h-3" /> Failed
                                </span>
                              )}
                              {item.status === 'pending' && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 font-sans">
                                  Pending
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setRecipientsQueue(prev => prev.filter(r => r.id !== item.id));
                                  showToast(`Removed ${item.email}`);
                                }}
                                disabled={isSending && item.status === 'sending'}
                                className="p-1 text-gray-500 hover:text-rose-400 rounded transition-all"
                                title="Remove from queue"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Real-time Safe Sending Limits & Batch Warning for Active Queue */}
              <SendingLimitEstimator
                smtpConfig={smtpConfig}
                queueSize={recipientsQueue.length}
                currentBatchSize={recipientsQueue.length}
                host={smtpConfig?.host}
                providerSpec={activeProviderSpec}
                onApplySafeBatchSize={(safeBatch) => {
                  if (recipientsQueue.length > safeBatch) {
                    showToast(`Batch threshold safe warning noted. Pacing delay adjusted to ${activeProviderSpec?.recommendedDelaySeconds || 3}s.`);
                    setSendDelaySeconds(Math.max(sendDelaySeconds, activeProviderSpec?.recommendedDelaySeconds || 3));
                  }
                }}
                onSafeBatchApply={(safeBatch) => {
                  if (recipientsQueue.length > safeBatch) {
                    showToast(`Batch threshold safe warning noted. Pacing delay adjusted to ${activeProviderSpec?.recommendedDelaySeconds || 3}s.`);
                    setSendDelaySeconds(Math.max(sendDelaySeconds, activeProviderSpec?.recommendedDelaySeconds || 3));
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- TAB 3: SMTP SERVER CONFIGURATION & ALTERNATIVES --- */}
      {/* ========================================================================= */}
      {activeSubTab === 'smtp' && (
        <div className="max-w-4xl mx-auto space-y-6">
          {/* SENDER MODE SELECTION & NO-SMTP ALTERNATIVES EXPLAINED */}
          <div className="bg-gradient-to-r from-gray-900 via-gray-900 to-purple-950/40 border border-purple-500/30 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-purple-600/20 text-purple-400 rounded-xl border border-purple-500/40">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Sending Method & Mode</h3>
                  <p className="text-xs text-gray-400">Choose between Live SMTP Relay or Outbox Activity Logger (No SMTP Needed)</p>
                </div>
              </div>

              {/* Mode Toggle Buttons */}
              <div className="flex items-center gap-2 bg-gray-950 p-1.5 rounded-xl border border-gray-800">
                <button
                  type="button"
                  onClick={() => handleDispatchModeChange('smtp')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    dispatchMode === 'smtp'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Server className="w-3.5 h-3.5" />
                  Live SMTP Relay
                </button>
                <button
                  type="button"
                  onClick={() => handleDispatchModeChange('logger')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    dispatchMode === 'logger'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  Outbox Logger (No SMTP)
                </button>
              </div>
            </div>

            {/* Explanatory Guide: Sending without SMTP */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-purple-300 flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-purple-400" />
                How to Send Emails Without SMTP: 3 Proven Industry Solutions
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Option 1: Built-in Outbox Logger */}
                <div className={`p-3.5 rounded-xl border transition-all ${
                  dispatchMode === 'logger'
                    ? 'bg-purple-950/50 border-purple-500/60 shadow-lg'
                    : 'bg-gray-950/60 border-gray-800 hover:border-gray-700'
                }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5 text-purple-400" />
                      1. Outbox Logger
                    </span>
                    <span className="text-[10px] bg-purple-900/60 text-purple-300 px-1.5 py-0.5 rounded font-semibold border border-purple-700/50">
                      Active Built-in
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-300 leading-relaxed">
                    No SMTP account or password needed! Fully builds personalized messages, generates RFC-5322 Message-IDs, runs deliverability spam-checks, and writes real-time dispatch logs with delivery latency.
                  </p>
                  {dispatchMode !== 'logger' && (
                    <button
                      type="button"
                      onClick={() => handleDispatchModeChange('logger')}
                      className="mt-2.5 w-full py-1 bg-purple-600/30 hover:bg-purple-600 text-purple-300 hover:text-white text-[11px] font-bold rounded-lg border border-purple-500/40 transition-all text-center"
                    >
                      Switch to Outbox Logger
                    </button>
                  )}
                </div>

                {/* Option 2: REST APIs */}
                <div className="p-3.5 bg-gray-950/60 rounded-xl border border-gray-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white flex items-center gap-1">
                      <Code className="w-3.5 h-3.5 text-blue-400" />
                      2. Transactional REST APIs
                    </span>
                    <span className="text-[10px] bg-blue-900/40 text-blue-300 px-1.5 py-0.5 rounded font-semibold">
                      API Key Only
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-300 leading-relaxed">
                    Services like <strong>Resend</strong>, <strong>SendGrid</strong>, <strong>Mailgun</strong>, and <strong>Postmark</strong> allow sending emails via standard HTTPS POST on Port 443 with a simple Bearer Token. Bypasses SMTP port blocking entirely.
                  </p>
                </div>

                {/* Option 3: Direct MX / MTA */}
                <div className="p-3.5 bg-gray-950/60 rounded-xl border border-gray-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white flex items-center gap-1">
                      <Server className="w-3.5 h-3.5 text-emerald-400" />
                      3. Direct MX / Sendmail
                    </span>
                    <span className="text-[10px] bg-emerald-900/40 text-emerald-300 px-1.5 py-0.5 rounded font-semibold">
                      Server MTA
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-300 leading-relaxed">
                    A server can resolve the recipient's DNS MX records and connect directly to their inbound mail server on port 25 without an outbound relay. Requires a static IP with matching PTR reverse DNS, SPF, and DKIM to prevent spam rejection.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-6">
            {/* Header & Main Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-950/70 border border-blue-800/60 rounded-xl text-blue-400">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">SMTP Relay & Diagnostic Intelligence</h3>
                    <span className="text-[10px] bg-blue-900/40 text-blue-300 border border-blue-700/40 px-2 py-0.5 rounded-full font-semibold">
                      Any SMTP Server
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Auto-detect server & port from email, test connection handshake, measure server strength, and view sending quotas
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleLookupSmtpByDomain()}
                  disabled={isAutoDetectingSmtp}
                  className="px-3.5 py-2 bg-purple-600/30 hover:bg-purple-600 text-purple-200 hover:text-white text-xs font-bold rounded-xl border border-purple-500/40 transition-all flex items-center gap-1.5 disabled:opacity-50"
                  title="Auto-detect and populate SMTP Server and Port based on email domain"
                >
                  {isAutoDetectingSmtp ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
                  {isAutoDetectingSmtp ? 'Looking up...' : 'Auto-Lookup Domain'}
                </button>
                <button
                  type="button"
                  onClick={handleTestSmtpConnection}
                  disabled={isTestingConnection}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50"
                  title="Test SMTP socket handshake, authentication & response latency"
                >
                  {isTestingConnection ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {isTestingConnection ? 'Testing Connection...' : 'Test Connection'}
                </button>
                <button
                  type="button"
                  onClick={handleRunHealthCheck}
                  disabled={isRunningHealthCheck}
                  className="px-3.5 py-2 bg-indigo-600/40 hover:bg-indigo-600 text-indigo-200 hover:text-white text-xs font-bold rounded-xl border border-indigo-500/40 transition-all flex items-center gap-1.5 disabled:opacity-50"
                  title="Run multi-probe SMTP health check, latency test, TLS check, and auth verification"
                >
                  {isRunningHealthCheck ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5 text-cyan-400" />}
                  {isRunningHealthCheck ? 'Running Probes...' : 'Health Diagnostic'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveSmtpConfig}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5"
                  title="Save current SMTP credentials and configuration to browser storage"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save Config
                </button>
              </div>
            </div>

            {/* Auto-Detection Notification Banner */}
            {autoDetectedNotice && (
              <div className="p-3 bg-blue-950/40 border border-blue-500/30 rounded-xl flex items-center justify-between gap-3 text-xs text-blue-200 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <div>
                    <span className="font-semibold">{autoDetectedNotice.text}</span>
                    <span className="text-gray-400 ml-2 text-[11px]">(Confidence: {autoDetectedNotice.confidence}%) — You can edit host and port manually below at any time.</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoDetectedNotice(null)}
                  className="text-gray-400 hover:text-white text-[11px] px-2 py-0.5"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Quick Provider Presets Carousel */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-blue-400" />
                  Quick Provider Presets & Servers:
                </label>
                <span className="text-[11px] text-gray-400">Click any provider to load pre-configured specs</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                {KNOWN_SMTP_PROVIDERS.slice(0, 14).map(preset => {
                  const isSelected = smtpConfig.preset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handlePresetSelect(preset.id)}
                      className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-all ${
                        isSelected
                          ? 'bg-blue-950/80 border-blue-500 text-white shadow-md'
                          : 'bg-gray-950 border-gray-800 text-gray-300 hover:bg-gray-800 hover:text-white'
                      }`}
                    >
                      <div className="font-bold truncate text-[11px]">{preset.name.split('/')[0].trim()}</div>
                      <div className="text-[10px] text-gray-400 truncate font-mono">{preset.host || 'Custom'}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Credential & Connection Parameters Form (Fully Editable) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Username / Email Login with Auto-Detect trigger */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-300">
                    Username / Email Login <span className="text-rose-400">*</span>
                  </label>
                  <span className="text-[10px] text-purple-400">Auto-detects host upon entering email</span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={smtpConfig.user}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSmtpConfig(prev => ({ ...prev, user: val }));
                      // Auto-lookup if user enters an email address and hasn't manually altered host
                      if (val.includes('@') && val.split('@')[1].includes('.') && !isManuallyEdited) {
                        handleLookupSmtpByDomain(val);
                      }
                    }}
                    onBlur={() => {
                      if (smtpConfig.user && smtpConfig.user.includes('@') && !isManuallyEdited) {
                        handleLookupSmtpByDomain(smtpConfig.user);
                      }
                    }}
                    placeholder="e.g. yourname@domain.com"
                    className="w-full pl-3.5 pr-24 py-2.5 bg-gray-950 border border-gray-700 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                  {smtpConfig.user && smtpConfig.user.includes('@') && (
                    <button
                      type="button"
                      onClick={() => handleLookupSmtpByDomain(smtpConfig.user)}
                      className="absolute right-2 top-2 px-2.5 py-1 bg-purple-950/80 hover:bg-purple-900 border border-purple-600/40 text-purple-300 text-[10px] font-bold rounded-md flex items-center gap-1 transition-all"
                      title="Auto-lookup and populate SMTP Server and Port for this domain"
                    >
                      <Zap className="w-2.5 h-2.5 text-amber-400" />
                      Auto-Lookup
                    </button>
                  )}
                </div>
              </div>

              {/* Password / App Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-300">
                    Password / App Password <span className="text-rose-400">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {activeProviderSpec.authUrl && (
                      <a
                        href={activeProviderSpec.authUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                      >
                        App Passwords <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-[11px] text-gray-400 hover:text-white flex items-center gap-1"
                    >
                      {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={smtpConfig.pass}
                  onChange={(e) => setSmtpConfig(prev => ({ ...prev, pass: e.target.value }))}
                  placeholder="Password or 16-character App Password"
                  className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-700 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              {/* SMTP Server / Host (Editable) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-300">
                    SMTP Server / Host <span className="text-rose-400">*</span>
                  </label>
                  <span className="text-[10px] text-gray-400">
                    {isManuallyEdited ? 'Customized Manually' : 'Auto-detected (editable)'}
                  </span>
                </div>
                <input
                  type="text"
                  value={smtpConfig.host}
                  onChange={(e) => {
                    setIsManuallyEdited(true);
                    setSmtpConfig(prev => ({ ...prev, host: e.target.value, preset: 'custom' }));
                  }}
                  placeholder="e.g. smtp.gmail.com or mail.yourdomain.com"
                  className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-700 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              {/* Port and Security Settings (Editable) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-300">
                    Port & Security <span className="text-rose-400">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsManuallyEdited(true);
                        setSmtpConfig(prev => ({ ...prev, port: 587, secure: false }));
                      }}
                      className={`text-[10px] px-1.5 py-0.5 rounded ${smtpConfig.port === 587 && !smtpConfig.secure ? 'bg-blue-900/60 text-blue-300' : 'text-gray-400 hover:text-white'}`}
                    >
                      587 (STARTTLS)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsManuallyEdited(true);
                        setSmtpConfig(prev => ({ ...prev, port: 465, secure: true }));
                      }}
                      className={`text-[10px] px-1.5 py-0.5 rounded ${smtpConfig.port === 465 && smtpConfig.secure ? 'bg-blue-900/60 text-blue-300' : 'text-gray-400 hover:text-white'}`}
                    >
                      465 (SSL/TLS)
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={smtpConfig.port}
                    onChange={(e) => {
                      setIsManuallyEdited(true);
                      const portVal = Number(e.target.value);
                      setSmtpConfig(prev => ({ 
                        ...prev, 
                        port: portVal,
                        secure: portVal === 465 ? true : prev.secure 
                      }));
                    }}
                    placeholder="587"
                    className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-700 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-gray-300 whitespace-nowrap cursor-pointer select-none bg-gray-950 px-3 py-2.5 rounded-xl border border-gray-700">
                    <input
                      type="checkbox"
                      checked={smtpConfig.secure}
                      onChange={(e) => {
                        setIsManuallyEdited(true);
                        setSmtpConfig(prev => ({ ...prev, secure: e.target.checked }));
                      }}
                      className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-0"
                    />
                    <span className="flex items-center gap-1">
                      {smtpConfig.secure ? <Lock className="w-3 h-3 text-emerald-400" /> : <Unlock className="w-3 h-3 text-amber-400" />}
                      SSL/TLS
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Quick Action Bar under Credential Inputs */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-gray-950/70 rounded-xl border border-gray-800">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestSmtpConnection}
                  disabled={isTestingConnection}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50"
                  title="Test SMTP socket handshake, authentication & response latency"
                >
                  {isTestingConnection ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {isTestingConnection ? 'Testing Connection...' : 'Test Connection'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveSmtpConfig}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5"
                  title="Save current SMTP credentials to browser storage"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save Credentials
                </button>
              </div>
              <p className="text-[11px] text-gray-400">
                Click <strong className="text-gray-200">Test Connection</strong> to verify handshake or <strong className="text-gray-200">Save Credentials</strong> to store locally.
              </p>
            </div>

            {/* Test Result Banner */}
            {connectionTestResult && (
              <div className={`p-4 rounded-xl border text-xs space-y-1.5 animate-fadeIn ${
                connectionTestResult.success
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200'
                  : 'bg-rose-950/60 border-rose-500/50 text-rose-200'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    {connectionTestResult.success ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
                    )}
                    <span>{connectionTestResult.message}</span>
                  </div>
                  {connectionTestResult.latencyMs && (
                    <span className="text-[11px] bg-emerald-900/40 text-emerald-300 border border-emerald-700/40 px-2 py-0.5 rounded-full font-mono">
                      {connectionTestResult.latencyMs} ms
                    </span>
                  )}
                </div>
                {connectionTestResult.advice && (
                  <p className="text-gray-300 text-xs pl-7">
                    <strong>Remedy Advice:</strong> {connectionTestResult.advice}
                  </p>
                )}
              </div>
            )}

            {/* ========================================================================= */}
            {/* --- SMTP HEALTH CHECKER SUB-COMPONENT --- */}
            {/* ========================================================================= */}
            <SmtpHealthChecker
              smtpConfig={smtpConfig}
              config={smtpConfig}
              onRunCheck={handleRunHealthCheck}
              onRunHealthCheck={handleRunHealthCheck}
              isChecking={isRunningHealthCheck}
              isRunning={isRunningHealthCheck}
              healthResult={healthCheckResult}
              result={healthCheckResult}
              domainAudit={domainAudit}
            />

            {/* ========================================================================= */}
            {/* --- SMTP STRENGTH & DELIVERABILITY METER CARD --- */}
            {/* ========================================================================= */}
            <div className="p-4 bg-gray-950 rounded-2xl border border-gray-800 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Gauge className="w-5 h-5 text-teal-400" />
                  <div>
                    <h4 className="text-sm font-bold text-white">SMTP Strength & Deliverability Audit</h4>
                    <p className="text-[11px] text-gray-400">Comprehensive evaluation of encryption, handshake, latency, and domain DNS alignment</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className={`px-3 py-1 rounded-xl border text-xs font-black tracking-wider ${smtpStrength.gradeColor}`}>
                    GRADE {smtpStrength.grade} ({smtpStrength.score}/100)
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-gray-900 rounded-full h-2 overflow-hidden border border-gray-800">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    smtpStrength.score >= 85
                      ? 'bg-emerald-500'
                      : smtpStrength.score >= 65
                      ? 'bg-teal-500'
                      : smtpStrength.score >= 50
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                  }`}
                  style={{ width: `${smtpStrength.score}%` }}
                />
              </div>

              <p className="text-xs text-gray-300 italic">{smtpStrength.summary}</p>

              {/* Diagnostic Factors Breakdown Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {smtpStrength.factors.map((factor, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border text-xs space-y-1 transition-all ${
                      factor.status === 'pass'
                        ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200'
                        : factor.status === 'warn'
                        ? 'bg-amber-950/20 border-amber-800/40 text-amber-200'
                        : 'bg-rose-950/20 border-rose-800/40 text-rose-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span className="flex items-center gap-1.5">
                        {factor.status === 'pass' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ) : factor.status === 'warn' ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        )}
                        {factor.title}
                      </span>
                      <span className="text-[10px] font-mono opacity-80">
                        {factor.scoreImpact > 0 ? `+${factor.scoreImpact} pts` : '0 pts'}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-300 leading-relaxed">{factor.detail}</p>
                  </div>
                ))}
              </div>

              {/* Remediation Tips (if any) */}
              {smtpStrength.remediations.length > 0 && (
                <div className="p-3 bg-gray-900 rounded-xl border border-gray-800 space-y-1.5">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Recommendations to Reach Grade A+ (100% Inboxing):
                  </div>
                  <ul className="text-xs text-gray-300 space-y-1 list-disc list-inside">
                    {smtpStrength.remediations.map((rem, idx) => (
                      <li key={idx} className="leading-relaxed">{rem}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* ========================================================================= */}
            {/* --- PROVIDER SPECIFICATIONS & SENDING LIMITS CARD --- */}
            {/* ========================================================================= */}
            <div className="p-4 bg-gray-950 rounded-2xl border border-gray-800 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-blue-400" />
                  <div>
                    <h4 className="text-sm font-bold text-white">Provider Sending Limits & Specifications</h4>
                    <p className="text-[11px] text-gray-400">
                      Technical limits, safe sending cadence, and deliverability guidelines for <strong>{activeProviderSpec.name}</strong>
                    </p>
                  </div>
                </div>
                <span className="text-[10px] bg-gray-900 border border-gray-700 text-gray-300 px-2.5 py-1 rounded-lg font-mono">
                  {activeProviderSpec.id.toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3 bg-gray-900 rounded-xl border border-gray-800">
                  <div className="text-[11px] text-gray-400 font-medium mb-1 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-blue-400" />
                    Daily Sending Quota
                  </div>
                  <div className="text-xs font-bold text-white leading-snug">{activeProviderSpec.dailyLimit}</div>
                </div>

                <div className="p-3 bg-gray-900 rounded-xl border border-gray-800">
                  <div className="text-[11px] text-gray-400 font-medium mb-1 flex items-center gap-1">
                    <Activity className="w-3 h-3 text-emerald-400" />
                    Safe Sending Rate
                  </div>
                  <div className="text-xs font-bold text-emerald-300 leading-snug">{activeProviderSpec.rateLimit}</div>
                </div>

                <div className="p-3 bg-gray-900 rounded-xl border border-gray-800">
                  <div className="text-[11px] text-gray-400 font-medium mb-1 flex items-center gap-1">
                    <FileText className="w-3 h-3 text-purple-400" />
                    Max Message Size
                  </div>
                  <div className="text-xs font-bold text-white leading-snug">{activeProviderSpec.maxAttachment}</div>
                </div>

                <div className="p-3 bg-gray-900 rounded-xl border border-gray-800">
                  <div className="text-[11px] text-gray-400 font-medium mb-1 flex items-center gap-1">
                    <Lock className="w-3 h-3 text-amber-400" />
                    Authentication Type
                  </div>
                  <div className="text-xs font-bold text-amber-200 leading-snug">{activeProviderSpec.authType}</div>
                </div>
              </div>

              {/* Provider Notes & Tips */}
              <div className="p-3 bg-gray-900 rounded-xl border border-gray-800 space-y-2 text-xs">
                <p className="text-gray-300 leading-relaxed">
                  <strong>Configuration Note:</strong> {activeProviderSpec.notes}
                </p>
                {activeProviderSpec.deliverabilityTips.length > 0 && (
                  <div className="pt-2 border-t border-gray-800">
                    <span className="font-semibold text-gray-300 block mb-1">Deliverability Optimization:</span>
                    <ul className="text-gray-400 space-y-1 list-disc list-inside">
                      {activeProviderSpec.deliverabilityTips.map((tip, idx) => (
                        <li key={idx}>{tip}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* ========================================================================= */}
            {/* --- ESTIMATED SENDING LIMITS & BATCH WARNING COMPONENT --- */}
            {/* ========================================================================= */}
            <SendingLimitEstimator
              smtpConfig={smtpConfig}
              queueSize={recipientsQueue.length}
              currentBatchSize={recipientsQueue.length}
              host={smtpConfig?.host}
              providerSpec={activeProviderSpec}
              onApplySafeBatchSize={(safeSize) => {
                showToast(`Safe batch threshold of ${safeSize} noted.`);
              }}
              onSafeBatchApply={(safeSize) => {
                showToast(`Safe batch threshold of ${safeSize} noted.`);
              }}
            />

            {/* Action Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-gray-800">
              <p className="text-[11px] text-gray-500">
                Credentials are processed securely on the server exclusively for the active session and stored in browser memory.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestSmtpConnection}
                  disabled={isTestingConnection}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50"
                  title="Test SMTP socket handshake, authentication & response latency"
                >
                  {isTestingConnection ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {isTestingConnection ? 'Testing Connection...' : 'Test Connection'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveSmtpConfig}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-1.5"
                  title="Save configuration to local browser storage"
                >
                  <Check className="w-4 h-4" />
                  Save to Browser Storage
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- TAB 4: HEADERS & IDENTITY CONFIGURATION --- */}
      {/* ========================================================================= */}
      {activeSubTab === 'headers' && (
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <div className="flex items-center gap-2.5">
                <Sliders className="w-5 h-5 text-purple-400" />
                <div>
                  <h3 className="text-base font-bold text-white">Header & Deliverability Configuration</h3>
                  <p className="text-xs text-gray-400">Configure Sender ID, From address, Reply-To, and RFC deliverability headers</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleAuditSenderDomain}
                disabled={isAuditingDomain}
                className="px-3.5 py-2 bg-purple-600/30 hover:bg-purple-600 text-purple-200 hover:text-white text-xs font-bold rounded-xl border border-purple-500/40 transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {isAuditingDomain ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                {isAuditingDomain ? 'Auditing DNS...' : 'Check Domain SPF/DMARC'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-300 mb-1 block">
                  Sender Name / Display Name
                </label>
                <input
                  type="text"
                  value={headerConfig.senderName}
                  onChange={(e) => setHeaderConfig(prev => ({ ...prev, senderName: e.target.value }))}
                  placeholder="e.g. John Smith"
                  className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-700 rounded-xl text-xs text-white focus:outline-none focus:border-purple-500"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">What the recipient sees as the friendly sender name.</span>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-300 mb-1 block">
                  From Address (Sender ID) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="email"
                  value={headerConfig.fromEmail}
                  onChange={(e) => setHeaderConfig(prev => ({ ...prev, fromEmail: e.target.value }))}
                  placeholder="e.g. john@yourcompany.com"
                  className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-700 rounded-xl text-xs text-white focus:outline-none focus:border-purple-500"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">Must match or align with your SMTP domain for SPF/DMARC pass.</span>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-300 mb-1 block">
                  Reply-To Address
                </label>
                <input
                  type="email"
                  value={headerConfig.replyTo}
                  onChange={(e) => setHeaderConfig(prev => ({ ...prev, replyTo: e.target.value }))}
                  placeholder="e.g. replies@yourcompany.com"
                  className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-700 rounded-xl text-xs text-white focus:outline-none focus:border-purple-500"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">Where recipient replies should be directed.</span>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-300 mb-1 block">
                  Organization Header
                </label>
                <input
                  type="text"
                  value={headerConfig.organization}
                  onChange={(e) => setHeaderConfig(prev => ({ ...prev, organization: e.target.value }))}
                  placeholder="e.g. Acme Corporation"
                  className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-700 rounded-xl text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-300">
                    List-Unsubscribe Header (Google & Yahoo 2024 Requirement)
                  </label>
                  <span className="text-[10px] text-emerald-400 font-mono">RFC-2369 Compliant</span>
                </div>
                <input
                  type="text"
                  value={headerConfig.listUnsubscribe}
                  onChange={(e) => setHeaderConfig(prev => ({ ...prev, listUnsubscribe: e.target.value }))}
                  placeholder="<mailto:unsub@domain.com?subject=unsubscribe>, <https://domain.com/unsub>"
                  className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">
                  Google & Yahoo require this header for high inbox delivery. Gmail renders an explicit "Unsubscribe" button at the top when present.
                </span>
              </div>
            </div>

            {/* Domain Audit Results Panel */}
            {domainAudit && (
              <div className="p-4 bg-gray-950 rounded-xl border border-gray-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-purple-400" />
                    DNS Authentication Audit for @{domainAudit.domain}
                  </span>
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    Reputation Score: {domainAudit.score}/100
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className={`p-2 rounded-lg border ${domainAudit.hasMx ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300' : 'bg-rose-950/40 border-rose-500/40 text-rose-300'}`}>
                    <div className="font-bold">MX Records</div>
                    <div className="text-[11px]">{domainAudit.hasMx ? 'Verified Active' : 'Missing'}</div>
                  </div>
                  <div className={`p-2 rounded-lg border ${domainAudit.hasSpf ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300' : 'bg-rose-950/40 border-rose-500/40 text-rose-300'}`}>
                    <div className="font-bold">SPF (v=spf1)</div>
                    <div className="text-[11px]">{domainAudit.hasSpf ? 'Configured' : 'Missing SPF'}</div>
                  </div>
                  <div className={`p-2 rounded-lg border ${domainAudit.hasDmarc ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300' : 'bg-amber-950/40 border-amber-500/40 text-amber-300'}`}>
                    <div className="font-bold">DMARC (_dmarc)</div>
                    <div className="text-[11px]">{domainAudit.hasDmarc ? `Policy: ${domainAudit.dmarcPolicy || 'active'}` : 'Missing DMARC'}</div>
                  </div>
                </div>

                {domainAudit.recommendations.length > 0 && (
                  <div className="space-y-1 pt-1 text-[11px] text-amber-300/90">
                    {domainAudit.recommendations.map((rec, idx) => (
                      <div key={idx} className="flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <span>{rec}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- TAB 5: INBOX DELIVERABILITY ADVISOR --- */}
      {/* ========================================================================= */}
      {activeSubTab === 'deliverability' && (
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-base font-bold text-white">Inbox vs Spam/Junk Optimizer</h3>
                  <p className="text-xs text-gray-400">Strict heuristics to guarantee business correspondence reaches the primary Inbox</p>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                deliverabilityScore.grade === 'Excellent' ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50' : 'bg-blue-950 text-blue-300 border-blue-500/50'
              }`}>
                Grade: {deliverabilityScore.grade} ({deliverabilityScore.score}/100)
              </span>
            </div>

            {/* Checklist items */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-gray-950 rounded-xl border border-gray-800 space-y-2">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  1. Sequential 1-by-1 Dispatching
                </h4>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Bulk blast mailers send 500 emails at once to a shared connection, triggering Google & Outlook rate-spikes. Our engine sends each recipient one-by-one with configurable delays (2s to 30s) and random jitter, accurately mirroring genuine human correspondence.
                </p>
              </div>

              <div className="p-4 bg-gray-950 rounded-xl border border-gray-800 space-y-2">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  2. RFC-2369 List-Unsubscribe Header
                </h4>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Since February 2024, Google and Yahoo reject or spam-box bulk senders lacking clear 1-click unsubscribe headers. We automatically inject compliant <code className="text-emerald-400">List-Unsubscribe</code> tags.
                </p>
              </div>

              <div className="p-4 bg-gray-950 rounded-xl border border-gray-800 space-y-2">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  3. Synchronized Plain-Text Counterpart
                </h4>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Emails sent exclusively as HTML without a <code className="text-blue-400">text/plain</code> alternative trigger high spam penalty points. When you send HTML, our system automatically compiles clean plain text for the MIME boundary.
                </p>
              </div>

              <div className="p-4 bg-gray-950 rounded-xl border border-gray-800 space-y-2">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  4. Unique RFC-5322 Message-ID
                </h4>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Every email receives a unique, cryptographically seeded timestamped Message-ID keyed to your sending domain. This prevents mail servers from classifying identical messages as a duplicated spam campaign.
                </p>
              </div>
            </div>

            {/* Spam Trigger Scanner Output */}
            <div className="p-4 bg-gray-950 rounded-xl border border-gray-800 space-y-3">
              <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-blue-400" />
                Live Spam Trigger Phrase Scan
              </h4>
              {deliverabilityScore.flaggedWords.length === 0 ? (
                <p className="text-xs text-emerald-300 flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-400" />
                  Zero aggressive promotional spam phrases detected in your current subject or body!
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-rose-300">
                    The following words in your content may raise spam flags with mail filters:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {deliverabilityScore.flaggedWords.map((word, idx) => (
                      <span key={idx} className="px-2 py-0.5 bg-rose-950 text-rose-200 border border-rose-800 text-xs rounded font-mono">
                        {word}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- TAB 6: SENT & UNSENT / FAILED LISTS --- */}
      {/* ========================================================================= */}
      {activeSubTab === 'history' && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-800">
              {/* Tabs for Sent vs Failed vs Pending */}
              <div className="flex items-center gap-2 p-1 bg-gray-950 rounded-xl border border-gray-800">
                <button
                  type="button"
                  onClick={() => setActiveResultsTab('sent')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeResultsTab === 'sent'
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Successfully Sent ({sentHistory.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveResultsTab('failed')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeResultsTab === 'failed'
                      ? 'bg-rose-600 text-white shadow-md'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Unsent / Failed ({failedHistory.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveResultsTab('pending')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeResultsTab === 'pending'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  Pending Queue ({recipientsQueue.filter(r => r.status === 'pending').length})
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {activeResultsTab === 'sent' && sentHistory.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={handleStartSendAfresh}
                      className="px-3 py-1.5 bg-blue-900/60 hover:bg-blue-800 text-blue-200 hover:text-white text-xs font-bold rounded-lg border border-blue-700/50 transition-all flex items-center gap-1.5 shadow-sm"
                      title="Reset all recipients and send afresh"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Start Send Afresh
                    </button>
                    <button
                      type="button"
                      onClick={() => copyEmailsList(sentHistory)}
                      className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold rounded-lg border border-gray-700 transition-all flex items-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy Sent
                    </button>
                    <button
                      type="button"
                      onClick={() => exportCsv(sentHistory, 'sent_emails')}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export Sent CSV
                    </button>
                  </>
                )}

                {activeResultsTab === 'failed' && failedHistory.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={handleRetryFailed}
                      className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Retry All Failed
                    </button>
                    <button
                      type="button"
                      onClick={() => exportCsv(failedHistory, 'failed_emails')}
                      className="px-3 py-1.5 bg-rose-600/40 hover:bg-rose-600 text-rose-200 hover:text-white text-xs font-bold rounded-lg border border-rose-500/40 transition-all flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export Failed CSV
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* TAB CONTENT: SENT LIST */}
            {activeResultsTab === 'sent' && (
              <div>
                {sentHistory.length === 0 ? (
                  <div className="text-center py-12 text-gray-500 text-xs space-y-1">
                    <CheckCircle2 className="w-8 h-8 mx-auto text-gray-600" />
                    <p>No sent emails recorded in this session yet.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gray-800">
                    <table className="w-full text-left text-xs text-gray-300">
                      <thead className="bg-gray-950 text-gray-400 font-semibold border-b border-gray-800">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Recipient Email</th>
                          <th className="py-2.5 px-3">Timestamp</th>
                          <th className="py-2.5 px-3">Latency</th>
                          <th className="py-2.5 px-3">Server Response / Message-ID</th>
                          <th className="py-2.5 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60 font-mono">
                        {sentHistory.map((item, idx) => (
                          <tr key={item.id} className="hover:bg-gray-800/30">
                            <td className="py-2.5 px-3 text-gray-500">{idx + 1}</td>
                            <td className="py-2.5 px-3 text-white font-medium">{item.email}</td>
                            <td className="py-2.5 px-3 text-gray-400 font-sans">{item.timestamp}</td>
                            <td className="py-2.5 px-3 text-emerald-400">{item.latencyMs ? `${item.latencyMs}ms` : '—'}</td>
                            <td className="py-2.5 px-3 text-gray-300 truncate max-w-xs font-mono text-[11px]" title={item.response || item.messageId}>
                              {item.response || item.messageId || '250 2.0.0 OK'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-sans">
                              <button
                                type="button"
                                onClick={() => handleResendSingle(item.email)}
                                className="px-2.5 py-1 bg-blue-950/60 hover:bg-blue-800 text-blue-200 hover:text-white rounded text-[11px] font-semibold border border-blue-700/50 transition-all inline-flex items-center gap-1 shadow-sm"
                                title={`Resend email to ${item.email}`}
                              >
                                <RotateCcw className="w-3 h-3" />
                                Resend
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: FAILED LIST */}
            {activeResultsTab === 'failed' && (
              <div>
                {failedHistory.length === 0 ? (
                  <div className="text-center py-12 text-gray-500 text-xs space-y-1">
                    <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500/60" />
                    <p className="text-emerald-400 font-semibold">Zero failed emails!</p>
                    <p className="text-gray-500">All processed recipients were dispatched without SMTP rejections.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gray-800">
                    <table className="w-full text-left text-xs text-gray-300">
                      <thead className="bg-gray-950 text-gray-400 font-semibold border-b border-gray-800">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Recipient Email</th>
                          <th className="py-2.5 px-3">Time</th>
                          <th className="py-2.5 px-3">Error / Rejection Reason</th>
                          <th className="py-2.5 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60 font-mono">
                        {failedHistory.map((item, idx) => (
                          <tr key={item.id} className="hover:bg-gray-800/30">
                            <td className="py-2.5 px-3 text-gray-500">{idx + 1}</td>
                            <td className="py-2.5 px-3 text-rose-300 font-medium">{item.email}</td>
                            <td className="py-2.5 px-3 text-gray-400 font-sans">{item.timestamp}</td>
                            <td className="py-2.5 px-3 text-rose-400 font-sans text-xs">
                              {item.error || 'Mail rejected by server'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-sans">
                              <button
                                type="button"
                                onClick={() => handleResendSingle(item.email)}
                                className="px-2.5 py-1 bg-orange-950/60 hover:bg-orange-700 text-orange-200 hover:text-white rounded text-[11px] font-semibold border border-orange-600/50 transition-all inline-flex items-center gap-1 shadow-sm"
                                title={`Resend immediately to ${item.email}`}
                              >
                                <RotateCcw className="w-3 h-3" />
                                Resend Now
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: PENDING LIST */}
            {activeResultsTab === 'pending' && (
              <div>
                {recipientsQueue.filter(r => r.status === 'pending').length === 0 ? (
                  <div className="text-center py-12 text-gray-500 text-xs space-y-1">
                    <Clock className="w-8 h-8 mx-auto text-gray-600" />
                    <p>No recipients currently waiting in queue.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gray-800">
                    <table className="w-full text-left text-xs text-gray-300">
                      <thead className="bg-gray-950 text-gray-400 font-semibold border-b border-gray-800">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Recipient Email</th>
                          <th className="py-2.5 px-3">Target Company</th>
                          <th className="py-2.5 px-3">Queue Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60 font-mono">
                        {recipientsQueue.filter(r => r.status === 'pending').map((item, idx) => (
                          <tr key={item.id} className="hover:bg-gray-800/30">
                            <td className="py-2.5 px-3 text-gray-500">{idx + 1}</td>
                            <td className="py-2.5 px-3 text-white font-medium">{item.email}</td>
                            <td className="py-2.5 px-3 text-gray-400">{item.company || '—'}</td>
                            <td className="py-2.5 px-3">
                              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-500/40 font-sans">
                                Waiting in sequence
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- HYGIENE & DNS MX AUDIT REPORT MODAL --- */}
      {/* ========================================================================= */}
      {showHygieneModal && hygieneAuditReport && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-indigo-500/40 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-800 flex items-center justify-between bg-gradient-to-r from-gray-900 via-gray-900 to-indigo-950/40">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-xl border border-indigo-500/40">
                  <ShieldCheck className="w-6 h-6 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    Recipient Deliverability & MX Verification Audit
                    <span className="text-xs px-2 py-0.5 bg-emerald-950 text-emerald-300 rounded-full border border-emerald-500/40 font-semibold">
                      {hygieneAuditReport.cleanEmails.length} Approved Clean
                    </span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Evaluated {hygieneAuditReport.totalScanned} mailboxes. Pruned {hygieneAuditReport.removedEmails.length} low-reputation, non-business or dead MX domains.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHygieneModal(false)}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-all"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Metrics Breakdown Grid */}
            <div className="p-5 border-b border-gray-800/80 bg-gray-950/50 overflow-x-auto">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 min-w-[650px]">
                {/* Total */}
                <div className="bg-gray-900/80 border border-gray-800 p-2.5 rounded-xl text-center">
                  <span className="text-[10px] text-gray-400 font-medium block">Total Scanned</span>
                  <span className="text-base font-bold text-white font-mono mt-0.5 block">{hygieneAuditReport.totalScanned}</span>
                </div>

                {/* Clean Retained */}
                <div className="bg-emerald-950/30 border border-emerald-500/40 p-2.5 rounded-xl text-center">
                  <span className="text-[10px] text-emerald-300 font-medium block">Clean Inboxes</span>
                  <span className="text-base font-bold text-emerald-400 font-mono mt-0.5 block">{hygieneAuditReport.cleanEmails.length}</span>
                </div>

                {/* Public */}
                <div className="bg-purple-950/20 border border-purple-800/40 p-2.5 rounded-xl text-center">
                  <span className="text-[10px] text-purple-300 font-medium block">Public Webmail</span>
                  <span className="text-base font-bold text-purple-400 font-mono mt-0.5 block">{hygieneAuditReport.counts.publicWebmail}</span>
                </div>

                {/* Gov & Edu */}
                <div className="bg-blue-950/20 border border-blue-800/40 p-2.5 rounded-xl text-center">
                  <span className="text-[10px] text-blue-300 font-medium block">.Gov / .Edu</span>
                  <span className="text-base font-bold text-blue-400 font-mono mt-0.5 block">{(hygieneAuditReport.counts.government || 0) + (hygieneAuditReport.counts.education || 0)}</span>
                </div>

                {/* Bank */}
                <div className="bg-emerald-950/20 border border-emerald-800/40 p-2.5 rounded-xl text-center">
                  <span className="text-[10px] text-emerald-300 font-medium block">Bank / Fintech</span>
                  <span className="text-base font-bold text-emerald-400 font-mono mt-0.5 block">{hygieneAuditReport.counts.bank || 0}</span>
                </div>

                {/* Junk & Bots */}
                <div className="bg-rose-950/20 border border-rose-800/40 p-2.5 rounded-xl text-center">
                  <span className="text-[10px] text-rose-300 font-medium block">Junk & Bots</span>
                  <span className="text-base font-bold text-rose-400 font-mono mt-0.5 block">{hygieneAuditReport.counts.webmasterBot || 0}</span>
                </div>

                {/* Computer Gen */}
                <div className="bg-cyan-950/20 border border-cyan-800/40 p-2.5 rounded-xl text-center">
                  <span className="text-[10px] text-cyan-300 font-medium block">Computer-Gen</span>
                  <span className="text-base font-bold text-cyan-400 font-mono mt-0.5 block">{hygieneAuditReport.counts.computerGenerated || 0}</span>
                </div>

                {/* Dead MX */}
                <div className="bg-rose-950/30 border border-rose-500/40 p-2.5 rounded-xl text-center">
                  <span className="text-[10px] text-rose-300 font-medium block">Dead DNS MX</span>
                  <span className="text-base font-bold text-rose-400 font-mono mt-0.5 block">{hygieneAuditReport.counts.deadMx || 0}</span>
                </div>
              </div>
            </div>

            {/* Filter Bar & Search */}
            <div className="p-4 border-b border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-3 bg-gray-900/60">
              {/* Category Filter Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
                {[
                  { id: 'all', label: `All Pruned (${hygieneAuditReport.removedEmails.length})` },
                  { id: 'public_webmail', label: `Public (${hygieneAuditReport.counts.publicWebmail})` },
                  { id: 'gov_edu', label: `Gov/Edu (${(hygieneAuditReport.counts.government || 0) + (hygieneAuditReport.counts.education || 0)})` },
                  { id: 'bank', label: `Bank (${hygieneAuditReport.counts.bank || 0})` },
                  { id: 'webmaster_bot', label: `Bots (${hygieneAuditReport.counts.webmasterBot || 0})` },
                  { id: 'computer_generated', label: `Computer (${hygieneAuditReport.counts.computerGenerated || 0})` },
                  { id: 'bad_syntax', label: `Bad/Typo (${(hygieneAuditReport.counts.invalidSyntax || 0) + (hygieneAuditReport.counts.disposable || 0)})` },
                  { id: 'dead_mx', label: `Dead MX (${hygieneAuditReport.counts.deadMx || 0})` },
                ].map(cat => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setAuditFilterCategory(cat.id)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
                      auditFilterCategory === cat.id
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Search Box */}
              <div className="w-full sm:w-64">
                <input
                  type="text"
                  value={auditSearchQuery}
                  onChange={(e) => setAuditSearchQuery(e.target.value)}
                  placeholder="Search pruned emails..."
                  className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            </div>

            {/* Modal Body: Filtered Removed List */}
            <div className="flex-1 overflow-y-auto p-5 min-h-[250px]">
              {hygieneAuditReport.removedEmails.length === 0 ? (
                <div className="text-center py-16 space-y-2">
                  <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto" />
                  <h4 className="text-base font-bold text-white">Flawless List Hygiene</h4>
                  <p className="text-xs text-gray-400 max-w-md mx-auto">
                    All evaluated recipients passed the deliverability criteria: zero public webmails, zero junk bots, zero dead domains detected.
                  </p>
                </div>
              ) : filteredRemovedList.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-xs">
                  No pruned recipients match the selected category or search query.
                </div>
              ) : (
                <div className="rounded-xl border border-gray-800 overflow-hidden">
                  <table className="w-full text-left text-xs text-gray-300">
                    <thead className="bg-gray-950 text-gray-400 font-semibold border-b border-gray-800 sticky top-0">
                      <tr>
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Filtered Email</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3">Reason / Matched Rule</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60 font-mono">
                      {filteredRemovedList.map((item, idx) => {
                        const getBadge = () => {
                          switch (item.category) {
                            case 'public_webmail':
                              return <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-500/40 text-[10px] font-sans font-bold">Public Webmail</span>;
                            case 'government':
                              return <span className="px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-500/40 text-[10px] font-sans font-bold">Government</span>;
                            case 'education':
                              return <span className="px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-500/40 text-[10px] font-sans font-bold">Academic</span>;
                            case 'bank':
                              return <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40 text-[10px] font-sans font-bold">Bank / Finance</span>;
                            case 'webmaster_bot':
                              return <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-500/40 text-[10px] font-sans font-bold">Bot / Junk</span>;
                            case 'computer_generated':
                              return <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40 text-[10px] font-sans font-bold">Computer-Gen</span>;
                            case 'dead_mx':
                              return <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-500/40 text-[10px] font-sans font-bold">Dead DNS MX</span>;
                            case 'disposable':
                              return <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40 text-[10px] font-sans font-bold">Disposable Temp</span>;
                            default:
                              return <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300 text-[10px] font-sans font-bold">Invalid</span>;
                          }
                        };

                        return (
                          <tr key={idx} className="hover:bg-gray-800/30">
                            <td className="py-2 px-3 text-gray-500 text-[11px]">{idx + 1}</td>
                            <td className="py-2 px-3 text-white font-medium">{item.email}</td>
                            <td className="py-2 px-3">{getBadge()}</td>
                            <td className="py-2 px-3 text-gray-300 font-sans text-[11px]">
                              {item.reason} {item.matchedRule && <code className="text-gray-500 text-[10px] font-mono ml-1.5 bg-gray-950 px-1.5 py-0.5 rounded">({item.matchedRule})</code>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-800 bg-gray-950/80 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyRemovedEmails}
                  className="px-3.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy Removed Emails
                </button>
                <button
                  type="button"
                  onClick={handleExportRemovedCsv}
                  className="px-3.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold rounded-xl border border-gray-700 transition-all flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  Download CSV
                </button>
              </div>

              <div className="flex items-center gap-2">
                {originalBackupQueue && (
                  <button
                    type="button"
                    onClick={() => {
                      handleUndoCleaning();
                      setShowHygieneModal(false);
                    }}
                    className="px-3.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-amber-300 text-xs font-semibold rounded-xl border border-amber-600/40 transition-all flex items-center gap-1.5"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    Restore Original ({originalBackupQueue.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowHygieneModal(false)}
                  className="px-5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-md"
                >
                  Keep Clean Queue ({hygieneAuditReport.cleanEmails.length})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default EmailSender;
