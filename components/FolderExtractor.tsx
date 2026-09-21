import React, { useState, useRef, useCallback, useMemo } from 'react';
import { extractEmailsFromFile } from '../services/fileService';
import * as XLSX from 'xlsx';
import DocumentArrowUpIcon from './icons/DocumentArrowUpIcon';
import FolderOpenIcon from './icons/FolderOpenIcon';
import ClipboardIcon from './icons/ClipboardIcon';
import CheckIcon from './icons/CheckIcon';
import XCircleIcon from './icons/XCircleIcon';
import ArrowPathIcon from './icons/ArrowPathIcon';
import StopIcon from './icons/StopIcon';
import { useActiveWakeLock } from '../hooks/useWakeLock';

interface FolderExtractorProps {
  showToast: (msg: string) => void;
  onSendToValidator?: (emails: string[]) => void;
}

interface ProcessedFile {
  id: string;
  name: string;
  relativePath?: string;
  size: number;
  emailsCount: number;
  status: 'success' | 'skipped' | 'error';
  errorMessage?: string;
}

interface ExtractedEmailItem {
  email: string;
  domain: string;
  sourceFiles: string[];
}

export const FolderExtractor: React.FC<FolderExtractorProps> = ({ showToast, onSendToValidator }) => {
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);
  const [extractedEmails, setExtractedEmails] = useState<ExtractedEmailItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Keep screen awake while files are being uploaded, parsed, and extracted
  useActiveWakeLock(isProcessing, 'Folder Extractor: Processing Files & Archives');
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [statusText, setStatusText] = useState('Idle');
  const [searchQuery, setSearchQuery] = useState('');
  const [fileFilter, setFileFilter] = useState('');

  // High performance pagination for huge lists
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const multiFileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Helper to format bytes
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Check if a file is supported or skip system/binary folders
  const isSupportedFile = (file: File): boolean => {
    const name = file.name.toLowerCase();
    // Skip hidden files and system trash
    if (name.startsWith('.') || name === 'thumbs.db' || name.startsWith('~$') || name === '.ds_store') {
      return false;
    }
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const allowed = ['txt', 'csv', 'xlsx', 'xls', 'tsv', 'json', 'log', 'xml', 'html', 'htm', 'md'];
    return allowed.includes(ext);
  };

  // Recursively parse entries from dropped items (supports folders)
  const traverseFileSystemEntry = async (entry: any): Promise<File[]> => {
    const files: File[] = [];
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
      if (isSupportedFile(file)) {
        files.push(file);
      }
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readAllEntries = async (): Promise<any[]> => {
        let allEntries: any[] = [];
        let batch = await new Promise<any[]>((resolve, reject) => dirReader.readEntries(resolve, reject));
        while (batch.length > 0) {
          allEntries = allEntries.concat(batch);
          batch = await new Promise<any[]>((resolve, reject) => dirReader.readEntries(resolve, reject));
        }
        return allEntries;
      };

      try {
        const entries = await readAllEntries();
        const subFilesPromises = entries.map(childEntry => traverseFileSystemEntry(childEntry));
        const subFilesArrays = await Promise.all(subFilesPromises);
        subFilesArrays.forEach(arr => files.push(...arr));
      } catch (err) {
        console.error("Error reading subdirectory:", err);
      }
    }
    return files;
  };

  const handleStopProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      showToast("Stopping file parser...");
    }
  };

  // Core Processing Engine
  const processFiles = async (filesToProcess: File[]) => {
    if (filesToProcess.length === 0) {
      showToast("No supported files found to process.");
      return;
    }

    setIsProcessing(true);
    abortControllerRef.current = new AbortController();
    setStatusText(`Preparing to extract from ${filesToProcess.length} files...`);
    setProgress({ current: 0, total: filesToProcess.length });

    const newProcessedFiles: ProcessedFile[] = [];
    // Map of Email -> Set of Source File Names
    const tempEmailsMap = new Map<string, Set<string>>();

    // Load existing items into the map for incremental additions
    extractedEmails.forEach(item => {
      tempEmailsMap.set(item.email, new Set(item.sourceFiles));
    });

    // Process files sequentially with browser event loop yielding
    for (let i = 0; i < filesToProcess.length; i++) {
      if (abortControllerRef.current?.signal.aborted) {
        showToast("Processing stopped by user.");
        break;
      }

      const file = filesToProcess[i];
      setProgress({ current: i + 1, total: filesToProcess.length });
      setStatusText(`Streaming: ${file.name} (${formatBytes(file.size)})...`);

      // Yield control to ensure UI stays silky smooth
      await new Promise(r => setTimeout(r, 0));

      try {
        const emailsExtracted = await extractEmailsFromFile(file);
        
        // Add to processed log
        const fileLog: ProcessedFile = {
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          relativePath: (file as any).webkitRelativePath || undefined,
          size: file.size,
          emailsCount: emailsExtracted.length,
          status: 'success'
        };
        newProcessedFiles.push(fileLog);

        // Map extracted emails
        emailsExtracted.forEach(email => {
          const cleanedEmail = email.toLowerCase().trim();
          if (!tempEmailsMap.has(cleanedEmail)) {
            tempEmailsMap.set(cleanedEmail, new Set());
          }
          tempEmailsMap.get(cleanedEmail)?.add(file.name);
        });

      } catch (err: any) {
        console.error(`Error reading ${file.name}:`, err);
        newProcessedFiles.push({
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          relativePath: (file as any).webkitRelativePath || undefined,
          size: file.size,
          emailsCount: 0,
          status: 'error',
          errorMessage: err.message || 'Unknown read error'
        });
      }
    }

    // Convert map back to list of unique email items
    const mergedEmails: ExtractedEmailItem[] = Array.from(tempEmailsMap.entries()).map(([email, sourcesSet]) => {
      const domain = email.split('@')[1] || '';
      return {
        email,
        domain,
        sourceFiles: Array.from(sourcesSet)
      };
    });

    // Merge logs and ensure unique file logs by name (latest wins)
    const combinedFileLogsMap = new Map<string, ProcessedFile>();
    processedFiles.forEach(f => combinedFileLogsMap.set(f.name, f));
    newProcessedFiles.forEach(f => combinedFileLogsMap.set(f.name, f));

    setProcessedFiles(Array.from(combinedFileLogsMap.values()));
    setExtractedEmails(mergedEmails);
    setIsProcessing(false);
    setProgress(null);
    setStatusText('Completed');
    abortControllerRef.current = null;

    showToast(`Processed ${filesToProcess.length} file(s). Found ${mergedEmails.length} unique business emails.`);
  };

  // Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
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

    if (isProcessing) {
      showToast("Please wait for current files to finish processing.");
      return;
    }

    const items = e.dataTransfer.items;
    const filesToExtract: File[] = [];

    if (items && items.length > 0) {
      const entryPromises: Promise<File[]>[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (typeof item.webkitGetAsEntry === 'function') {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            entryPromises.push(traverseFileSystemEntry(entry));
          }
        } else {
          const file = item.getAsFile();
          if (file && isSupportedFile(file)) {
            filesToExtract.push(file);
          }
        }
      }

      if (entryPromises.length > 0) {
        setStatusText("Scanning folder directories...");
        const nestedArrays = await Promise.all(entryPromises);
        nestedArrays.forEach(arr => filesToExtract.push(...arr));
      }
    } else if (e.dataTransfer.files) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (isSupportedFile(file)) {
          filesToExtract.push(file);
        }
      }
    }

    await processFiles(filesToExtract);
  };

  const handleMultiFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = (Array.from(e.target.files) as File[]).filter(isSupportedFile);
      await processFiles(filesArray);
      e.target.value = '';
    }
  };

  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = (Array.from(e.target.files) as File[]).filter(isSupportedFile);
      await processFiles(filesArray);
      e.target.value = '';
    }
  };

  const handleClearAll = () => {
    if (window.confirm("Are you sure you want to clear all processed files and extracted emails?")) {
      setProcessedFiles([]);
      setExtractedEmails([]);
      showToast("Cleared all file extraction history.");
    }
  };

  const handleRemoveEmail = (emailToRemove: string) => {
    setExtractedEmails(prev => prev.filter(item => item.email !== emailToRemove));
    showToast(`Removed ${emailToRemove}`);
  };

  // Filtered emails
  const filteredEmails = useMemo(() => {
    return extractedEmails.filter(item => {
      const matchesSearch = searchQuery === '' || 
        item.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.domain.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesFile = fileFilter === '' || item.sourceFiles.includes(fileFilter);

      return matchesSearch && matchesFile;
    });
  }, [extractedEmails, searchQuery, fileFilter]);

  // Reset pagination on filter changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, fileFilter, extractedEmails.length]);

  const totalPages = Math.max(1, Math.ceil(filteredEmails.length / pageSize));
  const paginatedEmails = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredEmails.slice(start, start + pageSize);
  }, [filteredEmails, currentPage, pageSize]);

  // Unique list of source files for the dropdown filter
  const uniqueSourceFiles = useMemo(() => {
    const set = new Set<string>();
    extractedEmails.forEach(item => item.sourceFiles.forEach(f => set.add(f)));
    return Array.from(set).sort();
  }, [extractedEmails]);

  // Copy all
  const copyToClipboard = () => {
    if (filteredEmails.length === 0) return;
    const text = filteredEmails.map(item => item.email).join('\n');
    navigator.clipboard.writeText(text);
    showToast(`Copied ${filteredEmails.length} emails to clipboard!`);
  };

  // Download TXT
  const downloadTextFile = () => {
    if (filteredEmails.length === 0) return;
    const text = filteredEmails.map(item => item.email).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extracted_emails_${filteredEmails.length}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${filteredEmails.length} emails as TXT`);
  };

  // Download CSV
  const downloadCsvFile = () => {
    if (filteredEmails.length === 0) return;
    const header = "Email,Domain,SourceFiles\n";
    const rows = filteredEmails.map(item => {
      const escapedSources = `"${item.sourceFiles.join('; ').replace(/"/g, '""')}"`;
      return `${item.email},${item.domain},${escapedSources}`;
    }).join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extracted_emails_${filteredEmails.length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${filteredEmails.length} emails as CSV`);
  };

  // Download Excel (.xlsx)
  const downloadExcelFile = () => {
    if (filteredEmails.length === 0) return;
    const rows = filteredEmails.map(item => ({
      "Email Address": item.email,
      "Domain": item.domain,
      "Source Documents": item.sourceFiles.join('; ')
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Extracted Emails");
    XLSX.writeFile(workbook, `extracted_emails_${filteredEmails.length}.xlsx`);
    showToast(`Downloaded ${filteredEmails.length} emails as Excel (.xlsx)`);
  };

  return (
    <div className="space-y-6">
      {/* Upload Zone Card */}
      <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-6 shadow-xl backdrop-blur-md">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center">
              <FolderOpenIcon className="w-6 h-6 mr-2 text-teal-400" />
              Bulky File & Folder Archive Extractor
            </h2>
            <p className="text-gray-400 text-xs mt-1">
              Recursively extract business contacts from entire folders or massive documents (CSV, XLSX, TXT) with non-blocking streaming.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-teal-950/80 text-teal-300 border border-teal-700/60 px-2.5 py-1 rounded-full font-medium">
              🛡️ Chunked Stream Mode: Zero Freeze
            </span>
          </div>
        </div>

        {/* Drag and Drop Dropzone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-all flex flex-col items-center justify-center cursor-pointer ${
            isDragging 
              ? 'border-blue-400 bg-blue-900/20' 
              : 'border-gray-600 hover:border-gray-500 bg-gray-900/40'
          }`}
        >
          <DocumentArrowUpIcon className={`w-14 h-14 mb-3 transition-transform ${isDragging ? 'scale-110 text-blue-400' : 'text-gray-400'}`} />
          
          <div className="text-white font-bold text-base mb-1">
            Drag & Drop Bulky Files or Whole Folders Here
          </div>
          <p className="text-gray-400 text-xs max-w-md mb-5">
            Supports <strong className="text-blue-400">TXT, CSV, XLSX, XLS</strong> and logs. Drop folders directly from your desktop to read recursively.
          </p>

          <div className="flex flex-wrap gap-3 justify-center">
            {/* Multi-file Input Trigger */}
            <button
              onClick={() => multiFileInputRef.current?.click()}
              disabled={isProcessing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition-all flex items-center shadow-lg disabled:opacity-50"
            >
              <DocumentArrowUpIcon className="w-4 h-4 mr-1.5" />
              Select Multiple Files
            </button>
            <input
              type="file"
              ref={multiFileInputRef}
              onChange={handleMultiFileChange}
              multiple
              accept=".txt,.csv,.xlsx,.xls,.tsv,.json,.log,.xml,.html,.htm,.md"
              className="hidden"
            />

            {/* Folder Input Trigger */}
            <button
              onClick={() => folderInputRef.current?.click()}
              disabled={isProcessing}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-lg transition-all flex items-center shadow-lg disabled:opacity-50"
            >
              <FolderOpenIcon className="w-4 h-4 mr-1.5" />
              Select Folder
            </button>
            <input
              type="file"
              ref={folderInputRef}
              onChange={handleFolderChange}
              {...({
                webkitdirectory: "",
                directory: "",
                multiple: true
              } as any)}
              className="hidden"
            />
          </div>
        </div>

        {/* Real-time Loader Indicator with Stop Button */}
        {isProcessing && progress && (
          <div className="mt-4 p-4 bg-gray-900/80 border border-gray-700 rounded-lg space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-blue-400 font-medium flex items-center">
                <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin text-blue-400" />
                {statusText}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-gray-400 font-bold">
                  {progress.current} / {progress.total} Files
                </span>
                <button
                  onClick={handleStopProcessing}
                  className="px-2.5 py-1 bg-red-600/30 hover:bg-red-600 text-red-300 hover:text-white rounded text-xs font-bold transition-colors flex items-center gap-1 border border-red-500/40"
                >
                  <StopIcon className="w-3.5 h-3.5" />
                  Halt
                </button>
              </div>
            </div>
            <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-teal-500 h-full transition-all duration-150"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              ></div>
            </div>
          </div>
        )}
      </div>

      {/* Stats and Results Grid */}
      {processedFiles.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* File Upload History log (Left Side) */}
          <div className="lg:col-span-4 bg-gray-800/40 border border-gray-700 rounded-xl p-5 shadow-xl">
            <h3 className="text-base font-bold text-white mb-3 flex items-center justify-between">
              <span>Source Files ({processedFiles.length})</span>
              <button
                onClick={handleClearAll}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Clear All Data
              </button>
            </h3>

            <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-2 custom-scrollbar">
              {processedFiles.map(file => (
                <div key={file.id} className="p-3 bg-gray-900/50 border border-gray-800 rounded-lg flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-200 truncate" title={file.relativePath || file.name}>
                      {file.name}
                    </p>
                    <p className="text-gray-500 mt-0.5">
                      {formatBytes(file.size)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {file.status === 'success' ? (
                      <div>
                        <span className="text-teal-400 font-bold block">{file.emailsCount.toLocaleString()} emails</span>
                        <span className="text-gray-500 text-[10px]">Processed</span>
                      </div>
                    ) : (
                      <div>
                        <span className="text-red-400 font-bold block">Failed</span>
                        <span className="text-gray-500 text-[10px] block max-w-[100px] truncate" title={file.errorMessage}>
                          {file.errorMessage}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Extracted Combined List (Right Side) */}
          <div className="lg:col-span-8 bg-gray-800/40 border border-gray-700 rounded-xl p-5 shadow-xl flex flex-col min-h-[480px]">
            
            {/* Filter and Export Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-gray-700 mb-3">
              <div>
                <h3 className="text-lg font-bold text-white">Extracted Email Database</h3>
                <p className="text-xs text-teal-400 mt-0.5 font-semibold">
                  {extractedEmails.length.toLocaleString()} unique emails deduplicated across all documents
                </p>
              </div>

              {/* Download Buttons */}
              <div className="flex flex-wrap gap-2 shrink-0">
                {onSendToValidator && (
                  <button
                    onClick={() => onSendToValidator(extractedEmails.map(e => e.email))}
                    disabled={extractedEmails.length === 0}
                    className="px-3 py-1.5 bg-orange-600/30 hover:bg-orange-600 text-orange-200 hover:text-white rounded-lg text-xs font-bold transition-all flex items-center border border-orange-500/50 disabled:opacity-40"
                    title="Send extracted emails to Sorter & Validator"
                  >
                    Validate & Sort ({extractedEmails.length.toLocaleString()})
                  </button>
                )}
                <button
                  onClick={copyToClipboard}
                  disabled={extractedEmails.length === 0}
                  className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs font-bold transition-all flex items-center disabled:opacity-40"
                >
                  <ClipboardIcon className="w-3.5 h-3.5 mr-1" />
                  Copy
                </button>
                <button
                  onClick={downloadTextFile}
                  disabled={extractedEmails.length === 0}
                  className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all flex items-center disabled:opacity-40"
                >
                  TXT
                </button>
                <button
                  onClick={downloadCsvFile}
                  disabled={extractedEmails.length === 0}
                  className="px-2.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold transition-all flex items-center disabled:opacity-40"
                >
                  CSV
                </button>
                <button
                  onClick={downloadExcelFile}
                  disabled={extractedEmails.length === 0}
                  className="px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold transition-all flex items-center disabled:opacity-40"
                >
                  XLSX
                </button>
              </div>
            </div>

            {/* Filter controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <input
                  type="text"
                  placeholder="Search email or domain..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none text-white"
                />
              </div>
              <div>
                <select
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                  className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none text-gray-300"
                >
                  <option value="">All Source Files ({uniqueSourceFiles.length})</option>
                  {uniqueSourceFiles.map(fn => (
                    <option key={fn} value={fn}>{fn}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Table Area with Paginated Rendering */}
            <div className="flex-1 overflow-x-auto">
              {filteredEmails.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center h-full">
                  <XCircleIcon className="w-10 h-10 text-gray-500 mb-2" />
                  <p className="text-gray-400 text-xs">No emails found matching your filters.</p>
                </div>
              ) : (
                <div className="max-h-[340px] overflow-y-auto pr-1 custom-scrollbar">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 bg-gray-900/95 backdrop-blur-sm z-10">
                      <tr className="border-b border-gray-800 text-gray-400 font-semibold uppercase tracking-wider">
                        <th className="py-2.5 px-3">Email Address</th>
                        <th className="py-2.5 px-3">Domain</th>
                        <th className="py-2.5 px-3">Source Document(s)</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {paginatedEmails.map(item => (
                        <tr key={item.email} className="hover:bg-gray-800/30 transition-colors">
                          <td className="py-2 px-3 font-semibold text-gray-100 select-all truncate max-w-[180px]" title={item.email}>
                            {item.email}
                          </td>
                          <td className="py-2 px-3 text-gray-400 select-all font-mono text-[11px]">
                            {item.domain}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {item.sourceFiles.map(src => (
                                <span key={src} className="inline-block px-1.5 py-0.5 bg-gray-700/80 text-gray-300 rounded text-[10px] truncate max-w-[120px]" title={src}>
                                  {src}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              onClick={() => handleRemoveEmail(item.email)}
                              className="text-gray-500 hover:text-red-400 p-1 rounded transition-colors"
                              title="Delete Email"
                            >
                              <XCircleIcon className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Pagination Footer */}
            {filteredEmails.length > 0 && (
              <div className="border-t border-gray-800 pt-3 mt-3 flex flex-wrap items-center justify-between text-xs text-gray-400 gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  <span>
                    Showing <strong className="text-gray-200">{(currentPage - 1) * pageSize + 1}</strong> - <strong className="text-gray-200">{Math.min(currentPage * pageSize, filteredEmails.length)}</strong> of <strong className="text-teal-400 font-mono">{filteredEmails.length.toLocaleString()}</strong> unique emails
                  </span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded px-1.5 py-0.5"
                  >
                    <option value={25}>25 / page</option>
                    <option value={50}>50 / page</option>
                    <option value={100}>100 / page</option>
                    <option value={250}>250 / page</option>
                  </select>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      className="px-2 py-0.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded text-gray-300"
                    >
                      &laquo;
                    </button>
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-2 py-0.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded text-gray-300"
                    >
                      &lsaquo;
                    </button>
                    <span className="font-mono text-gray-300 px-2">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-2 py-0.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded text-gray-300"
                    >
                      &rsaquo;
                    </button>
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                      className="px-2 py-0.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded text-gray-300"
                    >
                      &raquo;
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>

        </div>
      )}

    </div>
  );
};
