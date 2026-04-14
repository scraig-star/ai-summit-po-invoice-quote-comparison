import React, { useState, useRef, useEffect, useCallback } from 'react';
import accoLogo from './assets/acco-logo.svg';
import {
  FileText, Upload, TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
  Search, ChevronDown, ChevronRight, DollarSign, Package,
  Building2, ClipboardList, BarChart3, X, Clock, Cloud, Database,
  Settings, CheckCircle2, XCircle, Loader, CloudUpload, FolderOpen
} from 'lucide-react';

// ============================================================================
// SAMPLE DATA
// ============================================================================
const initialQuotes = [
  {
    id: 'Q001', bidNumber: 'B818577', bidDate: '2026-04-06', vendor: 'Ferguson Enterprises',
    vendorCode: '794', jobName: 'SWITCH LAS 17 EVO DC', quotedBy: 'KWS', total: 5155.45,
    status: 'ACTIVE', lineItems: [
      { itemNumber: 'C9J', description: '1-1/2 WROT CXC 90 ELL 1-5/8 OD', qty: 25, netPrice: 7.700, uom: 'EA', total: 192.50 },
      { itemNumber: 'CS9J', description: '1-1/2 WROT FTGXC ST 90 ELL', qty: 6, netPrice: 9.866, uom: 'EA', total: 59.20 },
      { itemNumber: 'GLHARDJ20', description: '1-1/2 X 20 L HARD COP TUBE', qty: 200, netPrice: 1318.86, uom: 'C', total: 2637.72 },
      { itemNumber: 'C9G', description: '1 WROT CXC 90 ELL 1-1/8 OD', qty: 30, netPrice: 3.334, uom: 'EA', total: 100.02 },
      { itemNumber: 'MAQ17861C', description: '1/2 BV W/ ACC', qty: 10, netPrice: 76.958, uom: 'EA', total: 769.58 },
      { itemNumber: 'CBCLT9C', description: '3/8 WROT CXC LT 90 ELL CB', qty: 50, netPrice: 3.549, uom: 'EA', total: 177.45 },
      { itemNumber: 'FNWCSG2Z381', description: '3/8X1 HHCS GR 2 ZN 25PK 16TPI', qty: 4, netPrice: 3.940, uom: 'PK', total: 15.76 },
      { itemNumber: 'FNWHNG2Z38', description: '3/8 HEX NUT ZN A563 GR 2 50PK', qty: 6, netPrice: 2.842, uom: 'PK', total: 17.05 },
    ]
  },
];

const initialInvoices = [
  { id: 'INV001', invoiceNumber: '5892077', invoiceDate: '2026-04-02', vendor: 'Ferguson Enterprises', poNumber: '229902', jobNumber: '60140017', total: 77.86, status: 'OPEN', lineItems: [{ itemNumber: 'IBRLF9F', description: 'LF 3/4 BRS 90 ELL', qtyOrdered: 12, qtyShipped: 12, unitPrice: 6.488, uom: 'EA', amount: 77.86 }] },
  { id: 'INV002', invoiceNumber: '5855105-4', invoiceDate: '2026-04-07', vendor: 'Ferguson Enterprises', poNumber: '229902', jobNumber: '60140017', total: 248.14, status: 'OPEN', lineItems: [{ itemNumber: 'FNW7854Z', description: '3-1/2 DOM EG 4H SQ DBL POST BASE', qtyOrdered: 8, qtyShipped: 8, unitPrice: 31.018, uom: 'EA', amount: 248.14 }] },
  { id: 'INV003', invoiceNumber: '5900136', invoiceDate: '2026-04-06', vendor: 'Ferguson Enterprises', poNumber: '229902', jobNumber: '60140018', total: 314.91, status: 'PENDING_APPROVAL', lineItems: [{ itemNumber: 'IBTKKF', description: '2X2X3/4 BLK MI 150# TEE', qtyOrdered: 4, qtyShipped: 4, unitPrice: 19.793, uom: 'EA', amount: 79.17 }, { itemNumber: 'GBRNKP', description: 'LF 2X4 BRS NIP GBL', qtyOrdered: 25, qtyShipped: 10, unitPrice: 23.574, uom: 'EA', amount: 235.74 }] },
  { id: 'INV004', invoiceNumber: '5900495', invoiceDate: '2026-04-07', vendor: 'Ferguson Enterprises', poNumber: '229902', jobNumber: '60140018', total: 303.34, status: 'OPEN', lineItems: [{ itemNumber: 'FNW9304LK', description: '2-1/2 FNST X 2 MNPT SWVL ADPT PIN', qtyOrdered: 2, qtyShipped: 2, unitPrice: 151.670, uom: 'EA', amount: 303.34 }] },
  { id: 'INV005', invoiceNumber: '5886357-2', invoiceDate: '2026-04-08', vendor: 'Ferguson Enterprises', poNumber: '229902', jobNumber: '60140017', total: 1311.95, status: 'OPEN', lineItems: [{ itemNumber: 'GRFBFP', description: '4 CS 150# RF BLND FLG', qtyOrdered: 34, qtyShipped: 34, unitPrice: 29.306, uom: 'EA', amount: 996.40 }, { itemNumber: 'FNWCSG2Z78212', description: '7/8X2-1/2 HHCS GR 2 ZN 2PK 9TPI', qtyOrdered: 75, qtyShipped: 66, unitPrice: 4.781, uom: 'PK', amount: 315.55 }] },
  { id: 'INV006', invoiceNumber: '6624959', invoiceDate: '2026-04-07', vendor: 'Ferguson Enterprises', poNumber: 'OJ-230751', jobNumber: 'VEGAS FAB', total: 1887.60, status: 'OPEN', lineItems: [{ itemNumber: 'N27NCRT12517', description: '4 SDR17 LONG STUB FLG', qtyOrdered: 40, qtyShipped: 40, unitPrice: 47.190, uom: 'EA', amount: 1887.60 }] },
  { id: 'INV007', invoiceNumber: 'CM736456', invoiceDate: '2026-04-08', vendor: 'Ferguson Enterprises', poNumber: 'OJ-230751', jobNumber: '01-A1-02-01-CHW', total: -574.75, status: 'CREDIT', lineItems: [{ itemNumber: 'N27NC4517250MMB', description: '10 SDR17 3PC SEG 45 ELL - CREDIT', qtyOrdered: 2, qtyShipped: 2, unitPrice: 287.375, uom: 'EA', amount: -574.75 }] },
];

