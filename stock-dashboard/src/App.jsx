import { useEffect, useState } from 'react'
import axios from 'axios'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import { Toaster, toast } from 'react-hot-toast'

function App() {
  const API_ROOT = (
    import.meta.env.PROD
      ? (import.meta.env.VITE_API_BASE_URL || '')
      : (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000')
  ).replace(/\/$/, '')
  const AUTH_API_BASE_URL = `${API_ROOT}/api/auth`
  const API_BASE_URL = `${API_ROOT}/api/watchlist`
  const MARKET_API_BASE_URL = `${API_ROOT}/api/market`
  const AI_SUMMARY_API_URL = `${API_ROOT}/api/ai-summary`
  const [clickCount, setClickCount] = useState(0)
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user')
    return stored ? JSON.parse(stored) : null
  })
  const [authMode, setAuthMode] = useState('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [watchInput, setWatchInput] = useState('')
  const [watchlist, setWatchlist] = useState([])
  const [marketData, setMarketData] = useState({})
  const [notesById, setNotesById] = useState({})
  const [summaryById, setSummaryById] = useState({})
  const [summaryLoadingById, setSummaryLoadingById] = useState({})
  const [noteSavingById, setNoteSavingById] = useState({})

  const incrementClicks = () => {
    setClickCount((prev) => prev + 1)
  }

  const handleMainAction = () => {
    incrementClicks()
    window.alert('Feature coming soon!')
  }

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}

  const handleAuth = async () => {
    if (!authEmail.trim() || !authPassword.trim()) {
      window.alert('Email and password are required.')
      return
    }

    const endpoint = authMode === 'login' ? 'login' : 'signup'
    setAuthLoading(true)
    try {
      const response = await axios.post(`${AUTH_API_BASE_URL}/${endpoint}`, {
        email: authEmail.trim(),
        password: authPassword,
      })

      const nextToken = response.data.token
      const nextUser = response.data.user
      setToken(nextToken)
      setUser(nextUser)
      localStorage.setItem('token', nextToken)
      localStorage.setItem('user', JSON.stringify(nextUser))
      setAuthPassword('')
    } catch (error) {
      const message = error.response?.data?.message || 'Authentication failed.'
      window.alert(message)
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = () => {
    setToken('')
    setUser(null)
    setWatchlist([])
    setMarketData({})
    setNotesById({})
    setSummaryById({})
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  useEffect(() => {
    const fetchWatchlist = async () => {
      if (!token) return
      try {
        const response = await axios.get(API_BASE_URL, { headers: authHeaders })
        const items = response.data
        setWatchlist(items)
        setNotesById(
          Object.fromEntries(items.map((item) => [item._id, item.note || '']))
        )
        setSummaryById(
          Object.fromEntries(items.map((item) => [item._id, item.summary || []]))
        )
      } catch (error) {
        console.error('Failed to load watchlist:', error)
      }
    }

    fetchWatchlist()
  }, [token])

  useEffect(() => {
    const fetchMarketData = async () => {
      if (watchlist.length === 0) {
        setMarketData({})
        return
      }

      const requests = watchlist.map(async (item) => {
        try {
          const response = await axios.get(`${MARKET_API_BASE_URL}/${item.name}`)
          return [item._id, response.data]
        } catch (error) {
          return [item._id, null]
        }
      })

      const entries = await Promise.all(requests)
      setMarketData(Object.fromEntries(entries))
    }

    fetchMarketData()
  }, [watchlist])

  const handleAddWatch = async () => {
    const symbol = watchInput.trim().toUpperCase()
    if (!symbol) {
      toast.error('Please enter a symbol')
      return
    }

    try {
      const response = await axios.post(
        API_BASE_URL,
        { name: symbol },
        { headers: authHeaders }
      )
      setWatchlist((prev) => [response.data, ...prev])
      setNotesById((prev) => ({ ...prev, [response.data._id]: response.data.note || '' }))
      setSummaryById((prev) => ({ ...prev, [response.data._id]: response.data.summary || [] }))
      setWatchInput('')
      incrementClicks()
    } catch (error) {
      console.error('Failed to add stock:', error)
    }
  }

  const handleDeleteWatch = async (idToRemove) => {
    try {
      await axios.delete(`${API_BASE_URL}/${idToRemove}`, { headers: authHeaders })
      setWatchlist((prev) => prev.filter((item) => item._id !== idToRemove))
      setNotesById((prev) => {
        const next = { ...prev }
        delete next[idToRemove]
        return next
      })
      setSummaryById((prev) => {
        const next = { ...prev }
        delete next[idToRemove]
        return next
      })
      incrementClicks()
    } catch (error) {
      console.error('Failed to delete stock:', error)
    }
  }

  const handleSummary = async (stockId) => {
    const text = (notesById[stockId] || '').trim()
    if (!text) {
      window.alert('Please write a note first.')
      return
    }

    setSummaryLoadingById((prev) => ({ ...prev, [stockId]: true }))
    try {
      const response = await axios.post(
        AI_SUMMARY_API_URL,
        { stockId, text },
        { headers: authHeaders }
      )
      setSummaryById((prev) => ({ ...prev, [stockId]: response.data.bullets || [] }))
      incrementClicks()
    } catch (error) {
      console.error('Failed to summarize note:', error)
      window.alert('Could not generate summary right now.')
    } finally {
      setSummaryLoadingById((prev) => ({ ...prev, [stockId]: false }))
    }
  }

  const handleSaveNote = async (stockId) => {
    const note = notesById[stockId] || ''
    setNoteSavingById((prev) => ({ ...prev, [stockId]: true }))
    try {
      const response = await axios.put(
        `${API_BASE_URL}/${stockId}/note`,
        { note },
        { headers: authHeaders }
      )
      setNotesById((prev) => ({ ...prev, [stockId]: response.data.note || '' }))
    } catch (error) {
      console.error('Failed to save note:', error)
      window.alert('Could not save note right now.')
    } finally {
      setNoteSavingById((prev) => ({ ...prev, [stockId]: false }))
    }
  }

  const movers = [
    { symbol: 'NVDA', price: '$892.33', change: '+3.10%' },
    { symbol: 'AAPL', price: '$192.54', change: '+1.12%' },
    { symbol: 'MSFT', price: '$425.11', change: '-0.45%' },
    { symbol: 'TSLA', price: '$175.89', change: '+2.30%' },
  ]

  const filteredWatchlist = watchlist.filter((stock) =>
    stock.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  )

  const totalPortfolioValue = watchlist.reduce((sum, stock) => {
    const price = marketData[stock._id]?.price
    return sum + (typeof price === 'number' ? price : 0)
  }, 0)

  const trackedStockCount = watchlist.length

  const statCards = [
    {
      title: 'Tracked Stocks',
      value: String(trackedStockCount),
      trend: trackedStockCount === 1 ? '1 stock in watchlist' : `${trackedStockCount} stocks in watchlist`,
      positive: true,
    },
    { title: 'Daily P&L', value: '+$3,412', trend: '+1.6%', positive: true },
    { title: 'Market Breadth', value: '62%', trend: 'Advancers over decliners', positive: true },
  ]

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/60">
          <h1 className="text-2xl font-semibold text-white">
            {authMode === 'login' ? 'Login' : 'Create account'}
          </h1>
          <p className="mt-1 text-sm text-slate-400">Access your personal stock dashboard.</p>

          <div className="mt-5 space-y-3">
            <input
              type="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-emerald-400/60"
            />
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-emerald-400/60"
            />
            <button
              onClick={handleAuth}
              disabled={authLoading}
              className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {authLoading ? 'Please wait...' : authMode === 'login' ? 'Login' : 'Sign Up'}
            </button>
          </div>

          <button
            onClick={() => setAuthMode((prev) => (prev === 'login' ? 'signup' : 'login'))}
            className="mt-4 text-xs font-medium text-indigo-300 hover:text-indigo-200"
          >
            {authMode === 'login'
              ? "Don't have an account? Sign up"
              : 'Already have an account? Login'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#02030a] via-[#020617] to-[#050b1a] text-slate-100">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#0f172a',
            color: '#e2e8f0',
            border: '1px solid #334155',
          },
        }}
      />
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[260px_1fr]">
        <aside className="border-r border-slate-800/80 bg-slate-900/60 p-6 backdrop-blur-xl">
          <div className="mb-8 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-emerald-400/20 ring-1 ring-emerald-400/40" />
            <div>
              <p className="text-sm font-semibold tracking-wide text-emerald-300">MarketPulse</p>
              <p className="text-xs text-slate-400">Stock Tracker</p>
            </div>
          </div>

          <nav className="space-y-2 text-sm">
            {['Overview', 'Portfolio', 'Watchlist', 'Analytics', 'Alerts', 'Settings'].map((item) => (
              <button
                key={item}
                className={`w-full rounded-lg px-3 py-2 text-left transition ${
                  item === 'Overview'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                {item}
              </button>
            ))}
          </nav>

          <div className="mt-10 rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs text-slate-400">Market Status</p>
            <p className="mt-2 text-sm font-medium text-emerald-300">US Markets Open</p>
            <p className="mt-1 text-xs text-slate-500">Closes in 4h 18m</p>
          </div>
        </aside>

        <main className="p-6 md:p-8">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4 backdrop-blur">
            <div>
              <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
              <p className="text-sm text-slate-400">Track your stocks and portfolio performance</p>
              <p className="text-xs text-slate-500">{user?.email}</p>
              <p className="mt-2 text-xs font-medium text-emerald-300">Button clicks: {clickCount}</p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search watchlist..."
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-emerald-400/60"
              />
              <button
                onClick={handleMainAction}
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300"
              >
                Add Stock
              </button>
              <button
                onClick={handleLogout}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-700"
              >
                Logout
              </button>
            </div>
          </header>

          <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-indigo-400/20 bg-slate-900/85 p-5 shadow-[0_0_35px_rgba(99,102,241,0.15)]">
              <p className="text-sm text-slate-400">Total Portfolio Value</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
                ${totalPortfolioValue.toFixed(2)}
              </p>
              <p className="mt-2 text-sm font-medium text-indigo-300">
                Tracking {trackedStockCount} {trackedStockCount === 1 ? 'stock' : 'stocks'}
              </p>
            </article>
            {statCards.map((card) => (
              <article
                key={card.title}
                className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-[0_0_28px_rgba(16,185,129,0.12)]"
              >
                <p className="text-sm text-slate-400">{card.title}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-white">{card.value}</p>
                <p
                  className={`mt-2 text-sm font-medium ${
                    card.positive ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {card.trend}
                </p>
              </article>
            ))}
          </section>

          <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/60">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Live Market Snapshot</h2>
              <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300">
                Updated 1m ago
              </span>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
              <div className="h-72 rounded-xl border border-slate-800 bg-gradient-to-b from-slate-800/50 to-slate-900 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm text-slate-300">S&P 500 Intraday</p>
                  <p className="text-sm font-medium text-emerald-300">+0.87%</p>
                </div>
                <div className="grid h-[220px] grid-cols-12 items-end gap-2">
                  {[42, 53, 48, 60, 58, 72, 68, 74, 70, 81, 76, 88].map((h, idx) => (
                    <div
                      key={idx}
                      className="rounded-t-md bg-emerald-400/80"
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <h3 className="mb-4 text-sm font-medium text-slate-200">Top Movers</h3>
                <div className="space-y-3">
                  {movers.map((stock) => (
                    <div
                      key={stock.symbol}
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-white">{stock.symbol}</p>
                        <p className="text-xs text-slate-400">{stock.price}</p>
                      </div>
                      <p
                        className={`text-sm font-semibold ${
                          stock.change.startsWith('+') ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {stock.change}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/60">
            <h2 className="mb-4 text-lg font-semibold text-white">Watchlist</h2>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={watchInput}
                onChange={(e) => setWatchInput(e.target.value)}
                placeholder="Enter stock symbol (e.g., AMZN)"
                className="min-w-[240px] flex-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-emerald-400/60"
              />
              <button
                onClick={handleAddWatch}
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300"
              >
                Add
              </button>
            </div>

            <div className="space-y-2">
              {watchlist.length === 0 ? (
                <p className="text-sm text-slate-400">Your watchlist is empty.</p>
              ) : filteredWatchlist.length === 0 ? (
                <p className="text-sm text-slate-400">No stocks match your search.</p>
              ) : (
                filteredWatchlist.map((stock) => {
                  const trend = marketData[stock._id]?.trend
                  const trendCardStyle =
                    trend === 'up'
                      ? 'border-emerald-400/35 shadow-[0_0_15px_rgba(34,197,94,0.3)]'
                      : trend === 'down'
                        ? 'border-rose-400/35 shadow-[0_0_15px_rgba(239,68,68,0.3)]'
                        : 'border-slate-500/25 shadow-[0_0_12px_rgba(148,163,184,0.14)]'

                  return (
                    <div
                      key={stock._id}
                      className={`rounded-xl border border-white/10 bg-black/25 px-3 py-3 backdrop-blur-[10px] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_10px_24px_rgba(2,6,23,0.55)] ${trendCardStyle}`}
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-4">
                          <div>
                            <p className="text-sm font-medium text-white">{stock.name}</p>
                            {marketData[stock._id] ? (
                              <p
                                className={`text-xs font-semibold ${
                                  marketData[stock._id].trend === 'up' ? 'text-emerald-300' : 'text-rose-300'
                                }`}
                              >
                                ${marketData[stock._id].price.toFixed(2)} ({marketData[stock._id].changePercent}%)
                              </p>
                            ) : (
                              <p className="text-xs text-slate-400">Loading price...</p>
                            )}
                          </div>

                          <div className="h-10 w-28">
                            {marketData[stock._id]?.sparkline ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart
                                  data={marketData[stock._id].sparkline.map((value, index) => ({
                                    point: index,
                                    value,
                                  }))}
                                >
                                  <Line
                                    type="monotone"
                                    dataKey="value"
                                    dot={false}
                                    strokeWidth={2}
                                    stroke={
                                      marketData[stock._id].trend === 'up'
                                        ? 'rgb(110, 231, 183)'
                                        : 'rgb(251, 113, 133)'
                                    }
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            ) : null}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteWatch(stock._id)}
                          className="rounded-md border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
                        >
                          Delete
                        </button>
                      </div>

                      <div className="space-y-2">
                        <textarea
                          value={notesById[stock._id] || ''}
                          onChange={(e) =>
                            setNotesById((prev) => ({
                              ...prev,
                              [stock._id]: e.target.value,
                            }))
                          }
                          onBlur={() => handleSaveNote(stock._id)}
                          rows={2}
                          placeholder={`Write a note for ${stock.name}...`}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-emerald-400/60"
                        />
                        {noteSavingById[stock._id] ? (
                          <p className="text-[11px] text-slate-400">Saving note...</p>
                        ) : (
                          <p className="text-[11px] text-slate-500">Note saves when you click outside the box.</p>
                        )}
                        <button
                          onClick={() => handleSummary(stock._id)}
                          disabled={summaryLoadingById[stock._id]}
                          className="rounded-md border border-indigo-400/40 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {summaryLoadingById[stock._id] ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="h-3 w-3 animate-spin rounded-full border border-indigo-300 border-t-transparent" />
                              Loading...
                            </span>
                          ) : (
                            'AI Summary'
                          )}
                        </button>
                        {summaryById[stock._id]?.length ? (
                          <ul className="space-y-1 text-xs text-slate-300">
                            {summaryById[stock._id].map((bullet, idx) => (
                              <li key={`${stock._id}-summary-${idx}`}>- {bullet}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

export default App
