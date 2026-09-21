import React, { useState, useRef, useMemo } from 'react';
import type { CompanyIntel, IndustryGroupIntel, ProductGroupIntel } from '../types';
import { fetchDomainIntelligence } from '../services/geminiService';
import { classifyIndustryOffline, classifyCountryOffline } from '../services/offlineClassifier';
import { extractEmailsFromFile } from '../services/fileService';
import DocumentArrowUpIcon from './icons/DocumentArrowUpIcon';
import ArrowPathIcon from './icons/ArrowPathIcon';
import FolderOpenIcon from './icons/FolderOpenIcon';
import PauseIcon from './icons/PauseIcon';
import PlayIcon from './icons/PlayIcon';
import StopIcon from './icons/StopIcon';
import BriefcaseIcon from './icons/BriefcaseIcon';
import BuildingOfficeIcon from './icons/BuildingOfficeIcon';
import Cog6ToothIcon from './icons/Cog6ToothIcon';
import ShieldCheckIcon from './icons/ShieldCheckIcon';
import GlobeAltIcon from './icons/GlobeAltIcon';
import SparklesIcon from './icons/SparklesIcon';
import LightbulbIcon from './icons/LightbulbIcon';
import ListBulletIcon from './icons/ListBulletIcon';
import FunnelIcon from './icons/FunnelIcon';
import MagnifyingGlassIcon from './icons/MagnifyingGlassIcon';
import LinkIcon from './icons/LinkIcon';
import TagIcon from './icons/TagIcon';
import ArrowDownTrayIcon from './icons/ArrowDownTrayIcon';
import ClipboardIcon from './icons/ClipboardIcon';
import CheckIcon from './icons/CheckIcon';
import ToggleSwitch from './ToggleSwitch';
import CompanyDossierModal from './CompanyDossierModal';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { isPublicDomain } from '../constants/domains';
import { useActiveWakeLock } from '../hooks/useWakeLock';

interface EmailAnalyzerProps {
  showToast: (msg: string) => void;
}

