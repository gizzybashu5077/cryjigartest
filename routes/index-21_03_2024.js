var express = require('express');
var router = express.Router();
var async = require('async');
var nodeTelegramBotApi = require("node-telegram-bot-api");
let request = require("request");
var config = require('../config/global');
var connection = require('../config/connection');
const BitlyClient = require('bitly').BitlyClient;
const axios = require('axios');
var _ = require('underscore');
var moment = require('moment-timezone');
var config = require('../config/global');
// Import required modules
const ccxt = require ('ccxt');
const fs = require('fs');
const WebSocket = require('ws');
// const promisify = require('util');
const crypto = require('crypto');
const { RestClientV5 } = require('bybit-api');


// const delay = promisify(setTimeout);
const PING_INTERVAL = 20 * 1000;
const HEARTBEAT_INTERVAL = 25 * 1000;
let pingTrigger;
let heartbeatTrigger;
let ws;
let subs = [];

// MAIN FUNCTIONS
function restart() {
  if (ws) ws.terminate();

  ws = new WebSocket("wss://stream.bybit.com/v5/private");
  ws.on("open", onOpen);
  ws.on("message", onMessage);
  ws.on("error", onError);
  ws.on("pong", onPong);

  clearInterval(pingTrigger);
  pingTrigger = setInterval(() => {
    if (!(ws.readyState === WebSocket.OPEN)) return;
    ws.ping();
  }, PING_INTERVAL);
}

function subscribe(topics) {
  // topics = []
  subs = topics;
  if (!(ws.readyState === WebSocket.OPEN)) return;
  ws.send(JSON.stringify({ op: "subscribe", args: topics }));
}

function unsubscribe(topics) {
  // topics = []
  subs = subs.filter((d) => !topics.include(d));
  if (!(ws.readyState === WebSocket.OPEN)) return;
  ws.send(JSON.stringify({ op: "unsubscribe", args: topics }));
}

function generateAuthToken( API, SEC ) {
  const expires = new Date().getTime() + 10000;
  const signature = crypto
    .createHmac("sha256", SEC)
    .update("GET/realtime" + expires)
    .digest("hex");
  const payload = { op: "auth", args: [API, expires.toFixed(0), signature] };
  return JSON.stringify(payload);
}

// CONTROL FRAMES
const onOpen = () => {
  console.log("WS OPEN");

  //authentication
  const authToken = generateAuthToken(config.byKey, config.bySecret);
  console.log('authToken: ', authToken);
  ws.send(authToken);

  if (!(ws.readyState === WebSocket.OPEN)) return;
  if (!subs.length) return;
  ws.send(JSON.stringify({ op: "subscribe", args: subs }));
};

const onPong = () => {
  console.log("WS PONG RECEIVED!");
  clearTimeout(heartbeatTrigger);

  heartbeatTrigger = setTimeout(() => {
    console.log("HEARTBEAT TRIGGERED");
    restart();
  }, HEARTBEAT_INTERVAL);
};

const onMessage = (pl) => {
  console.log(pl.toString());
  let ordersData  = JSON.parse(pl);
  if(ordersData && ordersData.data){
  let sqlsss = "SELECT * FROM order_book ORDER BY id DESC LIMIT 1";
  connection.query(sqlsss, async function (err, appData) {
    if (err) {
      console.log('err: ', err);
    } else {
      let orderFound = ordersData.data.find(order => order.orderId === appData[0].order_id);
      if(orderFound != undefined){
        if(orderFound.orderStatus == 'Triggered'){
          await takeProfitOrder(appData[0]);
        }
      }
    }
  })
}
};

const onError = async (err) => {
  console.error(err);
  // await delay(5000);
  restart();
};

// CORE LOGIC
(async () => {
  restart();
  subscribe(["order"]);
})();

/* GET home page. */
router.get('/', function (req, res, next) {
  res.send('respond with a resource');
});

const client = new RestClientV5({
  testnet: false,
  key: config.byKey,
  secret: config.bySecret,
});

const binanceClient = new ccxt.binance({
  apiKey: config.biKey,
  secret: config.biSecret,
  enableRateLimit: true,
  options: {
    'adjustForTimeDifference': true,
    defaultType: 'spot',
  }
});

