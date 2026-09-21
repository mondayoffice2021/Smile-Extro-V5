
import React, { useState, useRef } from 'react';
import DocumentArrowUpIcon from './icons/DocumentArrowUpIcon';
import FolderOpenIcon from './icons/FolderOpenIcon';
import ArrowPathIcon from './icons/ArrowPathIcon';
import CheckIcon from './icons/CheckIcon';
import XCircleIcon from './icons/XCircleIcon';
import FunnelIcon from './icons/FunnelIcon';
import JSZip from 'jszip';
import { classifyBusinessEmail } from '../services/businessEmailFilter';

interface EmailCleanerProps {
  showToast: (msg: string) => void;
}

interface FilterResult {
  category: string;
  icon: string;
  emails: string[];
}

// 1. Public Domains List
const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'yahoo.co.uk', 'yahoo.fr', 
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'windowslive.com', 
  'aol.com', 'aim.com', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'pm.me', 'tutanota.com', 'tuta.io',
  'zoho.com', 'yandex.com', 'yandex.ru', 'mail.com', 'gmx.com', 'gmx.de',
  'comcast.net', 'sbcglobal.net', 'verizon.net', 'att.net', 'cox.net',
  'bellsouth.net', 'charter.net', 'earthlink.net', 'optonline.net',
  'qq.com', '163.com', '126.com', 'sina.com', 'aliyun.com',
  'naver.com', 'daum.net', 'hanmail.net',
  'web.de', 'freenet.de', 't-online.de', 'libero.it', 'virgilio.it',
  'orange.fr', 'wanadoo.fr', 'sfr.fr', 'free.fr', 'laposte.net',
  'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br'
]);

// 2. Banking Keywords (Simple heuristic)
const BANK_KEYWORDS = [
  'bank', 'banco', 'banking', 'credit', 'union', 'capital', 'finance', 'invest',
  'chase', 'fargo', 'citi', 'hsbc', 'barclays', 'santander', 'ubs', 'db', 
  'sc.com', 'pnc', 'usbank', 'truist', 'schwab', 'fidelity', 'vanguard',
  'paypal', 'stripe', 'visa', 'mastercard', 'amex', 'americanexpress', 'wallet', 'crypto'
];

