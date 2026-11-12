import type {
  CandlestickData,
  SeriesMarker,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type { CandleData } from '../chart/candle.types';
import type { MarketStateOverlay } from '../chart/marketState.types';

type TimeframeMode = 'htf' | 'ltf';

const backtestDataDirectory = import.meta.env.DEV
  ? '/src/backtest-results/data'
  : '/backtest-results/data';
const backtestDataUrl = (filename: string) => `${backtestDataDirectory}/${filename}.js`;

const dataUrls: Record<TimeframeMode, string> = {
  htf: backtestDataUrl('htf_data'),
  ltf: backtestDataUrl('ltf_data'),
};

interface BacktestCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

function parseGeneratedAt(source: string): string {
  const match = source.match(/(?:^|\n)\s*generated_at\s*=\s*(['"])(.*?)\1\s*;/);
  if (!match?.[2]) {
    throw new Error('Backtest data is missing a valid generated_at value.');
  }

  return match[2];
}

const candleUrls: Record<TimeframeMode, string> = {
  htf: backtestDataUrl('htf_candles'),
  ltf: backtestDataUrl('ltf_candles'),
};

const marketStateUrls: Record<TimeframeMode, string> = {
  htf: backtestDataUrl('htf_market_states'),
  ltf: backtestDataUrl('ltf_market_states'),
};

const swingUrls: Record<TimeframeMode, string> = {
  htf: backtestDataUrl('htf_swings'),
  ltf: backtestDataUrl('ltf_swings'),
};

const setupDataUrl = backtestDataUrl('setup_data');
const tradeDataUrl = backtestDataUrl('trade_data');

interface RawMarketState {
  market_structure: {
    number: number;
    score: number;
    time: number;
    event: 'bos' | 'choch';
    bias: 'BULLISH' | 'BEARISH';
    event_price: {
      time: number;
      type: 'high' | 'low';
      price: number;
    };
  };
  pois: {
    time: number;
    end_time: number | null;
    high: number;
    low: number;
    scored: number;
    type: 'ORDER_BLOCK' | 'FVG';
    direction: 'BULLISH' | 'BEARISH';
  }[];
}

interface BacktestSwing {
  time: number;
  type: 'high' | 'low';
  price: number;
}

export interface BacktestSetup {
  id: string;
  time: number;
  number: number;
  symbol: string;
  side: 'LONG' | 'SHORT';
  endTime: number | null;
}

interface RawBacktestSetup extends Record<string, unknown> {
  id: string;
  time: number;
  number: number;
  symbol: string;
  side: 'LONG' | 'SHORT';
  end_time: number | null;
}

export interface BacktestTrade {
  number: number;
  symbol: string;
  time: number;
  endTime: number;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  pnl: number;
  openingBalance: number;
  closingBalance: number;
  volume: number;
  status: string;
  setup: {
    id: string;
    number: number;
  };
  htf: {
    marketStructure: BacktestTradeMarketStructure;
    poi: BacktestTradePoi | null;
  };
  ltf: {
    marketStructure: BacktestTradeMarketStructure;
    poi: BacktestTradePoi | null;
    sweep: BacktestTradeSweep | null;
  };
}

export interface BacktestTradeMarketStructure {
  time: number;
  event: 'bos' | 'choch';
  bias: 'BULLISH' | 'BEARISH';
  score: number;
}

export interface BacktestTradePoi {
  time: number;
  endTime: number | null;
  high: number;
  low: number;
  score: number;
  type: 1 | 2;
  direction: 'BULLISH' | 'BEARISH';
}

export interface BacktestTradeSweep {
  time: number;
  direction: 'BULLISH' | 'BEARISH';
  score?: number;
}

interface RawBacktestTradeMarketStructure extends Record<string, unknown> {
  time: number;
  event: 'bos' | 'choch';
  bias: 'BULLISH' | 'BEARISH';
  score: number;
}

interface RawBacktestTradePoi extends Record<string, unknown> {
  time: number;
  end_time: number | null;
  high: number;
  low: number;
  score: number;
  type: 1 | 2;
  direction: 'BULLISH' | 'BEARISH';
}

interface RawBacktestTradeSweep extends Record<string, unknown> {
  time: number;
  direction: 'BULLISH' | 'BEARISH';
  score?: number | null;
}

interface RawBacktestTradeTimeframe extends Record<string, unknown> {
  market_structure: RawBacktestTradeMarketStructure;
  poi: RawBacktestTradePoi | null;
}

interface RawBacktestTrade extends Record<string, unknown> {
  number: number;
  symbol: string;
  time: number;
  end_time: number;
  side: 'LONG' | 'SHORT';
  entry_price: number;
  exit_price: number;
  stop_loss: number;
  pnl: number;
  opening_balance: number;
  closing_balance: number;
  volume: number;
  status: string;
  setup: {
    id: string;
    number: number;
  };
  htf: RawBacktestTradeTimeframe;
  ltf: RawBacktestTradeTimeframe & {
    sweep: RawBacktestTradeSweep | null;
  };
}

export type BacktestMarketState = MarketStateOverlay;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBacktestSetup(value: unknown): value is RawBacktestSetup {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && isFiniteNumber(value.time)
    && Number.isSafeInteger(value.time)
    && value.time > 0
    && isFiniteNumber(value.number)
    && Number.isSafeInteger(value.number)
    && value.number > 0
    && typeof value.symbol === 'string'
    && value.symbol.length > 0
    && (value.side === 'LONG' || value.side === 'SHORT')
    && (value.end_time === null || (
      isFiniteNumber(value.end_time)
      && Number.isSafeInteger(value.end_time)
      && value.end_time >= value.time
    ));
}

function isBacktestTradeMarketStructure(
  value: unknown,
): value is RawBacktestTradeMarketStructure {
  return isRecord(value)
    && isFiniteNumber(value.time)
    && Number.isSafeInteger(value.time)
    && value.time > 0
    && (value.event === 'bos' || value.event === 'choch')
    && (value.bias === 'BULLISH' || value.bias === 'BEARISH')
    && isFiniteNumber(value.score);
}

function isBacktestTradePoi(value: unknown): value is RawBacktestTradePoi | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;

  return isFiniteNumber(value.time)
    && Number.isSafeInteger(value.time)
    && value.time > 0
    && (value.end_time === null || (
      isFiniteNumber(value.end_time)
      && Number.isSafeInteger(value.end_time)
      && value.end_time >= value.time
    ))
    && isFiniteNumber(value.high)
    && isFiniteNumber(value.low)
    && value.high > value.low
    && isFiniteNumber(value.score)
    && (value.type === 1 || value.type === 2)
    && (value.direction === 'BULLISH' || value.direction === 'BEARISH');
}

function isBacktestTradeSweep(value: unknown): value is RawBacktestTradeSweep | null {
  return value === null || (
    isRecord(value)
    && isFiniteNumber(value.time)
    && Number.isSafeInteger(value.time)
    && value.time > 0
    && (value.direction === 'BULLISH' || value.direction === 'BEARISH')
    && (value.score === undefined || value.score === null || isFiniteNumber(value.score))
  );
}

function isBacktestTradeTimeframe(value: unknown): value is RawBacktestTradeTimeframe {
  return isRecord(value)
    && isBacktestTradeMarketStructure(value.market_structure)
    && isBacktestTradePoi(value.poi);
}

function isBacktestTrade(value: unknown): value is RawBacktestTrade {
  return isRecord(value)
    && isRecord(value.setup)
    && isBacktestTradeTimeframe(value.htf)
    && isBacktestTradeTimeframe(value.ltf)
    && isBacktestTradeSweep(value.ltf.sweep)
    && isFiniteNumber(value.number)
    && Number.isSafeInteger(value.number)
    && value.number > 0
    && typeof value.symbol === 'string'
    && value.symbol.length > 0
    && isFiniteNumber(value.time)
    && Number.isSafeInteger(value.time)
    && value.time > 0
    && isFiniteNumber(value.end_time)
    && Number.isSafeInteger(value.end_time)
    && value.end_time >= value.time
    && (value.side === 'LONG' || value.side === 'SHORT')
    && isFiniteNumber(value.entry_price)
    && value.entry_price > 0
    && isFiniteNumber(value.exit_price)
    && value.exit_price > 0
    && isFiniteNumber(value.stop_loss)
    && value.stop_loss > 0
    && isFiniteNumber(value.pnl)
    && isFiniteNumber(value.opening_balance)
    && isFiniteNumber(value.closing_balance)
    && isFiniteNumber(value.volume)
    && value.volume >= 0
    && typeof value.status === 'string'
    && value.status.length > 0
    && typeof value.setup.id === 'string'
    && value.setup.id.length > 0
    && isFiniteNumber(value.setup.number)
    && Number.isSafeInteger(value.setup.number)
    && value.setup.number > 0;
}

function isBacktestCandle(value: unknown): value is BacktestCandle {
  if (!isRecord(value)) return false;

  return ['time', 'open', 'high', 'low', 'close'].every(
    (field) => typeof value[field] === 'number' && Number.isFinite(value[field]),
  ) && (value.volume === undefined || (
    typeof value.volume === 'number' && Number.isFinite(value.volume) && value.volume >= 0
  ));
}

function parseCandles(source: string): CandleData[] {
  const assignmentIndex = source.indexOf('const candles=');
  const objectStart = source.indexOf('{', assignmentIndex);
  const objectEnd = source.lastIndexOf('}');
  if (assignmentIndex < 0 || objectStart < 0 || objectEnd <= objectStart) {
    throw new Error('Backtest candle data has an invalid format.');
  }

  const parsed: unknown = JSON.parse(
    source.slice(objectStart, objectEnd + 1).replace(/,\s*([}\]])/g, '$1'),
  );
  if (!isRecord(parsed)) {
    throw new Error('Backtest candle data must be an object.');
  }

  const candles = Object.values(parsed);
  if (candles.length === 0 || !candles.every(isBacktestCandle)) {
    throw new Error('Backtest candle data is empty or contains invalid candles.');
  }

  return candles
    .sort((left, right) => left.time - right.time)
    .map(({ time, open, high, low, close, volume }) => ({
      time: time as UTCTimestamp,
      open,
      high,
      low,
      close,
      ...(volume === undefined ? {} : { volume }),
    }));
}

function isBacktestSwing(value: unknown): value is BacktestSwing {
  return isRecord(value)
    && isFiniteNumber(value.time)
    && (value.type === 'high' || value.type === 'low')
    && isFiniteNumber(value.price);
}

function parseSwings(source: string): SeriesMarker<Time>[] {
  const assignmentIndex = source.indexOf('const swings=');
  const objectStart = source.indexOf('{', assignmentIndex);
  const objectEnd = source.lastIndexOf('}');
  if (assignmentIndex < 0 || objectStart < 0 || objectEnd <= objectStart) {
    throw new Error('Backtest swing data has an invalid format.');
  }

  const parsed: unknown = JSON.parse(source.slice(objectStart, objectEnd + 1));
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).length === 0 ||
    !Object.values(parsed).every(isBacktestSwing)
  ) {
    throw new Error('Backtest swing data is empty or contains invalid points.');
  }

  return (Object.values(parsed) as BacktestSwing[])
    .sort((left, right) => left.time - right.time)
    .map(({ time, type, price }) => ({
      time: time as UTCTimestamp,
      position: 'atPriceMiddle',
      price,
      shape: 'circle',
      color: type === 'high' ? '#ef626c' : '#20b887',
      size: 1,
    }));
}

