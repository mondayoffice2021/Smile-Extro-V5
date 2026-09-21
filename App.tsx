import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ExtractedEmail } from './types';
import CountrySelector from './components/CountrySelector';
import ResultsDisplay from './components/ResultsDisplay';
import EmailSorter from './components/EmailSorter';
import EmailAnalyzer from './components/EmailAnalyzer';
import EmailValidator from './components/EmailValidator';
import SupplyChainExtractor from './components/SupplyChainExtractor';
import MXSorter from './components/MXSorter';
import SettingsModal from './components/SettingsModal';
import { FolderExtractor } from './components/FolderExtractor';
import { BulkUrlOpener } from './components/BulkUrlOpener';
import { FileTextContactExtractor } from './components/FileTextContactExtractor';
import { findAndExtractEmails, suggestKeywords, generateDeepSearchPlan, analyzeCompanyFromEmail, setGlobalApiKey } from './services/geminiService';
import { buildDorkQuery, getCountryCcTLD, getSearchEngineUrl, SEARCH_ENGINES_LIST, EMAIL_PREFIX_OPTIONS, extractEmailsFromText } from './services/dorkHelper';
import { filterDuplicateCompanies } from './services/duplicateChecker';
import { runDeepLeadCrawler, generateIndustrySeedDomains, type LeadCrawlerProgress } from './services/leadCrawlerService';
import SparklesIcon from './components/icons/SparklesIcon';
import MagnifyingGlassIcon from './components/icons/MagnifyingGlassIcon';
import LinkIcon from './components/icons/LinkIcon';
import DocumentArrowUpIcon from './components/icons/DocumentArrowUpIcon';
import LightbulbIcon from './components/icons/LightbulbIcon';
import ToggleSwitch from './components/ToggleSwitch';
import XCircleIcon from './components/icons/XCircleIcon';
import BuildingOfficeIcon from './components/icons/BuildingOfficeIcon';
import FolderOpenIcon from './components/icons/FolderOpenIcon';
import ListBulletIcon from './components/icons/ListBulletIcon';
import Cog6ToothIcon from './components/icons/Cog6ToothIcon';
import BriefcaseIcon from './components/icons/BriefcaseIcon';
import ShieldCheckIcon from './components/icons/ShieldCheckIcon';
import ArrowsRightLeftIcon from './components/icons/ArrowsRightLeftIcon';
import GlobeAltIcon from './components/icons/GlobeAltIcon';
import CheckIcon from './components/icons/CheckIcon';
import ClipboardIcon from './components/icons/ClipboardIcon';
import PlayIcon from './components/icons/PlayIcon';
import PauseIcon from './components/icons/PauseIcon';
import StopIcon from './components/icons/StopIcon';
import ArrowPathIcon from './components/icons/ArrowPathIcon';
import ArrowsPointingOutIcon from './components/icons/ArrowsPointingOutIcon';
import ArrowsPointingInIcon from './components/icons/ArrowsPointingInIcon';
import { ScreenWakeLockIndicator } from './components/ScreenWakeLockIndicator';
import { useActiveWakeLock } from './hooks/useWakeLock';
import { EmailSender } from './components/EmailSender';
import { Send, Menu } from 'lucide-react';
import { AppSidebar, getActiveTabInfo, type TabKey } from './components/AppSidebar';
import { safeFetchJson } from './services/safeFetch';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('extractor');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  const activeTabInfo = useMemo(() => getActiveTabInfo(activeTab), [activeTab]);
  const ActiveTabIcon = activeTabInfo.icon;
  
  // Pipeline Mode within Extractor: 'dork' (Precision Query) | 'crawler' (Autonomous 1000+ Pipeline) | 'urls' (Bulk URL Spider) | 'file-text' (File & Text Extractor)
  const [extractorMode, setExtractorMode] = useState<'dork' | 'crawler' | 'urls' | 'file-text'>('dork');

  // Extractor State
  const [country, setCountry] = useState<string>('Germany');
  const [keywords, setKeywords] = useState<string>('steel manufacturer');
  const [sourceEmail, setSourceEmail] = useState<string>('');
  const [industry, setIndustry] = useState<string>('');
  const [companySize, setCompanySize] = useState<string>('');
  const [urls, setUrls] = useState<string>('');
  const [results, setResults] = useState<ExtractedEmail[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // 1,000+ Lead Autonomous Crawler State
  const [targetGoal, setTargetGoal] = useState<number>(1000);
  const [isCrawlerRunning, setIsCrawlerRunning] = useState<boolean>(false);
  const [crawlerProgress, setCrawlerProgress] = useState<LeadCrawlerProgress | null>(null);
  const crawlerAbortRef = useRef<AbortController | null>(null);
  const crawlerPauseRef = useRef<boolean>(false);

  // Keep screen awake automatically while searching/extracting
  useActiveWakeLock(isLoading || isCrawlerRunning, 'Lead Engine: Extracting & Spidering Contacts');
  const [isSuggesting, setIsSuggesting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeepSearch, setIsDeepSearch] = useState<boolean>(false);
  const [verifyDomains, setVerifyDomains] = useState<boolean>(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  // Search Engine & Dork Strategy State
  const [selectedEngine, setSelectedEngine] = useState<string>('google');
  const [emailPrefix, setEmailPrefix] = useState<string>('info@');
  const [extraDorkTerms, setExtraDorkTerms] = useState<string>('contact us sales export procurement');
  const [avoidDuplicateCompanies, setAvoidDuplicateCompanies] = useState<boolean>(true);

  // Snippet / Paste Modal State
  const [isPasteModalOpen, setIsPasteModalOpen] = useState<boolean>(false);
  const [pasteInputText, setPasteInputText] = useState<string>('');
  const [dorkCopied, setDorkCopied] = useState<boolean>(false);
  
  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Full Screen & Reduction State
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);

  const handleEnterFullScreen = async () => {
    try {
      const docEl = document.documentElement as any;
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if (docEl.webkitRequestFullscreen) {
        await docEl.webkitRequestFullscreen();
      } else if (docEl.mozRequestFullScreen) {
        await docEl.mozRequestFullScreen();
      } else if (docEl.msRequestFullscreen) {
        await docEl.msRequestFullscreen();
      }
      setIsFullScreen(true);
      showToast("Full Screen enabled - Covering entire system");
    } catch (err) {
      console.warn("Fullscreen request error/blocked:", err);
      // Fallback to full viewport mode
      setIsFullScreen(true);
      showToast("Covering entire viewport (Full Screen mode)");
    }
  };

  const handleExitFullScreen = async () => {
    try {
      const doc = document as any;
      if (doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement) {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        } else if (doc.mozCancelFullScreen) {
          await doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen();
        }
      }
      setIsFullScreen(false);
      showToast("Screen reduced to normal view");
    } catch (err) {
      console.warn("Fullscreen exit error:", err);
      setIsFullScreen(false);
      showToast("Screen reduced to normal view");
    }
  };

  // Synchronize fullscreen state with browser/keyboard triggers (Esc / F11 / browser controls)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as any;
      const isFs = Boolean(
        doc.fullscreenElement || 
        doc.webkitFullscreenElement || 
        doc.mozFullScreenElement || 
        doc.msFullscreenElement
      );
      setIsFullScreen(isFs);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullScreen) {
        handleExitFullScreen();
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullScreen]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const stopSearchRef = useRef(false);

  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });

  // Init API Key from storage
  useEffect(() => {
    const storedKey = localStorage.getItem('gemini_api_key');
    if (storedKey) {
      setGlobalApiKey(storedKey);
    }
  }, []);

  const handleSaveApiKey = (key: string) => {
    if (key) {
      localStorage.setItem('gemini_api_key', key);
      setGlobalApiKey(key);
      showToast("API Key updated successfully.");
    } else {
      localStorage.removeItem('gemini_api_key');
      setGlobalApiKey('');
      showToast("API Key cleared. Using default if available.");
    }
  };

  const showToast = (message: string) => {
    setToast({ message, visible: true });
    setTimeout(() => {
      setToast({ message: '', visible: false });
    }, 4000);
  };

  const handleStopSearch = () => {
    stopSearchRef.current = true;
    if (crawlerAbortRef.current) {
      crawlerAbortRef.current.abort();
    }
  };

  // Dynamic Dork Query Construction
  const currentCcTLD = useMemo(() => getCountryCcTLD(country || 'Germany'), [country]);
  
  const currentDorkQuery = useMemo(() => {
    return buildDorkQuery(country || 'Germany', keywords || 'steel manufacturer', emailPrefix, extraDorkTerms);
  }, [country, keywords, emailPrefix, extraDorkTerms]);

  const handleCopyDork = useCallback(() => {
    navigator.clipboard.writeText(currentDorkQuery);
    setDorkCopied(true);
    setTimeout(() => setDorkCopied(false), 2000);
    showToast("Search query copied to clipboard!");
  }, [currentDorkQuery]);

  const handleLaunchEngine = useCallback((engineId: string = selectedEngine) => {
    if (engineId === 'all') {
      SEARCH_ENGINES_LIST.filter(e => e.id !== 'all').forEach(eng => {
        const url = getSearchEngineUrl(eng.id, currentDorkQuery);
        window.open(url, '_blank', 'noopener,noreferrer');
      });
      showToast("Opened all 6 search engines in separate tabs!");
    } else {
      const url = getSearchEngineUrl(engineId, currentDorkQuery);
      window.open(url, '_blank', 'noopener,noreferrer');
      const engineName = SEARCH_ENGINES_LIST.find(e => e.id === engineId)?.name || engineId.toUpperCase();
      showToast(`Launched ${engineName} search in new tab!`);
    }
  }, [selectedEngine, currentDorkQuery]);

  const handleApplyPreset = (presetCountry: string, presetKeyword: string, presetPrefix: string) => {
    setCountry(presetCountry);
    setKeywords(presetKeyword);
    setEmailPrefix(presetPrefix);
    showToast(`Loaded: ${presetCountry} - ${presetKeyword}`);
  };

  const handleDeduplicateCompanies = useCallback(() => {
    if (results.length === 0) return;
    const { unique, duplicateCompaniesCount } = filterDuplicateCompanies(results, [], true);
    if (duplicateCompaniesCount === 0) {
      showToast("Duplicate Checker: All companies in the list are already unique.");
    } else {
      setResults(unique);
      showToast(`Removed ${duplicateCompaniesCount} duplicate company records. Retained primary contacts.`);
    }
  }, [results]);

  const handleExtractPastedText = useCallback(() => {
    if (!pasteInputText.trim()) {
      showToast("Please paste text, search snippets, or HTML first.");
      return;
    }
    const extracted = extractEmailsFromText(pasteInputText, country || 'N/A');
    if (extracted.length === 0) {
      showToast("No email addresses found in the pasted content.");
      return;
    }

    const { unique, duplicateEmailsCount, duplicateCompaniesCount } = filterDuplicateCompanies(
      extracted,
      results,
      avoidDuplicateCompanies
    );

    setResults(prev => [...prev, ...unique]);
    setPasteInputText('');
    setIsPasteModalOpen(false);

    let msg = `Extracted ${unique.length} new business emails!`;
    if (avoidDuplicateCompanies && duplicateCompaniesCount > 0) {
      msg += ` (${duplicateCompaniesCount} duplicate companies avoided)`;
    }
    if (duplicateEmailsCount > 0) {
      msg += ` (${duplicateEmailsCount} duplicate emails skipped)`;
    }
    showToast(msg);
  }, [pasteInputText, country, results, avoidDuplicateCompanies]);

  const handleDorkDirectSearch = useCallback(async () => {
    if (isLoading) return;
    setError(null);
    setIsLoading(true);
    stopSearchRef.current = false;
    setProgressMessage(`Running web search for ${country || 'target'} companies...`);

    try {
      const res = await safeFetchJson<any>('/api/dork-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: currentDorkQuery,
          country: country || 'N/A'
        })
      });

      if (!res.ok || !res.data) {
        throw new Error(res.error || `Search request returned status ${res.status}`);
      }

      const rawResults: ExtractedEmail[] = res.data.results || [];

      const { unique, duplicateEmailsCount, duplicateCompaniesCount } = filterDuplicateCompanies(
        rawResults,
        results,
        avoidDuplicateCompanies
      );

      setResults(prev => [...prev, ...unique]);

      let toastMessage = '';
      if (unique.length === 0) {
        toastMessage = rawResults.length > 0
          ? `Found ${rawResults.length} emails, but all were duplicates${avoidDuplicateCompanies ? ' or belong to existing companies' : ''}.`
          : "No emails found in web index results. Use 'Launch in Engine' to browse directly or paste HTML snippets.";
      } else {
        toastMessage = `Successfully extracted ${unique.length} new business emails!`;
        if (avoidDuplicateCompanies && duplicateCompaniesCount > 0) {
          toastMessage += ` (${duplicateCompaniesCount} duplicate companies avoided.)`;
        }
        if (duplicateEmailsCount > 0) {
          toastMessage += ` (${duplicateEmailsCount} duplicate emails skipped.)`;
        }
      }
      showToast(toastMessage);

    } catch (err: any) {
      setError(err.message || 'Direct search encountered an issue.');
      showToast("Direct search note: You can launch search engines directly or paste search results.");
    } finally {
      setIsLoading(false);
      setProgressMessage(null);
    }
  }, [isLoading, currentDorkQuery, country, results, avoidDuplicateCompanies]);

  // 1,000+ Autonomous Lead Crawler Launch
  const handleStartCrawler = useCallback(async () => {
    if (isLoading || isCrawlerRunning) return;
    setError(null);
    setIsCrawlerRunning(true);
    setIsLoading(true);
    crawlerAbortRef.current = new AbortController();
    crawlerPauseRef.current = false;
    setProgressMessage(`Initializing autonomous pipeline for ${targetGoal.toLocaleString()} leads...`);

    try {
      const crawled = await runDeepLeadCrawler({
        country: country || 'Germany',
        keywords: keywords || 'steel manufacturer',
        targetGoal,
        emailPrefix,
        avoidDuplicateCompanies,
        signal: crawlerAbortRef.current.signal,
        isPaused: () => crawlerPauseRef.current,
        onProgress: (p) => {
          setCrawlerProgress(p);
          setProgressMessage(`[Crawler Round ${p.round}/${p.maxRounds}] ${p.status}`);
        },
        onNewLeads: (newBatch) => {
          setResults(prev => {
            const { unique } = filterDuplicateCompanies(newBatch, prev, avoidDuplicateCompanies);
            return [...prev, ...unique];
          });
        }
      });

      setResults(prev => {
        const { unique } = filterDuplicateCompanies(crawled, prev, avoidDuplicateCompanies);
        return [...prev, ...unique];
      });

      showToast(`Autonomous pipeline completed: extracted ${crawled.length} verified business leads!`);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Crawler error occurred.');
      }
    } finally {
      setIsCrawlerRunning(false);
      setIsLoading(false);
      setProgressMessage(null);
      crawlerAbortRef.current = null;
    }
  }, [isLoading, isCrawlerRunning, country, keywords, targetGoal, emailPrefix, avoidDuplicateCompanies]);

  const handleStopCrawler = () => {
    if (crawlerAbortRef.current) {
      crawlerAbortRef.current.abort();
      showToast("Stopping crawler and retaining extracted leads...");
    }
  };

  const handleTogglePauseCrawler = () => {
    crawlerPauseRef.current = !crawlerPauseRef.current;
    if (crawlerProgress) {
      setCrawlerProgress({ ...crawlerProgress, isPaused: crawlerPauseRef.current });
    }
    showToast(crawlerPauseRef.current ? "Crawler paused." : "Crawler resumed.");
  };

  // URL Target Auto-Loader ("load urls enought to search emails withour anything")
  const handleAutoLoadTargetUrls = useCallback(() => {
    const seedUrls = generateIndustrySeedDomains(country || 'Germany', keywords || 'steel manufacturer');
    setUrls(seedUrls.join('\n'));
    showToast(`Auto-generated and loaded ${seedUrls.length} industry company URLs for ${country}!`);
  }, [country, keywords]);

  // Bulk URL Spider
  const handleBatchScrapeUrls = useCallback(async () => {
    const urlList = urls
      .split(/[\n,;]+/)
      .map(u => u.trim())
      .filter(u => u.length > 5);

    if (urlList.length === 0) {
      showToast("Please enter or auto-load target URLs first.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setProgressMessage(`Spidering & scraping ${urlList.length} company websites...`);

    try {
      const res = await safeFetchJson<any>('/api/scrape-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urlList })
      });

      if (!res.ok || !res.data) {
        throw new Error(res.error || `Scraper request failed with status ${res.status}`);
      }

      const scrapedResults: ExtractedEmail[] = (res.data.results || []).map((r: any) => ({
        email: r.email,
        companyName: r.companyName || (r.email.split('@')[1] ? r.email.split('@')[1].split('.')[0] : 'Company Contact'),
        sourceUrl: r.sourceUrl,
        country: country || 'N/A',
        isValid: true
      }));

      const { unique, duplicateEmailsCount, duplicateCompaniesCount } = filterDuplicateCompanies(
        scrapedResults,
        results,
        avoidDuplicateCompanies
      );

      setResults(prev => [...prev, ...unique]);
      showToast(`Spider extracted ${unique.length} new business emails across ${urlList.length} company domains!`);
    } catch (err: any) {
      setError(err.message || 'URL spider encountered an issue.');
      showToast("URL spider error: Check domain connectivity.");
    } finally {
      setIsLoading(false);
      setProgressMessage(null);
    }
  }, [urls, country, results, avoidDuplicateCompanies]);

  const handleClear = () => {
    setResults([]);
    setError(null);
    showToast("Results cleared.");
  };

  const handleSuggestKeywords = async () => {
    if (isSuggesting || !keywords.trim()) {
        showToast("Please enter some base keywords first.");
        return;
    }
    setIsSuggesting(true);
    try {
        const suggestions = await suggestKeywords(keywords);
        if (suggestions.length > 0) {
            const newKeywords = suggestions.join('\n');
            setKeywords(prev => `${prev}\n${newKeywords}`);
            showToast("New keyword suggestions added!");
        } else {
            showToast("Could not suggest new keywords at this time.");
        }
    } catch (e) {
        showToast("Failed to get keyword suggestions.");
    } finally {
        setIsSuggesting(false);
    }
  };
  
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setKeywords(text);
        showToast("Keywords loaded from file.");
      };
      reader.readAsText(file);
    }
  };

  const [validatorInitialEmails, setValidatorInitialEmails] = useState<string[]>([]);

  const handleSendToValidator = (customList?: string[]) => {
    const list = customList && customList.length > 0 ? customList : results.map(r => r.email).filter(Boolean);
    if (list.length === 0) {
      showToast("No extracted emails available to validate.");
      return;
    }
    const unique = Array.from(new Set(list));
    setValidatorInitialEmails(unique);
    setActiveTab('validator');
    showToast(`Transferred ${unique.length} extracted emails to Sorter & Validator!`);
  };

  const renderContent = () => {
      switch(activeTab) {
          case 'bulk-extractor':
              return <FolderExtractor showToast={showToast} onSendToValidator={handleSendToValidator} />;
          case 'sorter':
              return <EmailSorter showToast={showToast} />;
          case 'analyzer':
              return <EmailAnalyzer showToast={showToast} />;
          case 'validator':
              return (
                <EmailValidator 
                  showToast={showToast} 
                  initialEmails={validatorInitialEmails.length > 0 ? validatorInitialEmails : results.map(r => r.email).filter(Boolean)} 
                />
              );
          case 'mx-sorter':
              return <MXSorter showToast={showToast} />;
          case 'supply-chain':
              return <SupplyChainExtractor showToast={showToast} />;
          case 'bulk-url-opener':
              return <BulkUrlOpener showToast={showToast} />;
          case 'file-text-extractor':
              return (
                <FileTextContactExtractor
                  showToast={showToast}
                  onSendToValidator={handleSendToValidator}
                  onPushToMainLeads={(leads) => {
                    setResults(prev => [...prev, ...leads]);
                    showToast(`Merged ${leads.length} contacts into Main Leads!`);
                  }}
                />
              );
          case 'email-sender':
              return (
                <EmailSender 
                  showToast={showToast} 
                  extractedLeads={results} 
                />
              );
          default:
              if (extractorMode === 'file-text') {
                return (
                  <div className="space-y-5">
                    {/* TOP STRATEGY SELECTOR BAR */}
                    <div className="bg-gray-800/80 backdrop-blur-sm border border-gray-700 rounded-xl p-3.5 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <MagnifyingGlassIcon className="w-5 h-5 text-blue-400" />
                        <div>
                          <h2 className="text-sm font-bold text-white leading-tight">Lead Extraction Pipeline</h2>
                          <p className="text-[11px] text-gray-400">Choose your targeted lead source & extraction strategy</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-gray-900 rounded-lg border border-gray-700 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={() => setExtractorMode('dork')}
                          className="py-1.5 px-3 text-xs font-bold rounded-md transition-all text-center text-gray-400 hover:text-white hover:bg-gray-800"
                        >
                          Precision Search
                        </button>
                        <button
                          type="button"
                          onClick={() => setExtractorMode('crawler')}
                          className="py-1.5 px-3 text-xs font-bold rounded-md transition-all text-center text-gray-400 hover:text-white hover:bg-gray-800"
                        >
                          1,000+ Leads
                        </button>
                        <button
                          type="button"
                          onClick={() => setExtractorMode('urls')}
                          className="py-1.5 px-3 text-xs font-bold rounded-md transition-all text-center text-gray-400 hover:text-white hover:bg-gray-800"
                        >
                          URL Spider
                        </button>
                        <button
                          type="button"
                          onClick={() => setExtractorMode('file-text')}
                          className="py-1.5 px-3 text-xs font-bold rounded-md transition-all text-center bg-emerald-600 text-white shadow-md"
                        >
                          File & Text (Email/Phone/Webit)
                        </button>
                      </div>
                    </div>

                    <FileTextContactExtractor
                      showToast={showToast}
                      onSendToValidator={handleSendToValidator}
                      onPushToMainLeads={(leads) => {
                        setResults(prev => [...prev, ...leads]);
                        showToast(`Merged ${leads.length} contacts into Main Leads!`);
                      }}
                    />
                  </div>
                );
              }
              return (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* EXTRACTOR SIDEBAR */}
                  <div className="lg:col-span-4 bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl shadow-2xl p-6 h-fit space-y-5">
                    <div className="flex items-center justify-between pb-3 border-b border-gray-700/60">
                      <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                          <MagnifyingGlassIcon className="w-5 h-5 text-blue-400" />
                          Targeted Lead Engine
                        </h2>
                        <p className="text-xs text-gray-400">Autonomous search crawling & precision spidering</p>
                      </div>
                    </div>

                    {/* PIPELINE MODE SELECTOR */}
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                        Extraction Strategy:
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-gray-900/80 rounded-lg border border-gray-700">
                        <button
                          type="button"
                          onClick={() => setExtractorMode('dork')}
                          className={`py-2 px-1 text-xs font-bold rounded-md transition-all text-center ${
                            extractorMode === 'dork'
                              ? 'bg-blue-600 text-white shadow-md'
                              : 'text-gray-400 hover:text-white hover:bg-gray-800'
                          }`}
                        >
                          Precision Search
                        </button>
                        <button
                          type="button"
                          onClick={() => setExtractorMode('crawler')}
                          className={`py-2 px-1 text-xs font-bold rounded-md transition-all text-center relative ${
                            extractorMode === 'crawler'
                              ? 'bg-amber-600 text-white shadow-md'
                              : 'text-gray-400 hover:text-white hover:bg-gray-800'
                          }`}
                        >
                          1,000+ Leads
                          <span className="absolute -top-1.5 -right-1 flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setExtractorMode('urls')}
                          className={`py-2 px-1 text-xs font-bold rounded-md transition-all text-center ${
                            extractorMode === 'urls'
                              ? 'bg-teal-600 text-white shadow-md'
                              : 'text-gray-400 hover:text-white hover:bg-gray-800'
                          }`}
                        >
                          URL Spider
                        </button>
                        <button
                          type="button"
                          onClick={() => setExtractorMode('file-text')}
                          className={`py-2 px-1 text-xs font-bold rounded-md transition-all text-center ${
                            extractorMode === 'file-text'
                              ? 'bg-emerald-600 text-white shadow-md'
                              : 'text-gray-400 hover:text-white hover:bg-gray-800'
                          }`}
                        >
                          File & Text
                        </button>
                      </div>
                    </div>

                    {/* DUPLICATE CHECKER TOGGLE */}
                    <div className="p-3.5 bg-gray-800/80 border border-gray-700 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <ToggleSwitch 
                          label="Avoid Duplicate Companies"
                          enabled={avoidDuplicateCompanies}
                          onChange={setAvoidDuplicateCompanies}
                          disabled={isLoading || isCrawlerRunning}
                        />
                        <span className="text-xs px-2 py-0.5 rounded font-medium bg-emerald-900/40 text-emerald-300 border border-emerald-700/40">
                          {avoidDuplicateCompanies ? 'Deduplication Active' : 'All Contacts'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 leading-relaxed">
                        Retains one verified primary contact per corporate domain to keep your lead lists clean.
                      </p>
                    </div>

                    {/* TARGET COUNTRY */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label htmlFor="country" className="block text-sm font-medium text-gray-300">
                          Target Country
                        </label>
                        <span className="text-xs text-gray-400 font-mono">
                          ccTLD: <strong className="text-blue-400">.{currentCcTLD}</strong>
                        </span>
                      </div>
                      <CountrySelector selectedCountry={country} setSelectedCountry={setCountry} disabled={isLoading || isCrawlerRunning} />
                    </div>

                    {/* INDUSTRY & KEYWORDS */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label htmlFor="keywords" className="block text-sm font-medium text-gray-300">
                          Industry & Keywords
                        </label>
                        <span className="text-xs text-gray-400">e.g. shipyard, steel manufacturer</span>
                      </div>
                      <textarea
                        id="keywords"
                        rows={2}
                        value={keywords}
                        onChange={(e) => setKeywords(e.target.value)}
                        placeholder="e.g., 'steel manufacturer'"
                        disabled={isLoading || isCrawlerRunning}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 transition disabled:cursor-not-allowed resize-y text-sm font-medium text-white"
                      />
                      <div className="mt-2 flex items-center gap-2 flex-wrap justify-between">
                        <div className="flex items-center gap-2">
                          <button onClick={() => fileInputRef.current?.click()} disabled={isLoading || isCrawlerRunning} className="text-xs text-blue-400 hover:text-blue-300 flex items-center">
                            <DocumentArrowUpIcon className="w-3.5 h-3.5 mr-1" /> Load File
                          </button>
                          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".txt" className="hidden" />
                          <button onClick={handleSuggestKeywords} disabled={isLoading || isCrawlerRunning || isSuggesting} className="text-xs text-yellow-400 hover:text-yellow-300 flex items-center">
                            <LightbulbIcon className="w-3.5 h-3.5 mr-1" /> Suggest Keywords
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* TARGET EMAIL SYNTAX */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-sm font-medium text-gray-300">Target Email Syntax</label>
                        <span className="text-xs text-gray-400">Tail query parameter</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {EMAIL_PREFIX_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setEmailPrefix(opt.id)}
                            className={`px-2.5 py-1 text-xs font-mono font-bold rounded-md transition-all border ${
                              emailPrefix === opt.id
                                ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                                : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700 border-gray-600'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* MODE 1: PRECISION DORK / SEARCH */}
                    {extractorMode === 'dork' && (
                      <div className="space-y-4 pt-1">
                        {/* SEARCH ENGINES SELECTOR */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">Search Engine</label>
                            <span className="text-xs text-gray-400">6 major engines</span>
                          </div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {SEARCH_ENGINES_LIST.map((eng) => (
                              <button
                                key={eng.id}
                                type="button"
                                onClick={() => setSelectedEngine(eng.id)}
                                className={`px-2 py-1 text-xs font-semibold rounded-md transition-all text-center border ${
                                  selectedEngine === eng.id
                                    ? 'bg-blue-600 text-white border-blue-400 shadow-sm'
                                    : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700 border-gray-600'
                                }`}
                              >
                                {eng.name}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* LIVE DORK QUERY PREVIEW */}
                        <div className="bg-gray-900/90 border border-gray-700 rounded-lg p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                              <GlobeAltIcon className="w-3.5 h-3.5 text-blue-400" />
                              Generated Query:
                            </span>
                            <button
                              type="button"
                              onClick={handleCopyDork}
                              className="text-xs text-gray-300 hover:text-white flex items-center gap-1 bg-gray-800 px-2 py-0.5 rounded border border-gray-700"
                            >
                              {dorkCopied ? <CheckIcon className="w-3 h-3 text-green-400" /> : <ClipboardIcon className="w-3 h-3" />}
                              {dorkCopied ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <div className="bg-black/60 p-2 rounded font-mono text-xs text-emerald-400 break-all select-all border border-gray-800">
                            {currentDorkQuery}
                          </div>
                        </div>

                        {/* ACTION BUTTONS */}
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={handleDorkDirectSearch}
                            disabled={isLoading}
                            className="w-full py-2.5 px-4 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            <MagnifyingGlassIcon className="w-4 h-4" />
                            {isLoading ? 'Searching Web Index...' : 'Run Search & Extract Emails'}
                          </button>

                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => handleLaunchEngine(selectedEngine)}
                              disabled={isLoading}
                              className="py-2 px-3 text-xs font-bold rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-all border border-gray-600 flex items-center justify-center gap-1.5 truncate"
                            >
                              <GlobeAltIcon className="w-3.5 h-3.5 text-blue-400" />
                              Launch in {selectedEngine === 'all' ? 'All' : SEARCH_ENGINES_LIST.find(e => e.id === selectedEngine)?.name}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLaunchEngine('all')}
                              disabled={isLoading}
                              className="py-2 px-3 text-xs font-bold rounded-lg bg-indigo-700/80 hover:bg-indigo-600 text-white transition-all border border-indigo-500/50 flex items-center justify-center gap-1.5 truncate"
                            >
                              Open All 6 Engines
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => setIsPasteModalOpen(true)}
                            disabled={isLoading}
                            className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 transition-all border border-gray-700 flex items-center justify-center gap-1.5"
                          >
                            <DocumentArrowUpIcon className="w-4 h-4 text-emerald-400" />
                            Paste Search Results / Snippets
                          </button>
                        </div>
                      </div>
                    )}

                    {/* MODE 2: AUTONOMOUS 1,000+ LEADS PIPELINE */}
                    {extractorMode === 'crawler' && (
                      <div className="space-y-4 pt-1">
                        <div className="p-3 bg-amber-950/40 border border-amber-600/40 rounded-lg space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                              ★ 1,000+ Leads Autonomous Pipeline
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-900/60 text-amber-200 border border-amber-600/50 font-mono">
                              Deep Matrix
                            </span>
                          </div>
                          <p className="text-xs text-amber-200/80 leading-relaxed">
                            Autonomously expands queries across {country}&apos;s industrial hubs and directories to harvest over 1,000 verified leads without browser hanging.
                          </p>

                          <div>
                            <label className="block text-xs font-medium text-amber-300 mb-1">Target Lead Goal:</label>
                            <select
                              value={targetGoal}
                              onChange={(e) => setTargetGoal(Number(e.target.value))}
                              disabled={isCrawlerRunning}
                              className="w-full px-3 py-1.5 bg-gray-900 border border-amber-600/50 rounded-lg text-xs font-bold text-amber-300 focus:outline-none"
                            >
                              <option value={100}>100 Leads (Fast Sprint)</option>
                              <option value={250}>250 Leads</option>
                              <option value={500}>500 Leads (Standard Pipeline)</option>
                              <option value={1000}>1,000 Leads (Recommended Scale)</option>
                              <option value={2500}>2,500 Leads (Deep Industrial Harvest)</option>
                            </select>
                          </div>
                        </div>

                        {/* Live Crawler Telemetry Panel */}
                        {isCrawlerRunning && crawlerProgress && (
                          <div className="p-3.5 bg-gray-900 border border-amber-500/40 rounded-xl space-y-3 shadow-xl">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-amber-300 flex items-center gap-1.5">
                                <ArrowPathIcon className="w-4 h-4 animate-spin text-amber-400" />
                                {crawlerProgress.isPaused ? 'Crawler Paused' : 'Crawling Live Index...'}
                              </span>
                              <span className="font-mono text-gray-300 font-bold">
                                {crawlerProgress.currentCount} / {crawlerProgress.targetGoal} Leads ({crawlerProgress.percent}%)
                              </span>
                            </div>

                            <div className="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden">
                              <div
                                className="bg-amber-500 h-full transition-all duration-300"
                                style={{ width: `${crawlerProgress.percent}%` }}
                              ></div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-400">
                              <div>Unique Companies: <strong className="text-white">{crawlerProgress.uniqueCompanies}</strong></div>
                              <div>Crawled URLs: <strong className="text-white">{crawlerProgress.crawledUrls}</strong></div>
                              <div className="col-span-2 truncate" title={crawlerProgress.activeQuery}>
                                Active Dork: <span className="text-emerald-400 font-mono">{crawlerProgress.activeQuery}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={handleTogglePauseCrawler}
                                className="flex-1 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 font-bold text-xs rounded border border-gray-600 flex items-center justify-center gap-1"
                              >
                                {crawlerProgress.isPaused ? <PlayIcon className="w-3.5 h-3.5 text-green-400" /> : <PauseIcon className="w-3.5 h-3.5 text-yellow-400" />}
                                {crawlerProgress.isPaused ? 'Resume' : 'Pause'}
                              </button>
                              <button
                                type="button"
                                onClick={handleStopCrawler}
                                className="flex-1 py-1.5 bg-red-600/30 hover:bg-red-600 text-red-300 hover:text-white font-bold text-xs rounded border border-red-500/40 flex items-center justify-center gap-1"
                              >
                                <StopIcon className="w-3.5 h-3.5" />
                                Stop & Keep
                              </button>
                            </div>
                          </div>
                        )}

                        {!isCrawlerRunning && (
                          <button
                            type="button"
                            onClick={handleStartCrawler}
                            disabled={isLoading}
                            className="w-full py-3 px-4 text-sm font-bold rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            <SparklesIcon className="w-5 h-5 text-amber-200" />
                            Launch Autonomous {targetGoal.toLocaleString()}+ Lead Pipeline
                          </button>
                        )}
                      </div>
                    )}

                    {/* MODE 3: DIRECT BULK URL AUTO-LOADER & SPIDER */}
                    {extractorMode === 'urls' && (
                      <div className="space-y-4 pt-1">
                        <div className="p-3 bg-teal-950/40 border border-teal-600/40 rounded-lg space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-teal-300 flex items-center gap-1.5">
                              🌐 Direct URL Batch Spider
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-teal-900/60 text-teal-200 border border-teal-600/50 font-mono">
                              Up to 150 URLs
                            </span>
                          </div>
                          <p className="text-xs text-teal-200/80 leading-relaxed">
                            Spiders target websites and follows /contact, /impressum, /about, and /kontakt to extract verified corporate emails.
                          </p>

                          <button
                            type="button"
                            onClick={handleAutoLoadTargetUrls}
                            disabled={isLoading}
                            className="w-full py-2 px-3 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-bold transition-all shadow flex items-center justify-center gap-1.5"
                          >
                            ⚡ Auto-Generate & Load 30+ Target URLs
                          </button>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
                              Target URLs / Domains:
                            </label>
                            <span className="text-xs text-teal-400 font-mono">
                              {urls.split('\n').filter(u => u.trim().length > 5).length} URLs loaded
                            </span>
                          </div>
                          <textarea
                            rows={6}
                            value={urls}
                            onChange={(e) => setUrls(e.target.value)}
                            placeholder="Enter or paste URLs (e.g. https://company.de, https://steel-mfg.com)"
                            disabled={isLoading}
                            className="w-full p-2.5 bg-gray-900 border border-gray-700 rounded-lg font-mono text-xs text-teal-300 focus:ring-1 focus:ring-teal-500 focus:outline-none"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={handleBatchScrapeUrls}
                          disabled={isLoading || !urls.trim()}
                          className="w-full py-2.5 px-4 text-sm font-bold rounded-lg bg-teal-600 hover:bg-teal-500 text-white shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          <GlobeAltIcon className="w-4 h-4" />
                          {isLoading ? 'Spidering URLs...' : 'Spider & Extract All URLs'}
                        </button>
                      </div>
                    )}

                    {/* STOP SEARCH BUTTON */}
                    {isLoading && !isCrawlerRunning && (
                      <button 
                        type="button"
                        onClick={handleStopSearch} 
                        className="w-full flex items-center justify-center py-2 px-4 text-xs font-bold rounded-lg bg-red-600/80 hover:bg-red-600 text-white shadow-lg transition-all border border-red-500"
                      >
                        <XCircleIcon className="w-4 h-4 mr-1.5" /> Stop Current Operation
                      </button>
                    )}
                  </div>

                  {/* EXTRACTOR RESULTS */}
                  <div className="lg:col-span-8">
                    <ResultsDisplay 
                      results={results} 
                      isLoading={isLoading || isCrawlerRunning} 
                      error={error} 
                      progressMessage={progressMessage} 
                      onClearResults={handleClear} 
                      onDeduplicateCompanies={handleDeduplicateCompanies}
                      avoidDuplicateCompanies={avoidDuplicateCompanies}
                      onSendToValidator={() => handleSendToValidator()}
                      onSendToEmailSender={() => setActiveTab('email-sender')}
                    />
                  </div>
                </div>
              );
      }
  };

  return (
    <>
      <div className={`fixed top-5 right-5 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg transition-transform duration-300 z-[110] ${toast.visible ? 'translate-x-0' : 'translate-x-full'}`} style={{ transform: toast.visible ? 'translateX(0)' : 'translateX(calc(100% + 20px))' }}>
        {toast.message}
      </div>
      
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        onSave={handleSaveApiKey} 
      />

      <div className="min-h-screen w-full bg-slate-950 text-white font-sans flex flex-row antialiased">
        {/* SIDE NAVIGATION BAR */}
        <AppSidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          leadsCount={results.length}
          isCollapsed={isSidebarCollapsed}
          setIsCollapsed={setIsSidebarCollapsed}
          isMobileOpen={isMobileMenuOpen}
          setIsMobileOpen={setIsMobileMenuOpen}
          isFullScreen={isFullScreen}
          onEnterFullScreen={handleEnterFullScreen}
          onExitFullScreen={handleExitFullScreen}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        {/* MAIN WORKSPACE AREA */}
        <div className="flex-1 flex flex-col min-w-0 min-h-screen overflow-x-hidden bg-slate-950">
          {/* TOP APP BAR */}
          <header className="sticky top-0 z-30 min-h-16 px-4 sm:px-6 py-2.5 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {/* Mobile Drawer Trigger */}
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(true)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition lg:hidden shrink-0"
                aria-label="Open navigation sidebar"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-xl shrink-0 ${activeTabInfo.activeColor}`}>
                  <ActiveTabIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {activeTabInfo.category}
                    </span>
                    <h1 className="text-base sm:text-lg font-extrabold text-white truncate">
                      {activeTabInfo.label}
                    </h1>
                  </div>
                  <p className="text-xs text-slate-400 truncate hidden sm:block">
                    {activeTabInfo.description}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-auto">
              <ScreenWakeLockIndicator showToast={showToast} />

              {/* Lead Counter Shortcut */}
              {results.length > 0 && activeTab !== 'extractor' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('extractor')}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/50 transition"
                  title="View harvested leads in Lead Extractor"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span>{results.length.toLocaleString()} Leads</span>
                </button>
              )}

              {/* FULL SCREEN / REDUCE */}
              <button 
                type="button"
                onClick={handleEnterFullScreen}
                disabled={isFullScreen}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shadow-sm ${
                  isFullScreen
                    ? 'bg-slate-800 text-slate-500 border-slate-700/60 cursor-not-allowed opacity-50'
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white border-blue-400/40 shadow-blue-500/20 active:scale-95'
                }`}
                title="Make it Full Screen to cover the whole system and monitor"
              >
                <ArrowsPointingOutIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Full Screen</span>
              </button>

              <button 
                type="button"
                onClick={handleExitFullScreen}
                disabled={!isFullScreen}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shadow-sm ${
                  !isFullScreen
                    ? 'bg-slate-800 text-slate-500 border-slate-700/60 cursor-not-allowed opacity-50'
                    : 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white border-amber-400/50 shadow-amber-500/20 ring-2 ring-amber-400/30 active:scale-95'
                }`}
                title="Reduce screen back to normal window size (Esc)"
              >
                <ArrowsPointingInIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reduce</span>
              </button>

              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition border border-transparent hover:border-slate-700"
                title="Settings"
              >
                <Cog6ToothIcon className="w-5 h-5" />
              </button>
            </div>
          </header>

          {/* MAIN VIEW CONTENT */}
          <main className={`flex-1 transition-all duration-200 ${isFullScreen ? 'p-2 sm:p-3' : 'p-3 sm:p-5 lg:p-6'}`}>
            <div className="w-full mx-auto">
              {renderContent()}
            </div>
          </main>
        </div>
      </div>

      {/* QUICK PASTE SEARCH RESULTS MODAL */}
      {isPasteModalOpen && (
        <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <DocumentArrowUpIcon className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-bold text-white">Paste Search Results or Web Content</h3>
              </div>
              <button
                onClick={() => setIsPasteModalOpen(false)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800"
              >
                <XCircleIcon className="w-6 h-6" />
              </button>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              Copy content directly from Google, Bing, Brave, DuckDuckGo, Yahoo, or Yandex search result pages, catalogs, or contact listings. The extractor will harvest all emails and apply the <strong>Duplicate Checker</strong> to ensure unique company records.
            </p>

            <textarea
              rows={8}
              value={pasteInputText}
              onChange={(e) => setPasteInputText(e.target.value)}
              placeholder="Paste raw text, snippets, or HTML here..."
              className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:ring-2 focus:ring-blue-500 font-mono"
            />

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-gray-400">
                Country: <strong className="text-blue-400">{country || 'Default'}</strong> • Avoid Duplicate Companies: <strong className={avoidDuplicateCompanies ? "text-emerald-400" : "text-gray-400"}>{avoidDuplicateCompanies ? "Enabled" : "Disabled"}</strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsPasteModalOpen(false);
                    setActiveTab('file-text-extractor');
                  }}
                  className="px-3 py-2 text-xs font-semibold rounded-lg bg-teal-900/40 text-teal-300 hover:bg-teal-900/70 border border-teal-600/50"
                  title="Extract emails, phone numbers, and webmail links"
                >
                  Deep Multi-Extractor (Email • Phone • Webit)
                </button>
                <button
                  type="button"
                  onClick={() => setIsPasteModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExtractPastedText}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg transition-all"
                >
                  Extract Emails & Deduplicate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FLOATING QUICK REDUCE BUTTON WHEN FULL SCREEN IS ACTIVE */}
      {isFullScreen && (
        <div className="fixed bottom-5 right-5 z-[9999] flex items-center gap-2.5 bg-gray-900/95 backdrop-blur-md border border-amber-500/50 text-white px-3.5 py-2 rounded-xl shadow-2xl shadow-black/80 transition-all animate-in fade-in slide-in-from-bottom-3 duration-300">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
          </span>
          <span className="text-xs text-gray-200 font-semibold tracking-tight hidden sm:inline">Full Screen Mode</span>
          <button
            type="button"
            onClick={handleExitFullScreen}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-bold rounded-lg transition shadow-md hover:scale-105 active:scale-95 border border-amber-400/40"
            title="Reduce screen back to normal window size (Esc)"
          >
            <ArrowsPointingInIcon className="w-3.5 h-3.5" />
            <span>Reduce Screen</span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] bg-amber-950/80 rounded border border-amber-400/40 font-mono text-amber-200 ml-1">Esc</kbd>
          </button>
        </div>
      )}
    </>
  );
};

export default App;
