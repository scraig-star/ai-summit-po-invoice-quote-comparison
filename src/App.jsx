import { useState, useRef, useEffect, useCallback } from 'react';
import accoLogo from './assets/acco-logo.png';
import {
  FileText, Upload, TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
  Search, ChevronDown, ChevronRight, DollarSign, Package,
  ClipboardList, BarChart3, X, Clock, Cloud, Database,
  Settings, CheckCircle2, XCircle, Loader, CloudUpload, FolderOpen,
  Filter, RefreshCw
} from 'lucide-react';

const NAVY = '#084C7C'; // ACCO brand blue
const GREEN = '#7DB928';

const fmt$ = (v) => `$${Math.abs(parseFloat(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

// Normalize PO numbers — strip document-extraction prefixes like "OI-", "PO-", "P.O." before digits
// so "OI-230751" and "230751" merge into the same PO group.
const normalizePONumber = (raw) => {
  if (!raw || raw === '(No PO)') return raw;
  // Match an alpha/dot prefix (optionally followed by hyphen/space) before the numeric portion
  const match = raw.trim().match(/^[A-Z.\s]+-?\s*(\d[\w-]*)$/i);
  return match ? match[1].trim() : raw.trim();
};

// Normalize raw vendor names (e.g. "FERGUSON ENTERPRISES LLC" → "Ferguson")
const normalizeVendor = (raw) => {
  if (!raw || raw.toLowerCase() === 'unknown') return 'Unknown';
  const suffixes = /\b(LLC|INC\.?|CORP\.?|CO\.?|LTD\.?|ENTERPRISES?|ENTERPRISE|COMPANY|HOLDINGS?|GROUP|SUPPLY|CORPORATION|ASSOCIATES?|ASSOC\.?|INDUSTRIES)\b\.?/gi;
  const cleaned = raw.replace(suffixes, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return raw;
  return cleaned.split(' ').map(w => {
    if (w.length <= 3) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
};

export default function ProcurementApp() {
  // ── Data ──────────────────────────────────────────────────────────────────────
  const [invoices, setInvoices] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [comparisonData, setComparisonData] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  // ── Filters ───────────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState({ vendor: '', poNumber: '', invoiceNumber: '', jobNumber: '', dateFrom: '', dateTo: '' });
  const [activeFilters, setActiveFilters] = useState({});
  const [itemSearch, setItemSearch] = useState('');

  // ── UI ────────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('po-overview');
  const [cmpSearch, setCmpSearch] = useState('');
  const [expandedPOs, setExpandedPOs] = useState(new Set());
  const [expandedInvoices, setExpandedInvoices] = useState(new Set());
  const [showSettings, setShowSettings] = useState(false);

  // ── Upload ────────────────────────────────────────────────────────────────────
  const [cloudConfig, setCloudConfig] = useState({
    bucketName: 'agent-space-466318-procurement-docs',
    bigQueryDataset: 'agent-space-466318:procurement',
    apiEndpoint: 'https://procurement-api-131631609347.us-west1.run.app',
  });
  const [connectionStatus, setConnectionStatus] = useState({ gcs: null, bq: null, testing: false });
  const [uploadQueue, setUploadQueue] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [cloudDocType, setCloudDocType] = useState('invoice');
  const fileInputRef = useRef(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────────
  const fetchLiveData = useCallback(async (endpoint) => {
    if (!endpoint?.trim()) return;
    setDataLoading(true);
    try {
      const [invRes, qRes, cmpRes] = await Promise.all([
        fetch(`${endpoint}/api/invoices`),
        fetch(`${endpoint}/api/quotes`),
        fetch(`${endpoint}/api/comparison`),
      ]);
      if (invRes.ok) {
        const data = await invRes.json();
        setInvoices(data.map(inv => ({
          ...inv,
          total: parseFloat(inv.total || 0),
          lineItems: (Array.isArray(inv.lineItems) ? inv.lineItems : []).map(li => ({
            ...li,
            qtyOrdered: parseInt(li.qtyOrdered || li.qtyShipped || 0),
            qtyShipped: parseInt(li.qtyShipped || 0),
            unitPrice:  parseFloat(li.unitPrice || 0),
            amount:     parseFloat(li.amount || 0),
          })),
        })));
      }
      if (qRes.ok) {
        const data = await qRes.json();
        setQuotes(data.map(q => ({
          ...q,
          total: parseFloat(q.total || 0),
          lineItems: (Array.isArray(q.lineItems) ? q.lineItems : []).map(li => ({
            ...li,
            qty:      parseInt(li.qty || 0),
            netPrice: parseFloat(li.netPrice || 0),
            total:    parseFloat(li.total || 0),
          })),
        })));
      }
      if (cmpRes.ok) {
        const data = await cmpRes.json();
        setComparisonData(data.map(item => ({
          ...item,
          quotedPrice:  parseFloat(item.quotedPrice || 0),
          invoicePrice: item.invoicePrice != null ? parseFloat(item.invoicePrice) : null,
          variance:     item.variance != null ? parseFloat(item.variance) : null,
        })));
      }
      setDataLoaded(true);
    } catch (e) {
      console.warn('Live data fetch failed:', e.message);
      setDataLoaded(true);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cloudConfig.apiEndpoint?.trim()) fetchLiveData(cloudConfig.apiEndpoint);
  }, [cloudConfig.apiEndpoint, fetchLiveData]);

  // ── Derived data ──────────────────────────────────────────────────────────────
  const filteredInvoices = invoices.filter(inv => {
    if (activeFilters.vendor         && !inv.vendor?.toLowerCase().includes(activeFilters.vendor.toLowerCase()))               return false;
    // Match against both the raw and normalized PO number so "OI-230751" matches a search for "230751"
    if (activeFilters.poNumber) {
      const q = activeFilters.poNumber.toLowerCase();
      const rawMatch  = inv.poNumber?.toLowerCase().includes(q);
      const normMatch = normalizePONumber(inv.poNumber)?.toLowerCase().includes(q);
      if (!rawMatch && !normMatch) return false;
    }
    if (activeFilters.invoiceNumber  && !inv.invoiceNumber?.toLowerCase().includes(activeFilters.invoiceNumber.toLowerCase())) return false;
    if (activeFilters.jobNumber      && !inv.jobNumber?.toLowerCase().includes(activeFilters.jobNumber.toLowerCase()))         return false;
    if (activeFilters.dateFrom       && inv.invoiceDate < activeFilters.dateFrom) return false;
    if (activeFilters.dateTo         && inv.invoiceDate > activeFilters.dateTo)   return false;
    return true;
  });

  // Lookup map: UPPER(item_number) → comparison record (quoted price, quote#, vendor, status)
  const compMap = comparisonData.reduce((acc, item) => {
    if (item.itemNumber) acc[item.itemNumber.toUpperCase().trim()] = item;
    return acc;
  }, {});

  // Vendor lookup from comparison data when invoice vendor is unknown
  const vendorByInvoiceNum = comparisonData.reduce((acc, item) => {
    if (item.invoiceNumber && item.vendor && item.vendor.toLowerCase() !== 'unknown') {
      acc[item.invoiceNumber.trim()] = item.vendor;
    }
    return acc;
  }, {});

  const poGroups = filteredInvoices.reduce((acc, inv) => {
    // Normalize PO number so "OI-230751" and "230751" group together
    const key = normalizePONumber(inv.poNumber) || '(No PO)';

    // Resolve vendor: invoice → comparison data by invoice# → line-item compMap → fallback
    let rawVendor = (inv.vendor && inv.vendor.toLowerCase() !== 'unknown')
      ? inv.vendor
      : (vendorByInvoiceNum[inv.invoiceNumber?.trim()] || '');
    if (!rawVendor) {
      // Try to find vendor from any matched line item in compMap
      rawVendor = inv.lineItems
        .map(li => compMap[li.itemNumber?.toUpperCase().trim()]?.vendor)
        .find(v => v && v.toLowerCase() !== 'unknown') || '';
    }
    const displayVendor = normalizeVendor(rawVendor) || 'Unknown';

    // Only include items that have BOTH an invoice price and a quoted price.
    // This keeps the comparison apples-to-apples and prevents a misleading
    // variance when most items are unmatched.
    // Use li.amount as the matched basis and scale the quoted side by the
    // unit-price ratio — this absorbs UoM multipliers (e.g. "C" = per 100)
    // that are already baked into the line amount.
    let invQuotedTotal = 0, invMatchedAmount = 0;
    inv.lineItems.forEach(li => {
      const cmp = compMap[li.itemNumber?.toUpperCase().trim()];
      const amt = parseFloat(li.amount) || 0;
      if (cmp?.quotedPrice > 0 && li.unitPrice > 0 && amt !== 0) {
        invMatchedAmount += amt;
        invQuotedTotal   += amt * (cmp.quotedPrice / li.unitPrice);
      }
    });

    if (!acc[key]) {
      acc[key] = { poNumber: key, vendor: displayVendor, rawVendor, invoices: [], jobs: new Set(), totalAmount: 0, quotedTotal: 0, matchedAmount: 0 };
    } else if (!acc[key].rawVendor && rawVendor) {
      // Enrich vendor if we found better data from a later invoice
      acc[key].rawVendor = rawVendor;
      acc[key].vendor = displayVendor;
    }
    acc[key].invoices.push({ ...inv, quotedTotal: invQuotedTotal, matchedAmount: invMatchedAmount });
    if (inv.jobNumber) acc[key].jobs.add(inv.jobNumber);
    acc[key].totalAmount  += parseFloat(inv.total || 0);
    acc[key].quotedTotal  += invQuotedTotal;
    acc[key].matchedAmount += invMatchedAmount;
    return acc;
  }, {});

  const totalInvoiceAmount = filteredInvoices.reduce((s, i) => s + parseFloat(i.total || 0), 0);
  const overQuoteItems = comparisonData.filter(c => c.status === 'OVER_QUOTE').length;
  const hasActiveFilters = Object.values(activeFilters).some(v => v);

  const applyFilters = () => setActiveFilters({ ...filters });
  const clearFilters = () => { setFilters({ vendor: '', poNumber: '', invoiceNumber: '', jobNumber: '', dateFrom: '', dateTo: '' }); setActiveFilters({}); };

  // ── Upload handlers ───────────────────────────────────────────────────────────
  const handleTestConnection = async () => {
    setConnectionStatus({ gcs: null, bq: null, testing: true });
    const endpoint = cloudConfig.apiEndpoint.trim();
    if (!endpoint) { setConnectionStatus({ gcs: 'demo', bq: 'demo', testing: false }); return; }
    try {
      const res = await fetch(`${endpoint}/health`);
      const data = await res.json();
      setConnectionStatus({
        gcs: data.checks?.gcs === 'connected' ? 'connected' : 'error',
        bq:  data.checks?.db  === 'connected' ? 'connected' : 'error',
        testing: false,
      });
    } catch (err) {
      setConnectionStatus({ gcs: 'error', bq: 'error', testing: false });
    }
  };

  const processUpload = (file) => {
    const id = `${Date.now()}-${Math.random()}`;
    setUploadQueue(prev => [...prev, { id, fileName: file.name, docType: cloudDocType, status: 'uploading', progress: 0, gcPath: null, dbSaved: false, size: file.size }]);
    let progress = 0;
    const tick = setInterval(() => {
      progress = Math.min(progress + Math.random() * 20, 90);
      setUploadQueue(prev => prev.map(item => item.id === id ? { ...item, progress: Math.round(progress) } : item));
      if (progress >= 90) clearInterval(tick);
    }, 200);

    const doUpload = async () => {
      if (cloudConfig.apiEndpoint.trim()) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('docType', cloudDocType);
        const res = await fetch(`${cloudConfig.apiEndpoint}/api/documents/upload`, { method: 'POST', body: formData });
        if (!res.ok) { const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` })); throw new Error(e.error || `HTTP ${res.status}`); }
        return await res.json();
      }
      await new Promise(r => setTimeout(r, 2000));
      return { gcPath: `gs://${cloudConfig.bucketName}/${cloudDocType}/${file.name}`, dbSaved: true };
    };

    doUpload()
      .then(result => {
        clearInterval(tick);
        setUploadQueue(prev => prev.map(item => item.id === id ? { ...item, status: 'processing', progress: 95, gcPath: result.gcPath } : item));
        setTimeout(() => {
          setUploadQueue(prev => prev.map(item => item.id === id ? { ...item, status: result.dbSaved ? 'complete' : 'error', progress: 100, dbSaved: result.dbSaved, errorMessage: result.dbError || null } : item));
          if (cloudConfig.apiEndpoint?.trim()) fetchLiveData(cloudConfig.apiEndpoint);
        }, 1500);
      })
      .catch(err => {
        console.error('Upload error:', err);
        clearInterval(tick);
        setUploadQueue(prev => prev.map(item => item.id === id ? { ...item, status: 'error', progress: 0, errorMessage: err.message } : item));
      });
  };

  const handleDrop = (e) => {
    e.preventDefault(); setIsDragging(false);
    Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf' || f.name.match(/\.(xlsx|xls)$/i)).forEach(processUpload);
  };
  const handleFileInput = (e) => { Array.from(e.target.files).forEach(processUpload); e.target.value = ''; };

  // ── Shared components ─────────────────────────────────────────────────────────
  const StatusBadge = ({ status }) => {
    const s = {
      ACTIVE:           'bg-green-50 text-green-700 border-green-200',
      OPEN:             'bg-blue-50 text-blue-700 border-blue-200',
      PENDING_APPROVAL: 'bg-amber-50 text-amber-700 border-amber-200',
      CREDIT:           'bg-purple-50 text-purple-700 border-purple-200',
      PAID:             'bg-gray-50 text-gray-600 border-gray-200',
      OVER_QUOTE:       'bg-red-50 text-red-700 border-red-200',
      UNDER_QUOTE:      'bg-green-50 text-green-700 border-green-200',
      NOT_INVOICED:     'bg-gray-50 text-gray-500 border-gray-200',
      NOT_QUOTED:       'bg-amber-50 text-amber-600 border-amber-200',
      MATCH:            'bg-sky-50 text-sky-600 border-sky-200',
    }[status] || 'bg-gray-50 text-gray-600 border-gray-200';
    return <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${s}`}>{status.replace(/_/g, ' ')}</span>;
  };

  const SearchPanel = ({ showJobNumber = false }) => (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Filter className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-semibold text-gray-700">Search & Filter</span>
        {hasActiveFilters && (
          <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
            <X className="w-3 h-3" /> Clear all
          </button>
        )}
      </div>
      <div className={`grid gap-3 ${showJobNumber ? 'grid-cols-2 md:grid-cols-6' : 'grid-cols-2 md:grid-cols-5'}`}>
        {[
          { key: 'vendor',        label: 'Vendor',        placeholder: 'e.g. Ferguson' },
          { key: 'poNumber',      label: 'PO Number',     placeholder: 'e.g. 229902' },
          { key: 'invoiceNumber', label: 'Invoice #',     placeholder: 'e.g. 5892077' },
          ...(showJobNumber ? [{ key: 'jobNumber', label: 'Job Number', placeholder: 'e.g. 60140018' }] : []),
          { key: 'dateFrom',      label: 'Date From',     type: 'date' },
          { key: 'dateTo',        label: 'Date To',       type: 'date' },
        ].map(({ key, label, placeholder, type = 'text' }) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
            <input
              type={type}
              placeholder={placeholder}
              value={filters[key]}
              onChange={e => setFilters(f => ({ ...f, [key]: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && applyFilters()}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ '--tw-ring-color': `${NAVY}30` }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button onClick={applyFilters} className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg hover:opacity-90" style={{ backgroundColor: NAVY }}>
          <Search className="w-4 h-4" /> Search
        </button>
        <button onClick={() => fetchLiveData(cloudConfig.apiEndpoint)} disabled={dataLoading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${dataLoading ? 'animate-spin' : ''}`} /> Refresh
        </button>
        {hasActiveFilters && (
          <span className="text-xs text-gray-400 ml-1">{filteredInvoices.length} of {invoices.length} invoices</span>
        )}
      </div>
    </div>
  );

  // ── PO Overview ───────────────────────────────────────────────────────────────
  const POOverview = () => {
    const poList = Object.values(poGroups).sort((a, b) => b.totalAmount - a.totalAmount);
    const togglePO  = (k) => setExpandedPOs(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
    const toggleInv = (k) => setExpandedInvoices(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Purchase Orders', value: poList.length,           icon: ClipboardList, color: NAVY  },
            { label: 'Total Invoices',  value: filteredInvoices.length, icon: FileText,      color: NAVY  },
            { label: 'Invoice Amount',  value: fmt$(totalInvoiceAmount), icon: DollarSign,    color: GREEN },
            { label: 'Over-Quote Items',value: overQuoteItems,           icon: AlertTriangle, color: overQuoteItems > 0 ? '#DC2626' : '#16A34A' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gray-50 flex-shrink-0">
                <Icon className="w-5 h-5" style={{ color }} />
              </div>
              <div>
                <div className="text-xl font-bold text-gray-900">{value}</div>
                <div className="text-xs text-gray-500">{label}</div>
              </div>
            </div>
          ))}
        </div>

        <SearchPanel showJobNumber />

        {dataLoading && (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
            <Loader className="w-8 h-8 text-gray-300 animate-spin mx-auto mb-2" />
            <div className="text-sm text-gray-400">Loading data...</div>
          </div>
        )}

        {!dataLoading && poList.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
            <Search className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <div className="font-semibold text-gray-600 mb-1">
              {dataLoaded ? (hasActiveFilters ? 'No POs match your filters' : 'No invoices yet') : 'Loading...'}
            </div>
            <div className="text-sm text-gray-400">
              {hasActiveFilters ? 'Try adjusting your search criteria.' : 'Upload invoices from the Upload Documents tab to get started.'}
            </div>
            {!hasActiveFilters && (
              <button onClick={() => setActiveTab('upload')} className="mt-4 px-4 py-2 text-sm text-white font-medium rounded-lg hover:opacity-90" style={{ backgroundColor: GREEN }}>
                Upload Documents
              </button>
            )}
          </div>
        )}

        {poList.map(po => {
          // Compare only the matched portion (items with both invoice + quoted price)
          const poVariance = po.quotedTotal > 0 ? po.matchedAmount - po.quotedTotal : null;
          const poVariancePct = po.quotedTotal > 0 ? (poVariance / po.quotedTotal * 100) : null;

          return (
            <div key={po.poNumber} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              {/* ── PO group header ── */}
              <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left" onClick={() => togglePO(po.poNumber)}>
                <div className="flex items-center gap-4">
                  <div className="p-2.5 rounded-lg flex-shrink-0" style={{ backgroundColor: `${NAVY}12` }}>
                    <ClipboardList className="w-5 h-5" style={{ color: NAVY }} />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-gray-900 text-lg">PO {po.poNumber}</span>
                      <span className="text-sm text-gray-400">{po.invoices.length} invoice{po.invoices.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">
                      {po.vendor}{po.rawVendor && po.rawVendor !== po.vendor ? <span className="text-xs text-gray-400 ml-1">({po.rawVendor})</span> : ''}
                      {po.jobs.size > 0 ? ` · Jobs: ${Array.from(po.jobs).join(', ')}` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-5">
                  {/* Quoted total */}
                  {po.quotedTotal > 0 && (
                    <div className="text-right hidden sm:block">
                      <div className="text-sm font-semibold text-gray-500">{fmt$(po.quotedTotal)}</div>
                      <div className="text-xs text-gray-400">quoted</div>
                    </div>
                  )}
                  {/* Invoiced total */}
                  <div className="text-right">
                    <div className={`font-bold text-xl ${po.totalAmount < 0 ? 'text-purple-600' : 'text-gray-900'}`}>
                      {po.totalAmount < 0 ? '-' : ''}{fmt$(po.totalAmount)}
                    </div>
                    <div className="text-xs text-gray-400">invoiced</div>
                  </div>
                  {/* Variance */}
                  {poVariance !== null && (
                    <div className="text-right hidden md:block">
                      <div className={`text-sm font-semibold ${poVariance > 0.01 ? 'text-red-600' : poVariance < -0.01 ? 'text-green-600' : 'text-gray-400'}`}>
                        {poVariance > 0 ? '+' : poVariance < 0 ? '−' : ''}{fmt$(poVariance)}
                      </div>
                      <div className={`text-xs ${poVariance > 0.01 ? 'text-red-400' : poVariance < -0.01 ? 'text-green-400' : 'text-gray-300'}`}>
                        {poVariancePct > 0 ? '+' : poVariancePct < 0 ? '−' : ''}{Math.abs(poVariancePct).toFixed(1)}%
                      </div>
                    </div>
                  )}
                  {expandedPOs.has(po.poNumber) ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
                </div>
              </button>

              {/* ── Invoice list ── */}
              {expandedPOs.has(po.poNumber) && (
                <div className="border-t border-gray-100">
                  {po.invoices.map(inv => {
                    const invTotal = parseFloat(inv.total || 0);
                    const invVariance = inv.quotedTotal > 0 && invTotal >= 0 ? inv.matchedAmount - inv.quotedTotal : null;
                    const invVariancePct = invVariance !== null ? (invVariance / inv.quotedTotal * 100) : null;

                    return (
                      <div key={inv.id} className="border-b border-gray-50 last:border-0">
                        <button className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors text-left" onClick={() => toggleInv(inv.id)}>
                          <div className="flex items-center gap-3 pl-10">
                            <FileText className="w-4 h-4 text-gray-300 flex-shrink-0" />
                            <span className="font-medium text-gray-800">{inv.invoiceNumber}</span>
                            <span className="text-xs text-gray-400 hidden sm:inline">{fmtDate(inv.invoiceDate)}</span>
                            {inv.jobNumber && <span className="text-xs text-gray-400 hidden md:inline">Job: {inv.jobNumber}</span>}
                            <StatusBadge status={inv.status} />
                          </div>
                          <div className="flex items-center gap-4">
                            {/* Quoted total for invoice */}
                            {inv.quotedTotal > 0 && (
                              <div className="text-right hidden sm:block">
                                <div className="text-xs text-gray-400">Quoted: {fmt$(inv.quotedTotal)}</div>
                                {invVariance !== null && (
                                  <div className={`text-xs font-medium ${invVariance > 0.01 ? 'text-red-500' : invVariance < -0.01 ? 'text-green-500' : 'text-gray-400'}`}>
                                    {invVariance > 0 ? '+' : invVariance < 0 ? '−' : ''}{fmt$(invVariance)} ({invVariancePct > 0 ? '+' : invVariancePct < 0 ? '−' : ''}{Math.abs(invVariancePct).toFixed(1)}%)
                                  </div>
                                )}
                              </div>
                            )}
                            <div className="text-right">
                              <span className={`font-semibold ${parseFloat(inv.total) < 0 ? 'text-purple-600' : 'text-gray-700'}`}>{fmt$(inv.total)}</span>
                              <div className="text-xs text-gray-400">{inv.lineItems.length} items</div>
                            </div>
                            {expandedInvoices.has(inv.id) ? <ChevronDown className="w-4 h-4 text-gray-300" /> : <ChevronRight className="w-4 h-4 text-gray-300" />}
                          </div>
                        </button>

                        {/* ── Line items ── */}
                        {expandedInvoices.has(inv.id) && (
                          <div className="px-5 pb-4 pt-2 bg-gray-50 pl-20 overflow-x-auto">
                            <table className="w-full text-sm min-w-max">
                              <thead>
                                <tr className="text-left text-xs text-gray-400 uppercase border-b border-gray-200">
                                  <th className="pb-2 font-medium">Item #</th>
                                  <th className="pb-2 font-medium">Description</th>
                                  <th className="pb-2 font-medium text-center">Ord</th>
                                  <th className="pb-2 font-medium text-center">Shp</th>
                                  <th className="pb-2 font-medium">UoM</th>
                                  <th className="pb-2 font-medium">Quote #</th>
                                  <th className="pb-2 font-medium text-right">Invoice $</th>
                                  <th className="pb-2 font-medium text-right">Quoted $</th>
                                  <th className="pb-2 font-medium text-right">Item Var</th>
                                  <th className="pb-2 font-medium text-right">Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {inv.lineItems.map((li, i) => {
                                  const cmp = compMap[li.itemNumber?.toUpperCase().trim()];
                                  const quotedPrice = cmp?.quotedPrice > 0 ? cmp.quotedPrice : null;
                                  const invoicePrice = li.unitPrice > 0 ? li.unitPrice : null;
                                  const variance = quotedPrice && invoicePrice
                                    ? ((invoicePrice - quotedPrice) / quotedPrice * 100)
                                    : null;
                                  return (
                                    <tr key={i} className={`border-b border-gray-100 last:border-0 ${variance > 0.1 ? 'bg-red-50/40' : variance !== null && variance < -0.1 ? 'bg-green-50/40' : ''}`}>
                                      <td className="py-1.5 font-mono text-xs font-semibold">
                                        <button
                                          className="hover:underline focus:outline-none"
                                          style={{ color: NAVY }}
                                          title="View in Quote vs Invoice"
                                          onClick={() => { setCmpSearch(li.itemNumber || ''); setActiveTab('comparison'); }}
                                        >{li.itemNumber}</button>
                                      </td>
                                      <td className="py-1.5 text-gray-600 max-w-xs truncate pr-4">{li.description}</td>
                                      <td className="py-1.5 text-center text-gray-600">{li.qtyOrdered}</td>
                                      <td className="py-1.5 text-center text-gray-600">{li.qtyShipped}</td>
                                      <td className="py-1.5 text-gray-500">{li.uom}</td>
                                      <td className="py-1.5 text-xs text-gray-400">{cmp?.quoteNumber || '—'}</td>
                                      <td className="py-1.5 text-right text-gray-800">{invoicePrice ? `$${invoicePrice.toFixed(3)}` : '—'}</td>
                                      <td className="py-1.5 text-right text-gray-500">{quotedPrice ? `$${quotedPrice.toFixed(3)}` : '—'}</td>
                                      <td className={`py-1.5 text-right font-semibold text-xs ${variance > 0.1 ? 'text-red-600' : variance !== null && variance < -0.1 ? 'text-green-600' : variance !== null ? 'text-gray-400' : 'text-gray-300'}`}>
                                        {variance !== null ? (
                                          <div>
                                            <div>{variance > 0 ? '+' : ''}{variance.toFixed(2)}%</div>
                                            <div className="opacity-70 font-normal">{variance > 0 ? '+' : ''}{fmt$(invoicePrice - quotedPrice)}/unit</div>
                                          </div>
                                        ) : '—'}
                                      </td>
                                      <td className="py-1.5 text-right font-semibold text-gray-900">{fmt$(li.amount)}</td>
                                    </tr>
                                  );
                                })}

                                {/* Totals row — matched columns reflect items with both invoice $ and quoted $ */}
                                {(() => {
                                  const quotedT   = inv.quotedTotal;
                                  const matchedT  = inv.matchedAmount; // invoiced $ for matched items only
                                  const lineTotal = inv.lineItems.reduce((s, li) => s + (parseFloat(li.amount) || 0), 0);
                                  const varT    = quotedT > 0 ? matchedT - quotedT : null;
                                  const varTpct = varT !== null ? (varT / quotedT * 100) : null;
                                  const varSign = varT > 0 ? '+' : varT < 0 ? '−' : '';
                                  const pctSign = varTpct > 0 ? '+' : varTpct < 0 ? '−' : '';
                                  return (
                                    <tr className="border-t-2 border-gray-200 bg-gray-100/60 font-semibold">
                                      <td colSpan={6} className="pt-2 pb-1.5 text-xs text-gray-500 uppercase tracking-wide">Totals</td>
                                      <td className="pt-2 pb-1.5 text-right text-gray-600 text-xs">{matchedT > 0 ? fmt$(matchedT) : '—'}</td>
                                      <td className="pt-2 pb-1.5 text-right text-gray-600 text-xs">{quotedT > 0 ? fmt$(quotedT) : '—'}</td>
                                      <td className={`pt-2 pb-1.5 text-right text-xs font-bold ${varT > 0.01 ? 'text-red-600' : varT !== null && varT < -0.01 ? 'text-green-600' : 'text-gray-400'}`}>
                                        {varT !== null ? (
                                          <div>
                                            <div>{varSign}{fmt$(varT)}</div>
                                            <div className="opacity-70 font-normal">({pctSign}{Math.abs(varTpct).toFixed(1)}%)</div>
                                          </div>
                                        ) : '—'}
                                      </td>
                                      <td className="pt-2 pb-1.5 text-right text-gray-900">{fmt$(lineTotal)}</td>
                                    </tr>
                                  );
                                })()}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Quote vs Invoice — grouped by vendor → quote number ─────────────────────
  const ComparisonTab = () => {
    const [expandedGroups, setExpandedGroups] = useState(new Set());
    const toggleGroup = (key) => setExpandedGroups(prev => {
      const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
    });

    const filtered = comparisonData.filter(item =>
      !cmpSearch ||
      item.itemNumber?.toLowerCase().includes(cmpSearch.toLowerCase()) ||
      item.description?.toLowerCase().includes(cmpSearch.toLowerCase()) ||
      item.quoteNumber?.toLowerCase().includes(cmpSearch.toLowerCase())
    );

    // Group: normalizedVendor → quoteNumber → items[]
    const grouped = {};
    filtered.forEach(item => {
      const vendor = normalizeVendor(item.vendor) || 'Unknown';
      const quote  = item.quoteNumber || 'Unknown Quote';
      if (!grouped[vendor]) grouped[vendor] = {};
      if (!grouped[vendor][quote]) grouped[vendor][quote] = [];
      grouped[vendor][quote].push(item);
    });
    const vendorEntries = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

    // Summary counts across all filtered items
    const underCount = filtered.filter(c => c.status === 'UNDER_QUOTE').length;
    const overCount  = filtered.filter(c => c.status === 'OVER_QUOTE').length;
    const notCount   = filtered.filter(c => c.status === 'NOT_INVOICED').length;

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Under Quote',  count: underCount, icon: TrendingDown, color: 'text-green-600', border: 'border-green-100', sub: 'Favorable pricing' },
            { label: 'Over Quote',   count: overCount,  icon: TrendingUp,   color: 'text-red-600',   border: 'border-red-100',   sub: 'Requires review' },
            { label: 'Not Invoiced', count: notCount,   icon: Clock,        color: 'text-gray-500',  border: 'border-gray-200',  sub: 'Pending delivery' },
          ].map(({ label, count, icon: Icon, color, border, sub }) => (
            <div key={label} className={`bg-white border ${border} rounded-xl p-5 shadow-sm`}>
              <div className={`flex items-center gap-2 mb-2 ${color}`}><Icon className="w-5 h-5" /><span className="font-semibold text-gray-700">{label}</span></div>
              <div className={`text-3xl font-bold ${color}`}>{count}</div>
              <div className="text-xs text-gray-400 mt-1">{sub}</div>
            </div>
          ))}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search item number, description, or quote..." value={cmpSearch}
              onChange={e => setCmpSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:border-[#084C7C]" />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
            <BarChart3 className="w-10 h-10 text-gray-200 mx-auto mb-2" />
            <div className="text-sm text-gray-400">No comparison data. Upload a quote and invoices to compare pricing.</div>
          </div>
        ) : (
          <div className="space-y-4">
            {vendorEntries.map(([vendor, quoteGroups]) => (
              <div key={vendor} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                {/* Vendor header */}
                <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3" style={{ backgroundColor: `${NAVY}08` }}>
                  <span className="font-bold text-base" style={{ color: NAVY }}>{vendor}</span>
                  <span className="text-xs text-gray-400">
                    {Object.keys(quoteGroups).length} quote{Object.keys(quoteGroups).length !== 1 ? 's' : ''} · {Object.values(quoteGroups).reduce((s, items) => s + items.length, 0)} items
                  </span>
                  {Object.values(quoteGroups).flat().some(i => i.status === 'OVER_QUOTE') && (
                    <span className="ml-auto text-xs font-medium text-red-600 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Over-quote items
                    </span>
                  )}
                </div>

                {/* Quote groups — collapsible */}
                {Object.entries(quoteGroups).sort(([a], [b]) => a.localeCompare(b)).map(([quoteNum, items]) => {
                  const gKey  = `${vendor}::${quoteNum}`;
                  const isOpen = expandedGroups.has(gKey);
                  const overItems = items.filter(i => i.status === 'OVER_QUOTE').length;
                  const invoicedItems = items.filter(i => i.status !== 'NOT_INVOICED').length;

                  return (
                    <div key={quoteNum} className="border-b border-gray-50 last:border-0">
                      {/* Quote subheader — toggle */}
                      <button
                        className="w-full px-5 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-3 hover:bg-gray-100 transition-colors text-left"
                        onClick={() => toggleGroup(gKey)}
                      >
                        {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Quote #{quoteNum}</span>
                        <span className="text-xs text-gray-400">{items.length} items</span>
                        <span className="text-xs text-gray-400">{invoicedItems} invoiced</span>
                        {overItems > 0 && (
                          <span className="text-xs font-semibold text-red-600">{overItems} over-quote</span>
                        )}
                      </button>

                      {isOpen && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-white text-left text-xs text-gray-400 uppercase border-b border-gray-100">
                                <th className="px-4 py-2 font-medium">Item #</th>
                                <th className="px-4 py-2 font-medium">Description</th>
                                <th className="px-4 py-2 font-medium text-right">Quoted $</th>
                                <th className="px-4 py-2 font-medium">Invoice #</th>
                                <th className="px-4 py-2 font-medium text-right">Invoice $</th>
                                <th className="px-4 py-2 font-medium text-right">Variance</th>
                                <th className="px-4 py-2 font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {items.map((item, idx) => (
                                <tr key={idx} className={`hover:bg-gray-50 ${item.status === 'OVER_QUOTE' ? 'bg-red-50/40' : ''}`}>
                                  <td className="px-4 py-2 font-mono text-xs font-semibold" style={{ color: NAVY }}>{item.itemNumber}</td>
                                  <td className="px-4 py-2 text-gray-600 max-w-xs truncate">{item.description}</td>
                                  <td className="px-4 py-2 text-right font-medium text-gray-800">${item.quotedPrice.toFixed(3)}</td>
                                  <td className="px-4 py-2 text-gray-500 text-xs">{item.invoiceNumber || '—'}</td>
                                  <td className="px-4 py-2 text-right text-gray-800">{item.invoicePrice != null ? `$${item.invoicePrice.toFixed(3)}` : '—'}</td>
                                  <td className={`px-4 py-2 text-right font-semibold text-xs ${item.variance > 0 ? 'text-red-600' : item.variance < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                    {item.variance != null && item.invoicePrice != null ? (
                                      <div>
                                        <div>{item.variance > 0 ? '+' : ''}{fmt$(item.invoicePrice - item.quotedPrice)}</div>
                                        <div className="opacity-70 font-normal">{item.variance > 0 ? '+' : ''}{item.variance.toFixed(2)}%</div>
                                      </div>
                                    ) : '—'}
                                  </td>
                                  <td className="px-4 py-2"><StatusBadge status={item.status} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Item Catalog — grouped by vendor → quote number ───────────────────────────
  const ItemCatalogTab = () => {
    const [expandedQuotes, setExpandedQuotes] = useState(new Set());
    const toggleQuote = (key) => setExpandedQuotes(prev => {
      const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
    });

    // Build grouped structure: normalizedVendor → quoteNumber → { items, bidDate, rawVendor }
    const grouped = {};
    quotes.forEach(q => {
      const vendor = normalizeVendor(q.vendor) || 'Unknown';
      const quoteNum = q.bidNumber || 'Unknown Quote';
      if (!grouped[vendor]) grouped[vendor] = {};
      if (!grouped[vendor][quoteNum]) {
        grouped[vendor][quoteNum] = { items: [], bidDate: q.bidDate, rawVendor: q.vendor };
      }
      q.lineItems.forEach(li => {
        if (
          !itemSearch ||
          li.itemNumber?.toLowerCase().includes(itemSearch.toLowerCase()) ||
          li.description?.toLowerCase().includes(itemSearch.toLowerCase())
        ) {
          grouped[vendor][quoteNum].items.push({ ...li, bidNumber: q.bidNumber, bidDate: q.bidDate, vendor: q.vendor });
        }
      });
    });

    const totalItems = quotes.reduce((s, q) => s + q.lineItems.length, 0);
    const vendorEntries = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search items..." value={itemSearch} onChange={e => setItemSearch(e.target.value)}
              className="pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 w-64" />
          </div>
          <button onClick={() => { setCloudDocType('quote'); setActiveTab('upload'); }} className="flex items-center gap-2 px-4 py-2 text-sm text-white font-medium rounded-lg hover:opacity-90" style={{ backgroundColor: GREEN }}>
            <Upload className="w-4 h-4" /> Upload Quote
          </button>
        </div>

        {totalItems === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
            <Package className="w-10 h-10 text-gray-200 mx-auto mb-2" />
            <div className="text-sm text-gray-400">No items yet. Upload a quote to populate the catalog.</div>
          </div>
        ) : (
          <div className="space-y-4">
            {vendorEntries.map(([vendor, quoteGroups]) => (
              <div key={vendor} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                {/* Vendor header */}
                <div className="px-5 py-3 border-b border-gray-100" style={{ backgroundColor: `${NAVY}08` }}>
                  <span className="font-bold text-base" style={{ color: NAVY }}>{vendor}</span>
                  {quoteGroups[Object.keys(quoteGroups)[0]]?.rawVendor && quoteGroups[Object.keys(quoteGroups)[0]].rawVendor !== vendor && (
                    <span className="text-xs text-gray-400 ml-2">({quoteGroups[Object.keys(quoteGroups)[0]].rawVendor})</span>
                  )}
                  <span className="text-xs text-gray-400 ml-3">
                    {Object.keys(quoteGroups).length} quote{Object.keys(quoteGroups).length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Quote groups — collapsible */}
                {Object.entries(quoteGroups).sort(([a], [b]) => a.localeCompare(b)).map(([quoteNum, data]) => {
                  const qKey = `${vendor}::${quoteNum}`;
                  const isOpen = expandedQuotes.has(qKey);
                  return (
                  <div key={quoteNum} className="border-b border-gray-50 last:border-0">
                    {/* Quote subheader — clickable toggle */}
                    <button
                      className="w-full px-5 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-3 hover:bg-gray-100 transition-colors text-left"
                      onClick={() => toggleQuote(qKey)}
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                      <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Quote #{quoteNum}</span>
                      {data.bidDate && <span className="text-xs text-gray-400">{fmtDate(data.bidDate)}</span>}
                      <span className="text-xs text-gray-400">{data.items.length} item{data.items.length !== 1 ? 's' : ''}</span>
                    </button>

                    {isOpen && (
                      data.items.length === 0 ? (
                        <div className="px-5 py-3 text-xs text-gray-400 italic">No items match your search in this quote.</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-400 uppercase border-b border-gray-100">
                                <th className="px-4 py-2 font-medium">Item #</th>
                                <th className="px-4 py-2 font-medium">Description</th>
                                <th className="px-4 py-2 font-medium">UoM</th>
                                <th className="px-4 py-2 font-medium text-right">Unit Price</th>
                                <th className="px-4 py-2 font-medium text-right">Qty</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {data.items.map((item, idx) => (
                                <tr key={idx} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 font-mono text-xs font-semibold" style={{ color: NAVY }}>{item.itemNumber}</td>
                                  <td className="px-4 py-2 text-gray-600 max-w-sm truncate">{item.description}</td>
                                  <td className="px-4 py-2 text-gray-500">{item.uom}</td>
                                  <td className="px-4 py-2 text-right font-semibold text-gray-900">${item.netPrice.toFixed(3)}</td>
                                  <td className="px-4 py-2 text-right text-gray-600">{item.qty}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    )}
                  </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Clear data panel ─────────────────────────────────────────────────────────
  const ClearDataPanel = () => {
    const [clearing, setClearing] = useState(false);
    const [result, setResult] = useState(null);
    const [confirm, setConfirm] = useState(false);

    const doClear = async () => {
      setClearing(true);
      setResult(null);
      try {
        const res = await fetch(`${cloudConfig.apiEndpoint}/api/admin/clear-data`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setResult({ ok: true, data });
        setInvoices([]);
        setQuotes([]);
        setComparisonData([]);
      } catch (e) {
        setResult({ ok: false, error: e.message });
      } finally {
        setClearing(false);
        setConfirm(false);
      }
    };

    return (
      <div className="bg-white border border-red-100 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-700">Data Management</div>
            <div className="text-xs text-gray-400 mt-0.5">Remove all invoices and quotes from the database to start fresh.</div>
          </div>
          {!confirm ? (
            <button onClick={() => setConfirm(true)}
              className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">
              Clear All Data
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600 font-medium">Delete all records?</span>
              <button onClick={doClear} disabled={clearing}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50">
                {clearing ? 'Deleting…' : 'Confirm Delete'}
              </button>
              <button onClick={() => setConfirm(false)} className="px-3 py-1.5 text-sm text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
            </div>
          )}
        </div>
        {result && (
          <div className={`mt-3 text-xs px-3 py-2 rounded-lg ${result.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {result.ok
              ? `Deleted: ${result.data.deleted.invoices} invoices, ${result.data.deleted.invoiceLineItems} line items, ${result.data.deleted.quotes} quotes, ${result.data.deleted.quoteLineItems} quote items.`
              : `Error: ${result.error}`}
          </div>
        )}
      </div>
    );
  };

  // ── Upload tab ────────────────────────────────────────────────────────────────
  const UploadTab = () => {
    const docTypes = [
      { id: 'invoice', label: 'Invoice',        desc: 'PDF or Excel invoices from vendors' },
      { id: 'quote',   label: 'Quote / Bid',     desc: 'Vendor price quotes for comparison' },
      { id: 'po',      label: 'Purchase Order',  desc: 'PO documents for reference' },
    ];
    const statusIcon = (s) => {
      if (s === 'uploading')  return <Loader className="w-4 h-4 text-blue-500 animate-spin" />;
      if (s === 'processing') return <Loader className="w-4 h-4 text-amber-500 animate-spin" />;
      if (s === 'complete')   return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      if (s === 'error')      return <XCircle className="w-4 h-4 text-red-500" />;
      return null;
    };
    const statusLabel = (item) => {
      if (item.status === 'uploading')  return `Uploading… ${item.progress}%`;
      if (item.status === 'processing') return 'Document AI processing…';
      if (item.status === 'complete')   return item.dbSaved ? 'Saved to database' : 'Uploaded to cloud storage';
      if (item.status === 'error')      return item.errorMessage ? `Failed: ${item.errorMessage}` : 'Upload failed';
      return '';
    };
    return (
      <div className="space-y-5">
        {/* Connection */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-5 flex-wrap">
            {[
              { label: 'GCS', icon: Cloud,    key: 'gcs' },
              { label: 'DB',  icon: Database, key: 'bq'  },
            ].map(({ label, icon: Icon, key }) => (
              <div key={key} className="flex items-center gap-2 text-sm text-gray-500">
                <Icon className="w-4 h-4 text-gray-400" />
                <span>{label}</span>
                {connectionStatus[key] && (
                  <span className={`w-2 h-2 rounded-full ${connectionStatus[key] === 'connected' ? 'bg-green-400' : 'bg-red-300'}`} />
                )}
              </div>
            ))}
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={() => setShowSettings(s => !s)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50">
                <Settings className="w-3.5 h-3.5" /> Configure
              </button>
              <button onClick={handleTestConnection} disabled={connectionStatus.testing} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white font-medium rounded-lg hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: NAVY }}>
                {connectionStatus.testing ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                {connectionStatus.testing ? 'Testing…' : 'Test Connection'}
              </button>
            </div>
          </div>
          {showSettings && (
            <div className="mt-4 pt-4 border-t border-gray-100 grid md:grid-cols-3 gap-4">
              {[{ k: 'bucketName', l: 'GCS Bucket' }, { k: 'bigQueryDataset', l: 'BigQuery Dataset' }, { k: 'apiEndpoint', l: 'API Endpoint' }].map(({ k, l }) => (
                <div key={k}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{l}</label>
                  <input value={cloudConfig[k]} onChange={e => setCloudConfig(c => ({ ...c, [k]: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex gap-2">
              {docTypes.map(dt => (
                <button key={dt.id} onClick={() => setCloudDocType(dt.id)}
                  className={`flex-1 px-3 py-3 rounded-xl border text-left transition-all ${cloudDocType === dt.id ? 'border-[#084C7C] bg-[#084C7C]/5' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                  <div className={`text-sm font-semibold ${cloudDocType === dt.id ? 'text-[#084C7C]' : 'text-gray-700'}`}>{dt.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{dt.desc}</div>
                </button>
              ))}
            </div>
            <div onDragOver={e => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${isDragging ? 'border-[#084C7C] bg-[#084C7C]/5' : 'border-gray-300 bg-white hover:border-gray-400'}`}>
              <input ref={fileInputRef} type="file" accept=".pdf,.xlsx,.xls" multiple onChange={handleFileInput} className="hidden" />
              <CloudUpload className={`w-12 h-12 mx-auto mb-3 ${isDragging ? 'text-[#084C7C]' : 'text-gray-300'}`} />
              <div className="font-semibold text-gray-700 mb-1">{isDragging ? 'Release to upload' : 'Drag & drop files here'}</div>
              <div className="text-sm text-gray-400 mb-5">PDF invoices, quotes, or Excel (.xlsx) files</div>
              <span className="inline-flex items-center gap-2 px-5 py-2.5 text-white text-sm font-medium rounded-lg hover:opacity-90" style={{ backgroundColor: GREEN }}>
                <FolderOpen className="w-4 h-4" /> Browse Files
              </span>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
            <h4 className="text-sm font-semibold text-gray-700">Processing Pipeline</h4>
            {[
              { n: '1', l: 'Cloud Storage',  d: 'Stored in GCS bucket',           c: NAVY },
              { n: '2', l: 'Document AI',    d: 'Extract line items & amounts',    c: '#7C3AED' },
              { n: '3', l: 'PostgreSQL',     d: 'Structured data to Cloud SQL',    c: GREEN },
              { n: '4', l: 'BigQuery',       d: 'Datastream sync ~15 min',         c: '#D97706' },
            ].map(s => (
              <div key={s.n} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: s.c }}>{s.n}</div>
                <div><div className="text-sm font-medium text-gray-700">{s.l}</div><div className="text-xs text-gray-400">{s.d}</div></div>
              </div>
            ))}
          </div>
        </div>

        <ClearDataPanel />

        {uploadQueue.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-700">Upload Queue</span>
              <button onClick={() => setUploadQueue(q => q.filter(i => i.status !== 'complete' && i.status !== 'error'))} className="text-xs text-gray-400 hover:text-gray-600">Clear completed</button>
            </div>
            <div className="divide-y divide-gray-100">
              {[...uploadQueue].reverse().map(item => (
                <div key={item.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-shrink-0">{statusIcon(item.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{item.fileName}</div>
                    {item.status === 'uploading' ? (
                      <div className="mt-1 h-1.5 bg-gray-100 rounded-full"><div className="h-1.5 rounded-full bg-blue-400 transition-all" style={{ width: `${item.progress}%` }} /></div>
                    ) : (
                      <div className={`text-xs mt-0.5 ${item.status === 'error' ? 'text-red-500' : item.status === 'processing' ? 'text-amber-500' : 'text-gray-400'}`}>{statusLabel(item)}</div>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">{(item.size / 1024).toFixed(1)} KB</div>
                  <button onClick={() => setUploadQueue(q => q.filter(i => i.id !== item.id))} className="text-gray-300 hover:text-gray-500"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  const tabs = [
    { id: 'po-overview', label: 'PO Overview',     icon: ClipboardList },
    { id: 'comparison',  label: 'Quote vs Invoice', icon: TrendingUp    },
    { id: 'catalog',     label: 'Item Catalog',     icon: Package       },
    { id: 'upload',      label: 'Upload Documents', icon: CloudUpload   },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 shadow-md" style={{ backgroundColor: NAVY }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <div className="bg-white rounded-md px-2 py-1">
                <img src={accoLogo} alt="ACCO Engineered Systems" className="h-8 w-auto" />
              </div>
              <div className="border-l border-white/20 pl-4">
                <div className="font-bold text-white tracking-wide">PM COST CONTROL ANALYST</div>
                <div className="text-xs text-blue-200">Quote Comparison System</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {dataLoading && <Loader className="w-4 h-4 text-blue-300 animate-spin" />}
              <button onClick={() => setActiveTab('upload')} className="flex items-center gap-2 px-4 py-2 text-sm text-white font-semibold rounded-lg hover:opacity-90" style={{ backgroundColor: GREEN }}>
                <Upload className="w-4 h-4" /> Upload
              </button>
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <span className="text-sm font-medium text-white">AK</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex -mb-px overflow-x-auto">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  activeTab === tab.id ? 'border-[#7DB928] text-[#084C7C]' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}>
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'po-overview' && <POOverview />}
        {activeTab === 'comparison'  && <ComparisonTab />}
        {activeTab === 'catalog'     && <ItemCatalogTab />}
        {activeTab === 'upload'      && <UploadTab />}
      </main>

      <footer className="border-t border-gray-200 mt-12 py-5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <img src={accoLogo} alt="ACCO" className="h-6 w-auto opacity-40" />
          <span className="text-xs text-gray-400">PM Cost Control Analyst · Google Cloud Platform · AI Summit 2026</span>
        </div>
      </footer>
    </div>
  );
}
