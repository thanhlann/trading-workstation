import {
  CalendarDays, ChartCandlestick, ChartLine, ChevronDown, Eye, Layers, List,
  MoreHorizontal, NotebookPen, Search, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MARKET_SYMBOLS, type MarketSymbol } from '../../config/marketSymbols';
import { SYSTEM_CONFIG, type TradingMode } from '../../config/system';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import {
  loadBacktestMarketStates,
  loadBacktestSetups,
  loadBacktestTrades,
} from '../backtest-overview/backtestData';
import type { BacktestTrade } from '../backtest-overview/backtestData';
import { TradeNotes } from '../backtest-overview/TradeNotes';
import { getTradeNoteId, loadTradeNoteIds } from '../backtest-overview/tradeNotesStorage';

interface ReportProps {
  symbol: MarketSymbol;
  mode: TradingMode;
  onSetSymbol: (symbol: MarketSymbol) => void;
}

const setupTypes = ['CHOCH + OB', 'BOS + OB', 'CHOCH + FVG', 'Liquidity Sweep'];
const initialSetupTypes = ['CHOCH + OB', 'BOS + OB'];
const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
const reportTabs = ['Trade Explorer', 'LTF Setup Explorer', 'Performance', 'Setup Analysis', 'Risk Analysis', 'Overview'];
const tradeExplorerFilters = ['All Trades', 'Win', 'Loss', 'Long', 'Short'] as const;
type TradeExplorerFilter = (typeof tradeExplorerFilters)[number];
type ExplorerBias = 'BULLISH' | 'BEARISH';

interface LtfExplorerEntry {
  id: string;
  number: number;
  event: 'bos' | 'choch';
  bias: ExplorerBias;
  previousBias: ExplorerBias | null;
  time: number;
  invalidAt: number | null;
  poiCount: number;
  tradeCount: number;
}

interface SetupExplorerEntry {
  id: string;
  number: number;
  time: number;
  endTime: number | null;
  direction: 'Bullish' | 'Bearish';
  htfEvent: 'bos' | 'choch' | null;
  htfNumber: number | null;
  ltfMarketStructures: LtfExplorerEntry[];
}

const USDT_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function isMarketSymbol(value: string): value is MarketSymbol {
  return Object.values(MARKET_SYMBOLS).some((market) => market.symbol === value);
}

function matchesSetupType(trade: BacktestTrade, setupType: string): boolean {
  const event = trade.htf.marketStructure.event;
  const poiType = trade.htf.poi?.type;

  switch (setupType) {
    case 'CHOCH + OB':
      return event === 'choch' && poiType === 1;
    case 'BOS + OB':
      return event === 'bos' && poiType === 1;
    case 'CHOCH + FVG':
      return event === 'choch' && poiType === 2;
    case 'Liquidity Sweep':
      return trade.ltf.sweep !== null;
    default:
      return false;
  }
}

function getTradeSetupType(trade: BacktestTrade): string {
  return setupTypes.find((setupType) => matchesSetupType(trade, setupType)) ?? 'Other';
}

function getTradeResult(trade: BacktestTrade): 'Win' | 'Loss' | 'Break even' {
  return trade.pnl > 0 ? 'Win' : trade.pnl < 0 ? 'Loss' : 'Break even';
}

function getTradeR(trade: BacktestTrade): number | null {
  const risk = Math.abs(trade.entryPrice - trade.stopLoss) * trade.volume;
  return risk > 0 ? trade.pnl / risk : null;
}

