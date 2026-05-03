// Last-known prices per ticker (in native currency)
// Update these manually or replace with a live feed
export const PRICES: Record<string, number> = {
  AAPL: 251.40,
  AMZN: 206.99,
  BYND: 0.69,
  CSG1: 27.99,
  ERBAG: 2222,
  ICL: 5.17,
  JPM: 292.21,
  KO: 74.81,
  KPLT: 7.29,
  MCD: 308.54,
  MONET: 186.40,
  O: 60.58,
  OPEN: 5.17,
  PEP: 150.62,
  PG: 143.08,
  PSNY: 17.50,
  RIO: 86.71,
  SKLZ: 2.57,
  SPY5: 657.43,
  SPYW: 27.20,
  T: 28.93,
  VZ: 50.90,
}

export const getPrice = (symbol: string, fallback: number) =>
  PRICES[symbol] ?? fallback