function isRawMarketState(value: unknown): value is RawMarketState {
  if (!isRecord(value) || !isRecord(value.market_structure) || !Array.isArray(value.pois)) {
    return false;
  }

  const structure = value.market_structure;
  const eventPrice = structure.event_price;
  if (
    !isFiniteNumber(structure.number) ||
    !Number.isSafeInteger(structure.number) ||
    structure.number < 1 ||
    !isFiniteNumber(structure.score) ||
    !isFiniteNumber(structure.time) ||
    (structure.event !== 'bos' && structure.event !== 'choch') ||
    (structure.bias !== 'BULLISH' && structure.bias !== 'BEARISH') ||
    !isRecord(eventPrice) ||
    !isFiniteNumber(eventPrice.time) ||
    (eventPrice.type !== 'high' && eventPrice.type !== 'low') ||
    !isFiniteNumber(eventPrice.price)
  ) {
    return false;
  }

  const stateTime = structure.time;
  if (eventPrice.time >= stateTime) return false;

  return value.pois.every((poi: unknown) => {
    if (!isRecord(poi)) return false;

    const poiTime = poi.time;
    const endTime = poi.end_time;
    const high = poi.high;
    const low = poi.low;
    if (
      !isFiniteNumber(poiTime) ||
      (endTime !== null && !isFiniteNumber(endTime)) ||
      !isFiniteNumber(high) ||
      !isFiniteNumber(low) ||
      !isFiniteNumber(poi.scored)
    ) {
      return false;
    }

    return (
      poiTime <= stateTime &&
      (endTime ?? stateTime) > poiTime &&
      high > low &&
      (poi.type === 'ORDER_BLOCK' || poi.type === 'FVG') &&
      (poi.direction === 'BULLISH' || poi.direction === 'BEARISH')
    );
  });
}

