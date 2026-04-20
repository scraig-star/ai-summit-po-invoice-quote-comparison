const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const { Connector } = require('@google-cloud/cloud-sql-connector');
const { Pool } = require('pg');
const XLSX = require('xlsx');
const { PDFDocument } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 8080;

const PROJECT_ID      = process.env.PROJECT_ID         || 'agent-space-466318';
const BUCKET_NAME     = process.env.BUCKET_NAME        || 'agent-space-466318-procurement-docs';
const SQL_INSTANCE    = process.env.CLOUD_SQL_INSTANCE || 'agent-space-466318:us-west1:procurement-db';
const DB_NAME         = process.env.DB_NAME            || 'procurement';
const DB_USER         = process.env.DB_USER            || 'procurement_admin';
const DB_PASSWORD     = process.env.DB_PASSWORD        || '';
const DOCAI_PROCESSOR       = process.env.DOCAI_PROCESSOR_ID       || '';
const DOCAI_QUOTE_PROCESSOR = process.env.DOCAI_QUOTE_PROCESSOR_ID || '98991256bdff5118';
const DOCAI_LOCATION        = process.env.DOCAI_LOCATION            || 'us';

// ── PO Analysis: Medius + JDE config ─────────────────────────────────────────
const MEDIUS_BASE_URL      = (process.env.MEDIUS_BASE_URL || '').replace(/\/$/, '');
const MEDIUS_CLIENT_ID     = process.env.MEDIUS_CLIENT_ID || '';
const MEDIUS_CLIENT_SECRET = process.env.MEDIUS_CLIENT_SECRET || '';
const MEDIUS_MOCK          = process.env.MEDIUS_MOCK === '1' || !MEDIUS_BASE_URL || !MEDIUS_CLIENT_ID;

const JDE_BASE_URL  = (process.env.JDE_ORCHESTRATOR_URL || '').replace(/\/$/, '');
const JDE_USER      = process.env.JDE_USER || '';
const JDE_PASSWORD  = process.env.JDE_PASSWORD || '';
const JDE_MOCK      = process.env.JDE_MOCK === '1' || !JDE_BASE_URL;

// JDE status-to-bucket mapping (per user spec)
const JDE_APPROVED_STATUSES = new Set(['440', '415', '999']);
const JDE_PENDING_STATUSES  = new Set(['280', '285', '230']);

// Medius workflow stages that count as "Pending Invoices" per user spec.
// Path segments below the `/integration/message/v1/supplierinvoice/invoices/` base
// follow the tag vocabulary seen in 55_MD_INSERT_INVOICE_DATA.xml. Confirm in Postman
// against accoQA tenant before go-live.
const MEDIUS_PENDING_STAGES = [
  'PreliminaryAfterConnection',   // Connect
  'PreliminaryAfterCoding',       // Analyze
  'PreliminaryAfterApproval',     // Approve Invoice Amount
  'PreliminaryAfterPostControl',  // Post Control
];

app.use(cors({ origin: '*' }));
app.use(express.json());

const storage = new Storage();
const upload  = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

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

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseAmount(text) {
  if (!text) return 0;
  return parseFloat(String(text).replace(/[$,\s]/g, '')) || 0;
}

function findCol(keys, candidates) {
  for (const candidate of candidates) {
    const match = keys.find(k => k.toLowerCase().trim().includes(candidate.toLowerCase()));
    if (match) return match;
  }
  return null;
}

