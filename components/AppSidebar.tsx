import React from 'react';
import {
  Search,
  FileText,
  FolderOpen,
  Globe,
  Building2,
  Users,
  ShieldCheck,
  MapPin,
  Server,
  Send,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
  Settings,
  Maximize2,
  Minimize2,
} from 'lucide-react';

export type TabKey =
  | 'extractor'
  | 'file-text-extractor'
  | 'bulk-extractor'
  | 'bulk-url-opener'
  | 'analyzer'
  | 'supply-chain'
  | 'validator'
  | 'sorter'
  | 'mx-sorter'
  | 'email-sender';

export interface NavItem {
  key: TabKey;
  label: string;
  shortLabel?: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeStyle?: string;
  activeColor: string;
  hoverColor: string;
}

export interface NavSection {
  id: string;
  title: string;
  items: NavItem[];
}

interface AppSidebarProps {
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  leadsCount: number;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
  isFullScreen: boolean;
  onEnterFullScreen: () => void;
  onExitFullScreen: () => void;
  onOpenSettings: () => void;
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'extraction',
    title: 'Lead Extraction',
    items: [
      {
        key: 'extractor',
        label: 'Lead Extractor',
        shortLabel: 'Extractor',
        description: '1,000+ Crawler & Web Dorks',
        icon: Search,
        activeColor: 'bg-blue-600 text-white shadow-blue-500/20 shadow-lg border-blue-400/40',
        hoverColor: 'hover:bg-blue-950/40 hover:text-blue-300',
      },
      {
        key: 'file-text-extractor',
        label: 'File & Text Extractor',
        shortLabel: 'File & Text',
        description: 'Email, Phone & Webit Parser',
        icon: FileText,
        badge: 'Email • Phone',
        badgeStyle: 'bg-emerald-950 text-emerald-300 border-emerald-500/40',
        activeColor: 'bg-emerald-600 text-white shadow-emerald-500/20 shadow-lg border-emerald-400/40',
        hoverColor: 'hover:bg-emerald-950/40 hover:text-emerald-300',
      },
      {
        key: 'bulk-extractor',
        label: 'Folder & Bulk Files',
        shortLabel: 'Folders',
        description: 'Recursive Disk & Document Harvester',
        icon: FolderOpen,
        activeColor: 'bg-teal-600 text-white shadow-teal-500/20 shadow-lg border-teal-400/40',
        hoverColor: 'hover:bg-teal-950/40 hover:text-teal-300',
      },
      {
        key: 'bulk-url-opener',
        label: 'Bulk URL Opener',
        shortLabel: 'URL Opener',
        description: 'Multi-Tab Browser Spider',
        icon: Globe,
        activeColor: 'bg-cyan-600 text-white shadow-cyan-500/20 shadow-lg border-cyan-400/40',
        hoverColor: 'hover:bg-cyan-950/40 hover:text-cyan-300',
      },
    ],
  },
  {
    id: 'intelligence',
    title: 'Intelligence & Research',
    items: [
      {
        key: 'analyzer',
        label: 'Industry Analyzer',
        shortLabel: 'Analyzer',
        description: 'Google + Meta Company Intelligence',
        icon: Building2,
        badge: 'Google+Meta',
        badgeStyle: 'bg-purple-950 text-purple-300 border-purple-500/40',
        activeColor: 'bg-purple-600 text-white shadow-purple-500/20 shadow-lg border-purple-400/40',
        hoverColor: 'hover:bg-purple-950/40 hover:text-purple-300',
      },
      {
        key: 'supply-chain',
        label: 'CEO & Executive Search',
        shortLabel: 'CEO Search',
        description: 'B2B Leadership & Decision Makers',
        icon: Users,
        activeColor: 'bg-violet-700 text-white shadow-violet-500/20 shadow-lg border-violet-400/40',
        hoverColor: 'hover:bg-violet-950/40 hover:text-violet-300',
      },
    ],
  },
  {
    id: 'verification',
    title: 'Hygiene & Sorting',
    items: [
      {
        key: 'validator',
        label: 'Sorter & Validator',
        shortLabel: 'Validator',
        description: 'Real-time SMTP & Syntax Verification',
        icon: ShieldCheck,
        badge: 'Hygiene',
        badgeStyle: 'bg-amber-950 text-amber-300 border-amber-500/40',
        activeColor: 'bg-orange-600 text-white shadow-orange-500/20 shadow-lg border-orange-400/40',
        hoverColor: 'hover:bg-orange-950/40 hover:text-orange-300',
      },
      {
        key: 'sorter',
        label: 'Country Sorter',
        shortLabel: 'Country',
        description: 'Geographical & TLD Segmentation',
        icon: MapPin,
        activeColor: 'bg-sky-600 text-white shadow-sky-500/20 shadow-lg border-sky-400/40',
        hoverColor: 'hover:bg-sky-950/40 hover:text-sky-300',
      },
      {
        key: 'mx-sorter',
        label: 'MX Mailserver Sorter',
        shortLabel: 'MX Sorter',
        description: 'DNS Provider & Host Grouping',
        icon: Server,
        activeColor: 'bg-indigo-700 text-white shadow-indigo-500/20 shadow-lg border-indigo-400/40',
        hoverColor: 'hover:bg-indigo-950/40 hover:text-indigo-300',
      },
    ],
  },
  {
    id: 'campaign',
    title: 'Outreach & Delivery',
    items: [
      {
        key: 'email-sender',
        label: 'SMTP Inbox Sender',
        shortLabel: 'SMTP Sender',
        description: '1-by-1 Paced Delivery & Health Suite',
        icon: Send,
        badge: '1-by-1',
        badgeStyle: 'bg-emerald-950 text-emerald-300 border-emerald-500/40 font-semibold',
        activeColor: 'bg-gradient-to-r from-blue-600 via-indigo-600 to-teal-600 text-white shadow-blue-500/30 shadow-lg border-blue-400/50',
        hoverColor: 'hover:bg-blue-950/40 hover:text-blue-300',
      },
    ],
  },
];

