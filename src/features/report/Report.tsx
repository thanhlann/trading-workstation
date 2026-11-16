import {
  CalendarDays, ChartCandlestick, ChartLine, ChevronDown, Eye, Layers, List,
  MoreHorizontal, NotebookPen, Search, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MARKET_SYMBOLS, type MarketSymbol } from '../../config/marketSymbols';
import { SYSTEM_CONFIG, type TradingMode } from '../../config/system';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import {
  loadBacktestCandles,
  loadBacktestMarketStates,
  loadBacktestSetups,
  loadBacktestTrades,
} from '../backtest-overview/backtestData';
import type { BacktestTrade } from '../backtest-overview/backtestData';
import { getCandleStructureMetrics } from '../chart/candleTooltip';
import { TradeNotes, TRADE_NOTE_PRIORITY_COLORS } from '../backtest-overview/TradeNotes';
import {
  getMarketStructureNoteId,
  getTradeNoteId,
  loadTradeNotes,
  TRADE_NOTE_PRIORITIES,
  type TradeNotePriority,
} from '../backtest-overview/tradeNotesStorage';

interface ReportProps {
  symbol: MarketSymbol;
  mode: TradingMode;
  onSetSymbol: (symbol: MarketSymbol) => void;
}

const setupTypes = ['CHOCH + OB', 'BOS + OB', 'CHOCH + FVG', 'Liquidity Sweep'];
const initialSetupTypes = ['CHOCH + OB', 'BOS + OB'];
const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
const reportTabs = ['Trade Explorer', 'Market Structure Explorer', 'Performance', 'Setup Analysis', 'Risk Analysis', 'Overview'];
const tradeExplorerFilters = ['All Trades', 'Win', 'Loss', 'Long', 'Short'] as const;
const tradeExplorerPriorityFilters = ['All Priorities', ...TRADE_NOTE_PRIORITIES] as const;
type TradeExplorerFilter = (typeof tradeExplorerFilters)[number];
type TradeExplorerPriorityFilter = (typeof tradeExplorerPriorityFilters)[number];
type ExplorerBias = 'BULLISH' | 'BEARISH';

interface LtfExplorerEntry {
  id: string;
  number: number;
  event: 'bos' | 'choch';
  bias: ExplorerBias;
  previousBias: ExplorerBias | null;
  score: number;
  time: number;
  invalidAt: number | null;
  poiCount: number;
  tradeCount: number;
}

interface HtfExplorerEntry {
  id: string;
  number: number;
  time: number;
  setupId: string | null;
  setupNumber: number | null;
  endTime: number | null;
  direction: 'Bullish' | 'Bearish';
  event: 'bos' | 'choch';
  score: number;
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
  const [tradeExplorerPriorityFilter, setTradeExplorerPriorityFilter] = useState<TradeExplorerPriorityFilter>('All Priorities');
  const [selectedTradeNumber, setSelectedTradeNumber] = useState<number | null>(null);
  const [tradeDetailsOpen, setTradeDetailsOpen] = useState(false);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const [tradeNotes, setTradeNotes] = useState<Map<string, TradeNotePriority> | null>(null);
  const [tradeNotesError, setTradeNotesError] = useState<string | null>(null);
  const [htfStructureNotes, setHtfStructureNotes] = useState<Map<string, TradeNotePriority> | null>(null);
  const [htfStructureNotesError, setHtfStructureNotesError] = useState<string | null>(null);
  const [tradeDataLoading, setTradeDataLoading] = useState(true);
  const [tradeDataError, setTradeDataError] = useState<string | null>(null);
  const [explorerSetups, setExplorerSetups] = useState<Awaited<ReturnType<typeof loadBacktestSetups>>>([]);
  const [explorerHtfStates, setExplorerHtfStates] = useState<Awaited<ReturnType<typeof loadBacktestMarketStates>>>([]);
  const [explorerLtfStates, setExplorerLtfStates] = useState<Awaited<ReturnType<typeof loadBacktestMarketStates>>>([]);
  const [explorerHtfCandles, setExplorerHtfCandles] = useState<Awaited<ReturnType<typeof loadBacktestCandles>>>([]);
  const [explorerLtfCandles, setExplorerLtfCandles] = useState<Awaited<ReturnType<typeof loadBacktestCandles>>>([]);
  const [explorerDataLoading, setExplorerDataLoading] = useState(true);
  const [explorerDataError, setExplorerDataError] = useState<string | null>(null);
  const [setupSearch, setSetupSearch] = useState('');
  const [setupIdSearch, setSetupIdSearch] = useState('');
  const [ltfSearch, setLtfSearch] = useState('');
  const [selectedHtfStructureId, setSelectedHtfStructureId] = useState<string | null>(null);
  const [selectedLtfHtfStructureId, setSelectedLtfHtfStructureId] = useState<string | null>(null);
  const [htfDetailsOpen, setHtfDetailsOpen] = useState(false);
  const [selectedLtfStructureNumber, setSelectedLtfStructureNumber] = useState<number | null>(null);
  const [ltfDetailsOpen, setLtfDetailsOpen] = useState(false);
  const [ltfStructureNotes, setLtfStructureNotes] = useState<Map<string, TradeNotePriority> | null>(null);
  const [ltfStructureNotesError, setLtfStructureNotesError] = useState<string | null>(null);
  const [openActionsMenu, setOpenActionsMenu] = useState<{ type: 'setup' | 'ltf' | 'trade'; number: number } | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const htfExplorerContentRef = useRef<HTMLDivElement>(null);
  const [htfExplorerContentHeight, setHtfExplorerContentHeight] = useState<number | null>(null);

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

