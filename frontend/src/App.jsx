import * as React from 'react';
import { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate, Link } from 'react-router-dom';
import { Home, Users, ShoppingCart, FileText, Package, LogOut, Loader2, UserPlus, FileCheck, ClipboardList } from 'lucide-react';
import InstallPrompt from './components/InstallPrompt';
import OfflineIndicator from './components/OfflineIndicator';
import Login from './components/Login';
import UserMenu from './components/UserMenu';
import SARSymbol from './components/SARSymbol';
import { assetUrl } from './utils/assetUrl';
import { getCustomers, getSalesInvoiceList, createCustomer, createSalesInvoice, validateToken, logout, getStock, getPaymentEntriesList } from './services/api';

// Lazy load route components for code splitting
const Dashboard = lazy(() => import('./components/Dashboard'));
const SalesModule = lazy(() => import('./components/SalesModule'));
const CustomerModule = lazy(() => import('./components/CustomerModule'));
const SalesReturnModule = lazy(() => import('./components/SalesReturnModule'));
const PaymentModule = lazy(() => import('./components/PaymentModule'));
const StockModule = lazy(() => import('./components/StockModule'));
const LeadModule = lazy(() => import('./components/LeadModule'));
const QuotationModule = lazy(() => import('./components/QuotationModule'));
const SalesOrderModule = lazy(() => import('./components/SalesOrderModule'));

// Preload route chunk on hover for faster navigation
const preload = (loader) => { loader(); };
const routePreload = {
  dashboard: () => preload(() => import('./components/Dashboard')),
  sales: () => preload(() => import('./components/SalesModule')),
  customers: () => preload(() => import('./components/CustomerModule')),
  returns: () => preload(() => import('./components/SalesReturnModule')),
  payments: () => preload(() => import('./components/PaymentModule')),
  stock: () => preload(() => import('./components/StockModule')),
  leads: () => preload(() => import('./components/LeadModule')),
  quotations: () => preload(() => import('./components/QuotationModule')),
  'sales-orders': () => preload(() => import('./components/SalesOrderModule')),
};

