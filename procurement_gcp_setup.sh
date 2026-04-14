#!/bin/bash
# ============================================================================
# ACCO ENGINEERED SYSTEMS
# GCP Infrastructure Setup - Procurement Quote Comparison System (UC #88)
# PostgreSQL -> Datastream CDC -> BigQuery -> Gemini Enterprise
# Project: agent-space-466318
# ============================================================================

set -e  # Exit on error

echo "============================================================"
echo "ACCO Procurement GCP Infrastructure Setup"
echo "Project: agent-space-466318 | Region: us-west1"
echo "============================================================"

# ============================================================================
# STEP 1: SET PROJECT & ENABLE APIS
# ============================================================================
echo ""
echo ">>> STEP 1: Setting project and enabling APIs..."

gcloud config set project agent-space-466318

gcloud services enable \
    sqladmin.googleapis.com \
    datastream.googleapis.com \
    bigquery.googleapis.com \
    sql-component.googleapis.com \
    documentai.googleapis.com \
    storage.googleapis.com \
    pubsub.googleapis.com \
    secretmanager.googleapis.com

echo "APIs enabled"

# ============================================================================
# STEP 2: CREATE CLOUD STORAGE BUCKET
# ============================================================================
echo ""
echo ">>> STEP 2: Creating Cloud Storage bucket..."

gsutil mb -p agent-space-466318 -l us-west1 -c STANDARD gs://agent-space-466318-procurement-docs || true

# Create folder structure
echo "" | gsutil cp - gs://agent-space-466318-procurement-docs/invoices/.keep
echo "" | gsutil cp - gs://agent-space-466318-procurement-docs/quotes/backup-files/.keep
echo "" | gsutil cp - gs://agent-space-466318-procurement-docs/purchase-orders/.keep
echo "" | gsutil cp - gs://agent-space-466318-procurement-docs/processed/.keep

echo "Cloud Storage bucket created: gs://agent-space-466318-procurement-docs"

# ============================================================================
# STEP 3: CREATE CLOUD SQL POSTGRESQL INSTANCE
# ============================================================================
echo ""
echo ">>> STEP 3: Creating Cloud SQL PostgreSQL instance..."
echo "    (This takes 5-10 minutes)"

gcloud sql instances create procurement-db \
    --database-version=POSTGRES_15 \
    --tier=db-custom-2-4096 \
    --region=us-west1 \
    --storage-size=20 \
    --storage-type=SSD \
    --storage-auto-increase \
    --availability-type=ZONAL \
    --enable-point-in-time-recovery \
    --database-flags=cloudsql.logical_decoding=on \
    --root-password=ProcurementDB2026!

echo "Cloud SQL instance created"

# ============================================================================
# STEP 4: CREATE DATABASE AND USERS
# ============================================================================
echo ""
echo ">>> STEP 4: Creating database and users..."

gcloud sql databases create procurement \
    --instance=procurement-db

gcloud sql users create procurement_admin \
    --instance=procurement-db \
    --password=ProcurementAdmin2026!

gcloud sql users create datastream_user \
    --instance=procurement-db \
    --password=DatastreamUser2026!

echo "Database and users created"

# ============================================================================
# STEP 5: GET INSTANCE IP FOR DATASTREAM
# ============================================================================
echo ""
echo ">>> STEP 5: Getting instance connection info..."

POSTGRES_IP=$(gcloud sql instances describe procurement-db \
    --format='value(ipAddresses[0].ipAddress)')

echo "  Instance IP: $POSTGRES_IP"
echo "  Connection Name: agent-space-466318:us-west1:procurement-db"

# ============================================================================
# STEP 6: CREATE BIGQUERY DATASET
# ============================================================================
echo ""
echo ">>> STEP 6: Creating BigQuery dataset..."

bq --location=US mk \
    --dataset \
    --description="Procurement data for quote comparison - UC #88" \
    agent-space-466318:procurement

echo "BigQuery dataset created"

# ============================================================================
# STEP 7: STORE SECRETS
# ============================================================================
echo ""
echo ">>> STEP 7: Storing passwords in Secret Manager..."

