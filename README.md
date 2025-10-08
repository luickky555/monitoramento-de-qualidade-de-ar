MonitorAQ — Sistema de Monitoramento de Qualidade do Ar

Campo Maior (PI) — Projeto de demonstração, ingestão IoT e previsão de poluição
Autor: Luís Eduardo Araújo Lima

Resumo: projeto full-stack que simula e recebe leituras de sensores de qualidade do ar (PM2.5, PM10, NO₂), armazena no Supabase, expõe visualização em tempo real (front-end) e aplica um modelo de previsão simples (regressão linear / opção para TensorFlow.js). Destinado a ambientes urbanos — aqui com dados de exemplo para Campo Maior (PI).

Índice

Objetivo científico / Tese

Contribuições

Arquitetura do sistema

Metodologia detalhada

Como rodar (rápido)

Supabase & Edge Function (ingestão segura)

Modelo de ML e avaliação

Boas práticas de segurança e produção

Futuro trabalho / melhorias

Referências selecionadas

Objetivo científico / Tese

Tese: Desenvolver e avaliar um sistema distribuído de baixo custo para monitoramento urbano da qualidade do ar que combine coleta IoT distribuída, armazenamento em nuvem com ingestão segura e modelos de aprendizado de máquina leves para previsão imediata (nowcasting/short-term forecasting), de forma a fornecer alertas e apoiar políticas locais de mitigação.

Hipóteses testáveis:

Leituras agregadas de sensores econômicos (PM2.5/PM10/NO₂) permitem estimativas de AQI com viés aceitável para aplicações municipais.

Modelos leves (regressão linear, ARIMA simplificado, modelos baseados em árvore ou LSTM compactos) conseguem previsão útil de curto prazo (1–6 horas) para alertas operacionais.

A arquitetura com Edge Function (backend serverless) melhora segurança e escalabilidade frente ao uso direto de chaves admin/service_role no cliente.

Métricas científicas propostas:

Erro médio absoluto (MAE) e RMSE entre leituras observadas e previstas (PM2.5).

Taxa de detecção de eventos críticos (AQI > 100) — sensibilidade / especificidade.

Latência de ingestão (tempo desde envio do dispositivo até persistência no DB).

Contribuições deste repositório

Front-end interativo (HTML/CSS/JS) com visualização em tempo real e simulação de sensores.

Integração com Supabase (DB Postgres + RLS + Realtime).

Edge Function (Deno) para ingestão segura de leitura IoT usando service_role no servidor (token do dispositivo validado).

supabase.sql com schema e dados de exemplo para Campo Maior (PI).

Documentação técnica e instruções de implantação.

Arquitetura do sistema
[Sensores IoT] --(HTTPS POST + x-device-token)--> [Edge Function (Deno) ingest-reading]
       │                                                 │
       └--(simulação dev: front-end)---------------------┘
                                                         ↓
                                                   [Supabase Postgres]
                                                         ↓
                                    [Realtime] → [Front-end: chart, tabelas, alertas]
                                                         ↓
                                               [ML local (regressão/TensorFlow.js)]


Componentes principais:

Sensores: dispositivos (microcontrollers / Raspberry Pi) enviando JSON.

Edge Function: valida token do dispositivo, insere leitura (usa service_role).

Supabase: tabelas sensors e readings com RLS; Realtime para push ao cliente.

Front-end: dashboard, agregação, previsão imediata.

Metodologia detalhada
Tabelas principais (resumo)

sensors — metadados: id, name, location, city, state, device_token, base_pm25, ...

readings — leituras: id, sensor_id, sensor_name, city, state, location, ts, pm25, pm10, no2

(Arquivo SQL de criação já incluído em supabase.sql.)

Fluxo de ingestão (seguro)

Dispositivo envia POST JSON → função ingest-reading.

ingest-reading valida x-device-token (ou campo no body) comparando com sensors.device_token.

Se válido, a função insere a leitura no Postgres usando a chave service_role (bypass RLS).

Supabase Realtime notifica clientes conectados (dashboard atualiza).

Pré-processamento & limpeza

Filtrar leituras inválidas (valores nulos, outliers evidentes).

Converter timestamps para UTC.

Aplicar janela móvel para suavização ao alimentar o modelo.

Modelo de ML (nesta demo)

Implementação inicial: regressão linear simples (usada para previsões de curto prazo no front-end).

Opção avançada: TensorFlow.js (LSTM/GRU leve ou rede densa sobre features temporais + meteorologia).

Features sugeridas: séries temporais deslocadas (lags), média móvel, hora do dia, meteorologia local (temp, vento, umidade), dados de tráfego.