const initialComparisonData = [
  { itemNumber: 'FNWCSG2Z381', description: '3/8X1 HHCS GR 2 ZN 25PK', vendor: 'Ferguson', uom: 'PK', quoteNumber: 'B818577', quotedPrice: 3.940, invoiceNumber: '-', invoicePrice: null, variance: null, status: 'NOT_INVOICED' },
  { itemNumber: 'FNWHNG2Z38', description: '3/8 HEX NUT ZN A563 GR 2', vendor: 'Ferguson', uom: 'PK', quoteNumber: 'B818577', quotedPrice: 2.842, invoiceNumber: '-', invoicePrice: null, variance: null, status: 'NOT_INVOICED' },
  { itemNumber: 'MAQ17861C', description: '1/2 BV W/ ACC', vendor: 'Ferguson', uom: 'EA', quoteNumber: 'B818577', quotedPrice: 76.958, invoiceNumber: '-', invoicePrice: null, variance: null, status: 'NOT_INVOICED' },
  { itemNumber: 'FNWCSG2Z78212', description: '7/8X2-1/2 HHCS GR 2 ZN 2PK', vendor: 'Ferguson', uom: 'PK', quoteNumber: '(Simulated)', quotedPrice: 4.50, invoiceNumber: '5886357-2', invoicePrice: 4.781, variance: 6.24, status: 'OVER_QUOTE' },
  { itemNumber: 'GRFBFP', description: '4 CS 150# RF BLND FLG', vendor: 'Ferguson', uom: 'EA', quoteNumber: '(Simulated)', quotedPrice: 28.50, invoiceNumber: '5886357-2', invoicePrice: 29.306, variance: 2.83, status: 'OVER_QUOTE' },
  { itemNumber: 'IBRLF9F', description: 'LF 3/4 BRS 90 ELL', vendor: 'Ferguson', uom: 'EA', quoteNumber: '(Simulated)', quotedPrice: 6.60, invoiceNumber: '5892077', invoicePrice: 6.488, variance: -1.70, status: 'UNDER_QUOTE' },
];