const binanceClient1 = new ccxt.binance({
  apiKey: config.biKey,
  secret: config.biSecret,
  enableRateLimit: true,
  options: {
    'adjustForTimeDifference': true,
    defaultType: 'future',
  }
});

const bybitClient = new ccxt.bybit({
  apiKey: config.byKey,
  secret: config.bySecret,
  enableRateLimit: true,
  options: {
    'adjustForTimeDifference': true,
    defaultType: 'spot',
  }
});

const bybitClient1 = new ccxt.bybit({
  apiKey: config.byKey,
  secret: config.bySecret,
  enableRateLimit: true,
  options: {
    'adjustForTimeDifference': true,
    defaultType: 'future',
  }
});

async function takeProfitOrder(data) {
  try {
    data?.accountType === 'spot'? await bybitClient.load_time_difference() : await bybitClient1.load_time_difference();
    // let openOrdersData1 = req.query?.accountType === 'spot' ?  await bybitClient.fetchPosition(req.query?.instrument_token) : await bybitClient1.fetchPosition(req.query?.instrument_token);
    // if(openOrdersData1.info.side != ''){
    //   let positionDirection1 = openOrdersData1.info.side.toLowerCase() == 'sell' ? 'buy' : 'sell';
    //   let openOrdersData2 =  req.query?.accountType === 'spot' ? await bybitClient.createOrder(openOrdersData1.info.symbol.replace("USDT", '/USDT:USDT'), 'market', positionDirection1, openOrdersData1.info.size, 0) : await bybitClient1.createOrder(openOrdersData1.info.symbol.replace("USDT", '/USDT:USDT'), 'market', positionDirection1, openOrdersData1.info.size, 0);
    //   console.log('openOrdersData2: ', openOrdersData2);
    // }
    const openOrders = data?.accountType === 'spot' ? await bybitClient.fetchOpenOrders(data?.instrument_token) : await bybitClient1.fetchOpenOrders(data?.instrument_token);
    if (openOrders.length != 0) {
      const canceledOrders = await Promise.all(
        openOrders.map(async order => {
          const canceledOrder = data?.accountType === 'spot' ?  await bybitClient.cancelOrder(order.id, data?.instrument_token) : await bybitClient1.cancelOrder(order.id, data?.instrument_token);
          return canceledOrder;
        })
      );
    }
    const openOrderGet = data?.accountType === 'spot' ?
      await bybitClient.fetchPosition(data?.instrument_token) :
      await bybitClient1.fetchPosition(data?.instrument_token);

    console.log('openOrderGet: ', openOrderGet);

    const entryPrice = Number(openOrderGet.entryPrice);
    const array1 = data?.tp_price.split(',');
    const array2 = data?.tp_qty.split(',');
    const array3 = data?.tp_sl.split(',');
    const finalSymbol = data?.instrument_token.replace("/USDT:USDT", 'USDT');

    const resultArray = array1.slice(0, Math.min(array1.length, array2.length, array3.length)).map((_, index) => {
      const price = data.transaction_type === 'buy' ? calculateBuyTPSL(entryPrice, array1[index]) : calculateSellTPSL(entryPrice, array1[index]);
      const qty = array2[index];
      const sl = data.transaction_type === 'buy' ? calculateBuyTPSL(entryPrice, array3[index]) : calculateSellTPSL(entryPrice, array3[index]);
      return { qty, price, sl };
    });

    // Use Promise.all to parallelize the setTradingStop calls
    const setTradingStopPromises = resultArray.map(item => setTradingStop(item, finalSymbol));
    const setTradingStopResponses = await Promise.all(setTradingStopPromises);
    console.log('setTradingStopResponses: ', setTradingStopResponses);

    let html = ``;
    for (let i = 0; i < resultArray.length; i++) {
      const entry = resultArray[i];
      const tpNumber = i + 1; // TP1, TP2, TP3, etc.
      let bookIcon = '';
      if (tpNumber == 1) {
        bookIcon = '📕';
      } else if (tpNumber == 2) {
        bookIcon = '📒';
      } else {
        bookIcon = '📗';
      }
      html += `${bookIcon} <b> TP${tpNumber} EntryPrice: </b> ${Number(entry.price).toFixed(6)}\n` +
        `${bookIcon} <b> TP${tpNumber} qty: </b> ${entry.qty}\n` +
        `${bookIcon} <b> TP${tpNumber} sl: </b> ${Number(entry.sl).toFixed(6)}\n`;
    }

    // Use async/await for teleStockMsg
    await teleStockMsg(html);
  } catch (error) {
    console.error(error);
    throw error;
  }
}