// ── Parse PO# and Job# from filename ─────────────────────────────────────────
function extractFilenameMetadata(fileName) {
  // "Open PO 230751 Job 60140018 (2).pdf"
  // "OJ-230751" style PO numbers
  const poMatch  = fileName.match(/\bPO\s*#?\s*([A-Z0-9-]+)/i);
  const jobMatch = fileName.match(/\bJob\s*#?\s*(\d+)/i);
  return {
    poNumber:  poMatch  ? poMatch[1].replace(/^OJ-/i, '')  : null,
    jobNumber: jobMatch ? jobMatch[1] : null,
  };
}

// ── Extract vendor name from filename as fallback ─────────────────────────────
// Handles patterns like:
//   "60140018-Ferguson Enterprises Inc #794-230751-019.pdf"
//   "Ferguson_Quote_B940987.pdf"
function extractVendorFromFilename(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  // Pattern: {digits}-{Vendor Name} #... or {digits}-{Vendor Name}-{quote#}
  const m1 = base.match(/^\d[\d\s]*[-–]\s*(.+?)\s*(?:#[\d-]|\bquote\b|\bbid\b)/i);
  if (m1 && m1[1].trim().length > 1) return m1[1].trim();
  // Pattern: {Vendor Name} #quote or {Vendor Name} Quote ...
  const m2 = base.match(/^(.+?)\s*(?:#[A-Z]?\d|\bquote\b|\bbid\b)/i);
  if (m2 && m2[1].trim().length > 1) return m2[1].trim();
  return null;
}

// ── Document AI parser ────────────────────────────────────────────────────────
function parseDocAiResponse(document) {
  const result = { header: {}, lineItems: [] };
  const entities = document.entities || [];

  for (const entity of entities) {
    const text = entity.mentionText?.trim() || '';
    switch (entity.type) {
      case 'invoice_id':
        result.header.docNumber = text; break;
      case 'purchase_order':
        result.header.poNumber  = text.replace(/^OJ-/i, ''); break;
      case 'invoice_date':
        result.header.docDate = text; break;
      case 'vendor_name':
      case 'supplier_name':
        result.header.vendorName = text; break;
      case 'net_amount':
      case 'subtotal':
        result.header.subtotal = parseAmount(text); break;
      case 'total_amount':
        result.header.totalAmount = parseAmount(text); break;
      case 'tax_amount':
        result.header.taxAmount = parseAmount(text); break;
      case 'line_item': {
        const item = {};
        for (const prop of entity.properties || []) {
          const v = prop.mentionText?.trim() || '';
          switch (prop.type) {
            case 'line_item/item_number':
            case 'line_item/product_code':
              item.itemNumber = v; break;
            case 'line_item/description':
              item.description = v; break;
            case 'line_item/quantity':
              item.quantity = parseFloat(v.replace(/[,$]/g, '')) || 1; break;
            case 'line_item/unit_price':
            case 'line_item/net_unit_price':
              item.unitPrice = parseAmount(v); break;
            case 'line_item/amount':
            case 'line_item/line_total':
              item.lineAmount = parseAmount(v); break;
            case 'line_item/unit':
            case 'line_item/unit_of_measure':
              item.uom = v; break;
          }
        }
        if (item.itemNumber || item.description) result.lineItems.push(item);
        break;
      }
    }
  }
  return result;
}

// ── Form Parser (table-based) for quotes ─────────────────────────────────────
function getLayoutText(layout, fullText) {
  return (layout?.textAnchor?.textSegments || [])
    .map(s => fullText.slice(parseInt(s.startIndex || 0), parseInt(s.endIndex)))
    .join('').trim();
}

function parseFormParserResponse(document) {
  const result = { header: {}, lineItems: [] };
  const fullText = document.text || '';

  for (const page of document.pages || []) {
    for (const table of page.tables || []) {
      // Read header row to identify columns
      const headers = (table.headerRows?.[0]?.cells || [])
        .map(c => getLayoutText(c.layout, fullText).toLowerCase());

      const idx = {
        item:        headers.findIndex(h => h.includes('item')),
        description: headers.findIndex(h => h.includes('desc')),
        quantity:    headers.findIndex(h => /qty|quant/.test(h)),
        price:       headers.findIndex(h => /net\s*price|unit\s*price|price/.test(h) && !/unit\s*of/.test(h)),
        // Widen UoM detection: "u/m", "um", "uom", "unit" (but not "unit price"), "lm", "measure"
        uom:         headers.findIndex(h => /^u\/?m$|^uom$|^lm$|unit\s*of\s*meas|^unit$/.test(h)),
        total:       headers.findIndex(h => h.includes('total')),
      };

      for (const row of table.bodyRows || []) {
        const cells = (row.cells || []).map(c => getLayoutText(c.layout, fullText));
        const itemNumber  = idx.item        >= 0 ? cells[idx.item]                        : '';
        const description = idx.description >= 0 ? cells[idx.description]                 : '';
        if (!itemNumber && !description) continue;

        // Sanitise UoM: must be short alphabetic code (EA, LF, C, etc.)
        // If the cell contains digits or is too long it's a mis-parsed column.
        const rawUom = idx.uom >= 0 ? (cells[idx.uom] || '').trim() : '';
        const uom = rawUom && /^[A-Za-z\/.]{1,10}$/.test(rawUom) ? rawUom.toUpperCase() : 'EA';

        result.lineItems.push({
          itemNumber,
          description,
          quantity:   idx.quantity >= 0 ? parseFloat(cells[idx.quantity])    || 1 : 1,
          unitPrice:  idx.price    >= 0 ? parseAmount(cells[idx.price])          : 0,
          uom,
          lineAmount: idx.total    >= 0 ? parseAmount(cells[idx.total])          : 0,
        });
      }

      // Extract header fields from form key-value pairs
      for (const field of page.formFields || []) {
        const key = getLayoutText(field.fieldName,  fullText).toLowerCase();
        const val = getLayoutText(field.fieldValue, fullText);
        if (/bid.?no|bid.?num|quote.?no/.test(key))                    result.header.docNumber   = val;
        if (/bid.?date|quote.?date/.test(key))                          result.header.docDate     = val;
        if (/net.?total|subtotal/.test(key))                            result.header.subtotal    = parseAmount(val);
        if (/total/.test(key) && !/sub/.test(key))                      result.header.totalAmount = parseAmount(val);
        // Capture vendor/company name from quote header fields
        if (/vendor|company|sold.?to|bill.?to|^from$|supplier/.test(key) && val && val.length > 1)
          result.header.vendorName = val;
      }
    }
  }

  // ── Also check document-level entities (some Form Parser versions return these) ──
  for (const entity of document.entities || []) {
    const text = entity.mentionText?.trim() || '';
    if (['vendor_name', 'supplier_name', 'receiver_name'].includes(entity.type) && text)
      result.header.vendorName = result.header.vendorName || text;
  }

  // ── Fallback: pattern-based vendor extraction from raw document text ──────────
  if (!result.header.vendorName && fullText) {
    // Pattern 1: company name appearing immediately before "Price Quotation"
    // e.g. "FERGUSON ENTERPRISES #1001\nPrice Quotation"
    const preQuote = fullText.match(/([A-Za-z][A-Za-z\s&,.']{3,60}?)\s*(?:#\d+\s*)?\n?\s*Price\s*Quotation/i);
    if (preQuote) {
      const candidate = preQuote[1].replace(/\s*#\d+$/, '').trim();
      if (candidate.length > 2 && !/^\d/.test(candidate)) {
        result.header.vendorName = candidate;
      }
    }

    // Pattern 2: extract company from email domain in document
    // e.g. "kevin@ferguson.com" → "Ferguson"
    if (!result.header.vendorName) {
      const emailMatch = fullText.match(/[\w.+-]+@([\w-]+)\.(com|net|org|co)\b/i);
      if (emailMatch) {
        const domain = emailMatch[1];
        result.header.vendorName = domain.charAt(0).toUpperCase() + domain.slice(1).toLowerCase();
      }
    }
  }

  return result;
}

// ── Excel parser (Ferguson backup format) ────────────────────────────────────
function parseExcelFile(buffer, fileName) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rows.length === 0) return { header: { docNumber: fileName }, lineItems: [] };

  const keys = Object.keys(rows[0]);

  // Map columns flexibly
  const col = {
    itemNumber:  findCol(keys, ['item number', 'item#', 'item no', 'part number', 'part#', 'sku', 'product code', 'material no']),
    description: findCol(keys, ['description', 'desc', 'product name', 'material description', 'name']),
    quantity:    findCol(keys, ['qty', 'quantity', 'order qty', 'ordered qty', 'qty ordered']),
    unitPrice:   findCol(keys, ['net price', 'unit price', 'net unit price', 'price', 'net', 'cost']),
    uom:         findCol(keys, ['uom', 'unit of measure', 'unit', 'um', 'u/m']),
    lineAmount:  findCol(keys, ['line total', 'extended', 'ext price', 'total', 'amount', 'line amount']),
    lineNumber:  findCol(keys, ['line', 'line#', 'line no', 'seq']),
  };

  console.log('Excel column mapping:', col);

  const lineItems = rows
    .map((row, i) => ({
      lineNumber:  parseInt(row[col.lineNumber]) || i + 1,
      itemNumber:  String(row[col.itemNumber]  || '').trim(),
      description: String(row[col.description] || '').trim(),
      quantity:    parseFloat(row[col.quantity])    || 1,
      unitPrice:   parseAmount(String(row[col.unitPrice]  || '0')),
      uom:         String(row[col.uom] || 'EA').trim() || 'EA',
      lineAmount:  parseAmount(String(row[col.lineAmount] || '0')),
    }))
    .filter(item => item.itemNumber || item.description);

  return {
    header: { docNumber: fileName.replace(/\.[^.]+$/, ''), vendorName: '' },
    lineItems,
  };
}

// ── Save parsed document to PostgreSQL ───────────────────────────────────────
const trunc = (s, n = 500) => s ? String(s).substring(0, n) : s;

// Find or create a vendor by name; returns vendor_id or null.
// Uses a SAVEPOINT so any failure rolls back only the vendor operation
// without aborting the outer transaction.
async function findOrCreateVendor(client, vendorName) {
  if (!vendorName || vendorName.trim().toLowerCase() === 'unknown') return null;
  const name = vendorName.trim();
  const upper = name.toUpperCase();

  try {
    await client.query('SAVEPOINT vendor_upsert');

    // Check for existing vendor (case-insensitive)
    const existing = await client.query(
      `SELECT vendor_id FROM procurement.vendors WHERE UPPER(vendor_name) = $1 LIMIT 1`,
      [upper]
    );
    if (existing.rows.length > 0) {
      await client.query('RELEASE SAVEPOINT vendor_upsert');
      return existing.rows[0].vendor_id;
    }

    // Insert using only vendor_name to avoid unknown column constraints
    const { rows } = await client.query(
      `INSERT INTO procurement.vendors (vendor_name) VALUES ($1) RETURNING vendor_id`,
      [name]
    );
    await client.query('RELEASE SAVEPOINT vendor_upsert');
    return rows[0].vendor_id;

  } catch (e) {
    // Roll back only the vendor savepoint — outer transaction stays intact
    console.warn(`findOrCreateVendor failed for "${name}", continuing without vendor:`, e.message);
    try { await client.query('ROLLBACK TO SAVEPOINT vendor_upsert'); } catch {}
    try { await client.query('RELEASE SAVEPOINT vendor_upsert'); } catch {}
    return null;
  }
}

// Validate dates from Document AI before passing to PostgreSQL.
// Always returns ISO YYYY-MM-DD (not the original string) so garbage
// like "51 APR 06 2026" never reaches PostgreSQL even if V8 parses it.
function safeDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  if (y < 2000 || y > 2100) return null;   // sanity-check year
  return dt.toISOString().split('T')[0];    // YYYY-MM-DD
}

// Widen columns once per server instance — guaranteed before first insert
let _schemaDone = false;
async function ensureSchema(client) {
  if (_schemaDone) return;
  const cols = [
    'ALTER TABLE procurement.invoices ALTER COLUMN source_filename TYPE TEXT',
    'ALTER TABLE procurement.invoices ALTER COLUMN invoice_number  TYPE TEXT',
    'ALTER TABLE procurement.quotes   ALTER COLUMN source_filename TYPE TEXT',
    'ALTER TABLE procurement.quotes   ALTER COLUMN bid_number      TYPE TEXT',
  ];
  for (const sql of cols) {
    try { await client.query(sql); console.log('Schema:', sql); }
    catch (e) { console.log('Schema skip:', e.message); }
  }
  _schemaDone = true;
}

async function saveToDatabase(pool, docType, fileName, parsed) {
  const client = await pool.connect();
  try {
    // 1. Widen columns if needed (runs once, before any insert)
    await ensureSchema(client);

    await client.query('BEGIN');
    await client.query('SET search_path TO procurement');

    let recordId = null;
    let skipped  = false;

    if (docType === 'invoice') {
      // Dedup: skip only if the existing record already has line items.
      // If the previous upload left an empty record, delete it and re-insert.
      const dup = await client.query(
        `SELECT i.invoice_id,
                (SELECT COUNT(*) FROM invoice_line_items WHERE invoice_id = i.invoice_id) AS item_count
         FROM invoices i WHERE i.source_filename = $1 LIMIT 1`,
        [trunc(fileName)]
      );
      if (dup.rows.length > 0 && parseInt(dup.rows[0].item_count) > 0) {
        recordId = dup.rows[0].invoice_id;
        skipped  = true;
      } else if (dup.rows.length > 0) {
        // Empty record from a failed prior upload — delete and re-insert
        await client.query('DELETE FROM invoice_line_items WHERE invoice_id = $1', [dup.rows[0].invoice_id]);
        await client.query('DELETE FROM invoices WHERE invoice_id = $1', [dup.rows[0].invoice_id]);
      }
      if (!skipped) {
        const fnMeta = extractFilenameMetadata(fileName);
        const vendorId = await findOrCreateVendor(client, parsed.header.vendorName || extractVendorFromFilename(fileName));
        const { rows } = await client.query(
          `INSERT INTO invoices
             (invoice_number, invoice_date, subtotal, tax_amount, total_amount, source_filename, po_number, job_number, status, vendor_id)
           VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, 'PENDING', $9)
           RETURNING invoice_id`,
          [
            trunc(parsed.header.docNumber || fileName.replace(/\.[^.]+$/, '')),
            safeDate(parsed.header.docDate),
            parsed.header.subtotal    || 0,
            parsed.header.taxAmount   || 0,
            parsed.header.totalAmount || 0,
            trunc(fileName),
            trunc(parsed.header.poNumber  || fnMeta.poNumber  || '', 100),
            trunc(parsed.header.jobNumber || fnMeta.jobNumber || '', 100),
            vendorId,
          ]
        );
        recordId = rows[0].invoice_id;

        for (let i = 0; i < parsed.lineItems.length; i++) {
          const item = parsed.lineItems[i];
          await client.query(
            `INSERT INTO invoice_line_items
               (invoice_id, line_number, item_number, description, qty_shipped, uom, unit_price, line_amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [recordId, item.lineNumber || i+1, trunc(item.itemNumber || 'UNKNOWN'),
             trunc(item.description || ''), item.quantity || 0, trunc(item.uom || 'EA', 20),
             item.unitPrice || 0, item.lineAmount || 0]
          );
        }
      }

    } else if (docType === 'quote') {
      // Dedup: skip only if existing record already has line items
      const dup = await client.query(
        `SELECT q.quote_id,
                (SELECT COUNT(*) FROM quote_line_items WHERE quote_id = q.quote_id) AS item_count
         FROM quotes q WHERE q.source_filename = $1 LIMIT 1`,
        [trunc(fileName)]
      );
      if (dup.rows.length > 0 && parseInt(dup.rows[0].item_count) > 0) {
        recordId = dup.rows[0].quote_id;
        skipped  = true;
      } else if (dup.rows.length > 0) {
        // Empty record — delete and re-insert
        await client.query('DELETE FROM quote_line_items WHERE quote_id = $1', [dup.rows[0].quote_id]);
        await client.query('DELETE FROM quotes WHERE quote_id = $1', [dup.rows[0].quote_id]);
      }
      if (!skipped) {
        const vendorId = await findOrCreateVendor(client, parsed.header.vendorName || extractVendorFromFilename(fileName));
        const { rows } = await client.query(
          `INSERT INTO quotes
             (bid_number, bid_date, net_total, total_amount, source_filename, status, vendor_id)
           VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, 'ACTIVE', $6)
           RETURNING quote_id`,
          [
            trunc(parsed.header.docNumber || fileName.replace(/\.[^.]+$/, '')),
            safeDate(parsed.header.docDate),
            parsed.header.subtotal    || parsed.header.totalAmount || 0,
            parsed.header.totalAmount || 0,
            trunc(fileName),
            vendorId,
          ]
        );
        recordId = rows[0].quote_id;

        for (let i = 0; i < parsed.lineItems.length; i++) {
          const item = parsed.lineItems[i];
          await client.query(
            `INSERT INTO quote_line_items
               (quote_id, line_number, item_number, description, quantity, net_price, uom, line_total)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [recordId, item.lineNumber || i+1, trunc(item.itemNumber || 'UNKNOWN'),
             trunc(item.description || ''), item.quantity || 1, item.unitPrice || 0,
             trunc(item.uom || 'EA', 20), item.lineAmount || 0]
          );
        }
      }
    }

    await client.query('COMMIT');
    return { recordId, lineItemsInserted: skipped ? 0 : parsed.lineItems.length, skipped };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const checks = {
    gcs:   'unchecked',
    db:    'unchecked',
    docai: DOCAI_PROCESSOR ? 'configured' : 'not_configured',
  };

  try {
    await storage.bucket(BUCKET_NAME).getMetadata();
    checks.gcs = 'connected';
  } catch { checks.gcs = 'error'; }

  try {
    const pool = await getPool();
    await pool.query('SELECT 1');
    checks.db = 'connected';
  } catch { checks.db = DB_PASSWORD ? 'error' : 'not_configured'; }

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

  const isExcel = /\.(xlsx|xls)$/i.test(file.originalname);
  const isPdf   = /\.pdf$/i.test(file.originalname);

  try {
    // 1. Upload to GCS
    const folders = { invoice: 'invoices', quote: 'quotes/backup-files', po: 'purchase-orders' };
    const gcsPath = `${folders[docType] || 'invoices'}/${Date.now()}-${file.originalname}`;
    await storage.bucket(BUCKET_NAME).file(gcsPath).save(file.buffer, { contentType: file.mimetype });
    const gcPath = `gs://${BUCKET_NAME}/${gcsPath}`;

    // 2. Parse the document
    let parsed = { header: {}, lineItems: [] };
    let docaiProcessed = false;

    if (isExcel) {
      // Excel: parse directly
      parsed = parseExcelFile(file.buffer, file.originalname);
      console.log(`Excel parsed: ${file.originalname} — ${parsed.lineItems.length} line items`);

    } else if (isPdf) {
      const isQuote     = docType === 'quote';
      const processorId = isQuote ? DOCAI_QUOTE_PROCESSOR : DOCAI_PROCESSOR;

      if (processorId) {
        // Split PDF into individual pages and process each separately
        const pdfDoc   = await PDFDocument.load(file.buffer);
        const numPages = pdfDoc.getPageCount();
        console.log(`PDF has ${numPages} page(s): ${file.originalname}`);

        const docaiClient = new DocumentProcessorServiceClient();
        const procName    = `projects/${PROJECT_ID}/locations/${DOCAI_LOCATION}/processors/${processorId}`;

        // Collect all pages as individual buffers
        const pageBuffers = await Promise.all(
          Array.from({ length: numPages }, async (_, i) => {
            const single = await PDFDocument.create();
            const [page] = await single.copyPages(pdfDoc, [i]);
            single.addPage(page);
            return Buffer.from(await single.save());
          })
        );

        // Process pages through Document AI in parallel batches of 5
        const BATCH = 5;
        const allParsed = new Array(pageBuffers.length).fill(null);
        for (let start = 0; start < pageBuffers.length; start += BATCH) {
          const batchIdx = Array.from(
            { length: Math.min(BATCH, pageBuffers.length - start) },
            (_, k) => start + k
          );
          await Promise.all(batchIdx.map(async (i) => {
            try {
              const [response] = await docaiClient.processDocument({
                name: procName,
                rawDocument: { content: pageBuffers[i].toString('base64'), mimeType: 'application/pdf' },
              });
              const p = isQuote
                ? parseFormParserResponse(response.document)
                : parseDocAiResponse(response.document);
              if (p.header.docNumber || p.lineItems.length > 0) {
                allParsed[i] = p;
                console.log(`Page ${i+1}/${numPages}: ${p.header.docNumber || '(no doc#)'} — ${p.lineItems.length} items`);
              }
            } catch (e) {
              console.error(`Document AI error on page ${i+1}:`, e.message);
            }
          }));
        }
        // Remove null slots (pages with no extractable content)
        const filteredParsed = allParsed.filter(p => p !== null);

        docaiProcessed = filteredParsed.length > 0;
        // Use first page result for the single-doc response fields; all pages saved below
        if (filteredParsed.length > 0) parsed = filteredParsed[0];

        // 3. Save every extracted page to PostgreSQL
        const pool = await getPool();
        let totalItems = 0;
        let errors = [];
        for (let i = 0; i < filteredParsed.length; i++) {
          const pageName = numPages === 1
            ? file.originalname
            : `${file.originalname} [page ${i+1}]`;
          try {
            const r = await saveToDatabase(pool, docType, pageName, filteredParsed[i]);
            totalItems += r.lineItemsInserted;
          } catch (e) {
            errors.push(`Page ${i+1}: ${e.message}`);
            console.error(`DB error page ${i+1}:`, e.message);
          }
        }

        return res.json({
          gcPath,
          fileName: file.originalname,
          docType,
          fileType: 'pdf',
          pageCount: numPages,
          invoicesProcessed: filteredParsed.length,
          dbSaved: filteredParsed.length > 0 && errors.length < filteredParsed.length,
          dbError: errors.length > 0 ? errors.join('; ') : null,
          documentAiProcessed: docaiProcessed,
          lineItemsExtracted: totalItems,
        });
      }
    }

    // 3. Save to PostgreSQL (Excel or PDF with no processor configured)
    let dbResult = null;
    let dbError = null;
    try {
      const pool = await getPool();
      dbResult = await saveToDatabase(pool, docType, file.originalname, parsed);
      console.log(`DB saved: ${dbResult.lineItemsInserted} line items for ${file.originalname}`);
    } catch (e) {
      dbError = e.message;
      console.error('DB write error:', e.message);
    }

    res.json({
      gcPath,
      fileName: file.originalname,
      docType,
      fileType: isExcel ? 'excel' : isPdf ? 'pdf' : 'other',
      dbSaved: dbResult !== null,
      dbError,
      documentAiProcessed: docaiProcessed,
      lineItemsExtracted: parsed.lineItems.length,
      dbResult,
    });

  } catch (err) {
    console.error('Upload failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── List invoices with line items ─────────────────────────────────────────────
app.get('/api/invoices', async (_req, res) => {
  try {
    const pool = await getPool();
    const { rows } = await pool.query(`
      SELECT
        i.invoice_id        AS id,
        i.invoice_number    AS "invoiceNumber",
        i.invoice_date::text AS "invoiceDate",
        COALESCE(v.vendor_name, 'Unknown') AS vendor,
        COALESCE(i.po_number, '')   AS "poNumber",
        COALESCE(i.job_number, '')  AS "jobNumber",
        i.total_amount              AS total,
        i.status,
        COALESCE(
          json_agg(
            json_build_object(
              'itemNumber',  li.item_number,
              'description', li.description,
              'qtyOrdered',  COALESCE(li.qty_ordered, li.qty_shipped),
              'qtyShipped',  li.qty_shipped,
              'unitPrice',   COALESCE(li.unit_price, 0),
              'uom',         li.uom,
              'amount',      li.line_amount
            ) ORDER BY li.line_number
          ) FILTER (WHERE li.invoice_line_id IS NOT NULL),
          '[]'
        ) AS "lineItems"
      FROM procurement.invoices i
      LEFT JOIN procurement.vendors v USING (vendor_id)
      LEFT JOIN procurement.invoice_line_items li USING (invoice_id)
      GROUP BY i.invoice_id, v.vendor_name
      ORDER BY i.invoice_date DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── List quotes with line items ───────────────────────────────────────────────
app.get('/api/quotes', async (_req, res) => {
  try {
    const pool = await getPool();
    const { rows } = await pool.query(`
      SELECT
        q.quote_id          AS id,
        q.bid_number        AS "bidNumber",
        q.bid_date::text    AS "bidDate",
        COALESCE(v.vendor_name, 'Unknown') AS vendor,
        COALESCE(v.vendor_code, '')  AS "vendorCode",
        COALESCE(q.job_name, '')     AS "jobName",
        COALESCE(q.quoted_by, '')    AS "quotedBy",
        COALESCE(q.total_amount, q.net_total, 0) AS total,
        q.status,
        COALESCE(
          json_agg(
            json_build_object(
              'itemNumber',  li.item_number,
              'description', li.description,
              'qty',         li.quantity,
              'netPrice',    li.net_price,
              'uom',         li.uom,
              'total',       COALESCE(li.line_total, 0)
            ) ORDER BY li.line_number
          ) FILTER (WHERE li.quote_line_id IS NOT NULL),
          '[]'
        ) AS "lineItems"
      FROM procurement.quotes q
      LEFT JOIN procurement.vendors v USING (vendor_id)
      LEFT JOIN procurement.quote_line_items li USING (quote_id)
      GROUP BY q.quote_id, v.vendor_name, v.vendor_code
      ORDER BY q.bid_date DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Quote vs Invoice comparison ───────────────────────────────────────────────
app.get('/api/comparison', async (_req, res) => {
  try {
    const pool = await getPool();
    const { rows } = await pool.query(`
      SELECT
        qli.item_number                               AS "itemNumber",
        qli.description,
        COALESCE(v.vendor_name, best.vendor_name, 'Unknown') AS vendor,
        qli.uom,
        q.bid_number                                AS "quoteNumber",
        qli.net_price                               AS "quotedPrice",
        best.invoice_number                         AS "invoiceNumber",
        -- Weighted avg unit cost across all non-credit-memo invoice lines ($/qty)
        CASE WHEN best.avg_unit_price > 0 THEN best.avg_unit_price ELSE NULL END AS "invoicePrice",
        -- Variance only when BOTH prices are real (> 0)
        CASE WHEN best.avg_unit_price > 0 AND qli.net_price > 0
          THEN ROUND(((best.avg_unit_price - qli.net_price) / qli.net_price * 100)::numeric, 2)
          ELSE NULL
        END AS variance,
        -- Status
        CASE
          WHEN best.avg_unit_price IS NULL OR best.avg_unit_price = 0  THEN 'NOT_INVOICED'
          WHEN qli.net_price = 0                                        THEN 'NOT_QUOTED'
          WHEN best.avg_unit_price > qli.net_price * 1.001              THEN 'OVER_QUOTE'
          WHEN best.avg_unit_price < qli.net_price * 0.999              THEN 'UNDER_QUOTE'
          ELSE 'MATCH'
        END AS status
      FROM procurement.quote_line_items qli
      JOIN procurement.quotes q ON qli.quote_id = q.quote_id
      LEFT JOIN procurement.vendors v ON q.vendor_id = v.vendor_id
      -- Aggregate all non-credit-memo invoice lines for this item number:
      -- avg unit cost = SUM(line_amount) / SUM(qty_shipped)
      LEFT JOIN LATERAL (
        SELECT
          SUM(ili.line_amount) / NULLIF(SUM(ili.qty_shipped), 0) AS avg_unit_price,
          (SELECT i3.invoice_number
           FROM procurement.invoice_line_items ili3
           JOIN procurement.invoices i3 ON i3.invoice_id = ili3.invoice_id
           WHERE UPPER(TRIM(ili3.item_number)) = UPPER(TRIM(qli.item_number))
             AND ili3.qty_shipped > 0
           ORDER BY i3.invoice_date DESC NULLS LAST
           LIMIT 1) AS invoice_number,
          MAX(iv.vendor_name) AS vendor_name
        FROM procurement.invoice_line_items ili
        JOIN procurement.invoices i2 ON i2.invoice_id = ili.invoice_id
        LEFT JOIN procurement.vendors iv ON i2.vendor_id = iv.vendor_id
        WHERE UPPER(TRIM(ili.item_number)) = UPPER(TRIM(qli.item_number))
          AND ili.qty_shipped > 0        -- exclude credit memo / zero-qty lines
      ) best ON true
      ORDER BY
        CASE WHEN best.avg_unit_price > 0 AND best.avg_unit_price > qli.net_price * 1.001 THEN 0
             WHEN best.avg_unit_price > 0 AND best.avg_unit_price < qli.net_price * 0.999 THEN 1
             WHEN best.avg_unit_price > 0 THEN 2
             ELSE 3 END,
        qli.item_number
      LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PO Analysis helpers ──────────────────────────────────────────────────────
function normalizePO(raw) {
  if (!raw) return '';
  const m = String(raw).trim().match(/^[A-Z.\s]+-?\s*(\d[\w-]*)$/i);
  return (m ? m[1] : String(raw)).trim().toUpperCase();
}

function chunked(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Medius token cache (per-instance)
let _mediusTokenCache = { value: null, expiresAt: 0 };
async function getMediusToken() {
  const now = Date.now();
  if (_mediusTokenCache.value && now < _mediusTokenCache.expiresAt - 60_000) {
    return _mediusTokenCache.value;
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'Integration.Erp Integration.FileExport',
    client_id: MEDIUS_CLIENT_ID,
    client_secret: MEDIUS_CLIENT_SECRET,
  });
  const r = await fetch(`${MEDIUS_BASE_URL}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!r.ok) throw new Error(`Medius token failed: ${r.status}`);
  const j = await r.json();
  _mediusTokenCache = {
    value: j.access_token,
    expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
  };
  return _mediusTokenCache.value;
}

async function listMediusMsgIds(stage, token) {
  // Matches 55_MD_Get_Msg_ID.xml: correlationKeyFilter=JDEE1;;;;;
  const url = `${MEDIUS_BASE_URL}/integration/message/v1/supplierinvoice/invoices/${stage}?correlationKeyFilter=JDEE1;;;;;`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Medius list ${stage} failed: ${r.status}`);
  const j = await r.json();
  // Shape per 55_MD_Msg_ID_Dataset.xml: array of { url: ".../{msgId}" }
  const list = Array.isArray(j) ? j : (j.array || j.messages || j.items || []);
  return list.map(m => {
    const href = m.url || m.href || m.messageUrl || '';
    return href.split('/').pop();
  }).filter(Boolean);
}

async function getMediusInvoiceDetail(stage, msgId, token) {
  const url = `${MEDIUS_BASE_URL}/integration/message/v1/supplierinvoice/invoices/${stage}/${msgId}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Medius detail ${stage}/${msgId} failed: ${r.status}`);
  return r.json();
}

async function fetchMediusPendingForPO(poNumber) {
  const token = await getMediusToken();
  const target = normalizePO(poNumber);
  const results = [];
  for (const stage of MEDIUS_PENDING_STAGES) {
    let ids = [];
    try { ids = await listMediusMsgIds(stage, token); }
    catch (e) { console.warn(`Medius listMsgIds ${stage}:`, e.message); continue; }

    for (const chunk of chunked(ids, 5)) {
      const detailed = await Promise.all(
        chunk.map(id => getMediusInvoiceDetail(stage, id, token).catch(err => {
          console.warn(`Medius detail ${stage}/${id}:`, err.message);
          return null;
        }))
      );
      for (const msg of detailed) {
        if (!msg) continue;
        const inv = msg.invoice || {};
        const poLines = Array.isArray(inv.poLines) ? inv.poLines : [];
        if (!poLines.some(pl => normalizePO(pl.purchaseOrderNumber) === target)) continue;
        results.push({
          msgId:         msg.messageId || msg.id || null,
          stage,
          invoiceNumber: inv.invoiceNumber || null,
          supplierId:    inv.supplierId    || null,
          total:         parseFloat(inv.totalAmount || 0),
          invoiceDate:   inv.invoiceDate   || null,
          poLines: poLines
            .filter(pl => normalizePO(pl.purchaseOrderNumber) === target)
            .map(pl => ({
              po:     pl.purchaseOrderNumber,
              line:   pl.purchaseOrderLineNumber,
              amount: (parseFloat(pl.unitPrice || 0) * parseFloat(pl.quantity || 0)) || 0,
            })),
        });
      }
    }
  }
  return results;
}

async function callJdeOrchestration(name, body) {
  const url = `${JDE_BASE_URL}/${name}`;
  const auth = Buffer.from(`${JDE_USER}:${JDE_PASSWORD}`).toString('base64');
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) throw new Error(`JDE ${name} failed: ${r.status}`);
  return r.json();
}

async function fetchJdePOLines(poNumber) {
  // Expected orchestration: PO_Inquiry_By_PO
  // Response: { lines: [ { lineNumber, description, lastStatus, originalOrderedAmount } ] }
  const j = await callJdeOrchestration('PO_Inquiry_By_PO', { poNumber });
  const lines = Array.isArray(j.lines) ? j.lines : (Array.isArray(j) ? j : []);
  return lines.map(l => ({
    lineNumber:  l.lineNumber,
    description: l.description || '',
    lastStatus:  String(l.lastStatus || '').trim(),
    amount:      parseFloat(l.originalOrderedAmount || l.amount || 0),
  }));
}

async function fetchJdePOInvoices(poNumber) {
  // Expected orchestration: Supplier_Inquiry_By_PO
  // Response: { invoices: [ { invoiceNumber, invoiceDate, grossAmount } ] }
  const j = await callJdeOrchestration('Supplier_Inquiry_By_PO', { poNumber });
  const invoices = Array.isArray(j.invoices) ? j.invoices : (Array.isArray(j) ? j : []);
  return invoices.map(i => ({
    invoiceNumber: i.invoiceNumber,
    invoiceDate:   i.invoiceDate,
    grossAmount:   parseFloat(i.grossAmount || i.amount || 0),
  }));
}

// Deterministic mocks keyed off PO# so the UI is demo-able before integrations exist.
function mockJde(poNumber) {
  const hit = MOCK_MY_POS.vendors.flatMap(v => v.pos).find(p => p.poNumber === poNumber);
  const amount   = hit?.amount ?? 1200;
  const pending  = Math.round(amount * 0.1);
  const approved = amount - pending;
  return {
    lines: [
      { lineNumber: 1, description: 'Approved PO line',          lastStatus: '440', amount: approved },
      { lineNumber: 2, description: 'Pending change-order line', lastStatus: '280', amount: pending  },
    ],
    invoices: [
      { invoiceNumber: `${poNumber}-INV-001`, invoiceDate: '2026-03-15', grossAmount: 1000 },
    ],
  };
}

function mockMedius(poNumber) {
  return [
    {
      msgId: 'mock-1', stage: 'PreliminaryAfterCoding',
      invoiceNumber: 'MED-A-001', supplierId: '12345',
      total: 800, invoiceDate: '2026-04-02',
      poLines: [{ po: poNumber, line: 1, amount: 800 }],
    },
    {
      msgId: 'mock-2', stage: 'PreliminaryAfterApproval',
      invoiceNumber: 'MED-A-002', supplierId: '12345',
      total: 500, invoiceDate: '2026-04-10',
      poLines: [{ po: poNumber, line: 2, amount: 500 }],
    },
  ];
}

function bucketJdeLines(lines) {
  let approved = 0, pending = 0;
  const enriched = lines.map(l => {
    const bucket = JDE_APPROVED_STATUSES.has(l.lastStatus) ? 'approved'
                 : JDE_PENDING_STATUSES.has(l.lastStatus)  ? 'pending'
                 : 'other';
    if (bucket === 'approved') approved += l.amount;
    else if (bucket === 'pending') pending += l.amount;
    return { ...l, bucket };
  });
  return { approved, pending, lines: enriched };
}

// Mock PM → vendor → POs roll-up. Returned as-is until a JDE orchestration
// (e.g. `PM_PO_List`) exists that filters F4301 by Buyer and groups by vendor.
const MOCK_MY_POS = {
  pm: { code: 'AK', name: 'Alex Kowalski' },
  vendors: [
    {
      vendorNumber: 'F1001',
      vendorName:   'Ferguson Enterprises',
      pos: [
        { poNumber: '229902-058', jobNumber: '60140018', description: 'Plumbing rough-in — Building A', amount: 52300 },
        { poNumber: '230751-019', jobNumber: '60140018', description: 'Fixtures & trim',                 amount: 18200 },
        { poNumber: '231402-002', jobNumber: '60140022', description: 'Water heaters',                    amount:  9650 },
      ],
    },
    {
      vendorNumber: 'G2055',
      vendorName:   'Grainger Industrial',
      pos: [
        { poNumber: '231004-012', jobNumber: '60140022', description: 'Motor controls & VFDs', amount: 8700 },
      ],
    },
    {
      vendorNumber: 'J3421',
      vendorName:   'Johnstone Supply',
      pos: [
        { poNumber: '229988-003', jobNumber: '60140018', description: 'HVAC coils',   amount: 14500 },
        { poNumber: '230155-007', jobNumber: '60140019', description: 'Thermostats', amount:  3200 },
      ],
    },
    {
      vendorNumber: 'H4810',
      vendorName:   'Hajoca Corporation',
      pos: [
        { poNumber: '230889-041', jobNumber: '60140019', description: 'Copper fittings',        amount: 6400 },
        { poNumber: '231188-008', jobNumber: '60140022', description: 'Valves & backflow prev', amount: 4120 },
      ],
    },
  ],
};

app.get('/api/po-analysis/my-pos', (_req, res) => {
  res.json(MOCK_MY_POS);
});

app.get('/api/po-analysis/:poNumber', async (req, res) => {
  const poNumber = normalizePO(req.params.poNumber);
  if (!poNumber) return res.status(400).json({ error: 'poNumber required' });

  const sources = { jde: 'live', medius: 'live' };

  // JDE: lines + invoices (run in parallel with Medius below)
  const jdePromise = (async () => {
    if (JDE_MOCK) { sources.jde = 'mock'; const m = mockJde(poNumber); return { lines: m.lines, invoices: m.invoices }; }
    try {
      const [lines, invoices] = await Promise.all([
        fetchJdePOLines(poNumber),
        fetchJdePOInvoices(poNumber),
      ]);
      return { lines, invoices };
    } catch (e) {
      console.warn('JDE fetch failed:', e.message);
      sources.jde = 'error';
      return { lines: [], invoices: [] };
    }
  })();

  const mediusPromise = (async () => {
    if (MEDIUS_MOCK) { sources.medius = 'mock'; return mockMedius(poNumber); }
    try {
      return await fetchMediusPendingForPO(poNumber);
    } catch (e) {
      console.warn('Medius fetch failed:', e.message);
      sources.medius = 'error';
      return [];
    }
  })();

  try {
    const [jde, medius] = await Promise.all([jdePromise, mediusPromise]);
    const bucketed = bucketJdeLines(jde.lines);

    const approvedPOValue       = bucketed.approved;
    const pendingPOValue        = bucketed.pending;
    const totalBilledJDE        = jde.invoices.reduce((s, i) => s + i.grossAmount, 0);
    const pendingInvoicesMedius = medius.reduce((s, m) => s + m.total, 0);
    const grandCommitment       = approvedPOValue + pendingPOValue;
    const openPOAmount          = grandCommitment - totalBilledJDE - pendingInvoicesMedius;

    res.json({
      poNumber,
      totals: {
        approvedPOValue,
        pendingPOValue,
        totalBilledJDE,
        pendingInvoicesMedius,
        grandCommitment,
        openPOAmount,
      },
      breakdown: {
        poLines:        bucketed.lines,
        jdeInvoices:    jde.invoices,
        mediusInvoices: medius,
      },
      sources,
    });
  } catch (e) {
    console.error('po-analysis failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Admin: clear all document data ───────────────────────────────────────────
app.delete('/api/admin/clear-data', async (_req, res) => {
  try {
    const pool = await getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET search_path TO procurement');
      const r1 = await client.query('DELETE FROM invoice_line_items');
      const r2 = await client.query('DELETE FROM invoices');
      const r3 = await client.query('DELETE FROM quote_line_items');
      const r4 = await client.query('DELETE FROM quotes');
      await client.query('COMMIT');
      console.log(`Data cleared: ${r2.rowCount} invoices, ${r4.rowCount} quotes`);
      res.json({
        success: true,
        deleted: {
          invoiceLineItems: r1.rowCount,
          invoices:         r2.rowCount,
          quoteLineItems:   r3.rowCount,
          quotes:           r4.rowCount,
        },
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Procurement API listening on :${PORT}`));
