import React, { useState } from 'react';
import {
  Activity,
  ShieldCheck,
  Lock,
  Wifi,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Gauge,
  Zap,
  Server,
  Clock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Info
} from 'lucide-react';
import { SmtpConfig, DeliverabilityAudit } from '../types';
import { SmtpHealthCheckResult } from '../services/smtpIntelligenceService';

interface SmtpHealthCheckerProps {
  smtpConfig?: SmtpConfig;
  config?: SmtpConfig;
  healthResult?: SmtpHealthCheckResult | null;
  result?: SmtpHealthCheckResult | null;
  isChecking?: boolean;
  isRunning?: boolean;
  onRunCheck?: () => void;
  onRunHealthCheck?: () => void;
  domainAudit?: DeliverabilityAudit | null;
}

export const SmtpHealthChecker: React.FC<SmtpHealthCheckerProps> = ({
  smtpConfig: propSmtpConfig,
  config,
  healthResult: propHealthResult,
  result,
  isChecking: propIsChecking,
  isRunning,
  onRunCheck,
  onRunHealthCheck,
  domainAudit,
}) => {
  const [showProbesDetail, setShowProbesDetail] = useState(false);

  const activeSmtpConfig: SmtpConfig = propSmtpConfig || config || {
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    preset: 'custom',
  };

  const activeHealthResult = propHealthResult !== undefined ? propHealthResult : (result ?? null);
  const activeIsChecking = Boolean(propIsChecking || isRunning);
  const handleRunCheck = onRunCheck || onRunHealthCheck || (() => {});

  const isConfigured = Boolean(
    activeSmtpConfig?.host &&
    activeSmtpConfig?.port &&
    activeSmtpConfig?.user &&
    activeSmtpConfig?.pass
  );

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                SMTP Health Checker
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono font-normal uppercase tracking-wider">
                  Diagnostic Probe
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Multi-probe verification of connection latency, TLS encryption negotiation, and authentication integrity.
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRunCheck}
          disabled={activeIsChecking || !isConfigured}
          className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-all shadow-md ${
            activeIsChecking
              ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/50 cursor-wait'
              : !isConfigured
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white shadow-indigo-900/40 hover:shadow-indigo-800/60'
          }`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${activeIsChecking ? 'animate-spin text-cyan-300' : ''}`} />
          {activeIsChecking ? 'Probing Handshakes...' : 'Run Health Diagnostic'}
        </button>
      </div>

      {!isConfigured && (
        <div className="p-3.5 rounded-lg bg-amber-950/30 border border-amber-800/40 flex items-start gap-3">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200/90 leading-relaxed">
            Fill in the SMTP Host, Port, Username, and Password above to perform real-time health checks, latency measurement, and cryptographic handshake verification.
          </p>
        </div>
      )}

      {/* When checking */}
      {activeIsChecking && (
        <div className="p-6 rounded-xl bg-slate-950/60 border border-indigo-500/20 flex flex-col items-center justify-center text-center space-y-3 animate-pulse">
          <div className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-cyan-400 animate-spin" />
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-slate-200">Executing Sequential SMTP Probes</h4>
            <p className="text-xs text-slate-400">
              Benchmarking socket latency to <span className="font-mono text-cyan-400">{activeSmtpConfig?.host || 'smtp.server'}:{activeSmtpConfig?.port || 587}</span>, verifying TLS cipher suite, and validating AUTH credentials...
            </p>
          </div>
        </div>
      )}

      {/* Result Display */}
      {activeHealthResult && !activeIsChecking && (
        <div className="space-y-4">
          {/* Main Strength Score & Grade Banner */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4 w-full md:w-auto">
              <div className="relative flex items-center justify-center">
                <div
                  className={`w-16 h-16 rounded-full border-4 flex flex-col items-center justify-center shadow-inner ${
                    activeHealthResult.strengthScore >= 80
                      ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-400'
                      : activeHealthResult.strengthScore >= 60
                      ? 'border-blue-500/40 bg-blue-950/30 text-blue-400'
                      : activeHealthResult.strengthScore >= 40
                      ? 'border-amber-500/40 bg-amber-950/30 text-amber-400'
                      : 'border-rose-500/40 bg-rose-950/30 text-rose-400'
                  }`}
                >
                  <span className="text-xl font-black tracking-tight">{activeHealthResult.strengthScore}</span>
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Score</span>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${activeHealthResult.gradeColor}`}
                  >
                    Grade {activeHealthResult.grade}
                  </span>
                  <span className="text-xs font-semibold text-slate-300">
                    {activeHealthResult.strengthScore >= 80
                      ? 'High Reliability Configuration'
                      : activeHealthResult.strengthScore >= 60
                      ? 'Moderate Health Configuration'
                      : 'Attention Required'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1 max-w-md">
                  {activeHealthResult.message}
                </p>
              </div>
            </div>

            {/* Score Progress Bar */}
            <div className="w-full md:w-48 flex flex-col gap-1.5">
              <div className="flex justify-between text-[11px] font-medium text-slate-400">
                <span>Strength Index</span>
                <span className="text-slate-200 font-mono">{activeHealthResult.strengthScore}%</span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-700 rounded-full ${
                    activeHealthResult.strengthScore >= 80
                      ? 'bg-gradient-to-r from-teal-500 to-emerald-400'
                      : activeHealthResult.strengthScore >= 60
                      ? 'bg-gradient-to-r from-blue-500 to-cyan-400'
                      : activeHealthResult.strengthScore >= 40
                      ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                      : 'bg-gradient-to-r from-rose-600 to-rose-400'
                  }`}
                  style={{ width: `${activeHealthResult.strengthScore}%` }}
                />
              </div>
            </div>
          </div>

          {/* Real-time Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Metric 1: Latency */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-colors">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  Round-Trip Latency
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                    activeHealthResult.metrics.latency.avgMs < 300
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50'
                      : activeHealthResult.metrics.latency.avgMs < 800
                      ? 'bg-blue-950 text-blue-300 border border-blue-800/50'
                      : 'bg-amber-950 text-amber-300 border border-amber-800/50'
                  }`}
                >
                  {activeHealthResult.metrics.latency.rating.replace('_', ' ')}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold font-mono text-white">
                  {activeHealthResult.metrics.latency.avgMs}
                </span>
                <span className="text-xs text-slate-400">ms avg</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500 font-mono flex items-center justify-between">
                <span>Min: {activeHealthResult.metrics.latency.minMs}ms</span>
                <span>Max: {activeHealthResult.metrics.latency.maxMs}ms</span>
                <span>±{activeHealthResult.metrics.latency.jitterMs}ms jitter</span>
              </div>
            </div>

            {/* Metric 2: TLS Verification */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-colors">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  TLS Support Verification
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-emerald-950 text-emerald-300 border border-emerald-800/50">
                  {activeHealthResult.metrics.tls.supported ? 'Verified' : 'Unencrypted'}
                </span>
              </div>
              <div className="text-sm font-semibold text-white truncate">
                {activeHealthResult.metrics.tls.protocol || 'Encrypted Channel'}
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex flex-col gap-0.5">
                <span className="truncate">{activeHealthResult.metrics.tls.secureType}</span>
                <span className="text-slate-500 text-[10px] truncate">{activeHealthResult.metrics.tls.cipher}</span>
              </div>
            </div>

            {/* Metric 3: Authentication Success Rate */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-colors">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                  Authentication Success
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-medium ${
                    activeHealthResult.metrics.authentication.successRate === 100
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50'
                      : activeHealthResult.metrics.authentication.successRate > 0
                      ? 'bg-amber-950 text-amber-300 border border-amber-800/50'
                      : 'bg-rose-950 text-rose-300 border border-rose-800/50'
                  }`}
                >
                  {activeHealthResult.metrics.authentication.successRate}% Rate
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold font-mono text-white">
                  {activeHealthResult.metrics.authentication.successes}
                </span>
                <span className="text-xs text-slate-400">
                  / {activeHealthResult.metrics.authentication.attempts} probes passed
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
                {activeHealthResult.metrics.authentication.successRate === 100 ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Credentials Verified (250 OK)
                  </span>
                ) : (
                  <span className="text-rose-400 flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> Handshake Incomplete (535 Auth Error)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Expandable Probe Log */}
          <div className="border border-slate-800/80 rounded-lg overflow-hidden bg-slate-950/40">
            <button
              type="button"
              onClick={() => setShowProbesDetail(!showProbesDetail)}
              className="w-full px-3.5 py-2.5 text-xs text-slate-400 hover:text-slate-200 flex items-center justify-between transition-colors"
            >
              <span className="flex items-center gap-2 font-medium">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Individual Probe Log ({activeHealthResult.probes.length} Sequential Handshakes)
              </span>
              {showProbesDetail ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showProbesDetail && (
              <div className="p-3.5 border-t border-slate-800/80 space-y-2 bg-slate-950/70">
                {activeHealthResult.probes.map(probe => (
                  <div
                    key={probe.probe}
                    className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded bg-slate-900/60 border border-slate-800"
                  >
                    <div className="flex items-center gap-2">
                      {probe.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-rose-400" />
                      )}
                      <span className="font-mono text-slate-300">Probe #{probe.probe}</span>
                      <span className="text-slate-500">•</span>
                      <span className={probe.success ? 'text-emerald-300' : 'text-rose-300'}>
                        {probe.success ? 'SMTP Handshake 250 Accepted' : probe.error || 'Failed'}
                      </span>
                    </div>
                    <span className="font-mono text-slate-400">{probe.latencyMs} ms</span>
                  </div>
                ))}

                {domainAudit && (
                  <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                    <span>Sender Domain: <span className="text-slate-200 font-mono">{domainAudit.domain}</span></span>
                    <div className="flex items-center gap-2 font-mono">
                      <span className={domainAudit.hasMx ? 'text-emerald-400' : 'text-slate-600'}>MX {domainAudit.hasMx ? '✓' : '✗'}</span>
                      <span className={domainAudit.hasSpf ? 'text-emerald-400' : 'text-slate-600'}>SPF {domainAudit.hasSpf ? '✓' : '✗'}</span>
                      <span className={domainAudit.hasDmarc ? 'text-emerald-400' : 'text-slate-600'}>DMARC {domainAudit.hasDmarc ? '✓' : '✗'}</span>
                    </div>
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