const EmailAnalyzer: React.FC<EmailAnalyzerProps> = ({ showToast }) => {
  const [inputText, setInputText] = useState('');
  const [companies, setCompanies] = useState<CompanyIntel[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [statusText, setStatusText] = useState<string>('Idle');
  const [ignoredCount, setIgnoredCount] = useState<number>(0);
  const [largeFileMode, setLargeFileMode] = useState(false);
  const [useOfflineMode, setUseOfflineMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndustry, setSelectedIndustry] = useState('All');
  const [selectedProductCategory, setSelectedProductCategory] = useState('All');
  const [viewMode, setViewMode] = useState<'companies' | 'products' | 'industries'>('companies');
  const [selectedCompanyForModal, setSelectedCompanyForModal] = useState<CompanyIntel | null>(null);
  const [expandedEmailsDomain, setExpandedEmailsDomain] = useState<string | null>(null);
  const [refreshingDomain, setRefreshingDomain] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Keep screen awake while industry batch analysis is executing
  useActiveWakeLock(isProcessing, 'Industry Analyzer: Company Discovery');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const rawFileContent = useRef<string | null>(null);
  const controlRef = useRef({ shouldStop: false, isPaused: false });

  // On-demand re-query for a specific company using live website and Google search grounding
  const handleRequeryCompany = async (companyToRefresh: CompanyIntel) => {
    setRefreshingDomain(companyToRefresh.domain);
    showToast(`Querying Google & live website for ${companyToRefresh.companyName}...`);
    try {
      const apiKey = localStorage.getItem('gemini_api_key') || '';
      const freshResults = await fetchDomainIntelligence([companyToRefresh.domain], apiKey);
      if (freshResults.length > 0) {
        const updated: CompanyIntel = {
          ...freshResults[0],
          emails: companyToRefresh.emails
        };
        setCompanies(prev => prev.map(c => c.domain === companyToRefresh.domain ? updated : c));
        if (selectedCompanyForModal && selectedCompanyForModal.domain === companyToRefresh.domain) {
          setSelectedCompanyForModal(updated);
        }
        showToast(`Updated ${companyToRefresh.companyName} with live web & Google search data!`);
      }
    } catch (err: any) {
      showToast(`Notice: ${err?.message || 'Could not refresh'}`);
    } finally {
      setRefreshingDomain(null);
    }
  };

  // Handle file reading from upload input
  const handleFile = async (file: File) => {
    setIsProcessing(true);
    setStatusText("Reading file...");
    try {
      const emails = await extractEmailsFromFile(file);
      if (emails.length === 0) {
        showToast("No emails found in the file.");
      } else {
        const isLarge = file.size > 1024 * 1024 || emails.length > 5000;
        setLargeFileMode(isLarge);

        if (isLarge) {
          rawFileContent.current = emails.join('\n');
          setInputText(`[LARGE FILE LOADED]\nName: ${file.name}\nEmails found: ${emails.length}\nSize: ${(file.size / 1024 / 1024).toFixed(2)} MB\n\nContent hidden for performance. Ready to analyze.`);
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
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
  };

  // Drag & drop support
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
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
      setLargeFileMode(false);
      rawFileContent.current = null;
    }
    setInputText(e.target.value);
  };

  // Group companies by industry
  const industryGroups: IndustryGroupIntel[] = useMemo(() => {
    const map = new Map<string, { emails: string[]; companies: CompanyIntel[] }>();
    companies.forEach(company => {
      const ind = company.industry || 'General Business';
      if (!map.has(ind)) {
        map.set(ind, { emails: [], companies: [] });
      }
      const group = map.get(ind)!;
      group.companies.push(company);
      group.emails.push(...company.emails);
    });

    return Array.from(map.entries())
      .map(([industry, val]) => ({
        industry,
        emails: Array.from(new Set(val.emails)),
        companies: val.companies
      }))
      .sort((a, b) => b.companies.length - a.companies.length);
  }, [companies]);

  // Industry sectors list for quick filtering pills
  const availableIndustries = useMemo(() => {
    const list = industryGroups.map(g => g.industry);
    return ['All', ...list];
  }, [industryGroups]);

  // Group companies and emails by Product / Service Category
  const productGroups: ProductGroupIntel[] = useMemo(() => {
    const map = new Map<string, { emails: string[]; companies: CompanyIntel[] }>();
    companies.forEach(company => {
      const cat = company.productCategory || company.subCategory || 'General Products & Services';
      if (!map.has(cat)) {
        map.set(cat, { emails: [], companies: [] });
      }
      const group = map.get(cat)!;
      group.companies.push(company);
      group.emails.push(...company.emails);
    });

    return Array.from(map.entries())
      .map(([productCategory, val]) => ({
        productCategory,
        emails: Array.from(new Set(val.emails)),
        companies: val.companies
      }))
      .sort((a, b) => b.emails.length - a.emails.length);
  }, [companies]);

  // Available product categories for quick filtering pills
  const availableProductCategories = useMemo(() => {
    const list = productGroups.map(g => g.productCategory);
    return ['All', ...list];
  }, [productGroups]);

  // Filtered companies based on search query, industry, and product category
  const filteredCompanies = useMemo(() => {
    return companies.filter(c => {
      const matchesIndustry = selectedIndustry === 'All' || c.industry === selectedIndustry;
      if (!matchesIndustry) return false;

      const compProductCat = c.productCategory || c.subCategory || 'General Products & Services';
      const matchesProduct = selectedProductCategory === 'All' || compProductCat === selectedProductCategory;
      if (!matchesProduct) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        c.companyName.toLowerCase().includes(q) ||
        c.domain.toLowerCase().includes(q) ||
        (c.productCategory && c.productCategory.toLowerCase().includes(q)) ||
        (c.primaryProducts && c.primaryProducts.some(p => p.toLowerCase().includes(q))) ||
        (c.subCategory && c.subCategory.toLowerCase().includes(q)) ||
        (c.industry && c.industry.toLowerCase().includes(q)) ||
        (c.overview && c.overview.toLowerCase().includes(q)) ||
        c.emails.some(e => e.toLowerCase().includes(q))
      );
    });
  }, [companies, selectedIndustry, selectedProductCategory, searchQuery]);

  // Filtered product groups for the Products tab
  const filteredProductGroups = useMemo(() => {
    return productGroups.filter(pg => {
      if (selectedProductCategory !== 'All' && pg.productCategory !== selectedProductCategory) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        pg.productCategory.toLowerCase().includes(q) ||
        pg.companies.some(c =>
          c.companyName.toLowerCase().includes(q) ||
          c.domain.toLowerCase().includes(q) ||
          (c.primaryProducts && c.primaryProducts.some(p => p.toLowerCase().includes(q)))
        ) ||
        pg.emails.some(e => e.toLowerCase().includes(q))
      );
    });
  }, [productGroups, selectedProductCategory, searchQuery]);

  // Filtered industry groups for the Sectors tab
  const filteredIndustryGroups = useMemo(() => {
    return industryGroups.filter(ig => {
      if (selectedIndustry !== 'All' && ig.industry !== selectedIndustry) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        ig.industry.toLowerCase().includes(q) ||
        ig.companies.some(c => c.companyName.toLowerCase().includes(q) || c.domain.toLowerCase().includes(q)) ||
        ig.emails.some(e => e.toLowerCase().includes(q))
      );
    });
  }, [industryGroups, selectedIndustry, searchQuery]);

  // Total email count across all analyzed companies
  const totalEmailsCount = useMemo(() => {
    return companies.reduce((acc, c) => acc + c.emails.length, 0);
  }, [companies]);

  // Copy emails helper with visual feedback
  const handleCopyEmails = (emailsList: string[], id: string, label: string) => {
    if (emailsList.length === 0) return;
    navigator.clipboard.writeText(emailsList.join('\n'));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2200);
    showToast(`Copied ${emailsList.length} emails from ${label} to clipboard!`);
  };

  // Main Processing Engine
  const processEmails = async () => {
    const contentToProcess = largeFileMode && rawFileContent.current ? rawFileContent.current : inputText;

    if (!contentToProcess.trim()) {
      showToast("Please enter emails to analyze.");
      return;
    }

    controlRef.current = { shouldStop: false, isPaused: false };
    setIsPaused(false);
    setIsProcessing(true);
    setCompanies([]);
    setIgnoredCount(0);
    setStatusText('Extracting corporate domains...');

    try {
      // 1. Parse & filter public webmail
      const rawEmails = contentToProcess.split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(e => e.includes('@'));
      const uniqueEmails = new Set<string>();
      let publicCount = 0;

      rawEmails.forEach(email => {
        const domain = email.split('@')[1]?.toLowerCase().trim();
        if (!domain) return;
        if (isPublicDomain(domain)) {
          publicCount++;
        } else {
          uniqueEmails.add(email);
        }
      });

      setIgnoredCount(publicCount);

      if (uniqueEmails.size === 0) {
        showToast(`No corporate business emails found. Ignored ${publicCount} public webmail addresses.`);
        setIsProcessing(false);
        return;
      }

      // 2. Group emails by domain
      const domainToEmailsMap = new Map<string, string[]>();
      uniqueEmails.forEach(email => {
        const domain = email.split('@')[1].toLowerCase().trim();
        if (!domainToEmailsMap.has(domain)) {
          domainToEmailsMap.set(domain, []);
        }
        domainToEmailsMap.get(domain)?.push(email);
      });

      const uniqueDomains = Array.from(domainToEmailsMap.keys());
      const totalDomains = uniqueDomains.length;

      // MODE 1: Fast Offline Keyword Classification
      if (useOfflineMode) {
        setStatusText('Instant keyword categorization...');
        const localCompanies: CompanyIntel[] = uniqueDomains.map(domain => {
          const industry = classifyIndustryOffline(domain) || 'General Business';
          const root = domain.replace(/\.[a-z]{2,}(\.[a-z]{2,})?$/i, '').replace(/^www\./, '');
          const companyName = root.charAt(0).toUpperCase() + root.slice(1);
          return {
            domain,
            companyName,
            industry,
            subCategory: `${industry} Solutions`,
            overview: `${companyName} is an active enterprise operating on domain ${domain}.`,
            businessModel: 'B2B',
            headquarters: classifyCountryOffline(domain) || 'Global',
            websiteUrl: `https://${domain}`,
            websiteStatus: 'online',
            confidenceScore: 75,
            isAiEnhanced: false,
            emails: domainToEmailsMap.get(domain) || []
          };
        });

        setCompanies(localCompanies);
        showToast(`Instant classification completed for ${localCompanies.length} companies!`);
        setIsProcessing(false);
        setStatusText('Idle');
        return;
      }

      // MODE 2: High-Accuracy Deep Web & Meta Intelligence (Batched)
      const BATCH_SIZE = 12;
      const accumulatedCompanies: CompanyIntel[] = [];

      for (let i = 0; i < totalDomains; i += BATCH_SIZE) {
        if (controlRef.current.shouldStop) break;

        while (controlRef.current.isPaused) {
          await new Promise(resolve => setTimeout(resolve, 300));
          if (controlRef.current.shouldStop) break;
        }
        if (controlRef.current.shouldStop) break;

        const batchDomains = uniqueDomains.slice(i, i + BATCH_SIZE);
        const currentDomainIndex = Math.min(i + BATCH_SIZE, totalDomains);
        setProgress({ current: currentDomainIndex, total: totalDomains });
        setStatusText(`Extracting live website & Google search intelligence for ${batchDomains.slice(0, 3).join(', ')}...`);

        try {
          const apiKey = localStorage.getItem('gemini_api_key') || '';
          const enrichedBatch = await fetchDomainIntelligence(batchDomains, apiKey);

          // Attach emails to enriched company objects
          const enrichedWithEmails: CompanyIntel[] = enrichedBatch.map(item => ({
            ...item,
            emails: domainToEmailsMap.get(item.domain) || []
          }));

          accumulatedCompanies.push(...enrichedWithEmails);
          setCompanies([...accumulatedCompanies]);
        } catch (err) {
          console.warn("Batch enrichment notice:", err);
          // Fallback batch mapping
          const fallbackBatch = batchDomains.map(d => ({
            domain: d,
            companyName: d.split('.')[0].toUpperCase(),
            industry: classifyIndustryOffline(d) || 'General Business',
            overview: `Company operating under domain ${d}.`,
            websiteStatus: 'online' as const,
            confidenceScore: 70,
            emails: domainToEmailsMap.get(d) || []
          }));
          accumulatedCompanies.push(...fallbackBatch);
          setCompanies([...accumulatedCompanies]);
        }
      }

      if (controlRef.current.shouldStop) {
        showToast("Analysis stopped by user.");
      } else {
        showToast(`Completed! Enriched ${accumulatedCompanies.length} companies with live meta & search intelligence.`);
      }

    } catch (error: any) {
      showToast("An error occurred during company analysis.");
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

  // Export to Excel (.xlsx) with 4 comprehensive sheets
  const handleExportExcel = () => {
    if (companies.length === 0) return;

    try {
      const dateStr = new Date().toISOString().split('T')[0];
      const workbook = XLSX.utils.book_new();

      // Sheet 1: Detailed Company Dossiers
      const companyData = companies.map(c => ({
        'Company Name': c.companyName,
        'Domain': c.domain,
        'Product Category': c.productCategory || c.subCategory || 'General Products & Services',
        'Primary Products / Services': (c.primaryProducts || []).join(', ') || 'N/A',
        'Primary Industry': c.industry,
        'Sub-Category / Niche': c.subCategory || 'N/A',
        'Company Overview': c.overview,
        'Business Model': c.businessModel || 'B2B',
        'Headquarters / Region': c.headquarters || 'Global',
        'Website Status': c.websiteStatus,
        'Website URL': c.websiteUrl || `https://${c.domain}`,
        'Confidence Score (%)': c.confidenceScore || 90,
        'AI Grounded': c.isAiEnhanced ? 'Yes' : 'Direct Web Meta',
        'Total Discovered Emails': c.emails.length,
        'Email Addresses': c.emails.join(', ')
      }));

      const sheet1 = XLSX.utils.json_to_sheet(companyData);
      XLSX.utils.book_append_sheet(workbook, sheet1, 'Company Intelligence');

      // Sheet 2: Emails Categorized by Product / Service Category
      const productSheetData = productGroups.map(pg => ({
        'Product / Service Category': pg.productCategory,
        'Unique Companies': pg.companies.length,
        'Total Corporate Emails': pg.emails.length,
        'Email Share (%)': `${Math.round((pg.emails.length / totalEmailsCount) * 100)}%`,
        'Companies in Category': pg.companies.map(c => c.companyName).join(', '),
        'Discovered Products Sample': Array.from(new Set(pg.companies.flatMap(c => c.primaryProducts || []))).slice(0, 8).join(', ') || 'N/A',
        'All Emails in Category': pg.emails.join(', ')
      }));
      const sheet2 = XLSX.utils.json_to_sheet(productSheetData);
      XLSX.utils.book_append_sheet(workbook, sheet2, 'Emails by Product Category');

      // Sheet 3: Industry Breakdown Summary
      const summaryData = industryGroups.map(ig => ({
        'Industry Sector': ig.industry,
        'Unique Companies': ig.companies.length,
        'Total Corporate Emails': ig.emails.length,
        'Email Share (%)': `${Math.round((ig.emails.length / totalEmailsCount) * 100)}%`
      }));
      const sheet3 = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, sheet3, 'Industry Distribution');

      // Sheet 4: Clean Master Email List
      const allEmailsList = Array.from(new Set<string>(companies.flatMap(c => c.emails))).map((email: string) => {
        const matchingComp = companies.find(c => c.emails.includes(email));
        return {
          'Email Address': email,
          'Domain': email.split('@')[1] || '',
          'Company Name': matchingComp?.companyName || '',
          'Product Category': matchingComp?.productCategory || matchingComp?.subCategory || 'General',
          'Industry': matchingComp?.industry || ''
        };
      });
      const sheet4 = XLSX.utils.json_to_sheet(allEmailsList);
      XLSX.utils.book_append_sheet(workbook, sheet4, 'All Emails Master List');

      XLSX.writeFile(workbook, `Company_Intelligence_${dateStr}.xlsx`);
      showToast("Exported Company Intelligence as Excel Workbook!");
    } catch (e) {
      console.error("Excel export error:", e);
      showToast("Failed to export Excel file.");
    }
  };

  // Export to CSV (.csv)
  const handleExportCsv = () => {
    if (companies.length === 0) return;
    const dateStr = new Date().toISOString().split('T')[0];
    const headers = [
      'Company Name',
      'Domain',
      'Product Category',
      'Primary Products',
      'Industry',
      'Sub-Category',
      'Overview',
      'Business Model',
      'Headquarters',
      'Website Status',
      'Confidence Score',
      'Total Emails',
      'Emails'
    ];

    const rows = companies.map(c => [
      `"${(c.companyName || '').replace(/"/g, '""')}"`,
      `"${c.domain}"`,
      `"${(c.productCategory || c.subCategory || '').replace(/"/g, '""')}"`,
      `"${((c.primaryProducts || []).join('; ')).replace(/"/g, '""')}"`,
      `"${(c.industry || '').replace(/"/g, '""')}"`,
      `"${(c.subCategory || '').replace(/"/g, '""')}"`,
      `"${(c.overview || '').replace(/"/g, '""')}"`,
      `"${(c.businessModel || '').replace(/"/g, '""')}"`,
      `"${(c.headquarters || '').replace(/"/g, '""')}"`,
      `"${c.websiteStatus}"`,
      `"${c.confidenceScore || 90}%"`,
      c.emails.length,
      `"${c.emails.join('; ').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `Company_Intelligence_${dateStr}.csv`);
    showToast("Exported CSV file with product categories!");
  };

  // Export all unique emails as plain text (.txt)
  const handleExportAllEmailsTxt = () => {
    const allEmails = Array.from(new Set<string>(companies.flatMap(c => c.emails)));
    if (allEmails.length === 0) return;
    const dateStr = new Date().toISOString().split('T')[0];
    const blob = new Blob([allEmails.join('\n')], { type: 'text/plain;charset=utf-8;' });
    downloadBlob(blob, `All_Corporate_Emails_${dateStr}.txt`);
    showToast(`Exported ${allEmails.length} unique emails as text file!`);
  };

  // Single Company Export (TXT or CSV)
  const handleExportSingleCompany = (company: CompanyIntel, format: 'txt' | 'csv') => {
    const safeName = company.companyName.replace(/[^a-z0-9]/gi, '_');
    if (format === 'txt') {
      const textLines = [
        `=============================================================`,
        `COMPANY: ${company.companyName.toUpperCase()} (${company.domain})`,
        `Product Category: ${company.productCategory || 'General Products & Services'}`,
        company.primaryProducts?.length ? `Primary Products: ${company.primaryProducts.join(', ')}` : '',
        `Industry: ${company.industry}${company.subCategory ? ` - ${company.subCategory}` : ''}`,
        `Overview: ${company.overview}`,
        `Business Model: ${company.businessModel || 'B2B'} | HQ: ${company.headquarters || 'Global'}`,
        `Website: ${company.websiteUrl || `https://${company.domain}`} [${company.websiteStatus}]`,
        `=============================================================`,
        `\n--- DISCOVERED EMAILS (${company.emails.length}) ---`,
        ...company.emails
      ].filter(Boolean);
      downloadBlob(new Blob([textLines.join('\n')], { type: 'text/plain;charset=utf-8;' }), `${safeName}_emails.txt`);
      showToast(`Exported emails for ${company.companyName}!`);
    } else {
      const headers = ['Company Name', 'Domain', 'Product Category', 'Primary Products', 'Industry', 'Overview', 'Email'];
      const prodStr = (company.primaryProducts || []).join('; ');
      const rows = company.emails.map(email => [
        `"${company.companyName.replace(/"/g, '""')}"`,
        `"${company.domain}"`,
        `"${(company.productCategory || '').replace(/"/g, '""')}"`,
        `"${prodStr.replace(/"/g, '""')}"`,
        `"${company.industry}"`,
        `"${company.overview.replace(/"/g, '""')}"`,
        `"${email}"`
      ].join(','));
      const csvContent = [headers.join(','), ...rows].join('\n');
      downloadBlob(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }), `${safeName}_contacts.csv`);
      showToast(`Exported CSV for ${company.companyName}!`);
    }
  };

  // Single Product Category Export (TXT or CSV)
  const handleExportSingleProduct = (group: ProductGroupIntel, format: 'txt' | 'csv') => {
    const safeName = group.productCategory.replace(/[^a-z0-9]/gi, '_').substring(0, 45);
    if (format === 'txt') {
      const lines = [
        `=============================================================`,
        `PRODUCT CATEGORY: ${group.productCategory.toUpperCase()}`,
        `Total Companies: ${group.companies.length} | Total Emails: ${group.emails.length}`,
        `Exported: ${new Date().toLocaleString()}`,
        `=============================================================\n`,
        `--- ALL EMAILS (${group.emails.length}) ---`,
        ...group.emails,
        `\n--- COMPANIES IN THIS CATEGORY (${group.companies.length}) ---`,
        ...group.companies.map(c => `• ${c.companyName} (${c.domain}) - Products: ${(c.primaryProducts || []).join(', ') || c.subCategory || 'N/A'}`)
      ];
      downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' }), `${safeName}_emails.txt`);
      showToast(`Exported ${group.emails.length} emails for ${group.productCategory}!`);
    } else {
      const headers = ['Product Category', 'Company Name', 'Domain', 'Industry', 'Primary Products', 'Email', 'Overview'];
      const rows: string[] = [];
      group.companies.forEach(c => {
        const prodStr = (c.primaryProducts || []).join('; ');
        c.emails.forEach(email => {
          rows.push([
            `"${group.productCategory.replace(/"/g, '""')}"`,
            `"${c.companyName.replace(/"/g, '""')}"`,
            `"${c.domain}"`,
            `"${c.industry}"`,
            `"${prodStr.replace(/"/g, '""')}"`,
            `"${email}"`,
            `"${c.overview.replace(/"/g, '""')}"`
          ].join(','));
        });
      });
      const csvContent = [headers.join(','), ...rows].join('\n');
      downloadBlob(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }), `${safeName}_contacts.csv`);
      showToast(`Exported contacts CSV for ${group.productCategory}!`);
    }
  };

  // Single Industry Sector Export (TXT or CSV)
  const handleExportSingleIndustry = (group: IndustryGroupIntel, format: 'txt' | 'csv') => {
    const safeName = group.industry.replace(/[^a-z0-9]/gi, '_');
    if (format === 'txt') {
      const lines = [
        `=============================================================`,
        `INDUSTRY SECTOR: ${group.industry.toUpperCase()}`,
        `Total Companies: ${group.companies.length} | Total Emails: ${group.emails.length}`,
        `Exported: ${new Date().toLocaleString()}`,
        `=============================================================\n`,
        `--- ALL EMAILS (${group.emails.length}) ---`,
        ...group.emails,
        `\n--- COMPANIES IN THIS SECTOR ---`,
        ...group.companies.map(c => `• ${c.companyName} (${c.domain}) - ${c.productCategory || c.subCategory || ''}`)
      ];
      downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' }), `${safeName}_emails.txt`);
      showToast(`Exported emails for ${group.industry}!`);
    } else {
      const headers = ['Industry', 'Company Name', 'Domain', 'Product Category', 'Primary Products', 'Email'];
      const rows: string[] = [];
      group.companies.forEach(c => {
        const prodStr = (c.primaryProducts || []).join('; ');
        c.emails.forEach(email => {
          rows.push([
            `"${group.industry}"`,
            `"${c.companyName.replace(/"/g, '""')}"`,
            `"${c.domain}"`,
            `"${(c.productCategory || '').replace(/"/g, '""')}"`,
            `"${prodStr.replace(/"/g, '""')}"`,
            `"${email}"`
          ].join(','));
        });
      });
      const csvContent = [headers.join(','), ...rows].join('\n');
      downloadBlob(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }), `${safeName}_industry_contacts.csv`);
      showToast(`Exported CSV for ${group.industry}!`);
    }
  };

  // Comprehensive Export to ZIP (.zip) with Product Categories & Single Companies
  const handleExportZip = async () => {
    if (companies.length === 0) return;

    try {
      showToast("Packaging ZIP archive with product categories...");
      const zip = new JSZip();
      const dateStr = new Date().toISOString().split('T')[0];
      const folderName = `Email_Intelligence_By_Product_${dateStr}`;
      const folder = zip.folder(folderName);

      if (!folder) {
        showToast("Failed to create zip folder.");
        return;
      }

      // 1. PRODUCT CATEGORIES DIRECTORY (Individual files per product category)
      const prodFolder = folder.folder("1_Emails_By_Product_Category");
      if (prodFolder) {
        productGroups.forEach(group => {
          const safeName = group.productCategory.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
          
          // Pure clean emails list file
          const emailList = group.emails.join('\n');
          prodFolder.file(`${safeName}_emails.txt`, emailList);

          // Detailed contacts CSV file for category
          const csvHeaders = ['Product Category', 'Company Name', 'Domain', 'Industry', 'Primary Products', 'Email'];
          const csvRows: string[] = [];
          group.companies.forEach(c => {
            const prods = (c.primaryProducts || []).join('; ');
            c.emails.forEach(email => {
              csvRows.push([
                `"${group.productCategory.replace(/"/g, '""')}"`,
                `"${c.companyName.replace(/"/g, '""')}"`,
                `"${c.domain}"`,
                `"${c.industry}"`,
                `"${prods.replace(/"/g, '""')}"`,
                `"${email}"`
              ].join(','));
            });
          });
          prodFolder.file(`${safeName}_contacts.csv`, [csvHeaders.join(','), ...csvRows].join('\n'));
        });
      }

      // 2. SINGLE COMPANIES DIRECTORY (Individual file per company)
      const compFolder = folder.folder("2_Emails_By_Company");
      if (compFolder) {
        companies.forEach(c => {
          const safeComp = c.companyName.replace(/[^a-z0-9]/gi, '_').substring(0, 45);
          const cLines = [
            `# Company: ${c.companyName} (${c.domain})`,
            `# Product Category: ${c.productCategory || 'General'}`,
            c.primaryProducts?.length ? `# Primary Products: ${c.primaryProducts.join(', ')}` : '',
            `# Industry: ${c.industry}`,
            `# Total Emails: ${c.emails.length}`,
            `# ----------------------------------------------------`,
            ...c.emails
          ].filter(Boolean);
          compFolder.file(`${safeComp}_emails.txt`, cLines.join('\n'));
        });
      }

      // 3. INDUSTRY SECTORS DIRECTORY
      const indFolder = folder.folder("3_Emails_By_Industry_Sector");
      if (indFolder) {
        industryGroups.forEach(group => {
          const safeIndustry = group.industry.replace(/[^a-z0-9]/gi, '_');
          const lines: string[] = [
            `# INDUSTRY SECTOR: ${group.industry.toUpperCase()}`,
            `# Total Companies: ${group.companies.length} | Total Emails: ${group.emails.length}`,
            ...group.emails
          ];
          indFolder.file(`${safeIndustry}_emails.txt`, lines.join('\n'));
        });
      }

      // 4. ROOT MASTER FILES
      const allUniqueEmails = Array.from(new Set<string>(companies.flatMap(c => c.emails)));
      folder.file(`ALL_EMAILS_CLEAN_LIST.txt`, allUniqueEmails.join('\n'));

      // Root CSV
      const masterCsvHeaders = [
        'Company Name',
        'Domain',
        'Product Category',
        'Primary Products',
        'Industry',
        'Sub-Category',
        'Overview',
        'Business Model',
        'Headquarters',
        'Website Status',
        'Confidence Score',
        'Total Emails',
        'Emails'
      ];
      const masterCsvRows = companies.map(c => [
        `"${(c.companyName || '').replace(/"/g, '""')}"`,
        `"${c.domain}"`,
        `"${(c.productCategory || c.subCategory || '').replace(/"/g, '""')}"`,
        `"${((c.primaryProducts || []).join('; ')).replace(/"/g, '""')}"`,
        `"${(c.industry || '').replace(/"/g, '""')}"`,
        `"${(c.subCategory || '').replace(/"/g, '""')}"`,
        `"${(c.overview || '').replace(/"/g, '""')}"`,
        `"${(c.businessModel || '').replace(/"/g, '""')}"`,
        `"${(c.headquarters || '').replace(/"/g, '""')}"`,
        `"${c.websiteStatus}"`,
        `"${c.confidenceScore || 90}%"`,
        c.emails.length,
        `"${c.emails.join('; ').replace(/"/g, '""')}"`
      ]);
      folder.file(`ALL_COMPANIES_INTELLIGENCE.csv`, [masterCsvHeaders.join(','), ...masterCsvRows.map(r => r.join(','))].join('\n'));

      const content = await zip.generateAsync({ type: "blob" });
      downloadBlob(content, `${folderName}.zip`);
      showToast("Downloaded all emails organized by product category as ZIP!");
    } catch (e) {
      console.error("Zip generation failed", e);
      showToast("Failed to generate ZIP file.");
    }
  };

  // Sector Icon Helper
  const getIndustryIcon = (industry: string) => {
    const iconClass = "w-4 h-4";
    switch (industry) {
      case 'Technology':
      case 'Manufacturing':
        return <Cog6ToothIcon className={`${iconClass} text-blue-400`} />;
      case 'Healthcare':
      case 'Education':
      case 'Energy':
        return <LightbulbIcon className={`${iconClass} text-yellow-400`} />;
      case 'Finance':
      case 'Legal':
        return <ShieldCheckIcon className={`${iconClass} text-emerald-400`} />;
      case 'E-commerce':
        return <ListBulletIcon className={`${iconClass} text-pink-400`} />;
      case 'Real Estate':
      case 'Construction':
        return <BuildingOfficeIcon className={`${iconClass} text-orange-400`} />;
      case 'Travel':
      case 'Logistics':
        return <GlobeAltIcon className={`${iconClass} text-cyan-400`} />;
      case 'Marketing':
      case 'Consulting':
        return <BriefcaseIcon className={`${iconClass} text-purple-400`} />;
      case 'Media':
        return <SparklesIcon className={`${iconClass} text-indigo-400`} />;
      case 'Agriculture':
        return <FunnelIcon className={`${iconClass} text-green-400`} />;
      default:
        return <BriefcaseIcon className={`${iconClass} text-purple-400`} />;
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
      {/* LEFT PANEL: INPUT & CONFIGURATION */}
      <div className="lg:col-span-4 flex flex-col h-full space-y-4">
        <div 
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`bg-gray-800/50 backdrop-blur-sm border rounded-xl shadow-2xl p-6 flex-grow flex flex-col transition-colors ${
            isDragging ? 'border-purple-400 bg-purple-950/20' : 'border-gray-700'
          }`}
        >
          <div className="mb-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <BriefcaseIcon className="w-6 h-6 text-purple-400" />
                Industry & Company Analyzer
              </h2>
            </div>
            
            <p className="text-gray-400 text-xs mt-1.5 leading-relaxed">
              Extracts email domains, crawls website meta tags, queries search engine snippets, and delivers high-accuracy company dossiers.
            </p>

            {/* HIGH ACCURACY INTEL TOGGLE */}
            <div className="mt-4 p-3 bg-gray-900/60 border border-gray-700/60 rounded-xl space-y-2">
              <ToggleSwitch
                label="Instant Domain Keywords"
                enabled={useOfflineMode}
                onChange={setUseOfflineMode}
                disabled={isProcessing}
              />
              <p className="text-[11px] text-gray-400 leading-snug">
                {useOfflineMode
                  ? "⚡ Instant local mode (parses keywords inside domain string). Ultra-fast for large lists."
                  : "🌐 Deep Web & Meta Intelligence enabled: Fetches live page title, meta description, and search engine index for pinpoint accuracy."}
              </p>
            </div>
          </div>

          {/* TEXTAREA INPUT */}
          <div className="relative flex-grow flex flex-col mb-4">
            <textarea
              value={inputText}
              onChange={handleTextChange}
              placeholder="Paste email addresses or target list here...&#10;&#10;e.g.&#10;sarah.jenkins@stripe.com&#10;contact@siemens.de&#10;alex@datadoghq.com&#10;john.doe@gmail.com (automatically filtered out)"
              className={`flex-grow w-full p-4 bg-gray-900/60 border border-gray-600/80 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none text-xs font-mono text-gray-200 custom-scrollbar ${
                largeFileMode ? 'opacity-70' : ''
              }`}
              disabled={isProcessing || largeFileMode}
              readOnly={largeFileMode}
            />
            {isDragging && (
              <div className="absolute inset-0 bg-purple-950/90 border-2 border-dashed border-purple-400 rounded-xl flex flex-col items-center justify-center text-purple-200 pointer-events-none">
                <DocumentArrowUpIcon className="w-10 h-10 mb-2 animate-bounce" />
                <span className="text-sm font-bold">Drop Excel, CSV, or TXT file here</span>
              </div>
            )}
          </div>

          {/* ACTION BUTTONS */}
          <div className="flex gap-2.5">
            {isProcessing ? (
              <>
                <button
                  onClick={handlePauseToggle}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex-1 shadow-lg flex items-center justify-center border ${
                    isPaused
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500'
                      : 'bg-amber-600 hover:bg-amber-700 text-white border-amber-500'
                  }`}
                >
                  {isPaused ? <><PlayIcon className="w-4 h-4 mr-1.5" /> Resume</> : <><PauseIcon className="w-4 h-4 mr-1.5" /> Pause</>}
                </button>
                <button
                  onClick={handleStop}
                  className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all flex-1 shadow-lg flex items-center justify-center border border-red-500"
                >
                  <StopIcon className="w-4 h-4 mr-1.5" /> Stop
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl text-xs font-semibold transition-colors flex items-center justify-center flex-1 border border-gray-600"
                  title="Upload Excel, CSV, or TXT"
                >
                  <DocumentArrowUpIcon className="w-4 h-4 mr-1.5 text-purple-300" /> Upload File
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
                  className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-all flex-1 shadow-lg shadow-purple-900/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  <SparklesIcon className="w-4 h-4 text-purple-200" />
                  Analyze List
                </button>
              </>
            )}
          </div>

          {/* PUBLIC WEBMAIL IGNORED NOTICE */}
          {ignoredCount > 0 && !isProcessing && (
            <div className="mt-3 p-2 bg-amber-950/30 border border-amber-700/40 rounded-lg text-[11px] text-amber-300 text-center">
              Filtered out {ignoredCount} personal webmail addresses (Gmail, Yahoo, Hotmail, etc.)
            </div>
          )}

          {/* PROGRESS BAR */}
          {isProcessing && progress && (
            <div className={`mt-3 bg-gray-900/80 rounded-xl p-3 border border-gray-700/80 transition-opacity ${isPaused ? 'opacity-70' : 'opacity-100'}`}>
              <div className="flex justify-between text-xs text-purple-300 mb-1.5 font-medium">
                <span className="truncate max-w-[200px]">{isPaused ? 'Process Paused' : statusText}</span>
                <span>{Math.round((progress.current / progress.total) * 100)}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${isPaused ? 'bg-amber-500' : 'bg-gradient-to-r from-purple-500 to-indigo-500'}`}
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                ></div>
              </div>
              <div className="text-[10px] text-gray-400 mt-1.5 text-right font-mono">
                {progress.current} / {progress.total} domains
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: COMPANY & INDUSTRY INTELLIGENCE RESULTS */}
      <div className="lg:col-span-8 flex flex-col h-full">
        <div className="bg-gray-800/40 backdrop-blur-md border border-gray-700 rounded-xl shadow-2xl flex flex-col h-[82vh] overflow-hidden">
          
          {/* HEADER BAR */}
          <div className="p-4 border-b border-gray-700/60 bg-gray-900/50 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-tight">Intelligence Directory</h2>
                {companies.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-950 border border-purple-700 text-purple-300">
                    {companies.length} Companies
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {companies.length > 0
                  ? `${totalEmailsCount} business emails organized into ${productGroups.length} product categories & ${industryGroups.length} sectors`
                  : "Discover real company profiles, search snippets & meta tags"}
              </p>
            </div>

            {/* VIEW MODE & EXPORTS */}
            {companies.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {/* View Switcher: Companies | Products | Sectors */}
                <div className="flex bg-gray-800 p-0.5 rounded-lg border border-gray-700 text-xs">
                  <button
                    onClick={() => setViewMode('companies')}
                    className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${
                      viewMode === 'companies'
                        ? 'bg-purple-600 text-white shadow'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <span>Companies</span>
                    <span className="text-[10px] opacity-80 font-mono">({companies.length})</span>
                  </button>
                  <button
                    onClick={() => setViewMode('products')}
                    className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${
                      viewMode === 'products'
                        ? 'bg-purple-600 text-white shadow'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <TagIcon className="w-3.5 h-3.5 text-pink-300" />
                    <span>Products</span>
                    <span className="text-[10px] opacity-80 font-mono">({productGroups.length})</span>
                  </button>
                  <button
                    onClick={() => setViewMode('industries')}
                    className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${
                      viewMode === 'industries'
                        ? 'bg-purple-600 text-white shadow'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <span>Sectors</span>
                    <span className="text-[10px] opacity-80 font-mono">({industryGroups.length})</span>
                  </button>
                </div>

                {/* Export Excel (Multi-sheet with Product Categories) */}
                <button
                  onClick={handleExportExcel}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition shadow"
                  title="Export 4-sheet Excel workbook with dossiers, product categories, and email catalog"
                >
                  <DocumentArrowUpIcon className="w-3.5 h-3.5" /> Excel (.xlsx)
                </button>

                {/* Export CSV */}
                <button
                  onClick={handleExportCsv}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition border border-gray-600"
                  title="Export CSV with product categories and primary products"
                >
                  <ArrowDownTrayIcon className="w-3.5 h-3.5" /> CSV
                </button>

                {/* Export All Emails Plain Text */}
                <button
                  onClick={handleExportAllEmailsTxt}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition border border-gray-600"
                  title="Export all unique emails in plain text"
                >
                  <ClipboardIcon className="w-3.5 h-3.5" /> TXT
                </button>

                {/* Export ZIP by Product & Sector */}
                <button
                  onClick={handleExportZip}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-700 hover:bg-indigo-600 text-white transition border border-indigo-500 shadow"
                  title="Download packaged ZIP categorized into product categories, single companies, and sectors"
                >
                  <FolderOpenIcon className="w-3.5 h-3.5" /> ZIP Archive
                </button>
              </div>
            )}
          </div>

          {/* FILTERING & SEARCH BAR */}
          {companies.length > 0 && (
            <div className="p-3 bg-gray-900/30 border-b border-gray-700/40 flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-3">
                {/* Search Bar */}
                <div className="relative flex-1 min-w-[200px]">
                  <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search company, domain, product category, product name, or email..."
                    className="w-full pl-9 pr-3 py-1.5 bg-gray-800/80 border border-gray-700 rounded-lg text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>

                {/* Quick Filters for Companies View */}
                {viewMode === 'companies' && (
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedProductCategory}
                      onChange={(e) => setSelectedProductCategory(e.target.value)}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-purple-300 font-medium focus:ring-1 focus:ring-purple-500 focus:outline-none"
                    >
                      <option value="All">All Product Categories ({productGroups.length})</option>
                      {productGroups.map(pg => (
                        <option key={pg.productCategory} value={pg.productCategory}>
                          {pg.productCategory} ({pg.companies.length})
                        </option>
                      ))}
                    </select>

                    <select
                      value={selectedIndustry}
                      onChange={(e) => setSelectedIndustry(e.target.value)}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:ring-1 focus:ring-purple-500 focus:outline-none"
                    >
                      <option value="All">All Industry Sectors ({industryGroups.length})</option>
                      {industryGroups.map(ig => (
                        <option key={ig.industry} value={ig.industry}>
                          {ig.industry} ({ig.companies.length})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Quick Pills for Products View */}
              {viewMode === 'products' && (
                <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar max-w-full pb-1">
                  <span className="text-[11px] text-gray-400 font-medium shrink-0 mr-1 flex items-center gap-1">
                    <TagIcon className="w-3 h-3 text-pink-400" /> Products:
                  </span>
                  {availableProductCategories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedProductCategory(cat)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${
                        selectedProductCategory === cat
                          ? 'bg-pink-600 text-white shadow'
                          : 'bg-gray-800/70 text-gray-400 hover:text-gray-200 hover:bg-gray-700/60'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}

              {/* Quick Pills for Sectors View */}
              {viewMode === 'industries' && (
                <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar max-w-full pb-1">
                  <span className="text-[11px] text-gray-400 font-medium shrink-0 mr-1 flex items-center gap-1">
                    <BriefcaseIcon className="w-3 h-3 text-purple-400" /> Sectors:
                  </span>
                  {availableIndustries.map(ind => (
                    <button
                      key={ind}
                      onClick={() => setSelectedIndustry(ind)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${
                        selectedIndustry === ind
                          ? 'bg-purple-600 text-white shadow'
                          : 'bg-gray-800/70 text-gray-400 hover:text-gray-200 hover:bg-gray-700/60'
                      }`}
                    >
                      {ind}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* MAIN RESULTS CONTAINER */}
          <div className="flex-grow overflow-y-auto p-4 custom-scrollbar bg-gray-900/20">
            {companies.length === 0 && !isProcessing ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 opacity-60 text-center p-6">
                <BriefcaseIcon className="w-14 h-14 mb-3 text-purple-400/50 animate-pulse" />
                <h3 className="text-base font-semibold text-gray-300">Ready to Analyze Corporate Domains</h3>
                <p className="text-xs text-gray-400 max-w-md mt-1 leading-relaxed">
                  Paste business email addresses or upload an Excel/CSV file to extract company names, live website meta tags, Google/search snippets, product categorization, and sector classification.
                </p>
              </div>
            ) : viewMode === 'companies' ? (
              /* --- VIEW 1: COMPANY INTELLIGENCE CARDS --- */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredCompanies.map((comp) => (
                  <div
                    key={comp.domain}
                    className="bg-gray-800/60 border border-gray-700/70 hover:border-purple-500/50 rounded-xl p-4 transition-all flex flex-col justify-between shadow-lg hover:shadow-purple-950/10 group"
                  >
                    <div>
                      {/* CARD TOP ROW: FAVICON + NAME + CONFIDENCE */}
                      <div className="flex items-start justify-between gap-3 mb-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-gray-900 border border-gray-700 flex items-center justify-center p-1 shrink-0">
                            <img
                              src={`https://www.google.com/s2/favicons?domain=${comp.domain}&sz=64`}
                              alt={comp.companyName}
                              className="w-5 h-5 object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-white text-sm truncate tracking-tight group-hover:text-purple-300 transition">
                              {comp.companyName}
                            </h3>
                            <a
                              href={comp.websiteUrl || `https://${comp.domain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-purple-400 hover:text-purple-300 font-mono truncate flex items-center gap-1 mt-0.5"
                            >
                              <span>{comp.domain}</span>
                              <LinkIcon className="w-3 h-3 shrink-0 opacity-60" />
                            </a>
                          </div>
                        </div>

                        {/* CONFIDENCE PILL */}
                        <span className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/70 border border-emerald-700/50 text-emerald-300">
                          <ShieldCheckIcon className="w-3 h-3 text-emerald-400" />
                          {comp.confidenceScore || 95}%
                        </span>
                      </div>

                      {/* BADGES ROW */}
                      <div className="flex flex-wrap items-center gap-1.5 mb-2">
                        {/* Product Category badge */}
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-pink-950/60 border border-pink-800/40 text-pink-300">
                          <TagIcon className="w-3 h-3 text-pink-400" />
                          {comp.productCategory || comp.subCategory || 'General Products & Services'}
                        </span>

                        {/* Industry Sector badge */}
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-950/60 border border-purple-800/40 text-purple-300">
                          {getIndustryIcon(comp.industry)}
                          {comp.industry}
                        </span>

                        {comp.businessModel && (
                          <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-gray-700/60 text-gray-300">
                            {comp.businessModel}
                          </span>
                        )}
                        {comp.headquarters && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-gray-700/60 text-gray-300">
                            <GlobeAltIcon className="w-3 h-3 text-cyan-400" />
                            {comp.headquarters}
                          </span>
                        )}
                      </div>

                      {/* PRIMARY PRODUCTS CHIPS */}
                      {comp.primaryProducts && comp.primaryProducts.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2.5">
                          {comp.primaryProducts.slice(0, 4).map((prod, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-900 border border-gray-700 text-gray-300"
                            >
                              {prod}
                            </span>
                          ))}
                          {comp.primaryProducts.length > 4 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] text-gray-500 font-medium">
                              +{comp.primaryProducts.length - 4} more
                            </span>
                          )}
                        </div>
                      )}

                      {/* OVERVIEW / WHAT THEY DO */}
                      <p className="text-gray-300 text-xs line-clamp-2 leading-relaxed mb-3">
                        {comp.overview}
                      </p>

                      {/* SEARCH / META / WEBSITE SNIPPET HIGHLIGHT */}
                      {(comp.searchSnippet || comp.websiteSnippet || comp.metaDescription) && (
                        <div className="bg-gray-900/60 border border-gray-700/50 rounded-lg p-2 text-[11px] text-gray-400 font-sans mb-3 line-clamp-2">
                          <span className="text-purple-400 font-semibold mr-1">
                            {comp.searchSnippet ? 'Google Snippet:' : comp.websiteSnippet ? 'Website Body:' : 'Meta Description:'}
                          </span>
                          {comp.searchSnippet || comp.websiteSnippet || comp.metaDescription}
                        </div>
                      )}
                    </div>

                    {/* CARD FOOTER */}
                    <div className="pt-2.5 border-t border-gray-700/50 flex flex-wrap items-center justify-between gap-2 text-xs">
                      {/* Expandable Emails Button */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpandedEmailsDomain(expandedEmailsDomain === comp.domain ? null : comp.domain)}
                          className="text-gray-400 hover:text-white flex items-center gap-1 text-[11px]"
                        >
                          <span className="font-semibold text-purple-300">{comp.emails.length}</span> emails
                          <span className="text-[10px]">{expandedEmailsDomain === comp.domain ? '▲' : '▼'}</span>
                        </button>

                        {/* Copy emails button */}
                        <button
                          onClick={() => handleCopyEmails(comp.emails, comp.domain, comp.companyName)}
                          className="text-gray-400 hover:text-purple-300 flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded hover:bg-gray-700/50 transition"
                          title="Copy all emails for this company"
                        >
                          {copiedId === comp.domain ? (
                            <>
                              <CheckIcon className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <ClipboardIcon className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>

                        {/* Single Export Dropdown / Buttons */}
                        <button
                          onClick={() => handleExportSingleCompany(comp, 'txt')}
                          className="text-gray-400 hover:text-gray-200 text-[11px] px-1.5 py-0.5 rounded hover:bg-gray-700/50 transition flex items-center gap-0.5"
                          title="Export single company emails as TXT"
                        >
                          <ArrowDownTrayIcon className="w-3 h-3" />
                          TXT
                        </button>
                      </div>

                      {/* Actions: Google External + Re-query + View Full Dossier */}
                      <div className="flex items-center gap-1.5">
                        <a
                          href={`https://www.google.com/search?q=${encodeURIComponent(comp.companyName + ' ' + comp.domain)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg text-xs font-medium transition flex items-center gap-1 border border-gray-700"
                          title="Verify directly on Google Search"
                        >
                          Google
                          <LinkIcon className="w-3 h-3 opacity-60" />
                        </a>

                        <button
                          onClick={() => handleRequeryCompany(comp)}
                          disabled={refreshingDomain === comp.domain}
                          className="px-2 py-1 bg-gray-800 hover:bg-purple-900/50 text-gray-300 hover:text-purple-300 rounded-lg text-xs font-medium transition flex items-center gap-1 border border-gray-700 disabled:opacity-50"
                          title="Re-scrape live website and Google search grounding"
                        >
                          {refreshingDomain === comp.domain ? (
                            <ArrowPathIcon className="w-3.5 h-3.5 animate-spin text-purple-400" />
                          ) : (
                            <ArrowPathIcon className="w-3.5 h-3.5" />
                          )}
                          Re-check
                        </button>

                        <button
                          onClick={() => setSelectedCompanyForModal(comp)}
                          className="px-2.5 py-1 bg-gray-700 hover:bg-purple-600 text-gray-200 hover:text-white rounded-lg text-xs font-medium transition flex items-center gap-1"
                        >
                          View Dossier
                        </button>
                      </div>
                    </div>

                    {/* EXPANDED EMAILS PREVIEW */}
                    {expandedEmailsDomain === comp.domain && (
                      <div className="mt-2.5 p-2 bg-gray-950/80 rounded-lg border border-gray-700 max-h-28 overflow-y-auto custom-scrollbar space-y-1">
                        {comp.emails.map((em, idx) => (
                          <div key={`${em}-${idx}`} className="text-[11px] font-mono text-gray-300 truncate">
                            {em}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : viewMode === 'products' ? (
              /* --- VIEW 2: PRODUCT & SERVICE CATEGORY GROUPS --- */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredProductGroups.map((group) => {
                  const uniqueProductsSample = Array.from(
                    new Set(group.companies.flatMap(c => c.primaryProducts || []))
                  ).slice(0, 6);

                  return (
                    <div
                      key={group.productCategory}
                      className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 hover:border-pink-500/50 transition-all flex flex-col justify-between"
                    >
                      <div>
                        {/* CATEGORY HEADER & SINGLE EXPORT BUTTONS */}
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2.5">
                            <div className="bg-pink-950/70 border border-pink-800/50 p-2 rounded-lg text-pink-300">
                              <TagIcon className="w-5 h-5" />
                            </div>
                            <div>
                              <h3 className="font-bold text-white text-sm tracking-tight">{group.productCategory}</h3>
                              <span className="text-xs text-gray-400">
                                {group.companies.length} {group.companies.length === 1 ? 'company' : 'companies'} •{' '}
                                <span className="text-pink-300 font-semibold">{group.emails.length}</span> emails
                              </span>
                            </div>
                          </div>

                          {/* Quick single export buttons */}
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleCopyEmails(group.emails, `prod-${group.productCategory}`, group.productCategory)}
                              className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium transition flex items-center gap-1"
                              title="Copy all emails in this product category"
                            >
                              {copiedId === `prod-${group.productCategory}` ? (
                                <>
                                  <CheckIcon className="w-3.5 h-3.5 text-emerald-400" />
                                  <span className="text-emerald-400">Copied</span>
                                </>
                              ) : (
                                <>
                                  <ClipboardIcon className="w-3.5 h-3.5" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>

                            <button
                              onClick={() => handleExportSingleProduct(group, 'txt')}
                              className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium transition flex items-center gap-1"
                              title="Export emails in this product category as TXT"
                            >
                              <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                              <span>TXT</span>
                            </button>

                            <button
                              onClick={() => handleExportSingleProduct(group, 'csv')}
                              className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium transition flex items-center gap-1"
                              title="Export contacts in this product category as CSV"
                            >
                              <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                              <span>CSV</span>
                            </button>
                          </div>
                        </div>

                        {/* DISCOVERED PRIMARY PRODUCTS SAMPLE */}
                        {uniqueProductsSample.length > 0 && (
                          <div className="mb-3">
                            <div className="text-[11px] font-medium text-gray-400 mb-1">Key Products & Offerings:</div>
                            <div className="flex flex-wrap gap-1">
                              {uniqueProductsSample.map((p, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-900 border border-gray-700/80 text-gray-300"
                                >
                                  {p}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* COMPANIES LIST IN THIS PRODUCT CATEGORY */}
                        <div className="space-y-1.5 mb-3 max-h-36 overflow-y-auto custom-scrollbar pr-1">
                          {group.companies.map(c => (
                            <div
                              key={c.domain}
                              onClick={() => setSelectedCompanyForModal(c)}
                              className="flex items-center justify-between p-1.5 bg-gray-900/40 hover:bg-gray-900/80 rounded-lg cursor-pointer border border-transparent hover:border-pink-500/30 transition text-xs"
                            >
                              <div className="flex items-center gap-2 truncate">
                                <span className="font-medium text-gray-200 truncate">{c.companyName}</span>
                                <span className="text-[10px] text-gray-500 font-mono">({c.domain})</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                <span className="text-[10px] text-gray-400">
                                  {c.industry}
                                </span>
                                <span className="text-[10px] text-pink-300 font-mono">
                                  {c.emails.length} {c.emails.length === 1 ? 'email' : 'emails'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* EMAILS PREVIEW BOX */}
                      <div className="bg-gray-900/60 rounded-lg p-2 max-h-24 overflow-y-auto custom-scrollbar">
                        {group.emails.slice(0, 10).map((email, idx) => (
                          <div key={`${email}-${idx}`} className="text-xs text-gray-300 font-mono py-0.5 truncate border-b border-gray-800 last:border-0">
                            {email}
                          </div>
                        ))}
                        {group.emails.length > 10 && (
                          <div className="text-[10px] text-gray-500 text-center pt-1 font-mono">
                            + {group.emails.length - 10} more emails in this product category
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* --- VIEW 3: INDUSTRY SECTOR GROUPS --- */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredIndustryGroups.map((group) => (
                  <div
                    key={group.industry}
                    className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 hover:border-gray-600 transition-colors flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex justify-between items-start gap-2 mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="bg-gray-900/70 p-2 rounded-lg">
                            {getIndustryIcon(group.industry)}
                          </div>
                          <div>
                            <h3 className="font-bold text-white text-sm">{group.industry}</h3>
                            <span className="text-xs text-gray-400">
                              {group.companies.length} companies •{' '}
                              <span className="text-purple-300 font-semibold">{group.emails.length}</span> emails
                            </span>
                          </div>
                        </div>

                        {/* Sector Quick Export actions */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleCopyEmails(group.emails, `sec-${group.industry}`, group.industry)}
                            className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium transition flex items-center gap-1"
                            title="Copy all emails in this sector"
                          >
                            {copiedId === `sec-${group.industry}` ? (
                              <>
                                <CheckIcon className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-emerald-400">Copied</span>
                              </>
                            ) : (
                              <>
                                <ClipboardIcon className="w-3.5 h-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => handleExportSingleIndustry(group, 'txt')}
                            className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium transition flex items-center gap-1"
                            title="Export sector emails as TXT"
                          >
                            <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                            <span>TXT</span>
                          </button>

                          <button
                            onClick={() => handleExportSingleIndustry(group, 'csv')}
                            className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium transition flex items-center gap-1"
                            title="Export sector contacts as CSV"
                          >
                            <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                            <span>CSV</span>
                          </button>
                        </div>
                      </div>

                      {/* COMPANIES LIST IN THIS SECTOR */}
                      <div className="space-y-1.5 mb-3 max-h-36 overflow-y-auto custom-scrollbar pr-1">
                        {group.companies.map(c => (
                          <div
                            key={c.domain}
                            onClick={() => setSelectedCompanyForModal(c)}
                            className="flex items-center justify-between p-1.5 bg-gray-900/40 hover:bg-gray-900/80 rounded-lg cursor-pointer border border-transparent hover:border-purple-500/30 transition text-xs"
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span className="font-medium text-gray-200 truncate">{c.companyName}</span>
                              <span className="text-[10px] text-gray-500 font-mono">({c.domain})</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              {c.productCategory && (
                                <span className="text-[10px] text-pink-300 font-medium truncate max-w-[120px]">
                                  {c.productCategory}
                                </span>
                              )}
                              <span className="text-[10px] text-purple-300 font-mono">
                                {c.emails.length} {c.emails.length === 1 ? 'email' : 'emails'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* EMAILS LIST FOR SECTOR */}
                    <div className="bg-gray-900/60 rounded-lg p-2 max-h-24 overflow-y-auto custom-scrollbar">
                      {group.emails.slice(0, 10).map((email, idx) => (
                        <div key={`${email}-${idx}`} className="text-xs text-gray-300 font-mono py-0.5 truncate border-b border-gray-800 last:border-0">
                          {email}
                        </div>
                      ))}
                      {group.emails.length > 10 && (
                        <div className="text-[10px] text-gray-500 text-center pt-1 font-mono">
                          + {group.emails.length - 10} more emails in this sector
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* DETAILED COMPANY DOSSIER MODAL */}
      <CompanyDossierModal
        company={selectedCompanyForModal}
        onClose={() => setSelectedCompanyForModal(null)}
        showToast={showToast}
      />
    </div>
  );
};

export default EmailAnalyzer;