// ============================================================================
// APP
// ============================================================================
export default function ProcurementApp() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [quotes, setQuotes] = useState(initialQuotes);
  const [invoices, setInvoices] = useState(initialInvoices);
  const [comparisonData, setComparisonData] = useState(initialComparisonData);
  const [dataLoading, setDataLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadType, setUploadType] = useState('invoice');

  // Cloud upload state
  const [cloudConfig, setCloudConfig] = useState({
    bucketName: 'agent-space-466318-procurement-docs',
    bigQueryDataset: 'agent-space-466318:procurement',
    apiEndpoint: 'https://procurement-api-131631609347.us-west1.run.app',
    showSettings: false,
  });
  const [connectionStatus, setConnectionStatus] = useState({ gcs: null, bq: null, testing: false });
  const [uploadQueue, setUploadQueue] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [cloudDocType, setCloudDocType] = useState('invoice');
  const fileInputRef = useRef(null);

  // Fetch live data from backend when API endpoint is configured
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
        if (data.length > 0) setInvoices(data.map(inv => ({
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
        if (data.length > 0) setQuotes(data.map(q => ({
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
        if (data.length > 0) setComparisonData(data.map(item => ({
          ...item,
          quotedPrice:  parseFloat(item.quotedPrice || 0),
          invoicePrice: item.invoicePrice != null ? parseFloat(item.invoicePrice) : null,
          variance:     item.variance != null ? parseFloat(item.variance) : null,
        })));
      }
    } catch (e) {
      console.warn('Live data fetch failed, using sample data:', e.message);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cloudConfig.apiEndpoint?.trim()) {
      fetchLiveData(cloudConfig.apiEndpoint);
    }
  }, [cloudConfig.apiEndpoint, fetchLiveData]);

  const totalInvoiceAmount = invoices.reduce((sum, inv) => sum + parseFloat(inv.total || 0), 0);
  const pendingApprovals = invoices.filter(inv => inv.status === 'PENDING_APPROVAL').length;
  const overQuoteItems = comparisonData.filter(c => c.status === 'OVER_QUOTE').length;
  const uniqueItems = new Set(quotes.flatMap(q => q.lineItems.map(li => li.itemNumber))).size;

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'catalog', label: 'Item Catalog', icon: Package },
    { id: 'invoices', label: 'Invoices', icon: FileText },
    { id: 'comparison', label: 'Quote vs Invoice', icon: TrendingUp },
    { id: 'summary', label: 'PO Summary', icon: ClipboardList },
    { id: 'documents', label: 'Cloud Documents', icon: Cloud },
  ];

  // ============================================================================
  // SHARED COMPONENTS
  // ============================================================================
  const StatusBadge = ({ status }) => {
    const styles = {
      ACTIVE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      OPEN: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      PENDING_APPROVAL: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      CREDIT: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
      PAID: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
      OVER_QUOTE: 'bg-red-500/20 text-red-300 border-red-500/30',
      UNDER_QUOTE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      NOT_INVOICED: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
      MATCH: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    };
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded border ${styles[status] || styles.OPEN}`}>
        {status.replace(/_/g, ' ')}
      </span>
    );
  };

  const MetricCard = ({ title, value, subtitle, icon: Icon, trend, trendUp }) => (
    <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-5 hover:border-slate-600/50 transition-all">
      <div className="flex justify-between items-start mb-3">
        <div className="p-2 bg-slate-700/50 rounded-lg">
          <Icon className="w-5 h-5 text-slate-400" />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trendUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {trendUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      <div className="text-sm text-slate-400">{title}</div>
      {subtitle && <div className="text-xs text-slate-500 mt-1">{subtitle}</div>}
    </div>
  );

  // ============================================================================
  // DASHBOARD
  // ============================================================================
  const Dashboard = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white">Procurement Dashboard</h2>
          <p className="text-slate-400 text-sm mt-1">
            {dataLoading ? <span className="text-blue-400">Loading live data...</span> : 'Use Case #88: Quote Comparison Overview'}
          </p>
        </div>
        <button
          onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
        >
          <Upload className="w-4 h-4" />
          Upload Document
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Invoice Amount" value={`$${totalInvoiceAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} subtitle="Across all POs" icon={DollarSign} trend="+12.3%" trendUp={true} />
        <MetricCard title="Items in Catalog" value={uniqueItems} subtitle="From quotes/bids" icon={Package} />
        <MetricCard title="Pending Approvals" value={pendingApprovals} subtitle="Within 30-day window" icon={Clock} trend={pendingApprovals > 0 ? "Action needed" : null} trendUp={false} />
        <MetricCard title="Over Quote Items" value={overQuoteItems} subtitle="Requires review" icon={AlertTriangle} trend={overQuoteItems > 0 ? `${overQuoteItems} items` : null} trendUp={false} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-white">Recent Invoices</h3>
            <button onClick={() => setActiveTab('invoices')} className="text-sm text-blue-400 hover:text-blue-300">View All →</button>
          </div>
          <div className="space-y-3">
            {invoices.slice(0, 5).map(inv => (
              <div key={inv.id} className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                <div>
                  <div className="font-medium text-white">{inv.invoiceNumber}</div>
                  <div className="text-xs text-slate-400">PO: {inv.poNumber} &bull; {inv.invoiceDate}</div>
                </div>
                <div className="text-right">
                  <div className={`font-semibold ${parseFloat(inv.total) < 0 ? 'text-purple-400' : 'text-white'}`}>
                    ${parseFloat(inv.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <StatusBadge status={inv.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-white">Price Variances</h3>
            <button onClick={() => setActiveTab('comparison')} className="text-sm text-blue-400 hover:text-blue-300">View All →</button>
          </div>
          <div className="space-y-3">
            {comparisonData.filter(c => c.status !== 'NOT_INVOICED').map((item, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                <div>
                  <div className="font-medium text-white">{item.itemNumber}</div>
                  <div className="text-xs text-slate-400 truncate max-w-[200px]">{item.description}</div>
                </div>
                <div className="text-right">
                  <div className={`font-semibold ${item.variance > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {item.variance > 0 ? '+' : ''}{item.variance?.toFixed(2)}%
                  </div>
                  <StatusBadge status={item.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl p-5">
        <h3 className="text-lg font-semibold text-white mb-4">Active Quotes</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                <th className="pb-3 font-medium">Quote #</th>
                <th className="pb-3 font-medium">Vendor</th>
                <th className="pb-3 font-medium">Date</th>
                <th className="pb-3 font-medium">Job Name</th>
                <th className="pb-3 font-medium">Items</th>
                <th className="pb-3 font-medium text-right">Total</th>
                <th className="pb-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {quotes.map(quote => (
                <tr key={quote.id} className="border-t border-slate-700/50 hover:bg-slate-700/20">
                  <td className="py-3 font-medium text-blue-400">{quote.bidNumber}</td>
                  <td className="py-3 text-white">{quote.vendor}</td>
                  <td className="py-3 text-slate-300">{quote.bidDate}</td>
                  <td className="py-3 text-slate-300">{quote.jobName}</td>
                  <td className="py-3 text-slate-300">{quote.lineItems.length}</td>
                  <td className="py-3 text-right font-semibold text-white">${quote.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="py-3"><StatusBadge status={quote.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ============================================================================
  // ITEM CATALOG
  // ============================================================================
  const ItemCatalog = () => {
    const allItems = quotes.flatMap(q =>
      q.lineItems.map(li => ({ ...li, bidNumber: q.bidNumber, bidDate: q.bidDate, vendor: q.vendor, jobName: q.jobName }))
    );
    const filteredItems = allItems.filter(item =>
      item.itemNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-white">Item Catalog</h2>
            <p className="text-slate-400 text-sm mt-1">Requirement 1: Items by Vendor from Quotes</p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Search items..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 w-64" />
          </div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-700/50">
                <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-3 font-medium">Item Number</th>
                  <th className="px-4 py-3 font-medium">Vendor</th>
                  <th className="px-4 py-3 font-medium">Quote #</th>
                  <th className="px-4 py-3 font-medium">Quote Date</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">UoM</th>
                  <th className="px-4 py-3 font-medium text-right">Unit Price</th>
                  <th className="px-4 py-3 font-medium text-right">Qty</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-700/50">
                {filteredItems.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-700/20">
                    <td className="px-4 py-3 font-mono text-blue-400 font-medium">{item.itemNumber}</td>
                    <td className="px-4 py-3 text-white">{item.vendor}</td>
                    <td className="px-4 py-3 text-slate-300">{item.bidNumber}</td>
                    <td className="px-4 py-3 text-slate-300">{item.bidDate}</td>
                    <td className="px-4 py-3 text-slate-300 max-w-xs truncate">{item.description}</td>
                    <td className="px-4 py-3 text-slate-300">{item.uom}</td>
                    <td className="px-4 py-3 text-right font-semibold text-white">${item.netPrice.toFixed(3)}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{item.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================================
  // INVOICES
  // ============================================================================
  const Invoices = () => {
    const filteredInvoices = invoices.filter(inv =>
      inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.poNumber.toLowerCase().includes(searchTerm.toLowerCase())
    );
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-white">Invoices</h2>
            <p className="text-slate-400 text-sm mt-1">{invoices.length} invoices &bull; ${totalInvoiceAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} total</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Search invoices..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 w-64" />
            </div>
            <button onClick={() => { setUploadType('invoice'); setShowUploadModal(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">
              <Upload className="w-4 h-4" />Upload
            </button>
          </div>
        </div>
        <div className="space-y-4">
          {filteredInvoices.map(inv => (
            <div key={inv.id} className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden hover:border-slate-600/50 transition-all">
              <div className="p-4 flex items-center justify-between cursor-pointer" onClick={() => setSelectedInvoice(selectedInvoice === inv.id ? null : inv.id)}>
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-slate-700/50 rounded-lg"><FileText className="w-5 h-5 text-slate-400" /></div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{inv.invoiceNumber}</span>
                      <StatusBadge status={inv.status} />
                    </div>
                    <div className="text-sm text-slate-400">PO: {inv.poNumber} &bull; Job: {inv.jobNumber} &bull; {inv.invoiceDate}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className={`text-lg font-bold ${parseFloat(inv.total) < 0 ? 'text-purple-400' : 'text-white'}`}>
                      ${parseFloat(inv.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-xs text-slate-400">{inv.lineItems.length} line items</div>
                  </div>
                  {selectedInvoice === inv.id ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
                </div>
              </div>
              {selectedInvoice === inv.id && (
                <div className="border-t border-slate-700/50 p-4 bg-slate-900/30">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-400 uppercase">
                        <th className="pb-2">Item #</th><th className="pb-2">Description</th>
                        <th className="pb-2 text-center">Ordered</th><th className="pb-2 text-center">Shipped</th>
                        <th className="pb-2">UoM</th><th className="pb-2 text-right">Unit Price</th><th className="pb-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.lineItems.map((li, idx) => (
                        <tr key={idx} className="border-t border-slate-700/30">
                          <td className="py-2 font-mono text-blue-400">{li.itemNumber}</td>
                          <td className="py-2 text-slate-300">{li.description}</td>
                          <td className="py-2 text-center text-slate-300">{li.qtyOrdered}</td>
                          <td className="py-2 text-center text-slate-300">{li.qtyShipped}</td>
                          <td className="py-2 text-slate-300">{li.uom}</td>
                          <td className="py-2 text-right text-white">${li.unitPrice.toFixed(3)}</td>
                          <td className="py-2 text-right font-semibold text-white">${li.amount.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ============================================================================
  // COMPARISON
  // ============================================================================
  const Comparison = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Quote vs Invoice Comparison</h2>
        <p className="text-slate-400 text-sm mt-1">Requirement 2a: Compare Invoice Price to Quoted Price</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
          <div className="flex items-center gap-2 text-emerald-400 mb-2"><TrendingDown className="w-5 h-5" /><span className="font-semibold">Under Quote</span></div>
          <div className="text-2xl font-bold text-white">{comparisonData.filter(c => c.status === 'UNDER_QUOTE').length}</div>
          <div className="text-sm text-slate-400">Favorable pricing</div>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <div className="flex items-center gap-2 text-red-400 mb-2"><TrendingUp className="w-5 h-5" /><span className="font-semibold">Over Quote</span></div>
          <div className="text-2xl font-bold text-white">{comparisonData.filter(c => c.status === 'OVER_QUOTE').length}</div>
          <div className="text-sm text-slate-400">Requires review</div>
        </div>
        <div className="bg-slate-500/10 border border-slate-500/30 rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-2"><Clock className="w-5 h-5" /><span className="font-semibold">Not Invoiced</span></div>
          <div className="text-2xl font-bold text-white">{comparisonData.filter(c => c.status === 'NOT_INVOICED').length}</div>
          <div className="text-sm text-slate-400">Pending delivery</div>
        </div>
      </div>
      <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-700/50">
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
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
            <tbody className="text-sm divide-y divide-slate-700/50">
              {comparisonData.map((item, idx) => (
                <tr key={idx} className={`hover:bg-slate-700/20 ${item.status === 'OVER_QUOTE' ? 'bg-red-500/5' : ''}`}>
                  <td className="px-4 py-3 font-mono text-blue-400 font-medium">{item.itemNumber}</td>
                  <td className="px-4 py-3 text-slate-300 max-w-xs truncate">{item.description}</td>
                  <td className="px-4 py-3 text-white">{item.vendor}</td>
                  <td className="px-4 py-3 text-slate-300">{item.quoteNumber}</td>
                  <td className="px-4 py-3 text-right text-white">${item.quotedPrice.toFixed(3)}</td>
                  <td className="px-4 py-3 text-slate-300">{item.invoiceNumber}</td>
                  <td className="px-4 py-3 text-right text-white">{item.invoicePrice ? `$${item.invoicePrice.toFixed(3)}` : '-'}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${item.variance > 0 ? 'text-red-400' : item.variance < 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {item.variance !== null ? `${item.variance > 0 ? '+' : ''}${item.variance.toFixed(2)}%` : '-'}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ============================================================================
  // PO SUMMARY
  // ============================================================================
  const POSummary = () => {
    const poSummary = invoices.reduce((acc, inv) => {
      const key = `${inv.poNumber}-${inv.vendor}`;
      if (!acc[key]) acc[key] = { poNumber: inv.poNumber, vendor: inv.vendor, invoiceCount: 0, lineCount: 0, totalQty: 0, totalAmount: 0, jobs: new Set() };
      acc[key].invoiceCount++;
      acc[key].lineCount += inv.lineItems.length;
      acc[key].totalQty += inv.lineItems.reduce((sum, li) => sum + li.qtyShipped, 0);
      acc[key].totalAmount += parseFloat(inv.total || 0);
      acc[key].jobs.add(inv.jobNumber);
      return acc;
    }, {});
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-white">PO / Vendor Summary</h2>
          <p className="text-slate-400 text-sm mt-1">Requirement 2b: Total Qty and Amount by PO</p>
        </div>
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-700/50">
                <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-3 font-medium">PO #</th>
                  <th className="px-4 py-3 font-medium">Vendor</th>
                  <th className="px-4 py-3 font-medium">Jobs</th>
                  <th className="px-4 py-3 font-medium text-center"># Invoices</th>
                  <th className="px-4 py-3 font-medium text-center"># Line Items</th>
                  <th className="px-4 py-3 font-medium text-right">Total Qty</th>
                  <th className="px-4 py-3 font-medium text-right">Total Amount</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-700/50">
                {Object.values(poSummary).map((po, idx) => (
                  <tr key={idx} className="hover:bg-slate-700/20">
                    <td className="px-4 py-3 font-semibold text-blue-400">{po.poNumber}</td>
                    <td className="px-4 py-3 text-white">{po.vendor}</td>
                    <td className="px-4 py-3 text-slate-300 text-sm">{Array.from(po.jobs).join(', ')}</td>
                    <td className="px-4 py-3 text-center text-slate-300">{po.invoiceCount}</td>
                    <td className="px-4 py-3 text-center text-slate-300">{po.lineCount}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{po.totalQty}</td>
                    <td className="px-4 py-3 text-right font-bold text-white">${po.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-700/30">
                <tr className="text-sm font-semibold">
                  <td className="px-4 py-3 text-white" colSpan={3}>TOTAL</td>
                  <td className="px-4 py-3 text-center text-white">{invoices.length}</td>
                  <td className="px-4 py-3 text-center text-white">{invoices.reduce((sum, inv) => sum + inv.lineItems.length, 0)}</td>
                  <td className="px-4 py-3 text-right text-white">{invoices.reduce((sum, inv) => sum + inv.lineItems.reduce((s, li) => s + li.qtyShipped, 0), 0)}</td>
                  <td className="px-4 py-3 text-right text-white">${totalInvoiceAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================================
  // CLOUD DOCUMENTS
  // ============================================================================
  const handleTestConnection = async () => {
    setConnectionStatus({ gcs: null, bq: null, testing: true });
    // Simulate connection test — in production this calls the backend health endpoint
    await new Promise(r => setTimeout(r, 1200));
    const hasEndpoint = cloudConfig.apiEndpoint.trim().length > 0;
    setConnectionStatus({
      gcs: hasEndpoint ? 'connected' : 'demo',
      bq: hasEndpoint ? 'connected' : 'demo',
      testing: false,
    });
  };

  const processUpload = (file) => {
    const id = `${Date.now()}-${Math.random()}`;
    const folderMap = { invoice: 'invoices', quote: 'quotes/backup-files', po: 'purchase-orders' };
    const folder = folderMap[cloudDocType] || 'invoices';

    setUploadQueue(prev => [...prev, {
      id, fileName: file.name, docType: cloudDocType,
      status: 'uploading', progress: 0,
      gcPath: null, bqSynced: false,
      timestamp: new Date().toISOString(),
      size: file.size,
    }]);

    // Simulate upload progress
    let progress = 0;
    const tick = setInterval(() => {
      progress = Math.min(progress + Math.random() * 20, 90);
      setUploadQueue(prev => prev.map(item =>
        item.id === id ? { ...item, progress: Math.round(progress) } : item
      ));
      if (progress >= 90) clearInterval(tick);
    }, 200);

    // Attempt real upload if API endpoint configured, otherwise simulate
    const doUpload = async () => {
      if (cloudConfig.apiEndpoint.trim()) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('docType', cloudDocType);
        formData.append('bucket', cloudConfig.bucketName);
        formData.append('dataset', cloudConfig.bigQueryDataset);
        const res = await fetch(`${cloudConfig.apiEndpoint}/api/documents/upload`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } else {
        // Demo mode — simulate 2-second upload
        await new Promise(r => setTimeout(r, 2000));
        return {
          gcPath: `gs://${cloudConfig.bucketName}/${folder}/${file.name}`,
          bqSynced: true,
          documentAiProcessed: true,
        };
      }
    };

    doUpload()
      .then(result => {
        clearInterval(tick);
        setUploadQueue(prev => prev.map(item =>
          item.id === id ? {
            ...item, status: 'processing', progress: 95,
            gcPath: result.gcPath,
          } : item
        ));
        // Simulate Document AI processing delay
        setTimeout(() => {
          setUploadQueue(prev => prev.map(item =>
            item.id === id ? {
              ...item, status: 'complete', progress: 100,
              gcPath: result.gcPath,
              bqSynced: result.bqSynced,
            } : item
          ));
          // Refresh live data after successful upload
          if (cloudConfig.apiEndpoint?.trim()) fetchLiveData(cloudConfig.apiEndpoint);
        }, 1500);
      })
      .catch(() => {
        clearInterval(tick);
        setUploadQueue(prev => prev.map(item =>
          item.id === id ? { ...item, status: 'error', progress: 0 } : item
        ));
      });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    Array.from(e.dataTransfer.files)
      .filter(f => f.type === 'application/pdf' || f.name.match(/\.(xlsx|xls)$/i))
      .forEach(processUpload);
  };

  const handleFileInput = (e) => {
    Array.from(e.target.files).forEach(processUpload);
    e.target.value = '';
  };

  const CloudDocuments = () => {
    const docTypes = [
      { id: 'invoice', label: 'Invoice', folder: 'invoices/', color: 'blue' },
      { id: 'quote', label: 'Quote / Bid', folder: 'quotes/backup-files/', color: 'emerald' },
      { id: 'po', label: 'Purchase Order', folder: 'purchase-orders/', color: 'purple' },
    ];

    const statusIcon = (status) => {
      if (status === 'uploading') return <Loader className="w-4 h-4 text-blue-400 animate-spin" />;
      if (status === 'processing') return <Loader className="w-4 h-4 text-amber-400 animate-spin" />;
      if (status === 'complete') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      if (status === 'error') return <XCircle className="w-4 h-4 text-red-400" />;
      return null;
    };

    const statusLabel = (item) => {
      if (item.status === 'uploading') return `Uploading... ${item.progress}%`;
      if (item.status === 'processing') return 'Document AI processing...';
      if (item.status === 'complete') return item.bqSynced ? 'Synced to BigQuery' : 'Uploaded to GCS';
      if (item.status === 'error') return 'Upload failed';
      return '';
    };

    const connDot = (s) => {
      if (s === 'connected') return 'bg-emerald-400';
      if (s === 'demo') return 'bg-amber-400';
      return 'bg-slate-500';
    };

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-white">Cloud Documents</h2>
            <p className="text-slate-400 text-sm mt-1">
              Upload invoices, quotes, and POs directly to GCS &rarr; Document AI &rarr; BigQuery
            </p>
          </div>
          <button
            onClick={() => setCloudConfig(c => ({ ...c, showSettings: !c.showSettings }))}
            className="flex items-center gap-2 px-3 py-2 bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 text-slate-300 rounded-lg text-sm transition-colors"
          >
            <Settings className="w-4 h-4" />
            Configure
          </button>
        </div>

        {/* Connection Status Bar */}
        <div className="flex items-center gap-6 px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-xl text-sm">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-slate-400" />
            <span className="text-slate-400">GCS Bucket:</span>
            <span className="text-white font-mono text-xs">{cloudConfig.bucketName}</span>
            {connectionStatus.gcs && (
              <span className={`w-2 h-2 rounded-full ${connDot(connectionStatus.gcs)}`} />
            )}
          </div>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-400" />
            <span className="text-slate-400">BigQuery:</span>
            <span className="text-white font-mono text-xs">{cloudConfig.bigQueryDataset}</span>
            {connectionStatus.bq && (
              <span className={`w-2 h-2 rounded-full ${connDot(connectionStatus.bq)}`} />
            )}
          </div>
          <button
            onClick={handleTestConnection}
            disabled={connectionStatus.testing}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
          >
            {connectionStatus.testing ? <Loader className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
            {connectionStatus.testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {/* Settings Panel */}
        {cloudConfig.showSettings && (
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">Cloud Configuration</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">GCS Bucket Name</label>
                <input
                  value={cloudConfig.bucketName}
                  onChange={e => setCloudConfig(c => ({ ...c, bucketName: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="my-project-procurement-docs"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">BigQuery Dataset</label>
                <input
                  value={cloudConfig.bigQueryDataset}
                  onChange={e => setCloudConfig(c => ({ ...c, bigQueryDataset: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="project-id:dataset"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">
                  API Endpoint <span className="text-slate-500">(optional — leave blank for demo mode)</span>
                </label>
                <input
                  value={cloudConfig.apiEndpoint}
                  onChange={e => setCloudConfig(c => ({ ...c, apiEndpoint: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="https://your-api.run.app"
                />
              </div>
            </div>
            <div className="text-xs text-slate-500">
              In production, the API endpoint is a Cloud Run service that generates signed GCS URLs, triggers Document AI, and writes structured data to BigQuery/PostgreSQL.
              Leave blank to run in demo mode with simulated uploads.
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upload Zone */}
          <div className="lg:col-span-2 space-y-4">
            {/* Document Type Selector */}
            <div className="flex gap-2">
              {docTypes.map(dt => (
                <button
                  key={dt.id}
                  onClick={() => setCloudDocType(dt.id)}
                  className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    cloudDocType === dt.id
                      ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                      : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                  }`}
                >
                  {dt.label}
                  <div className="text-xs opacity-60 mt-0.5">{dt.folder}</div>
                </button>
              ))}
            </div>

            {/* Drag and Drop Zone */}
            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-slate-600 bg-slate-800/30 hover:border-slate-500 hover:bg-slate-800/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.xlsx,.xls"
                multiple
                onChange={handleFileInput}
                className="hidden"
              />
              <CloudUpload className={`w-12 h-12 mx-auto mb-3 ${isDragging ? 'text-blue-400' : 'text-slate-500'}`} />
              <div className="text-white font-semibold text-lg mb-1">
                {isDragging ? 'Drop to upload' : 'Drag & drop PDFs here'}
              </div>
              <div className="text-slate-400 text-sm mb-4">or click to browse files</div>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
                <FolderOpen className="w-4 h-4" />
                Browse Files
              </div>
              <div className="mt-4 text-xs text-slate-500">
                PDF or Excel (.xlsx) &bull; Destination: <span className="text-slate-400">gs://{cloudConfig.bucketName}/{docTypes.find(d => d.id === cloudDocType)?.folder}</span>
              </div>
            </div>
          </div>

          {/* Upload Info Panel */}
          <div className="space-y-4">
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-white mb-3">Upload Pipeline</h4>
              <div className="space-y-3 text-xs">
                {[
                  { step: '1', label: 'Upload to GCS', detail: `gs://${cloudConfig.bucketName}/`, icon: Cloud, color: 'text-blue-400' },
                  { step: '2', label: 'Document AI', detail: 'Extract line items, amounts, dates', icon: FileText, color: 'text-purple-400' },
                  { step: '3', label: 'PostgreSQL', detail: 'Structured data written to Cloud SQL', icon: Database, color: 'text-emerald-400' },
                  { step: '4', label: 'BigQuery Sync', detail: 'Datastream CDC replicates in ~15 min', icon: BarChart3, color: 'text-amber-400' },
                ].map(s => (
                  <div key={s.step} className="flex items-start gap-3">
                    <div className={`w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0 text-xs font-bold ${s.color}`}>{s.step}</div>
                    <div>
                      <div className={`font-medium ${s.color}`}>{s.label}</div>
                      <div className="text-slate-500">{s.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-white mb-3">Folder Structure</h4>
              <div className="text-xs font-mono text-slate-400 space-y-1">
                <div className="text-slate-300">gs://{cloudConfig.bucketName}/</div>
                <div className="pl-4">invoices/</div>
                <div className="pl-4">quotes/</div>
                <div className="pl-8 text-slate-500">backup-files/</div>
                <div className="pl-4">purchase-orders/</div>
                <div className="pl-4 text-slate-500">processed/</div>
              </div>
            </div>
          </div>
        </div>

        {/* Upload Queue */}
        {uploadQueue.length > 0 && (
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
              <h3 className="text-sm font-semibold text-white">Upload Queue</h3>
              <button
                onClick={() => setUploadQueue(q => q.filter(i => i.status !== 'complete' && i.status !== 'error'))}
                className="text-xs text-slate-400 hover:text-slate-300"
              >
                Clear completed
              </button>
            </div>
            <div className="divide-y divide-slate-700/50">
              {[...uploadQueue].reverse().map(item => (
                <div key={item.id} className="px-4 py-3 flex items-center gap-4">
                  <div className="flex-shrink-0">{statusIcon(item.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-white truncate">{item.fileName}</span>
                      <span className="text-xs text-slate-500 capitalize">{item.docType}</span>
                    </div>
                    {(item.status === 'uploading') && (
                      <div className="w-full bg-slate-700 rounded-full h-1.5">
                        <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${item.progress}%` }} />
                      </div>
                    )}
                    {(item.status === 'complete' || item.status === 'processing' || item.status === 'error') && (
                      <div className={`text-xs ${item.status === 'error' ? 'text-red-400' : item.status === 'processing' ? 'text-amber-400' : 'text-slate-400'}`}>
                        {statusLabel(item)}
                        {item.gcPath && <span className="font-mono ml-1">{item.gcPath}</span>}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 flex-shrink-0">
                    {(item.size / 1024).toFixed(1)} KB
                  </div>
                  <button onClick={() => setUploadQueue(q => q.filter(i => i.id !== item.id))} className="text-slate-600 hover:text-slate-400 flex-shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ============================================================================
  // UPLOAD MODAL (legacy)
  // ============================================================================
  const UploadModal = () => (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md mx-4">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-white">Upload Document</h3>
          <button onClick={() => setShowUploadModal(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Document Type</label>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setUploadType('quote')} className={`p-3 rounded-lg border text-left transition-all ${uploadType === 'quote' ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-slate-700/50 border-slate-600 text-slate-300 hover:border-slate-500'}`}>
                <Package className="w-5 h-5 mb-1" />
                <div className="font-medium">Quote/Bid</div>
                <div className="text-xs opacity-70">Backup files</div>
              </button>
              <button onClick={() => setUploadType('invoice')} className={`p-3 rounded-lg border text-left transition-all ${uploadType === 'invoice' ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-slate-700/50 border-slate-600 text-slate-300 hover:border-slate-500'}`}>
                <FileText className="w-5 h-5 mb-1" />
                <div className="font-medium">Invoice</div>
                <div className="text-xs opacity-70">Standard invoices</div>
              </button>
            </div>
          </div>
          <div className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center hover:border-blue-500/50 transition-colors cursor-pointer">
            <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <div className="text-white font-medium mb-1">Drop files here or click to browse</div>
            <div className="text-sm text-slate-400">PDF files up to 10MB</div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setShowUploadModal(false)} className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors">Cancel</button>
            <button onClick={() => { setShowUploadModal(false); setActiveTab('documents'); }} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">Go to Cloud Upload</button>
          </div>
        </div>
      </div>
    </div>
  );

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800">
      <header className="bg-slate-900/80 backdrop-blur-xl border-b border-slate-700/50 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <img src={accoLogo} alt="ACCO Engineered Systems" className="h-9 w-auto brightness-0 invert" />
              <div className="border-l border-slate-600 pl-4">
                <div className="font-bold text-white text-lg">PM COST CONTROL ANALYST</div>
                <div className="text-xs text-slate-400">Quote Comparison System &mdash; UC #88</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-400">Ferguson Enterprises</span>
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                <span className="text-sm font-medium text-white">AK</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <nav className="flex gap-1 mb-6 bg-slate-800/50 p-1 rounded-xl border border-slate-700/50 overflow-x-auto">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm whitespace-nowrap transition-all ${
                activeTab === tab.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}>
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>

        <main>
          {activeTab === 'dashboard' && <Dashboard />}
          {activeTab === 'catalog' && <ItemCatalog />}
          {activeTab === 'invoices' && <Invoices />}
          {activeTab === 'comparison' && <Comparison />}
          {activeTab === 'summary' && <POSummary />}
          {activeTab === 'documents' && <CloudDocuments />}
        </main>
      </div>

      {showUploadModal && <UploadModal />}

      <footer className="border-t border-slate-800 mt-12 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-slate-500">
          Use Case #88 Prototype &bull; Google Cloud Platform &bull; AI Summit 2026
        </div>
      </footer>
    </div>
  );
}
