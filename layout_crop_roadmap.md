const crypto = require('crypto');
const { XMLHttpRequest } = require("xmlhttprequest");
const LocalStorage = require('node-localstorage').LocalStorage;

if (typeof localStorage === "undefined" || localStorage === null) {
    localStorage = new LocalStorage('../scratch');
}

// API keys and passphrase
const keys = {
    "akey": localStorage.getItem('akeyDOWN.txt'),
    "skey": localStorage.getItem('skeyDOWN.txt'),
    "passphrase": 'BTCdown'
};

// API and symbol details
const apiBase = 'https://api.kucoin.com';
const endpoint = '/api/v1/orders';
const url = apiBase + encodeURI(endpoint);
const symbol = "BTC3L-USDT"; 

const nonce = Date.now();
const method = 'POST';

// Helper function to sign requests
function signRequest(apiSecret, strToSign) {
    return crypto.createHmac('sha256', apiSecret)
                 .update(strToSign)
                 .digest('base64');
}


// // Get BTC/USDT price
// function getBTCUSDTPrice() {
//     const xhr = new XMLHttpRequest();
//     const url = "https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=1";

//     xhr.open("GET", url, true);
//     xhr.onreadystatechange = function () {
//         if (xhr.readyState == 4 && xhr.status == 200) {
//             const response = JSON.parse(xhr.responseText);
//             const btcPrice = response.bids[0][0];
//             localStorage['tpBTC8UPconvert.txt'] = (Number(btcPrice)).toFixed(2);
//             sendMarketOrder();
//         }
//     };
//     xhr.send();
// }

// Send market order
function sendMarketOrder() {
    const order = {
        clientOid: crypto.randomUUID(),
        side: "buy",
        symbol: symbol,
        type: "market",
        funds: Number(localStorage['moneyTrade8UPBTC.txt'])
    };

    const body = JSON.stringify(order);
    const strToSign = nonce + method + encodeURI(endpoint) + body;
    const signature = signRequest(keys.skey, strToSign);
    const passphraseSig = signRequest(keys.skey, keys.passphrase);

    const headers = {
        'KC-API-KEY': keys.akey,
        'KC-API-SIGN': signature,
        'KC-API-TIMESTAMP': nonce.toString(),
        'KC-API-PASSPHRASE': passphraseSig,
        'KC-API-KEY-VERSION': '2',
        'Content-Type': 'application/json'
    };

    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);

    for (let key in headers) {
        xhr.setRequestHeader(key, headers[key]);
    }

    xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
            const response = JSON.parse(xhr.responseText);
            if (response && response.data && response.data.orderId) {
                localStorage['orderIdBTC8UP.txt'] = response.data.orderId;
                // Call checkSetOrder after placing market order
                checkSetOrder();
            } else {
                console.error('Market Order failed:', xhr.status, xhr.responseText);
            }
        } else {
            console.error('Market Order failed:', xhr.status, xhr.responseText);
        }
    };

    xhr.onerror = function () {
        console.error('Error making the request.');
    };

    xhr.send(body);
}


