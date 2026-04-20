import * as React from 'react';
import { useState, useEffect } from 'react';
import { Plus, Search, Loader2, ArrowLeft, User } from 'lucide-react';
import { getLeadList, getLeadDetails, createLead } from '../services/api';

function LeadModule() {
  const [view, setView] = useState('list'); // list | detail | create
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [leadDetail, setLeadDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    company_name: '',
    email_id: '',
    mobile_no: '',
    source: 'Campaign',
  });

  const fetchList = async () => {
    setLoading(true);
    try {
      const { leads: list } = await getLeadList({ limit: 100, offset: 0 });
      setLeads(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error(e);
      setLeads([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, []);

  useEffect(() => {
    const term = search.trim();
    if (!term) {
      setSearchResults([]);
      setLoadingSearch(false);
      return;
    }
    setLoadingSearch(true);
    const t = setTimeout(async () => {
      try {
        const { leads: list } = await getLeadList({ limit: 100, offset: 0, search: term });
        setSearchResults(Array.isArray(list) ? list : []);
      } catch {
        setSearchResults([]);
      } finally {
        setLoadingSearch(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const openDetail = async (lead) => {
    setSelectedLead(lead);
    setView('detail');
    setLoadingDetail(true);
    setLeadDetail(null);
    try {
      const detail = await getLeadDetails(lead.name);
      setLeadDetail(detail);
    } catch {
      setLeadDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await createLead({
        first_name: form.first_name || form.company_name || 'Lead',
        last_name: form.last_name,
        company_name: form.company_name,
        email_id: form.email_id || undefined,
        mobile_no: form.mobile_no || undefined,
        source: form.source,
      });
      setForm({ first_name: '', last_name: '', company_name: '', email_id: '', mobile_no: '', source: 'Campaign' });
      setView('list');
      fetchList();
    } catch (err) {
      setError(err.message || 'Failed to create lead');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (d) => {
    if (!d) return '—';
    const x = new Date(d);
    return x.toLocaleDateString();
  };

  const listToShow = search.trim() ? searchResults : leads;
  const isSearching = !!search.trim();

  if (view === 'detail') {
    return (
      <div className="lead-module fade-in">
        <button className="btn btn-secondary mb-4" onClick={() => setView('list')}>
          <ArrowLeft size={18} /> Back to Leads
        </button>
        <div className="card">
          {loadingDetail ? (
            <div className="empty-state">
              <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
              <div className="empty-state-title mt-4">Loading...</div>
            </div>
          ) : leadDetail ? (
            <div style={{ padding: '0.5rem 0' }}>
              <h2 className="mb-4">{leadDetail.lead_name || leadDetail.name}</h2>
              <table className="table">
                <tbody>
                  <tr><td className="text-muted">Name</td><td>{leadDetail.lead_name || '—'}</td></tr>
                  <tr><td className="text-muted">Company</td><td>{leadDetail.company_name || '—'}</td></tr>
                  <tr><td className="text-muted">Email</td><td>{leadDetail.email_id || '—'}</td></tr>
                  <tr><td className="text-muted">Mobile</td><td>{leadDetail.mobile_no || '—'}</td></tr>
                  <tr><td className="text-muted">Status</td><td><span className="badge badge-primary">{leadDetail.status || '—'}</span></td></tr>
                  <tr><td className="text-muted">Created</td><td>{formatDate(leadDetail.creation)}</td></tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-title">Lead not found</div>
              <button className="btn btn-primary mt-4" onClick={() => setView('list')}>Back to list</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (view === 'create') {
    return (
      <div className="lead-module fade-in">
        <button className="btn btn-secondary mb-4" onClick={() => setView('list')}>
          <ArrowLeft size={18} /> Back to Leads
        </button>
        <div className="card">
          <h2 className="mb-4">New Lead</h2>
          <form onSubmit={handleCreateSubmit}>
            {error && <div className="alert alert-danger mb-4">{error}</div>}
            <div className="form-group">
              <label className="form-label">First Name *</label>
              <input className="form-input" value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} placeholder="First name" />
            </div>
            <div className="form-group">
              <label className="form-label">Last Name</label>
              <input className="form-input" value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} placeholder="Last name" />
            </div>
            <div className="form-group">
              <label className="form-label">Company Name</label>
              <input className="form-input" value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Company" />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input type="email" className="form-input" value={form.email_id} onChange={e => setForm(f => ({ ...f, email_id: e.target.value }))} placeholder="email@example.com" />
            </div>
            <div className="form-group">
              <label className="form-label">Mobile</label>
              <input className="form-input" value={form.mobile_no} onChange={e => setForm(f => ({ ...f, mobile_no: e.target.value }))} placeholder="Mobile number" />
            </div>
            <div className="form-group">
              <label className="form-label">Source</label>
              <select className="form-input" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
                <option value="Campaign">Campaign</option>
                <option value="Cold Calling">Cold Calling</option>
                <option value="Existing Customer">Existing Customer</option>
                <option value="Partner">Partner</option>
                <option value="Website">Website</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="flex-between mt-4">
              <button type="button" className="btn btn-secondary" onClick={() => setView('list')}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                {submitting ? ' Creating...' : ' Create Lead'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="lead-module fade-in">
      <div className="flex-between mb-6">
        <h1>Leads</h1>
        <button className="btn btn-primary" onClick={() => setView('create')}>
          <Plus size={20} /> New Lead
        </button>
      </div>
      <div className="card">
        <div className="mb-4">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Search</label>
            <div style={{ position: 'relative' }}>
              <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
              <input type="text" className="form-input" placeholder="Search by name, company, email, mobile..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
            </div>
          </div>
        </div>
        {loading ? (
          <div className="empty-state">
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto' }} />
            <div className="empty-state-title mt-4">Loading leads...</div>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th>Mobile</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loadingSearch ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}><Loader2 size={24} className="animate-spin" /> Searching...</td></tr>
                ) : listToShow.length === 0 ? (
                  <tr><td colSpan={5} className="text-muted" style={{ textAlign: 'center', padding: '2rem' }}>{isSearching ? 'No matching leads' : 'No leads yet'}</td></tr>
                ) : (
                  listToShow.map(lead => (
                    <tr key={lead.name} onClick={() => openDetail(lead)} style={{ cursor: 'pointer' }}>
                      <td className="font-semibold">{lead.lead_name || lead.name}</td>
                      <td>{lead.company_name || '—'}</td>
                      <td>{lead.email_id || '—'}</td>
                      <td>{lead.mobile_no || '—'}</td>
                      <td><span className="badge badge-primary">{lead.status || '—'}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default LeadModule;