/** Order modify apis */
router.get('/setTradingStopApi', function (req, res) {
  async.waterfall([
    function (nextCall) {
      client.setTradingStop({
              category: 'linear',
              symbol: 'SLPUSDT',
              takeProfit: '0.006437',
              stopLoss: '0',
              tpTriggerBy: 'MarkPrice',
              // slTriggerBy: 'IndexPrice',
              tpslMode: 'Partial',
              tpOrderType: 'Limit',
              // slOrderType: 'Limit',
              tpSize: '10',
              // slSize: '50',
              tpLimitPrice: '0.006437',
              // slLimitPrice: '0.21',
              positionIdx: 0,
          })
          .then((response) => {
              console.log(response);
              nextCall(null, response);
          })
          .catch((error) => {
              console.error(error);
              return nextCall({
                "message": "something went wrong",
                "data": null
              });
          });
    },
  ], function (err, response) {
    if (err) {
      return res.send({
        status_api: err.code ? err.code : 400,
        message: (err && err.message) || "someyhing went wrong",
        data: err.data ? err.data : null
      });
    }
    return res.send({
      status_api: 200,
      message: "Order modify apis successfully",
      data: response
    });
  });
});

/** binance Featch balance api */
router.get('/binanceFetchBalance', async function (req, res) {
  try {
    req.query?.accountType === 'spot'? await binanceClient.load_time_difference() : await binanceClient1.load_time_difference();
    const binanceBalance = await async.waterfall([
      async function () {
        return req.query?.accountType === 'spot'
          ? (await binanceClient.fetchBalance()).info
          : (await binanceClient1.fetchBalance()).info;
      },
    ]);
    await teleStockMsg("Binance api balance featch successfully");
    res.send({
      status_api: 200,
      message: 'Binance balance fetch successfully',
      data: binanceBalance,
    });
  } catch (err) {
    await teleStockMsg("---> Binance api balance featch failed");
    res.send({
      status_api: err.code ? err.code : 400,
      message: (err && err.message) || 'Something went wrong',
      data: err.data ? err.data : null,
    });
  }
});

setInterval(function setup() {
  let sqlsss = "SELECT COUNT(*) as cnt FROM order_book";
  connection.query(sqlsss, async function (err, appData) {
    if (err) {
      console.log('err: ', err);
    } else {
      console.log('appData: ', appData[0].cnt);
      if(appData[0].cnt > 9){
       deleteRecord();
      }
      testServer();
    }
  })
}, 19000)

function deleteRecord(){   
  let sqlsss = "DELETE FROM order_book WHERE id NOT IN (SELECT id FROM (SELECT id FROM order_book ORDER BY id DESC LIMIT 5) AS last_four)";
  connection.query(sqlsss, async function (err, appData) {
    if (err) {
      console.log('err: ', err);
    } else {
      console.log('appData: ', appData);
    }
  })
}

function testServer(){   
  request({
    uri: "https://cryjigartest.onrender.com/",
    method: "GET",
  }, (err, response, body) => {
    console.log('body: ', body);
  })
}

/** bybit Featch balance api */
router.get('/bybitFetchBalance', async function (req, res) {
  try {
    req.query?.accountType === 'spot' ? await bybitClient.load_time_difference() : await bybitClient1.load_time_difference();
    const binanceBalance = await async.waterfall([
      async function () {
        return req.query?.accountType === 'spot'
          ? (await bybitClient.fetchBalance()).info
          : (await bybitClient1.fetchBalance()).info;
      },
    ]);
    await teleStockMsg("VVV Bybit api balance featch successfully");
    res.send({
      status_api: 200,
      message: 'VVV Bybit balance fetch successfully',
      data: binanceBalance,
    });
  } catch (err) {
    await teleStockMsg("---> VVV Bybit api balance featch failed");
    res.send({
      status_api: err.code ? err.code : 400,
      message: (err && err.message) || 'Something went wrong',
      data: err.data ? err.data : null,
    });
  }
});

