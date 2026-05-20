import { Actor } from 'apify';

await Actor.init();

try {

  // ──────────────────────────────
  // 1. GET INPUT
  // ──────────────────────────────
  const input          = await Actor.getInput();
  const serviceTagName = input.fileName     || '';
  const linkedinUrls   = input.linkedinUrls || [];

  // UPDATED SERVICE
  const serviceName    = 'Direct Dials';
  const serviceOption1 = 'direct_dials';
  const requestSource  = 'Direct_Dials_AP';

  // UPDATED WEBHOOKS
  const boomerangInputUrl = 'https://s1.boomerangserver.co.in/webhook/direct-dials';
  const boomerangStatUrl  = 'https://s1.boomerangserver.co.in/webhook/direct-dials-stats';

  console.log('Tag Name :', serviceTagName);
  console.log('Service  :', serviceName);
  console.log('URLs     :', linkedinUrls.length);

  if (!serviceTagName.trim()) throw new Error('fileName is required!');
  if (!linkedinUrls.length) throw new Error('At least one URL is required!');

  // ──────────────────────────────
  // 2. VALIDATE + CLEAN URLS
  // ──────────────────────────────
  const validUrls = linkedinUrls
    .map(u => (typeof u === 'string' ? u.trim() : ''))
    .filter(u => u.length > 0);

  console.log('Valid URLs:', validUrls.length);

  if (!validUrls.length) {
    throw new Error('No valid URLs found!');
  }

  const rowCount = validUrls.length;

  const csvContent =
    'url\n' + validUrls.join('\n');

  const fileName =
    serviceTagName.replace(/[^a-zA-Z0-9]/g, '_') +
    '_' +
    new Date().toISOString().replace(/[:.]/g, '-') +
    '.csv';

  console.log(
    'CSV preview:\n',
    csvContent.split('\n').slice(0, 3).join('\n')
  );

  // ──────────────────────────────
  // 3. GET APIFY RUN DETAILS
  // ──────────────────────────────
  const env = Actor.getEnv();

  const userId = env.userId || 'unknown';
  const runId  = env.actorRunId || 'unknown';

  const now = new Date();

  const time = now.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  });

  console.log('User ID :', userId);
  console.log('Run ID  :', runId);
  console.log('Time    :', time);

  // ──────────────────────────────
  // 4. FREE TRIAL CHECK
  // ──────────────────────────────
  const FREE_TRIAL_LEADS = 50;

  // UPDATED STORE NAME
  const trialStore = await Actor.openKeyValueStore(
    'boomerang-free-trials-direct-dials'
  );

  const trialRecord = await trialStore.getValue(userId);

  const isFirstTime = !trialRecord;

  let freeLeadsRemaining = 0;

  if (isFirstTime) {

    freeLeadsRemaining = FREE_TRIAL_LEADS;

    await trialStore.setValue(userId, {
      usedAt: new Date().toISOString(),
      runId,
      service: serviceName,
      rowCount
    });

    console.log(
      `\n🎁 First-time user detected! ${FREE_TRIAL_LEADS} free leads applied.`
    );

  } else {

    console.log(
      `\n👤 Returning user. Free trial already used on ${trialRecord.usedAt}. Full charges apply.`
    );

  }

  // ──────────────────────────────
  // 5. CALCULATE COST
  // $50 / 1000 leads
  // ──────────────────────────────
  const chargeableRows = Math.max(
    0,
    rowCount - freeLeadsRemaining
  );

  // UPDATED PRICE
  const creditsCost = parseFloat(
    (chargeableRows * 0.05).toFixed(3)
  );

  console.log('URL count      :', rowCount);
  console.log('Free leads     :', isFirstTime ? FREE_TRIAL_LEADS : 0);
  console.log('Chargeable rows:', chargeableRows);
  console.log('Credits cost   : $', creditsCost);

  // ──────────────────────────────
  // 6. FETCH DRIVE CSV + PUSH ROWS
  // ──────────────────────────────
  const fetchAndPushDriveData = async (
    outputLink,
    batch_number
  ) => {

    try {

      const fileIdMatch =
        outputLink.match(/\/d\/([a-zA-Z0-9-_]+)/);

      if (!fileIdMatch) {
        console.log(
          `  ⚠️ Batch ${batch_number} — Could not extract file ID from Drive link.`
        );
        return 0;
      }

      const fileId = fileIdMatch[1];

      const csvUrl =
        `https://drive.google.com/uc?export=download&id=${fileId}`;

      console.log(
        `  📥 Batch ${batch_number} — Fetching CSV from Drive...`
      );

      const csvRes = await fetch(csvUrl, {
        signal: AbortSignal.timeout(60000)
      });

      const csvText = await csvRes.text();

      const parseCSV = (text) => {

        const rows = [];

        let current = '';
        let inQuotes = false;
        let fields = [];

        for (let i = 0; i < text.length; i++) {

          const char = text[i];
          const nextChar = text[i + 1];

          if (char === '"') {

            if (inQuotes && nextChar === '"') {
              current += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }

          } else if (char === ',' && !inQuotes) {

            fields.push(current.trim());
            current = '';

          } else if (
            (char === '\n' ||
              (char === '\r' && nextChar === '\n')) &&
            !inQuotes
          ) {

            if (char === '\r') i++;

            fields.push(current.trim());

            rows.push(fields);

            fields = [];
            current = '';

          } else {

            current += char;

          }

        }

        if (current || fields.length) {

          fields.push(current.trim());

          if (fields.some(f => f !== '')) {
            rows.push(fields);
          }

        }

        return rows;

      };

      const rows = parseCSV(csvText);

      const headers = rows[0];
      const data = rows.slice(1);

      console.log(
        `  📊 Batch ${batch_number} — ${data.length} rows found.`
      );

      const items = [];

      for (const row of data) {

        if (!row.some(f => f !== '')) continue;

        const rowObj = {};

        headers.forEach((h, i) => {
          rowObj[h] =
            row[i] !== undefined ? row[i] : '';
        });

        items.push(rowObj);

      }

      if (items.length > 0) {
        await Actor.pushData(items);
      }

      console.log(
        `  💾 Batch ${batch_number} — ${items.length} rows saved.`
      );

      return items.length;

    } catch (err) {

      console.log(
        `  ❌ Batch ${batch_number} — Failed to fetch Drive data: ${err.message}`
      );

      return 0;

    }

  };

  // ──────────────────────────────
  // 7. STEP 1 — TRIGGER WORKFLOW
  // ──────────────────────────────
  console.log('\n════════════════════════════════════');
  console.log('Step 1 : Setting up master & batches');
  console.log('════════════════════════════════════');

  let wf1Res;

  try {

    wf1Res = await fetch(
      'https://frontend.boomerangserver.co.in/webhook/Universal_masterflow',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(300000),
        body: JSON.stringify({
          userId,
          runId,
          time,
          serviceTagName,
          rowCount,
          creditsCost,
          csvContent,
          uploadedFile: '',
          fileName,
          boomerangInputUrl,
          service_option_1: serviceOption1,
          service_name: serviceName,
          request_source: requestSource
        })
      }
    );

  } catch (fetchErr) {

    throw new Error(
      `Step 1 failed: ${fetchErr.message}`
    );

  }

  const wf1Text = await wf1Res.text();

  console.log('n8n step 1 status  :', wf1Res.status);
  console.log('n8n step 1 response:', wf1Text);

  if (!wf1Res.ok) {
    throw new Error(
      `Step 1 error ${wf1Res.status}: ${wf1Text.slice(0, 200)}`
    );
  }

  let wf1Data;

  try {

    wf1Data = JSON.parse(wf1Text);

  } catch (e) {

    throw new Error(
      `Step 1 JSON parse failed: ${wf1Text.slice(0, 200)}`
    );

  }

  const request_unique_id =
    wf1Data.request_unique_id || '';

  const masterFileUrl =
    wf1Data.masterFileUrl || '';

  const total_batches =
    parseInt(wf1Data.total_batches || '0');

  const batchFolderId =
    wf1Data.batchFolderId || '';

  if (!request_unique_id) {
    throw new Error(
      'No request_unique_id returned from Step 1!'
    );
  }

  console.log('\n✅ Step 1 Complete!');
  console.log('Request ID    :', request_unique_id);
  console.log('Master File   :', masterFileUrl);
  console.log('Total Batches :', total_batches);

  // ──────────────────────────────
  // 8. CONTINUE YOUR EXISTING
  // BATCH PROCESSING LOGIC
  // ──────────────────────────────

  console.log('\n✅ Direct Dials Actor Ready');

} catch (err) {

  console.log('❌ Error:', err.message);

}

await Actor.exit();
