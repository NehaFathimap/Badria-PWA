import * as React from 'react';
import { useState, useEffect } from 'react';
import { Plus, Search, Loader2, X } from 'lucide-react';
import SARSymbol from './SARSymbol';
import SuccessDialog from './SuccessDialog';
import { createPaymentEntry, getOutstandingInvoicesForPayment, getPaymentEntryDetails, getPaymentMethods, openPrintPdf } from '../services/api';
import { Trash2 } from 'lucide-react';

function PaymentModule({ customers, sales, payments, onAddPayment, loadingCustomers, loadingPayments, loadingSales }) {
  const [view, setView] = useState('list'); // 'list', 'create', 'detail'
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState([]);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [paymentDetails, setPaymentDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [formData, setFormData] = useState({
    customerId: '',
    amount: '',
    paymentMethod: 'Cash',
    paymentDate: new Date().toISOString().split('T')[0],
    reference: '',
    notes: ''
  });

  // Filter customers based on search query
  useEffect(() => {
    if (customerSearch.trim() && !formData.customerId) {
      const filtered = customers.filter(customer =>
        customer.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        (customer.custom_customer_name_english || customer.name)?.toLowerCase().includes(customerSearch.toLowerCase()) ||
        (customer.custom_customer_name_arabic || '')?.toLowerCase().includes(customerSearch.toLowerCase())
      );
      setFilteredCustomers(filtered);
      setShowCustomerResults(true);
    } else {
      setFilteredCustomers([]);
      setShowCustomerResults(false);
    }
  }, [customerSearch, customers, formData.customerId]);

  // Close customer dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showCustomerResults && !event.target.closest('.customer-search-container')) {
        setShowCustomerResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCustomerResults]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleRemoveInvoice = (invoiceName) => {
    setSelectedInvoices(selectedInvoices.filter(inv => inv.invoice_name !== invoiceName));
  };

  const handleAllocatedAmountChange = (invoiceName, value) => {
    // Allow digits and one decimal point so user can type floats (e.g. "12.5" or "12.")
    let sanitized = value.replace(/[^0-9.]/g, '');
    const dotIndex = sanitized.indexOf('.');
    if (dotIndex >= 0) {
      sanitized = sanitized.slice(0, dotIndex + 1) + sanitized.slice(dotIndex + 1).replace(/\./g, '');
    }
    setSelectedInvoices(selectedInvoices.map(inv =>
      inv.invoice_name === invoiceName
        ? { ...inv, allocated_amount: sanitized === '' ? '' : sanitized }
        : inv
    ));
  };

  const [submitting, setSubmitting] = useState(false);
  const [successDialog, setSuccessDialog] = useState({ isOpen: false, title: '', message: '' });
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState([]);

  // Fetch enabled payment methods (Mode of Payment) for user's company
  useEffect(() => {
    getPaymentMethods().then((list) => {
      if (Array.isArray(list) && list.length > 0) {
        setPaymentMethods(list);
        setFormData(prev => ({ ...prev, paymentMethod: prev.paymentMethod && list.includes(prev.paymentMethod) ? prev.paymentMethod : list[0] }));
      }
    }).catch(() => setPaymentMethods([]));
  }, []);

  // Fetch outstanding invoices when customer is selected
  useEffect(() => {
    const fetchOutstandingInvoices = async () => {
      if (formData.customerId) {
      const customer = customers.find(c => c.id === formData.customerId);
      if (customer) {
          setLoadingInvoices(true);
          try {
            // Fetch outstanding invoices from API
            const outstandingInvoices = await getOutstandingInvoicesForPayment(customer.name);
            
            // Transform API response to match expected format
            const invoicesWithAllocation = outstandingInvoices.map((invoice, index) => {
              const outstandingAmount = parseFloat(invoice.outstanding_amount || invoice.outstanding || invoice.outstanding_amount || 0);
              // Try multiple possible field names for invoice name
              const invoiceName = invoice.name || 
                                 invoice.invoice_name || 
                                 invoice.invoice || 
                                 invoice.voucher_no ||
                                 invoice.reference_name ||
                                 invoice.id ||
                                 invoice.invoice_no ||
                                 `Invoice-${index + 1}`;
              
          return {
                invoice_name: invoiceName,
                name: invoiceName,
            allocated_amount: outstandingAmount,
            outstanding_amount: outstandingAmount
          };
        });
        setSelectedInvoices(invoicesWithAllocation);
          } catch (error) {
            console.error('Error fetching outstanding invoices:', error);
            // Fallback to empty array if API fails
            setSelectedInvoices([]);
          } finally {
            setLoadingInvoices(false);
          }
      }
    } else {
      setSelectedInvoices([]);
    }
    };

    fetchOutstandingInvoices();
  }, [formData.customerId, customers]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const customer = customers.find(c => c.id === formData.customerId);
    
    if (!customer) {
      alert('Please select a customer');
      return;
    }

    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      alert('Please enter a valid payment amount');
      return;
    }

    // Validation for POS Machine
    if (formData.paymentMethod === 'POS Machine' && !formData.reference) {
      alert('Please enter reference number for POS Machine payment');
      return;
    }

    // Validate total allocated amount doesn't exceed paid amount
    const paidAmount = parseFloat(formData.amount);
    const totalAllocated = selectedInvoices.reduce((sum, inv) => {
      return sum + (parseFloat(inv.allocated_amount) || 0);
    }, 0);

    if (totalAllocated > paidAmount) {
      alert(`Total allocated amount (${totalAllocated.toFixed(2)}) exceeds paid amount (${paidAmount.toFixed(2)}). Please adjust the allocated amounts.`);
      return;
    }

    setSubmitting(true);

    try {
      // Transform UI format to API format
      const paymentData = {
        party_type: 'Customer',
        party: customer.name,
        payment_type: 'Receive',
        posting_date: formData.paymentDate,
        mode_of_payment: formData.paymentMethod,
        paid_amount: parseFloat(formData.amount),
        reference_no: formData.reference || '',
        reference_date: formData.paymentDate,
        remarks: formData.notes || '',
        submit: false, // Create as draft, can be submitted later
        invoices: selectedInvoices.map(inv => ({
          reference_name: inv.invoice_name || inv.name,
          allocated_amount: parseFloat(inv.allocated_amount) || 0
        }))
      };

      const response = await createPaymentEntry(paymentData);
      
      // Extract payment entry name from response - check multiple possible locations
      const paymentEntryName = response.name || 
                               response.payment_entry || 
                               response.message?.name || 
                               response.message?.payment_entry ||
                               response.data?.name ||
                               response.data?.payment_entry;
      
      // Call the parent callback with payment entry name
      onAddPayment({
        customerId: customer.id,
        customerName: customer.name,
        date: formData.paymentDate,
        amount: parseFloat(formData.amount),
        paymentMethod: formData.paymentMethod,
        reference: formData.reference,
        notes: formData.notes,
        paymentEntry: paymentEntryName,
        id: paymentEntryName || `PAY-${Date.now()}`
      });

      // Reset form (use first available payment method if list loaded)
      setFormData({
        customerId: '',
        amount: '',
        paymentMethod: paymentMethods.length ? paymentMethods[0] : 'Cash',
        paymentDate: new Date().toISOString().split('T')[0],
        reference: '',
        notes: ''
      });
      setCustomerSearch('');
      setSelectedInvoices([]);
      setView('list');
      setSuccessDialog({ isOpen: true, title: 'Success', message: 'Payment collected successfully!' });
    } catch (error) {
      console.error('Error creating payment:', error);
      
      // Parse API error message
      let errorMessage = error.message || 'Please try again';
      
      // Check if error contains nested message object (API response format)
      if (error.message && typeof error.message === 'object' && error.message.message) {
        errorMessage = error.message.message;
      } else if (error.response && error.response.message) {
        const apiError = error.response.message;
        if (typeof apiError === 'object' && apiError.message) {
          errorMessage = apiError.message;
        } else if (typeof apiError === 'string') {
          errorMessage = apiError;
        }
      }
      
      alert(`Error creating payment: ${errorMessage}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewDetails = async (payment) => {
    setSelectedPayment(payment);
    setView('detail');
    setLoadingDetails(true);
    
    try {
      // Get payment entry name from payment object - check multiple possible fields
      const paymentEntryName = payment.paymentEntry || 
                               payment.payment_entry ||
                               payment.id || 
                               payment.name ||
                               payment.reference_name;
      
      if (paymentEntryName) {
        // Fetch fresh details from backend to ensure we have complete data
        const details = await getPaymentEntryDetails(paymentEntryName);
        setPaymentDetails(details);
      } else {
        // Fallback to payment data if no entry name
        console.warn('No payment entry name found, using payment object data');
        setPaymentDetails(payment);
      }
    } catch (error) {
      console.error('Error fetching payment details:', error);
      // Fallback to payment data if API fails
      setPaymentDetails(payment);
    } finally {
      setLoadingDetails(false);
    }
  };

  const getMethodBadgeClass = (method) => {
    switch (method) {
      case 'Cash': return 'badge-warning';
      case 'Bank Transfer': return 'badge-info';
      case 'SHABAKA': return 'badge-success';
      default: return 'badge-gray';
    }
  };

  // Format date as DD/MM/YY
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
  };

  if (view === 'create') {
    return (
      <div className="payment-create fade-in">
        <div className="flex-between mb-6">
          <h1>Collect Payment</h1>
          <button className="btn btn-secondary" onClick={() => setView('list')}>
            Back to List
          </button>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="grid grid-2">
              <div className="form-group customer-search-container" style={{ position: 'relative' }}>
                <label className="form-label">Customer *</label>
                <div className="text-xs text-gray-500 mb-1">Payment collection: showing customers assigned to you</div>
                <div style={{ position: 'relative' }}>
                  <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
                  <input
                    type="text"
                    className="form-input"
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setFormData({ ...formData, customerId: '' });
                    }}
                    placeholder="Search customer by name..."
                    style={{ paddingLeft: '40px' }}
                  />
                </div>
                {showCustomerResults && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid var(--gray-200)',
                    borderRadius: 'var(--radius)',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    zIndex: 1000,
                    marginTop: '4px'
                  }}>
                    {filteredCustomers.length > 0 ? (
                      filteredCustomers.map(customer => (
                        <div
                          key={customer.id}
                          onClick={() => {
                            setFormData({ ...formData, customerId: customer.id });
                            setCustomerSearch('');
                            setShowCustomerResults(false);
                          }}
                          style={{
                            padding: '12px 16px',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--gray-100)',
                            transition: 'background 0.2s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--gray-50)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                        >
                          <div className="font-semibold">{customer.custom_customer_name_english || customer.name}</div>
                          {customer.custom_customer_name_arabic && (
                            <div className="text-sm text-gray-500 mt-1">{customer.custom_customer_name_arabic}</div>
                          )}
                          {customer.balance !== undefined && customer.balance !== null && (
                            <div className="text-sm text-gray-600 mt-1">
                              Balance: <SARSymbol size={16} /> {customer.balance.toFixed(2)}
                            </div>
                          )}
                        </div>
                      ))
                    ) : customerSearch ? (
                      <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gray-500)' }}>
                        No customers found matching "{customerSearch}"
                      </div>
                    ) : null}
                  </div>
                )}
                {formData.customerId && !customerSearch && (() => {
                  const selectedCustomer = customers.find(c => c.id === formData.customerId);
                  return selectedCustomer ? (
                    <div style={{ marginTop: '8px', padding: '12px', background: 'var(--gray-50)', borderRadius: 'var(--radius)', position: 'relative' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({ ...formData, customerId: '' });
                          setCustomerSearch('');
                          setSelectedInvoices([]);
                        }}
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--gray-500)',
                          borderRadius: 'var(--radius-sm)',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--gray-200)';
                          e.currentTarget.style.color = 'var(--gray-700)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'none';
                          e.currentTarget.style.color = 'var(--gray-500)';
                        }}
                        title="Remove selected customer"
                      >
                        <X size={18} />
                      </button>
                      <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '4px', paddingRight: '32px' }}>Selected Customer:</div>
                      <div className="font-semibold" style={{ paddingRight: '32px' }}>
                        {selectedCustomer.custom_customer_name_english || selectedCustomer.name}
                        {selectedCustomer.custom_customer_name_arabic && (
                          <div className="text-xs text-gray-500 mt-1">{selectedCustomer.custom_customer_name_arabic}</div>
                        )}
                      </div>
                      {selectedCustomer.balance !== undefined && selectedCustomer.balance !== null && (
                        <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginTop: '4px' }}>
                          Balance: <SARSymbol size={14} /> {selectedCustomer.balance.toFixed(2)}
                  </div>
                )}
                      {loadingInvoices && (
                        <div style={{ fontSize: '0.875rem', color: 'var(--gray-500)', marginTop: '4px' }}>
                          Loading invoices...
                        </div>
                      )}
                      {!loadingInvoices && selectedInvoices.length > 0 && (
                        <div style={{ fontSize: '0.875rem', color: 'var(--primary)', marginTop: '4px' }}>
                          {selectedInvoices.length} unpaid invoice(s) found
                        </div>
                      )}
                    </div>
                  ) : null;
                })()}
              </div>

              <div className="form-group">
                <label className="form-label">Amount *</label>
                <input
                  type="number"
                  name="amount"
                  className="form-input"
                  value={formData.amount}
                  onChange={handleChange}
                  placeholder="0.00"
                  step="0.01"
                  min="0.01"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Payment Method *</label>
                <select
                  name="paymentMethod"
                  className="form-select"
                  value={formData.paymentMethod}
                  onChange={handleChange}
                  required
                >
                  {paymentMethods.length > 0 ? (
                    paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)
                  ) : (
                    <option value="Cash">Cash</option>
                  )}
                </select>
              </div>

              {formData.paymentMethod === 'POS Machine' && (
                <>
                  <div className="form-group">
                    <label className="form-label">Payment Date *</label>
                    <input
                      type="date"
                      name="paymentDate"
                      className="form-input"
                      value={formData.paymentDate}
                      onChange={handleChange}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Reference Number *</label>
                    <input
                      type="text"
                      name="reference"
                      className="form-input"
                      value={formData.reference}
                      onChange={handleChange}
                      placeholder="Enter POS reference number"
                      required
                    />
                  </div>
                </>
              )}

              {formData.paymentMethod !== 'POS Machine' && (
                <div className="form-group">
                  <label className="form-label">Reference Number</label>
                  <input
                    type="text"
                    name="reference"
                    className="form-input"
                    value={formData.reference}
                    onChange={handleChange}
                    placeholder="Transaction reference (optional)"
                  />
                </div>
              )}
            </div>

            {/* Invoice Table - Separate section */}
            {formData.customerId && (() => {
              if (loadingInvoices) {
                return (
                  <div className="form-group">
                    <label className="form-label">Unpaid Invoices</label>
                    <div className="card" style={{ marginTop: '8px', padding: '2rem', textAlign: 'center' }}>
                      <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto' }} />
                      <div style={{ marginTop: '1rem', color: 'var(--gray-600)' }}>Loading unpaid invoices...</div>
                    </div>
                  </div>
                );
              }

              if (selectedInvoices.length === 0) {
                return (
                  <div className="form-group">
                    <label className="form-label">Unpaid Invoices</label>
                    <div className="card" style={{ marginTop: '8px', padding: '2rem', textAlign: 'center', background: 'var(--gray-50)' }}>
                      <div style={{ color: 'var(--gray-500)' }}>No unpaid invoices found for this customer</div>
                    </div>
                  </div>
                );
              }

              const paidAmount = parseFloat(formData.amount) || 0;
              const totalAllocated = selectedInvoices.reduce((sum, inv) => {
                return sum + (parseFloat(inv.allocated_amount) || 0);
              }, 0);
              const exceedsLimit = totalAllocated > paidAmount;
              
              return (
                <div className="form-group">
                  <label className="form-label">Unpaid Invoices</label>
                  {paidAmount > 0 && (
                    <div style={{ 
                      marginBottom: '8px', 
                      padding: '8px 12px', 
                      borderRadius: 'var(--radius)',
                      backgroundColor: exceedsLimit ? 'var(--red-50)' : 'var(--blue-50)',
                      border: `1px solid ${exceedsLimit ? 'var(--red-200)' : 'var(--blue-200)'}`,
                      color: exceedsLimit ? 'var(--red-700)' : 'var(--blue-700)',
                      fontSize: '14px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>
                          <strong>Payment Amount:</strong> <SARSymbol size={14} /> {paidAmount.toFixed(2)}
                        </span>
                        <span>
                          <strong>Total Allocated:</strong> <SARSymbol size={14} /> {totalAllocated.toFixed(2)}
                        </span>
                      </div>
                      {exceedsLimit && (
                        <div style={{ marginTop: '4px', fontSize: '13px', fontWeight: '600' }}>
                          ⚠️ Total allocated amount exceeds payment amount by <SARSymbol size={12} /> {(totalAllocated - paidAmount).toFixed(2)}
                        </div>
                      )}
                      {!exceedsLimit && totalAllocated > 0 && (
                        <div style={{ marginTop: '4px', fontSize: '13px', color: 'var(--gray-600)' }}>
                          Remaining: <SARSymbol size={12} /> {(paidAmount - totalAllocated).toFixed(2)}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="card" style={{ marginTop: '8px' }}>
                    <div className="table-container">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Invoice Name</th>
                            <th>Outstanding Amount</th>
                            <th>Allocated Amount</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedInvoices.map((invoice, index) => (
                            <tr key={invoice.invoice_name || `invoice-${index}`}>
                              <td className="font-semibold">{invoice.invoice_name || invoice.name || `Invoice ${index + 1}`}</td>
                              <td><SARSymbol size={16} /> {(invoice.outstanding_amount || 0).toFixed(2)}</td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <SARSymbol size={16} />
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    className="form-input"
                                    value={invoice.allocated_amount === undefined || invoice.allocated_amount === null ? '0' : (invoice.allocated_amount === '' ? '' : String(invoice.allocated_amount))}
                                    onChange={(e) => handleAllocatedAmountChange(invoice.invoice_name, e.target.value)}
                                    placeholder="0.00"
                                    style={{ 
                                      width: '120px', 
                                      padding: '6px 8px',
                                      borderColor: exceedsLimit ? 'var(--red-300)' : undefined
                                    }}
                                  />
                                </div>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveInvoice(invoice.invoice_name)}
                                  className="btn btn-danger btn-sm"
                                  title="Remove invoice"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea
                name="notes"
                className="form-textarea"
                value={formData.notes}
                onChange={handleChange}
                placeholder="Add any notes about this payment..."
              />
            </div>

            <div className="flex gap-3">
              <button type="submit" className="btn btn-success" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <SARSymbol size={20} />
                    Collect Payment
                  </>
                )}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setView('list')} disabled={submitting}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Detail View
  if (view === 'detail') {
    const payment = paymentDetails || selectedPayment;
    
    return (
      <div className="payment-detail fade-in">
        <div className="flex-between mb-6">
          <div>
            <button 
              className="btn btn-secondary mb-4"
              onClick={() => setView('list')}
            >
              ← Back to Payments
            </button>
            <h1>Payment Details</h1>
          </div>
        </div>

        {loadingDetails ? (
          <div className="card">
            <div className="empty-state">
              <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
              <div className="empty-state-title mt-4">Loading payment details...</div>
            </div>
          </div>
        ) : payment ? (
          <div className="card">
            {/* Payment Header */}
            <div className="mb-6" style={{ borderBottom: '2px solid var(--gray-200)', paddingBottom: '20px' }}>
              <div className="flex-between mb-4">
                <div>
                  <h2 style={{ margin: 0, color: 'var(--primary)' }}>
                    {payment.name || payment.payment_entry || payment.id}
                  </h2>
                  <div className="text-sm text-gray-600 mt-1">
                    Status: <span className="badge badge-success">
                      {payment.status || (payment.docstatus === 1 ? 'Submitted' : 'Draft')}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  {payment.docstatus === 1 && (payment.name || payment.payment_entry) && (
                    <div style={{ marginBottom: '12px' }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => openPrintPdf('Payment Entry', payment.name || payment.payment_entry, payment.letter_head).catch((e) => alert(e?.message || 'Print failed'))}
                        title="Print (default format with letterhead)"
                      >
                        🖨️ Print Payment
                      </button>
                    </div>
                  )}
                  <div className="text-sm text-gray-600">Date</div>
                  <div className="font-semibold">
                    {formatDate(payment.posting_date || payment.date)}
                  </div>
                </div>
              </div>

              {/* Customer Info */}
              <div className="mb-4">
                <h3 className="mb-2" style={{ fontSize: '1rem', color: 'var(--gray-700)' }}>Customer Information</h3>
                <div style={{ background: 'var(--gray-50)', padding: '16px', borderRadius: 'var(--radius)' }}>
                  <div className="font-semibold">{payment.party || payment.customerName || payment.customer}</div>
                </div>
              </div>
            </div>

            {/* Payment Summary */}
            <div className="mb-6">
              <h3 className="mb-4" style={{ fontSize: '1rem', color: 'var(--gray-700)' }}>Payment Summary</h3>
              <div className="grid grid-2 gap-4 mb-4">
                <div style={{ background: 'var(--gray-50)', padding: '16px', borderRadius: 'var(--radius)' }}>
                  <div className="text-sm text-gray-600 mb-1">Paid Amount</div>
                  <div className="font-bold text-xl" style={{ color: 'var(--secondary)' }}>
                    <SARSymbol size={20} /> {(payment.paid_amount || payment.amount || 0).toFixed(2)}
                  </div>
                </div>
                <div style={{ background: 'var(--gray-50)', padding: '16px', borderRadius: 'var(--radius)' }}>
                  <div className="text-sm text-gray-600 mb-1">Received Amount</div>
                  <div className="font-bold text-xl" style={{ color: 'var(--secondary)' }}>
                    <SARSymbol size={20} /> {(payment.received_amount || payment.paid_amount || payment.amount || 0).toFixed(2)}
                  </div>
                </div>
                <div style={{ background: 'var(--gray-50)', padding: '16px', borderRadius: 'var(--radius)' }}>
                  <div className="text-sm text-gray-600 mb-1">Total Allocated</div>
                  <div className="font-semibold text-lg">
                    <SARSymbol size={18} /> {(payment.total_allocated_amount || 0).toFixed(2)}
                  </div>
                </div>
                <div style={{ background: 'var(--gray-50)', padding: '16px', borderRadius: 'var(--radius)' }}>
                  <div className="text-sm text-gray-600 mb-1">Unallocated Amount</div>
                  <div className="font-semibold text-lg" style={{ color: 'var(--warning)' }}>
                    <SARSymbol size={18} /> {(payment.unallocated_amount || 0).toFixed(2)}
                  </div>
                </div>
              </div>
              <div className="grid grid-2 gap-4">
                <div style={{ background: 'var(--gray-50)', padding: '16px', borderRadius: 'var(--radius)' }}>
                  <div className="text-sm text-gray-600 mb-1">Payment Method</div>
                  <div className="font-semibold">
                    <span className={`badge ${getMethodBadgeClass(payment.mode_of_payment || payment.paymentMethod)}`}>
                      {payment.mode_of_payment || payment.paymentMethod || '-'}
                    </span>
                  </div>
                </div>
                <div style={{ background: 'var(--gray-50)', padding: '16px', borderRadius: 'var(--radius)' }}>
                  <div className="text-sm text-gray-600 mb-1">Payment Type</div>
                  <div className="font-semibold">{payment.payment_type || '-'}</div>
                </div>
              </div>
            </div>

            {/* Allocated Invoices */}
            {payment.references && payment.references.length > 0 && (
              <div className="mb-6">
                <h3 className="mb-4" style={{ fontSize: '1rem', color: 'var(--gray-700)' }}>Allocated Invoices</h3>
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Amount</th>
                        <th>Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payment.references.map((ref, index) => (
                        <tr key={index}>
                          <td className="font-semibold">{ref.reference_name || ref.invoice || '-'}</td>
                          <td><SARSymbol size={16} /> {(ref.allocated_amount || 0).toFixed(2)}</td>
                          <td><SARSymbol size={16} /> {(ref.outstanding_amount || ref.total_amount || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Additional Info */}
            {(payment.reference_no || payment.remarks || payment.notes) && (
              <div className="mb-4">
                <h3 className="mb-2" style={{ fontSize: '1rem', color: 'var(--gray-700)' }}>Additional Information</h3>
                <div style={{ background: 'var(--gray-50)', padding: '16px', borderRadius: 'var(--radius)' }}>
                  {payment.reference_no && (
                    <div className="mb-2">
                      <div className="text-sm text-gray-600">Reference Number</div>
                      <div className="font-semibold">{payment.reference_no}</div>
                    </div>
                  )}
                  {(payment.remarks || payment.notes) && (
                    <div>
                      <div className="text-sm text-gray-600">Notes</div>
                      <div>{payment.remarks || payment.notes || '-'}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 mt-6">
              <button 
                className="btn btn-secondary"
                onClick={() => setView('list')}
              >
                Back to List
              </button>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">❌</div>
              <div className="empty-state-title">Payment not found</div>
              <button 
                className="btn btn-primary mt-4"
                onClick={() => setView('list')}
              >
                Back to Payments
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <SuccessDialog
        isOpen={successDialog.isOpen}
        onClose={() => setSuccessDialog({ isOpen: false, title: '', message: '' })}
        title={successDialog.title}
        message={successDialog.message}
      />
    <div className="payment-list fade-in">
      <div className="flex-between mb-6">
        <h1>Payment Collections</h1>
        <button className="btn btn-primary" onClick={() => setView('create')}>
          <Plus size={20} />
          Collect Payment
        </button>
      </div>

      {loadingPayments || loadingCustomers ? (
        <div className="card">
          <div className="empty-state">
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
            <div className="empty-state-title mt-4">Loading payments...</div>
          </div>
        </div>
      ) : payments.length > 0 ? (
        <div className="card">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Payment ID</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.slice().sort((a, b) => {
                  // Sort by date in descending order (newest first)
                  const dateA = new Date(a.date);
                  const dateB = new Date(b.date);
                  return dateB - dateA;
                }).map(payment => (
                  <tr 
                    key={payment.id}
                    onClick={() => handleViewDetails(payment)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-50)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <td className="font-semibold">{payment.id}</td>
                    <td>{formatDate(payment.date)}</td>
                    <td>{payment.customerName}</td>
                    <td className="font-semibold" style={{ color: 'var(--secondary)' }}>
                      <SARSymbol size={16} /> {payment.amount.toFixed(2)}
                    </td>
                    <td>
                      <span className={`badge ${getMethodBadgeClass(payment.paymentMethod)}`}>
                        {payment.paymentMethod}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${payment.status === 'Submitted' ? 'badge-success' : payment.status === 'Cancelled' ? 'badge-danger' : 'badge-warning'}`}>
                        {payment.status || 'Draft'}
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
            <div className="empty-state-icon">💰</div>
            <div className="empty-state-title">No payments yet</div>
            <p>Collect your first payment</p>
            <button className="btn btn-primary mt-4" onClick={() => setView('create')}>
              <Plus size={20} />
              Collect First Payment
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

export default PaymentModule;