/** bybit api token data */
router.get('/historical-data', async function (req, res) {
  try {
    req.query?.accountType === 'spot' ? await bybitClient.load_time_difference() : await bybitClient1.load_time_difference();
    const bybitBalance = await async.waterfall([
      async function () {
        const symbol = req.query?.symbol;
        const timeframe = req.query?.timeframe; // 1 day interval
        const limit = Number(req.query?.limit); // 30 days

        // Fetch OHLCV (Open/High/Low/Close/Volume) data
        const ohlcv =  req.query?.accountType === 'spot' ? await bybitClient.fetchOHLCV(symbol, timeframe, undefined, limit) : await bybitClient1.fetchOHLCV(symbol, timeframe, undefined, limit);

        // Map the response to human-readable format
        const formattedData = ohlcv.map(data => ({
          date: data[0].toString(),
          open: data[1],
          high: data[2],
          low: data[3],
          close: data[4],
          vol: data[5],
          oi:0
        }));
        return formattedData;
      },
    ]);
    res.send({
      status_api: 200,
      message: 'VVV Bybit api token data fetch successfully',
      data:{
       "status":"success", 
       "data":{
        "candles" :bybitBalance
       } 
      } ,
    });
  } catch (err) {
    await teleStockMsg("---> VVV Bybit api token data featch failed");
    res.send({
      status_api: err.code ? err.code : 400,
      message: (err && err.message) || 'Something went wrong',
      data: err.data ? err.data : null,
    });
  }
});

