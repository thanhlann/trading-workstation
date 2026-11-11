import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { SYSTEM_CONFIG } from '../../config/system';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { parseBacktestTimeRange } from './backtestTimeRange';
import type { BacktestTrade } from './backtestData';
import { TradeNotes } from './TradeNotes';
import { getTradeNoteId } from './tradeNotesStorage';

const REPLAY_SPEEDS = [1, 2, 5, 10] as const;
const PRICE_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const USDT_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const PERCENT_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const TRADE_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const TRADE_DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

interface BacktestReplayControlsProps {
  marketStructureNumber: number | null;
  marketStructureCount: number;
  tradeProgressNumber: number | null;
  tradeCount: number;
  marketStructureNumbers: number[];
  marketStructureTimes: number[];
  tradeSearchTargets: { number: number; marketStructureTime: number }[];
  quickFilter: 'all' | 'setup';
  onQuickFilterChange: (filter: 'all' | 'setup') => void;
  showSetupFilter: boolean;
  setupOptions: { id: string; number: number }[];
  selectedSetupId: string;
  onSelectedSetupChange: (setupId: string) => void;
  showTradeControls: boolean;
  tradeFilterActive: boolean;
  onTradeFilterChange: (active: boolean) => void;
  tradeSummary: {
    count: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
    currentBalance: number;
    startTime: number | null;
    endTime: number | null;
  };
  selectedTrade: BacktestTrade | null;
  selectedTradeExitType: 'TP' | 'SL' | null;
}

function formatPrice(value: number): string {
  return PRICE_FORMAT.format(value);
}

function formatUsdt(value: number): string {
  return `${USDT_FORMAT.format(value)} USDT`;
}

function formatSignedUsdt(value: number): string {
  return `${value > 0 ? '+' : ''}${formatUsdt(value)}`;
}

function formatPercent(value: number): string {
  return `${PERCENT_FORMAT.format(value)}%`;
}

function formatTradeDate(value: number, includeTime = false): string {
  const formatter = includeTime ? TRADE_DATE_TIME_FORMAT : TRADE_DATE_FORMAT;
  return formatter.format(new Date(value * 1000));
}

