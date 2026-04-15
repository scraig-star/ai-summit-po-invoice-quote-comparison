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
    if (activeFilters.poNumber       && !inv.poNumber?.toLowerCase().includes(activeFilters.poNumber.toLowerCase()))           return false;
    if (activeFilters.invoiceNumber  && !inv.invoiceNumber?.toLowerCase().includes(activeFilters.invoiceNumber.toLowerCase())) return false;
    if (activeFilters.jobNumber      && !inv.jobNumber?.toLowerCase().includes(activeFilters.jobNumber.toLowerCase()))         return false;
    if (activeFilters.dateFrom       && inv.invoiceDate < activeFilters.dateFrom) return false;
    if (activeFilters.dateTo         && inv.invoiceDate > activeFilters.dateTo)   return false;
    return true;
  });

  const poGroups = filteredInvoices.reduce((acc, inv) => {
    const key = inv.poNumber || '(No PO)';
    if (!acc[key]) acc[key] = { poNumber: key, vendor: inv.vendor || 'Unknown', invoices: [], jobs: new Set(), totalAmount: 0 };
    acc[key].invoices.push(inv);
    if (inv.jobNumber) acc[key].jobs.add(inv.jobNumber);
    acc[key].totalAmount += parseFloat(inv.total || 0);
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
            { label: 'Purchase Orders', value: poList.length,         icon: ClipboardList, color: NAVY  },
            { label: 'Total Invoices',  value: filteredInvoices.length, icon: FileText,      color: NAVY  },
            { label: 'Invoice Amount',  value: fmt$(totalInvoiceAmount), icon: DollarSign,    color: GREEN },
            { label: 'Over-Quote Items',value: overQuoteItems,          icon: AlertTriangle,  color: overQuoteItems > 0 ? '#DC2626' : '#16A34A' },
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

        {poList.map(po => (
          <div key={po.poNumber} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left" onClick={() => togglePO(po.poNumber)}>
              <div className="flex items-center gap-4">
                <div className="p-2.5 rounded-lg" style={{ backgroundColor: `${NAVY}12` }}>
                  <ClipboardList className="w-5 h-5" style={{ color: NAVY }} />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-gray-900 text-lg">PO {po.poNumber}</span>
                    <span className="text-sm text-gray-400">{po.invoices.length} invoice{po.invoices.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {po.vendor}{po.jobs.size > 0 ? ` · Jobs: ${Array.from(po.jobs).join(', ')}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className={`font-bold text-xl ${po.totalAmount < 0 ? 'text-purple-600' : 'text-gray-900'}`}>
                    {po.totalAmount < 0 ? '-' : ''}{fmt$(po.totalAmount)}
                  </div>
                  <div className="text-xs text-gray-400">total billed</div>
                </div>
                {expandedPOs.has(po.poNumber) ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
              </div>
            </button>

            {expandedPOs.has(po.poNumber) && (
              <div className="border-t border-gray-100">
                {po.invoices.map(inv => (
                  <div key={inv.id} className="border-b border-gray-50 last:border-0">
                    <button className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors text-left" onClick={() => toggleInv(inv.id)}>
                      <div className="flex items-center gap-3 pl-10">
                        <FileText className="w-4 h-4 text-gray-300 flex-shrink-0" />
                        <span className="font-medium text-gray-800">{inv.invoiceNumber}</span>
                        <span className="text-xs text-gray-400 hidden sm:inline">{fmtDate(inv.invoiceDate)}</span>
                        {inv.jobNumber && <span className="text-xs text-gray-400 hidden md:inline">Job: {inv.jobNumber}</span>}
                        <StatusBadge status={inv.status} />
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-semibold ${parseFloat(inv.total) < 0 ? 'text-purple-600' : 'text-gray-700'}`}>{fmt$(inv.total)}</span>
                        <span className="text-xs text-gray-400">{inv.lineItems.length} items</span>
                        {expandedInvoices.has(inv.id) ? <ChevronDown className="w-4 h-4 text-gray-300" /> : <ChevronRight className="w-4 h-4 text-gray-300" />}
                      </div>
                    </button>
                    {expandedInvoices.has(inv.id) && (
                      <div className="px-5 pb-4 pt-2 bg-gray-50 pl-20">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-gray-400 uppercase border-b border-gray-200">
                              <th className="pb-2 font-medium">Item #</th>
                              <th className="pb-2 font-medium">Description</th>
                              <th className="pb-2 font-medium text-center">Ord</th>
                              <th className="pb-2 font-medium text-center">Shp</th>
                              <th className="pb-2 font-medium">UoM</th>
                              <th className="pb-2 font-medium text-right">Unit $</th>
                              <th className="pb-2 font-medium text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inv.lineItems.map((li, i) => (
                              <tr key={i} className="border-b border-gray-100 last:border-0">
                                <td className="py-1.5 font-mono text-xs font-semibold" style={{ color: NAVY }}>{li.itemNumber}</td>
                                <td className="py-1.5 text-gray-600 max-w-xs truncate pr-4">{li.description}</td>
                                <td className="py-1.5 text-center text-gray-600">{li.qtyOrdered}</td>
                                <td className="py-1.5 text-center text-gray-600">{li.qtyShipped}</td>
                                <td className="py-1.5 text-gray-500">{li.uom}</td>
                                <td className="py-1.5 text-right text-gray-700">${li.unitPrice.toFixed(3)}</td>
                                <td className="py-1.5 text-right font-semibold text-gray-900">${li.amount.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  // ── Invoices tab ──────────────────────────────────────────────────────────────
  const InvoicesTab = () => {
    const toggleInv = (k) => setExpandedInvoices(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
    return (
      <div className="space-y-5">
        <SearchPanel showJobNumber />
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">{filteredInvoices.length} invoices · {fmt$(totalInvoiceAmount)} total</p>
          <button onClick={() => { setCloudDocType('invoice'); setActiveTab('upload'); }} className="flex items-center gap-2 px-4 py-2 text-sm text-white font-medium rounded-lg hover:opacity-90" style={{ backgroundColor: GREEN }}>
            <Upload className="w-4 h-4" /> Upload Invoice
          </button>
        </div>
        {filteredInvoices.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center shadow-sm">
            <FileText className="w-10 h-10 text-gray-200 mx-auto mb-2" />
            <div className="text-sm text-gray-400">No invoices found. Adjust filters or upload invoices.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredInvoices.map(inv => (
              <div key={inv.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <button className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left" onClick={() => toggleInv(inv.id)}>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-gray-100"><FileText className="w-4 h-4 text-gray-400" /></div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{inv.invoiceNumber}</span>
                        <StatusBadge status={inv.status} />
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">PO: {inv.poNumber} · Job: {inv.jobNumber || '—'} · {fmtDate(inv.invoiceDate)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className={`font-bold ${parseFloat(inv.total) < 0 ? 'text-purple-600' : 'text-gray-900'}`}>{fmt$(inv.total)}</div>
                      <div className="text-xs text-gray-400">{inv.lineItems.length} items</div>
                    </div>
                    {expandedInvoices.has(inv.id) ? <ChevronDown className="w-5 h-5 text-gray-300" /> : <ChevronRight className="w-5 h-5 text-gray-300" />}
                  </div>
                </button>
                {expandedInvoices.has(inv.id) && (
                  <div className="border-t border-gray-100 p-4 bg-gray-50">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-400 uppercase border-b border-gray-100 pb-2">
                          <th className="pb-2 font-medium">Item #</th><th className="pb-2 font-medium">Description</th>
                          <th className="pb-2 font-medium text-center">Ord</th><th className="pb-2 font-medium text-center">Shp</th>
                          <th className="pb-2 font-medium">UoM</th><th className="pb-2 font-medium text-right">Unit $</th><th className="pb-2 font-medium text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.lineItems.map((li, i) => (
                          <tr key={i} className="border-b border-gray-50 last:border-0">
                            <td className="py-2 font-mono text-xs font-semibold" style={{ color: NAVY }}>{li.itemNumber}</td>
                            <td className="py-2 text-gray-600 max-w-xs truncate pr-4">{li.description}</td>
                            <td className="py-2 text-center text-gray-600">{li.qtyOrdered}</td>
                            <td className="py-2 text-center text-gray-600">{li.qtyShipped}</td>
                            <td className="py-2 text-gray-500">{li.uom}</td>
                            <td className="py-2 text-right text-gray-700">${li.unitPrice.toFixed(3)}</td>
                            <td className="py-2 text-right font-semibold text-gray-900">${li.amount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Quote vs Invoice ──────────────────────────────────────────────────────────
  const ComparisonTab = () => {
    const [cmpSearch, setCmpSearch] = useState('');
    const filtered = comparisonData.filter(item =>
      !cmpSearch ||
      item.itemNumber?.toLowerCase().includes(cmpSearch.toLowerCase()) ||
      item.description?.toLowerCase().includes(cmpSearch.toLowerCase()) ||
      item.quoteNumber?.toLowerCase().includes(cmpSearch.toLowerCase())
    );
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Under Quote', count: filtered.filter(c => c.status === 'UNDER_QUOTE').length, icon: TrendingDown, color: 'text-green-600', border: 'border-green-100', sub: 'Favorable pricing' },
            { label: 'Over Quote',  count: filtered.filter(c => c.status === 'OVER_QUOTE').length,  icon: TrendingUp,   color: 'text-red-600',   border: 'border-red-100',   sub: 'Requires review' },
            { label: 'Not Invoiced',count: filtered.filter(c => c.status === 'NOT_INVOICED').length, icon: Clock,        color: 'text-gray-500',  border: 'border-gray-200',  sub: 'Pending delivery' },
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

        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center">
              <BarChart3 className="w-10 h-10 text-gray-200 mx-auto mb-2" />
              <div className="text-sm text-gray-400">No comparison data. Upload a quote and invoices to compare pricing.</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                    <th className="px-4 py-3 font-medium">Item #</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Vendor</th>
                    <th className="px-4 py-3 font-medium">Quote #</th>
                    <th className="px-4 py-3 font-medium text-right">Quoted $</th>
                    <th className="px-4 py-3 font-medium">Invoice #</th>
                    <th className="px-4 py-3 font-medium text-right">Invoice $</th>
                    <th className="px-4 py-3 font-medium text-right">Variance</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((item, idx) => (
                    <tr key={idx} className={`hover:bg-gray-50 ${item.status === 'OVER_QUOTE' ? 'bg-red-50/40' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs font-semibold" style={{ color: NAVY }}>{item.itemNumber}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{item.description}</td>
                      <td className="px-4 py-3 text-gray-700">{item.vendor}</td>
                      <td className="px-4 py-3 text-gray-500">{item.quoteNumber}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-800">${item.quotedPrice.toFixed(3)}</td>
                      <td className="px-4 py-3 text-gray-500">{item.invoiceNumber || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{item.invoicePrice != null ? `$${item.invoicePrice.toFixed(3)}` : '—'}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${item.variance > 0 ? 'text-red-600' : item.variance < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                        {item.variance != null ? `${item.variance > 0 ? '+' : ''}${item.variance.toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Item Catalog ──────────────────────────────────────────────────────────────
  const ItemCatalogTab = () => {
    const allItems = quotes.flatMap(q => q.lineItems.map(li => ({ ...li, bidNumber: q.bidNumber, bidDate: q.bidDate, vendor: q.vendor })));
    const filtered = allItems.filter(item =>
      !itemSearch ||
      item.itemNumber?.toLowerCase().includes(itemSearch.toLowerCase()) ||
      item.description?.toLowerCase().includes(itemSearch.toLowerCase())
    );
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
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                  <th className="px-4 py-3 font-medium">Item #</th>
                  <th className="px-4 py-3 font-medium">Vendor</th>
                  <th className="px-4 py-3 font-medium">Quote #</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">UoM</th>
                  <th className="px-4 py-3 font-medium text-right">Unit Price</th>
                  <th className="px-4 py-3 font-medium text-right">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">
                    {allItems.length === 0 ? 'No items yet. Upload a quote to populate the catalog.' : 'No items match your search.'}
                  </td></tr>
                ) : filtered.map((item, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold" style={{ color: NAVY }}>{item.itemNumber}</td>
                    <td className="px-4 py-3 text-gray-700">{item.vendor}</td>
                    <td className="px-4 py-3 text-gray-500">{item.bidNumber}</td>
                    <td className="px-4 py-3 text-gray-500">{fmtDate(item.bidDate)}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{item.description}</td>
                    <td className="px-4 py-3 text-gray-500">{item.uom}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">${item.netPrice.toFixed(3)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{item.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ── Upload tab ────────────────────────────────────────────────────────────────
  const UploadTab = () => {
    const docTypes = [
      { id: 'invoice', label: 'Invoice',         desc: 'PDF or Excel invoices from vendors' },
      { id: 'quote',   label: 'Quote / Bid',      desc: 'Vendor price quotes for comparison' },
      { id: 'po',      label: 'Purchase Order',   desc: 'PO documents for reference' },
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
              { label: 'GCS', icon: Cloud,     key: 'gcs' },
              { label: 'DB',  icon: Database,  key: 'bq'  },
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
    { id: 'po-overview', label: 'PO Overview',        icon: ClipboardList },
    { id: 'invoices',    label: 'Invoices',            icon: FileText      },
    { id: 'comparison',  label: 'Quote vs Invoice',    icon: TrendingUp    },
    { id: 'catalog',     label: 'Item Catalog',        icon: Package       },
    { id: 'upload',      label: 'Upload Documents',    icon: CloudUpload   },
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
        {activeTab === 'invoices'    && <InvoicesTab />}
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
