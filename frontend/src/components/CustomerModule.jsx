import * as React from 'react';
import { useState, useEffect } from 'react';
import { Plus, Eye, X, Loader2, Edit, Trash2, MapPin, Search } from 'lucide-react';
import { 
  createCustomer, 
  getCustomerBillingAndPayments,
  createCustomerAddress,
  getCustomerAddresses,
  updateCustomerAddress,
  deleteCustomerAddress
} from '../services/api';
import SARSymbol from './SARSymbol';

function CustomerModule({ customers, sales, payments, onAddCustomer, loadingCustomers }) {
  const [view, setView] = useState('list'); // 'list', 'create', 'statement'
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [formData, setFormData] = useState({
    custom_customer_name_arabic: '',
    customer_type: 'Individual',
    customer_group: 'Commercial',
    territory: 'Saudi Arabia',
    custom_vat_registration_number: '',
    cr_no: ''
  });
  const [vatError, setVatError] = useState('');
  
  // Address management state
  const [addresses, setAddresses] = useState([]);
  const [addressFormData, setAddressFormData] = useState({
    address_title: '',
    address_line1: '',
    custom_building_number: '',
    custom_area: '',
    city: '',
    country: 'Saudi Arabia',
    pincode: ''
  });
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [editingAddressIndex, setEditingAddressIndex] = useState(null);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [submittingAddress, setSubmittingAddress] = useState(false);
  const [customerCreated, setCustomerCreated] = useState(false);
  const [createdCustomerName, setCreatedCustomerName] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    
    // VAT number validation - only allow digits and enforce 15 digits
    if (name === 'custom_vat_registration_number') {
      // Only allow digits
      const digitsOnly = value.replace(/[^0-9]/g, '');
      // Limit to 15 digits
      const limitedValue = digitsOnly.slice(0, 15);
      setFormData({ ...formData, [name]: limitedValue });
      
      // Validate length
      if (limitedValue.length > 0 && limitedValue.length !== 15) {
        setVatError('VAT number must be exactly 15 digits');
      } else {
        setVatError('');
      }
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleAddressChange = (e) => {
    setAddressFormData({ ...addressFormData, [e.target.name]: e.target.value });
  };

  const handleAddAddress = () => {
    // If address already exists, load it for editing (only one address per customer)
    if (addresses.length > 0) {
      const existingAddress = addresses[0];
      setAddressFormData({
        address_title: existingAddress.address_title || '',
        address_line1: existingAddress.address_line1 || '',
        custom_building_number: existingAddress.custom_building_number || '',
        custom_area: existingAddress.custom_area || '',
        city: existingAddress.city || '',
        country: existingAddress.country || 'Saudi Arabia',
        pincode: existingAddress.pincode || ''
      });
      setEditingAddressIndex(0);
    } else {
      // New address
      setAddressFormData({
        address_title: '',
        address_line1: '',
        custom_building_number: '',
        custom_area: '',
        city: '',
        country: 'Saudi Arabia',
        pincode: ''
      });
      setEditingAddressIndex(null);
    }
    setShowAddressForm(true);
  };

  const handleEditAddress = (index) => {
    const address = addresses[index];
    setAddressFormData({
      address_title: address.address_title || '',
      address_line1: address.address_line1 || '',
      custom_building_number: address.custom_building_number || '',
      custom_area: address.custom_area || '',
      city: address.city || '',
      country: address.country || 'Saudi Arabia',
      pincode: address.pincode || ''
    });
    setEditingAddressIndex(index);
    setShowAddressForm(true);
  };

  const handleSaveAddress = async () => {
    // Validate required fields
    if (!addressFormData.address_line1 || !addressFormData.city || !addressFormData.country) {
      alert('Please fill in all required fields (Address Line 1, City, Country)');
      return;
    }

    // Validate backend-mandatory fields (backend requires non-empty values)
    if (!addressFormData.address_title || !addressFormData.custom_building_number || 
        !addressFormData.custom_area || !addressFormData.pincode) {
      alert('Please fill in all fields. The following are required: Address Title, Building Number, Area, and Pincode.');
      return;
    }

    setSubmittingAddress(true);
    try {
      const customerName = createdCustomerName || selectedCustomer?.name;
      if (!customerName) {
        alert('Customer name is required');
        setSubmittingAddress(false);
        return;
      }

      // Prepare address data exactly as required by API
      // Only these 8 fields should be sent
      const addressData = {
        customer: customerName.trim(),
        address_title: addressFormData.address_title.trim(),
        address_line1: addressFormData.address_line1.trim(),
        custom_building_number: addressFormData.custom_building_number.trim(),
        custom_area: addressFormData.custom_area.trim(),
        city: addressFormData.city.trim(),
        country: addressFormData.country.trim() || 'Saudi Arabia',
        pincode: addressFormData.pincode.trim()
      };

      // Only one address per customer - if address exists, always update; otherwise create
      if (addresses.length > 0 || editingAddressIndex !== null) {
        // Update existing address (only one address per customer)
        await updateCustomerAddress(addressData);
        alert('Address updated successfully!');
      } else {
        // Create new address (only if no address exists)
        await createCustomerAddress(addressData);
        alert('Address added successfully!');
      }

      // Refresh addresses list
      await fetchCustomerAddresses(customerName);
      
      // Reset form
      setShowAddressForm(false);
      setEditingAddressIndex(null);
      setAddressFormData({
        address_title: '',
        address_line1: '',
        custom_building_number: '',
        custom_area: '',
        city: '',
        country: 'Saudi Arabia',
        pincode: ''
      });
    } catch (error) {
      console.error('Error saving address:', error);
      alert(`Error saving address: ${error.message}`);
    } finally {
      setSubmittingAddress(false);
    }
  };

  const handleDeleteAddress = async (addressName) => {
    if (!window.confirm('Are you sure you want to delete this address?')) {
      return;
    }

    try {
      await deleteCustomerAddress(addressName);
      alert('Address deleted successfully!');
      
      // Refresh addresses list
      const customerName = createdCustomerName || selectedCustomer?.name;
      if (customerName) {
        await fetchCustomerAddresses(customerName);
      }
    } catch (error) {
      console.error('Error deleting address:', error);
      alert(`Error deleting address: ${error.message}`);
    }
  };

  const handleCancelAddress = () => {
    setShowAddressForm(false);
    setEditingAddressIndex(null);
    setAddressFormData({
      address_title: '',
      address_line1: '',
      custom_building_number: '',
      custom_area: '',
      city: '',
      country: 'Saudi Arabia',
      pincode: ''
    });
  };

  const fetchCustomerAddresses = async (customerName) => {
    if (!customerName) {
      console.warn('⚠️ fetchCustomerAddresses called without customer name');
      return;
    }
    
    setLoadingAddresses(true);
    try {
      const fetchedAddresses = await getCustomerAddresses(customerName);
      
      const addressesArray = Array.isArray(fetchedAddresses) ? fetchedAddresses : [];
      setAddresses(addressesArray);
    } catch (error) {
      console.error('❌ Error fetching addresses:', error);
      // Set empty array on error to prevent UI breakage
      setAddresses([]);
    } finally {
      setLoadingAddresses(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate VAT number if provided
    if (formData.custom_vat_registration_number && formData.custom_vat_registration_number.length !== 15) {
      setVatError('VAT number must be exactly 15 digits');
      alert('VAT number must be exactly 15 digits');
      return;
    }
    
    setSubmitting(true);
    
    try {
      // Check if online before making request
      if (!navigator.onLine) {
        alert('You are currently offline. Please check your internet connection and try again. The request will be queued for sync when you are back online.');
        setSubmitting(false);
        return;
      }

      const result = await createCustomer(formData);
      const customerName = result.name || result.customer_name || formData.custom_customer_name_arabic;
      
      // Add to local state
      onAddCustomer({
        ...formData,
        id: result.name || result.id || `CUST${String(customers.length + 1).padStart(3, '0')}`,
        balance: 0
      });
      
      // Set customer created state to show address section
      setCustomerCreated(true);
      setCreatedCustomerName(customerName);
      
      // Don't navigate away - show address section
      // User can add address or skip
    } catch (error) {
      console.error('Error creating customer:', error);
      
      // Handle offline errors with user-friendly message
      if (error.message === 'OFFLINE' || !navigator.onLine) {
        alert('You are currently offline. Please check your internet connection and try again. The request will be queued for sync when you are back online.');
      } else {
        alert(`Error creating customer: ${error.message}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const showStatement = async (customer) => {
    setSelectedCustomer(customer);
    setView('statement');
    
    // Fetch transaction history from API
    setLoadingTransactions(true);
    try {
      const apiTransactions = await getCustomerBillingAndPayments(customer.name);
      const transactionsArray = Array.isArray(apiTransactions) ? apiTransactions : [];
      setTransactions(transactionsArray);
    } catch (error) {
      console.error('❌ Error fetching customer transactions:', error);
      // Fallback to empty array on error
      setTransactions([]);
    } finally {
      setLoadingTransactions(false);
    }
    
    // Fetch customer addresses
    fetchCustomerAddresses(customer.name);
  };

  // Reset address state when switching views
  useEffect(() => {
    if (view === 'list') {
      setCustomerCreated(false);
      setCreatedCustomerName('');
      setAddresses([]);
      setShowAddressForm(false);
    }
  }, [view]);

  // Debug: Log addresses state changes
  useEffect(() => {
    // Addresses state change handler
  }, [addresses]);

  // Address Form Component
  const renderAddressForm = () => (
    <div className="card mb-4" style={{ backgroundColor: 'var(--gray-50)' }}>
      <h3 className="mb-4">{editingAddressIndex !== null || addresses.length > 0 ? 'Edit Address' : 'Add Address'}</h3>
      <div className="grid grid-2 gap-4">
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Address Title *</label>
          <input
            type="text"
            name="address_title"
            className="form-input"
            value={addressFormData.address_title}
            onChange={handleAddressChange}
            placeholder="e.g., Office Address, Home Address"
            required
          />
        </div>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Address Line 1 *</label>
          <input
            type="text"
            name="address_line1"
            className="form-input"
            value={addressFormData.address_line1}
            onChange={handleAddressChange}
            placeholder="Enter street address"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">Building Number *</label>
          <input
            type="text"
            name="custom_building_number"
            className="form-input"
            value={addressFormData.custom_building_number}
            onChange={handleAddressChange}
            placeholder="Building number"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">Area *</label>
          <input
            type="text"
            name="custom_area"
            className="form-input"
            value={addressFormData.custom_area}
            onChange={handleAddressChange}
            placeholder="Area/Neighborhood"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">City *</label>
          <input
            type="text"
            name="city"
            className="form-input"
            value={addressFormData.city}
            onChange={handleAddressChange}
            placeholder="City"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">Country *</label>
          <input
            type="text"
            name="country"
            className="form-input"
            value={addressFormData.country}
            onChange={handleAddressChange}
            placeholder="Country"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">Pincode *</label>
          <input
            type="text"
            name="pincode"
            className="form-input"
            value={addressFormData.pincode}
            onChange={handleAddressChange}
            placeholder="Pincode"
            required
          />
        </div>
      </div>

      <div className="flex gap-3 mt-4">
        <button 
          type="button" 
          className="btn btn-success" 
          onClick={handleSaveAddress}
          disabled={submittingAddress}
        >
          {submittingAddress ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Plus size={20} />
              Save Address
            </>
          )}
        </button>
        <button 
          type="button" 
          className="btn btn-secondary" 
          onClick={handleCancelAddress}
          disabled={submittingAddress}
        >
          <X size={20} />
          Cancel
        </button>
      </div>
    </div>
  );

  // Address List Component
  const renderAddressList = () => {
    return (
      <div className="card mb-4">
      <div className="flex-between mb-4">
        <h3>Addresses</h3>
        {!showAddressForm && addresses.length === 0 && (
          <button 
            className="btn btn-primary" 
            onClick={handleAddAddress}
            disabled={loadingAddresses}
          >
            <Plus size={20} />
            Add Address
          </button>
        )}
      </div>

        {loadingAddresses ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto' }} />
            <p style={{ marginTop: '1rem', color: 'var(--gray-600)' }}>Loading addresses...</p>
          </div>
        ) : addresses.length > 0 ? (
        <div className="grid grid-1 gap-4">
          {addresses.map((address, index) => (
            <div 
              key={address.name || address.address_name || index} 
              className="p-4 bg-gray-50 rounded-lg"
              style={{ border: '1px solid var(--gray-200)' }}
            >
              <div className="flex-between mb-2">
                <h4 className="font-semibold" style={{ color: 'var(--primary)' }}>
                  <MapPin size={18} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                  {address.address_title || 'Address'}
                </h4>
                <div className="flex gap-2">
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleEditAddress(index)}
                    disabled={showAddressForm}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDeleteAddress(address.name || address.address_name)}
                    disabled={showAddressForm}
                    style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div className="text-sm" style={{ color: 'var(--gray-700)', lineHeight: '1.6' }}>
                <div>{address.address_line1}</div>
                {(address.custom_building_number || address.custom_area) && (
                  <div>
                    {address.custom_building_number && `Building ${address.custom_building_number}`}
                    {address.custom_building_number && address.custom_area && ', '}
                    {address.custom_area}
                  </div>
                )}
                <div>
                  {address.city}
                  {address.city && address.country && ', '}
                  {address.country}
                  {address.pincode && ` ${address.pincode}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon">📍</div>
          <div className="empty-state-title">No addresses yet</div>
          <p>Add an address to get started</p>
          {import.meta.env.DEV && (
            <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.5rem' }}>
              Debug: addresses.length = {addresses.length}, loading = {loadingAddresses ? 'true' : 'false'}
            </p>
          )}
        </div>
      )}
    </div>
    );
  };

  if (view === 'create') {
    return (
      <div className="customer-create fade-in">
        <div className="flex-between mb-6">
          <h1>New Customer</h1>
          <button className="btn btn-secondary" onClick={() => {
            setView('list');
            setCustomerCreated(false);
            setCreatedCustomerName('');
            setAddresses([]);
            setShowAddressForm(false);
          }}>
            Back to List
          </button>
        </div>

        {customerCreated ? (
          <>
            <div className="card mb-4" style={{ backgroundColor: 'var(--success-light)', border: '1px solid var(--success)' }}>
              <div className="flex items-center gap-3">
                <div style={{ 
                  width: '40px', 
                  height: '40px', 
                  borderRadius: '50%', 
                  backgroundColor: 'var(--success)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: '1.5rem'
                }}>
                  ✓
                </div>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--success)' }}>Customer created successfully!</h3>
                  <p style={{ margin: '0.25rem 0 0 0', color: 'var(--gray-700)' }}>
                    You can add an address below (optional).
                  </p>
                </div>
              </div>
            </div>

            {showAddressForm && renderAddressForm()}
            {renderAddressList()}

            <div className="flex gap-3 mt-4">
              <button 
                className="btn btn-secondary" 
                onClick={() => {
                  setView('list');
                  setCustomerCreated(false);
                  setCreatedCustomerName('');
                  setAddresses([]);
                  setShowAddressForm(false);
                }}
              >
                Back to List
              </button>
            </div>
          </>
        ) : (
          <div className="card">
            <form onSubmit={handleSubmit}>
              <div className="grid grid-2">
                <div className="form-group">
                  <label className="form-label">Customer Name *</label>
                  <input
                    type="text"
                    name="custom_customer_name_arabic"
                    className="form-input"
                    value={formData.custom_customer_name_arabic}
                    onChange={handleChange}
                    placeholder="Enter customer name"
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">VAT Number</label>
                  <input
                    type="text"
                    name="custom_vat_registration_number"
                    className="form-input"
                    value={formData.custom_vat_registration_number}
                    onChange={handleChange}
                    placeholder="Enter 15-digit VAT number"
                    maxLength={15}
                    pattern="[0-9]{15}"
                    inputMode="numeric"
                  />
                  {vatError && (
                    <div className="text-sm" style={{ color: 'var(--danger)', marginTop: '0.25rem' }}>
                      {vatError}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">CR No</label>
                  <input
                    type="text"
                    name="cr_no"
                    className="form-input"
                    value={formData.cr_no}
                    onChange={handleChange}
                    placeholder="Enter Commercial Registration Number"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button type="submit" className="btn btn-success" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Plus size={20} />
                      Save Customer
                    </>
                  )}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setView('list')} disabled={submitting}>
                  <X size={20} />
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  if (view === 'statement' && selectedCustomer) {
    const filteredTransactions = transactions;

    // Calculate totals from filtered transactions
    const customerSales = filteredTransactions.filter(tx => tx.type === 'sale');
    const customerPayments = filteredTransactions.filter(tx => tx.type === 'payment');
    
    const totalSales = customerSales.reduce((sum, s) => sum + (s.total || s.amount || 0), 0);
    const totalPayments = customerPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

    return (
      <div className="customer-statement fade-in">
        <div className="flex-between mb-6">
          <h1>Customer Statement</h1>
          <button className="btn btn-secondary" onClick={() => {
            setView('list');
            setSelectedCustomer(null);
          }}>
            Back to List
          </button>
        </div>

        <div className="card mb-4">
          <h3 className="mb-4">Customer Summary</h3>
          <div className="grid grid-3 gap-4 mb-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-600 mb-1">Customer Name</div>
              <div className="font-semibold">{selectedCustomer.name}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-600 mb-1">VAT Number</div>
              <div className="font-semibold">{selectedCustomer.custom_vat_registration_number || '-'}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-600 mb-1">Territory</div>
              <div className="font-semibold">{selectedCustomer.territory || '—'}</div>
            </div>
          </div>
          <div className="grid grid-3 gap-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-600 mb-1">Total Sales</div>
              <div className="font-bold text-xl text-primary"><SARSymbol size={16} /> {totalSales.toFixed(2)}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-600 mb-1">Total Payments</div>
              <div className="font-bold text-xl text-success"><SARSymbol size={16} /> {totalPayments.toFixed(2)}</div>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="text-xs text-gray-600 mb-1">Outstanding</div>
              <div className="font-bold text-xl text-danger"><SARSymbol size={16} /> {(totalSales - totalPayments).toFixed(2)}</div>
            </div>
          </div>
        </div>

        {showAddressForm && renderAddressForm()}
        {renderAddressList()}

        <div className="card">
          <h3 className="mb-4">Transaction History</h3>
          {loadingTransactions ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto' }} />
              <p style={{ marginTop: '1rem', color: 'var(--gray-600)' }}>Loading transactions...</p>
            </div>
          ) : filteredTransactions.length > 0 ? (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Reference</th>
                    <th>Debit</th>
                    <th>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((tx, index) => (
                    <tr key={index}>
                      <td>{new Date(tx.date).toLocaleDateString('en-SA')}</td>
                      <td>
                        <span className={`badge ${tx.type === 'sale' ? 'badge-primary' : 'badge-success'}`}>
                          {tx.type === 'sale' ? 'Sale' : 'Payment'}
                        </span>
                      </td>
                      <td className="font-semibold">{tx.reference || '-'}</td>
                      <td className="font-semibold">
                        {tx.type === 'sale' ? <><SARSymbol size={16} /> {(tx.total || tx.amount || 0).toFixed(2)}</> : '-'}
                      </td>
                      <td className="font-semibold" style={{ color: 'var(--secondary)' }}>
                        {tx.type === 'payment' ? <><SARSymbol size={16} /> {(tx.amount || 0).toFixed(2)}</> : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-title">No transactions</div>
              <p>This customer has no sales or payments yet</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Filter customers based on search query
  const filteredCustomers = customers.filter(customer => {
    if (!customerSearch.trim()) return true;
    const searchLower = customerSearch.toLowerCase();
    const englishName = (customer.custom_customer_name_english || customer.name || '').toLowerCase();
    const arabicName = (customer.custom_customer_name_arabic || '').toLowerCase();
    const vatNumber = (customer.custom_vat_registration_number || '').toLowerCase();
    return englishName.includes(searchLower) ||
           arabicName.includes(searchLower) ||
           vatNumber.includes(searchLower);
  });

  return (
    <div className="customer-list fade-in">
      <div className="flex-between mb-6">
        <h1>Customers</h1>
        <button className="btn btn-primary" onClick={() => setView('create')}>
          <Plus size={20} />
          New Customer
        </button>
      </div>

      {loadingCustomers ? (
        <div className="card">
          <div className="empty-state">
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
            <div className="empty-state-title mt-4">Loading customers...</div>
          </div>
        </div>
      ) : customers.length > 0 ? (
        <div className="card">
          <div className="mb-4" style={{ position: 'relative' }}>
            <Search 
              size={20} 
              style={{ 
                position: 'absolute', 
                left: '12px', 
                top: '50%', 
                transform: 'translateY(-50%)', 
                color: 'var(--gray-400)' 
              }} 
            />
            <input
              type="text"
              className="form-input"
              placeholder="Search by English name, Arabic name, or VAT number..."
              value={customerSearch || ''}
              onChange={(e) => {
                const newValue = e.target.value;
                setCustomerSearch(newValue);
              }}
              style={{ paddingLeft: '40px' }}
              autoComplete="off"
            />
          </div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>English Name</th>
                  <th>Arabic Name</th>
                  <th>VAT</th>
                  {customers.some(c => c.balance !== undefined && c.balance !== null) && <th>Balance</th>}
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.length > 0 ? (
                  filteredCustomers.map(customer => (
                  <tr 
                    key={customer.id}
                    onClick={() => showStatement(customer)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-50)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <td className="font-semibold">{customer.custom_customer_name_english || customer.name || '-'}</td>
                    <td>{customer.custom_customer_name_arabic || '-'}</td>
                    <td>{customer.custom_vat_registration_number || '-'}</td>
                    {customers.some(c => c.balance !== undefined && c.balance !== null) && (
                      <td className="font-semibold" style={{ color: (customer.balance || 0) > 0 ? 'var(--danger)' : 'var(--gray-600)' }}>
                        <SARSymbol size={16} /> {(customer.balance || 0).toFixed(2)}
                      </td>
                    )}
                  </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={customers.some(c => c.balance !== undefined && c.balance !== null) ? 4 : 3} style={{ textAlign: 'center', padding: '2rem' }}>
                      <div className="empty-state">
                        <div className="empty-state-icon">🔍</div>
                        <div className="empty-state-title">No customers found</div>
                        <p>Try adjusting your search query</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">👥</div>
            <div className="empty-state-title">No customers yet</div>
            <p>Add your first customer to get started</p>
            <button className="btn btn-primary mt-4" onClick={() => setView('create')}>
              <Plus size={20} />
              Add First Customer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CustomerModule;