echo -n "ProcurementDB2026!" | gcloud secrets create procurement-db-password \
    --replication-policy="automatic" \
    --data-file=- || true

echo -n "DatastreamUser2026!" | gcloud secrets create datastream-password \
    --replication-policy="automatic" \
    --data-file=- || true

echo "Secrets stored"

# ============================================================================
# STEP 8: CREATE DATASTREAM CONNECTION PROFILES
# ============================================================================
echo ""
echo ">>> STEP 8: Creating Datastream connection profiles..."

gcloud datastream connection-profiles create postgres-procurement-source \
    --location=us-west1 \
    --type=postgresql \
    --postgresql-hostname=$POSTGRES_IP \
    --postgresql-port=5432 \
    --postgresql-username=datastream_user \
    --postgresql-password=DatastreamUser2026! \
    --postgresql-database=procurement \
    --display-name="PostgreSQL Procurement Source"

gcloud datastream connection-profiles create bigquery-procurement-dest \
    --location=us-west1 \
    --type=bigquery \
    --display-name="BigQuery Procurement Destination"

echo "Connection profiles created"

# ============================================================================
# OUTPUT: POSTGRESQL SCHEMA COMMANDS
# ============================================================================
echo ""
echo "============================================================"
echo ">>> MANUAL STEP REQUIRED: Run these commands in PostgreSQL"
echo "============================================================"
echo ""
echo "Connect to PostgreSQL:"
echo "  gcloud sql connect procurement-db --user=postgres --database=procurement"
echo ""
echo "Then run the following SQL:"
echo ""
cat << 'EOSQL'
-- Create schema
CREATE SCHEMA IF NOT EXISTS procurement;
SET search_path TO procurement;