/** bybit buy/sell data */
router.get('/buySellApi2', async function (req, res) {
  try {
    req.query?.accountType === 'spot' ? await bybitClient.load_time_difference() : await bybitClient1.load_time_difference();
    if(req.query?.leverage && Number(req.query?.leverage) != 0){
      await bybitClient1.setLeverage(Number(req.query?.leverage),req.query?.instrument_token,{"marginMode": req.query?.margin_mode})
    }
    let finalDateTime =  moment.tz('Asia/Kolkata').format('DD-MM-YYYY HH:mm ss:SSS');
    let orderData =  req.query?.accountType === 'spot' ? await bybitClient.fetchTicker(req.query?.instrument_token) : await bybitClient1.fetchTicker(req.query?.instrument_token);
    let finalPrice = req.query?.transaction_type=='buy' ? calculateBuyTPSL(orderData.info.markPrice,req.query?.entry_offset) :  calculateSellTPSL(orderData.info.markPrice,req.query?.entry_offset);
    // let openOrderQty;
    let openOrdersData = req.query?.accountType === 'spot' ?  await bybitClient.fetchPosition(req.query?.instrument_token) : await bybitClient1.fetchPosition(req.query?.instrument_token);
    let positionDirection = openOrdersData.info.side;
    // if(req.query?.position_size && (Number(req.query?.position_size) != 0)){
    //   openOrderQty = Number(req.query?.position_size) + Number(openOrdersData.contracts);
    // }else{
     let openOrderQty = Number(req.query?.quantity) + Number(openOrdersData.info.size);
    // }
   if(positionDirection.toLowerCase() != req.query?.transaction_type){
    const bybitBalance = await async.waterfall([
      async function () {
        let symbol = req.query?.instrument_token;
        let trigger_percent = req.query?.trigger_predication;
        let type = "limit"; // or 'MARKET' or 'LIMIT'
        let side = req.query?.transaction_type; // or 'SELL' or 'BUY'
        let price = Number(finalPrice.toFixed(6)); 
        let quantity = Number(openOrderQty); 

        // Fetch OHLCV (Open/High/Low/Close/Volume) data
        let order;
        if(req.query?.sl_price && (Number(req.query?.sl_price) != 0)){
          let triggerPriceData = req.query?.transaction_type=='sell' ?  calculateBuyTPSL(finalPrice,trigger_percent) :  calculateSellTPSL(finalPrice,trigger_percent);
          let sltriggerPriceData = req.query?.transaction_type=='sell' ?   calculateBuyTPSL(finalPrice,req.query?.sl_price) :  calculateSellTPSL(finalPrice,req.query?.sl_price);
          let params = {
            'triggerPrice': Number(triggerPriceData.toFixed(6)),
            'triggerDirection':req.query?.transaction_type=='buy' ? 'above' : 'below',
            'stopLoss': {
              'type': 'limit', // or 'market', this field is not necessary if limit price is specified
              'triggerPrice': Number(sltriggerPriceData.toFixed(6)),
            },
            marginMode: req.query?.margin_mode
            // marginMode: req.query?.margin_mode =='isolated' ? 'isolated' :'cross'
          };
          order =  req.query?.accountType === 'spot' ? await bybitClient.createOrder(symbol, type, side, quantity, price, params) : await bybitClient1.createOrder(symbol, type, side, quantity, price, params);
        }else{
          let triggerPriceData = req.query?.transaction_type=='sell' ?  calculateBuyTPSL(finalPrice,trigger_percent) :  calculateSellTPSL(finalPrice,trigger_percent);
          let params = {
            'triggerPrice': Number(triggerPriceData.toFixed(6)),
            'triggerDirection':req.query?.transaction_type=='buy' ? 'above' : 'below',
            marginMode: req.query?.margin_mode,
            tpslMode:'partial'
          };
          order =  req.query?.accountType === 'spot' ? await bybitClient.createOrder(symbol, type, side, quantity, price, params) : await bybitClient1.createOrder(symbol, type, side, quantity, price, params);
        }
        let html = '<b>Account Id : </b> vijay <b>[Bybit]</b> \n\n' +
            '🔀 <b>Direction : </b> <b> ' + req.query.transaction_type.toUpperCase() + '</b>'+(req.query.transaction_type == 'buy'? '🟢' : '🔴')+'\n' +
            '🌐 <b>Script : </b> ' + req.query.instrument_token + '\n' +
            '💰 <b>Price : ₹</b> ' + finalPrice + '\n' +
            '🚫 <b>Qty : </b> ' + openOrderQty + '\n' +
            '📈 <b>Mode : </b> limit \n' +
            '🕙 <b>Trade Time : </b> ' + finalDateTime + '\n' ;
          await teleStockMsg(html);
          req.query.finalPrice = finalPrice;
          req.query.openOrderQty = openOrderQty;
          req.query.order_id = order.id;
          await orderBookDb(req.query);
          return order;
      },
    ]);
    await teleStockMsg("VVV Bybit api buy/sell api featch successfully");
    res.send({
      status_api: 200,
      message: 'VVV Bybit api buy/sell api featch successfully',
      data: bybitBalance,
    });
  }else{
    await teleStockMsg("VVV Bybit api buy/sell api fire but not order");
    res.send({
      status_api: 200,
      message: 'VVV Bybit api buy/sell api fire but not order',
      data: '',
    });
  }
  } catch (err) {
    await teleStockMsg("---> VVV Bybit api buy/sell api featch failed");
    res.send({
      status_api: err.code ? err.code : 400,
      message: (err && err.message) || 'Something went wrong',
      data: err.data ? err.data : null,
    });
  }
});

function orderBookDb(data) {
  values = [[
    data.order_id,
    moment().format('YYYY-MM-DD'),
    data.accountType,
    data.openOrderQty,
    data.price,
    data.instrument_token,
    "limit",
    data.transaction_type,
    data.sl_price,
    data.tp_price,
    data.tp_qty,
    data.tp_sl
  ]]

  let sqlss = "INSERT INTO order_book (order_id,order_date,accountType,quantity,price,instrument_token,order_type,transaction_type,trigger_price,tp_price,tp_qty,tp_sl) VALUES ?";
  connection.query(sqlss, [values], async function (err, data) {
    if (err) {
      await teleStockMsg("Order book failed")
    } else {
      await teleStockMsg("Order book successfully")
    }
  })
}

