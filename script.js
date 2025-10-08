/* script.js
   MonitorAQ + Supabase integration
   - simula sensores localmente
   - carrega sensores/leituras do Supabase (filtrando por cidade+estado)
   - grava leituras no Supabase (quando window.USE_SUPABASE === true)
*/

(() => {
  // CONFIG
  const STREAM_INTERVAL_MS = 3000;
  const MAX_POINTS = 60;
  const INITIAL_SENSORS = 2;

  // STATE
  let sensors = [];
  let readings = []; // latest first
  let streamOn = true;
  let streamTimer = null;

  // DOM
  const lastUpdateEl = document.getElementById('lastUpdate');
  const statusIndicator = document.getElementById('statusIndicator');
  const toggleStreamBtn = document.getElementById('toggleStreamBtn');
  const readingsTableBody = document.querySelector('#readingsTable tbody');
  const sensorListEl = document.getElementById('sensorList');
  const avgAQIEl = document.getElementById('avgAQI');
  const aqCategoryEl = document.getElementById('aqCategory');
  const predPM25El = document.getElementById('predPM25');
  const predAQIEl = document.getElementById('predAQI');
  const trainCountEl = document.getElementById('trainCount');

  // Chart
  const ctx = document.getElementById('aqChart').getContext('2d');
  const chartData = {
    labels: [],
    datasets: [
      { label: 'PM2.5 (µg/m³)', data: [], tension: 0.25, pointRadius: 2, borderWidth: 2 },
      { label: 'PM10 (µg/m³)', data: [], tension: 0.25, pointRadius: 2, borderWidth: 1.5 },
      { label: 'NO₂ (ppb)', data: [], tension: 0.25, pointRadius: 2, borderWidth: 1.5 },
    ]
  };
  const aqChart = new Chart(ctx, {
    type: 'line',
    data: chartData,
    options: {
      animation: { duration: 400 },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top' }, tooltip: { enabled: true } },
      scales: { x: { display: true }, y: { display: true, beginAtZero: true } }
    }
  });

  // Utilities
  function nowLabel() {
    const d = new Date();
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // AQI helpers (PM2.5)
  const PM25_BREAKPOINTS = [
    {aqiLow: 0, aqiHigh: 50, concLow: 0.0, concHigh: 12.0},
    {aqiLow: 51, aqiHigh: 100, concLow: 12.1, concHigh: 35.4},
    {aqiLow: 101, aqiHigh: 150, concLow: 35.5, concHigh: 55.4},
    {aqiLow: 151, aqiHigh: 200, concLow: 55.5, concHigh: 150.4},
    {aqiLow: 201, aqiHigh: 300, concLow: 150.5, concHigh: 250.4},
    {aqiLow: 301, aqiHigh: 400, concLow: 250.5, concHigh: 350.4},
    {aqiLow: 401, aqiHigh: 500, concLow: 350.5, concHigh: 500.4},
  ];

  function pm25ToAQI(pm25) {
    if (pm25 === null || pm25 === undefined || isNaN(pm25)) return null;
    for (const b of PM25_BREAKPOINTS) {
      if (pm25 >= b.concLow && pm25 <= b.concHigh) {
        const aqi = ((b.aqiHigh - b.aqiLow) / (b.concHigh - b.concLow)) * (pm25 - b.concLow) + b.aqiLow;
        return Math.round(aqi);
      }
    }
    return 500;
  }
  function aqiCategory(aqi) {
    if (aqi <= 50) return {text: 'Bom', cls: 'badge-aqi-good'};
    if (aqi <= 100) return {text: 'Moderado', cls: 'badge-aqi-moderate'};
    if (aqi <= 150) return {text: 'Não saudável (sensíveis)', cls: 'badge-aqi-unhealthy'};
    if (aqi <= 200) return {text: 'Não saudável', cls: 'badge-aqi-veryunhealthy'};
    if (aqi <= 300) return {text: 'Muito não saudável', cls: 'badge-aqi-veryunhealthy'};
    return {text: 'Perigoso', cls: 'badge-aqi-veryunhealthy'};
  }

  // Simple linear regression for prediction
  function linearRegressionPredict(values) {
    if (!values || values.length < 2) return null;
    const n = values.length;
    let sumX=0, sumY=0, sumXY=0, sumX2=0;
    for (let i=0;i<n;i++){
      const x = i;
      const y = values[i];
      sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x;
    }
    const denom = (n*sumX2 - sumX*sumX);
    if (denom === 0) return null;
    const slope = (n*sumXY - sumX*sumY) / denom;
    const intercept = (sumY - slope*sumX) / n;
    const nextX = n;
    return slope * nextX + intercept;
  }

  // --- Supabase integration functions ---
  // Note: window.supabase and window.DEFAULT_CITY/STATE configured in index.html

  async function fetchSensorsFromSupabase(city=null, state=null) {
    try {
      let qb = window.supabase.from('sensors').select('*').order('id', {ascending: true});
      if (city) qb = window.supabase.from('sensors').select('*').eq('city', city).order('id', {ascending: true});
      if (city && state) {
        qb = window.supabase.from('sensors').select('*').eq('city', city).eq('state', state).order('id', {ascending: true});
      }
      const { data, error } = await qb;
      if (error) { console.error('Erro ao buscar sensores:', error); return []; }
      return data || [];
    } catch (err) {
      console.error(err);
      return [];
    }
  }

  async function fetchLatestReadingsByCityState(city, state, limit=120) {
    try {
      const { data, error } = await window.supabase
        .from('readings')
        .select('*')
        .eq('city', city)
        .eq('state', state)
        .order('ts', {ascending:false})
        .limit(limit);
      if (error) { console.error('Erro ao buscar leituras:', error); return []; }
      return data || [];
    } catch (err) { console.error(err); return []; }
  }

  async function insertReadingToSupabase(reading) {
    if (!window.USE_SUPABASE) return null;
    try {
      const payload = {
        sensor_id: reading.sensorId ?? reading.sensor_id,
        sensor_name: reading.sensorName ?? reading.sensor_name,
        city: reading.city ?? reading.locCity ?? window.DEFAULT_CITY,
        state: reading.state ?? window.DEFAULT_STATE,
        location: reading.loc ?? reading.location,
        ts: reading.ts ? reading.ts.toISOString() : new Date().toISOString(),
        pm25: reading.pm25,
        pm10: reading.pm10,
        no2: reading.no2
      };
      const { data, error } = await window.supabase.from('readings').insert([payload]);
      if (error) { console.error('Erro ao inserir leitura no Supabase:', error); return null; }
      return data;
    } catch (err) { console.error(err); return null; }
  }

  function subscribeToReadingsRealtime(onNewReading) {
    try {
      const channel = window.supabase.channel('public:readings')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'readings' }, payload => {
          onNewReading(payload.record);
        })
        .subscribe();
      return channel;
    } catch (err) {
      console.warn('Realtime pode não estar disponível:', err);
      return null;
    }
  }

  // --- Simulation functions ---
  function createSensor(id, opts={}) {
    return {
      id,
      name: opts.name || `SENSOR-${String(id).padStart(2,'0')}`,
      location: opts.location || ['Centro','Bairro','Zona Rural','Parque'][Math.floor(Math.random()*4)],
      city: opts.city || window.DEFAULT_CITY,
      state: opts.state || window.DEFAULT_STATE,
      basePm25: opts.basePm25 || (8 + Math.random()*20),
      basePm10: opts.basePm10 || (15 + Math.random()*30),
      baseNo2: opts.baseNo2 || (8 + Math.random()*15),
      online: true
    };
  }

  function genReadingForSensor(sensor) {
    sensor.basePm25 = Math.max(0, sensor.basePm25 + (Math.random()-0.45) * 4);
    sensor.basePm10 = Math.max(0, sensor.basePm10 + (Math.random()-0.45) * 6);
    sensor.baseNo2 = Math.max(0, sensor.baseNo2 + (Math.random()-0.45) * 2.5);
    return {
      ts: new Date(),
      sensorId: sensor.id,
      sensorName: sensor.name,
      loc: sensor.location,
      city: sensor.city,
      state: sensor.state,
      pm25: +((sensor.basePm25 + Math.random()*1.5).toFixed(1)),
      pm10: +((sensor.basePm10 + Math.random()*2.5).toFixed(1)),
      no2:  +((sensor.baseNo2 + Math.random()*1.0).toFixed(1))
    };
  }

  function pushReading(r) {
    readings.unshift(r);
    if (readings.length > 500) readings.pop();
    updateChartFromReadings();
    updateTable();
    updateCards();
    lastUpdateEl.textContent = `Última atualização: ${nowLabel()}`;

    // tentativa de gravar no Supabase (não bloqueante)
    insertReadingToSupabase(r).catch(e => console.error(e));
  }

  // UI updates
  function updateTable() {
    readingsTableBody.innerHTML = '';
    const N = Math.min(20, readings.length);
    for (let i=0;i<N;i++){
      const r = readings[i];
      const aqi = pm25ToAQI(r.pm25);
      const cat = aqiCategory(aqi);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${new Date(r.ts).toLocaleString('pt-BR')}</td>
        <td>${r.sensorName}</td>
        <td>${r.loc}</td>
        <td>${r.pm25.toFixed(1)}</td>
        <td>${r.pm10.toFixed(1)}</td>
        <td>${r.no2.toFixed(1)}</td>
        <td><span class="badge ${cat.cls}">${aqi}</span></td>
      `;
      readingsTableBody.appendChild(tr);
    }
  }

  function latestPM25BySensor(sensorId, limit=10) {
    return readings.filter(r => r.sensorId === sensorId).slice(0, limit).map(r => r.pm25);
  }

  function updateSensorList() {
    sensorListEl.innerHTML = '';
    sensors.forEach(s => {
      const samples = latestPM25BySensor(s.id, 8);
      const last = samples.length ? samples[0] : null;
      const aqi = last ? pm25ToAQI(last) : '—';
      const cat = typeof aqi === 'number' ? aqiCategory(aqi) : {text:'—', cls:''};
      const li = document.createElement('li');
      li.className = 'list-group-item';
      li.innerHTML = `
        <div><strong>${s.name}</strong><br><small class="text-muted">${s.location}</small></div>
        <div class="text-end">
          <span class="badge ${cat.cls}">${typeof aqi === 'number' ? aqi : '—'}</span>
          <div class="mt-1"><small class="text-muted">id:${s.id}</small></div>
        </div>
      `;
      sensorListEl.appendChild(li);
    });
  }

  function updateCards() {
    const latestPerSensor = sensors.map(s => {
      const arr = latestPM25BySensor(s.id,1);
      return arr.length ? arr[0] : null;
    }).filter(v => v !== null);
    const avgPM25 = latestPerSensor.length ? (latestPerSensor.reduce((a,b)=>a+b,0)/latestPerSensor.length) : null;
    const avgAQI = avgPM25 !== null ? pm25ToAQI(avgPM25) : null;
    avgAQIEl.textContent = avgAQI !== null ? avgAQI : '—';
    if (avgAQI !== null) {
      const cat = aqiCategory(avgAQI);
      aqCategoryEl.innerHTML = `<span class="badge ${cat.cls}">${cat.text}</span>`;
    } else aqCategoryEl.textContent = '—';

    const pm25Serie = aqChart.data.datasets[0].data.map(d => (typeof d === 'number' ? d : d?.y ?? null)).filter(v=>v!==null);
    const pred = linearRegressionPredict(pm25Serie.slice(-20));
    predPM25El.textContent = pred !== null ? `${pred.toFixed(1)} µg/m³` : '—';
    const predAQIVal = pred !== null ? pm25ToAQI(pred) : null;
    predAQIEl.textContent = predAQIVal !== null ? `AQI: ${predAQIVal}` : 'AQI: —';
    trainCountEl.textContent = pm25Serie.length;
    updateSensorList();
  }

  function updateChartFromReadings() {
    if (sensors.length === 0) return;
    const now = new Date();
    const label = now.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const latestVals = sensors.map(s => readings.find(rr => rr.sensorId === s.id)).filter(v=>v);
    const meanPm25 = latestVals.length ? +(latestVals.reduce((a,b)=>a+b.pm25,0)/latestVals.length).toFixed(2) : null;
    const meanPm10 = latestVals.length ? +(latestVals.reduce((a,b)=>a+b.pm10,0)/latestVals.length).toFixed(2) : null;
    const meanNo2  = latestVals.length ? +(latestVals.reduce((a,b)=>a+b.no2,0)/latestVals.length).toFixed(2) : null;

    if (chartData.labels.length >= MAX_POINTS) {
      chartData.labels.shift();
      chartData.datasets.forEach(ds => ds.data.shift());
    }
    chartData.labels.push(label);
    chartData.datasets[0].data.push(meanPm25);
    chartData.datasets[1].data.push(meanPm10);
    chartData.datasets[2].data.push(meanNo2);
    aqChart.update('none');
  }

  // Stream control
  function startStream() {
    if (streamTimer) return;
    streamOn = true;
    statusIndicator.textContent = 'Streaming ativo';
    statusIndicator.className = 'badge align-self-center bg-success';
    toggleStreamBtn.textContent = 'Parar stream';
    streamTimer = setInterval(() => {
      sensors.forEach(s => pushReading(genReadingForSensor(s)));
    }, STREAM_INTERVAL_MS);
  }
  function stopStream() {
    if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
    streamOn = false;
    statusIndicator.textContent = 'Stream parado';
    statusIndicator.className = 'badge align-self-center bg-secondary';
    toggleStreamBtn.textContent = 'Iniciar stream';
  }

  // Buttons
  toggleStreamBtn.addEventListener('click', () => {
    if (streamOn) stopStream(); else startStream();
  });

  document.getElementById('btnAddSensor').addEventListener('click', () => {
    const newId = sensors.length ? Math.max(...sensors.map(s=>s.id)) + 1 : 1;
    const s = createSensor(newId);
    sensors.push(s);
    for (let i=0;i<3;i++) pushReading(genReadingForSensor(s));
    updateSensorList();
  });

  document.getElementById('btnClear').addEventListener('click', () => {
    readings = []; chartData.labels = []; chartData.datasets.forEach(ds=>ds.data=[]);
    aqChart.update(); updateTable(); updateCards();
  });

  // Init with Supabase: carrega sensores da cidade e histórico
  async function initWithSupabase(city=window.DEFAULT_CITY, state=window.DEFAULT_STATE) {
    try {
      statusIndicator.textContent = 'Conectando ao Supabase...';
      statusIndicator.className = 'badge align-self-center bg-info';
      // carrega sensores do Supabase
      const supaSensors = await fetchSensorsFromSupabase(city, state);
      if (supaSensors.length > 0) {
        sensors = supaSensors.map(s => createSensor(s.id, {
          name: s.name,
          location: s.location,
          city: s.city,
          state: s.state,
          basePm25: parseFloat(s.base_pm25) || (8 + Math.random()*10),
          basePm10: parseFloat(s.base_pm10) || (15 + Math.random()*20),
          baseNo2: parseFloat(s.base_no2) || (8 + Math.random()*8)
        }));
      } else {
        // fallback: cria sensores locais (se não houver sensores no supabase)
        for (let i=1;i<=INITIAL_SENSORS;i++) sensors.push(createSensor(i, {city, state}));
      }

      // carregar histórico de leituras da cidade
      const historico = await fetchLatestReadingsByCityState(city, state, 120);
      // preenche chart com histórico (ordenar asc)
      historico.reverse().forEach(r => {
        chartData.labels.push(new Date(r.ts).toLocaleTimeString());
        chartData.datasets[0].data.push(parseFloat(r.pm25));
        chartData.datasets[1].data.push(parseFloat(r.pm10));
        chartData.datasets[2].data.push(parseFloat(r.no2));
        // adicionar à memória local (optional)
        readings.unshift({
          ts: new Date(r.ts),
          sensorId: r.sensor_id,
          sensorName: r.sensor_name,
          loc: r.location,
          city: r.city,
          state: r.state,
          pm25: parseFloat(r.pm25),
          pm10: parseFloat(r.pm10),
          no2: parseFloat(r.no2)
        });
      });

      aqChart.update();
      updateTable();
      updateSensorList();
      updateCards();

      // realtime
      subscribeToReadingsRealtime(rec => {
        const r = {
          ts: new Date(rec.ts),
          sensorId: rec.sensor_id,
          sensorName: rec.sensor_name,
          loc: rec.location,
          city: rec.city,
          state: rec.state,
          pm25: parseFloat(rec.pm25),
          pm10: parseFloat(rec.pm10),
          no2: parseFloat(rec.no2)
        };
        pushReading(r);
      });

      // start local stream (simulação) — se preferir só receber do Supabase, comente a linha abaixo
      startStream();

      statusIndicator.textContent = 'Conectado ao Supabase';
      statusIndicator.className = 'badge align-self-center bg-success';
    } catch (err) {
      console.error(err);
      statusIndicator.textContent = 'Erro de conexão (offline)';
      statusIndicator.className = 'badge align-self-center bg-danger';
      // fallback: inicializa sensores locais
      if (sensors.length === 0) for (let i=1;i<=INITIAL_SENSORS;i++) sensors.push(createSensor(i));
      startStream();
    }
  }

  // Inicialização
  (function init(){
    // Inicia com os valores padrão configurados no index.html
    initWithSupabase(window.DEFAULT_CITY, window.DEFAULT_STATE);
  })();

})();
