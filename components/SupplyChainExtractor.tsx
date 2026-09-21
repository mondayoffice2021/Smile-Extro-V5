import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  researchSupplyChain, 
  researchDistributorsForCompany, 
  generateCeoEmailPattern, 
  researchSingleCompanyExecutive,
  SupplyChainContact 
} from '../services/researchService';
import MagnifyingGlassIcon from './icons/MagnifyingGlassIcon';
import BuildingOfficeIcon from './icons/BuildingOfficeIcon';
import GlobeAltIcon from './icons/GlobeAltIcon';
import ArrowPathIcon from './icons/ArrowPathIcon';
import ClipboardIcon from './icons/ClipboardIcon';
import LinkIcon from './icons/LinkIcon';
import ShieldCheckIcon from './icons/ShieldCheckIcon';
import ArrowsRightLeftIcon from './icons/ArrowsRightLeftIcon';
import XCircleIcon from './icons/XCircleIcon';
import SparklesIcon from './icons/SparklesIcon';
import PlayIcon from './icons/PlayIcon';
import PauseIcon from './icons/PauseIcon';
import StopIcon from './icons/StopIcon';
import DocumentArrowUpIcon from './icons/DocumentArrowUpIcon';
import CheckIcon from './icons/CheckIcon';
import FunnelIcon from './icons/FunnelIcon';
import { useActiveWakeLock } from '../hooks/useWakeLock';

interface SupplyChainExtractorProps {
  showToast: (msg: string) => void;
}