const EmailCleaner: React.FC<EmailCleanerProps> = ({ showToast }) => {
  const [inputText, setInputText] = useState('');
  const [results, setResults] = useState<FilterResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [largeFileMode, setLargeFileMode] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rawFileContent = useRef<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const isLarge = file.size > 1024 * 1024; // 1MB
      setLargeFileMode(isLarge);

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (isLarge) {
            rawFileContent.current = text;
            setInputText(`[LARGE FILE LOADED]\nName: ${file.name}\nSize: ${(file.size / 1024 / 1024).toFixed(2)} MB\n\nContent hidden for performance. Ready to clean.`);
        } else {
            rawFileContent.current = null;
            setInputText(text);
        }
        showToast("List loaded successfully.");
      };
      reader.readAsText(file);
    }
  };

  const isFakeUsername = (username: string): boolean => {
    // 1. Too many numbers (e.g. john1928374)
    if ((username.match(/\d/g) || []).length > 4) return true;
    
    // 2. Long random looking alphanumeric string (e.g. a83f92k39d) without separators
    // Logic: Length > 7, contains numbers, contains letters, NO dots/underscores/dashes
    if (username.length > 7 && /^[a-z0-9]+$/i.test(username) && /[a-z]/i.test(username) && /[0-9]/.test(username)) {
       // Heuristic: if it looks like a hash
       return true;
    }

    // 3. Repeated patterns or specific bot keywords
    if (username.startsWith('noreply') || username.startsWith('no-reply') || username.startsWith('donotreply')) return true;
    if (/admin|test|temp|trash/i.test(username)) return false; // Allowed but suspicious? Keep for now.

    return false;
  };

  const isBankDomain = (domain: string): boolean => {
    const lower = domain.toLowerCase();
    return BANK_KEYWORDS.some(keyword => lower.includes(keyword));
  };

  const processEmails = () => {
    const content = largeFileMode && rawFileContent.current ? rawFileContent.current : inputText;
    
    if (!content.trim()) {
      showToast("Please input emails first.");
      return;
    }

    setIsProcessing(true);
    
    // Small delay to allow UI to update if large file
    setTimeout(() => {
        const rawList = content.split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(e => e.includes('@'));
        const uniqueSet = new Set<string>(rawList);
        
        const clean: string[] = [];
        const bankEmails: string[] = [];
        const govEmails: string[] = [];
        const eduEmails: string[] = [];
        const newsEmails: string[] = [];
        const botEmails: string[] = [];
        const publicEmails: string[] = [];

        uniqueSet.forEach((email: string) => {
            const result = classifyBusinessEmail(email, {
              filterBank: true,
              filterGovernment: true,
              filterEducation: true,
              filterNews: true,
              filterWebmasterBot: true,
              filterPublicWebmail: true
            });

            if (result.isBusiness) {
                clean.push(email);
            } else {
                switch (result.category) {
                  case 'bank': bankEmails.push(email); break;
                  case 'government': govEmails.push(email); break;
                  case 'education': eduEmails.push(email); break;
                  case 'news': newsEmails.push(email); break;
                  case 'webmaster_bot': botEmails.push(email); break;
                  case 'public_webmail': publicEmails.push(email); break;
                  default: botEmails.push(email); break;
                }
            }
        });

        setResults([
            { category: 'Clean Business', icon: '💼', emails: clean },
            { category: 'Bank & Financial', icon: '🏦', emails: bankEmails },
            { category: 'Government & Military', icon: '🏛️', emails: govEmails },
            { category: 'Education & Academic', icon: '🎓', emails: eduEmails },
            { category: 'News & Media', icon: '📰', emails: newsEmails },
            { category: 'Webmasters & Bots', icon: '🤖', emails: botEmails },
            { category: 'Public Consumer Webmail', icon: '🌐', emails: publicEmails },
        ]);

        setIsProcessing(false);
        showToast(`Processed ${uniqueSet.size} emails. Found ${clean.length} clean business emails.`);
    }, 100);
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExport = (category: string, emails: string[]) => {
      const content = emails.join('\n');
      const blob = new Blob([content], { type: 'text/plain' });
      const safeName = category.replace(/[^a-zA-Z0-9]/g, '_');
      downloadBlob(blob, `${safeName}_Emails.txt`);
  };

  const handleExportZip = async () => {
      const zip = new JSZip();
      const folder = zip.folder("Filtered_Emails");
      if(!folder) return;

      results.forEach(group => {
          if (group.emails.length > 0) {
              const safeName = group.category.replace(/[^a-zA-Z0-9]/g, '_');
              folder.file(`${safeName}_Emails.txt`, group.emails.join('\n'));
          }
      });

      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, "Email_Filter_Results.zip");
  };

  const getCategoryColor = (cat: string) => {
      switch(cat) {
          case 'Clean Business': return 'text-green-400 border-green-500/30 bg-green-900/10';
          case 'Bank & Financial': return 'text-yellow-400 border-yellow-500/30 bg-yellow-900/10';
          case 'Government & Military': return 'text-emerald-400 border-emerald-500/30 bg-emerald-900/10';
          case 'Education & Academic': return 'text-indigo-400 border-indigo-500/30 bg-indigo-900/10';
          case 'News & Media': return 'text-pink-400 border-pink-500/30 bg-pink-900/10';
          case 'Webmasters & Bots': return 'text-red-400 border-red-500/30 bg-red-900/10';
          case 'Public Consumer Webmail': return 'text-blue-400 border-blue-500/30 bg-blue-900/10';
          default: return 'text-gray-300';
      }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
        {/* INPUT */}
        <div className="lg:col-span-4 flex flex-col h-full space-y-4">
             <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl shadow-2xl p-6 flex-grow flex flex-col">
                <div className="mb-4">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <FunnelIcon className="w-6 h-6 text-orange-400" />
                        List Cleaner
                    </h2>
                    <p className="text-gray-400 text-sm mt-2">
                        100% Offline Processing. Removes public domains (Gmail, etc.), banking domains, and fake usernames.
                    </p>
                </div>

                <textarea
                    value={inputText}
                    onChange={(e) => {
                        if(largeFileMode) { setLargeFileMode(false); rawFileContent.current = null; }
                        setInputText(e.target.value);
                    }}
                    placeholder="Paste emails here or load a file..."
                    className={`flex-grow w-full p-4 bg-gray-900/50 border border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none text-sm font-mono text-gray-300 custom-scrollbar mb-4 ${largeFileMode ? 'opacity-70' : ''}`}
                    disabled={isProcessing}
                    readOnly={largeFileMode}
                />

                <div className="flex gap-3">
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center flex-1 border border-gray-600"
                    >
                        <DocumentArrowUpIcon className="w-4 h-4 mr-2" /> Load List
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".txt,.csv" className="hidden" />
                    
                    <button
                        onClick={processEmails}
                        disabled={isProcessing || (!inputText && !rawFileContent.current)}
                        className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-bold transition-all flex-1 shadow-lg shadow-orange-900/20 disabled:opacity-50"
                    >
                        {isProcessing ? 'Filtering...' : 'Clean List'}
                    </button>
                </div>
             </div>
        </div>

        {/* OUTPUT */}
        <div className="lg:col-span-8 flex flex-col h-full">
            <div className="bg-gray-800/40 backdrop-blur-md border border-gray-700 rounded-xl shadow-2xl flex flex-col h-[80vh]">
                 <div className="p-5 border-b border-gray-700/50 bg-gray-800/30 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold text-white">Filtered Results</h2>
                    </div>
                    {results.length > 0 && (
                        <button 
                            onClick={handleExportZip}
                            className="flex items-center px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-md bg-green-600/80 hover:bg-green-600 text-white transition-all duration-200 shadow-lg"
                        >
                            <FolderOpenIcon className="w-4 h-4 mr-1.5" /> Export All (ZIP)
                        </button>
                    )}
                 </div>

                 <div className="flex-grow overflow-y-auto p-4 custom-scrollbar bg-gray-900/20">
                     {results.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500 opacity-60">
                            <ArrowPathIcon className="w-12 h-12 mb-3" />
                            <p>Load emails to start filtering</p>
                        </div>
                     ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {results.map((group) => (
                                <div key={group.category} className={`border rounded-lg p-4 transition-colors ${getCategoryColor(group.category)} bg-opacity-10 border-opacity-30`}>
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex items-center">
                                            <span className="text-xl mr-2">{group.icon}</span>
                                            <div>
                                                <h3 className="font-bold text-white text-sm">{group.category}</h3>
                                                <span className="text-xs opacity-70">{group.emails.length} count</span>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={() => handleExport(group.category, group.emails)}
                                            disabled={group.emails.length === 0}
                                            className="px-2 py-1 text-xs font-medium bg-gray-800 hover:bg-white hover:text-gray-900 text-gray-300 rounded transition-all disabled:opacity-0"
                                        >
                                            Export
                                        </button>
                                    </div>
                                    <div className="bg-gray-900/50 rounded p-2 h-48 overflow-y-auto custom-scrollbar">
                                        {group.emails.length > 0 ? (
                                            group.emails.slice(0, 100).map((e, i) => (
                                                <div key={i} className="text-xs text-gray-400 font-mono py-0.5 truncate border-b border-gray-800/50 last:border-0">
                                                    {e}
                                                </div>
                                            ))
                                        ) : (
                                            <div className="text-xs text-gray-600 italic text-center mt-10">No emails in this category</div>
                                        )}
                                        {group.emails.length > 100 && (
                                            <div className="text-xs text-center text-gray-500 mt-2 italic">
                                                ...and {group.emails.length - 100} more
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
    </div>
  );
};

export default EmailCleaner;