function getDateBoundary(value: string, endOfDay: boolean): number | null {
  if (!value) return null;
  const time = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`).getTime();
  return Number.isFinite(time) ? time / 1000 : null;
}

function formatTradeDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

function formatExplorerTime(timestamp: number | null): string {
  if (timestamp === null) return '—';
  const date = new Date(timestamp * 1000);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function formatTradeDetailsTime(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(11, 19);
}

export function Report({ symbol, mode, onSetSymbol }: ReportProps) {
  const navigateToWorkspace = useWorkspaceStore((state) => state.navigateToWorkspace);
  const setBacktestNavigationTarget = useWorkspaceStore((state) => state.setBacktestNavigationTarget);
  const setBacktestTimeRange = useWorkspaceStore((state) => state.setBacktestTimeRange);
  const setBacktestTimeframe = useWorkspaceStore((state) => state.setBacktestTimeframe);
  const setReplayIndex = useWorkspaceStore((state) => state.setReplayIndex);
  const setSelectedSetupId = useWorkspaceStore((state) => state.setSelectedSetupId);
  const [direction, setDirection] = useState('All');
  const [result, setResult] = useState('All');
  const [timeframe, setTimeframe] = useState('All');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedSetupTypes, setSelectedSetupTypes] = useState<string[]>(initialSetupTypes);
  const [activeReportTab, setActiveReportTab] = useState(reportTabs[0]);
  const [tradeExplorerFilter, setTradeExplorerFilter] = useState<TradeExplorerFilter>('All Trades');
  const [selectedTradeNumber, setSelectedTradeNumber] = useState<number | null>(null);
  const [tradeDetailsOpen, setTradeDetailsOpen] = useState(false);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const [tradeNoteIds, setTradeNoteIds] = useState<Set<string> | null>(null);
  const [tradeNotesError, setTradeNotesError] = useState<string | null>(null);
  const [tradeDataLoading, setTradeDataLoading] = useState(true);
  const [tradeDataError, setTradeDataError] = useState<string | null>(null);
  const [explorerSetups, setExplorerSetups] = useState<Awaited<ReturnType<typeof loadBacktestSetups>>>([]);
  const [explorerHtfStates, setExplorerHtfStates] = useState<Awaited<ReturnType<typeof loadBacktestMarketStates>>>([]);
  const [explorerLtfStates, setExplorerLtfStates] = useState<Awaited<ReturnType<typeof loadBacktestMarketStates>>>([]);
  const [explorerDataLoading, setExplorerDataLoading] = useState(true);
  const [explorerDataError, setExplorerDataError] = useState<string | null>(null);
  const [setupSearch, setSetupSearch] = useState('');
  const [ltfSearch, setLtfSearch] = useState('');
  const [selectedExplorerSetupId, setSelectedExplorerSetupId] = useState<string | null>(null);
  const [openActionsMenu, setOpenActionsMenu] = useState<{ type: 'ltf' | 'trade'; number: number } | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openActionsMenu === null) return;

    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && !actionMenuRef.current?.contains(event.target)) {
        setOpenActionsMenu(null);
      }
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenActionsMenu(null);
    };

    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [openActionsMenu]);

  const openLtfMarketStructure = (setupId: string, structure: LtfExplorerEntry) => {
    navigateToWorkspace({ mode: 'backtest', activeWorkspacePage: 'chart' });
    setSelectedSetupId(setupId);
    setBacktestNavigationTarget({
      type: 'marketStructure',
      setupId,
      marketStructureNumber: structure.number,
      marketStructureTime: structure.time,
    });
    setBacktestTimeRange({ backtestTimeRangeFrom: '', backtestTimeRangeTo: '' });
    setBacktestTimeframe('ltf');
    setReplayIndex(0);
    setOpenActionsMenu(null);
  };

  const openTradeChart = (trade: BacktestTrade) => {
    setTradeDetailsOpen(false);
    navigateToWorkspace({ mode: 'backtest', activeWorkspacePage: 'chart' });
    setSelectedSetupId(trade.setup.id);
    setBacktestNavigationTarget({
      type: 'trade',
      setupId: trade.setup.id,
      marketStructureTime: trade.ltf.marketStructure.time,
      tradeNumber: trade.number,
    });
    setBacktestTimeRange({ backtestTimeRangeFrom: '', backtestTimeRangeTo: '' });
    setBacktestTimeframe('ltf');
    setReplayIndex(0);
    setOpenActionsMenu(null);
  };

  useEffect(() => {
    let cancelled = false;
    loadBacktestTrades().then(
      (loadedTrades) => {
        if (!cancelled) setTrades(loadedTrades);
      },
      (error: unknown) => {
        if (!cancelled) setTradeDataError(error instanceof Error ? error.message : String(error));
      },
    ).finally(() => {
      if (!cancelled) setTradeDataLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTradeNoteIds(null);
    setTradeNotesError(null);

    if (trades.length === 0) {
      setTradeNoteIds(new Set());
      return () => {
        cancelled = true;
      };
    }

    loadTradeNoteIds(trades.map((trade) => (
      getTradeNoteId(trade.symbol, trade.number, trade.time)
    ))).then(
      (ids) => {
        if (!cancelled) setTradeNoteIds(ids);
      },
      (error: unknown) => {
        if (!cancelled) {
          setTradeNotesError(error instanceof Error ? error.message : String(error));
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [trades]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadBacktestSetups(),
      loadBacktestMarketStates('htf'),
      loadBacktestMarketStates('ltf'),
    ]).then(
      ([setups, htfStates, ltfStates]) => {
        if (!cancelled) {
          setExplorerSetups(setups);
          setExplorerHtfStates(htfStates);
          setExplorerLtfStates(ltfStates);
        }
      },
      (error: unknown) => {
        if (!cancelled) setExplorerDataError(error instanceof Error ? error.message : String(error));
      },
    ).finally(() => {
      if (!cancelled) setExplorerDataLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredTrades = useMemo(() => {
    const fromTimestamp = getDateBoundary(fromDate, false);
    const toTimestamp = getDateBoundary(toDate, true);
    const selectedSymbol = symbol.toUpperCase();

    return trades.filter((trade) => {
      if (trade.symbol.replace(/-/g, '').toUpperCase() !== selectedSymbol) return false;
      if (direction === 'Bullish' && trade.side !== 'LONG') return false;
      if (direction === 'Bearish' && trade.side !== 'SHORT') return false;
      if (result === 'Win' && trade.pnl <= 0) return false;
      if (result === 'Loss' && trade.pnl >= 0) return false;
      if (timeframe !== 'All' && timeframe !== '5m') return false;
      if (fromTimestamp !== null && trade.time < fromTimestamp) return false;
      if (toTimestamp !== null && trade.time > toTimestamp) return false;
      return selectedSetupTypes.length === 0
        || selectedSetupTypes.some((setupType) => matchesSetupType(trade, setupType));
    });
  }, [direction, fromDate, result, selectedSetupTypes, symbol, timeframe, toDate, trades]);

  const reportStats = useMemo(() => {
    const winningTrades = filteredTrades.filter((trade) => trade.pnl > 0);
    const losingTrades = filteredTrades.filter((trade) => trade.pnl < 0);
    const grossProfit = winningTrades.reduce((total, trade) => total + trade.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((total, trade) => total + trade.pnl, 0));
    const totalPnl = filteredTrades.reduce((total, trade) => total + trade.pnl, 0);
    const initialBalance = trades[0]?.openingBalance ?? SYSTEM_CONFIG.backtest.initialBalance;
    const orderedTrades = [...filteredTrades].sort((left, right) => left.time - right.time);
    let balance = initialBalance;
    let peakBalance = initialBalance;
    let maxDrawdown = 0;
    let totalR = 0;
    let riskedTrades = 0;

    for (const trade of orderedTrades) {
      balance += trade.pnl;
      peakBalance = Math.max(peakBalance, balance);
      if (peakBalance > 0) maxDrawdown = Math.max(maxDrawdown, ((peakBalance - balance) / peakBalance) * 100);

      const risk = Math.abs(trade.entryPrice - trade.stopLoss) * trade.volume;
      if (risk > 0) {
        totalR += trade.pnl / risk;
        riskedTrades += 1;
      }
    }

    const timestamps = filteredTrades.map((trade) => trade.time);
    return {
      netProfit: initialBalance > 0 ? (totalPnl / initialBalance) * 100 : 0,
      winRate: winningTrades.length + losingTrades.length > 0
        ? (winningTrades.length / (winningTrades.length + losingTrades.length)) * 100
        : 0,
      profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? '∞' : '—',
      maxDrawdown,
      totalTrades: filteredTrades.length,
      expectancy: riskedTrades > 0 ? `${(totalR / riskedTrades).toFixed(2)}R` : '—',
      dateRange: timestamps.length > 0
        ? `${formatTradeDate(Math.min(...timestamps))} – ${formatTradeDate(Math.max(...timestamps))}`
        : 'No trades',
    };
  }, [filteredTrades, trades]);

  const equityCurve = useMemo(() => {
    const orderedTrades = [...filteredTrades].sort((left, right) => left.time - right.time);
    if (orderedTrades.length === 0) return { hasTrades: false, points: [], ticks: [], labelInterval: 1 };

    const initialBalance = trades[0]?.openingBalance ?? SYSTEM_CONFIG.backtest.initialBalance;
    const dailyPnl = new Map<string, number>();
    for (const trade of orderedTrades) {
      const day = new Date(trade.time * 1000).toISOString().slice(0, 10);
      dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + trade.pnl);
    }

    const firstTradeDate = new Date(orderedTrades[0].time * 1000);
    const lastTradeDate = new Date(orderedTrades[orderedTrades.length - 1].time * 1000);
    const firstDay = Date.UTC(firstTradeDate.getUTCFullYear(), firstTradeDate.getUTCMonth(), firstTradeDate.getUTCDate());
    const lastDay = Date.UTC(lastTradeDate.getUTCFullYear(), lastTradeDate.getUTCMonth(), lastTradeDate.getUTCDate());
    const dayCount = Math.floor((lastDay - firstDay) / 86_400_000) + 1;
    let cumulativePnl = 0;
    const dailyReturns = Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(firstDay + index * 86_400_000);
      const key = date.toISOString().slice(0, 10);
      cumulativePnl += dailyPnl.get(key) ?? 0;
      return {
        date: key,
        label: `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
        hasTrade: dailyPnl.has(key),
        returnPct: initialBalance > 0 ? (cumulativePnl / initialBalance) * 100 : 0,
      };
    });

    const lowestReturn = Math.min(0, ...dailyReturns.map(({ returnPct }) => returnPct));
    const highestReturn = Math.max(0, ...dailyReturns.map(({ returnPct }) => returnPct));
    const rawStep = Math.max((highestReturn - lowestReturn) / 4, 1);
    const step = Math.max(1, Math.ceil(rawStep / 7)) * 7;
    const minReturn = Math.floor(lowestReturn / step) * step;
    const maxReturn = Math.ceil(highestReturn / step) * step;
    const chartMin = Math.min(minReturn, 0);
    const chartMax = maxReturn > chartMin ? maxReturn : chartMin + step;
    const chart = { left: 48, right: 704, top: 14, bottom: 220 };
    const points = dailyReturns.map(({ date, label, hasTrade, returnPct }, index) => {
      const x = chart.left + (index / Math.max(dailyReturns.length - 1, 1)) * (chart.right - chart.left);
      const y = chart.bottom - ((returnPct - chartMin) / (chartMax - chartMin)) * (chart.bottom - chart.top);
      return { x, y, date, label, hasTrade };
    });
    const tickCount = Math.round((chartMax - chartMin) / step);

    return {
      hasTrades: true,
      points,
      ticks: Array.from({ length: tickCount + 1 }, (_, index) => ({
        value: chartMin + index * step,
        y: chart.bottom - (index / tickCount) * (chart.bottom - chart.top),
      })),
      labelInterval: Math.max(1, Math.ceil(points.length / 8)),
    };
  }, [filteredTrades, trades]);

  const reportMetrics: { label: string; value: string; tone?: 'positive' | 'negative' }[] = [
    { label: 'Net Profit', value: tradeDataLoading || tradeDataError || reportStats.totalTrades === 0 ? '—' : `${reportStats.netProfit >= 0 ? '+' : ''}${reportStats.netProfit.toFixed(1)}%`, tone: reportStats.netProfit >= 0 ? 'positive' as const : 'negative' as const },
    { label: 'Win Rate', value: tradeDataLoading || tradeDataError || reportStats.totalTrades === 0 ? '—' : `${reportStats.winRate.toFixed(1)}%` },
    { label: 'Profit Factor', value: tradeDataLoading || tradeDataError || reportStats.totalTrades === 0 ? '—' : reportStats.profitFactor },
    { label: 'Max Drawdown', value: tradeDataLoading || tradeDataError || reportStats.totalTrades === 0 ? '—' : `-${reportStats.maxDrawdown.toFixed(1)}%`, tone: 'negative' as const },
    { label: 'Total Trades', value: tradeDataLoading ? '…' : String(reportStats.totalTrades) },
    { label: 'Expectancy', value: tradeDataLoading || tradeDataError || reportStats.totalTrades === 0 ? '—' : reportStats.expectancy },
  ];
  const explorerTrades = useMemo(() => filteredTrades
    .filter((trade) => {
      switch (tradeExplorerFilter) {
        case 'Win':
          return trade.pnl > 0;
        case 'Loss':
          return trade.pnl < 0;
        case 'Long':
          return trade.side === 'LONG';
        case 'Short':
          return trade.side === 'SHORT';
        default:
          return true;
      }
    })
    .sort((left, right) => left.number - right.number), [filteredTrades, tradeExplorerFilter]);
  const setupExplorerRows = useMemo(() => {
    const symbolCode = symbol.replace(/-/g, '').toUpperCase();
    const setupsForSymbol = explorerSetups
      .filter((setup) => setup.symbol.replace(/-/g, '').toUpperCase() === symbolCode)
      .sort((left, right) => left.time - right.time);
    const htfStatesByTime = new Map(
      explorerHtfStates.map((state) => [Number(state.marketStructure.time), state]),
    );
    const ltfStates = [...explorerLtfStates]
      .sort((left, right) => Number(left.marketStructure.time) - Number(right.marketStructure.time));
    const ltfStateIndexes = new Map(
      ltfStates.map((state, index) => [Number(state.marketStructure.time), index]),
    );
    const tradeCounts = new Map<string, number>();

    for (const trade of trades) {
      if (trade.symbol.replace(/-/g, '').toUpperCase() !== symbolCode) continue;
      const key = `${trade.setup.id}:${trade.ltf.marketStructure.time}`;
      tradeCounts.set(key, (tradeCounts.get(key) ?? 0) + 1);
    }

    return setupsForSymbol.map((setup, setupIndex): SetupExplorerEntry => {
      const nextSetupTime = setupsForSymbol[setupIndex + 1]?.time ?? Number.POSITIVE_INFINITY;
      const intervalEnd = Math.min(setup.endTime ?? Number.POSITIVE_INFINITY, nextSetupTime);
      const htfState = htfStatesByTime.get(setup.time);
      const ltfMarketStructures = ltfStates
        .filter((state) => (
          Number(state.marketStructure.time) >= setup.time
          && Number(state.marketStructure.time) < intervalEnd
        ))
        .map((state): LtfExplorerEntry => {
          const marketStructureTime = Number(state.marketStructure.time);
          const stateIndex = ltfStateIndexes.get(marketStructureTime);
          const previousBias = stateIndex !== undefined && stateIndex > 0
            ? ltfStates[stateIndex - 1].marketStructure.bias
            : null;
          const invalidationTimes = state.pois
            .map((poi) => poi.endTime === null ? null : Number(poi.endTime))
            .filter((time): time is number => time !== null && Number.isFinite(time));
          const invalidAt = state.pois.length > 0 && invalidationTimes.length === state.pois.length
            ? Math.max(...invalidationTimes)
            : null;

          return {
            id: `LTF-${String(state.marketStructure.number).padStart(3, '0')}`,
            number: state.marketStructure.number,
            event: state.marketStructure.event,
            bias: state.marketStructure.bias,
            previousBias,
            time: marketStructureTime,
            invalidAt,
            poiCount: state.pois.length,
            tradeCount: tradeCounts.get(`${setup.id}:${marketStructureTime}`) ?? 0,
          };
        });

      return {
        id: setup.id,
        number: setup.number,
        time: setup.time,
        endTime: setup.endTime,
        direction: setup.side === 'LONG' ? 'Bullish' : 'Bearish',
        htfEvent: htfState?.marketStructure.event ?? null,
        htfNumber: htfState?.marketStructure.number ?? null,
        ltfMarketStructures,
      };
    });
  }, [explorerHtfStates, explorerLtfStates, explorerSetups, symbol, trades]);
  const filteredSetupExplorerRows = useMemo(() => {
    const query = setupSearch.trim().toLowerCase();
    return setupExplorerRows.filter((setup) => (
      !query
      || `s-${String(setup.number).padStart(3, '0')}`.includes(query)
      || setup.id.toLowerCase().includes(query)
    ));
  }, [setupExplorerRows, setupSearch]);
  const selectedSetupExplorerRow = filteredSetupExplorerRows.find(
    (setup) => setup.id === selectedExplorerSetupId,
  ) ?? null;
  const filteredLtfExplorerRows = selectedSetupExplorerRow?.ltfMarketStructures.filter((structure) => (
    !ltfSearch.trim()
    || structure.id.toLowerCase().includes(ltfSearch.trim().toLowerCase())
  )) ?? [];
  const selectedTrade = explorerTrades.find((trade) => trade.number === selectedTradeNumber)
    ?? explorerTrades[0]
    ?? null;
  const selectedTradeR = selectedTrade ? getTradeR(selectedTrade) : null;
  const selectedTradeNoteId = selectedTrade
    ? getTradeNoteId(selectedTrade.symbol, selectedTrade.number, selectedTrade.time)
    : null;
  const updateTradeNotePresence = (id: string, hasNote: boolean) => {
    setTradeNoteIds((current) => {
      const next = new Set(current ?? []);
      if (hasNote) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
    setTradeNotesError(null);
  };
  const clearAll = () => {
    setDirection('All');
    setResult('All');
    setTimeframe('All');
    setFromDate('');
    setToDate('');
    setSelectedSetupTypes([]);
  };

  const toggleSetupType = (setupType: string) => {
    setSelectedSetupTypes((selected) => selected.includes(setupType)
      ? selected.filter((item) => item !== setupType)
      : [...selected, setupType]);
  };

  return (
    <div className="report-page">
      <div className="report-layout">
        <aside className="report-summary" aria-labelledby="report-summary-title">
          <header className="report-summary__header">
            <div>
              <h2 id="report-summary-title">{mode === 'backtest' ? 'Backtest Report' : 'Report'}</h2>
              <p>{symbol} · {timeframe === 'All' ? '5m' : timeframe} · {reportStats.dateRange}</p>
            </div>
            <span className={`report-summary__status${tradeDataError ? ' report-summary__status--error' : ''}`}>
              {tradeDataLoading ? 'Loading' : tradeDataError ? 'Error' : reportStats.totalTrades > 0 ? 'Completed' : 'No trades'}
            </span>
          </header>

          {tradeDataError && <p className="report-summary__error" role="alert">{tradeDataError}</p>}

          <div className="report-summary__metrics">
            {reportMetrics.map(({ label, value, tone }) => (
              <div className="report-summary__metric" key={label}>
                <span>{label}</span>
                <strong className={tone ? `report-summary__value report-summary__value--${tone}` : 'report-summary__value'}>
                  {value}
                </strong>
              </div>
            ))}
          </div>

          <nav className="report-summary__tabs" aria-label="Report sections">
            {reportTabs.map((tab) => (
              <button
                type="button"
                key={tab}
                className={activeReportTab === tab ? 'report-summary__tab report-summary__tab--active' : 'report-summary__tab'}
                aria-pressed={activeReportTab === tab}
                onClick={() => setActiveReportTab(tab)}
              >
                {tab}
              </button>
            ))}
          </nav>
        </aside>

        <section className="report-filters" aria-labelledby="global-filters-title">
        <div className="report-main-grid">
          <div className="report-global-filters">
            <h2 id="global-filters-title">Global Filters</h2>
            <div className="report-filter-grid">
              <label className="report-field">
                <span>Symbol</span>
                <span className="report-select-wrap">
                  <select
                    value={symbol}
                    aria-label="Symbol"
                    onChange={(event) => {
                      if (isMarketSymbol(event.target.value)) onSetSymbol(event.target.value);
                    }}
                  >
                    {Object.values(MARKET_SYMBOLS).map(({ symbol: marketSymbol }) => (
                      <option key={marketSymbol} value={marketSymbol}>{marketSymbol}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </span>
              </label>
              <label className="report-field">
                <span>Timeframe</span>
                <span className="report-select-wrap">
                  <select value={timeframe} onChange={(event) => setTimeframe(event.target.value)}>
                    <option>All</option>
                    {timeframes.map((option) => <option key={option}>{option}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </span>
              </label>
              <label className="report-field">
                <span>Direction</span>
                <span className="report-select-wrap">
                  <select value={direction} onChange={(event) => setDirection(event.target.value)}>
                    {['All', 'Bullish', 'Bearish'].map((option) => <option key={option}>{option}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </span>
              </label>
              <label className="report-field">
                <span>Result</span>
                <span className="report-select-wrap">
                  <select value={result} onChange={(event) => setResult(event.target.value)}>
                    {['All', 'Win', 'Loss'].map((option) => <option key={option}>{option}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </span>
              </label>
            </div>
          </div>

          <div className="report-date-range">
            <h4>Date Range</h4>
            <div className="report-filter-grid">
              <label className="report-field report-date-field">
                <span>From</span>
                <span className="report-date-input">
                  <CalendarDays size={13} aria-hidden="true" />
                  <input type="date" aria-label="From date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
                </span>
              </label>
              <label className="report-field report-date-field">
                <span>To</span>
                <span className="report-date-input">
                  <CalendarDays size={13} aria-hidden="true" />
                  <input type="date" aria-label="To date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
                </span>
              </label>
            </div>
          </div>

          <fieldset className="report-setup-types">
            <legend>Setup Types</legend>
            <div className="report-setup-heading">
              <span>Select multiple setups</span>
              <button type="button" onClick={clearAll}>Clear all</button>
            </div>
            <div className="report-setup-list">
              {setupTypes.map((setupType) => (
                <label key={setupType} className="report-setup-option">
                  <input
                    type="checkbox"
                    checked={selectedSetupTypes.includes(setupType)}
                    onChange={() => toggleSetupType(setupType)}
                  />
                  <span>{setupType}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <p className="report-note">Filters and metrics are calculated from the loaded backtest trade data.</p>
        </section>
      </div>
      {activeReportTab === 'Overview' && (
        <section className="report-equity" aria-labelledby="report-equity-title">
          <h3 id="report-equity-title">Equity Curve</h3>
          {tradeDataError ? (
            <p className="report-equity__empty">Equity curve unavailable because trade data could not be loaded.</p>
          ) : tradeDataLoading ? (
            <p className="report-equity__empty">Loading equity curve…</p>
          ) : equityCurve.hasTrades ? (
            <svg
              className="report-equity__chart"
              viewBox="0 0 720 250"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Daily equity curve for ${filteredTrades.length} trades`}
            >
              {equityCurve.ticks.map(({ value, y }) => (
                <g key={value}>
                  <line x1="48" x2="704" y1={y} y2={y} className="report-equity__gridline" />
                  <text x="0" y={y + 4} className="report-equity__axis-label">{value.toFixed(0)}%</text>
                </g>
              ))}
              <polyline points={equityCurve.points.map(({ x, y }) => `${x},${y}`).join(' ')} className="report-equity__line" />
              {equityCurve.points.map(({ x, y, date, label, hasTrade }, index) => (
                <g key={date}>
                  {hasTrade && <circle cx={x} cy={y} r="3" className="report-equity__point" />}
                  {(index % equityCurve.labelInterval === 0 || index === equityCurve.points.length - 1) && (
                    <text x={x} y="244" textAnchor="middle" className="report-equity__axis-label">{label}</text>
                  )}
                </g>
              ))}
            </svg>
          ) : (
            <p className="report-equity__empty">No trades for the selected filters.</p>
          )}
        </section>
      )}
      {activeReportTab === 'Trade Explorer' && (
        <section className="report-explorer" aria-labelledby="report-explorer-title">
          <h3 id="report-explorer-title">Trade Explorer</h3>
          <div className="report-explorer__filters" role="group" aria-label="Trade filters">
            {tradeExplorerFilters.map((filter) => (
              <button
                type="button"
                key={filter}
                className={`report-explorer__filter${tradeExplorerFilter === filter ? ' report-explorer__filter--active' : ''}${filter === 'Win' ? ' report-explorer__filter--win' : ''}${filter === 'Loss' ? ' report-explorer__filter--loss' : ''}`}
                aria-pressed={tradeExplorerFilter === filter}
                onClick={() => setTradeExplorerFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
          {tradeNotesError && (
            <p className="report-explorer__note-error" role="alert">
              Could not load trade note status: {tradeNotesError}
            </p>
          )}

          {tradeDataLoading ? (
            <p className="report-explorer__empty">Loading trades…</p>
          ) : tradeDataError ? (
            <p className="report-explorer__empty" role="alert">{tradeDataError}</p>
          ) : (
            <>
              <div className={`report-explorer__content${tradeDetailsOpen && selectedTrade ? ' report-explorer__content--details-open' : ''}`}>
              <div className="report-trade-table-wrap">
                <table className="report-trade-table">
                  <thead>
                    <tr><th>ID</th><th>Setup</th><th>Direction</th><th>Result</th><th>R</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {explorerTrades.map((trade) => {
                      const tradeR = getTradeR(trade);
                      const tradeResult = getTradeResult(trade);
                      const tradeNoteId = getTradeNoteId(trade.symbol, trade.number, trade.time);
                      const hasTradeNote = tradeNoteIds?.has(tradeNoteId) ?? false;
                      return (
                        <tr
                          className={selectedTrade?.number === trade.number ? 'report-trade-row--selected' : ''}
                          key={trade.number}
                          tabIndex={0}
                          aria-selected={selectedTrade?.number === trade.number}
                          onClick={() => setSelectedTradeNumber(trade.number)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedTradeNumber(trade.number);
                            }
                          }}
                        >
                          <td>
                            <button
                              type="button"
                              className="report-trade-id"
                              aria-pressed={selectedTrade?.number === trade.number}
                              onClick={() => setSelectedTradeNumber(trade.number)}
                            >
                              #{String(trade.number).padStart(3, '0')}
                            </button>
                          </td>
                          <td>{getTradeSetupType(trade)}</td>
                          <td>{trade.side === 'LONG' ? 'Long' : 'Short'}</td>
                          <td>
                            <span className={`report-trade-result report-trade-result--${tradeResult.toLowerCase().replace(' ', '-')}`}>
                              {tradeResult}
                            </span>
                          </td>
                          <td className={tradeR === null ? '' : tradeR >= 0 ? 'positive' : 'negative'}>
                            {tradeR === null ? '—' : `${tradeR > 0 ? '+' : ''}${tradeR.toFixed(1)}R`}
                          </td>
                          <td className="report-ltf-explorer__actions-cell">
                            <div
                              className="report-ltf-explorer__actions"
                              ref={openActionsMenu?.type === 'trade' && openActionsMenu.number === trade.number
                                ? actionMenuRef
                                : null}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') setOpenActionsMenu(null);
                              }}
                            >
                              <button
                                type="button"
                                className={`report-trade-note${hasTradeNote ? ' report-trade-note--active' : ''}${tradeNoteIds === null && !tradeNotesError ? ' report-trade-note--loading' : ''}`}
                                aria-label={hasTradeNote
                                  ? `View notes for trade ${trade.number}`
                                  : `Add note for trade ${trade.number}`}
                                title={hasTradeNote
                                  ? `View notes for trade ${trade.number}`
                                  : `Add note for trade ${trade.number}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedTradeNumber(trade.number);
                                  setTradeDetailsOpen(true);
                                  setOpenActionsMenu(null);
                                }}
                              >
                                <NotebookPen size={14} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="report-ltf-explorer__actions-trigger"
                                aria-label={`Actions for trade ${trade.number}`}
                                aria-haspopup="menu"
                                aria-expanded={openActionsMenu?.type === 'trade' && openActionsMenu.number === trade.number}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenActionsMenu(
                                    openActionsMenu?.type === 'trade' && openActionsMenu.number === trade.number
                                      ? null
                                      : { type: 'trade', number: trade.number },
                                  );
                                }}
                              >
                                <MoreHorizontal size={15} aria-hidden="true" />
                              </button>
                              {openActionsMenu?.type === 'trade' && openActionsMenu.number === trade.number && (
                                <div className="report-ltf-explorer__actions-menu" role="menu" aria-label={`Trade ${trade.number} actions`}>
                                  <div className="report-ltf-explorer__actions-heading">
                                    #{String(trade.number).padStart(3, '0')} · ACTIONS
                                  </div>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="report-ltf-explorer__action-item"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openTradeChart(trade);
                                    }}
                                  >
                                    <ChartCandlestick size={13} aria-hidden="true" />
                                    <span>Open Trade Chart</span>
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="report-ltf-explorer__action-item"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedTradeNumber(trade.number);
                                      setTradeDetailsOpen(true);
                                      setOpenActionsMenu(null);
                                    }}
                                  >
                                    <Eye size={13} aria-hidden="true" />
                                    <span>View Trade Details</span>
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="report-ltf-explorer__action-item"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setTradeDetailsOpen(false);
                                      setSelectedExplorerSetupId(trade.setup.id);
                                      setSetupSearch('');
                                      setLtfSearch('');
                                      setActiveReportTab('LTF Setup Explorer');
                                      setOpenActionsMenu(null);
                                    }}
                                  >
                                    <List size={13} aria-hidden="true" />
                                    <span>View Setup</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {explorerTrades.length === 0 && (
                      <tr><td className="report-trade-table__empty" colSpan={6}>No trades match the selected filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

                {tradeDetailsOpen && selectedTrade && (
                  <aside className="report-trade-drawer" aria-labelledby="trade-details-title">
                    <header className="report-trade-drawer__header">
                      <div>
                        <h4 id="trade-details-title">Trade Details</h4>
                        <p>{selectedTrade.symbol.replace(/-/g, '')} · {selectedTrade.side} · 5m</p>
                      </div>
                      <div className="report-trade-drawer__header-actions">
                        <span className="report-trade-drawer__status">
                          {selectedTrade.status.charAt(0).toUpperCase() + selectedTrade.status.slice(1).toLowerCase()}
                        </span>
                        <button
                          type="button"
                          className="report-trade-drawer__close"
                          aria-label="Close Trade Details"
                          onClick={() => setTradeDetailsOpen(false)}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </header>

                    <div className="report-trade-drawer__body">
                      <section className="report-trade-drawer__section" aria-labelledby="trade-overview-title">
                        <h5 id="trade-overview-title">Trade Overview</h5>
                        <dl className="report-trade-drawer__overview">
                          <div>
                            <dt>Trade ID</dt>
                            <dd>
                              <button
                                type="button"
                                className="report-trade-drawer__trade-link"
                                aria-label={`Open chart for trade ${selectedTrade.number}`}
                                title="Open Trade Chart"
                                onClick={() => openTradeChart(selectedTrade)}
                              >
                                TRD-{String(selectedTrade.number).padStart(6, '0')}
                                <ChartCandlestick size={11} aria-hidden="true" />
                              </button>
                            </dd>
                          </div>
                          <div><dt>Setup ID</dt><dd>STP-{String(selectedTrade.setup.number).padStart(6, '0')}</dd></div>
                          <div>
                            <dt>Direction</dt>
                            <dd className={selectedTrade.side === 'LONG' ? 'positive' : 'negative'}>{selectedTrade.side}</dd>
                          </div>
                          <div><dt>Timeframe</dt><dd>5m</dd></div>
                          <div><dt>Entry Time</dt><dd>{formatTradeDetailsTime(selectedTrade.time)}</dd></div>
                          <div><dt>Exit Time</dt><dd>{formatTradeDetailsTime(selectedTrade.endTime)}</dd></div>
                        </dl>
                      </section>

                      <section className="report-trade-drawer__section" aria-labelledby="trade-execution-title">
                        <h5 id="trade-execution-title">Execution</h5>
                        <table className="report-trade-drawer__execution">
                          <thead><tr><th>Field</th><th>Value</th></tr></thead>
                          <tbody>
                            <tr><td>Entry Price</td><td>{selectedTrade.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 8 })}</td></tr>
                            <tr><td>Exit Price</td><td>{selectedTrade.exitPrice.toLocaleString('en-US', { maximumFractionDigits: 8 })}</td></tr>
                            <tr><td>Stop Loss</td><td>{selectedTrade.stopLoss.toLocaleString('en-US', { maximumFractionDigits: 8 })}</td></tr>
                            <tr><td>Take Profit</td><td>{selectedTrade.pnl > 0
                              ? selectedTrade.exitPrice.toLocaleString('en-US', { maximumFractionDigits: 8 })
                              : '—'}</td></tr>
                            <tr><td>Quantity</td><td>{selectedTrade.volume.toLocaleString('en-US', { maximumFractionDigits: 8 })}</td></tr>
                          </tbody>
                        </table>
                      </section>

                      <section className="report-trade-drawer__section" aria-labelledby="trade-performance-title">
                        <h5 id="trade-performance-title">Risk &amp; Performance</h5>
                        <dl className="report-trade-drawer__performance">
                          <div>
                            <dt>Risk/Reward</dt>
                            <dd>{selectedTradeR === null ? '—' : `${selectedTradeR > 0 ? '+' : ''}${selectedTradeR.toFixed(2)}R`}</dd>
                          </div>
                          <div>
                            <dt>PnL</dt>
                            <dd className={selectedTrade.pnl >= 0 ? 'positive' : 'negative'}>
                              {`${selectedTrade.pnl > 0 ? '+' : ''}${USDT_FORMAT.format(selectedTrade.pnl)} USDT`}
                            </dd>
                          </div>
                          <div>
                            <dt>Risk Amount</dt>
                            <dd>{`${USDT_FORMAT.format(Math.abs(selectedTrade.entryPrice - selectedTrade.stopLoss) * selectedTrade.volume)} USDT`}</dd>
                          </div>
                          <div>
                            <dt>Return</dt>
                            <dd className={selectedTrade.pnl >= 0 ? 'positive' : 'negative'}>
                              {selectedTradeR === null ? '—' : `${selectedTradeR > 0 ? '+' : ''}${selectedTradeR.toFixed(2)}R`}
                            </dd>
                          </div>
                        </dl>
                      </section>
                      {selectedTradeNoteId && (
                        <TradeNotes
                          key={selectedTradeNoteId}
                          tradeId={selectedTradeNoteId}
                          onHasNoteChange={(hasNote) => (
                            updateTradeNotePresence(selectedTradeNoteId, hasNote)
                          )}
                        />
                      )}
                    </div>
                  </aside>
                )}
              </div>
            </>
          )}
        </section>
      )}
      {activeReportTab === 'LTF Setup Explorer' && (
        <section className="report-ltf-explorer" aria-labelledby="ltf-setup-explorer-title">
          <label className="report-explorer__search">
            <Search size={13} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search Setup ID"
              placeholder="Search Setup ID..."
              value={setupSearch}
              onChange={(event) => setSetupSearch(event.target.value)}
            />
          </label>

          {explorerDataLoading || tradeDataLoading ? (
            <p className="report-ltf-explorer__message">Loading setup data…</p>
          ) : explorerDataError || tradeDataError ? (
            <p className="report-ltf-explorer__message" role="alert">{explorerDataError ?? tradeDataError}</p>
          ) : (
            <>
              <section className="report-ltf-explorer__list" aria-labelledby="ltf-setup-explorer-title">
                <header className="report-ltf-explorer__section-heading">
                  <h3 id="ltf-setup-explorer-title">Setup List</h3>
                  <span>
                    {filteredSetupExplorerRows.length > 0
                      ? `1–${filteredSetupExplorerRows.length} of ${setupExplorerRows.length}`
                      : `0 of ${setupExplorerRows.length}`}
                  </span>
                </header>
                <div className="report-ltf-explorer__table-wrap">
                  <table className="report-ltf-explorer__table report-ltf-explorer__setup-table">
                    <thead>
                      <tr>
                        <th>Setup ID</th>
                        <th>HTF Event</th>
                        <th>Direction</th>
                        <th>HTF MS</th>
                        <th>Created</th>
                        <th>LTF MS</th>
                        <th>Active / Invalid</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSetupExplorerRows.map((setup) => {
                        const activeCount = setup.ltfMarketStructures.filter((structure) => structure.invalidAt === null).length;
                        const invalidCount = setup.ltfMarketStructures.length - activeCount;
                        const isSelected = selectedSetupExplorerRow?.id === setup.id;
                        return (
                          <tr
                            key={setup.id}
                            className={isSelected ? 'report-ltf-explorer__row--selected' : ''}
                            tabIndex={0}
                            aria-selected={isSelected}
                            onClick={() => {
                              setSelectedExplorerSetupId(setup.id);
                              setLtfSearch('');
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSelectedExplorerSetupId(setup.id);
                                setLtfSearch('');
                              }
                            }}
                          >
                            <td>
                              <button
                                type="button"
                                className="report-ltf-explorer__id"
                                aria-pressed={isSelected}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedExplorerSetupId(setup.id);
                                  setLtfSearch('');
                                }}
                              >
                                S-{String(setup.number).padStart(3, '0')}
                              </button>
                            </td>
                            <td>{setup.htfEvent?.toUpperCase() ?? '—'}</td>
                            <td>
                              <span className={`report-ltf-explorer__direction report-ltf-explorer__direction--${setup.direction.toLowerCase()}`}>
                                {setup.direction}
                              </span>
                            </td>
                            <td>{setup.htfNumber === null ? '—' : `HTF-${String(setup.htfNumber).padStart(2, '0')}`}</td>
                            <td>{formatExplorerTime(setup.time)}</td>
                            <td>{setup.ltfMarketStructures.length}</td>
                            <td>{activeCount} / {invalidCount}</td>
                            <td>
                              <span className={`report-ltf-explorer__status${setup.endTime === null ? ' report-ltf-explorer__status--active' : ' report-ltf-explorer__status--invalid'}`}>
                                {setup.endTime === null ? 'Active' : 'Invalid'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredSetupExplorerRows.length === 0 && (
                        <tr><td className="report-ltf-explorer__empty" colSpan={8}>No setups match this search.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {selectedSetupExplorerRow ? (
                <section className="report-ltf-explorer__list" aria-labelledby="ltf-market-structure-title">
                  <label className="report-explorer__search">
                    <Search size={13} aria-hidden="true" />
                    <input
                      type="search"
                      aria-label="Search LTF MS ID"
                      placeholder="Search LTF MS ID..."
                      value={ltfSearch}
                      onChange={(event) => setLtfSearch(event.target.value)}
                    />
                  </label>
                  <header className="report-ltf-explorer__section-heading">
                    <h3 id="ltf-market-structure-title">Market Structure List</h3>
                    <span>{filteredLtfExplorerRows.length} structures</span>
                  </header>
                  <div className="report-ltf-explorer__table-wrap">
                    <table className="report-ltf-explorer__table report-ltf-explorer__ltf-table">
                      <thead>
                        <tr>
                          <th>LTF MS ID</th>
                          <th>Event</th>
                          <th>Direction</th>
                          <th>Previous Bias</th>
                          <th>Created</th>
                          <th>Invalid At</th>
                          <th>POIs</th>
                          <th>Trades</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLtfExplorerRows.map((structure) => (
                          <tr key={structure.number}>
                            <td>{structure.id}</td>
                            <td>{structure.event.toUpperCase()}</td>
                            <td>
                              <span className={`report-ltf-explorer__direction report-ltf-explorer__direction--${structure.bias.toLowerCase()}`}>
                                {structure.bias === 'BULLISH' ? 'Bullish' : 'Bearish'}
                              </span>
                            </td>
                            <td>{structure.previousBias === null
                              ? '—'
                              : structure.previousBias === 'BULLISH' ? 'Bullish' : 'Bearish'}</td>
                            <td>{formatExplorerTime(structure.time)}</td>
                            <td>{formatExplorerTime(structure.invalidAt)}</td>
                            <td>{structure.poiCount}</td>
                            <td>{structure.tradeCount}</td>
                            <td>
                              <span className={`report-ltf-explorer__status${structure.invalidAt === null ? ' report-ltf-explorer__status--active' : ' report-ltf-explorer__status--invalid'}`}>
                                {structure.invalidAt === null ? 'Active' : 'Invalid'}
                              </span>
                            </td>
                            <td className="report-ltf-explorer__actions-cell">
                              <div
                                className="report-ltf-explorer__actions"
                                ref={openActionsMenu?.type === 'ltf' && openActionsMenu.number === structure.number
                                  ? actionMenuRef
                                  : null}
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') setOpenActionsMenu(null);
                                }}
                              >
                                <button
                                  type="button"
                                  className="report-ltf-explorer__actions-trigger"
                                  aria-label={`Actions for ${structure.id}`}
                                  aria-haspopup="menu"
                                  aria-expanded={openActionsMenu?.type === 'ltf' && openActionsMenu.number === structure.number}
                                  onClick={() => setOpenActionsMenu(
                                    openActionsMenu?.type === 'ltf' && openActionsMenu.number === structure.number
                                      ? null
                                      : { type: 'ltf', number: structure.number },
                                  )}
                                >
                                  <MoreHorizontal size={15} aria-hidden="true" />
                                </button>
                                {openActionsMenu?.type === 'ltf' && openActionsMenu.number === structure.number && (
                                  <div className="report-ltf-explorer__actions-menu" role="menu" aria-label={`${structure.id} actions`}>
                                    <div className="report-ltf-explorer__actions-heading">{structure.id} · ACTIONS</div>
                                    <button type="button" role="menuitem" className="report-ltf-explorer__action-item" disabled>
                                      <Eye size={13} aria-hidden="true" />
                                      <span>View Details</span>
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="report-ltf-explorer__action-item"
                                      onClick={() => openLtfMarketStructure(selectedSetupExplorerRow.id, structure)}
                                    >
                                      <ChartCandlestick size={13} aria-hidden="true" />
                                      <span>Open Chart</span>
                                    </button>
                                    <div className="report-ltf-explorer__actions-divider" />
                                    <button type="button" role="menuitem" className="report-ltf-explorer__action-item" disabled>
                                      <List size={13} aria-hidden="true" />
                                      <span>View Structure Events</span>
                                    </button>
                                    <button type="button" role="menuitem" className="report-ltf-explorer__action-item" disabled>
                                      <Layers size={13} aria-hidden="true" />
                                      <span>View Related POIs</span>
                                    </button>
                                    <button type="button" role="menuitem" className="report-ltf-explorer__action-item" disabled>
                                      <ChartLine size={13} aria-hidden="true" />
                                      <span>View Related Trades</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {filteredLtfExplorerRows.length === 0 && (
                          <tr><td className="report-ltf-explorer__empty" colSpan={10}>No market structures match this search.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : (
                <p className="report-ltf-explorer__message">Chọn một Setup để mở màn hình LTF Market Structure Explorer.</p>
              )}
            </>
          )}
        </section>
      )}
      {!['Overview', 'Trade Explorer', 'LTF Setup Explorer'].includes(activeReportTab) && (
        <section className="report-tab-placeholder">
          <h3>{activeReportTab}</h3>
          <p>This report section is not available yet.</p>
        </section>
      )}
    </div>
  );
}
