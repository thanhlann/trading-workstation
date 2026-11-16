import { Activity, Camera, Check, Copy, Maximize2, Minimize2, MoreHorizontal, Settings2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MARKET_SYMBOLS } from '../../config/marketSymbols';
import { SYSTEM_CONFIG } from '../../config/system';
import type { ChartPanelViewProps } from './ChartPanelView.types';

export function ChartPanelView({
  panelId,
  symbol,
  timeframe,
  subtitle,
  chartHostRef,
  showSwings,
  onShowSwingsChange,
  showFVG,
  onShowFVGChange,
  showOB,
  onShowOBChange,
  keepDraw,
  onKeepDrawChange,
  expanded,
  onToggleExpanded,
  statusLabel,
  currentCandle,
  poiLabels,
  selectedCandle,
  onCloseCandleTooltip,
  toolbarContent,
}: ChartPanelViewProps) {
  const [copiedTimestamp, setCopiedTimestamp] = useState<number | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    if (copiedTimestamp === null) return;
    const timeoutId = window.setTimeout(() => setCopiedTimestamp(null), 1500);
    return () => window.clearTimeout(timeoutId);
  }, [copiedTimestamp]);

  const formatValue = (value: number | null, digits = 2) => value === null
    ? '--'
    : value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const timestampCopied = selectedCandle !== null
    && copiedTimestamp === selectedCandle.data.timestampMilliseconds;

  const copyTimestamp = async (timestamp: number) => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(String(timestamp));
      setCopiedTimestamp(timestamp);
    } catch (error) {
      console.error('Unable to copy candle timestamp.', error);
      setCopyFailed(true);
    }
  };

  return (
    <section className={`chart-panel${expanded ? ' chart-panel--expanded' : ''}`}>
      <header className="chart-panel__header">
        <div className="chart-heading">
          <span className="symbol-mark">{MARKET_SYMBOLS[symbol].icon}</span>
          <div>
            <div className="chart-title">{symbol} <span className="market-dot" /></div>
            <div className="chart-subtitle">{subtitle}</div>
          </div>
        </div>
        <div className="chart-actions">
          <span className="timeframe-chip">{timeframe}</span>
          <button className="icon-button" title={SYSTEM_CONFIG.ui.chart.settingsTitle}><Settings2 size={15} /></button>
          <button className="icon-button" title={SYSTEM_CONFIG.ui.chart.screenshotTitle}><Camera size={15} /></button>
          <button className="icon-button" title={SYSTEM_CONFIG.ui.chart.moreTitle}><MoreHorizontal size={16} /></button>
          <button
            className="icon-button expand-chart"
            title={expanded ? SYSTEM_CONFIG.ui.chart.restoreTitle : SYSTEM_CONFIG.ui.chart.expandTitle}
            aria-label={expanded ? SYSTEM_CONFIG.ui.chart.restoreTitle : SYSTEM_CONFIG.ui.chart.expandTitle}
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </header>

      <div className="chart-toolbar">
        {toolbarContent ?? (
          <>
            <label className="mini-toggle"><input type="checkbox" checked={showSwings} onChange={(event) => onShowSwingsChange(event.target.checked)} /> {SYSTEM_CONFIG.ui.chart.swings}</label>
            <label className="mini-toggle"><input type="checkbox" checked={showFVG} onChange={(event) => onShowFVGChange(event.target.checked)} /> {SYSTEM_CONFIG.ui.chart.fvg}</label>
            <label className="mini-toggle"><input type="checkbox" checked={showOB} onChange={(event) => onShowOBChange(event.target.checked)} /> {SYSTEM_CONFIG.ui.chart.ob}</label>
            <span className="chart-toolbar__separator" role="separator" aria-orientation="vertical" />
            <label className="mini-toggle"><input type="checkbox" checked={keepDraw} onChange={(event) => onKeepDrawChange(event.target.checked)} /> {SYSTEM_CONFIG.ui.chart.keepDraw}</label>
            <span className="toolbar-spacer" />
            <span className="chart-status"><Activity size={12} /> {statusLabel}</span>
            <span className="sr-only">{panelId}-{showSwings}-{showFVG}-{showOB}</span>
          </>
        )}
      </div>

      <div className="chart-canvas-wrap">
        <div className="chart-canvas" ref={chartHostRef} />
        {poiLabels.map((label) => (
          <span
            key={label.timeframe}
            className={`chart-poi-label chart-poi-label--${label.timeframe}`}
            style={{
              left: label.left,
              top: label.top,
              color: label.color,
            }}
            aria-hidden="true"
          >
            {label.text}
          </span>
        ))}
        <div className="chart-watermark">{SYSTEM_CONFIG.ui.chart.watermark}</div>
        {selectedCandle && (
          <aside
            className="candle-tooltip"
            style={{ left: selectedCandle.left, top: selectedCandle.top }}
            aria-label="Selected candle details"
          >
            <header className="candle-tooltip__header">
              <strong>{symbol.replace(/(USDT)$/, '-$1')} | {timeframe.toUpperCase()}</strong>
              <button type="button" className="candle-tooltip__close" aria-label="Close candle details" onClick={onCloseCandleTooltip}>
                <X size={14} />
              </button>
            </header>
            <div className="candle-tooltip__time">
              <button
                type="button"
                className={`candle-tooltip__time-copy${timestampCopied ? ' candle-tooltip__time-copy--copied' : ''}`}
                title={copyFailed ? 'Copy failed' : timestampCopied ? 'Timestamp copied' : 'Copy timestamp'}
                aria-label={`${timestampCopied ? 'Timestamp copied' : 'Copy timestamp'} ${selectedCandle.data.timestampMilliseconds}`}
                onClick={() => void copyTimestamp(selectedCandle.data.timestampMilliseconds)}
              >
                <span>Time: <strong>{selectedCandle.data.timestampMilliseconds}</strong></span>
                {timestampCopied
                  ? <Check className="candle-tooltip__copy-icon" size={11} />
                  : <Copy className="candle-tooltip__copy-icon" size={11} />}
              </button>
              <span><strong>{selectedCandle.data.timestamp}</strong></span>
              {copyFailed && <span className="candle-tooltip__copy-error" role="status">Copy failed</span>}
            </div>
            <div className="candle-tooltip__grid">
              <span>Open: <strong>{formatValue(selectedCandle.data.open)}</strong></span>
              <span>High: <strong>{formatValue(selectedCandle.data.high)}</strong></span>
              <span>Low: <strong>{formatValue(selectedCandle.data.low)}</strong></span>
              <span>Close: <strong>{formatValue(selectedCandle.data.close)}</strong></span>
              <span>Upper wick: <strong>{formatValue(selectedCandle.data.upperWick)}</strong></span>
              <span>Lower wick: <strong>{formatValue(selectedCandle.data.lowerWick)}</strong></span>
              <span>Body: <strong>{formatValue(selectedCandle.data.body)}</strong></span>
              <span>Body ratio: <strong>{formatValue(selectedCandle.data.bodyRatio)}</strong></span>
              <span>Range: <strong>{formatValue(selectedCandle.data.range)}</strong></span>
              <span>Range atr: <strong>{formatValue(selectedCandle.data.rangeAtr)}</strong></span>
              <span>Volume: <strong>{formatValue(selectedCandle.data.volume)}</strong></span>
            </div>
            <footer className="candle-tooltip__indicators">
              <span>ATR: <strong>{formatValue(selectedCandle.data.atr)}</strong></span>
              <span>RSI: <strong>{formatValue(selectedCandle.data.rsi)}</strong></span>
              <span>Vol ratio: <strong>{formatValue(selectedCandle.data.volumeRatio)}</strong></span>
            </footer>
          </aside>
        )}
      </div>
      <footer className="chart-panel__footer">
        <span>{SYSTEM_CONFIG.ui.chart.open} <b>{currentCandle?.open ?? '--'}</b></span>
        <span>{SYSTEM_CONFIG.ui.chart.high} <b className="positive">{currentCandle?.high ?? '--'}</b></span>
        <span>{SYSTEM_CONFIG.ui.chart.low} <b className="negative">{currentCandle?.low ?? '--'}</b></span>
        <span>{SYSTEM_CONFIG.ui.chart.close} <b>{currentCandle?.close ?? '--'}</b></span>
      </footer>
    </section>
  );
}
