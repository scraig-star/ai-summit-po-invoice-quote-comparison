#!/bin/bash
# ============================================================================
# ACCO PROCUREMENT - QUICK START COMMANDS
# Project: agent-space-466318
# ============================================================================

# Set project
gcloud config set project agent-space-466318

# Enable APIs
gcloud services enable sqladmin.googleapis.com datastream.googleapis.com bigquery.googleapis.com storage.googleapis.com documentai.googleapis.com pubsub.googleapis.com

# Create Cloud Storage bucket
gsutil mb -p agent-space-466318 -l us-west1 gs://agent-space-466318-procurement-docs

# Create PostgreSQL instance (5-10 min)
gcloud sql instances create procurement-db \
  --database-version=POSTGRES_15 \
  --tier=db-custom-2-4096 \
  --region=us-west1 \
  --storage-size=20 \
  --storage-type=SSD \
  --storage-auto-increase \
  --availability-type=ZONAL \
  --database-flags=cloudsql.logical_decoding=on \
  --root-password="YOUR_SECURE_PASSWORD"

# Create database
gcloud sql databases create procurement --instance=procurement-db

# Create users
gcloud sql users create procurement_admin --instance=procurement-db --password="YOUR_SECURE_PASSWORD"
gcloud sql users create datastream_user --instance=procurement-db --password="YOUR_DATASTREAM_PASSWORD"

# Create BigQuery dataset
bq --location=US mk --dataset --description="Procurement Quote Comparison" agent-space-466318:procurement

# Get PostgreSQL IP for Datastream
gcloud sql instances describe procurement-db --format='value(ipAddresses[0].ipAddress)'

# Create Datastream connection profiles
gcloud datastream connection-profiles create postgres-procurement-source \
  --location=us-west1 \
  --type=postgresql \
  --postgresql-hostname=<POSTGRES_IP_FROM_ABOVE> \
  --postgresql-port=5432 \
  --postgresql-username=datastream_user \
  --postgresql-password="YOUR_DATASTREAM_PASSWORD" \
  --postgresql-database=procurement \
  --display-name="PostgreSQL Procurement Source"

gcloud datastream connection-profiles create bigquery-procurement-dest \
  --location=us-west1 \
  --type=bigquery \
  --display-name="BigQuery Procurement Destination"

# Create and start Datastream (after PostgreSQL schema is set up)
gcloud datastream streams create procurement-stream \
  --location=us-west1 \
  --source=postgres-procurement-source \
  --postgresql-source-config='{"includeObjects":{"postgresqlSchemas":[{"schema":"procurement","postgresqlTables":[{"table":"vendors"},{"table":"quotes"},{"table":"quote_line_items"},{"table":"invoices"},{"table":"invoice_items"}]}]},"replicationSlot":"datastream_slot","publication":"datastream_publication"}' \
  --destination=bigquery-procurement-dest \
  --bigquery-destination-config='{"dataFreshness":"900s","singleTargetDataset":{"datasetId":"agent-space-466318:procurement"}}' \
  --display-name="Procurement CDC Stream" \
  --backfill-all

# Start stream
gcloud datastream streams update procurement-stream --location=us-west1 --state=RUNNING

# Verify BigQuery tables
bq ls agent-space-466318:procurement

# Query item catalog
bq query --use_legacy_sql=false 'SELECT * FROM `agent-space-466318.procurement.procurement_vendors` LIMIT 10'