async function setTradingStop(item,symbol) {
  return client.setTradingStop({
    category: 'linear',
    symbol: symbol,
    takeProfit: Number(item.price).toFixed(6),
    stopLoss: Number(item.sl).toFixed(6),
    tpTriggerBy: 'MarkPrice',
    slTriggerBy: 'MarkPrice',
    tpslMode: 'Partial',
    tpOrderType: 'Limit',
    slOrderType: 'Limit',
    tpSize: item.qty,
    slSize: item.qty,
    tpLimitPrice: Number(item.price).toFixed(6),
    slLimitPrice: Number(item.sl).toFixed(6),
    positionIdx: 0,
  });
}

function calculateBuyTPSL(entryPrice, Percentage) {
  const getPrice = Number(entryPrice) + (Number(entryPrice) * Number(Percentage) / 100);
  return getPrice;
}

function calculateSellTPSL(entryPrice, Percentage) {
  const getPrice = Number(entryPrice) - (Number(entryPrice) * Number(Percentage) / 100);
  return getPrice;
}

/** bybit singal token price data */
router.get('/marketQuotesLTP', async function (req, res) {
  try {
    req.query?.accountType === 'spot' ? await bybitClient.load_time_difference() : await bybitClient1.load_time_difference();
    const bybitBalance = await async.waterfall([
      async function () {
        const symbol = req.query?.instrument_token;

        const order =  req.query?.accountType === 'spot' ? await bybitClient.fetchTicker(symbol) : await bybitClient1.fetchTicker(symbol);
        return order.last;
      },
    ]);
    await teleStockMsg("VVV Bybit singal token price featch successfully");
    res.send({
      status_api: 200,
      message: 'VVV Bybit singal token price featch successfully',
      data: bybitBalance,
    });
  } catch (err) {
    await teleStockMsg("---> VVV Bybit singal token price featch failed");
    res.send({
      status_api: err.code ? err.code : 400,
      message: (err && err.message) || 'Something went wrong',
      data: err.data ? err.data : null,
    });
  }
});

/** bybit singal token Cancel oreder data */
router.get('/orderCancel', async function (req, res) {
  try {
    req.query?.accountType === 'spot' ? await bybitClient.load_time_difference() : await bybitClient1.load_time_difference();
    const bybitBalance = await async.waterfall([
      async function () {
        const symbol = req.query?.instrument_key;
        const openOrders = req.query?.accountType === 'spot' ? await bybitClient.fetchOpenOrders(symbol) : await bybitClient1.fetchOpenOrders(symbol);

        if (openOrders.length === 0) {
          return 'No open orders to cancel.';
        }

        // Cancel all open orders
        const canceledOrders = await Promise.all(
          openOrders.map(async order => {
            const canceledOrder = req.query?.accountType === 'spot' ?  await bybitClient.cancelOrder(order.id, symbol) : await bybitClient1.cancelOrder(order.id, symbol);
            return canceledOrder;
          })
        );
       return canceledOrders;
      },
    ]);
    await teleStockMsg("VVV Bybit singal token cancel order successfully");
    res.send({
      status_api: 200,
      message: 'VVV Bybit singal token cancel order successfully',
      data: bybitBalance,
    });
  } catch (err) {
    await teleStockMsg("---> VVV Bybit singal token cancel order failed");
    res.send({
      status_api: err.code ? err.code : 400,
      message: (err && err.message) || 'Something went wrong',
      data: err.data ? err.data : null,
    });
  }
});

