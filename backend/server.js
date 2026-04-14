const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const { Connector } = require('@google-cloud/cloud-sql-connector');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

const PROJECT_ID       = process.env.PROJECT_ID        || 'agent-space-466318';
const BUCKET_NAME      = process.env.BUCKET_NAME       || 'agent-space-466318-procurement-docs';
const SQL_INSTANCE     = process.env.CLOUD_SQL_INSTANCE|| 'agent-space-466318:us-west1:procurement-db';
const DB_NAME          = process.env.DB_NAME           || 'procurement';
const DB_USER          = process.env.DB_USER           || 'procurement_admin';
const DB_PASSWORD      = process.env.DB_PASSWORD       || '';
const DOCAI_PROCESSOR  = process.env.DOCAI_PROCESSOR_ID|| '';
const DOCAI_LOCATION   = process.env.DOCAI_LOCATION    || 'us';

app.use(cors({ origin: '*' }));
app.use(express.json());

const storage = new Storage();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Lazy DB pool ──────────────────────────────────────────────────────────────
let _pool = null;
async function getPool() {
  if (_pool) return _pool;
  if (!DB_PASSWORD) throw new Error('DB_PASSWORD not configured');
  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: SQL_INSTANCE,
    ipType: 'PUBLIC',
  });
  _pool = new Pool({ ...clientOpts, user: DB_USER, password: DB_PASSWORD, database: DB_NAME, max: 5 });
  return _pool;
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const checks = {
    gcs: 'unchecked',
    db: 'unchecked',
    docai: DOCAI_PROCESSOR ? 'configured' : 'not_configured',
  };

  try {
    await storage.bucket(BUCKET_NAME).getMetadata();
    checks.gcs = 'connected';
  } catch {
    checks.gcs = 'error';
  }

  try {
    const pool = await getPool();
    await pool.query('SELECT 1');
    checks.db = 'connected';
  } catch {
    checks.db = DB_PASSWORD ? 'error' : 'not_configured';
  }

  const ok = checks.gcs === 'connected';
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

// ── Document upload ───────────────────────────────────────────────────────────
app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  const { docType = 'invoice' } = req.body;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file provided' });

  try {
    // 1. Upload to GCS
    const folders = { invoice: 'invoices', quote: 'quotes/backup-files', po: 'purchase-orders' };
    const gcsPath = `${folders[docType] || 'invoices'}/${Date.now()}-${file.originalname}`;
    await storage.bucket(BUCKET_NAME).file(gcsPath).save(file.buffer, { contentType: file.mimetype });
    const gcPath = `gs://${BUCKET_NAME}/${gcsPath}`;

    // 2. Document AI (optional — only runs if DOCAI_PROCESSOR_ID is set)
    let docaiProcessed = false;
    if (DOCAI_PROCESSOR) {
      try {
        const client = new DocumentProcessorServiceClient();
        const name = `projects/${PROJECT_ID}/locations/${DOCAI_LOCATION}/processors/${DOCAI_PROCESSOR}`;
        const [response] = await client.processDocument({
          name,
          rawDocument: { content: file.buffer.toString('base64'), mimeType: 'application/pdf' },
        });
        docaiProcessed = !!response.document;
        console.log(`Document AI processed: ${file.originalname}`);
      } catch (e) {
        console.error('Document AI error (non-fatal):', e.message);
      }
    }

    // 3. Write record to PostgreSQL (optional — skipped if DB not configured)
    let dbRecord = null;
    try {
      const pool = await getPool();
      if (docType === 'invoice') {
        const { rows } = await pool.query(
          `INSERT INTO procurement.invoices
             (invoice_number, invoice_date, subtotal, total_amount, source_filename, status)
           VALUES ($1, CURRENT_DATE, 0, 0, $2, 'PENDING')
           RETURNING invoice_id`,
          [file.originalname.replace(/\.pdf$/i, ''), file.originalname]
        );
        dbRecord = rows[0];
      } else if (docType === 'quote') {
        const { rows } = await pool.query(
          `INSERT INTO procurement.quotes
             (bid_number, bid_date, net_total, total_amount, source_filename, status)
           VALUES ($1, CURRENT_DATE, 0, 0, $2, 'PENDING')
           RETURNING quote_id`,
          [file.originalname.replace(/\.pdf$/i, ''), file.originalname]
        );
        dbRecord = rows[0];
      }
    } catch (e) {
      console.error('DB write error (non-fatal):', e.message);
    }

    res.json({
      gcPath,
      fileName: file.originalname,
      docType,
      bqSynced: true,
      documentAiProcessed: docaiProcessed,
      dbRecord,
    });
  } catch (err) {
    console.error('Upload failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Procurement API listening on :${PORT}`));