-- Enable UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Vendors table
CREATE TABLE vendors (
    vendor_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_name VARCHAR(255) NOT NULL,
    vendor_code VARCHAR(50),
    account_number VARCHAR(50),
    customer_number VARCHAR(50),
    contact_phone VARCHAR(50),
    contact_email VARCHAR(255),
    default_terms VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quotes table (from "Backup" files)
CREATE TABLE quotes (
    quote_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_id UUID REFERENCES vendors(vendor_id),
    bid_number VARCHAR(50) NOT NULL,
    bid_date DATE NOT NULL,
    quoted_by VARCHAR(50),
    job_name VARCHAR(255),
    po_number VARCHAR(50),
    terms VARCHAR(100),
    net_total NUMERIC(12,2),
    total_amount NUMERIC(12,2),
    source_filename VARCHAR(500),
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quote line items (Item Catalog source)
CREATE TABLE quote_line_items (
    quote_line_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_id UUID REFERENCES quotes(quote_id),
    line_number INTEGER,
    item_number VARCHAR(100) NOT NULL,
    description TEXT,
    quantity INTEGER,
    net_price NUMERIC(12,4) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    line_total NUMERIC(12,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invoices table
CREATE TABLE invoices (
    invoice_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_id UUID REFERENCES vendors(vendor_id),
    invoice_number VARCHAR(50) NOT NULL,
    invoice_type VARCHAR(20) DEFAULT 'INVOICE',
    invoice_date DATE NOT NULL,
    po_number VARCHAR(50),
    job_number VARCHAR(100),
    subtotal NUMERIC(12,2) NOT NULL,
    tax_amount NUMERIC(12,2) DEFAULT 0,
    total_amount NUMERIC(12,2) NOT NULL,
    terms VARCHAR(100),
    source_filename VARCHAR(500),
    status VARCHAR(20) DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invoice line items
CREATE TABLE invoice_line_items (
    invoice_line_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID REFERENCES invoices(invoice_id),
    line_number INTEGER,
    item_number VARCHAR(100) NOT NULL,
    description TEXT,
    qty_ordered INTEGER,
    qty_shipped INTEGER NOT NULL,
    uom VARCHAR(20) NOT NULL,
    unit_price NUMERIC(12,4),
    line_amount NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Set replica identity for CDC
ALTER TABLE vendors REPLICA IDENTITY FULL;
ALTER TABLE quotes REPLICA IDENTITY FULL;
ALTER TABLE quote_line_items REPLICA IDENTITY FULL;
ALTER TABLE invoices REPLICA IDENTITY FULL;
ALTER TABLE invoice_line_items REPLICA IDENTITY FULL;

-- Grant replication privilege
ALTER USER postgres WITH REPLICATION;

-- Create replication slot
SELECT pg_create_logical_replication_slot('datastream_slot', 'pgoutput');

-- Create publication
CREATE PUBLICATION datastream_publication FOR TABLE
    procurement.vendors,
    procurement.quotes,
    procurement.quote_line_items,
    procurement.invoices,
    procurement.invoice_line_items;

-- Grant permissions to Datastream user
GRANT USAGE ON SCHEMA procurement TO datastream_user;
GRANT SELECT ON ALL TABLES IN SCHEMA procurement TO datastream_user;
ALTER USER datastream_user WITH REPLICATION;

-- Insert sample vendor to trigger BigQuery table creation
INSERT INTO vendors (vendor_name, vendor_code, account_number)
VALUES ('Ferguson Enterprises', '794', '125240');
EOSQL

echo ""
echo "============================================================"
echo ">>> After running PostgreSQL schema, continue with Step 9"
echo "============================================================"
echo ""
echo "Press Enter after completing PostgreSQL setup..."
read -p ""

# ============================================================================
# STEP 9: CREATE DATASTREAM STREAM
# ============================================================================
echo ""
echo ">>> STEP 9: Creating Datastream stream..."

gcloud datastream streams create procurement-stream \
    --location=us-west1 \
    --source=postgres-procurement-source \
    --postgresql-source-config='{
        "includeObjects": {
            "postgresqlSchemas": [{
                "schema": "procurement",
                "postgresqlTables": [
                    {"table": "vendors"},
                    {"table": "quotes"},
                    {"table": "quote_line_items"},
                    {"table": "invoices"},
                    {"table": "invoice_line_items"}
                ]
            }]
        },
        "replicationSlot": "datastream_slot",
        "publication": "datastream_publication"
    }' \
    --destination=bigquery-procurement-dest \
    --bigquery-destination-config='{
        "dataFreshness": "900s",
        "singleTargetDataset": {
            "datasetId": "agent-space-466318:procurement"
        }
    }' \
    --display-name="Procurement CDC Stream" \
    --backfill-all

echo "Datastream stream created"

# ============================================================================
# STEP 10: START THE STREAM
# ============================================================================
echo ""
echo ">>> STEP 10: Starting Datastream..."

gcloud datastream streams update procurement-stream \
    --location=us-west1 \
    --state=RUNNING

echo "Datastream started"

# ============================================================================
# STEP 11: CREATE BIGQUERY VIEWS
# ============================================================================
echo ""
echo ">>> STEP 11: Creating BigQuery analytics views..."

echo "  Waiting 60 seconds for initial data sync..."
sleep 60

bq query --use_legacy_sql=false "
CREATE OR REPLACE VIEW procurement.v_item_catalog AS
SELECT
    qli.item_number,
    v.vendor_name AS vendor,
    q.bid_number AS quote_number,
    q.bid_date AS quote_date,
    qli.description,
    qli.uom,
    qli.net_price AS unit_net_price,
    qli.quantity AS quoted_qty,
    q.job_name
FROM \`agent-space-466318.procurement.procurement_quote_line_items\` qli
JOIN \`agent-space-466318.procurement.procurement_quotes\` q ON qli.quote_id = q.quote_id
JOIN \`agent-space-466318.procurement.procurement_vendors\` v ON q.vendor_id = v.vendor_id
ORDER BY v.vendor_name, q.bid_date DESC;
"

bq query --use_legacy_sql=false "
CREATE OR REPLACE VIEW procurement.v_quote_vs_invoice AS
SELECT
    COALESCE(ili.item_number, qli.item_number) AS item_number,
    COALESCE(ili.description, qli.description) AS description,
    v.vendor_name,
    COALESCE(ili.uom, qli.uom) AS uom,
    q.bid_number AS quote_number,
    qli.net_price AS quoted_price,
    i.invoice_number,
    ili.unit_price AS invoice_price,
    ili.qty_shipped,
    CASE
        WHEN qli.net_price IS NOT NULL AND ili.unit_price IS NOT NULL
        THEN ROUND(ili.unit_price - qli.net_price, 3)
        ELSE NULL
    END AS variance_amount,
    CASE
        WHEN qli.net_price IS NOT NULL AND qli.net_price != 0 AND ili.unit_price IS NOT NULL
        THEN ROUND((ili.unit_price - qli.net_price) / qli.net_price * 100, 2)
        ELSE NULL
    END AS variance_pct,
    CASE
        WHEN qli.net_price IS NULL THEN 'NO_QUOTE'
        WHEN ili.unit_price IS NULL THEN 'NOT_INVOICED'
        WHEN ili.unit_price > qli.net_price THEN 'OVER_QUOTE'
        WHEN ili.unit_price < qli.net_price THEN 'UNDER_QUOTE'
        ELSE 'MATCH'
    END AS variance_status
FROM \`agent-space-466318.procurement.procurement_invoice_line_items\` ili
FULL OUTER JOIN \`agent-space-466318.procurement.procurement_quote_line_items\` qli
    ON ili.item_number = qli.item_number
LEFT JOIN \`agent-space-466318.procurement.procurement_invoices\` i ON ili.invoice_id = i.invoice_id
LEFT JOIN \`agent-space-466318.procurement.procurement_quotes\` q ON qli.quote_id = q.quote_id
LEFT JOIN \`agent-space-466318.procurement.procurement_vendors\` v ON COALESCE(i.vendor_id, q.vendor_id) = v.vendor_id;
"

bq query --use_legacy_sql=false "
CREATE OR REPLACE VIEW procurement.v_po_summary AS
SELECT
    i.po_number,
    v.vendor_name,
    i.job_number,
    COUNT(DISTINCT i.invoice_id) AS invoice_count,
    COUNT(ili.invoice_line_id) AS line_item_count,
    SUM(ili.qty_shipped) AS total_qty_shipped,
    SUM(ili.line_amount) AS total_invoice_amount
FROM \`agent-space-466318.procurement.procurement_invoices\` i
JOIN \`agent-space-466318.procurement.procurement_vendors\` v ON i.vendor_id = v.vendor_id
JOIN \`agent-space-466318.procurement.procurement_invoice_line_items\` ili ON i.invoice_id = ili.invoice_id
GROUP BY i.po_number, v.vendor_name, i.job_number
ORDER BY total_invoice_amount DESC;
"

echo "BigQuery views created"

# ============================================================================
# COMPLETE
# ============================================================================
echo ""
echo "============================================================"
echo "GCP INFRASTRUCTURE SETUP COMPLETE"
echo "============================================================"
echo ""
echo "RESOURCES CREATED:"
echo "  Cloud Storage:    gs://agent-space-466318-procurement-docs"
echo "  Cloud SQL:        procurement-db (agent-space-466318:us-west1:procurement-db)"
echo "  BigQuery:         agent-space-466318:procurement"
echo "  Datastream:       procurement-stream"
echo ""
echo "BIGQUERY VIEWS:"
echo "  - v_item_catalog         (Requirement 1)"
echo "  - v_quote_vs_invoice     (Requirement 2a)"
echo "  - v_po_summary           (Requirement 2b)"
echo ""
echo "NEXT STEPS:"
echo "  1. Configure Gemini Enterprise Agentspace data store"
echo "  2. Set up Document AI for PDF extraction"
echo "  3. Create Cloud Function for Box -> PostgreSQL pipeline"
echo ""
echo "GEMINI AGENTSPACE SETUP:"
echo "  1. Go to: https://console.cloud.google.com/gen-app-builder"
echo "  2. Create App -> Agentspace"
echo "  3. Add Data Store -> BigQuery -> agent-space-466318:procurement"
echo "  4. Sync tables and connect to agent"
echo ""
echo "============================================================"