Como rodar (rápido)

Clone este repositório:

git clone https://github.com/seu-usuario/monitoraq-campo-maior.git
cd monitoraq-campo-maior


Prepare o Supabase:

Crie projeto no Supabase.

No SQL Editor cole/execute supabase.sql (contido nesse repo).

No Project Settings → API, copie SUPABASE_URL e ANON KEY.

Configure index.html:

Substitua SUPABASE_URL e SUPABASE_ANON_KEY (anon) no trecho já preparado do index.html.

Ajuste window.USE_SUPABASE = true se quiser gravar leituras do front-end para a tabela readings (apenas para dev).

Provisionar Edge Function:

Instale Supabase CLI: npm i -g supabase (ou siga docs).

Crie function: supabase functions new ingest-reading.

Cole functions/ingest-reading/index.ts (fornecido neste repositório).

Configure secret:

supabase secrets set SUPABASE_SERVICE_ROLE_KEY="SUA_SERVICE_ROLE_KEY"
supabase secrets set SUPABASE_URL="https://SEU-PROJETO.supabase.co"


Deploy: supabase functions deploy ingest-reading.

Teste via curl:

curl -X POST "https://<seu-projeto>.functions.supabase.co/ingest-reading" \
  -H "Content-Type: application/json" \
  -d '{
    "sensor_id": 1,
    "device_token": "token-sensor-01-EXAMPLE",
    "pm25": 12.3,
    "pm10": 25.1,
    "no2": 11.0,
    "city": "Campo Maior",
    "state": "PI",
    "location": "Centro"
  }'


Abrir index.html no navegador (ou hospedar em um servidor estático). O dashboard tentará carregar sensores/leituras para Campo Maior (PI) automaticamente.

Supabase: SQL e policies (resumo)

supabase.sql cria tabelas, índices e insere sensores de exemplo para Campo Maior.

Dev: você pode permitir inserts públicos durante testes (policy allow_insert_readings_public).

Produção: remova policy pública e aceite inserts somente via Edge Function (service_role) ou por usuários autenticados.

Modelo de ML e avaliação (detalhes práticos)

Baseline: regressão linear sobre os últimos n pontos (implementada no front-end para demonstração).

Modelo avançado recomendado: LSTM/GRU ou modelos baseados em árvore (XGBoost / LightGBM) com janelas temporais + features meteorológicas.

Treinamento: usar dados históricos (OpenAQ, estações locais e leituras agregadas do Supabase).

Validação: cross-validation temporal (time series CV), métricas MAE/RMSE, ROC/AUC para detectar eventos (AQI>100).

Deploy de modelo JS: converter modelo treinado para TF.js ou treinar diretamente em TF.js se for on-device.

Boas práticas de segurança e produção

Nunca exponha service_role no cliente.

Use device tokens exclusivos por sensor (armazenados em sensors.device_token).

Faça rate limiting, monitoramento e logs na Edge Function.

Habilite RLS e políticas que permitam inserção apenas por funções autorizadas ou usuários autenticados.

Utilize HTTPS e verifique assinaturas HMAC se precisar de mais segurança.

Futuro trabalho / melhorias

Integrar fontes meteorológicas (API) para melhorar previsão.

Adotar modelos mais robustos (ensemble; DL) e pipeline de retrain automático.

Painel de alertas por SMS/Telegram quando AQI ultrapassar thresholds.

Implementar autenticação de dispositivos com chave pública (JWT) e rotação de tokens.

Suporte a sensores múltiplos e calibração automática por comparação com estações de referência.

Referências selecionadas

WHO — Air quality guidelines (AQG) 2021. Organização Mundial da Saúde.
https://www.who.int/publications/i/item/9789240034228

U.S. EPA — Air Quality Index (AQI) Basics.
https://www.airnow.gov/aqi/aqi-basics/

Supabase — documentação: Functions, Realtime, Auth & Policies.
https://supabase.com/docs

TensorFlow.js — deploy de modelos em browser.
https://www.tensorflow.org/js

OpenAQ — repositórios públicos de qualidade do ar (dados históricos).
https://openaq.org

Sensores típicos de baixo custo:

Plantower PMS5003 (PM2.5/PM10) — https://www.plantower.com

Nova SDS011 — https://www.winsen-sensor.com

Artigos de revisão (exemplos de leitura para ML aplicado a AQ):

revisão sobre previsões de qualidade do ar usando aprendizagem de máquina — procurar trabalhos de revisão em bases como IEEE / ScienceDirect para leituras aprofundadas.
