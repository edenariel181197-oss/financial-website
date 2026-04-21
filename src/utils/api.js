import axios from 'axios';

const BASE = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';

export async function getQuote(ticker) {
  const { data } = await axios.get(`${BASE}/quote/${ticker}`);
  return data;
}

export async function getKeyMetrics(ticker) {
  return getQuote(ticker);
}

export async function getIncomeStatement(ticker) {
  const { data } = await axios.get(`${BASE}/income/${ticker}`);
  return data;
}

export async function getBalanceSheet(ticker) {
  const { data } = await axios.get(`${BASE}/balance/${ticker}`);
  return data;
}

export async function getCashFlow(ticker) {
  const { data } = await axios.get(`${BASE}/cashflow/${ticker}`);
  return data;
}

export async function getIncomeStatementQuarterly(ticker) {
  const { data } = await axios.get(`${BASE}/quarterly/${ticker}`);
  return data;
}

export async function getRatios(ticker) {
  const { data } = await axios.get(`${BASE}/ratios/${ticker}`);
  return data;
}

export async function getChartData(ticker) {
  const { data } = await axios.get(`${BASE}/charts/${ticker}`);
  return data;
}

export async function getEstimates(ticker) {
  const { data } = await axios.get(`${BASE}/estimates/${ticker}`);
  return data;
}

export async function getCalcData(ticker) {
  const { data } = await axios.get(`${BASE}/calc-data/${ticker}`);
  return data;
}

export function fmt(num, decimals = 2) {
  if (num == null || isNaN(num)) return '—';
  if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  return Number(num).toFixed(decimals);
}

export function fmtPct(num) {
  if (num == null || isNaN(num)) return '—';
  return (num * 100).toFixed(1) + '%';
}

export function fmtRaw(num, decimals = 2) {
  if (num == null || isNaN(num)) return '—';
  return Number(num).toFixed(decimals);
}