export function getActiveTabInfo(activeTab: TabKey) {
  for (const section of NAV_SECTIONS) {
    const found = section.items.find(item => item.key === activeTab);
    if (found) {
      return {
        ...found,
        category: section.title,
      };
    }
  }
  return {
    key: 'extractor' as TabKey,
    label: 'Lead Extractor',
    shortLabel: 'Extractor',
    category: 'Lead Extraction',
    description: '1,000+ Crawler & Web Dorks',
    icon: Search,
    activeColor: 'bg-blue-600 text-white',
    hoverColor: 'hover:bg-blue-900',
  };
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  activeTab,
  setActiveTab,
  leadsCount,
  isCollapsed,
  setIsCollapsed,
  isMobileOpen,
  setIsMobileOpen,
  isFullScreen,
  onEnterFullScreen,
  onExitFullScreen,
  onOpenSettings,
}) => {
  const handleSelectTab = (key: TabKey) => {
    setActiveTab(key);
    if (isMobileOpen) {
      setIsMobileOpen(false);
    }
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden transition-opacity"
          onClick={() => setIsMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen z-50 flex flex-col bg-slate-900 border-r border-slate-800 transition-all duration-300 ease-in-out shadow-2xl ${
          isCollapsed ? 'w-20' : 'w-72'
        } ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand / Logo Area */}
        <div className="h-16 px-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-950/40">
          <div
            className={`flex items-center gap-3 cursor-pointer overflow-hidden transition-all ${
              isCollapsed ? 'justify-center w-full' : ''
            }`}
            onClick={() => handleSelectTab('extractor')}
            title="Email Extractor Pro"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-400 flex items-center justify-center shadow-lg shadow-blue-500/20 shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            {!isCollapsed && (
              <div className="min-w-0 flex-1">
                <h1 className="text-base font-extrabold text-white tracking-tight truncate leading-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-slate-300">
                  Email Extractor Pro
                </h1>
                <p className="text-[11px] text-slate-400 truncate">Lead Engine & Outreach</p>
              </div>
            )}
          </div>

          {/* Close button on mobile */}
          <button
            type="button"
            onClick={() => setIsMobileOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 lg:hidden"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Leads Counter Pill */}
        {!isCollapsed ? (
          <div className="px-4 py-3 border-b border-slate-800/80 bg-slate-950/20 shrink-0">
            <button
              type="button"
              onClick={() => handleSelectTab('extractor')}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-slate-700 transition group"
            >
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${leadsCount > 0 ? 'bg-emerald-400' : 'bg-blue-400'} opacity-75`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${leadsCount > 0 ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
                </span>
                <span className="text-xs font-medium text-slate-400 group-hover:text-slate-200">Harvested Leads</span>
              </div>
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-md border ${
                leadsCount > 0 
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40' 
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}>
                {leadsCount.toLocaleString()}
              </span>
            </button>
          </div>
        ) : (
          <div className="py-2 flex justify-center border-b border-slate-800/80 shrink-0" title={`${leadsCount} Harvested Leads`}>
            <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded border ${
              leadsCount > 0 
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40' 
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}>
              {leadsCount > 999 ? `${(leadsCount/1000).toFixed(1)}k` : leadsCount}
            </span>
          </div>
        )}

        {/* Navigation Categories & Items (Scrollable) */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5 custom-scrollbar">
          {NAV_SECTIONS.map((section) => (
            <div key={section.id} className="space-y-1">
              {/* Category Header */}
              {!isCollapsed ? (
                <div className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {section.title}
                </div>
              ) : (
                <div className="my-2 border-t border-slate-800/60" />
              )}

              {/* Items */}
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.key;
                  const isLeadExtractorWithCount = item.key === 'extractor' && leadsCount > 0;

                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => handleSelectTab(item.key)}
                      title={isCollapsed ? `${item.label} — ${item.description}` : undefined}
                      className={`w-full group flex items-center rounded-xl text-xs font-semibold transition-all duration-150 border ${
                        isActive
                          ? `${item.activeColor} ring-1 ring-white/10`
                          : `text-slate-400 border-transparent hover:text-slate-100 hover:bg-slate-800/60`
                      } ${isCollapsed ? 'justify-center p-2.5' : 'p-2.5 gap-3'}`}
                    >
                      <div
                        className={`p-1.5 rounded-lg shrink-0 transition-colors ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-800/80 text-slate-400 group-hover:text-slate-200 group-hover:bg-slate-800'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>

                      {!isCollapsed && (
                        <div className="flex-1 min-w-0 text-left">
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate font-bold tracking-tight">
                              {item.label}
                            </span>
                            {/* Badges */}
                            {item.badge && (
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded border shrink-0 ${
                                  isActive
                                    ? 'bg-white/20 text-white border-white/30'
                                    : item.badgeStyle || 'bg-slate-800 text-slate-300 border-slate-700'
                                }`}
                              >
                                {item.badge}
                              </span>
                            )}
                            {isLeadExtractorWithCount && (
                              <span
                                className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold shrink-0 ${
                                  isActive
                                    ? 'bg-white/25 text-white'
                                    : 'bg-blue-950 text-blue-300 border border-blue-500/40'
                                }`}
                              >
                                {leadsCount}
                              </span>
                            )}
                          </div>
                          <p
                            className={`text-[10px] truncate leading-normal ${
                              isActive ? 'text-white/80' : 'text-slate-400 group-hover:text-slate-300'
                            }`}
                          >
                            {item.description}
                          </p>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom System Actions & Collapse Controls */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/50 space-y-2 shrink-0">
          {/* Quick Controls Grid */}
          <div className={`grid ${isCollapsed ? 'grid-cols-1 gap-2' : 'grid-cols-2 gap-1.5'}`}>
            {/* Fullscreen Button */}
            <button
              type="button"
              onClick={isFullScreen ? onExitFullScreen : onEnterFullScreen}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium border transition ${
                isFullScreen
                  ? 'bg-amber-950/60 border-amber-500/40 text-amber-300 hover:bg-amber-900/60'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
              title={isFullScreen ? 'Exit Full Screen (Esc)' : 'Enter Full Screen'}
            >
              {isFullScreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-amber-400" />
                  {!isCollapsed && <span>Reduce</span>}
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-blue-400" />
                  {!isCollapsed && <span>Full View</span>}
                </>
              )}
            </button>

            {/* Settings Button */}
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition"
              title="API Keys & Settings"
            >
              <Settings className="w-3.5 h-3.5 text-slate-400" />
              {!isCollapsed && <span>Settings</span>}
            </button>
          </div>

          {/* Desktop Collapse / Expand Toggle */}
          <div className="hidden lg:block pt-1">
            <button
              type="button"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="w-full flex items-center justify-center gap-2 py-1.5 px-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition"
              title={isCollapsed ? 'Expand menu bar' : 'Collapse menu bar to icon rail'}
            >
              {isCollapsed ? (
                <>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </>
              ) : (
                <>
                  <ChevronLeft className="w-4 h-4 text-slate-400" />
                  <span className="text-[11px]">Collapse Menu</span>
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
