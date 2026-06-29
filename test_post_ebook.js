<?php
require_once __DIR__ . '/config.php'; // โหลด $apiKey, $apiSecret, $apiPassphrase
$baseUri = 'https://api.kucoin.com';

// ตั้งค่า $apiPassphrase หากไม่ได้กำหนดใน config.php
if (!isset($apiPassphrase)) {
    $apiPassphrase = 'BTCdown';
}

// ฟังก์ชันสร้าง Signature สำหรับ API
function generateSignature($apiSecret, $timestamp, $method, $endpoint, $queryString = '') {
    $strToSign = $timestamp . $method . $endpoint . ($queryString ? '?' . $queryString : '');
    return base64_encode(hash_hmac('sha256', $strToSign, $apiSecret, true));
}

// ดึงข้อมูลเมื่อมีการส่ง coin ผ่าน GET
if (isset($_GET['coin']) && isset($_GET['date']) && isset($_GET['time'])) {
    $coin = $_GET['coin'];
    $symbol = strtoupper($coin) . '-USDT';
    $csvDate = $_GET['date']; // วันที่จาก CSV เช่น 2025-04-06
    $csvTime = $_GET['time']; // เวลาจาก CSV เช่น 21:31:05

    // แปลงวันที่และเวลาจาก CSV เป็น timestamp
    $targetTime = strtotime("$csvDate $csvTime");
    $startAt = $targetTime - (2 * 86400); // 48 ชั่วโมงก่อนหน้า
    $endAt = $targetTime + (2 * 86400);   // 48 ชั่วโมงหลังจากนั้น

    // ดึงข้อมูล candles (ราคา) ใช้ timeframe 1 ชั่วโมง
    $endpointCandles = '/api/v1/market/candles';
    $queryStringCandles = http_build_query([
        'symbol' => $symbol,
        'type' => '1hour',
        'startAt' => $startAt,
        'endAt' => $endAt
    ]);

    $timestamp = time() * 1000;
    $method = 'GET';
    $signature = generateSignature($apiSecret, $timestamp, $method, $endpointCandles, $queryStringCandles);

    $headers = [
        'KC-API-KEY: ' . $apiKey,
        'KC-API-SIGN: ' . $signature,
        'KC-API-TIMESTAMP: ' . $timestamp,
        'KC-API-PASSPHRASE: ' . $apiPassphrase,
        'KC-API-KEY-VERSION: 2'
    ];

    $ch = curl_init($baseUri . $endpointCandles . '?' . $queryStringCandles);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    // ไม่มี timeout เพื่อให้รออย่างไม่มีกำหนด
    $responseCandles = curl_exec($ch);
    if ($responseCandles === false) {
        echo json_encode(['error' => 'cURL error (candles): ' . curl_error($ch)]);
        curl_close($ch);
        exit;
    }
    curl_close($ch);

    $dataCandles = json_decode($responseCandles, true);
    if (!$dataCandles || !isset($dataCandles['data'])) {
        echo json_encode(['error' => 'No candle data from API: ' . json_encode($dataCandles)]);
        exit;
    }

    // ประมวลผลข้อมูล candles
    $labels = [];
    $values = [];
    $candleTimes = [];
    foreach ($dataCandles['data'] as $candle) {
        $candleTimes[] = $candle[0]; // เวลาของ candle (Unix timestamp)
        $labels[] = date('Y-m-d H:i', $candle[0]); // แสดงวันที่และเวลา
        $values[] = floatval($candle[2]); // ราคาปิด
    }

    // ส่งข้อมูลกลับไปยัง client
    header('Content-Type: application/json');
    echo json_encode([
        'labels' => $labels,
        'values' => $values,
        'candleTimes' => $candleTimes
    ]);
    exit;
}
?>