const SupplyChainExtractor: React.FC<SupplyChainExtractorProps> = ({ showToast }) => {
  // Single Search State
  const [query, setQuery] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('All');
  const [results, setResults] = useState<SupplyChainContact[]>([]);
  const [distributorsMap, setDistributorsMap] = useState<Record<string, SupplyChainContact[]>>({});
  const [loading, setLoading] = useState(false);
  const [researchingDistributors, setResearchingDistributors] = useState<string | null>(null);
  const [generatingPatternFor, setGeneratingPatternFor] = useState<string | null>(null);
  const [expandedManufacturers, setExpandedManufacturers] = useState<Set<string>>(new Set());

  // Batch states
  const [activeSubTab, setActiveSubTab] = useState<'single' | 'batch'>('single');
  const [batchInput, setBatchInput] = useState('');
  const [batchInputMode, setBatchInputMode] = useState<'paste' | 'upload'>('paste');
  const [batchResults, setBatchResults] = useState<SupplyChainContact[]>([]);
  const [batchLoadingIndex, setBatchLoadingIndex] = useState<number>(-1);
  const [batchStatus, setBatchStatus] = useState<'idle' | 'running' | 'paused' | 'stopped' | 'completed'>('idle');

  // Keep screen awake while researching supply chain contacts
  const isWorking = loading || batchStatus === 'running' || Boolean(researchingDistributors);
  useActiveWakeLock(isWorking, 'Supply Chain: Researching Contacts');

  const batchFileRef = useRef<HTMLInputElement>(null);
  const stopBatchRef = useRef<boolean>(false);

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setBatchInput(prev => {
          const trimmedText = text.trim();
          if (!prev) return trimmedText;
          return prev + '\n' + trimmedText;
        });
        showToast("Successfully pasted content from clipboard!");
      } else {
        showToast("Clipboard is empty.");
      }
    } catch (err) {
      console.warn("Clipboard read permission denied/failed", err);
      showToast("Could not access clipboard automatically. Please paste (Ctrl+V or ⌘+V) directly into the box.");
    }
  };

  const handleLoadSampleLeads = () => {
    const sampleLeads = [
      "tesla.com",
      "apple.com",
      "nestle.com",
      "microsoft.com"
    ];
    setBatchInput(sampleLeads.join('\n'));
    showToast("Loaded sample lead domains!");
  };

  const handleCleanAndExtractDomains = () => {
    if (!batchInput.trim()) {
      showToast("Please paste or load some leads first to clean.");
      return;
    }

    // Split by newlines, commas, semicolons, tabs, pipes or spaces to extract raw chunks
    const rawTokens = batchInput.split(/[\r\n,;\t|]+/);
    const uniqueDomains = new Set<string>();

    rawTokens.forEach(token => {
      let item = token.trim();
      if (!item) return;

      // 1. If it contains @, it's an email lead. Parse the domain.
      if (item.includes('@')) {
        const parts = item.split('@');
        if (parts.length > 1) {
          let domain = parts[1].trim();
          // Remove any trailing context (like parenthesis, brackets, quotes or spaces)
          domain = domain.replace(/[)\]"'>\s]+/g, '');
          if (domain) {
            uniqueDomains.add(domain.toLowerCase());
          }
        }
      } else {
        // 2. Clear protocols, www prefix, and any trailing URL pathways
        let cleaned = item;
        
        // Strip out protocol
        cleaned = cleaned.replace(/^https?:\/\//i, '');
        // Strip out www.
        cleaned = cleaned.replace(/^www\./i, '');
        
        // Strip trailing paths / queries
        const firstSlash = cleaned.indexOf('/');
        if (firstSlash !== -1) {
          cleaned = cleaned.substring(0, firstSlash);
        }
        const firstQuestion = cleaned.indexOf('?');
        if (firstQuestion !== -1) {
          cleaned = cleaned.substring(0, firstQuestion);
        }
        const firstHash = cleaned.indexOf('#');
        if (firstHash !== -1) {
          cleaned = cleaned.substring(0, firstHash);
        }
        const firstColon = cleaned.indexOf(':');
        if (firstColon !== -1) {
          cleaned = cleaned.substring(0, firstColon);
        }

        cleaned = cleaned.trim();
        if (cleaned) {
          uniqueDomains.add(cleaned.toLowerCase());
        }
      }
    });

    const sortedList = Array.from(uniqueDomains)
      .filter(domain => {
        // Simple sanity check to remove obviously invalid domain strings
        return domain.length > 0 && domain !== '.' && !domain.startsWith('.') && !domain.endsWith('.');
      })
      .sort((a, b) => a.localeCompare(b));

    if (sortedList.length === 0) {
      showToast("Could not extract any valid domains or brand names from the pasted inputs.");
      return;
    }

    setBatchInput(sortedList.join('\n'));
    showToast(`Successfully extracted ${sortedList.length} unique domains, deduplicated & sorted alphabetically!`);
  };

  const countries = [
    'All', 'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan',
    'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi',
    'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic',
    'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic',
    'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia',
    'Fiji', 'Finland', 'France',
    'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana',
    'Haiti', 'Honduras', 'Hungary',
    'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy',
    'Jamaica', 'Japan', 'Jordan',
    'Kazakhstan', 'Kenya', 'Kiribati', 'Korea, North', 'Korea, South', 'Kosovo', 'Kuwait', 'Kyrgyzstan',
    'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
    'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar',
    'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Macedonia', 'Norway',
    'Oman',
    'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
    'Qatar',
    'Romania', 'Russia', 'Rwanda',
    'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria',
    'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
    'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan',
    'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam',
    'Yemen',
    'Zambia', 'Zimbabwe'
  ];

  // Classic Single Search Functionality
  const handleResearch = async () => {
    if (!query.trim()) {
      showToast("Please enter a company name, domain, or industry.");
      return;
    }

    setLoading(true);
    setExpandedManufacturers(new Set());
    setDistributorsMap({});
    try {
      const data = await researchSupplyChain(query, selectedCountry);
      setResults(data);

      const mainResults = data.filter(c => !c.distributesFor);
      const initialDistributors = data.filter(c => !!c.distributesFor);

      const initialDistributorsMap: Record<string, SupplyChainContact[]> = {};
      initialDistributors.forEach(dist => {
        const parent = dist.distributesFor!;
        if (!initialDistributorsMap[parent]) {
          initialDistributorsMap[parent] = [];
        }
        initialDistributorsMap[parent].push(dist);
      });

      setDistributorsMap(initialDistributorsMap);

      const autoExpanded = new Set<string>();
      mainResults.forEach(m => {
        if (initialDistributorsMap[m.companyName]?.length > 0) {
          autoExpanded.add(m.companyName);
        }
      });
      setExpandedManufacturers(autoExpanded);

      if (mainResults.length === 0) {
        showToast("No companies found matching the criteria.");
      } else {
        showToast(`Found ${mainResults.length} primary brand(s)/manufacturer(s) and ${initialDistributors.length} partner/reseller/distributor(s).`);
      }
    } catch (error: any) {
      console.error(error);
      showToast(error.message || "Failed to research supply chain. Please check settings.");
    } finally {
      setLoading(false);
    }
  };

  const toggleDistributors = async (companyName: string) => {
    if (expandedManufacturers.has(companyName)) {
      setExpandedManufacturers(prev => {
        const next = new Set(prev);
        next.delete(companyName);
        return next;
      });
      return;
    }

    if (distributorsMap[companyName]) {
      setExpandedManufacturers(prev => new Set(prev).add(companyName));
      return;
    }

    setResearchingDistributors(companyName);
    showToast(`Deep searching distributors, partners & resellers for ${companyName}...`);
    
    try {
      const distributors = await researchDistributorsForCompany(companyName);
      
      if (distributors.length === 0) {
        showToast("No specific distributors, partners, or resellers found for this company.");
      } else {
        setDistributorsMap(prev => ({
          ...prev,
          [companyName]: distributors
        }));
        setExpandedManufacturers(prev => new Set(prev).add(companyName));
        showToast(`Added ${distributors.length} distributors, partners, or resellers for ${companyName}.`);
      }
    } catch (error: any) {
      console.error(error);
      showToast(error.message || "Failed to find distributors. Please try again.");
    } finally {
      setResearchingDistributors(null);
    }
  };
  
  const handleGeneratePattern = async (contact: SupplyChainContact, isUnlistedOrDistributor: boolean = false) => {
    if (!contact.ceoName || contact.ceoName === 'Not Found') {
      showToast("Need a valid CEO/executive name to generate a pattern.");
      return;
    }

    const key = `${contact.companyName}-${contact.ceoName}`;
    setGeneratingPatternFor(key);
    showToast(`Synthesizing RocketReach style email for ${contact.ceoName}...`);

    try {
      const email = await generateCeoEmailPattern(contact.ceoName, contact.websiteUrl);
      
      if (!email) {
        showToast("Could not derive a credible email pattern.");
        return;
      }

      // Update state depending on where the item lives
      if (activeSubTab === 'batch') {
        setBatchResults(prev => prev.map(item => 
          item.companyName === contact.companyName ? { ...item, ceoEmail: email, emailStatus: 'derived' } : item
        ));
      } else if (isUnlistedOrDistributor && contact.distributesFor) {
        const manufacturer = contact.distributesFor;
        setDistributorsMap(prev => ({
          ...prev,
          [manufacturer]: prev[manufacturer].map(d => 
            d.companyName === contact.companyName ? { ...d, ceoEmail: email, emailStatus: 'derived' } : d
          )
        }));
      } else {
        setResults(prev => prev.map(r => 
          r.companyName === contact.companyName ? { ...r, ceoEmail: email, emailStatus: 'derived' } : r
        ));
      }
      
      showToast("Email pattern synthesized successfully!");
    } catch (error) {
      showToast("Failed to generate email pattern.");
    } finally {
      setGeneratingPatternFor(null);
    }
  };

  const copyToClipboard = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    showToast("Email copied to clipboard!");
  };

  // Batch Loader File & Excel Parsing
  const handleBatchFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileExt = file.name.split('.').pop()?.toLowerCase();
    
    if (fileExt === 'txt' || fileExt === 'csv') {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result as string;
        const lines = text
          .split(/[\r\n]+/)
          .map(line => line.trim())
          .filter(line => line.length > 0);
          
        if (lines.length > 0) {
          setBatchInput(lines.join('\n'));
          showToast(`Loaded ${lines.length} items from ${file.name}`);
        } else {
          showToast("File appears to be empty.");
        }
      };
      reader.readAsText(file);
    } else {
      try {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const bstr = evt.target?.result;
            const wb = XLSX.read(bstr, { type: 'binary' });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
            
            let items: string[] = [];
            if (data && data.length > 0) {
              let startIndex = 0;
              const firstRow = data[0].map(c => String(c || '').toLowerCase().trim());
              const isHeader = firstRow.some(cell => 
                cell.includes('name') || 
                cell.includes('company') || 
                cell.includes('website') || 
                cell.includes('domain') || 
                cell.includes('lead') || 
                cell.includes('website url')
              );
              if (isHeader) {
                startIndex = 1;
              }

              for (let i = startIndex; i < data.length; i++) {
                const row = data[i];
                if (row && row.length > 0) {
                  const cellVal = row.find(val => val !== undefined && val !== null && String(val).trim() !== '');
                  if (cellVal) {
                    items.push(String(cellVal).trim());
                  }
                }
              }
            }

            if (items.length > 0) {
              setBatchInput(items.join('\n'));
              showToast(`Loaded ${items.length} items from ${file.name}`);
            } else {
              showToast("No valid columns found in the spreadsheet.");
            }
          } catch (excelErr) {
            console.error(excelErr);
            showToast("Failed to parse spreadsheet columns.");
          }
        };
        reader.readAsBinaryString(file);
      } catch (err) {
        console.error(err);
        showToast("Error reading the selected spreadsheet.");
      }
    }
  };

  // Batch Scan Processors
  const handleStartBatch = async () => {
    if (!batchInput.trim()) {
      showToast("Please enter or upload a list of companies or websites.");
      return;
    }

    const lines = batchInput
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length === 0) {
      showToast("No valid companies found in inputs.");
      return;
    }

    stopBatchRef.current = false;
    setBatchStatus('running');

    let startIndex = batchLoadingIndex === -1 || batchStatus === 'completed' || batchStatus === 'stopped' ? 0 : batchLoadingIndex;
    if (startIndex === 0 && (batchStatus === 'idle' || batchStatus === 'completed' || batchStatus === 'stopped')) {
      setBatchResults([]);
    }

    showToast(`Starting batch scan for ${lines.length - startIndex} items...`);

    for (let i = startIndex; i < lines.length; i++) {
      if (stopBatchRef.current) {
        setBatchStatus('paused');
        showToast("Batch research paused.");
        break;
      }

      setBatchLoadingIndex(i);
      const target = lines[i];

      try {
        const contact = await researchSingleCompanyExecutive(target, selectedCountry);
        setBatchResults(prev => {
          const exists = prev.some(item => item.companyName.toLowerCase() === contact.companyName.toLowerCase() || (item.websiteUrl && contact.websiteUrl && item.websiteUrl.toLowerCase().replace(/https?:\/\/(www\.)?/, '') === contact.websiteUrl.toLowerCase().replace(/https?:\/\/(www\.)?/, '')));
          if (exists) {
            return prev.map(item => (item.companyName.toLowerCase() === contact.companyName.toLowerCase() || (item.websiteUrl && contact.websiteUrl && item.websiteUrl.toLowerCase().replace(/https?:\/\/(www\.)?/, '') === contact.websiteUrl.toLowerCase().replace(/https?:\/\/(www\.)?/, ''))) ? contact : item);
          }
          return [...prev, contact];
        });
      } catch (err) {
        console.error(err);
      }

      if (stopBatchRef.current) {
        setBatchStatus('paused');
        showToast("Batch research paused.");
        break;
      }
    }

    if (!stopBatchRef.current) {
      setBatchStatus('completed');
      setBatchLoadingIndex(-1);
      showToast("Batch research completed successfully!");
    }
  };

  const handlePauseBatch = () => {
    stopBatchRef.current = true;
    setBatchStatus('paused');
    showToast("Pausing batch scanner...", "info");
  };

  const handleStopBatch = () => {
    stopBatchRef.current = true;
    setBatchStatus('stopped');
    setBatchLoadingIndex(-1);
    showToast("Batch research reset.");
  };

  const handleClearBatch = () => {
    setBatchResults([]);
    setBatchInput('');
    setBatchLoadingIndex(-1);
    setBatchStatus('idle');
    showToast("Batch list and results cleared.");
  };

  const exportToCsv = () => {
    if (batchResults.length === 0) {
      showToast("No batch results to export.");
      return;
    }
    const headers = ['Company Name', 'Website URL', 'Category', 'Country', 'Top Executive', 'Role/Title', 'Professional Email', 'Email Status', 'Verification Source'];
    const rows = batchResults.map(r => [
      r.companyName,
      r.websiteUrl || '',
      r.type,
      r.country,
      r.ceoName,
      r.role || '',
      r.ceoEmail || '',
      r.emailStatus,
      r.sourceUrl || ''
    ]);
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "bulk_executive_emails.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("CSV file exported successfully.");
  };

  const totalLinesCount = batchInput.split('\n').filter(l => l.trim().length > 0).length;
  const processedCount = batchResults.length;
  const ceosFoundCount = batchResults.filter(r => r.ceoName && r.ceoName !== 'Not Found' && !r.ceoName.includes('Error')).length;
  const emailsCount = batchResults.filter(r => r.ceoEmail).length;

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-6 shadow-xl">
        <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <BuildingOfficeIcon className="w-7 h-7 text-purple-400" />
          Global CEO Search
        </h2>
        <p className="text-gray-400 text-sm mb-4">
          Find CEOs, Chairmen, MDs, or any top active directors for companies and their downstream networks. Extract verified corporate contact directories.
        </p>

        {/* Sub-tab Selection bar */}
        <div className="flex border-b border-gray-700/80 mb-6 gap-6">
          <button 
            onClick={() => {
              if (loading || batchStatus === 'running') return;
              setActiveSubTab('single');
            }}
            className={`pb-3 font-semibold text-sm transition-all border-b-2 hover:text-white flex items-center gap-2 ${
              activeSubTab === 'single' 
                ? 'border-purple-500 text-purple-400' 
                : 'border-transparent text-gray-400'
            }`}
          >
            <MagnifyingGlassIcon className="w-4 h-4" />
            Search Single Company
          </button>
          <button 
            onClick={() => {
              if (loading || batchStatus === 'running') return;
              setActiveSubTab('batch');
            }}
            className={`pb-3 font-semibold text-sm transition-all border-b-2 hover:text-white flex items-center gap-2 ${
              activeSubTab === 'batch' 
                ? 'border-purple-500 text-purple-400' 
                : 'border-transparent text-gray-400'
            }`}
          >
            <DocumentArrowUpIcon className="w-4 h-4" />
            Batch Upload & List Scan
            <span className="text-[10px] bg-purple-500/20 text-purple-300 font-bold px-1.5 py-0.5 rounded-full uppercase leading-none">Bulk</span>
          </button>
        </div>

        {/* SINGLE SEARCH SUB TAB */}
        {activeSubTab === 'single' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 text-xs text-gray-300 bg-purple-950/40 border border-purple-500/30 rounded-lg p-3.5 shadow-inner">
              <div className="flex items-center gap-1.5 text-purple-400 font-bold shrink-0">
                <SparklesIcon className="w-4 h-4 animate-pulse" />
                <span>Deep Directory Scanner:</span>
              </div>
              <span>
                Crawls websites deeply for affiliate directories: <code className="text-purple-300 bg-purple-900/30 px-1 rounded">/find-a-distributor</code>, <code className="text-purple-300 bg-purple-900/30 px-1 rounded">/partners</code>, <code className="text-purple-300 bg-purple-900/30 px-1 rounded">/suppliers</code>, <code className="text-purple-300 bg-purple-900/30 px-1 rounded">/where-to-buy</code>. For each distributor found, it conducts an individual site team audit of about, board, and leadership profiles to discover who is in charge and their professional emails.
              </span>
            </div>

            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-grow">
                <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                <input 
                  type="text" 
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleResearch()}
                  placeholder="e.g. Dangote Sugar, nestle.com, Toyota..." 
                  className="w-full bg-gray-900/50 border border-gray-700 rounded-lg pl-11 pr-4 py-3 text-white focus:ring-2 focus:ring-purple-500 outline-none transition-all"
                />
              </div>
              <div className="relative min-w-[150px]">
                <GlobeAltIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 pointer-events-none" />
                <select 
                  value={selectedCountry}
                  onChange={(e) => setSelectedCountry(e.target.value)}
                  className="w-full bg-gray-900/40 border border-gray-700 rounded-lg pl-11 pr-10 py-3 text-white focus:ring-2 focus:ring-purple-500 outline-none transition-all appearance-none cursor-pointer"
                >
                  {countries.map(c => (
                    <option key={c} value={c} className="bg-gray-950">{c}</option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              <button 
                onClick={handleResearch}
                disabled={loading}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-8 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 min-w-[200px]"
              >
                {loading ? (
                  <>
                    <ArrowPathIcon className="w-5 h-5 animate-spin" />
                    Deep Researching...
                  </>
                ) : (
                  'Start Deep Extraction'
                )}
              </button>
            </div>
          </div>
        )}

        {/* BATCH UPLOAD SUB TAB */}
        {activeSubTab === 'batch' && (
          <div className="space-y-5">
            {/* Input Mode Selector Selector */}
            <div className="flex items-center gap-2 bg-gray-900/55 border border-gray-750 p-1 rounded-lg max-w-sm">
              <button
                type="button"
                onClick={() => setBatchInputMode('paste')}
                className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  batchInputMode === 'paste'
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-900/10'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <ClipboardIcon className="w-3.5 h-3.5" />
                Paste Leads List
              </button>
              <button
                type="button"
                onClick={() => setBatchInputMode('upload')}
                className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  batchInputMode === 'upload'
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-900/10'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <DocumentArrowUpIcon className="w-3.5 h-3.5" />
                Upload List File
              </button>
            </div>

            {batchInputMode === 'paste' ? (
              <div className="flex flex-col space-y-3 bg-gray-900/20 border border-gray-700/60 p-4.5 rounded-xl">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <label className="text-xs text-gray-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <ClipboardIcon className="w-4 h-4 text-purple-400" />
                    Direct Paste Box (One lead company, domain name, or URL per line)
                  </label>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCleanAndExtractDomains}
                      className="text-[11px] bg-purple-600 hover:bg-purple-500 text-white border border-purple-500 shadow-md shadow-purple-900/20 px-3 py-1.5 rounded-md font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all outline-none animate-pulse hover:animate-none"
                      title="Cleans lists of full emails or links, extracts just the domain name, removes duplicates, and sorts alphabetically."
                    >
                      <FunnelIcon className="w-3.5 h-3.5" />
                      Deduplicate & Extract Domains
                    </button>
                    <button
                      type="button"
                      onClick={handlePasteFromClipboard}
                      className="text-[11px] bg-purple-900/30 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-md font-bold uppercase tracking-wider flex items-center gap-1.5 hover:bg-purple-800/35 transition-all outline-none"
                    >
                      <ClipboardIcon className="w-3.5 h-3.5" />
                      Paste from Clipboard
                    </button>
                    <button
                      type="button"
                      onClick={handleLoadSampleLeads}
                      className="text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 px-2.5 py-1.5 rounded-md font-bold uppercase tracking-wider transition-all outline-none"
                    >
                      Sample List
                    </button>
                  </div>
                </div>

                <textarea 
                  rows={6}
                  value={batchInput}
                  onChange={(e) => setBatchInput(e.target.value)}
                  disabled={batchStatus === 'running'}
                  placeholder="Paste or type domains or brand names here...&#10;e.g.&#10;toyota.com&#10;nestle.com&#10;apple.com&#15;Microsoft"
                  className="w-full bg-gray-950/70 border border-gray-700/80 rounded-lg p-3.5 text-white text-sm font-mono focus:ring-2 focus:ring-purple-500 outline-none transition-all placeholder:text-gray-600 resize-y min-h-[140px]"
                />
                <p className="text-[10px] text-gray-500">
                  Tip: Copy any list of website links, corporate domains, or names from worksheets/documents and paste them directly.
                </p>
              </div>
            ) : (
              <div 
                onClick={() => batchFileRef.current?.click()}
                className="group cursor-pointer hover:border-purple-500/70 hover:bg-purple-950/5 flex flex-col justify-center items-center bg-gray-900/20 border border-gray-750 border-dashed border-gray-700/80 rounded-xl p-8 text-center transition-all duration-200"
              >
                <div className="space-y-3">
                  <DocumentArrowUpIcon className="w-12 h-12 mx-auto text-purple-400 group-hover:scale-110 transition-transform duration-200" />
                  <div className="text-sm text-gray-200">
                    Drop your spreadsheet / list file here, or{' '}
                    <span className="font-bold text-purple-400 hover:underline">
                      browse computer
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 max-w-md mx-auto">
                    Supports <code className="text-purple-300 px-1 bg-purple-900/30 rounded">.xlsx</code>, <code className="text-purple-300 px-1 bg-purple-900/30 rounded">.csv</code>, <code className="text-purple-300 px-1 bg-purple-900/30 rounded">.txt</code> list sheets.
                  </p>
                </div>
                <input 
                  type="file" 
                  ref={batchFileRef}
                  onChange={handleBatchFileChange}
                  accept=".txt,.csv,.xlsx,.xls"
                  className="hidden"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <div className="flex items-center gap-4">
                <div className="relative min-w-[150px]">
                  <GlobeAltIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                  <select 
                    value={selectedCountry}
                    onChange={(e) => setSelectedCountry(e.target.value)}
                    disabled={batchStatus === 'running'}
                    className="w-full bg-gray-900/40 border border-gray-700 rounded-lg pl-9 pr-8 py-2 text-xs text-white focus:ring-1 focus:ring-purple-500 outline-none transition-all appearance-none cursor-pointer"
                  >
                    {countries.map(c => (
                      <option key={c} value={c} className="bg-gray-950">{c}</option>
                    ))}
                  </select>
                </div>

                <div className="text-xs text-gray-400 font-medium">
                  Loaded leads: <span className="text-purple-400 font-bold">{totalLinesCount}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {batchStatus !== 'running' ? (
                  <>
                    <button 
                      onClick={handleStartBatch}
                      disabled={totalLinesCount === 0}
                      className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-6 rounded-lg text-xs transition-all flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <PlayIcon className="w-4 h-4" />
                      {batchStatus === 'paused' ? 'Resume Scan' : 'Start Batch Scan'}
                    </button>
                    <button 
                      onClick={handleClearBatch}
                      disabled={!batchInput && batchResults.length === 0}
                      className="bg-gray-750 hover:bg-gray-700 border border-gray-700 text-gray-300 font-semibold py-2.5 px-4 rounded-lg text-xs transition-all flex items-center gap-1"
                    >
                      <XCircleIcon className="w-4 h-4" />
                      Clear All
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={handlePauseBatch}
                      className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2.5 px-5 rounded-lg text-xs transition-all flex items-center gap-1.5"
                    >
                      <PauseIcon className="w-4 h-4" />
                      Pause
                    </button>
                    <button 
                      onClick={handleStopBatch}
                      className="bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-5 rounded-lg text-xs transition-all flex items-center gap-1.5"
                    >
                      <StopIcon className="w-4 h-4" />
                      Stop Scan
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Live Progress Stats Widget */}
            {(batchStatus !== 'idle' || batchLoadingIndex !== -1) && (
              <div className="bg-gray-900/70 border border-purple-500/20 rounded-xl p-4 mt-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {batchStatus === 'running' ? (
                      <ArrowPathIcon className="w-4 h-4 text-purple-400 animate-spin" />
                    ) : batchStatus === 'paused' ? (
                      <PauseIcon className="w-4 h-4 text-yellow-500" />
                    ) : batchStatus === 'completed' ? (
                      <CheckIcon className="w-4 h-4 text-green-500" />
                    ) : (
                      <StopIcon className="w-4 h-4 text-red-500" />
                    )}
                    <span className="text-xs font-bold text-gray-100 uppercase tracking-wide">
                      {batchStatus === 'running' && `Scanning website directory...`}
                      {batchStatus === 'paused' && 'Scanner Paused'}
                      {batchStatus === 'completed' && 'Scraping Completed'}
                      {batchStatus === 'stopped' && 'Scan Stopped'}
                    </span>
                  </div>

                  <span className="text-xs text-purple-400 font-bold">
                    {processedCount} / {totalLinesCount} Scanned
                  </span>
                </div>

                <div className="w-full bg-gray-800 rounded-full h-2 mb-4 overflow-hidden">
                  <div 
                    className="bg-purple-500 h-2 rounded-full transition-all duration-300" 
                    style={{ width: `${totalLinesCount > 0 ? (processedCount / totalLinesCount) * 100 : 0}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                  <div className="bg-gray-800/40 border border-gray-700/60 rounded-lg py-2">
                    <div className="text-sm font-bold text-gray-400">Checked</div>
                    <div className="text-lg font-extrabold text-white mt-0.5">{processedCount}</div>
                  </div>
                  <div className="bg-gray-800/40 border border-gray-700/60 rounded-lg py-2">
                    <div className="text-sm font-bold text-gray-400">Total Leads</div>
                    <div className="text-lg font-extrabold text-white mt-0.5">{totalLinesCount}</div>
                  </div>
                  <div className="bg-gray-800/40 border border-gray-700/60 rounded-lg py-2">
                    <div className="text-sm font-bold text-purple-400">CEOs / Leads Found</div>
                    <div className="text-lg font-extrabold text-purple-300 mt-0.5">{ceosFoundCount}</div>
                  </div>
                  <div className="bg-gray-800/40 border border-gray-700/60 rounded-lg py-2">
                    <div className="text-sm font-bold text-green-400">Emails Retrieved</div>
                    <div className="text-lg font-extrabold text-green-300 mt-0.5">{emailsCount}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* RENDER GRID */}
      <div className="flex-grow bg-gray-800/30 backdrop-blur-sm border border-gray-700 rounded-xl overflow-hidden flex flex-col shadow-xl">
        {/* SINGLE SEARCH RESULT TABLE */}
        {activeSubTab === 'single' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-900/50 border-b border-gray-700">
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Entity Details</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">CEO / Lead</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                    Contact Email
                    <span className="text-[10px] bg-purple-500/20 text-purple-300 font-normal px-1 rounded">Found/Derived</span>
                  </th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Source</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {results.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-20 text-center text-gray-500 italic">
                      <div className="flex flex-col items-center gap-3">
                        <MagnifyingGlassIcon className="w-12 h-12 text-gray-700" />
                        <span>Enter a company or domain above to begin global deep-dive CEO research.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  results.filter(c => !c.distributesFor).map((contact, idx) => (
                    <React.Fragment key={idx}>
                      <tr className="hover:bg-gray-700/20 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="text-white font-medium">{contact.companyName}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
                              <GlobeAltIcon className="w-3.5 h-3.5" />
                              {contact.country}
                            </div>
                            {contact.websiteUrl && (
                              <a 
                                href={contact.websiteUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-[10px] text-purple-400 hover:underline mt-1 flex items-center gap-1"
                              >
                                <LinkIcon className="w-2.5 h-2.5" />
                                {contact.websiteUrl.replace(/https?:\/\/(www\.)?/, '').split('/')[0]}
                              </a>
                            )}
                            {['Manufacturer', 'Brand', 'Supplier'].includes(contact.type) && (
                              <button
                                onClick={() => toggleDistributors(contact.companyName)}
                                disabled={researchingDistributors === contact.companyName}
                                className="mt-2 text-[10px] flex items-center gap-1 text-purple-400 hover:text-purple-300 font-bold uppercase transition-colors disabled:opacity-50"
                              >
                                {researchingDistributors === contact.companyName ? (
                                  <ArrowPathIcon className="w-3 h-3 animate-spin" />
                                ) : expandedManufacturers.has(contact.companyName) ? (
                                  <XCircleIcon className="w-3 h-3" />
                                ) : (
                                  <ArrowsRightLeftIcon className="w-3 h-3" />
                                )}
                                {expandedManufacturers.has(contact.companyName) ? 'Close Partners/Resellers' : 'Find Distributors, Partners & Resellers'}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-white font-semibold text-sm">{contact.ceoName}</span>
                            {contact.role && (
                              <span className="text-[10px] text-purple-400 font-bold uppercase mt-0.5 tracking-wider">
                                {contact.role}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {contact.ceoEmail ? (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2 group">
                                <code className="text-xs text-purple-300 bg-purple-900/20 px-2 py-1 rounded border border-purple-500/30">
                                  {contact.ceoEmail}
                                </code>
                                <button 
                                  onClick={() => copyToClipboard(contact.ceoEmail)}
                                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-700 rounded transition-all"
                                >
                                  <ClipboardIcon className="w-3.5 h-3.5 text-gray-400" />
                                </button>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                  contact.emailStatus === 'found' 
                                  ? 'bg-green-900/20 text-green-400 border-green-500/30' 
                                  : 'bg-orange-900/20 text-orange-400 border-orange-500/30'
                                }`}>
                                  {contact.emailStatus === 'found' ? 'Email Found' : 'Email Derived'}
                                </span>
                                {contact.isVerified && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-blue-400 font-bold uppercase tracking-wider">
                                    <ShieldCheckIcon className="w-3 h-3" />
                                    Verified
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2">
                               <span className="text-xs text-gray-500 italic">Email Not Found</span>
                               {contact.ceoName && contact.ceoName !== 'Not Found' && (
                                 <button 
                                   onClick={() => handleGeneratePattern(contact)}
                                   disabled={generatingPatternFor === `${contact.companyName}-${contact.ceoName}`}
                                   className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1 font-bold uppercase transition-all disabled:opacity-50"
                                 >
                                   {generatingPatternFor === `${contact.companyName}-${contact.ceoName}` ? (
                                     <ArrowPathIcon className="w-3 h-3 animate-spin" />
                                   ) : (
                                     <SparklesIcon className="w-3 h-3" />
                                   )}
                                   Generate Pattern
                                 </button>
                               )}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {contact.sourceUrl ? (
                            <a 
                              href={contact.sourceUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-gray-400 hover:text-purple-400 transition-colors flex items-center gap-1 text-xs"
                            >
                              <LinkIcon className="w-4 h-4" />
                              <span>View Source</span>
                            </a>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            ['Manufacturer', 'Brand', 'Supplier'].includes(contact.type) 
                            ? 'bg-blue-900/40 text-blue-400 border border-blue-500/30' 
                            : contact.type === 'Partner'
                              ? 'bg-purple-900/40 text-purple-400 border border-purple-500/30'
                              : contact.type === 'Reseller'
                                ? 'bg-pink-900/40 text-pink-400 border border-pink-500/30'
                                : 'bg-green-900/40 text-green-400 border border-green-500/30'
                          }`}>
                            {contact.type}
                          </span>
                        </td>
                      </tr>
                      {expandedManufacturers.has(contact.companyName) && distributorsMap[contact.companyName] && (
                        <tr className="bg-purple-900/10 border-l-4 border-purple-500/50 transition-all">
                          <td colSpan={5} className="px-8 py-4">
                            <div className="bg-gray-900/50 rounded-lg border border-purple-500/20 overflow-hidden shadow-inner">
                              <table className="w-full text-left text-xs">
                                <thead>
                                  <tr className="bg-purple-900/20 border-b border-purple-500/20">
                                    <th className="px-4 py-2 text-purple-300 font-bold uppercase tracking-widest text-[10px]">Partner / Reseller / Distributor</th>
                                    <th className="px-4 py-2 text-purple-300 font-bold uppercase tracking-widest text-[10px]">In-Charge / Role</th>
                                    <th className="px-4 py-2 text-purple-300 font-bold uppercase tracking-widest text-[10px]">Email Address</th>
                                    <th className="px-4 py-2 text-purple-300 font-bold uppercase tracking-widest text-[10px]">Verification</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-purple-500/10 text-gray-300">
                                  {distributorsMap[contact.companyName].map((dist, dIdx) => (
                                    <tr key={dIdx} className="hover:bg-purple-500/5 transition-colors">
                                      <td className="px-4 py-3">
                                        <div className="flex flex-col">
                                          <span className="font-bold text-gray-200">{dist.companyName}</span>
                                          <span className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                                            <GlobeAltIcon className="w-2.5 h-2.5" />
                                            {dist.country}
                                          </span>
                                          {dist.websiteUrl && (
                                            <a href={dist.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-purple-400/80 hover:underline mt-0.5">
                                              {dist.websiteUrl.replace(/https?:\/\/(www\.)?/, '').split('/')[0]}
                                            </a>
                                          )}
                                        </div>
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="flex flex-col">
                                          <span className="text-gray-200 font-semibold text-xs">{dist.ceoName}</span>
                                          {dist.role && (
                                            <span className="text-[9px] text-purple-400 font-bold uppercase mt-0.5 tracking-wider">
                                              {dist.role}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="px-4 py-3">
                                        {dist.ceoEmail ? (
                                          <div className="flex items-center gap-2 group">
                                            <span className="font-mono text-purple-300">{dist.ceoEmail}</span>
                                            <button onClick={() => copyToClipboard(dist.ceoEmail)} className="opacity-0 group-hover:opacity-100 p-0.5">
                                              <ClipboardIcon className="w-3.5 h-3.5 text-gray-500" />
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="flex flex-col gap-1">
                                            <span className="text-gray-600 italic">Not Found</span>
                                            {dist.ceoName && dist.ceoName !== 'Not Found' && (
                                              <button 
                                                onClick={() => handleGeneratePattern(dist, true)}
                                                disabled={generatingPatternFor === `${dist.companyName}-${dist.ceoName}`}
                                                className="text-[9px] text-purple-400 hover:text-purple-300 flex items-center gap-1 font-bold uppercase disabled:opacity-50"
                                              >
                                                {generatingPatternFor === `${dist.companyName}-${dist.ceoName}` ? (
                                                  <ArrowPathIcon className="w-2.5 h-2.5 animate-spin" />
                                                ) : (
                                                  <SparklesIcon className="w-2.5 h-2.5" />
                                                )}
                                                Generate
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                          <span className={`text-[9px] px-1 rounded uppercase font-bold border ${
                                            dist.emailStatus === 'found' ? 'border-green-500/30 text-green-400' : 'border-orange-500/30 text-orange-400'
                                          }`}>
                                            {dist.emailStatus}
                                          </span>
                                          {dist.sourceUrl && (
                                            <a href={dist.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-purple-400">
                                              <LinkIcon className="w-3.5 h-3.5" />
                                            </a>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* BATCH RESULTS TABLE */}
        {activeSubTab === 'batch' && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 bg-gray-900/40 border-b border-gray-700">
              <span className="text-sm font-bold text-gray-200">
                Processed Entries Directory ({batchResults.length})
              </span>
              
              <button 
                onClick={exportToCsv}
                disabled={batchResults.length === 0}
                className="bg-green-600 hover:bg-green-700 hover:scale-[1.02] disabled:hover:scale-100 disabled:opacity-40 text-white font-bold py-1.5 px-4 rounded text-xs transition-all flex items-center gap-1.5"
              >
                <DocumentArrowUpIcon className="w-3.5 h-3.5 rotate-180" />
                Export to CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-900/20 border-b border-gray-700">
                    <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-wider">Company Details</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-wider">Top Executive / Lead</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-wider">Contact Email</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-xs font-bold text-gray-400 uppercase tracking-wider">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-750">
                  {batchResults.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-20 text-center text-gray-500 italic">
                        <div className="flex flex-col items-center gap-3">
                          <DocumentArrowUpIcon className="w-12 h-12 text-gray-700" />
                          <span>No bulk results analyzed yet. Paste lines or upload a spreadsheet above, then click 'Start Batch Scan'.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    batchResults.map((contact, idx) => (
                      <tr key={idx} className="hover:bg-gray-750/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-white font-semibold text-sm">{contact.companyName}</span>
                            <span className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                              <GlobeAltIcon className="w-3 h-3" />
                              {contact.country}
                            </span>
                            {contact.websiteUrl && (
                              <a 
                                href={contact.websiteUrl} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-[10px] text-purple-400 hover:underline mt-0.5 truncate max-w-[180px]"
                              >
                                {contact.websiteUrl.replace(/https?:\/\/(www\.)?/, '')}
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-white font-semibold text-sm">{contact.ceoName}</span>
                            {contact.role && (
                              <span className="text-[9px] bg-purple-900/30 border border-purple-500/20 text-purple-400 font-bold uppercase tracking-wider px-1.5 py-0.5 rounded w-fit mt-1">
                                {contact.role}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {contact.ceoEmail ? (
                            <div className="flex items-center gap-2 group">
                              <code className="text-xs text-purple-300 bg-purple-900/20 px-2 py-1 rounded border border-purple-500/30">
                                {contact.ceoEmail}
                              </code>
                              <button 
                                onClick={() => copyToClipboard(contact.ceoEmail)}
                                className="p-1 hover:bg-gray-700/60 rounded"
                              >
                                <ClipboardIcon className="w-3.5 h-3.5 text-gray-400" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5 align-start">
                              <span className="text-xs text-gray-500 italic">Not Found</span>
                              {contact.ceoName && contact.ceoName !== 'Not Found' && !contact.ceoName.includes('Error') && (
                                <button 
                                  onClick={() => handleGeneratePattern(contact)}
                                  disabled={generatingPatternFor === `${contact.companyName}-${contact.ceoName}`}
                                  className="text-[9px] text-purple-400 hover:text-purple-300 flex items-center gap-1 font-bold uppercase disabled:opacity-50"
                                >
                                  {generatingPatternFor === `${contact.companyName}-${contact.ceoName}` ? (
                                    <ArrowPathIcon className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <SparklesIcon className="w-3 h-3" />
                                  )}
                                  Generate Pattern
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border w-fit ${
                              contact.ceoEmail
                                ? contact.emailStatus === 'found' 
                                  ? 'bg-green-900/30 text-green-400 border-green-500/10' 
                                  : 'bg-orange-900/30 text-orange-400 border-orange-500/10'
                                : 'bg-gray-800 text-gray-505 text-gray-500 border-gray-700'
                            }`}>
                              {contact.ceoEmail ? (contact.emailStatus === 'found' ? 'Direct Found' : 'Pattern Derived') : 'Empty'}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border w-fit ${
                              ['manufacturer', 'brand', 'supplier'].includes(String(contact.type).toLowerCase())
                                ? 'bg-blue-900/40 text-blue-400 border-blue-500/20'
                                : 'bg-purple-900/40 text-purple-400 border-purple-500/20'
                            }`}>
                              {contact.type}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {contact.sourceUrl ? (
                            <a 
                              href={contact.sourceUrl} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="text-gray-400 hover:text-purple-400 transition-colors flex items-center gap-1 text-xs"
                            >
                              <LinkIcon className="w-3.5 h-3.5" />
                              <span>View Source</span>
                            </a>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SupplyChainExtractor;
