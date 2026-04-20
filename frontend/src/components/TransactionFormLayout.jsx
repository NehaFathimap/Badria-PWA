/**
 * Shared layout for Sales Invoice / Quotation / Sales Order create form.
 * Same UI as SalesModule: Customer/Party selection area, Add Items area, line items table, Subtotal/Discount/Tax/Total, Save.
 */
import * as React from 'react';
import { Save, Loader2, Trash2 } from 'lucide-react';
import SARSymbol from './SARSymbol';

// Get available UOMs for an item: stock_uom + UOMs with conversion_factor set
// Only shows UOMs that have conversion rates set in item master (no hardcoded UOMs)
const getAvailableUOMs = (item) => {
  const stockUOM = item.stock_uom; // Only use if exists, no fallback
  const uomConversions = item.uom_conversions || [];
  const availableUOMs = [];
  
  // Include stock UOM if it exists
  if (stockUOM) {
    availableUOMs.push(stockUOM);
  }
  
  // Add UOMs from conversions that have conversion_factor set
  uomConversions.forEach(conv => {
    if (conv.uom && conv.conversion_factor && !availableUOMs.includes(conv.uom)) {
      availableUOMs.push(conv.uom);
    }
  });
  
  return availableUOMs;
};

export function TransactionFormLayout({
  title,
  backLabel = 'Back to List',
  onBack,
  partySelection,
  addItemsSection,
  lineItems = [],
  getPriceValue,
  getQuantityValue,
  onUpdatePrice,
  onUpdateQuantity,
  onUpdateUOM,
  onPriceBlur,
  onRemoveItem,
  discountAmount,
  onDiscountChange,
  calculateSubtotal,
  calculateDiscount,
  calculateTax,
  calculateTotal,
  onSubmit,
  submitting,
  submitLabel = 'Save',
  disabledSubmit,
}) {
  const getPrice = (v) => (typeof getPriceValue === 'function' ? getPriceValue(v) : parseFloat(v) || 0);
  const getQty = (v) => (typeof getQuantityValue === 'function' ? getQuantityValue(v) : parseFloat(v) || 1);

  return (
    <div className="sales-create fade-in">
      <div className="flex-between mb-6">
        <h1>{title}</h1>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          {backLabel}
        </button>
      </div>

      <form onSubmit={onSubmit}>
        {partySelection && (
          <div className="card mb-4">
            <h3 className="mb-4">Customer / Party Selection</h3>
            {partySelection}
          </div>
        )}

        {addItemsSection && (
          <div className="card mb-4">
            <h3 className="mb-4">Add Items</h3>
            {addItemsSection}
          </div>
        )}

        {lineItems.length > 0 && (
          <div className="card mb-4">
            <h3 className="mb-4">Items</h3>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Item Name</th>
                    <th>Price</th>
                    <th>Qty</th>
                    <th>UOM</th>
                    <th>Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item) => {
                    const priceVal = getPrice(item.price);
                    const qtyVal = getQty(item.quantity);
                    const itemTotal = priceVal * qtyVal;
                    return (
                      <tr key={item.code}>
                        <td className="font-semibold">{item.code}</td>
                        <td>{item.name}</td>
                        <td>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="form-input"
                            value={item.price}
                            onChange={(e) => onUpdatePrice(item.code, e.target.value)}
                            onBlur={() => onPriceBlur?.(item.code)}
                            placeholder="0.00"
                            style={{ width: '110px' }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            inputMode="numeric"
                            className="form-input"
                            value={item.quantity}
                            onChange={(e) => onUpdateQuantity(item.code, e.target.value)}
                            placeholder="1"
                            style={{ width: '80px' }}
                          />
                        </td>
                        <td>
                          <select
                            className="form-select"
                            value={item.uom || item.stock_uom || (getAvailableUOMs(item)[0] || '')}
                            onChange={(e) => onUpdateUOM(item.code, e.target.value)}
                            style={{ width: '100px', padding: '6px 8px' }}
                          >
                            {getAvailableUOMs(item).map(uom => (
                              <option key={uom} value={uom}>{uom}</option>
                            ))}
                          </select>
                        </td>
                        <td className="font-bold">
                          <SARSymbol size={16} /> {itemTotal.toFixed(2)}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => onRemoveItem(item.code)}
                            className="btn btn-danger btn-sm"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="5" className="text-right font-bold">Subtotal:</td>
                    <td colSpan="2" className="font-bold">
                      <SARSymbol size={16} /> {((typeof calculateSubtotal === 'function' ? calculateSubtotal() : 0)).toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan="5" className="text-right font-bold">Discount:</td>
                    <td colSpan="2" style={{ padding: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: 'var(--gray-600)' }}>-</span>
                        <SARSymbol size={16} />
                        <input
                          type="text"
                          inputMode="decimal"
                          className="form-input"
                          value={discountAmount}
                          onChange={(e) => onDiscountChange(e.target.value)}
                          placeholder="0.00"
                          style={{ width: '100px', fontWeight: 'bold', padding: '4px 8px' }}
                        />
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan="5" className="text-right font-bold">Tax (15%):</td>
                    <td colSpan="2" className="font-bold">
                      <SARSymbol size={16} /> {((typeof calculateTax === 'function' ? calculateTax() : 0)).toFixed(2)}
                    </td>
                  </tr>
                  <tr style={{ borderTop: '2px solid var(--primary)' }}>
                    <td colSpan="5" className="text-right font-bold" style={{ fontSize: '1.125rem' }}>TOTAL:</td>
                    <td colSpan="2" className="font-bold" style={{ fontSize: '1.25rem', color: 'var(--primary)' }}>
                      <SARSymbol size={16} /> {((typeof calculateTotal === 'function' ? calculateTotal() : 0)).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex gap-3 mt-4">
              <button type="submit" className="btn btn-success" disabled={submitting || disabledSubmit}>
                {submitting ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save size={20} />
                    {submitLabel}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

export default TransactionFormLayout;