<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>วิเคราะห์ Trade Logs แยก Long/Short</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@2.0.2/dist/chartjs-plugin-annotation.min.js"></script>
    <style>
        body {
            font-family: 'Poppins', sans-serif;
            text-align: center;
            color: white;
            background: linear-gradient(135deg, #2c3e50, #4ca1af);
            margin: 0;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        h1, h3 {
            margin: 20px 0;
        }
        table {
            width: 100%;
            max-width: 1200px;
            margin: 20px auto;
            border-collapse: collapse;
            background: rgba(255, 255, 255, 0.15);
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        }
        th {
            background: linear-gradient(135deg, #16a085, #27ae60);
            color: white;
            padding: 12px;
            text-transform: uppercase;
        }
        td {
            padding: 8px;
            color: #ffffff;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        }
        td:hover {
            background: rgba(255, 255, 255, 0.4);
            cursor: pointer;
        }
        tr:nth-child(even) {
            background: rgba(255, 255, 255, 0.1);
        }
        .graph-row {
            width: 100%;
            background: rgba(255, 255, 255, 0.9);
            border-radius: 8px;
        }
        .graph-row.active {
            display: table-row !important;
            height: 300px;
            padding: 10px;
            visibility: visible !important;
        }
        .graph-container {
            width: 100%;
            height: 280px;
            min-height: 280px;
            color: #333;
            font-size: 14px;
            text-align: center;
            line-height: 280px;
        }
        .error-message {
            color: red;
            font-size: 12px;
            margin-top: 5px;
        }
        canvas {
            width: 100% !important;
            height: 100% !important;
        }
        @media screen and (max-width: 600px) {
            table { width: 100%; }
            th, td { padding: 6px; font-size: 12px; }
            .graph-row.active { height: 200px; }
            .graph-container { height: 180px; min-height: 180px; line-height: 180px; }
        }
    </style>
</head>
<body>
    <h1>Trade Logs วิเคราะห์แยก Long/Short</h1>
    <div id="tables-container"></div>

    <script>
        const fileList = [
            { name: 'btcA', path: 'btcA/trade_log.csv' },
            { name: 'btcB', path: 'btcB/trade_log.csv' },
            { name: 'btcC', path: 'btcC/trade_log.csv' },
            { name: 'btcD', path: 'btcD/trade_log.csv' }
        ];

        window.addEventListener('DOMContentLoaded', async () => {
            for (const file of fileList) {
                await loadAndDisplay(file.name, file.path);
            }
        });

        async function loadAndDisplay(name, filePath) {
            try {
                const response = await fetch(filePath);
                if (!response.ok) throw new Error(`โหลด ${filePath} ไม่ได้`);
                const text = await response.text();
                await displayWinningTradesTable(name, text);
            } catch (err) {
                console.error('Error loading CSV:', err);
            }
        }

        async function displayWinningTradesTable(name, csvText) {
            const rows = csvText.trim().split('\n').map(row => row.split(','));
            if (rows.length < 2) {
                console.warn(`No data in CSV for ${name}`);
                return;
            }

            const winningRows = rows.slice(1).filter(row => row[9] && row[9].trim() === 'ชนะ');
            const allWinning = winningRows.reverse(); // แสดงทั้งหมด โดยเรียงจากใหม่ไปเก่า

            const container = document.getElementById('tables-container');
            // สร้าง wrapper div สำหรับแต่ละ table
            const tableWrapper = document.createElement('div');
            tableWrapper.innerHTML = `<h3>ผล Trade ของ: ${name}</h3>`;
            const table = document.createElement('table');
            tableWrapper.appendChild(table);
            container.appendChild(tableWrapper);

            const thead = table.createTHead();
            const headerRow = thead.insertRow();
            rows[0].forEach(header => {
                const th = document.createElement('th');
                th.textContent = header.trim();
                headerRow.appendChild(th);
            });

            const tbody = table.createTBody();
            if (allWinning.length > 0) {
                for (let i = 0; i < allWinning.length; i++) {
                    const row = allWinning[i];
                    const tr = tbody.insertRow();
                    row.forEach(cell => {
                        const td = tr.insertCell();
                        td.textContent = cell.trim();
                    });

                    const graphTr = tbody.insertRow();
                    graphTr.className = 'graph-row active';
                    const graphTd = graphTr.insertCell();
                    graphTd.colSpan = row.length;
                    graphTd.innerHTML = '<div class="graph-container">Loading...</div>';

                    await showGraph(row[1].trim(), tr, graphTd.firstChild, row);
                }
            } else {
                const tr = tbody.insertRow();
                const td = tr.insertCell();
                td.colSpan = rows[0].length;
                td.textContent = 'ไม่มีรายการที่ชนะ';
                td.style.textAlign = 'center';
            }
        }

        let charts = [];

        async function showGraph(coin, tr, container, csvRow) {
            const graphContainer = container.querySelector('.graph-container') || container;

            try {
                console.log(`Rendering graph for ${coin} at ${csvRow[3]} ${csvRow[4]}`);
                const controller = new AbortController();
                const csvDate = csvRow[3]; // วันที่ เช่น 2025-04-06
                const response = await fetch(`?coin=${coin}&date=${csvDate}&time=${csvRow[4]}`, { signal: controller.signal });

                if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
                const data = await response.json();

                console.log('API Response:', data);

                if (data.error) {
                    throw new Error(data.error);
                }

                if (!data.labels || !data.values || data.labels.length === 0) {
                    throw new Error('ไม่มีข้อมูลสำหรับกราฟในช่วงเวลานี้');
                }

                // สร้าง canvas สำหรับกราฟ
                const ctx = document.createElement('canvas');
                graphContainer.innerHTML = ''; // ล้าง "Loading..."
                graphContainer.appendChild(ctx);

                // คำนวณเวลา BUY และ SELL
                const buyTime = new Date(`${csvRow[3]} ${csvRow[4]}`).getTime() / 1000; // เวลาซื้อจาก CSV

                // แปลง "ใช้เวลารู้ผล" เป็นวินาที
                const durationStr = csvRow[10].replace(/"/g, ''); // เช่น "23 ชั่วโมง 06 นาที"
                const durationParts = durationStr.match(/(\d+)\s*ชั่วโมง\s*(\d+)\s*นาที/);
                const hours = durationParts ? parseInt(durationParts[1]) : 0;
                const minutes = durationParts ? parseInt(durationParts[2]) : 0;
                const durationSeconds = (hours * 3600) + (minutes * 60);
                const sellTime = buyTime + durationSeconds; // เวลาขาย

                // หาค่า candle ที่ใกล้ที่สุดสำหรับ BUY และ SELL
                let buyPrice = null, sellPrice = null;
                let buyLabel = null, sellLabel = null;
                let minBuyDiff = Infinity, minSellDiff = Infinity;

                for (let i = 0; i < data.candleTimes.length; i++) {
                    const candleTime = data.candleTimes[i];

                    // หาค่าใกล้เคียงสำหรับ BUY
                    const buyDiff = Math.abs(candleTime - buyTime);
                    if (buyDiff < minBuyDiff) {
                        minBuyDiff = buyDiff;
                        buyPrice = data.values[i];
                        buyLabel = data.labels[i]; // ใช้ label ที่ตรงกับ candle
                    }

                    // หาค่าใกล้เคียงสำหรับ SELL
                    const sellDiff = Math.abs(candleTime - sellTime);
                    if (sellDiff < minSellDiff) {
                        minSellDiff = sellDiff;
                        sellPrice = data.values[i];
                        sellLabel = data.labels[i];
                    }
                }

                console.log('Debug:', {
                    buyTime: new Date(buyTime * 1000).toISOString(),
                    sellTime: new Date(sellTime * 1000).toISOString(),
                    buyPrice,
                    sellPrice,
                    buyLabel,
                    sellLabel,
                    labels: data.labels,
                    candleTimes: data.candleTimes.map(t => new Date(t * 1000).toISOString())
                });

                // สร้าง annotations
                const annotations = [];
                if (buyPrice !== null && buyLabel) {
                    annotations.push({
                        type: 'point',
                        xValue: buyLabel,
                        yValue: buyPrice,
                        backgroundColor: 'green',
                        radius: 5,
                        label: { content: 'BUY', enabled: true, position: 'top' }
                    });
                } else {
                    console.warn('Could not plot BUY point: no matching candle found');
                }

                if (sellPrice !== null && sellLabel) {
                    annotations.push({
                        type: 'point',
                        xValue: sellLabel,
                        yValue: sellPrice,
                        backgroundColor: 'red',
                        radius: 5,
                        label: { content: 'SELL', enabled: true, position: 'top' }
                    });
                } else {
                    console.warn('Could not plot SELL point: no matching candle found');
                }

                const chart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: data.labels,
                        datasets: [{
                            label: `${coin}-USDT`,
                            data: data.values,
                            borderColor: 'hsl(0, 0.00%, 100.00%)',
                            borderWidth: 2,
                            fill: false
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: { ticks: { color: 'white' } },
                            y: { ticks: { color: 'white' } }
                        },
                        plugins: {
                            legend: { labels: { color: 'white' } },
                            annotation: { annotations }
                        }
                    }
                