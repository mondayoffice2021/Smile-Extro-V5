import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  Info,
  Layers,
  ShieldAlert,
  Zap,
  Split,
  ChevronRight
} from 'lucide-react';
import { SmtpConfig } from '../types';
import { estimateSendingLimits, SendingLimitEstimate } from '../services/smtpIntelligenceService';

interface SendingLimitEstimatorProps {
  smtpConfig?: SmtpConfig;
  config?: SmtpConfig;
  queueSize?: number;
  currentBatchSize?: number;
  host?: string;
  providerSpec?: any;
  onApplySafeBatchSize?: (safeBatchSize: number) => void;
  onSafeBatchApply?: (safeBatchSize: number) => void;
}

export const SendingLimitEstimator: React.FC<SendingLimitEstimatorProps> = ({
  smtpConfig: propSmtpConfig,
  config,
  queueSize: propQueueSize,
  currentBatchSize,
  host,
  providerSpec,
  onApplySafeBatchSize,
  onSafeBatchApply,
}) => {
  const activeSmtpConfig: SmtpConfig = propSmtpConfig || config || {
    host: host || '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    preset: providerSpec?.id || 'custom',
  };

  const activeQueueSize = typeof propQueueSize === 'number'
    ? propQueueSize
    : (typeof currentBatchSize === 'number' ? currentBatchSize : 0);

  const handleApply = onApplySafeBatchSize || onSafeBatchApply;

  const estimate: SendingLimitEstimate = estimateSendingLimits(activeSmtpConfig, activeQueueSize);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Gauge className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              Sending Limits & Batch Safety Estimator
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono uppercase tracking-wider">
                {estimate.providerName}
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Provider throughput constraints, safe blast thresholds, and delivery pacing diagnostics.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-md font-mono bg-slate-800 border border-slate-700 text-slate-300">
            Queue: <strong className="text-white">{activeQueueSize}</strong> recipients
          </span>
        </div>
      </div>

      {/* Threshold Warning Indicator Card */}
      <div
        className={`p-4 rounded-xl border flex items-start gap-3 transition-all ${
          estimate.severity === 'danger'
            ? 'bg-rose-950/40 border-rose-500/50 text-rose-200'
            : estimate.severity === 'warning'
            ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
            : 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
        }`}
      >
        <div className="shrink-0 mt-0.5">
          {estimate.severity === 'danger' ? (
            <ShieldAlert className="w-5 h-5 text-rose-400 animate-pulse" />
          ) : estimate.severity === 'warning' ? (
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          )}
        </div>

        <div className="flex-1 space-y-1.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="text-sm font-semibold tracking-wide">
              {estimate.headline}
            </h4>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider font-mono ${
                estimate.severity === 'danger'
                  ? 'bg-rose-500/30 text-rose-300 border border-rose-400/40'
                  : estimate.severity === 'warning'
                  ? 'bg-amber-500/30 text-amber-300 border border-amber-400/40'
                  : 'bg-emerald-500/30 text-emerald-300 border border-emerald-400/40'
              }`}
            >
              {estimate.severity === 'danger'
                ? 'High Risk of Block'
                : estimate.severity === 'warning'
                ? 'Batch Limit Exceeded'
                : 'Safe Volume'}
            </span>
          </div>

          <p className="text-xs leading-relaxed opacity-90">
            {estimate.warningMessage}
          </p>

          <p className="text-xs font-medium opacity-95 pt-0.5">
            <strong className="underline decoration-dotted">Recommendation:</strong> {estimate.safeBatchAdvice}
          </p>

          {/* Action button if warning/danger */}
          {(estimate.isBatchWarning || estimate.isDailyQuotaExceeded) && handleApply && (
            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleApply(estimate.recommendedSafeBatchSize)}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-900/90 hover:bg-slate-900 text-white border border-slate-700 hover:border-slate-500 flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <Split className="w-3.5 h-3.5 text-cyan-400" />
                Auto-Split into {estimate.recommendedBatchesCount} batches of ≤ {estimate.recommendedSafeBatchSize}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Numerical Metrics Matrix */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
        {/* Metric 1: Daily Quota */}
        <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <Gauge className="w-3.5 h-3.5 text-indigo-400" />
            Estimated Daily Quota
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-lg font-bold font-mono text-white">
              {estimate.estimatedDailyQuota.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-500">/ 24h</span>
          </div>
          <div className="text-[10px] text-slate-500 truncate mt-0.5">
            {estimate.tierLabel}
          </div>
        </div>

        {/* Metric 2: Safe Single Batch */}
        <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            Max Safe Batch
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-lg font-bold font-mono text-white">
              {estimate.recommendedSafeBatchSize}
            </span>
            <span className="text-[10px] text-slate-500">recipients</span>
          </div>
          <div className="text-[10px] text-slate-500 truncate mt-0.5">
            Per blast threshold
          </div>
        </div>

        {/* Metric 3: Safe Cadence Pacing */}
        <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            Recommended Pacing
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-lg font-bold font-mono text-white">
              {estimate.safePacingIntervalSeconds}s
            </span>
            <span className="text-[10px] text-slate-500">delay / email</span>
          </div>
          <div className="text-[10px] text-slate-500 truncate mt-0.5">
            Prevents greylisting
          </div>
        </div>

        {/* Metric 4: Estimated Duration */}
        <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            Estimated Send Time
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-lg font-bold font-mono text-white">
              {estimate.estimatedDurationFormatted}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 truncate mt-0.5">
            For {activeQueueSize} recipient{activeQueueSize === 1 ? '' : 's'}
          </div>
        </div>
      </div>
    </div>
  );
};
