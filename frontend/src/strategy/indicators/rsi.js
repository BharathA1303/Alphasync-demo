/**
 * Relative Strength Index (RSI)
 * @param {number[]} closes - Array of closing prices
 * @param {number} [period=14] - RSI lookback period
 * @returns {number[]} RSI values (first `period` entries are NaN)
 */
export function rsi(closes, period = 14) {
    const result = [];
    if (closes.length < period + 1) {
        return closes.map(() => NaN);
    }

    const gains = [];
    const losses = [];

    for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
    }

    // Initial average gain/loss (SMA)
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < period; i++) {
        avgGain += gains[i];
        avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;

    // Fill NaNs for the first `period` candles (indices 0..period-1)
    for (let i = 0; i < period; i++) result.push(NaN);

    // First RSI value
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));

    // Smoothed RSI
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        const rs2 = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs2));
    }

    return result;
}
