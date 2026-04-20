import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { Plus, RotateCcw, ChevronDown, Loader2, CheckCircle, X, Search } from 'lucide-react';
import { 
  createSalesReturn, 
  submitSalesReturn, 
  getSalesReturnDetails, 
  getSalesReturnsList,
  getInvoiceDetails,
  getSalesInvoiceList,
  openPrintPdf
} from '../services/api';
import SARSymbol from './SARSymbol';
import SuccessDialog from './SuccessDialog';
import ErrorDialog from './ErrorDialog';

function SalesReturnModule({ customers, sales, loadingSales, loadingCustomers }) {
  const [view, setView] = useState('list'); // 'list', 'create', 'detail'
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Customer selection state
  const [selectedCustomerForReturn, setSelectedCustomerForReturn] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState([]);
  const customerDropdownRef = useRef(null);
  
  // Create form state
  const [selectedInvoice, setSelectedInvoice] = useState('');
  const [invoiceDetails, setInvoiceDetails] = useState(null);
  const [returnItems, setReturnItems] = useState([]);
  const [reason, setReason] = useState('');
  const [postingDate, setPostingDate] = useState(new Date().toISOString().split('T')[0]);
  const [isFullReturn, setIsFullReturn] = useState(true);
  const [showInvoiceDropdown, setShowInvoiceDropdown] = useState(false);
  const invoiceDropdownRef = useRef(null);
  
  // Detail view state
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [returnDetail, setReturnDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('Credit');
  const [createPayment, setCreatePayment] = useState(false);
  const [successDialog, setSuccessDialog] = useState({ isOpen: false, title: '', message: '' });
  const [errorDialog, setErrorDialog] = useState({ isOpen: false, title: '', message: '' });

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Fetch returns list
  const fetchReturns = async () => {
    try {
      setLoading(true);
      const data = await getSalesReturnsList({ limit: 100 });
      setReturns(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching returns:', error);
      setReturns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (view === 'list') {
      fetchReturns();
    }
  }, [view]);

  // Fetch invoice details when invoice is selected
  useEffect(() => {
    const fetchInvoiceDetails = async () => {
      if (selectedInvoice) {
        try {
          setLoading(true);
          const details = await getInvoiceDetails(selectedInvoice);
          setInvoiceDetails(details);
          
          // Initialize return items from invoice items
          if (details.items && Array.isArray(details.items)) {
            setReturnItems(details.items.map(item => ({
              ...item,
              code: item.code || item.item_code,
              returnQuantity: item.quantity || 0,
              selected: false
            })));
          }
        } catch (error) {
          console.error('Error fetching invoice details:', error);
          alert('Failed to load invoice details');
        } finally {
          setLoading(false);
        }
      } else {
        setInvoiceDetails(null);
        setReturnItems([]);
      }
    };

    fetchInvoiceDetails();
  }, [selectedInvoice]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (invoiceDropdownRef.current && !invoiceDropdownRef.current.contains(event.target)) {
        setShowInvoiceDropdown(false);
      }
    };

    if (showInvoiceDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showInvoiceDropdown]);

  // Filter customers based on search query (only show dropdown when no customer selected)
  useEffect(() => {
    if (customerSearch.trim() && !selectedCustomerForReturn) {
      const filtered = (customers || []).filter(customer =>
        customer.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        customer.mobile?.toLowerCase().includes(customerSearch.toLowerCase()) ||
        customer.email?.toLowerCase().includes(customerSearch.toLowerCase())
      );
      setFilteredCustomers(filtered);
      setShowCustomerResults(true);
    } else if (!customerSearch.trim()) {
      setFilteredCustomers([]);
      if (!selectedCustomerForReturn) setShowCustomerResults(false);
    }
  }, [customerSearch, customers, selectedCustomerForReturn]);

  // Close customer dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showCustomerResults && customerDropdownRef.current && !customerDropdownRef.current.contains(event.target)) {
        setShowCustomerResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCustomerResults]);

  // Fetch available invoices (exclude draft and cancelled, show only submitted)
  const [availableInvoices, setAvailableInvoices] = useState([]);
  useEffect(() => {
    const fetchInvoices = async () => {
      try {
        const res = await getSalesInvoiceList({ limit: 100, offset: 0 });
        const invoices = (res && res.invoices && Array.isArray(res.invoices)) ? res.invoices : [];
        const allInvoices = invoices;

        // Filter out draft, cancelled, and fully returned invoices - only show invoices that can be returned
        let validInvoices = allInvoices.filter(invoice => {
          // Exclude draft invoices (docstatus = 0 or status = 'Draft')
          const isDraft = invoice.docstatus === 0 || invoice.status === 'Draft';
          
          // Exclude cancelled invoices (docstatus = 2 or status = 'Cancelled')
          const isCancelled = invoice.docstatus === 2 || invoice.status === 'Cancelled';
          
          // Exclude fully returned invoices (status = 'Return') - no need to show in "select invoice to return" list
          const isFullyReturned = (invoice.status || '').toString().toLowerCase() === 'return';
          
          return !isDraft && !isCancelled && !isFullyReturned;
        });

        // Filter by selected customer if a customer is selected
        if (selectedCustomerForReturn) {
          const selectedCustomer = (customers || []).find(c => c.id === selectedCustomerForReturn);
          if (selectedCustomer) {
            validInvoices = validInvoices.filter(invoice => {
              const invoiceCustomer = invoice.customerName || invoice.customer_name || invoice.customer || '';
              return invoiceCustomer === selectedCustomer.name || invoiceCustomer === selectedCustomer.id;
            });
          }
        }

        setAvailableInvoices(validInvoices);
      } catch (error) {
        const isOffline = error?.message === 'OFFLINE';
        if (!isOffline) {
          console.error('Error fetching invoices:', error);
        }
        // On failure (e.g. offline), clear list then apply sales fallback if available
        setAvailableInvoices([]);
        if (sales && Array.isArray(sales)) {
          let validSales = (sales || []).filter(sale => {
            const isDraft = sale.docstatus === 0 || sale.status === 'Draft';
            const isCancelled = sale.docstatus === 2 || sale.status === 'Cancelled';
            const isFullyReturned = (sale.status || '').toString().toLowerCase() === 'return';
            return !isDraft && !isCancelled && !isFullyReturned;
          });
          if (selectedCustomerForReturn) {
            const selectedCustomer = (customers || []).find(c => c.id === selectedCustomerForReturn);
            if (selectedCustomer) {
              validSales = validSales.filter(sale => {
                const saleCustomer = sale.customerName || sale.customer || '';
                return saleCustomer === selectedCustomer.name || saleCustomer === selectedCustomer.id;
              });
            }
          }
          setAvailableInvoices(validSales);
        }
      }
    };
    fetchInvoices();
  }, [sales, selectedCustomerForReturn, customers]);

  const handleToggleItem = (index) => {
    setReturnItems(returnItems.map((item, i) =>
      i === index ? { ...item, selected: !item.selected, returnQuantity: !item.selected ? item.returnQuantity : 0 } : item
    ));
  };

  const handleUpdateQuantity = (index, qty) => {
    setReturnItems(returnItems.map((item, i) =>
      i === index ? { ...item, returnQuantity: Math.min(Math.max(0, parseFloat(qty) || 0), item.returnQuantity || item.quantity || 0) } : item
    ));
  };

  const handleCreateReturn = async (e) => {
    e.preventDefault();
    
    if (!selectedInvoice) {
      alert('Please select an invoice');
      return;
    }
    
    if (!reason.trim()) {
      alert('Please provide a return reason');
      return;
    }

    if (!isFullReturn) {
      const selectedItems = returnItems.filter(item => item.selected && item.returnQuantity > 0);
      if (selectedItems.length === 0) {
        alert('Please select items to return');
        return;
      }
    }

    try {
      setSubmitting(true);
      
      const returnData = {
        original_invoice: selectedInvoice,
        posting_date: postingDate,
        custom_return_reason: reason
      };

      // Add items array only for partial return
      if (!isFullReturn) {
        const selectedItems = returnItems.filter(item => item.selected && item.returnQuantity > 0);
        returnData.items = selectedItems.map(item => ({
          item_code: item.code || item.item_code,
          qty: item.returnQuantity
        }));
      }

      const result = await createSalesReturn(returnData);
      
      if (result && result.return_invoice) {
        setSuccessDialog({
          isOpen: true,
          title: 'Success',
          message: 'Return created successfully!'
        });
        // Reset form
        setSelectedInvoice('');
        setInvoiceDetails(null);
        setReturnItems([]);
        setReason('');
        setPostingDate(new Date().toISOString().split('T')[0]);
        setIsFullReturn(true);
        setView('list');
        fetchReturns();
      } else {
        setErrorDialog({
          isOpen: true,
          title: 'Error',
          message: 'Failed to create return. Please try again.'
        });
      }
    } catch (error) {
      console.error('Error creating return:', error);
      setErrorDialog({
        isOpen: true,
        title: 'Error Creating Return',
        message: error.message || 'Unknown error'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewDetails = async (returnItem) => {
    setSelectedReturn(returnItem);
    setView('detail');
    setLoadingDetail(true);
    
    try {
      const returnName = returnItem.name || returnItem.return_invoice || returnItem.id;
      const details = await getSalesReturnDetails(returnName);
      setReturnDetail(details);
    } catch (error) {
      console.error('Error fetching return details:', error);
      alert('Failed to load return details');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSubmitReturn = async () => {
    if (!selectedReturn) return;
    
    if (createPayment && !paymentMethod) {
      alert('Please select a payment method');
      return;
    }

    try {
      setSubmittingReturn(true);
      const returnName = selectedReturn.name || selectedReturn.return_invoice || selectedReturn.id;
      const result = await submitSalesReturn(returnName, createPayment, paymentMethod);
      
      setSuccessDialog({
        isOpen: true,
        title: 'Success',
        message: 'Return submitted successfully!'
      });
      setShowSubmitModal(false);
      setCreatePayment(false);
      setPaymentMethod('Credit');
      
      // Refresh details
      const details = await getSalesReturnDetails(returnName);
      setReturnDetail(details);
      setSelectedReturn({ ...selectedReturn, docstatus: 1, status: 'Submitted' });
      
      // Refresh list
      fetchReturns();
    } catch (error) {
      console.error('Error submitting return:', error);
      setErrorDialog({
        isOpen: true,
        title: 'Error Submitting Return',
        message: error.message || 'Unknown error'
      });
    } finally {
      setSubmittingReturn(false);
    }
  };

  // Detail View
  const successDialogEl = (
    <SuccessDialog
      isOpen={successDialog.isOpen}
      onClose={() => setSuccessDialog({ isOpen: false, title: '', message: '' })}
      title={successDialog.title}
      message={successDialog.message}
    />
  );
  const errorDialogEl = (
    <ErrorDialog
      isOpen={errorDialog.isOpen}
      onClose={() => setErrorDialog({ isOpen: false, title: '', message: '' })}
      title={errorDialog.title}
      message={errorDialog.message}
    />
  );

  if (view === 'detail' && selectedReturn) {
    const returnData = returnDetail || selectedReturn;
    const isDraft = (returnData.docstatus === 0 || returnData.status === 'Draft');
    
    return (
      <>
      <div className="return-detail fade-in">
        <div className="flex-between mb-6">
          <h1>Return Details</h1>
          <button className="btn btn-secondary" onClick={() => {
            setView('list');
            setSelectedReturn(null);
            setReturnDetail(null);
          }}>
            Back to List
          </button>
        </div>

        {loadingDetail ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto', color: 'var(--primary)' }} />
            <p style={{ marginTop: '1rem', color: 'var(--gray-600)' }}>Loading return details...</p>
          </div>
        ) : (
          <>
            <div className="card mb-4">
              <div className="flex-between mb-4">
                <h3 className="mb-0">Return Information</h3>
                {!isDraft && (returnData.name || returnData.return_invoice) && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => openPrintPdf('Sales Invoice', returnData.name || returnData.return_invoice, returnData.letter_head).catch((e) => alert(e?.message || 'Print failed'))}
                    title="Print (default format with letterhead)"
                  >
                    🖨️ Print
                  </button>
                )}
              </div>
              <div className="grid grid-3 gap-4">
                <div>
                  <div className="text-xs text-gray-600 mb-1">Return Invoice</div>
                  <div className="font-semibold">{returnData.name || returnData.return_invoice || selectedReturn.id}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">Original Invoice</div>
                  <div className="font-semibold">{returnData.original_invoice || returnData.against_sales_invoice || returnData.return_against || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">Posting Date</div>
                  <div className="font-semibold">
                    {returnData.posting_date ? formatDate(returnData.posting_date) : '-'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">Customer</div>
                  <div className="font-semibold">{returnData.customer_name || returnData.customer || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">Status</div>
                  <div>
                    <span className={`badge ${isDraft ? 'badge-warning' : 'badge-success'}`}>
                      {returnData.status || (isDraft ? 'Draft' : 'Submitted')}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">Total Amount</div>
                  <div className="font-bold text-xl">
                    <SARSymbol size={18} /> {(returnData.grand_total || returnData.total || 0).toFixed(2)}
                  </div>
                </div>
              </div>
              {returnData.custom_return_reason && (
                <div className="mt-4">
                  <div className="text-xs text-gray-600 mb-1">Return Reason</div>
                  <div className="p-3 bg-gray-50 rounded-lg">{returnData.custom_return_reason}</div>
                </div>
              )}
            </div>

            {returnData.items && returnData.items.length > 0 && (
              <div className="card mb-4">
                <h3 className="mb-4">Return Items</h3>
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Item Code</th>
                        <th>Item Name</th>
                        <th>Quantity</th>
                        <th>Rate</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {returnData.items.map((item, index) => (
                        <tr key={index}>
                          <td className="font-semibold">{item.item_code || item.code || '-'}</td>
                          <td>{item.item_name || item.name || '-'}</td>
                          <td>{item.qty || item.quantity || 0}</td>
                          <td><SARSymbol size={16} /> {(item.rate || item.price || 0).toFixed(2)}</td>
                          <td className="font-semibold">
                            <SARSymbol size={16} /> {((item.rate || item.price || 0) * (item.qty || item.quantity || 0)).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {isDraft && (
              <div className="card">
                <button 
                  className="btn btn-primary"
                  onClick={() => setShowSubmitModal(true)}
                  disabled={submittingReturn}
                >
                  <CheckCircle size={20} />
                  Submit Return
                </button>
              </div>
            )}

            {showSubmitModal && (
              <div className="modal-overlay" onClick={() => !submittingReturn && setShowSubmitModal(false)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                  <div className="flex-between mb-4">
                    <h3>Submit Return</h3>
                    <button 
                      className="btn btn-sm btn-secondary"
                      onClick={() => setShowSubmitModal(false)}
                      disabled={submittingReturn}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  
                  <div className="form-group mb-4">
                    <label className="form-label">Payment Method</label>
                    <select
                      className="form-select"
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      disabled={submittingReturn}
                    >
                      <option value="Credit">Credit (No Payment)</option>
                      <option value="Cash">Cash</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="Cheque">Cheque</option>
                    </select>
                  </div>

                  <div className="form-group mb-4">
                    <label className="form-label">
                      <input
                        type="checkbox"
                        checked={createPayment}
                        onChange={(e) => setCreatePayment(e.target.checked)}
                        disabled={submittingReturn}
                        style={{ marginRight: '0.5rem' }}
                      />
                      Create Payment Entry
                    </label>
                    <p className="text-xs text-gray-600 mt-1">
                      {createPayment 
                        ? 'A payment entry will be created for the refund'
                        : 'Customer will receive credit to their account'}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      className="btn btn-primary"
                      onClick={handleSubmitReturn}
                      disabled={submittingReturn}
                    >
                      {submittingReturn ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          <CheckCircle size={18} />
                          Submit
                        </>
                      )}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setShowSubmitModal(false)}
                      disabled={submittingReturn}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {successDialogEl}
      {errorDialogEl}
      </>
    );
  }

  // Create View
  if (view === 'create') {
    return (
      <>
      <div className="return-create fade-in">
        <div className="flex-between mb-6">
          <h1>New Sales Return</h1>
          <button className="btn btn-secondary" onClick={() => {
            setView('list');
            setSelectedCustomerForReturn('');
            setCustomerSearch('');
            setSelectedInvoice('');
            setInvoiceDetails(null);
            setReturnItems([]);
            setReason('');
            setPostingDate(new Date().toISOString().split('T')[0]);
            setIsFullReturn(true);
          }}>
            Back to List
          </button>
        </div>

        <form onSubmit={handleCreateReturn}>
          <div className="card mb-4">
            <h3 className="mb-4">Customer Selection</h3>
            <div className="form-group customer-search-container" style={{ position: 'relative' }} ref={customerDropdownRef}>
              <label className="form-label">Select Customer *</label>
              <div className="text-xs text-gray-500 mb-1">Showing customers assigned to you</div>
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'relative' }}>
                  <Search 
                    size={18} 
                    style={{ 
                      position: 'absolute', 
                      left: '12px', 
                      top: '50%', 
                      transform: 'translateY(-50%)', 
                      color: 'var(--gray-400)',
                      pointerEvents: 'none'
                    }} 
                  />
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search customer by name, mobile, or email..."
                    value={selectedCustomerForReturn ? ((customers || []).find(c => c.id === selectedCustomerForReturn)?.name || customerSearch) : customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      if (!e.target.value) {
                        setSelectedCustomerForReturn('');
                        setSelectedInvoice('');
                        setInvoiceDetails(null);
                        setReturnItems([]);
                      }
                    }}
                    onFocus={() => {
                      if (!selectedCustomerForReturn && (customerSearch || (customers && customers.length > 0))) {
                        setShowCustomerResults(true);
                      }
                    }}
                    style={{ paddingLeft: '40px' }}
                    required={!selectedCustomerForReturn}
                  />
                </div>
                
                {showCustomerResults && !selectedCustomerForReturn && (customerSearch || filteredCustomers.length > 0 || (customers && customers.length > 0)) && (
                  <div 
                    className="card" 
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      marginTop: '4px',
                      maxHeight: '300px',
                      overflowY: 'auto',
                      zIndex: 1000,
                      boxShadow: 'var(--shadow-lg)',
                      padding: 0
                    }}
                  >
                    {filteredCustomers.length > 0 ? (
                      filteredCustomers.map(customer => (
                        <div
                          key={customer.id}
                          onClick={() => {
                            setSelectedCustomerForReturn(customer.id);
                            setCustomerSearch('');
                            setShowCustomerResults(false);
                            // Reset invoice selection when customer changes
                            setSelectedInvoice('');
                            setInvoiceDetails(null);
                            setReturnItems([]);
                          }}
                          style={{
                            padding: '12px 16px',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--gray-100)',
                            transition: 'background 0.2s'
                          }}
                          onMouseEnter={(e) => e.target.style.background = 'var(--gray-50)'}
                          onMouseLeave={(e) => e.target.style.background = 'transparent'}
                        >
                          <div style={{ fontWeight: 600, marginBottom: '4px' }}>{customer.name}</div>
                          {customer.email && (
                            <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>
                              ✉️ {customer.email}
                            </div>
                          )}
                        </div>
                      ))
                    ) : customerSearch ? (
                      <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gray-500)' }}>
                        No customers found matching "{customerSearch}"
                      </div>
                    ) : !customerSearch && customers && customers.length > 0 ? (
                      customers.slice(0, 10).map(customer => (
                        <div
                          key={customer.id}
                          onClick={() => {
                            setSelectedCustomerForReturn(customer.id);
                            setCustomerSearch('');
                            setShowCustomerResults(false);
                            // Reset invoice selection when customer changes
                            setSelectedInvoice('');
                            setInvoiceDetails(null);
                            setReturnItems([]);
                          }}
                          style={{
                            padding: '12px 16px',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--gray-100)',
                            transition: 'background 0.2s'
                          }}
                          onMouseEnter={(e) => e.target.style.background = 'var(--gray-50)'}
                          onMouseLeave={(e) => e.target.style.background = 'transparent'}
                        >
                          <div style={{ fontWeight: 600, marginBottom: '4px' }}>{customer.name}</div>
                          {customer.email && (
                            <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>
                              ✉️ {customer.email}
                            </div>
                          )}
                        </div>
                      ))
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            {selectedCustomerForReturn && (() => {
              const customer = (customers || []).find(c => c.id === selectedCustomerForReturn);
              return customer ? (
                <div style={{ padding: '1rem', background: 'var(--gray-50)', borderRadius: 'var(--radius-lg)', marginTop: '1rem' }}>
                  <div className="grid grid-3 gap-4">
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Customer Name</div>
                      <div className="font-semibold">{customer.name}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Customer Group</div>
                      <div className="font-semibold">{customer.customer_group || '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">VAT Number</div>
                      <div className="font-semibold">{customer.custom_vat_registration_number || '—'}</div>
                    </div>
                  </div>
                </div>
              ) : null;
            })()}
          </div>

          {selectedCustomerForReturn && (
            <>
            <div className="card mb-4">
              <h3 className="mb-4">Select Invoice</h3>
            <div className="form-group">
              <label className="form-label">Invoice *</label>
              <div style={{ position: 'relative' }} ref={invoiceDropdownRef}>
                <button
                  type="button"
                  className="form-select"
                  onClick={() => setShowInvoiceDropdown(!showInvoiceDropdown)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    background: 'white',
                    border: '1px solid var(--gray-300)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                    fontSize: '0.875rem'
                  }}
                >
                  <span>
                    {selectedInvoice || '-- Select an invoice --'}
                  </span>
                  <ChevronDown size={18} style={{ color: 'var(--gray-400)' }} />
                </button>
                {showInvoiceDropdown && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      marginTop: '4px',
                      background: 'white',
                      border: '1px solid var(--gray-300)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: 'var(--shadow-lg)',
                      zIndex: 1000,
                      maxHeight: '300px',
                      overflowY: 'auto'
                    }}
                  >
                    {availableInvoices.length === 0 ? (
                      <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--gray-500)' }}>
                        {loading ? 'Loading invoices...' : 'No submitted invoices available. Draft and cancelled invoices cannot be returned.'}
                      </div>
                    ) : (
                      availableInvoices.map(invoice => (
                        <div
                          key={invoice.id || invoice.name}
                          onClick={() => {
                            setSelectedInvoice(invoice.id || invoice.name);
                            setShowInvoiceDropdown(false);
                          }}
                          style={{
                            padding: 'var(--space-3) var(--space-4)',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--gray-100)',
                            transition: 'background 0.2s',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--gray-50)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                        >
                          <div>
                            <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                              {invoice.id || invoice.name}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>
                              {invoice.customerName || invoice.customer_name || invoice.customer || '-'}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                            <SARSymbol size={16} />
                            {(invoice.total || invoice.grand_total || 0).toFixed(2)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="form-group mt-4">
              <label className="form-label">Posting Date *</label>
              <input
                type="date"
                className="form-input"
                value={postingDate}
                onChange={(e) => setPostingDate(e.target.value)}
                required
              />
            </div>
            </div>

            {invoiceDetails && (
              <>
                <div className="card mb-4">
                  <h3 className="mb-4">Return Type</h3>
                  <div className="form-group">
                  <label className="form-label">
                    <input
                      type="radio"
                      checked={isFullReturn}
                      onChange={() => setIsFullReturn(true)}
                      style={{ marginRight: '0.5rem' }}
                    />
                    Full Return (All Items)
                  </label>
                  <label className="form-label" style={{ marginLeft: '2rem' }}>
                    <input
                      type="radio"
                      checked={!isFullReturn}
                      onChange={() => setIsFullReturn(false)}
                      style={{ marginRight: '0.5rem' }}
                    />
                    Partial Return (Select Items)
                  </label>
                </div>
              </div>

              {!isFullReturn && returnItems.length > 0 && (
                <div className="card mb-4">
                  <h3 className="mb-4">Select Items to Return</h3>
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Select</th>
                          <th>Item Code</th>
                          <th>Item Name</th>
                          <th>Original Qty</th>
                          <th>Return Qty</th>
                          <th>Price</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {returnItems.map((item, index) => (
                          <tr key={index}>
                            <td>
                              <input
                                type="checkbox"
                                checked={item.selected}
                                onChange={() => handleToggleItem(index)}
                                style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                              />
                            </td>
                            <td className="font-semibold">{item.code || item.item_code}</td>
                            <td>{item.name || item.item_name}</td>
                            <td>{item.quantity || item.qty || 0}</td>
                            <td>
                              <input
                                type="number"
                                value={item.returnQuantity || 0}
                                onChange={(e) => handleUpdateQuantity(index, e.target.value)}
                                disabled={!item.selected}
                                min="0"
                                max={item.quantity || item.qty || 0}
                                style={{ width: '70px', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--gray-300)' }}
                              />
                            </td>
                            <td><SARSymbol size={16} /> {(item.price || item.rate || 0).toFixed(2)}</td>
                            <td className="font-semibold">
                              <SARSymbol size={16} /> {((item.price || item.rate || 0) * (item.returnQuantity || 0)).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="card mb-4">
                <h3 className="mb-4">Return Reason</h3>
                <div className="form-group">
                  <label className="form-label">Reason for Return *</label>
                  <textarea
                    className="form-textarea"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Explain the reason for this return..."
                    required
                  />
                </div>

                <button 
                  type="submit" 
                  className="btn btn-danger"
                  disabled={submitting || loading}
                >
                  {submitting ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <RotateCcw size={20} />
                      Create Return
                    </>
                  )}
                </button>
              </div>
              </>
            )}
            </>
          )}
        </form>
      </div>
      {successDialogEl}
      {errorDialogEl}
      </>
    );
  }

  // List View
  return (
    <>
    <div className="return-list fade-in">
      <div className="flex-between mb-6">
        <h1>Sales Returns</h1>
        <button className="btn btn-primary" onClick={() => setView('create')}>
          <Plus size={20} />
          New Return
        </button>
      </div>

      {loading || loadingSales ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto', color: 'var(--primary)' }} />
          <p style={{ marginTop: '1rem', color: 'var(--gray-600)' }}>Loading returns...</p>
        </div>
      ) : returns.length > 0 ? (
        <div className="card">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Return Invoice</th>
                  <th>Date</th>
                  <th>Original Invoice</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((ret, index) => (
                  <tr 
                    key={ret.name || ret.return_invoice || ret.id || index}
                    onClick={() => handleViewDetails(ret)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-50)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <td className="font-semibold">{ret.name || ret.return_invoice || ret.id}</td>
                    <td>
                      {ret.posting_date ? formatDate(ret.posting_date) : '-'}
                    </td>
                    <td>{ret.original_invoice || ret.against_sales_invoice || '-'}</td>
                    <td>{ret.customer_name || ret.customer || '-'}</td>
                    <td className="font-semibold" style={{ color: 'var(--danger)' }}>
                      <SARSymbol size={16} /> {(ret.grand_total || ret.total || 0).toFixed(2)}
                    </td>
                    <td>
                      <span className={`badge ${(ret.docstatus === 0 || ret.status === 'Draft') ? 'badge-warning' : 'badge-success'}`}>
                        {ret.status || (ret.docstatus === 0 ? 'Draft' : 'Submitted')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">↩️</div>
            <div className="empty-state-title">No returns yet</div>
            <p>Process your first sales return</p>
            <button className="btn btn-primary mt-4" onClick={() => setView('create')}>
              <Plus size={20} />
              Create First Return
            </button>
          </div>
        </div>
      )}
    </div>
    {successDialogEl}
    {errorDialogEl}
    </>
  );
}

export default SalesReturnModule;