/** bybit Cancel all order token data */
router.get('/cancelAllOrder', async function (req, res) {
  try {
    req.query?.accountType === 'spot' ? await bybitClient.load_time_difference() : await bybitClient1.load_time_difference();
    const bybitBalance = await async.waterfall([
      async function () {

        const openOrders = req.query?.accountType === 'spot' ?  await bybitClient.fetchOpenOrders() : await bybitClient1.fetchOpenOrders();

        if (openOrders.length === 0) {
          return 'No open orders to cancel.';
        }

        // Cancel all open orders
        const canceledOrders = await Promise.all(
          openOrders.map(async order => {
            const canceledOrder = req.query?.accountType === 'spot' ?  await bybitClient.cancelOrder(order.id, symbol) : await bybitClient1.cancelOrder(order.id, symbol);
            return canceledOrder;
          })
        );
       return canceledOrders;
      },
    ]);
    await teleStockMsg("VVV Bybit token cancel all order successfully");
    res.send({
      status_api: 200,
      message: 'VVV Bybit token cancel all order successfully',
      data: bybitBalance,
    });
  } catch (err) {
    await teleStockMsg("---> VVV Bybit token cancel all order failed");
    res.send({
      status_api: err.code ? err.code : 400,
      message: (err && err.message) || 'Something went wrong',
      data: err.data ? err.data : null,
    });
  }
});

/** bybit  all open order token data */
router.get('/openAllOrder', async function (req, res) {
  try {
    req.query?.accountType === 'spot' ? await bybitClient.load_time_difference() : await bybitClient1.load_time_difference();
    const bybitBalance = await async.waterfall([
      async function () {

        const openOrders = req.query?.accountType === 'spot' ?  await bybitClient.fetchOpenOrders() : await bybitClient1.fetchOpenOrders();

        if (openOrders.length === 0) {
          return 'No any open orders.';
        }

       return openOrders;
      },
    ]);
    await teleStockMsg("VVV Bybit token all open order successfully");
    res.send({
      status_api: 200,
      message: 'VVV Bybit token all open order successfully',
      data: bybitBalance,
    });
  } catch (err) {
    await teleStockMsg("---> VVV Bybit token all open order failed");
    res.send({
      status_api: err.code ? err.code : 400,
      message: (err && err.message) || 'Something went wrong',
      data: err.data ? err.data : null,
    });
  }
});

/** bybit  single open order postition data */
router.get('/openSingleOrderPostition', async function (req, res) {
  try {
    req.query?.accountType === 'spot' ? await bybitClient.load_time_difference() : await bybitClient1.load_time_difference();
    const bybitBalance = await async.waterfall([
      async function () {
        const symbol = req.query?.instrument_token;

        const openOrders = req.query?.accountType === 'spot' ?  await bybitClient.fetchPosition(symbol) : await bybitClient1.fetchPosition(symbol);

        if (openOrders.length === 0) {
          return 'No open orders postion.';
        }

       return openOrders;
      },
    ]);
    res.send({
      status_api: 200,
      message: 'VVV Bybit token single open order position successfully',
      data: bybitBalance,
    });
  } catch (err) {
    await teleStockMsg("---> VVV Bybit token single open order position failed");
    res.send({
      status_api: err.code ? err.code : 400,
      message: (err && err.message) || 'Something went wrong',
      data: err.data ? err.data : null,
    });
  }
});

/** bybit  single open order postition data */
router.get('/allOrderHistory123', async function (req, res) {
  try {
    req.query?.accountType === 'spot' ? await bybitClient.load_time_difference() : await bybitClient1.load_time_difference();
    const bybitBalance = await async.waterfall([
      async function () {
        const symbol = req.query?.instrument_token;

        const openOrders = req.query?.accountType === 'spot' ?  await bybitClient.fetchTrades(symbol) : await bybitClient1.fetchTrades(symbol);
        const openOrders1 = req.query?.accountType === 'spot' ?  await bybitClient.fetchTrades(symbol) : await bybitClient1.fetchTrades(symbol);

        if (openOrders.length === 0) {
          return 'No open orders postion.';
        }

       return openOrders;
      },
    ]);
    res.send({
      status_api: 200,
      message: 'VVV Bybit token single open order position successfully',
      data: bybitBalance,
    });
  } catch (err) {
    await teleStockMsg("---> VVV Bybit token single open order position failed");
    res.send({
      status_api: err.code ? err.code : 400,
      message: (err && err.message) || 'Something went wrong',
      data: err.data ? err.data : null,
    });
  }
});