function parseMarketStates(source: string): BacktestMarketState[] {
  const assignmentIndex = source.indexOf('const market_states=');
  const objectStart = source.indexOf('{', assignmentIndex);
  const objectEnd = source.lastIndexOf('}');
  if (assignmentIndex < 0 || objectStart < 0 || objectEnd <= objectStart) {
    throw new Error('Backtest market-state data has an invalid format.');
  }

  const parsed: unknown = JSON.parse(source.slice(objectStart, objectEnd + 1));
  if (
    !isRecord(parsed) ||
    !Object.values(parsed).every(isRawMarketState) ||
    Object.keys(parsed).length === 0
  ) {
    throw new Error('Backtest market-state data is empty or contains invalid states.');
  }

  return (Object.values(parsed) as RawMarketState[])
    .map(({ market_structure: structure, pois }) => ({
      marketStructure: {
        number: structure.number,
        score: structure.score,
        time: structure.time as UTCTimestamp,
        eventPrice: {
          time: structure.event_price.time as UTCTimestamp,
          type: structure.event_price.type,
          price: structure.event_price.price,
        },
        event: structure.event,
        bias: structure.bias,
      },
      pois: pois.map((poi) => ({
        startTime: poi.time as UTCTimestamp,
        endTime: poi.end_time as UTCTimestamp | null,
        high: poi.high,
        low: poi.low,
        score: poi.scored,
        type: poi.type,
        direction: poi.direction,
      })),
    }))
    .sort((left, right) => Number(left.marketStructure.time) - Number(right.marketStructure.time));
}

