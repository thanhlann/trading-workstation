import { useEffect, useMemo, useState } from 'react';
import type { MarketSymbol } from '../../config/marketSymbols';
import { SYSTEM_CONFIG } from '../../config/system';
import { CANDLE_SERIES_OPTIONS, getChartOptions } from '../chart/chartConfig';
import { getCandle } from '../chart/chartData';
import { ChartPanel } from '../chart/ChartPanel';
import {
  loadBacktestCandles,
  loadBacktestGeneratedAt,
  loadBacktestMarketStates,
  loadBacktestSetups,
  loadBacktestSwings,
  loadBacktestTrades,
} from './backtestData';
import type { BacktestTrade, BacktestTradePoi } from './backtestData';
import { BacktestReplayControls } from './BacktestReplayControls';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { isWithinBacktestTimeRange, parseBacktestTimeRange } from './backtestTimeRange';
import type { TradeChartOverlay } from '../chart/marketState.types';
import type { CandlestickData, Time, UTCTimestamp } from 'lightweight-charts';

const BACKTEST_CANDLE_SERIES_OPTIONS = {
  ...CANDLE_SERIES_OPTIONS,
  priceLineVisible: false,
};

function toTradeChartPoi(
  poi: BacktestTradePoi | null,
): TradeChartOverlay['htf']['poi'] {
  if (!poi) return null;

  return {
    startTime: poi.time as UTCTimestamp,
    endTime: poi.endTime === null ? null : poi.endTime as UTCTimestamp,
    high: poi.high,
    low: poi.low,
    score: poi.score,
    type: poi.type === 1 ? 'ORDER_BLOCK' : 'FVG',
    direction: poi.direction,
  };
}

function getTradeExitType(trade: BacktestTrade): 'TP' | 'SL' {
  const isTakeProfit = trade.side === 'LONG'
    ? trade.exitPrice > trade.entryPrice
    : trade.exitPrice < trade.entryPrice;

  return isTakeProfit ? 'TP' : 'SL';
}

type QuickFilter = 'all' | 'setup';

interface BacktestOverviewProps {
  symbol: MarketSymbol;
}

