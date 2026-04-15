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
        price:       headers.findIndex(h => /net\s*price|unit\s*price|price/.test(h)),
        uom:         headers.findIndex(h => /\bum\b|^uom$/.test(h)),
        total:       headers.findIndex(h => h.includes('total')),
      };

      for (const row of table.bodyRows || []) {
        const cells = (row.cells || []).map(c => getLayoutText(c.layout, fullText));
        const itemNumber  = idx.item        >= 0 ? cells[idx.item]                        : '';
        const description = idx.description >= 0 ? cells[idx.description]                 : '';
        if (!itemNumber && !description) continue;

        result.lineItems.push({
          itemNumber,
          description,
          quantity:   idx.quantity >= 0 ? parseFloat(cells[idx.quantity])    || 1 : 1,
          unitPrice:  idx.price    >= 0 ? parseAmount(cells[idx.price])          : 0,
          uom:        idx.uom      >= 0 ? cells[idx.uom] || 'EA'                 : 'EA',
          lineAmount: idx.total    >= 0 ? parseAmount(cells[idx.total])          : 0,
        });
      }

      // Extract header fields from form key-value pairs
      for (const field of page.formFields || []) {
        const key = getLayoutText(field.fieldName,  fullText).toLowerCase();
        const val = getLayoutText(field.fieldValue, fullText);
        if (/bid.?no|bid.?num|quote.?no/.test(key))  result.header.docNumber   = val;
        if (/bid.?date|quote.?date/.test(key))        result.header.docDate     = val;
        if (/net.?total|subtotal/.test(key))          result.header.subtotal    = parseAmount(val);
        if (/total/.test(key) && !/sub/.test(key))    result.header.totalAmount = parseAmount(val);
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
        const { rows } = await client.query(
          `INSERT INTO invoices
             (invoice_number, invoice_date, subtotal, tax_amount, total_amount, source_filename, po_number, job_number, status)
           VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, 'PENDING')
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
        const { rows } = await client.query(
          `INSERT INTO quotes
             (bid_number, bid_date, net_total, total_amount, source_filename, status)
           VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, 'ACTIVE')
           RETURNING quote_id`,
          [
            trunc(parsed.header.docNumber || fileName.replace(/\.[^.]+$/, '')),
            safeDate(parsed.header.docDate),
            parsed.header.subtotal    || parsed.header.totalAmount || 0,
            parsed.header.totalAmount || 0,
            trunc(fileName),
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
        -- Treat $0 invoice price as no price (same as unmatched)
        CASE WHEN best.unit_price > 0 THEN best.unit_price ELSE NULL END AS "invoicePrice",
        -- Variance only when BOTH prices are real (> 0)
        CASE WHEN best.unit_price > 0 AND qli.net_price > 0
          THEN ROUND(((best.unit_price - qli.net_price) / qli.net_price * 100)::numeric, 2)
          ELSE NULL
        END AS variance,
        -- Status only when both prices present; $0 invoice = NOT_INVOICED
        CASE
          WHEN best.unit_price IS NULL OR best.unit_price = 0  THEN 'NOT_INVOICED'
          WHEN qli.net_price = 0                               THEN 'MATCH'
          WHEN best.unit_price > qli.net_price * 1.001         THEN 'OVER_QUOTE'
          WHEN best.unit_price < qli.net_price * 0.999         THEN 'UNDER_QUOTE'
          ELSE 'MATCH'
        END AS status
      FROM procurement.quote_line_items qli
      JOIN procurement.quotes q ON qli.quote_id = q.quote_id
      LEFT JOIN procurement.vendors v ON q.vendor_id = v.vendor_id
      -- For each quote line item, find the single most-recent invoice line
      -- that matches by item_number (case-insensitive, trimmed).
      -- LATERAL + LIMIT 1 prevents duplicate rows when an item appears
      -- in multiple invoices.
      LEFT JOIN LATERAL (
        SELECT
          ili.unit_price,
          i2.invoice_number,
          i2.invoice_date,
          iv.vendor_name
        FROM procurement.invoice_line_items ili
        JOIN procurement.invoices i2 ON i2.invoice_id = ili.invoice_id
        LEFT JOIN procurement.vendors iv ON i2.vendor_id = iv.vendor_id
        WHERE UPPER(TRIM(ili.item_number)) = UPPER(TRIM(qli.item_number))
        ORDER BY i2.invoice_date DESC NULLS LAST
        LIMIT 1
      ) best ON true
      ORDER BY
        CASE WHEN best.unit_price > 0 AND best.unit_price > qli.net_price * 1.001 THEN 0
             WHEN best.unit_price > 0 AND best.unit_price < qli.net_price * 0.999 THEN 1
             WHEN best.unit_price > 0 THEN 2
             ELSE 3 END,
        qli.item_number
      LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