  const openHtfMarketStructure = (structure: HtfExplorerEntry) => {
    navigateToWorkspace({ mode: 'backtest', activeWorkspacePage: 'chart' });
    setSelectedSetupId('');
    setBacktestNavigationTarget({
      type: 'htfMarketStructure',
      marketStructureNumber: structure.number,
      marketStructureTime: structure.time,
    });
    setBacktestTimeRange({ backtestTimeRangeFrom: '', backtestTimeRangeTo: '' });
    setBacktestTimeframe('htf');
    setReplayIndex(0);
    setOpenActionsMenu(null);
  };

  const openTradeChart = (trade: BacktestTrade) => {
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
    setTradeNotes(null);
    setTradeNotesError(null);

    if (trades.length === 0) {
      setTradeNotes(new Map());
      return () => {
        cancelled = true;
      };
    }

    loadTradeNotes(trades.map((trade) => (
      getTradeNoteId(trade.symbol, trade.number, trade.time)
    ))).then(
      (notes) => {
        if (!cancelled) setTradeNotes(notes);
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
      loadBacktestCandles('htf'),
      loadBacktestCandles('ltf'),
    ]).then(
      ([setups, htfStates, ltfStates, htfCandles, ltfCandles]) => {
        if (!cancelled) {
          setExplorerSetups(setups);
          setExplorerHtfStates(htfStates);
          setExplorerLtfStates(ltfStates);
          setExplorerHtfCandles(htfCandles);
          setExplorerLtfCandles(ltfCandles);
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
      if (tradeExplorerPriorityFilter !== 'All Priorities') {
        const noteId = getTradeNoteId(trade.symbol, trade.number, trade.time);
        if (tradeNotes?.get(noteId) !== tradeExplorerPriorityFilter) return false;
      }

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
    .sort((left, right) => left.number - right.number), [
    filteredTrades,
    tradeExplorerFilter,
    tradeExplorerPriorityFilter,
    tradeNotes,
  ]);
  const setupExplorerRows = useMemo(() => {
    const symbolCode = symbol.replace(/-/g, '').toUpperCase();
    const setupsByTime = new Map(explorerSetups
      .filter((setup) => setup.symbol.replace(/-/g, '').toUpperCase() === symbolCode)
      .map((setup) => [setup.time, setup] as const));
    const htfStates = [...explorerHtfStates]
      .sort((left, right) => Number(left.marketStructure.time) - Number(right.marketStructure.time));
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

    return htfStates.map((state, htfStateIndex): HtfExplorerEntry => {
      const time = Number(state.marketStructure.time);
      const nextHtfTime = Number(htfStates[htfStateIndex + 1]?.marketStructure.time ?? Number.POSITIVE_INFINITY);
      const setup = setupsByTime.get(time) ?? null;
      const ltfMarketStructures = ltfStates
        .filter((state) => (
          Number(state.marketStructure.time) >= time
          && Number(state.marketStructure.time) < nextHtfTime
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
            score: state.marketStructure.score,
            time: marketStructureTime,
            invalidAt,
            poiCount: state.pois.length,
            tradeCount: setup ? tradeCounts.get(`${setup.id}:${marketStructureTime}`) ?? 0 : 0,
          };
        });

      return {
        id: `${state.marketStructure.number}:${time}`,
        number: state.marketStructure.number,
        time,
        setupId: setup?.id ?? null,
        setupNumber: setup?.number ?? null,
        endTime: setup?.endTime ?? null,
        direction: state.marketStructure.bias === 'BULLISH' ? 'Bullish' : 'Bearish',
        event: state.marketStructure.event,
        score: state.marketStructure.score,
        ltfMarketStructures,
      };
    });
  }, [explorerHtfStates, explorerLtfStates, explorerSetups, symbol, trades]);
  const filteredSetupExplorerRows = useMemo(() => {
    const numberQuery = setupSearch.trim().toLowerCase();
    const setupQuery = setupIdSearch.trim().toLowerCase();
    return setupExplorerRows.filter((structure) => {
      const setupLabel = structure.setupNumber === null
        ? ''
        : `S-${String(structure.setupNumber).padStart(3, '0')}`;
      const matchesNumber = !numberQuery
        || String(structure.number).includes(numberQuery)
        || `htf-${String(structure.number).padStart(2, '0')}`.includes(numberQuery);
      const matchesSetup = !setupQuery
        || setupLabel.toLowerCase().includes(setupQuery)
        || structure.setupId?.toLowerCase().includes(setupQuery) === true;
      return matchesNumber && matchesSetup;
    });
  }, [setupExplorerRows, setupIdSearch, setupSearch]);
  const selectedHtfStructure = filteredSetupExplorerRows.find(
    (structure) => structure.id === selectedHtfStructureId,
  ) ?? null;
  const selectedLtfHtfStructure = filteredSetupExplorerRows.find(
    (structure) => structure.id === selectedLtfHtfStructureId,
  ) ?? null;
  const filteredLtfExplorerRows = selectedLtfHtfStructure?.ltfMarketStructures.filter((structure) => (
    !ltfSearch.trim()
    || structure.id.toLowerCase().includes(ltfSearch.trim().toLowerCase())
  )) ?? [];
  const selectedLtfStructure = selectedLtfHtfStructure?.ltfMarketStructures.find(
    (structure) => structure.number === selectedLtfStructureNumber,
  ) ?? null;
  const selectHtfStructure = (structureId: string) => {
    if (selectedLtfHtfStructure === null) {
      const height = htfExplorerContentRef.current?.getBoundingClientRect().height ?? 0;
      if (height > 0) setHtfExplorerContentHeight(height);
    }
    setSelectedHtfStructureId(structureId);
    setSelectedLtfHtfStructureId(structureId);
    setLtfSearch('');
    setSelectedLtfStructureNumber(null);
    setLtfDetailsOpen(false);
  };
  const htfCandleMetricsByTime = useMemo(
    () => new Map(explorerHtfCandles.map((candle, index) => [
      Number(candle.time),
      getCandleStructureMetrics(explorerHtfCandles, index),
    ])),
    [explorerHtfCandles],
  );
  const ltfCandleMetricsByTime = useMemo(
    () => new Map(explorerLtfCandles.map((candle, index) => [
      Number(candle.time),
      getCandleStructureMetrics(explorerLtfCandles, index),
    ])),
    [explorerLtfCandles],
  );
  const selectedHtfCandleMetrics = selectedHtfStructure
    ? htfCandleMetricsByTime.get(selectedHtfStructure.time) ?? null
    : null;
  const selectedLtfCandleMetrics = selectedLtfStructure
    ? ltfCandleMetricsByTime.get(selectedLtfStructure.time) ?? null
    : null;
  const selectedHtfStructureNoteId = selectedHtfStructure
    ? getMarketStructureNoteId(symbol, selectedHtfStructure.number, selectedHtfStructure.time)
    : null;
  const selectedLtfStructureNoteId = selectedLtfStructure
    ? getMarketStructureNoteId(symbol, selectedLtfStructure.number, selectedLtfStructure.time, 'ltf')
    : null;

  useEffect(() => {
    let cancelled = false;
    const noteIds = [...new Set(setupExplorerRows.map((structure) => (
      getMarketStructureNoteId(symbol, structure.number, structure.time)
    )))];
    setHtfStructureNotes(null);
    setHtfStructureNotesError(null);

    loadTradeNotes(noteIds).then(
      (notes) => {
        if (!cancelled) setHtfStructureNotes(notes);
      },
      (error: unknown) => {
        if (!cancelled) {
          setHtfStructureNotesError(error instanceof Error ? error.message : String(error));
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [setupExplorerRows, symbol]);

  useEffect(() => {
    let cancelled = false;
    setLtfStructureNotes(null);
    setLtfStructureNotesError(null);
    if (selectedLtfHtfStructure === null) {
      setLtfStructureNotes(new Map());
      return () => {
        cancelled = true;
      };
    }

    const noteIds = selectedLtfHtfStructure.ltfMarketStructures.map((structure) => (
      getMarketStructureNoteId(symbol, structure.number, structure.time, 'ltf')
    ));
    loadTradeNotes(noteIds).then(
      (notes) => {
        if (!cancelled) setLtfStructureNotes(notes);
      },
      (error: unknown) => {
        if (!cancelled) {
          setLtfStructureNotesError(error instanceof Error ? error.message : String(error));
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [selectedLtfHtfStructure, symbol]);
  const selectedTrade = explorerTrades.find((trade) => trade.number === selectedTradeNumber)
    ?? explorerTrades[0]
    ?? null;
  const selectedTradeR = selectedTrade ? getTradeR(selectedTrade) : null;
  const selectedTradeNoteId = selectedTrade
    ? getTradeNoteId(selectedTrade.symbol, selectedTrade.number, selectedTrade.time)
    : null;
  const updateTradeNotePresence = (
    id: string,
    hasNote: boolean,
    priority: TradeNotePriority,
  ) => {
    setTradeNotes((current) => {
      const next = new Map(current ?? []);
      if (hasNote) {
        next.set(id, priority);
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
          <div className="report-explorer__filters" role="group" aria-label="Trade and note priority filters">
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
            <span className="report-explorer__filter-divider" aria-hidden="true" />
            {tradeExplorerPriorityFilters.map((filter) => {
              const isActive = tradeExplorerPriorityFilter === filter;
              const isPriority = filter !== 'All Priorities';
              return (
                <button
                  type="button"
                  key={filter}
                  className={`report-explorer__filter${isActive ? ' report-explorer__filter--active' : ''}${isPriority ? ` report-explorer__filter--priority report-explorer__filter--priority-${filter.toLowerCase()}` : ''}`}
                  aria-pressed={isActive}
                  onClick={() => setTradeExplorerPriorityFilter(filter)}
                >
                  {filter}
                </button>
              );
            })}
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
                      const priority = tradeNotes?.get(tradeNoteId);
                      const hasTradeNote = priority !== undefined;
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
                                className={`report-trade-note${hasTradeNote ? ' report-trade-note--active' : ''}${tradeNotes === null && !tradeNotesError ? ' report-trade-note--loading' : ''}`}
                                style={priority ? { color: TRADE_NOTE_PRIORITY_COLORS[priority] } : undefined}
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
                                      const linkedHtfStructure = setupExplorerRows.find(
                                        (structure) => structure.setupId === trade.setup.id,
                                      );
                                      setSelectedHtfStructureId(linkedHtfStructure?.id ?? null);
                                      setHtfDetailsOpen(linkedHtfStructure !== undefined);
                                      setSetupSearch('');
                                      setSetupIdSearch('');
                                      setLtfSearch('');
                                      setActiveReportTab('Market Structure Explorer');
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
                          onHasNoteChange={(hasNote, priority) => (
                            updateTradeNotePresence(selectedTradeNoteId, hasNote, priority)
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
      {activeReportTab === 'Market Structure Explorer' && (
        <section
          className={`report-ltf-explorer${selectedLtfHtfStructure ? ' report-ltf-explorer--ltf-selected' : ''}`}
          aria-labelledby="htf-market-structure-title"
        >
          <div className="report-ltf-explorer__searches">
            <label className="report-explorer__search">
              <Search size={13} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search by Number"
                placeholder="Search by Number..."
                value={setupSearch}
                onChange={(event) => setSetupSearch(event.target.value)}
              />
            </label>
            <label className="report-explorer__search">
              <Search size={13} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search by Setup"
                placeholder="Search by Setup..."
                value={setupIdSearch}
                onChange={(event) => setSetupIdSearch(event.target.value)}
              />
            </label>
          </div>

          {explorerDataLoading || tradeDataLoading ? (
            <p className="report-ltf-explorer__message">Loading setup data…</p>
          ) : explorerDataError || tradeDataError ? (
            <p className="report-ltf-explorer__message" role="alert">{explorerDataError ?? tradeDataError}</p>
          ) : (
            <>
              <div
                ref={htfExplorerContentRef}
                className={`report-explorer__content report-htf-explorer__content${htfDetailsOpen && selectedHtfStructure ? ' report-explorer__content--details-open report-htf-explorer__content--details-open' : ''}`}
                style={selectedLtfHtfStructure && htfExplorerContentHeight !== null
                  ? { height: `${htfExplorerContentHeight}px` }
                  : undefined}
              >
              <section className="report-ltf-explorer__list" aria-labelledby="htf-market-structure-title">
                <header className="report-ltf-explorer__section-heading">
                  <h3 id="htf-market-structure-title">Market Structure HTF</h3>
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
                        <th>HTF MSID</th>
                        <th>Setup ID</th>
                        <th>HTF Event</th>
                        <th>Direction</th>
                        <th>Scored</th>
                        <th>Created</th>
                        <th>LTF MS</th>
                        <th>Active / Invalid</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSetupExplorerRows.map((structure) => {
                        const activeCount = structure.ltfMarketStructures.filter((ltf) => ltf.invalidAt === null).length;
                        const invalidCount = structure.ltfMarketStructures.length - activeCount;
                        const isSelected = selectedHtfStructure?.id === structure.id;
                        const noteId = getMarketStructureNoteId(symbol, structure.number, structure.time);
                        const notePriority = htfStructureNotes?.get(noteId);
                        return (
                          <tr
                            key={structure.id}
                            className={isSelected ? 'report-ltf-explorer__row--selected' : ''}
                            tabIndex={0}
                            aria-selected={isSelected}
                            onClick={() => selectHtfStructure(structure.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                selectHtfStructure(structure.id);
                              }
                            }}
                          >
                            <td>HTF-{String(structure.number).padStart(2, '0')}</td>
                            <td>{structure.setupNumber === null ? '' : `S-${String(structure.setupNumber).padStart(3, '0')}`}</td>
                            <td>{structure.event.toUpperCase()}</td>
                            <td>
                              <span className={`report-ltf-explorer__direction report-ltf-explorer__direction--${structure.direction.toLowerCase()}`}>
                                {structure.direction}
                              </span>
                            </td>
                            <td>{structure.score.toFixed(2)}</td>
                            <td>{formatExplorerTime(structure.time)}</td>
                            <td>{structure.ltfMarketStructures.length}</td>
                            <td>{activeCount} / {invalidCount}</td>
                            <td>{structure.setupNumber === null
                              ? '—'
                              : (
                                <span className={`report-ltf-explorer__status${structure.endTime === null ? ' report-ltf-explorer__status--active' : ' report-ltf-explorer__status--invalid'}`}>
                                  {structure.endTime === null ? 'Active' : 'Invalid'}
                                </span>
                              )}</td>
                            <td className="report-ltf-explorer__actions-cell">
                              <div
                                className="report-ltf-explorer__actions"
                                ref={openActionsMenu?.type === 'setup' && openActionsMenu.number === structure.number
                                  ? actionMenuRef
                                  : null}
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') setOpenActionsMenu(null);
                                }}
                              >
                                <button
                                  type="button"
                                  className={`report-trade-note${htfStructureNotes?.has(
                                    noteId,
                                  ) ? ' report-trade-note--active' : ''}${htfStructureNotes === null && !htfStructureNotesError ? ' report-trade-note--loading' : ''}`}
                                  style={notePriority
                                    ? { color: TRADE_NOTE_PRIORITY_COLORS[notePriority] }
                                    : undefined}
                                  aria-label={`Add or view note for HTF market structure ${structure.number}`}
                                  title={`Add or view note for HTF market structure ${structure.number}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedHtfStructureId(structure.id);
                                    setHtfDetailsOpen(true);
                                    setOpenActionsMenu(null);
                                  }}
                                >
                                  <NotebookPen size={14} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="report-ltf-explorer__actions-trigger"
                                  aria-label={`Actions for HTF market structure ${structure.number}`}
                                  aria-haspopup="menu"
                                  aria-expanded={openActionsMenu?.type === 'setup' && openActionsMenu.number === structure.number}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setOpenActionsMenu(
                                      openActionsMenu?.type === 'setup' && openActionsMenu.number === structure.number
                                        ? null
                                        : { type: 'setup', number: structure.number },
                                    );
                                  }}
                                >
                                  <MoreHorizontal size={15} aria-hidden="true" />
                                </button>
                                {openActionsMenu?.type === 'setup' && openActionsMenu.number === structure.number && (
                                  <div
                                    className="report-ltf-explorer__actions-menu"
                                    role="menu"
                                    aria-label={`HTF market structure ${structure.number} actions`}
                                  >
                                    <div className="report-ltf-explorer__actions-heading">
                                      {`HTF-${String(structure.number).padStart(2, '0')} · ACTIONS`}
                                    </div>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="report-ltf-explorer__action-item"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setSelectedHtfStructureId(structure.id);
                                        setHtfDetailsOpen(true);
                                        setOpenActionsMenu(null);
                                      }}
                                    >
                                      <Eye size={13} aria-hidden="true" />
                                      <span>View Market Structure Details</span>
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="report-ltf-explorer__action-item"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openHtfMarketStructure(structure);
                                      }}
                                    >
                                      <ChartCandlestick size={13} aria-hidden="true" />
                                      <span>Open in Backtest Overview</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredSetupExplorerRows.length === 0 && (
                        <tr><td className="report-ltf-explorer__empty" colSpan={10}>No market structures match this search.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {htfDetailsOpen && selectedHtfStructure && (
                <aside className="report-trade-drawer" aria-labelledby="htf-market-structure-details-title">
                  <header className="report-trade-drawer__header">
                    <div>
                      <h4 id="htf-market-structure-details-title">Market Structure Details</h4>
                      <p>{symbol.replace(/-/g, '')} · HTF-{String(selectedHtfStructure.number).padStart(2, '0')}</p>
                    </div>
                    <div className="report-trade-drawer__header-actions">
                      <span className={`report-trade-drawer__status${selectedHtfStructure.setupNumber === null
                        ? ' report-trade-drawer__status--neutral'
                        : selectedHtfStructure.endTime === null
                          ? ''
                          : ' report-trade-drawer__status--invalid'}`}>
                        {selectedHtfStructure.setupNumber === null
                          ? 'No Setup'
                          : selectedHtfStructure.endTime === null ? 'Active' : 'Invalid'}
                      </span>
                      <button
                        type="button"
                        className="report-trade-drawer__close"
                        aria-label="Close Market Structure Details"
                        onClick={() => setHtfDetailsOpen(false)}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </header>

                  <div className="report-trade-drawer__body">
                    <section className="report-trade-drawer__section" aria-labelledby="htf-market-structure-overview-title">
                      <h5 id="htf-market-structure-overview-title">Market Structure</h5>
                      <dl className="report-trade-drawer__overview">
                        <div>
                          <dt>HTF MSID</dt>
                          <dd>
                            <button
                              type="button"
                              className="report-trade-drawer__trade-link"
                              aria-label={`Open HTF-${String(selectedHtfStructure.number).padStart(2, '0')} in Backtest Overview`}
                              title="Open in Backtest Overview"
                              onClick={() => openHtfMarketStructure(selectedHtfStructure)}
                            >
                              HTF-{String(selectedHtfStructure.number).padStart(2, '0')}
                              <ChartCandlestick size={11} aria-hidden="true" />
                            </button>
                          </dd>
                        </div>
                        <div>
                          <dt>Setup ID</dt>
                          <dd>{selectedHtfStructure.setupNumber === null
                            ? '—'
                            : `S-${String(selectedHtfStructure.setupNumber).padStart(3, '0')}`}</dd>
                        </div>
                        <div>
                          <dt>Event</dt>
                          <dd>{selectedHtfStructure.event.toUpperCase()}</dd>
                        </div>
                        <div>
                          <dt>Direction</dt>
                          <dd className={selectedHtfStructure.direction === 'Bullish' ? 'positive' : 'negative'}>
                            {selectedHtfStructure.direction}
                          </dd>
                        </div>
                        <div><dt>Scored</dt><dd>{selectedHtfStructure.score.toFixed(2)}</dd></div>
                        <div><dt>Created</dt><dd>{formatExplorerTime(selectedHtfStructure.time)}</dd></div>
                        <div><dt>LTF Structures</dt><dd>{selectedHtfStructure.ltfMarketStructures.length}</dd></div>
                      </dl>
                    </section>
                    <section className="report-trade-drawer__section" aria-labelledby="htf-candle-overview-title">
                      <h5 id="htf-candle-overview-title">Candle Overview</h5>
                      <dl className="report-trade-drawer__overview">
                        <div><dt>Body ATR</dt><dd>{selectedHtfCandleMetrics?.bodyAtr?.toFixed(2) ?? '—'}</dd></div>
                        <div><dt>Body Ratio</dt><dd>{selectedHtfCandleMetrics?.bodyRatio.toFixed(2) ?? '—'}</dd></div>
                        <div><dt>Close Pos</dt><dd>{selectedHtfCandleMetrics?.closePos.toFixed(2) ?? '—'}</dd></div>
                      </dl>
                    </section>

                    {htfStructureNotesError && (
                      <p className="report-explorer__note-error" role="alert">
                        Could not load market structure note status: {htfStructureNotesError}
                      </p>
                    )}
                    {selectedHtfStructureNoteId && (
                      <TradeNotes
                        key={selectedHtfStructureNoteId}
                        tradeId={selectedHtfStructureNoteId}
                        title="Market Structure Notes"
                        onHasNoteChange={(hasNote, priority) => {
                          setHtfStructureNotes((current) => {
                            const next = new Map(current ?? []);
                            if (hasNote) next.set(selectedHtfStructureNoteId, priority);
                            else next.delete(selectedHtfStructureNoteId);
                            return next;
                          });
                        }}
                      />
                    )}
                  </div>
                </aside>
              )}
              </div>

              {selectedLtfHtfStructure ? (
                <div className={`report-explorer__content report-ltf-explorer__content${ltfDetailsOpen && selectedLtfStructure ? ' report-explorer__content--details-open report-ltf-explorer__content--details-open' : ''}`}>
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
                    <h3 id="ltf-market-structure-title">Market Structure LTF</h3>
                    <span>{filteredLtfExplorerRows.length} structures</span>
                  </header>
                  <div className="report-ltf-explorer__table-wrap">
                    <table className="report-ltf-explorer__table report-ltf-explorer__ltf-table">
                      <thead>
                        <tr>
                          <th>LTF MS ID</th>
                          <th>Setup ID</th>
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
                        {filteredLtfExplorerRows.map((structure) => {
                          const noteId = getMarketStructureNoteId(
                            symbol,
                            structure.number,
                            structure.time,
                            'ltf',
                          );
                          const notePriority = ltfStructureNotes?.get(noteId);
                          return (
                          <tr
                            key={structure.number}
                            className={selectedLtfStructureNumber === structure.number
                              ? 'report-ltf-explorer__row--selected'
                              : ''}
                          >
                            <td>{structure.id}</td>
                            <td>{selectedLtfHtfStructure.setupNumber === null
                              ? ''
                              : `S-${String(selectedLtfHtfStructure.setupNumber).padStart(3, '0')}`}</td>
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
                                  className={`report-trade-note${ltfStructureNotes?.has(
                                    noteId,
                                  ) ? ' report-trade-note--active' : ''}${ltfStructureNotes === null && !ltfStructureNotesError ? ' report-trade-note--loading' : ''}`}
                                  style={notePriority
                                    ? { color: TRADE_NOTE_PRIORITY_COLORS[notePriority] }
                                    : undefined}
                                  aria-label={`Add or view note for LTF market structure ${structure.number}`}
                                  title={`Add or view note for LTF market structure ${structure.number}`}
                                  onClick={() => {
                                    setSelectedLtfStructureNumber(structure.number);
                                    setLtfDetailsOpen(true);
                                  }}
                                >
                                  <NotebookPen size={14} aria-hidden="true" />
                                </button>
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
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="report-ltf-explorer__action-item"
                                      onClick={() => {
                                        setSelectedLtfStructureNumber(structure.number);
                                        setLtfDetailsOpen(true);
                                        setOpenActionsMenu(null);
                                      }}
                                    >
                                      <Eye size={13} aria-hidden="true" />
                                      <span>View Market Structure Details</span>
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="report-ltf-explorer__action-item"
                                      disabled={selectedLtfHtfStructure.setupId === null}
                                      onClick={() => {
                                        if (selectedLtfHtfStructure.setupId) {
                                          openLtfMarketStructure(selectedLtfHtfStructure.setupId, structure);
                                        }
                                      }}
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
                          );
                        })}
                        {filteredLtfExplorerRows.length === 0 && (
                          <tr><td className="report-ltf-explorer__empty" colSpan={11}>No market structures match this search.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                {ltfDetailsOpen && selectedLtfStructure && (
                  <aside
                    className="report-trade-drawer"
                    aria-labelledby="ltf-market-structure-details-title"
                  >
                    <header className="report-trade-drawer__header">
                      <div>
                        <h4 id="ltf-market-structure-details-title">Market Structure Details</h4>
                        <p>
                          {symbol.replace(/-/g, '')} · LTF-{String(selectedLtfStructure.number).padStart(3, '0')}
                        </p>
                      </div>
                      <div className="report-trade-drawer__header-actions">
                        <span className={`report-trade-drawer__status${selectedLtfStructure.invalidAt === null
                          ? ''
                          : ' report-trade-drawer__status--invalid'}`}>
                          {selectedLtfStructure.invalidAt === null ? 'Active' : 'Invalid'}
                        </span>
                        <button
                          type="button"
                          className="report-trade-drawer__close"
                          aria-label="Close Market Structure Details"
                          onClick={() => setLtfDetailsOpen(false)}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </header>
                    <div className="report-trade-drawer__body">
                      <section
                        className="report-trade-drawer__section"
                        aria-labelledby="ltf-market-structure-overview-title"
                      >
                        <h5 id="ltf-market-structure-overview-title">Market Structure</h5>
                        <dl className="report-trade-drawer__overview">
                          <div>
                            <dt>LTF MSID</dt>
                            <dd>{selectedLtfStructure.id}</dd>
                          </div>
                          <div>
                            <dt>Setup ID</dt>
                            <dd>{selectedLtfHtfStructure.setupNumber === null
                              ? '—'
                              : `S-${String(selectedLtfHtfStructure.setupNumber).padStart(3, '0')}`}</dd>
                          </div>
                          <div><dt>Event</dt><dd>{selectedLtfStructure.event.toUpperCase()}</dd></div>
                          <div>
                            <dt>Direction</dt>
                            <dd className={selectedLtfStructure.bias === 'BULLISH' ? 'positive' : 'negative'}>
                              {selectedLtfStructure.bias === 'BULLISH' ? 'Bullish' : 'Bearish'}
                            </dd>
                          </div>
                          <div><dt>Previous Bias</dt><dd>{selectedLtfStructure.previousBias === null
                            ? '—'
                            : selectedLtfStructure.previousBias === 'BULLISH' ? 'Bullish' : 'Bearish'}</dd></div>
                          <div><dt>Scored</dt><dd>{selectedLtfStructure.score.toFixed(2)}</dd></div>
                          <div><dt>Created</dt><dd>{formatExplorerTime(selectedLtfStructure.time)}</dd></div>
                          <div><dt>Invalid At</dt><dd>{formatExplorerTime(selectedLtfStructure.invalidAt)}</dd></div>
                          <div><dt>POIs</dt><dd>{selectedLtfStructure.poiCount}</dd></div>
                          <div><dt>Trades</dt><dd>{selectedLtfStructure.tradeCount}</dd></div>
                        </dl>
                      </section>
                      <section className="report-trade-drawer__section" aria-labelledby="ltf-candle-overview-title">
                        <h5 id="ltf-candle-overview-title">Candle Overview</h5>
                        <dl className="report-trade-drawer__overview">
                          <div><dt>Body ATR</dt><dd>{selectedLtfCandleMetrics?.bodyAtr?.toFixed(2) ?? '—'}</dd></div>
                          <div><dt>Body Ratio</dt><dd>{selectedLtfCandleMetrics?.bodyRatio.toFixed(2) ?? '—'}</dd></div>
                          <div><dt>Close Pos</dt><dd>{selectedLtfCandleMetrics?.closePos.toFixed(2) ?? '—'}</dd></div>
                        </dl>
                      </section>
                      {ltfStructureNotesError && (
                        <p className="report-explorer__note-error" role="alert">
                          Could not load market structure note status: {ltfStructureNotesError}
                        </p>
                      )}
                      {selectedLtfStructureNoteId && (
                        <TradeNotes
                          key={selectedLtfStructureNoteId}
                          tradeId={selectedLtfStructureNoteId}
                          title="Market Structure Notes"
                          onHasNoteChange={(hasNote, priority) => {
                            setLtfStructureNotes((current) => {
                              const next = new Map(current ?? []);
                              if (hasNote) next.set(selectedLtfStructureNoteId, priority);
                              else next.delete(selectedLtfStructureNoteId);
                              return next;
                            });
                          }}
                        />
                      )}
                    </div>
                  </aside>
                )}
                </div>
              ) : (
                <p className="report-ltf-explorer__message">Select a Market Structure HTF row to view its LTF structures.</p>
              )}
            </>
          )}
        </section>
      )}
      {!['Overview', 'Trade Explorer', 'Market Structure Explorer'].includes(activeReportTab) && (
        <section className="report-tab-placeholder">
          <h3>{activeReportTab}</h3>
          <p>This report section is not available yet.</p>
        </section>
      )}
    </div>
  );
}
