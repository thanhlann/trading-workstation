import type { Time } from 'lightweight-charts';

export interface MarketStateOverlay {
  marketStructure: {
    number: number;
    score: number;
    time: Time;
    eventPrice: {
      time: Time;
      type: 'high' | 'low';
      price: number;
    };
    event: 'bos' | 'choch';
    bias: 'BULLISH' | 'BEARISH';
  };
  pois: {
    startTime: Time;
    endTime: Time | null;
    high: number;
    low: number;
    score: number;
    type: 'ORDER_BLOCK' | 'FVG';
    direction: 'BULLISH' | 'BEARISH';
  }[];
}

export interface TradeChartOverlay {
  tradeNumber: number;
  trade: {
    entry: {
      time: Time;
      price: number;
    };
    exit: {
      time: Time;
      price: number;
      stopLoss: number;
      type: 'TP' | 'SL';
    };
  };
  htf: {
    marketStructure: MarketStateOverlay['marketStructure'];
    poi: MarketStateOverlay['pois'][number] | null;
  };
  ltf: {
    marketStructure: MarketStateOverlay['marketStructure'];
    poi: MarketStateOverlay['pois'][number] | null;
    sweep: {
      time: Time;
      direction: 'BULLISH' | 'BEARISH';
      score?: number;
    } | null;
  };
}