function parseSetups(source: string): BacktestSetup[] {
  const assignmentIndex = source.indexOf('const setups=');
  const arrayStart = source.indexOf('[', assignmentIndex);
  const arrayEnd = source.lastIndexOf(']');
  if (assignmentIndex < 0 || arrayStart < 0 || arrayEnd <= arrayStart) {
    throw new Error('Backtest setup data has an invalid format.');
  }

  const parsed: unknown = JSON.parse(
    source.slice(arrayStart, arrayEnd + 1).replace(/,\s*([}\]])/g, '$1'),
  );
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isBacktestSetup)) {
    throw new Error('Backtest setup data is empty or contains invalid setups.');
  }

  return parsed
    .map(({ id, time, number, symbol, side, end_time }) => ({
      id,
      time,
      number,
      symbol,
      side,
      endTime: end_time,
    }))
    .sort((left, right) => left.number - right.number);
}

function parseTrades(source: string): BacktestTrade[] {
  const assignmentIndex = source.indexOf('const trades=');
  const arrayStart = source.indexOf('[', assignmentIndex);
  const arrayEnd = source.lastIndexOf(']');
  if (assignmentIndex < 0 || arrayStart < 0 || arrayEnd <= arrayStart) {
    throw new Error('Backtest trade data has an invalid format.');
  }

  const parsed: unknown = JSON.parse(
    source.slice(arrayStart, arrayEnd + 1).replace(/,\s*([}\]])/g, '$1'),
  );
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isBacktestTrade)) {
    throw new Error('Backtest trade data is empty or contains invalid trades.');
  }

  return parsed.map((trade) => ({
    number: trade.number,
    symbol: trade.symbol,
    time: trade.time,
    endTime: trade.end_time,
    side: trade.side,
    entryPrice: trade.entry_price,
    exitPrice: trade.exit_price,
    stopLoss: trade.stop_loss,
    pnl: trade.pnl,
    openingBalance: trade.opening_balance,
    closingBalance: trade.closing_balance,
    volume: trade.volume,
    status: trade.status,
    setup: {
      id: trade.setup.id,
      number: trade.setup.number,
    },
    htf: {
      marketStructure: {
        time: trade.htf.market_structure.time,
        event: trade.htf.market_structure.event,
        bias: trade.htf.market_structure.bias,
        score: trade.htf.market_structure.score,
      },
      poi: trade.htf.poi === null ? null : {
        time: trade.htf.poi.time,
        endTime: trade.htf.poi.end_time,
        high: trade.htf.poi.high,
        low: trade.htf.poi.low,
        score: trade.htf.poi.score,
        type: trade.htf.poi.type,
        direction: trade.htf.poi.direction,
      },
    },
    ltf: {
      marketStructure: {
        time: trade.ltf.market_structure.time,
        event: trade.ltf.market_structure.event,
        bias: trade.ltf.market_structure.bias,
        score: trade.ltf.market_structure.score,
      },
      poi: trade.ltf.poi === null ? null : {
        time: trade.ltf.poi.time,
        endTime: trade.ltf.poi.end_time,
        high: trade.ltf.poi.high,
        low: trade.ltf.poi.low,
        score: trade.ltf.poi.score,
        type: trade.ltf.poi.type,
        direction: trade.ltf.poi.direction,
      },
      sweep: trade.ltf.sweep === null ? null : {
        time: trade.ltf.sweep.time,
        direction: trade.ltf.sweep.direction,
        ...(typeof trade.ltf.sweep.score === 'number' ? { score: trade.ltf.sweep.score } : {}),
      },
    },
  }));
}

