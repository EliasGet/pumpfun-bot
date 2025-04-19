// pumpfun-bot-node.js

const WebSocket = require('ws');
const axios = require('axios');

const PUMP_WS_URL = 'wss://pumpportal.fun/api/data';
const COINGECKECO_API_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';

// Telegram credentials (hardcoded)
const TELEGRAM_BOT_TOKEN = '8184775099:AAEpDF8jJ4UEmaZ1IZ9NKzlVmd8OqEcIvuU';
// Original personal chat ID
const TELEGRAM_CHAT_ID = '247065432';
// Telegram group chat ID
const TELEGRAM_GROUP_CHAT_ID = '-1002251802971';
// Telegram channel chat ID (private channel)
const TELEGRAM_CHANNEL_CHAT_ID = '-1002677046575';

// Set the market cap threshold to $5,000
const MARKET_CAP_THRESHOLD = 5000;

let solPriceUSD = 0;
const tokens = new Map();
const alertedTokens = new Set(); // To track tokens that have already been alerted

// DEBUG flag: set to false for cleaner output.
const DEBUG = false;

// Fetch the current SOL/USD price from CoinGecko.
async function updateSolPrice() {
  try {
    const res = await axios.get(COINGECKECO_API_URL);
    solPriceUSD = res.data.solana.usd;
    console.log(`🔥 Updated SOL/USD Price: $${solPriceUSD}`);
  } catch (error) {
    console.error('Error fetching SOL/USD price:', error.message);
  }
}
setInterval(updateSolPrice, 60000);
updateSolPrice(); // Initial fetch

// Utility: Convert a SOL amount to USD.
function solToUsd(solValue) {
  return solValue * solPriceUSD;
}

// Sends a Telegram alert with the given message to personal, group, and channel chats.
function sendTelegramAlert(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const chatIds = [
    TELEGRAM_CHAT_ID,
    TELEGRAM_GROUP_CHAT_ID,
    TELEGRAM_CHANNEL_CHAT_ID
  ];

  chatIds.forEach(id => {
    axios.post(url, {
      chat_id: id,
      text: message,
      parse_mode: 'Markdown'
    })
    .then(response => {
      console.log(`✅ Telegram message sent to ${id}:`, response.data.ok);
    })
    .catch(err => console.error(`❌ Error sending Telegram message to ${id}:`, err.message));
  });
}

// Logs token details and sends a Telegram alert.
async function logQualifiedToken(token) {
  const marketCapUSD = solToUsd(token.marketCapSol);
  const marketCapUSDFormatted = marketCapUSD.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  
  // Alert message with mint as inline code for copying
  const message =
`💎 *Qualified Token Found!*\n*Name:* ${token.name} (${token.symbol})\n*Mint:* \`${token.mint}\`\n*Market Cap:* $${marketCapUSDFormatted}`;
  
  console.log(`\n💎 Qualified Token Found!\nName: ${token.name} (${token.symbol})\nMint: ${token.mint}\nMarket Cap: $${marketCapUSDFormatted}\n------------------------------------------------------------`);
  
  sendTelegramAlert(message);
}

// Checks a token; if its current market cap is >= $5,000 and it hasn't been alerted yet, triggers an alert.
async function checkAndLogToken(token) {
  const marketCapUSD = solToUsd(token.marketCapSol || 0);
  if (!alertedTokens.has(token.mint) && marketCapUSD >= MARKET_CAP_THRESHOLD) {
    alertedTokens.add(token.mint);
    await logQualifiedToken(token);
    tokens.delete(token.mint);
  }
}

// Subscribes to token trade events for a given token mint.
function subscribeToTokenTrades(ws, mint) {
  const payload = {
    method: 'subscribeTokenTrade',
    params: { mint }
  };
  ws.send(JSON.stringify(payload));
}

// Handles new token events.
function handleNewToken(ws, tokenData) {
  const marketCapSol = parseFloat(tokenData.marketCapSol) || 0;
  const token = {
    mint: tokenData.mint,
    name: tokenData.name,
    symbol: tokenData.symbol,
    uri: tokenData.uri,
    marketCapSol: marketCapSol,
    createdAt: tokenData.timestamp ? tokenData.timestamp * 1000 : Date.now()
  };

  const currentMarketCapUSD = solToUsd(marketCapSol);
  
  if (DEBUG) {
    console.log(`DEBUG: New token received:\nName: ${token.name} (${token.symbol})\nMint: ${token.mint}\nMarketCapSol: ${marketCapSol.toFixed(2)} SOL\nCurrent Market Cap: $${currentMarketCapUSD.toFixed(2)}`);
  }
  
  // If token's current market cap is already >= $5,000, alert immediately.
  if (!alertedTokens.has(token.mint) && currentMarketCapUSD >= MARKET_CAP_THRESHOLD) {
    alertedTokens.add(token.mint);
    logQualifiedToken(token);
  } else {
    // Otherwise, store token for monitoring trade updates.
    tokens.set(token.mint, token);
    subscribeToTokenTrades(ws, token.mint);
    // Check immediately (in case it's exactly at the threshold)
    checkAndLogToken(token);
  }
}

// Handles trade update events by updating the token's marketCapSol and re-checking the threshold.
function handleTradeUpdate(parsed) {
  const mint = parsed.mint;
  const token = tokens.get(mint);
  if (!token) return;
  
  if (parsed.marketCapSol) {
    token.marketCapSol = parseFloat(parsed.marketCapSol) || token.marketCapSol;
  }
  
  const marketCapUSD = solToUsd(token.marketCapSol);
  if (DEBUG) {
    console.log(`DEBUG: Trade update for token ${token.name} (${token.symbol})\nUpdated MarketCapSol: ${token.marketCapSol.toFixed(2)} SOL\nCurrent Market Cap: $${marketCapUSD.toFixed(2)}`);
  }
  
  if (!alertedTokens.has(token.mint) && marketCapUSD >= MARKET_CAP_THRESHOLD) {
    checkAndLogToken(token);
  }
}

// Initializes the WebSocket connection and its event handlers.
function initWebSocket() {
  const ws = new WebSocket(PUMP_WS_URL);

  ws.on('open', () => {
    console.log('✅ Connected to Pump.fun WebSocket');
    ws.send(JSON.stringify({ method: 'subscribeNewToken', params: {} }));
  });

  ws.on('message', (data) => {
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      console.error('❌ Error parsing message:', error.message);
      return;
    }
    
    if (parsed.message && parsed.message.includes('Successfully subscribed')) {
      return;
    }
    
    if (parsed.txType === 'create' && parsed.pool === 'pump') {
      handleNewToken(ws, parsed);
    }
    
    if ((parsed.txType === 'buy' || parsed.txType === 'sell') && parsed.mint) {
      handleTradeUpdate(parsed);
    }
  });

  ws.on('close', () => {
    console.warn('⚠️ WebSocket closed. Reconnecting in 5 seconds...');
    setTimeout(initWebSocket, 5000);
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err.message);
  });
}

// Start the bot.
initWebSocket();