// Check and set order details
function checkSetOrder() {
    const orderId = localStorage['orderIdBTC8UP.txt'];
    const endpoint = `/api/v1/orders/${orderId}`;
    const url = apiBase + endpoint;
    const nonce = Date.now();
    const method = 'GET';
    
    const strToSign = nonce + method + endpoint;
    const signature = signRequest(keys.skey, strToSign);
    const passphraseSig = signRequest(keys.skey, keys.passphrase);

    const headers = {
        'KC-API-KEY': keys.akey,
        'KC-API-SIGN': signature,
        'KC-API-TIMESTAMP': nonce.toString(),
        'KC-API-PASSPHRASE': passphraseSig,
        'KC-API-KEY-VERSION': '2',
        'Content-Type': 'application/json'
    };

    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);

    for (let header in headers) {
        xhr.setRequestHeader(header, headers[header]);
    }

    xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
            localStorage['ExecutedBTC8UP.txt'] = JSON.parse(xhr.responseText).data.dealSize
            localStorage['TotalBTC8UP.txt'] = JSON.parse(xhr.responseText).data.dealFunds
            localStorage['tpBTC8UP.txt'] = (Math.floor( ( (Number(localStorage['TotalBTC8UP.txt']) / Number(localStorage['ExecutedBTC8UP.txt'])) * (Number(localStorage['x.txt']) / 100) + (Number(localStorage['TotalBTC8UP.txt']) / Number(localStorage['ExecutedBTC8UP.txt'])) ) * Number(localStorage['decimalPriceBTCUP.txt']) ) / Number(localStorage['decimalPriceBTCUP.txt']) );   

            // Call getCurrentBalance after checking order
            getCurrentBalance();
        } else {
            console.error("Error fetching order:", xhr.statusText);
        }
    };

    xhr.onerror = function() {
        console.error("Request failed");
    };

    xhr.send();
}


// Get current balance
function getCurrentBalance() {
    const baseUrl = 'https://api.kucoin.com/api/v1/accounts';
    const timestamp = Date.now();
    const method = 'GET';

    const queryString = '';
    const requestPath = '/api/v1/accounts';
    const body = '';
    
    const signature = crypto.createHmac('sha256', keys.skey)
        .update(`${timestamp}${method}${requestPath}${queryString}${body}`)
        .digest('base64');

    const xhr = new XMLHttpRequest();
    xhr.open(method, baseUrl);
    xhr.setRequestHeader('KC-API-KEY', keys.akey);
    xhr.setRequestHeader('KC-API-SIGN', signature);
    xhr.setRequestHeader('KC-API-TIMESTAMP', timestamp.toString());
    xhr.setRequestHeader('KC-API-PASSPHRASE', keys.passphrase);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                const response = JSON.parse(xhr.responseText);
                const accounts = response.data;
                const Account = accounts.find(account => account.currency === symbol.replace('-USDT', ''));
                localStorage['ExecutedBTC8UP.txt'] = Account.available;
                //localStorage['tpBTC8UPconvert.txt'] = ((((((((Number(localStorage['tpBTC8UP.txt'])-(Number(localStorage['TotalBTC8UP.txt'])/Number(localStorage['ExecutedBTC8UP.txt']))))/Number(localStorage['tpBTC8UP.txt']))*100)/3)/100)*Number(localStorage['tpBTC8UPconvert.txt']))+Number(localStorage['tpBTC8UPconvert.txt'])).toFixed(2)
                sendLimitSellOrder();
            }
        }
    };

    xhr.send();
}


// Send limit sell order
function sendLimitSellOrder() {
    const order = {
        clientOid: crypto.randomUUID(),
        side: "sell",
        symbol: symbol,
        type: "limit",
        price: localStorage['tpBTC8UP.txt'],
        size: localStorage['ExecutedBTC8UP.txt']
    };

    const endpoint = '/api/v1/orders';
    const url = apiBase + endpoint;
    const nonce = Date.now().toString();
    const body = JSON.stringify(order);

    const strToSign = nonce + 'POST' + endpoint + body;
    const signature = signRequest(keys.skey, strToSign);
    const passphraseSig = signRequest(keys.skey, keys.passphrase);

    const headers = {
        'KC-API-KEY': keys.akey,
        'KC-API-SIGN': signature,
        'KC-API-TIMESTAMP': nonce,
        'KC-API-PASSPHRASE': passphraseSig,
        'KC-API-KEY-VERSION': '2',
        'Content-Type': 'application/json'
    };

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);

    for (let header in headers) {
        xhr.setRequestHeader(header, headers[header]);
    }

    xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
            //console.log('Limit Sell Order response:', xhr.responseText);
        } else {
            console.error('Limit Sell Order failed:', xhr.status, xhr.responseText);
        }
    };

    xhr.onerror = function () {
        console.error('Error making the request.');
    };

    xhr.send(body);
}

sendMarketOrder();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            