export function BacktestOverview({ symbol }: BacktestOverviewProps) {
  const timeframeMode = useWorkspaceStore((state) => state.backtestTimeframe);
  const timeRangeFrom = useWorkspaceStore((state) => state.backtestTimeRangeFrom);
  const timeRangeTo = useWorkspaceStore((state) => state.backtestTimeRangeTo);
  const replayIndex = useWorkspaceStore((state) => state.replayIndex);
  const setReplayIndex = useWorkspaceStore((state) => state.setReplayIndex);
  const setReplayLastIndex = useWorkspaceStore((state) => state.setReplayLastIndex);
  const navigationTarget = useWorkspaceStore((state) => state.backtestNavigationTarget);
  const setBacktestNavigationTarget = useWorkspaceStore((state) => state.setBacktestNavigationTarget);
  const timeframe = timeframeMode === 'htf' ? '1h' : '5m';
  const [candlesData, setCandlesData] = useState<CandlestickData<Time>[]>([]);
  const [marketStates, setMarketStates] = useState<Awaited<ReturnType<typeof loadBacktestMarketStates>>>([]);
  const [higherTimeframeMarketStates, setHigherTimeframeMarketStates] = useState<Awaited<ReturnType<typeof loadBacktestMarketStates>>>([]);
  const [setups, setSetups] = useState<Awaited<ReturnType<typeof loadBacktestSetups>>>([]);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [trades, setTrades] = useState<Awaited<ReturnType<typeof loadBacktestTrades>>>([]);
  const selectedSetupId = useWorkspaceStore((state) => state.selectedSetupId);
  const setSelectedSetupId = useWorkspaceStore((state) => state.setSelectedSetupId);
  const [tradeSetupFilterId, setTradeSetupFilterId] = useState('');
  const [tradeFilterActive, setTradeFilterActive] = useState(
    timeframeMode === 'ltf' && (
      navigationTarget === null || navigationTarget.type === 'trade'
    ),
  );
  const [swingMarkers, setSwingMarkers] = useState<Awaited<ReturnType<typeof loadBacktestSwings>>>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCandlesData([]);
    setMarketStates([]);
    setHigherTimeframeMarketStates([]);
    setSetups([]);
    setQuickFilter('all');
    setTrades([]);
    if (navigationTarget === null) setSelectedSetupId('');
    setTradeSetupFilterId('');
    setTradeFilterActive(timeframeMode === 'ltf' && (
      navigationTarget === null || navigationTarget.type === 'trade'
    ));
    setSwingMarkers([]);
    setGeneratedAt(null);
    setDataError(null);
    setDataLoaded(false);
    setReplayLastIndex(-1);

    Promise.all([
      loadBacktestCandles(timeframeMode),
      loadBacktestGeneratedAt(timeframeMode),
      loadBacktestMarketStates(timeframeMode),
      timeframeMode === 'ltf' ? loadBacktestMarketStates('htf') : Promise.resolve([]),
      loadBacktestSwings(timeframeMode),
      loadBacktestSetups(),
      timeframeMode === 'ltf' ? loadBacktestTrades() : Promise.resolve([]),
    ]).then(
      ([candles, timestamp, states, loadedHigherTimeframeStates, swings, loadedSetups, loadedTrades]) => {
        if (!cancelled) {
          setCandlesData(candles);
          setGeneratedAt(timestamp);
          setMarketStates(states);
          setHigherTimeframeMarketStates(
            timeframeMode === 'htf' ? states : loadedHigherTimeframeStates,
          );
          setSetups(loadedSetups);
          setTrades(loadedTrades);
          setSwingMarkers(swings);
          setDataLoaded(true);
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setDataError(error instanceof Error ? error.message : String(error));
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [setReplayLastIndex, timeframeMode]);

  const setupOptions = setups.map(({ id, number }) => ({ id, number }));
  const setupTimes = new Set(setups.map(({ time }) => time));
  const filteredTrades = trades
    .filter((trade) => !tradeSetupFilterId || trade.setup.id === tradeSetupFilterId)
    .sort((left, right) => left.ltf.marketStructure.time - right.ltf.marketStructure.time);
  const parsedTimeRange = parseBacktestTimeRange(timeRangeFrom, timeRangeTo);
  const isInTimeRange = (timestampSeconds: number) => (
    timeframeMode !== 'ltf'
    || !parsedTimeRange.valid
    || isWithinBacktestTimeRange(timestampSeconds, parsedTimeRange)
  );
  const rangeFilteredTrades = filteredTrades.filter((trade) => isInTimeRange(trade.time));
  const ltfMarketStatesByTime = new Map(
    marketStates.map((state) => [Number(state.marketStructure.time), state]),
  );
  const htfMarketStatesByTime = new Map(
    higherTimeframeMarketStates.map((state) => [Number(state.marketStructure.time), state]),
  );
  const setupsById = new Map(setups.map((setup) => [setup.id, setup]));
  const selectedSetup = setups.find((setup) => setup.id === selectedSetupId);
  const selectedSetupMarketState = selectedSetup
    ? htfMarketStatesByTime.get(selectedSetup.time) ?? null
    : null;
  const tradeEntries = rangeFilteredTrades.map((trade) => {
    const ltfMarketState = ltfMarketStatesByTime.get(trade.ltf.marketStructure.time);
    const setup = setupsById.get(trade.setup.id);
    const htfMarketState = setup
      ? htfMarketStatesByTime.get(setup.time)
      : undefined;
    return ltfMarketState && htfMarketState
      ? { trade, ltfMarketState, htfMarketState }
      : undefined;
  });
  const hasMissingTradeMarketState = tradeEntries.some((entry) => entry === undefined);
  const matchedTradeEntries = tradeEntries.filter(
    (entry): entry is NonNullable<(typeof tradeEntries)[number]> => entry !== undefined,
  );
  const matchedTradeMarketStates = matchedTradeEntries.map(({ ltfMarketState }) => ltfMarketState);
  const tradeFilteredMarketStates = tradeFilterActive && timeframeMode === 'ltf'
    ? matchedTradeMarketStates
    : marketStates.filter((state) => (
      isInTimeRange(Number(state.marketStructure.time))
      && (
        timeframeMode !== 'ltf'
        || !selectedSetup
        || Number(state.marketStructure.time) >= selectedSetup.time
      )
    ));
  const visibleMarketStates = quickFilter === 'setup' && timeframeMode === 'htf'
    ? marketStates.filter((state) => setupTimes.has(Number(state.marketStructure.time)))
    : tradeFilteredMarketStates;

  useEffect(() => {
    setReplayLastIndex(visibleMarketStates.length - 1);
  }, [setReplayLastIndex, visibleMarketStates.length]);

  useEffect(() => {
    if (navigationTarget === null || timeframeMode !== 'ltf' || !dataLoaded) return;

    setDataError(null);
    if (
      navigationTarget.type === 'trade'
      && (!tradeFilterActive || tradeSetupFilterId !== navigationTarget.setupId)
    ) {
      setTradeFilterActive(true);
      setTradeSetupFilterId(navigationTarget.setupId);
      return;
    }
    if (navigationTarget.type === 'marketStructure' && tradeFilterActive) {
      setTradeFilterActive(false);
      setTradeSetupFilterId('');
      return;
    }
    if (selectedSetupId !== navigationTarget.setupId) {
      setSelectedSetupId(navigationTarget.setupId);
      return;
    }

    const targetIndex = navigationTarget.type === 'trade'
      ? matchedTradeEntries.findIndex(({ trade }) => (
        trade.number === navigationTarget.tradeNumber
        && trade.setup.id === navigationTarget.setupId
        && trade.ltf.marketStructure.time === navigationTarget.marketStructureTime
      ))
      : visibleMarketStates.findIndex((state) => (
        Number(state.marketStructure.time) === navigationTarget.marketStructureTime
        && state.marketStructure.number === navigationTarget.marketStructureNumber
      ));
    if (targetIndex < 0) {
      setDataError(navigationTarget.type === 'trade'
        ? `Trade ${navigationTarget.tradeNumber} was not found in the LTF replay data.`
        : `LTF market structure ${navigationTarget.marketStructureNumber} was not found for setup ${navigationTarget.setupId}.`);
      setBacktestNavigationTarget(null);
      return;
    }

    setSelectedSetupId(navigationTarget.setupId);
    setReplayIndex(targetIndex);
    setBacktestNavigationTarget(null);
  }, [
    dataLoaded,
    navigationTarget,
    setBacktestNavigationTarget,
    setReplayIndex,
    setSelectedSetupId,
    selectedSetupId,
    setTradeFilterActive,
    tradeFilterActive,
    setTradeSetupFilterId,
    tradeSetupFilterId,
    timeframeMode,
    matchedTradeEntries,
    visibleMarketStates,
  ]);

  const visibleCandles = replayIndex < 0
    ? []
    : candlesData;
  const currentCandle = visibleCandles.length > 0
    ? getCandle(visibleCandles, symbol)
    : null;
  const currentMarketState = visibleMarketStates[replayIndex] ?? null;
  const currentTradeIndex = currentMarketState
    ? rangeFilteredTrades.findIndex(
      (trade) => trade.ltf.marketStructure.time === Number(currentMarketState.marketStructure.time),
    )
    : -1;
  const tradeProgressNumber = currentTradeIndex < 0 ? null : currentTradeIndex + 1;
  const currentTradeEntry = timeframeMode === 'ltf' && tradeFilterActive
    ? matchedTradeEntries[replayIndex] ?? null
    : null;
  useEffect(() => {
    if (currentTradeEntry) {
      setSelectedSetupId(currentTradeEntry.trade.setup.id);
    }
  }, [currentTradeEntry?.trade.setup.id, setSelectedSetupId]);

  const handleSelectedSetupChange = (setupId: string) => {
    setSelectedSetupId(setupId);
    setReplayIndex(0);
    if (tradeFilterActive) {
      setTradeSetupFilterId(setupId);
    }
  };
  const currentTradeTime = currentTradeEntry?.trade.ltf.marketStructure.time
    ?? currentMarketState?.marketStructure.time
    ?? null;
  const initialBalance = trades[0]?.openingBalance ?? SYSTEM_CONFIG.backtest.initialBalance;
  const currentBalanceTrade = currentTradeTime === null
    ? null
    : trades.reduce<BacktestTrade | null>((latestTrade, trade) => {
      if (trade.ltf.marketStructure.time > Number(currentTradeTime)) return latestTrade;
      if (
        latestTrade === null
        || trade.ltf.marketStructure.time > latestTrade.ltf.marketStructure.time
      ) {
        return trade;
      }
      return latestTrade;
    }, null);
  const winningTrades = trades.filter((trade) => trade.pnl > 0).length;
  const losingTrades = trades.filter((trade) => trade.pnl < 0).length;
  const tradeSummary = {
    count: trades.length,
    wins: winningTrades,
    losses: losingTrades,
    winRate: winningTrades + losingTrades > 0
      ? (winningTrades / (winningTrades + losingTrades)) * 100
      : 0,
    totalPnl: trades.reduce((total, trade) => total + trade.pnl, 0),
    currentBalance: currentBalanceTrade?.closingBalance ?? initialBalance,
    startTime: trades.length > 0
      ? Math.min(...trades.map((trade) => trade.time))
      : null,
    endTime: trades.length > 0
      ? Math.max(...trades.map((trade) => trade.endTime))
      : null,
  };
  const selectedTrade = currentTradeEntry?.trade ?? null;
  const selectedTradeExitType = selectedTrade ? getTradeExitType(selectedTrade) : null;
  const tradeOverlay = useMemo<TradeChartOverlay | null>(
    () => currentTradeEntry
      ? {
        tradeNumber: currentTradeEntry.trade.number,
        trade: {
          entry: {
            time: currentTradeEntry.trade.time as UTCTimestamp,
            price: currentTradeEntry.trade.entryPrice,
          },
          exit: {
            time: currentTradeEntry.trade.endTime as UTCTimestamp,
            price: currentTradeEntry.trade.exitPrice,
            stopLoss: currentTradeEntry.trade.stopLoss,
            type: getTradeExitType(currentTradeEntry.trade),
          },
        },
        htf: {
          marketStructure: currentTradeEntry.htfMarketState.marketStructure,
          poi: null,
        },
        ltf: {
          marketStructure: currentTradeEntry.ltfMarketState.marketStructure,
          poi: toTradeChartPoi(currentTradeEntry.trade.ltf.poi),
          sweep: currentTradeEntry.trade.ltf.sweep
            ? {
              time: currentTradeEntry.trade.ltf.sweep.time as UTCTimestamp,
              direction: currentTradeEntry.trade.ltf.sweep.direction,
              ...(currentTradeEntry.trade.ltf.sweep.score !== undefined
                ? { score: currentTradeEntry.trade.ltf.sweep.score }
                : {}),
            }
            : null,
        },
      }
      : null,
    [
      currentTradeEntry?.trade,
      currentTradeEntry?.htfMarketState,
      currentTradeEntry?.ltfMarketState,
    ],
  );
  const chartError = dataError ?? (
    timeframeMode === 'ltf' && tradeFilterActive && hasMissingTradeMarketState
      ? SYSTEM_CONFIG.ui.backtestReplay.tradeMarketStructureMissing
      : timeframeMode === 'ltf' && dataLoaded && selectedSetupId && !selectedSetupMarketState
        ? SYSTEM_CONFIG.ui.backtestReplay.setupMarketStructureMissing
        : null
  );

  return (
    <div className="market-workspace">
      <section className="chart-column">
        <ChartPanel
          panelId="backtest"
          symbol={symbol}
          timeframe={timeframe}
          subtitle={generatedAt ?? ''}
          candlesData={visibleCandles}
          currentCandle={currentCandle}
          chartOptions={getChartOptions}
          seriesOptions={BACKTEST_CANDLE_SERIES_OPTIONS}
          statusLabel={SYSTEM_CONFIG.ui.chart.demoData}
          markers={swingMarkers}
          marketStateTimeframe={timeframeMode === 'ltf'
            && (currentTradeEntry !== null || Boolean(selectedSetupId))
            ? 'htf'
            : timeframeMode}
          marketState={timeframeMode === 'ltf'
            ? currentTradeEntry?.htfMarketState
              ?? (selectedSetupId
                ? selectedSetupMarketState
                : tradeFilterActive ? null : currentMarketState)
            : currentMarketState}
          additionalMarketState={timeframeMode === 'ltf' && selectedSetupId && !currentTradeEntry
            ? currentMarketState
            : null}
          focusAdditionalMarketState={timeframeMode === 'ltf'
            && Boolean(selectedSetupId)
            && !currentTradeEntry
          }
          tradeOverlay={tradeOverlay}
          toolbarContent={chartError
            ? <span className="chart-status" role="alert">{chartError}</span>
            : undefined}
        />
      </section>
      <aside className="event-panel" aria-label={SYSTEM_CONFIG.ui.eventPanel.filterTitle}>
        <BacktestReplayControls
          marketStructureCount={visibleMarketStates.length}
          marketStructureNumber={currentMarketState?.marketStructure.number ?? null}
          tradeProgressNumber={tradeProgressNumber}
          tradeCount={rangeFilteredTrades.length}
          marketStructureNumbers={visibleMarketStates.map((state) => state.marketStructure.number)}
          marketStructureTimes={visibleMarketStates.map((state) => Number(state.marketStructure.time))}
          tradeSearchTargets={rangeFilteredTrades.map((trade) => ({
            number: trade.number,
            marketStructureTime: trade.ltf.marketStructure.time,
          }))}
          quickFilter={timeframeMode === 'htf' ? quickFilter : 'all'}
          onQuickFilterChange={setQuickFilter}
          showSetupFilter={timeframeMode === 'htf'}
          setupOptions={setupOptions}
          selectedSetupId={selectedSetupId}
          onSelectedSetupChange={handleSelectedSetupChange}
          showTradeControls={timeframeMode === 'ltf'}
          tradeFilterActive={tradeFilterActive}
          onTradeFilterChange={setTradeFilterActive}
          tradeSummary={tradeSummary}
          selectedTrade={selectedTrade}
          selectedTradeExitType={selectedTradeExitType}
        />
      </aside>
    </div>
  );
}