/** bybit  all open order postition data */
router.get('/openAllOrderPostition', async function (req, res) {
  try {
    req.query?.accountType === 'spot' ? await bybitClient.load_time_difference() : await bybitClient1.load_time_difference();
    const bybitBalance = await async.waterfall([
      async function () {
        const openOrders = req.query?.accountType === 'spot' ?  await bybitClient.fetchPositions() : await bybitClient1.fetchPositions();

        if (openOrders.length === 0) {
          return 'No open orders postion.';
        }

       return openOrders;
      },
    ]);
    await teleStockMsg("VVV Bybit token all open order position successfully");
    res.send({
      status_api: 200,
      message: 'VVV Bybit token all open order position successfully',
      data: bybitBalance,
    });
  } catch (err) {
    await teleStockMsg("---> VVV Bybit token all open order position failed");
    res.send({
      status_api: err.code ? err.code : 400,
      message: (err && err.message) || 'Something went wrong',
      data: err.data ? err.data : null,
    });
  }
});

/** bybit  setLeverage order postition data */
router.get('/setLeverage', async function (req, res) {
  try {
    await bybitClient1.load_time_difference();
    const bybitBalance = await async.waterfall([
      async function () {
        const setLeverageData =  await bybitClient1.setLeverage(Number(req.query?.leverage),req.query?.instrument_token,{"marginMode": req.query?.margin_mode})

       return setLeverageData;
      },
    ]);
    await teleStockMsg("VVV Bybit token setLeverage  successfully");
    res.send({
      status_api: 200,
      message: 'VVV Bybit token setLeverage successfully',
      data: bybitBalance,
    });
  } catch (err) {
    await teleStockMsg("---> VVV Bybit token setLeverage  failed");
    res.send({
      status_api: err.code ? err.code : 400,
      message: (err && err.message) || 'Something went wrong',
      data: err.data ? err.data : null,
    });
  }
});

router.get('/allOrderHistory', async (req, res) => {
  try {
    req.query?.accountType === 'spot' ? await bybitClient.load_time_difference() : await bybitClient1.load_time_difference();
    const response = await client.getClosedPnL({
        category: 'linear',
        symbol: req.query?.instrument_token,
        limit:100,
        startTime:moment(req.query?.date).valueOf(),
        endTime:moment(req.query?.date).endOf('day').valueOf()
    });

    const allData = await getNextTrend(req, response.result.list, response.result.nextPageCursor);

    return res.send({
      status_api: 200,
      message: 'Order history data fetch successfully',
      data: allData,
    });
  } catch (error) {
    console.error(error);

    return res.send({
      status_api: error.code ? error.code : 400,
      message: (error && error.message) || 'Something went wrong',
      data: error.data ? error.data : null,
    });
  }
});

async function getNextTrend(req, data, cursor) {
  try {
    let allData = [...data];

    if (cursor) {
      const response = await client.getClosedPnL({
        category: 'linear',
        symbol: req.query?.instrument_token,
        cursor:cursor,
        limit: 100,
        startTime: moment(req.query?.date).valueOf(),
        endTime: moment(req.query?.date).endOf('day').valueOf(),
      });

      allData = allData.concat(response.result.list);

      if (response.result.list > 0 && response.result.nextPageCursor) {
        return await getNextTrend(req, allData, response.result.nextPageCursor);
      }
    }

    return allData;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

/** bybit symbol data */
router.get('/symbolData', async function (req, res) {
  try {
    await bybitClient1.load_time_difference();
    // Get market symbols and quantities
    const symbolsAndQuantities =  await bybitClient1.loadMarkets();

    res.send({
      status_api: 200,
      message: 'VVV Bybit token single open order position successfully',
      data: symbolsAndQuantities,
    });
  } catch (err) {
    await teleStockMsg("---> VVV Bybit token single open order position failed");
    res.send({
      status_api: err.code ? err.code : 400,
      message: (err && err.message) || 'Something went wrong',
      data: err.data ? err.data : null,
    });
  }
});

function teleStockMsg(msg) {
  bot = new nodeTelegramBotApi(config.token);
  bot.sendMessage(config.channelId, "## "+msg, {
    parse_mode: "HTML",
    disable_web_page_preview: true
  })
}

module.exports = router;