// Loading fallback component
const RouteLoader = () => (
  <div className="card" style={{ minHeight: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div className="empty-state">
      <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
      <div className="empty-state-title mt-4">Loading...</div>
    </div>
  </div>
);

function AppContent({ onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = true; // Always authenticated when AppContent is rendered
  
  // Refs / status trackers
  const hasValidatedToken = useRef(false);
  
  // Get current view from route path
  const currentView = location.pathname === '/' ? 'dashboard' : location.pathname.slice(1);
  
  // Validate token on mount if authenticated (only once)
  useEffect(() => {
    const checkAuth = async () => {
      if (isAuthenticated && !hasValidatedToken.current) {
        hasValidatedToken.current = true;
        const token = localStorage.getItem('api_token');
        if (token) {
          try {
            await validateToken(token);
          } catch (error) {
            // Token invalid, logout
            hasValidatedToken.current = false; // Reset on logout
            localStorage.removeItem('isAuthenticated');
            // Use window.location for hard redirect after clearing localStorage
            window.location.href = '/pwa/login';
          }
        }
      }
    };
    checkAuth();
  }, [isAuthenticated, navigate]);
  const [dataStatus, setDataStatus] = useState({
    customers: 'idle',
    sales: 'idle',
    items: 'idle',
    payments: 'idle'
  });
  
  // Refs to track loaded state without causing re-renders
  const loadedRefs = useRef({
    customers: false,
    sales: false,
    items: false,
    payments: false
  });
  
  // Data from API
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [returns, setReturns] = useState([]);
  const [payments, setPayments] = useState([]); // Will be fetched from API when endpoint is available
  const [items, setItems] = useState([]); // Items fetched from API

  const fetchCustomers = useCallback(async (force = false) => {
    if (!isAuthenticated) return;
    if (!force && loadedRefs.current.customers) return;

    setDataStatus(prev => ({ ...prev, customers: 'loading' }));
    try {
      const customersData = await getCustomers();
      setCustomers(customersData);
      loadedRefs.current.customers = true;
      setDataStatus(prev => ({ ...prev, customers: 'loaded' }));
    } catch (error) {
      console.error('Error fetching customers:', error);
      loadedRefs.current.customers = false;
      setDataStatus(prev => ({ ...prev, customers: 'error' }));
      throw error;
    }
  }, [isAuthenticated]);

  const fetchSales = useCallback(async (force = false) => {
    if (!isAuthenticated) return;
    if (!force && loadedRefs.current.sales) return;

    setDataStatus(prev => ({ ...prev, sales: 'loading' }));
    try {
      const { invoices, totalCount } = await getSalesInvoiceList({ limit: 20, offset: 0 });
      setSales(Array.isArray(invoices) ? invoices : []);
      loadedRefs.current.sales = true;
      setDataStatus(prev => ({ ...prev, sales: 'loaded' }));
    } catch (error) {
      console.error('Error fetching sales:', error);
      loadedRefs.current.sales = false;
      setDataStatus(prev => ({ ...prev, sales: 'error' }));
      throw error;
    }
  }, [isAuthenticated]);

  const fetchItems = useCallback(async (force = false) => {
    if (!isAuthenticated) return;
    if (!force && loadedRefs.current.items) return;

    setDataStatus(prev => ({ ...prev, items: 'loading' }));
    try {
      const stockData = await getStock();
      setItems(stockData);
      loadedRefs.current.items = true;
      setDataStatus(prev => ({ ...prev, items: 'loaded' }));
    } catch (error) {
      console.error('Error fetching stock items:', error);
      loadedRefs.current.items = false;
      setDataStatus(prev => ({ ...prev, items: 'error' }));
      throw error;
    }
  }, [isAuthenticated]);

  const fetchPayments = useCallback(async (force = false) => {
    if (!isAuthenticated) return;
    if (!force && loadedRefs.current.payments) return;

    setDataStatus(prev => ({ ...prev, payments: 'loading' }));
    try {
      const paymentsData = await getPaymentEntriesList({ limit: 50 });
      const docstatusToStatus = (docstatus) => (docstatus === 1 ? 'Submitted' : docstatus === 2 ? 'Cancelled' : 'Draft');
      const formattedPayments = Array.isArray(paymentsData) ? paymentsData.map(entry => ({
        id: entry.name || entry.payment_entry || entry.id || entry.reference_name || `PAY-${Date.now()}`,
        date: entry.posting_date || entry.date || new Date().toISOString().split('T')[0],
        customerName: entry.party || entry.customer || entry.party_name || 'Customer',
        amount: parseFloat(entry.paid_amount || entry.amount || entry.received_amount || 0),
        paymentMethod: entry.mode_of_payment || entry.payment_method || 'Cash',
        status: docstatusToStatus(entry.docstatus)
      })) : [];
      setPayments(formattedPayments);
      loadedRefs.current.payments = true;
      setDataStatus(prev => ({ ...prev, payments: 'loaded' }));
    } catch (error) {
      console.error('Error fetching payments:', error);
      loadedRefs.current.payments = false;
      setDataStatus(prev => ({ ...prev, payments: 'error' }));
      throw error;
    }
  }, [isAuthenticated]);

  const handleAddCustomer = async (customer) => {
    try {
      // Customer is already created via API in CustomerModule
      // Just add to local state for immediate UI update
      setCustomers(prevCustomers => [
        ...prevCustomers,
        {
      ...customer,
          id: customer.id || `CUST${String(prevCustomers.length + 1).padStart(3, '0')}`,
          balance: customer.balance || 0
        }
      ]);
      // Optionally refresh from API to get latest data
      // const updatedCustomers = await getCustomers();
      // setCustomers(updatedCustomers);
    } catch (error) {
      console.error('Error adding customer to state:', error);
    }
  };

  const handleAddSale = async (sale) => {
    const normalizedSale = {
      ...sale,
      id: sale.id || `INV-${Date.now()}`,
      status: sale.status || 'Draft'
    };

    // Optimistically update UI so dashboard reflects the new sale immediately
    setSales(prevSales => {
      const exists = prevSales.some(s => s.id === normalizedSale.id);
      if (exists) {
        return prevSales;
      }
      return [...prevSales, normalizedSale];
    });

    // Invalidate cache instead of immediate refetch
    // The cache will be refreshed on next navigation or explicit refresh
    try {
      const { invalidateCache } = await import('./utils/apiCache');
      invalidateCache('get_sales_invoice_list');
      invalidateCache('get_today_sales');
      // Reset loaded state to allow refetch on next view
      loadedRefs.current.sales = false;
    } catch (error) {
      console.error('Error invalidating cache:', error);
    }
  };

  const handleAddReturn = (returnData) => {
    setReturns(prevReturns => [
      ...prevReturns,
      {
      ...returnData,
        id: `RET-${String(prevReturns.length + 1).padStart(3, '0')}`
      }
    ]);
  };

  const handleAddPayment = async (payment) => {
    const normalizedPayment = {
      ...payment,
      id: payment.id || payment.paymentEntry || `PAY-${Date.now()}`,
      amount: payment.amount || 0,
      paymentEntry: payment.paymentEntry || payment.id
    };
    setPayments(prevPayments => {
      const exists = prevPayments.some(p => p.id === normalizedPayment.id || p.paymentEntry === normalizedPayment.paymentEntry);
      return exists ? prevPayments : [...prevPayments, normalizedPayment];
    });
    
    // Invalidate cache and refetch payments list to get complete data
    import('./utils/apiCache').then(({ invalidateCache }) => {
      invalidateCache('get_payment_entries_list');
      invalidateCache('get_today_collection');
      invalidateCache('get_today_cash_collection');
      invalidateCache('get_today_bank_collection');
      // Reset loaded state to allow refetch
      loadedRefs.current.payments = false;
    }).catch(() => {
      // Keep optimistic payment if cache invalidation fails
    });
    
    // Refetch payments list to get complete data from backend
    try {
      await fetchPayments(true);
    } catch (error) {
      console.error('Error refetching payments after creation:', error);
      // Keep optimistic payment even if refetch fails
    }
  };

  // Fetch data lazily based on the current view
  useEffect(() => {
    if (!isAuthenticated) return;

    const loadData = async () => {
      try {
        switch (currentView) {
          case 'dashboard':
            // Dashboard only needs customers, sales, payments (not items — saves 1 request)
            await Promise.all([fetchCustomers(), fetchSales(), fetchPayments()]);
            break;
          case 'sales':
            await Promise.all([fetchCustomers(), fetchSales(), fetchItems()]);
            break;
          case 'customers':
            await fetchCustomers();
            break;
          case 'returns':
            await Promise.all([fetchCustomers(), fetchSales(), fetchItems()]);
            break;
          case 'payments':
            await Promise.all([fetchCustomers(), fetchSales(), fetchPayments()]);
            break;
          case 'stock':
            await fetchItems();
            break;
          case 'leads':
            break;
          case 'quotations':
          case 'sales-orders':
            await Promise.all([fetchCustomers(), fetchItems()]);
            break;
          default:
            break;
        }
      } catch (error) {
        console.error('Error loading data for view:', error);
      }
    };

    loadData();
  }, [currentView, isAuthenticated]);

  const handleLogin = () => {
    setIsAuthenticated(true);
    navigate('/dashboard');
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Error during logout:', error);
      // Continue with logout even if API call fails
    } finally {
      // Reset refs to allow fresh data fetch on next login
      hasValidatedToken.current = false;
      loadedRefs.current = {
        customers: false,
        sales: false,
        items: false,
        payments: false
      };
      // Clear state
      setDataStatus({ customers: 'idle', sales: 'idle', items: 'idle', payments: 'idle' });
      setCustomers([]);
      setSales([]);
      setItems([]);
      setPayments([]);
      // Clear API cache on logout
      import('./utils/apiCache').then(({ clearCache }) => {
        clearCache();
      }).catch(() => {
        // Ignore cache clear errors
      });
      // Call parent logout handler to update parent state and navigate
      onLogout();
    }
  };

  // Primary navigation items (bottom nav) - Dashboard, Sales, Sales Order, Quotation
  const primaryNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Home },
    { id: 'sales', label: 'Sales', icon: ShoppingCart },
    { id: 'sales-orders', label: 'Sales Order', icon: ClipboardList },
    { id: 'quotations', label: 'Quotation', icon: FileCheck },
  ];

  // Secondary navigation items (header menu) - Customer first, then others
  const secondaryNavItems = [
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'returns', label: 'Returns', icon: FileText },
    { id: 'payments', label: 'Payments', icon: null, customIcon: <SARSymbol size={20} /> },
    { id: 'stock', label: 'Stock', icon: Package },
    { id: 'leads', label: 'Leads', icon: UserPlus },
  ];

  return (
    <div className="app">
      <OfflineIndicator />
      {/* Top Header with Brand and Secondary Nav */}
      <nav className="nav-top no-print">
        <div className="nav-header">
          <div className="nav-brand">
            <img src={assetUrl('icon.png')} alt="Logo" style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
            Badria
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className="nav-menu-secondary">
              {secondaryNavItems.map(item => (
                <Link
                  key={item.id}
                  to={`/${item.id}`}
                  className={`nav-item-secondary ${currentView === item.id ? 'active' : ''}`}
                  title={item.label}
                  onMouseEnter={() => routePreload[item.id]?.()}
                  onFocus={() => routePreload[item.id]?.()}
                >
                  {item.customIcon || (item.icon && <item.icon size={20} />)}
                </Link>
              ))}
            </div>
            <UserMenu onLogout={handleLogout} />
          </div>
        </div>
      </nav>

      <div className="container">
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="/dashboard" element={<Dashboard sales={sales} payments={payments} customers={customers} loadingSales={dataStatus.sales === 'loading'} loadingPayments={dataStatus.payments === 'loading'} loadingCustomers={dataStatus.customers === 'loading'} />} />
            <Route path="/sales" element={<SalesModule customers={customers} items={items} sales={sales} onAddSale={handleAddSale} onAddCustomer={handleAddCustomer} loadingCustomers={dataStatus.customers === 'loading'} loadingItems={dataStatus.items === 'loading'} loadingSales={dataStatus.sales === 'loading'} />} />
            <Route path="/customers" element={<CustomerModule customers={customers} sales={sales} payments={payments} onAddCustomer={handleAddCustomer} loadingCustomers={dataStatus.customers === 'loading'} />} />
            <Route path="/returns" element={<SalesReturnModule customers={customers} sales={sales} loadingSales={dataStatus.sales === 'loading'} loadingCustomers={dataStatus.customers === 'loading'} />} />
            <Route path="/payments" element={<PaymentModule customers={customers} sales={sales} payments={payments} onAddPayment={handleAddPayment} loadingCustomers={dataStatus.customers === 'loading'} loadingPayments={dataStatus.payments === 'loading'} loadingSales={dataStatus.sales === 'loading'} />} />
            <Route path="/stock" element={<StockModule items={items} loadingItems={dataStatus.items === 'loading'} />} />
            <Route path="/leads" element={<LeadModule />} />
            <Route path="/quotations" element={<QuotationModule customers={customers} items={items} />} />
            <Route path="/sales-orders" element={<SalesOrderModule customers={customers} items={items} />} />
            <Route path="/index.html" element={<Navigate to="/dashboard" replace />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </div>

      {/* Bottom Navigation (Primary) */}
      <nav className="nav-bottom no-print">
        {primaryNavItems.map(item => (
          <Link
            key={item.id}
            to={`/${item.id}`}
            className={`nav-item-bottom ${currentView === item.id ? 'active' : ''}`}
            onMouseEnter={() => routePreload[item.id]?.()}
            onFocus={() => routePreload[item.id]?.()}
          >
            <div className="nav-icon-bottom">
              <item.icon size={24} />
            </div>
            <span className="nav-label-bottom">{item.label}</span>
          </Link>
        ))}
      </nav>

      <InstallPrompt />
    </div>
  );
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('isAuthenticated') === 'true';
  });

  const handleLogin = () => {
    setIsAuthenticated(true);
    navigate('/dashboard');
  };

  const handleLogout = () => {
    localStorage.removeItem('isAuthenticated');
    // Redirect to /pwa/login which will load the app and show login page
    window.location.href = '/pwa/login';
  };

  // Redirect to login if not authenticated and not on login page
  useEffect(() => {
    if (!isAuthenticated && location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, location.pathname, navigate]);

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route path="/index.html" element={<Navigate to="/login" replace />} />
        <Route path="/*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return <AppContent onLogout={handleLogout} />;
}

export default App;