export async function loadBacktestCandles(
  timeframeMode: TimeframeMode,
): Promise<CandlestickData<Time>[]> {
  const response = await fetch(candleUrls[timeframeMode]);
  if (!response.ok) {
    throw new Error(
      `Could not load ${timeframeMode.toUpperCase()} backtest candles (${response.status}).`,
    );
  }

  return parseCandles(await response.text());
}

export async function loadBacktestGeneratedAt(
  timeframeMode: TimeframeMode,
): Promise<string> {
  const response = await fetch(dataUrls[timeframeMode]);
  if (!response.ok) {
    throw new Error(
      `Could not load ${timeframeMode.toUpperCase()} backtest metadata (${response.status}).`,
    );
  }

  return parseGeneratedAt(await response.text());
}

export async function loadBacktestMarketStates(
  timeframeMode: TimeframeMode,
): Promise<BacktestMarketState[]> {
  const response = await fetch(marketStateUrls[timeframeMode]);
  if (!response.ok) {
    throw new Error(
      `Could not load ${timeframeMode.toUpperCase()} market states (${response.status}).`,
    );
  }

  return parseMarketStates(await response.text());
}

export async function loadBacktestSetups(): Promise<BacktestSetup[]> {
  const response = await fetch(setupDataUrl);
  if (!response.ok) {
    throw new Error(`Could not load backtest setup data (${response.status}).`);
  }

  return parseSetups(await response.text());
}

export async function loadBacktestTrades(): Promise<BacktestTrade[]> {
  const response = await fetch(tradeDataUrl);
  if (!response.ok) {
    throw new Error(`Could not load backtest trade data (${response.status}).`);
  }

  return parseTrades(await response.text());
}

export async function loadBacktestSwings(
  timeframeMode: TimeframeMode,
): Promise<SeriesMarker<Time>[]> {
  const response = await fetch(swingUrls[timeframeMode]);
  if (!response.ok) {
    throw new Error(
      `Could not load ${timeframeMode.toUpperCase()} swing points (${response.status}).`,
    );
  }

  return parseSwings(await response.text());
}