export function BacktestReplayControls({
  marketStructureNumber,
  marketStructureCount,
  tradeProgressNumber,
  tradeCount,
  marketStructureNumbers,
  marketStructureTimes,
  tradeSearchTargets,
  quickFilter,
  onQuickFilterChange,
  showSetupFilter,
  setupOptions,
  selectedSetupId,
  onSelectedSetupChange,
  showTradeControls,
  tradeFilterActive,
  onTradeFilterChange,
  tradeSummary,
  selectedTrade,
  selectedTradeExitType,
}: BacktestReplayControlsProps) {
  const [searchError, setSearchError] = useState('');
  const [setupDropdownOpen, setSetupDropdownOpen] = useState(false);
  const [tradeDetailsExpanded, setTradeDetailsExpanded] = useState(false);
  const setupDropdownRef = useRef<HTMLDivElement>(null);
  const setupTriggerRef = useRef<HTMLButtonElement>(null);
  const setupOptionsRef = useRef<HTMLDivElement>(null);
  const tradeDetailsContentId = useId();
  const timeframe = useWorkspaceStore((state) => state.backtestTimeframe);
  const searchValue = useWorkspaceStore((state) => (
    timeframe === 'htf' ? state.backtestHtfSearchValue : state.backtestLtfSearchValue
  ));
  const replayIndex = useWorkspaceStore((state) => state.replayIndex);
  const replayLastIndex = useWorkspaceStore((state) => state.replayLastIndex);
  const replayPlaying = useWorkspaceStore((state) => state.replayPlaying);
  const autoReplay = useWorkspaceStore((state) => state.autoReplay);
  const replaySpeed = useWorkspaceStore((state) => state.replaySpeed);
  const setBacktestTimeframe = useWorkspaceStore((state) => state.setBacktestTimeframe);
  const setBacktestSearchValue = useWorkspaceStore((state) => state.setBacktestSearchValue);
  const timeRangeFrom = useWorkspaceStore((state) => state.backtestTimeRangeFrom);
  const timeRangeTo = useWorkspaceStore((state) => state.backtestTimeRangeTo);
  const setBacktestTimeRange = useWorkspaceStore((state) => state.setBacktestTimeRange);
  const setReplayIndex = useWorkspaceStore((state) => state.setReplayIndex);
  const jumpToReplayStart = useWorkspaceStore((state) => state.jumpToReplayStart);
  const jumpToReplayEnd = useWorkspaceStore((state) => state.jumpToReplayEnd);
  const toggleReplay = useWorkspaceStore((state) => state.toggleReplay);
  const setAutoReplay = useWorkspaceStore((state) => state.setAutoReplay);
  const setReplaySpeed = useWorkspaceStore((state) => state.setReplaySpeed);
  const hasReplayData = replayLastIndex >= 0;
  const isTradeSource = showTradeControls && tradeFilterActive;
  const progressMaximum = Math.max(isTradeSource ? tradeCount : marketStructureCount, 1);
  const progressCurrent = isTradeSource ? tradeProgressNumber : marketStructureNumber;
  const progressValue = Math.min(progressCurrent ?? 0, progressMaximum);
  const progressPercent = progressCurrent === null
    ? 0
    : (progressValue / progressMaximum) * 100;
  const parsedTimeRange = parseBacktestTimeRange(timeRangeFrom, timeRangeTo);
  const timeRangeError = parsedTimeRange.valid
    ? ''
    : parsedTimeRange.reason === 'reversed'
      ? SYSTEM_CONFIG.ui.backtestReplay.reversedTimeRange
      : SYSTEM_CONFIG.ui.backtestReplay.invalidTimeRange;
  const selectedTradeNoteId = selectedTrade
    ? getTradeNoteId(selectedTrade.symbol, selectedTrade.number, selectedTrade.time)
    : null;

  useEffect(() => {
    setTradeDetailsExpanded(false);
  }, [selectedTradeNoteId]);

  useEffect(() => {
    if (!setupDropdownOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !setupDropdownRef.current?.contains(event.target)) {
        setSetupDropdownOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [setupDropdownOpen]);

  useEffect(() => {
    if (setupDropdownOpen) {
      setupOptionsRef.current
        ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
        ?.focus();
    }
  }, [setupDropdownOpen]);

  const moveSetupFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    direction: 'next' | 'previous' | 'first' | 'last',
  ) => {
    const options = Array.from(
      setupOptionsRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    if (options.length === 0) return;

    const currentIndex = options.findIndex((option) => option === document.activeElement);
    const nextIndex = direction === 'first'
      ? 0
      : direction === 'last'
        ? options.length - 1
        : (currentIndex + (direction === 'next' ? 1 : -1) + options.length) % options.length;
    event.preventDefault();
    options[nextIndex].focus();
  };

  const handleSetupOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') moveSetupFocus(event, 'next');
    if (event.key === 'ArrowUp') moveSetupFocus(event, 'previous');
    if (event.key === 'Home') moveSetupFocus(event, 'first');
    if (event.key === 'End') moveSetupFocus(event, 'last');
    if (event.key === 'Escape') {
      event.preventDefault();
      setSetupDropdownOpen(false);
      setupTriggerRef.current?.focus();
    }
  };

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isTradeSource) {
      const tradeNumber = Number(searchValue.trim());
      if (!/^\d+$/.test(searchValue.trim()) || !Number.isSafeInteger(tradeNumber)) {
        setSearchError(SYSTEM_CONFIG.ui.backtestReplay.invalidTradeNumber);
        return;
      }

      const trade = tradeSearchTargets.find((target) => target.number === tradeNumber);
      const index = trade
        ? marketStructureTimes.indexOf(trade.marketStructureTime)
        : -1;
      if (index < 0) {
        setSearchError(SYSTEM_CONFIG.ui.backtestReplay.tradeNotFound);
        return;
      }

      setReplayIndex(index);
      setSearchError('');
      return;
    }

    const number = Number(searchValue);
    if (!searchValue.trim() || !Number.isInteger(number)) {
      setSearchError(SYSTEM_CONFIG.ui.backtestReplay.invalidNumber);
      return;
    }

    const index = marketStructureNumbers.indexOf(number);
    if (index < 0) {
      setSearchError(SYSTEM_CONFIG.ui.backtestReplay.numberNotFound);
      return;
    }

    setReplayIndex(index);
    setSearchError('');
  };

  return (
    <section className="backtest-replay" aria-label={SYSTEM_CONFIG.ui.backtestReplay.ariaLabel}>
      <header className="backtest-replay__header">
        <span className="backtest-replay__title">{SYSTEM_CONFIG.ui.backtestReplay.title}</span>
        <div className="backtest-replay__timeframes" role="group" aria-label={SYSTEM_CONFIG.ui.backtestReplay.timeframeAriaLabel}>
          <button
            type="button"
            className={timeframe === 'htf' ? 'backtest-replay__timeframe backtest-replay__timeframe--active' : 'backtest-replay__timeframe'}
            aria-pressed={timeframe === 'htf'}
            onClick={() => setBacktestTimeframe('htf')}
          >
            HTF
          </button>
          <button
            type="button"
            className={timeframe === 'ltf' ? 'backtest-replay__timeframe backtest-replay__timeframe--active' : 'backtest-replay__timeframe'}
            aria-pressed={timeframe === 'ltf'}
            onClick={() => setBacktestTimeframe('ltf')}
          >
            LTF
          </button>
        </div>
      </header>

      <div className="backtest-replay__search-field">
        <label className="backtest-replay__search-label" htmlFor="backtest-replay-search">
          {showTradeControls
            ? SYSTEM_CONFIG.ui.backtestReplay.tradeSearchLabel
            : SYSTEM_CONFIG.ui.backtestReplay.searchLabel}
        </label>
        <form className="backtest-replay__search" onSubmit={handleSearch}>
          <input
            id="backtest-replay-search"
            type={showTradeControls ? 'text' : 'number'}
            inputMode={showTradeControls ? 'numeric' : undefined}
            step={showTradeControls ? undefined : '1'}
            value={searchValue}
            aria-label=            {showTradeControls
              ? SYSTEM_CONFIG.ui.backtestReplay.tradeSearchAriaLabel
              : SYSTEM_CONFIG.ui.backtestReplay.searchAriaLabel}
            aria-invalid={Boolean(searchError)}
            aria-describedby={searchError ? 'backtest-replay-search-error' : undefined}
            placeholder={showTradeControls
              ? SYSTEM_CONFIG.ui.backtestReplay.tradeSearchPlaceholder
              : SYSTEM_CONFIG.ui.backtestReplay.searchPlaceholder}
            disabled={!hasReplayData}
            onChange={(event) => {
              setBacktestSearchValue(timeframe, event.target.value);
              setSearchError('');
            }}
          />
          <button
            type="submit"
            aria-label={showTradeControls
              ? SYSTEM_CONFIG.ui.backtestReplay.tradeSearchAriaLabel
              : SYSTEM_CONFIG.ui.backtestReplay.searchAriaLabel}
            title={showTradeControls
              ? SYSTEM_CONFIG.ui.backtestReplay.tradeSearchAriaLabel
              : SYSTEM_CONFIG.ui.backtestReplay.searchAriaLabel}
            disabled={!hasReplayData || !searchValue.trim()}
          >
            <Search size={13} />
          </button>
        </form>
      </div>
      {showTradeControls && (
        <div className="backtest-replay__time-range">
          <span className="backtest-replay__search-label">
            {SYSTEM_CONFIG.ui.backtestReplay.timeRangeLabel}
          </span>
          <div className="backtest-replay__time-range-fields">
            <label className="backtest-replay__time-range-field" htmlFor="backtest-time-range-from">
              {SYSTEM_CONFIG.ui.backtestReplay.timeRangeFromLabel}
              <input
                id="backtest-time-range-from"
                type="number"
                min="1"
                step="1"
                value={timeRangeFrom}
                aria-label={SYSTEM_CONFIG.ui.backtestReplay.timeRangeFromLabel}
                aria-invalid={Boolean(timeRangeError)}
                onChange={(event) => setBacktestTimeRange({ backtestTimeRangeFrom: event.target.value })}
              />
            </label>
            <label className="backtest-replay__time-range-field" htmlFor="backtest-time-range-to">
              {SYSTEM_CONFIG.ui.backtestReplay.timeRangeToLabel}
              <input
                id="backtest-time-range-to"
                type="number"
                min="1"
                step="1"
                value={timeRangeTo}
                aria-label={SYSTEM_CONFIG.ui.backtestReplay.timeRangeToLabel}
                aria-invalid={Boolean(timeRangeError)}
                onChange={(event) => setBacktestTimeRange({ backtestTimeRangeTo: event.target.value })}
              />
            </label>
          </div>
          {timeRangeError && (
            <span className="backtest-replay__search-error" role="alert">{timeRangeError}</span>
          )}
        </div>
      )}
      {showTradeControls && (
        <div
          className="backtest-replay__setup-select"
          ref={setupDropdownRef}
          onBlur={(event) => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
              setSetupDropdownOpen(false);
            }
          }}
        >
          <span className="backtest-replay__search-label" id="backtest-replay-setup-label">
            {SYSTEM_CONFIG.ui.backtestReplay.setupSelectLabel}
          </span>
          <button
            ref={setupTriggerRef}
            id="backtest-replay-setup"
            className="backtest-replay__setup-trigger"
            type="button"
            role="combobox"
            aria-labelledby="backtest-replay-setup-label backtest-replay-setup-value"
            aria-haspopup="listbox"
            aria-controls="backtest-replay-setup-options"
            aria-expanded={setupDropdownOpen}
            onClick={() => setSetupDropdownOpen(!setupDropdownOpen)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setSetupDropdownOpen(true);
              }
              if (event.key === 'Escape') setSetupDropdownOpen(false);
            }}
          >
            <span id="backtest-replay-setup-value">
              {selectedSetupId
                ? `${SYSTEM_CONFIG.ui.backtestReplay.quickFilterSetupLabel} #${setupOptions.find((setup) => setup.id === selectedSetupId)?.number ?? ''}`
                : SYSTEM_CONFIG.ui.backtestReplay.allSetupsLabel}
            </span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {setupDropdownOpen && (
            <div
              id="backtest-replay-setup-options"
              className="backtest-replay__setup-options"
              role="listbox"
              aria-labelledby="backtest-replay-setup-label"
              ref={setupOptionsRef}
            >
              <button
                type="button"
                role="option"
                aria-selected={!selectedSetupId}
                className={!selectedSetupId ? 'backtest-replay__setup-option backtest-replay__setup-option--active' : 'backtest-replay__setup-option'}
                onClick={() => {
                  onSelectedSetupChange('');
                  setSetupDropdownOpen(false);
                  setupTriggerRef.current?.focus();
                }}
                onKeyDown={handleSetupOptionKeyDown}
              >
                {SYSTEM_CONFIG.ui.backtestReplay.allSetupsLabel}
              </button>
              {setupOptions.map((setup) => (
                <button
                  key={setup.id}
                  type="button"
                  role="option"
                  aria-selected={setup.id === selectedSetupId}
                  className={setup.id === selectedSetupId ? 'backtest-replay__setup-option backtest-replay__setup-option--active' : 'backtest-replay__setup-option'}
                  onClick={() => {
                    onSelectedSetupChange(setup.id);
                    setSetupDropdownOpen(false);
                    setupTriggerRef.current?.focus();
                  }}
                  onKeyDown={handleSetupOptionKeyDown}
                >
                  {SYSTEM_CONFIG.ui.backtestReplay.quickFilterSetupLabel} #{setup.number}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="backtest-replay__quick-filters">
        <span className="backtest-replay__quick-filters-label">
          {SYSTEM_CONFIG.ui.backtestReplay.quickFiltersLabel}
        </span>
        <div className={`backtest-replay__quick-filters-options${showSetupFilter ? ' backtest-replay__quick-filters-options--compact' : ''}`} role="group" aria-label={SYSTEM_CONFIG.ui.backtestReplay.quickFiltersLabel}>
          <button
            type="button"
            className={(showTradeControls ? !tradeFilterActive : quickFilter === 'all')
              ? 'backtest-replay__quick-filter backtest-replay__quick-filter--active'
              : 'backtest-replay__quick-filter'}
            aria-pressed={showTradeControls ? !tradeFilterActive : quickFilter === 'all'}
            onClick={() => {
              if (showTradeControls) {
                onTradeFilterChange(false);
                onSelectedSetupChange('');
                return;
              }
              onQuickFilterChange('all');
            }}
          >
            {SYSTEM_CONFIG.ui.backtestReplay.quickFilterAllLabel}
          </button>
          {showSetupFilter && (
            <button
              type="button"
              className={quickFilter === 'setup' ? 'backtest-replay__quick-filter backtest-replay__quick-filter--active' : 'backtest-replay__quick-filter'}
              aria-pressed={quickFilter === 'setup'}
              onClick={() => onQuickFilterChange('setup')}
            >
              {SYSTEM_CONFIG.ui.backtestReplay.quickFilterSetupLabel}
            </button>
          )}
          {showTradeControls && (
            <button
              type="button"
              className={tradeFilterActive ? 'backtest-replay__quick-filter backtest-replay__quick-filter--active' : 'backtest-replay__quick-filter'}
              aria-pressed={tradeFilterActive}
              onClick={() => onTradeFilterChange(!tradeFilterActive)}
            >
              {SYSTEM_CONFIG.ui.backtestReplay.quickFilterTradeLabel}
            </button>
          )}
        </div>
      </div>
      {searchError && <span className="backtest-replay__search-error" id="backtest-replay-search-error" role="alert">{searchError}</span>}

      <div className="backtest-replay__progress">
        <div className="backtest-replay__progress-heading">
          <span>{isTradeSource ? 'TRADE' : 'MARKET STRUCTURE'}</span>
          <span className="backtest-replay__progress-count">
            {progressCurrent === null ? '--' : progressCurrent} / {(isTradeSource ? tradeCount : marketStructureCount) || '--'}
          </span>
        </div>
        <div
          className="backtest-replay__progress-track"
          role="progressbar"
          aria-label={isTradeSource ? 'Trade progress' : 'Market structure progress'}
          aria-valuemin={0}
          aria-valuemax={progressMaximum}
          aria-valuenow={progressValue}
          aria-valuetext={progressCurrent === null
            ? isTradeSource
              ? `No trade selected; ${tradeCount} total`
              : `No market structure selected; ${marketStructureCount} total`
            : isTradeSource
              ? `Trade ${progressCurrent} of ${tradeCount}`
              : `Market structure ${progressCurrent} of ${marketStructureCount}`}
        >
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="backtest-replay__transport">
        <button type="button" title={SYSTEM_CONFIG.ui.backtestReplay.first} aria-label={SYSTEM_CONFIG.ui.backtestReplay.first} disabled={!hasReplayData || replayIndex === 0} onClick={jumpToReplayStart}>
          <SkipBack size={14} />
        </button>
        <button type="button" title={SYSTEM_CONFIG.ui.backtestReplay.previous} aria-label={SYSTEM_CONFIG.ui.backtestReplay.previous} disabled={!hasReplayData || replayIndex === 0} onClick={() => setReplayIndex(replayIndex - 1)}>
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          className="backtest-replay__play"
          title={replayPlaying ? SYSTEM_CONFIG.ui.backtestReplay.pause : SYSTEM_CONFIG.ui.backtestReplay.play}
          aria-label={replayPlaying ? SYSTEM_CONFIG.ui.backtestReplay.pause : SYSTEM_CONFIG.ui.backtestReplay.play}
          aria-pressed={replayPlaying}
          disabled={!hasReplayData || replayLastIndex === 0}
          onClick={toggleReplay}
        >
          {replayPlaying ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button type="button" title={SYSTEM_CONFIG.ui.backtestReplay.next} aria-label={SYSTEM_CONFIG.ui.backtestReplay.next} disabled={!hasReplayData || replayIndex >= replayLastIndex} onClick={() => setReplayIndex(replayIndex + 1)}>
          <ChevronRight size={15} />
        </button>
        <button type="button" title={SYSTEM_CONFIG.ui.backtestReplay.last} aria-label={SYSTEM_CONFIG.ui.backtestReplay.last} disabled={!hasReplayData || replayIndex >= replayLastIndex} onClick={jumpToReplayEnd}>
          <SkipForward size={14} />
        </button>
      </div>

      <div className="backtest-replay__options">
        <button
          type="button"
          className={`backtest-replay__auto${autoReplay ? ' backtest-replay__auto--active' : ''}`}
          aria-pressed={autoReplay}
          onClick={() => setAutoReplay(!autoReplay)}
        >
          {SYSTEM_CONFIG.ui.backtestReplay.autoReplay}
          <span className="backtest-replay__switch" aria-hidden="true" />
        </button>
        <span className="backtest-replay__speed-summary">{replaySpeed}x {SYSTEM_CONFIG.ui.backtestReplay.speed}</span>
      </div>

      <div className="backtest-replay__speed">
        <span>{SYSTEM_CONFIG.ui.backtestReplay.speed}</span>
        <div role="group" aria-label={SYSTEM_CONFIG.ui.backtestReplay.speedAriaLabel}>
          {REPLAY_SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              className={replaySpeed === speed ? 'backtest-replay__speed-option backtest-replay__speed-option--active' : 'backtest-replay__speed-option'}
              aria-pressed={replaySpeed === speed}
              onClick={() => setReplaySpeed(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>

      {isTradeSource && (
        <section className="backtest-replay__trade-info" aria-label={SYSTEM_CONFIG.ui.backtestReplay.tradeDetailsTitle}>
          <div className="backtest-replay__trade-card">
            <div className="backtest-replay__trade-card-heading">
              <h3 className="backtest-replay__trade-card-title">
                {SYSTEM_CONFIG.ui.backtestReplay.tradeSummaryTitle}
              </h3>
              <strong>
                {tradeSummary.count} {SYSTEM_CONFIG.ui.backtestReplay.tradeCountLabel}
              </strong>
            </div>
            <div className="backtest-replay__trade-grid">
              <div className="backtest-replay__trade-metric">
                <span>{SYSTEM_CONFIG.ui.backtestReplay.winsLabel}</span>
                <strong className="positive">{tradeSummary.wins}</strong>
              </div>
              <div className="backtest-replay__trade-metric">
                <span>{SYSTEM_CONFIG.ui.backtestReplay.lossesLabel}</span>
                <strong className="negative">{tradeSummary.losses}</strong>
              </div>
              <div className="backtest-replay__trade-metric">
                <span>{SYSTEM_CONFIG.ui.backtestReplay.winRateLabel}</span>
                <strong>{formatPercent(tradeSummary.winRate)}</strong>
              </div>
              <div className="backtest-replay__trade-metric">
                <span>{SYSTEM_CONFIG.ui.backtestReplay.totalPnlLabel}</span>
                <strong className={tradeSummary.totalPnl < 0 ? 'negative' : 'positive'}>
                  {formatSignedUsdt(tradeSummary.totalPnl)}
                </strong>
              </div>
              <div className="backtest-replay__trade-metric">
                <span>{SYSTEM_CONFIG.ui.backtestReplay.currentBalanceLabel}</span>
                <strong>{formatUsdt(tradeSummary.currentBalance)}</strong>
              </div>
              <div className="backtest-replay__trade-metric backtest-replay__trade-metric--wide">
                <span>{SYSTEM_CONFIG.ui.backtestReplay.backtestPeriodLabel}</span>
                <strong>
                  {tradeSummary.startTime !== null && tradeSummary.endTime !== null
                    ? `${formatTradeDate(tradeSummary.startTime)} – ${formatTradeDate(tradeSummary.endTime)}`
                    : '--'}
                </strong>
              </div>
            </div>
          </div>

          <div className="backtest-replay__trade-card">
            <div className="backtest-replay__trade-card-heading">
              <h3 className="backtest-replay__trade-card-title">
                {SYSTEM_CONFIG.ui.backtestReplay.tradeDetailsTitle}
              </h3>
              {selectedTrade && (
                <strong>#{selectedTrade.number} · {selectedTrade.side}</strong>
              )}
              {selectedTrade && (
                <button
                  type="button"
                  className={`backtest-replay__trade-details-toggle${tradeDetailsExpanded ? ' backtest-replay__trade-details-toggle--expanded' : ''}`}
                  aria-label={tradeDetailsExpanded
                    ? SYSTEM_CONFIG.ui.backtestReplay.collapseTradeDetails
                    : SYSTEM_CONFIG.ui.backtestReplay.expandTradeDetails}
                  aria-expanded={tradeDetailsExpanded}
                  aria-controls={tradeDetailsContentId}
                  onClick={() => setTradeDetailsExpanded((expanded) => !expanded)}
                >
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
              )}
            </div>
            {selectedTrade ? (
              <div
                id={tradeDetailsContentId}
                className="backtest-replay__trade-details-content"
                hidden={!tradeDetailsExpanded}
              >
                <div className="backtest-replay__trade-grid">
                  <div className="backtest-replay__trade-metric">
                    <span>{SYSTEM_CONFIG.ui.backtestReplay.setupLabel}</span>
                    <strong>#{selectedTrade.setup.number}</strong>
                  </div>
                  <div className="backtest-replay__trade-metric">
                    <span>{SYSTEM_CONFIG.ui.backtestReplay.entryLabel}</span>
                    <strong>{formatPrice(selectedTrade.entryPrice)}</strong>
                  </div>
                  <div className="backtest-replay__trade-metric">
                    <span>{SYSTEM_CONFIG.ui.backtestReplay.stopLossLabel}</span>
                    <strong>{formatPrice(selectedTrade.stopLoss)}</strong>
                  </div>
                  <div className="backtest-replay__trade-metric">
                    <span>{selectedTradeExitType ?? SYSTEM_CONFIG.ui.backtestReplay.exitLabel}</span>
                    <strong>
                      {formatPrice(
                        selectedTradeExitType === 'SL'
                          ? selectedTrade.stopLoss
                          : selectedTrade.exitPrice,
                      )}
                    </strong>
                  </div>
                  <div className="backtest-replay__trade-metric">
                    <span>{SYSTEM_CONFIG.ui.backtestReplay.pnlLabel}</span>
                    <strong className={selectedTrade.pnl < 0 ? 'negative' : 'positive'}>
                      {formatSignedUsdt(selectedTrade.pnl)}
                    </strong>
                  </div>
                  <div className="backtest-replay__trade-metric">
                    <span>{SYSTEM_CONFIG.ui.backtestReplay.volumeLabel}</span>
                    <strong>{PRICE_FORMAT.format(selectedTrade.volume)}</strong>
                  </div>
                  <div className="backtest-replay__trade-metric">
                    <span>{SYSTEM_CONFIG.ui.backtestReplay.entryTimeLabel}</span>
                    <strong>{formatTradeDate(selectedTrade.time, true)}</strong>
                  </div>
                  <div className="backtest-replay__trade-metric">
                    <span>{SYSTEM_CONFIG.ui.backtestReplay.endTimeLabel}</span>
                    <strong>{formatTradeDate(selectedTrade.endTime, true)}</strong>
                  </div>
                </div>
              </div>
            ) : (
              <p className="backtest-replay__trade-empty">
                {SYSTEM_CONFIG.ui.backtestReplay.noTradeSelected}
              </p>
            )}
          </div>
          {selectedTrade && selectedTradeNoteId && (
            <TradeNotes
              key={selectedTradeNoteId}
              tradeId={selectedTradeNoteId}
            />
          )}
        </section>
      )}
    </section>
  );
}
