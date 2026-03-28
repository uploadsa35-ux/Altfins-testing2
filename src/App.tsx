import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Activity, Shield, Zap, ExternalLink, RefreshCw, Box, Info, Copy } from "lucide-react";

export default function App() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);

  const fetchStatus = async () => {
    try {
      const response = await fetch("/api/health");
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error("Failed to fetch status:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/refresh-tools", { method: "POST" });
      const data = await response.json();
      if (data.success) {
        await fetchStatus();
      } else {
        alert("Failed to refresh tools: " + data.error);
      }
    } catch (error) {
      console.error("Error refreshing tools:", error);
      alert("Error refreshing tools. Check console.");
    } finally {
      setRefreshing(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult({ ping: 'testing', sse: 'pending' });
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second total timeout

    try {
      const start = Date.now();
      
      // Step 1: Test simple reachability with /mcp/ping
      console.log("Testing ping...");
      try {
        const pingResponse = await fetch("/mcp/ping", { signal: controller.signal });
        if (pingResponse.ok) {
          const pingData = await pingResponse.json();
          setTestResult(prev => ({ ...prev, ping: 'ok', pingData }));
        } else {
          setTestResult(prev => ({ ...prev, ping: 'error', pingError: `Status ${pingResponse.status}` }));
        }
      } catch (e: any) {
        setTestResult(prev => ({ ...prev, ping: 'error', pingError: e.message }));
      }
      
      // Step 2: Test SSE headers with /mcp (Downstream)
      console.log("Testing SSE stream...");
      setTestResult(prev => ({ ...prev, sse: 'testing' }));
      
      try {
        const sseResponse = await fetch("/mcp", {
          method: "GET",
          headers: { "Accept": "text/event-stream" },
          signal: controller.signal
        });
        
        const contentType = sseResponse.headers.get("Content-Type") || "unknown";
        const isSSE = contentType.includes("text/event-stream");
        
        // Abort the SSE stream immediately
        controller.abort();

        setTestResult(prev => ({ 
          ...prev, 
          sse: isSSE ? 'ok' : 'error',
          sseType: contentType,
          sseError: !isSSE ? "Endpoint reachable but didn't return text/event-stream." : null
        }));
      } catch (e: any) {
        if (e.name === 'AbortError') {
          setTestResult(prev => (prev?.sse === 'testing' ? { ...prev, sse: 'timeout' } : prev));
        } else {
          setTestResult(prev => ({ ...prev, sse: 'error', sseError: e.message }));
        }
      }

      // Step 3: Test POST (Upstream / Streamable HTTP)
      console.log("Testing Streamable HTTP POST...");
      setTestResult(prev => ({ ...prev, post: 'testing' }));
      try {
        const postResponse = await fetch("/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
          signal: controller.signal
        });
        
        const end = Date.now();
        setTestResult(prev => ({ 
          ...prev, 
          post: postResponse.ok ? 'ok' : 'error',
          postStatus: postResponse.status,
          latency: end - start
        }));
      } catch (e: any) {
        setTestResult(prev => ({ ...prev, post: 'error', postError: e.message }));
      }
      
      clearTimeout(timeoutId);
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error("Global test error:", error);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      <div className="max-w-4xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="space-y-8"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/10 rounded-lg border border-orange-500/20">
                <Zap className="w-6 h-6 text-orange-500" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">altFINS MCP Proxy Bridge</h1>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-medium transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh Tools'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <motion.div
              whileHover={{ scale: 1.01 }}
              className="p-6 bg-[#141414] border border-white/5 rounded-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-white/50 uppercase tracking-wider font-semibold">
                  <Activity className="w-4 h-4" />
                  System Status
                </div>
                {loading ? (
                  <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse" />
                ) : (
                  <div className={`w-2 h-2 rounded-full ${status?.status === 'ok' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`} />
                )}
              </div>
              <div className="text-3xl font-light">
                {status?.status === 'ok' ? 'Running' : 'Offline'}
              </div>
              <p className="text-sm text-white/40 leading-relaxed">
                The proxy server is active and listening for incoming tool requests.
              </p>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.01 }}
              className="p-6 bg-[#141414] border border-white/5 rounded-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-white/50 uppercase tracking-wider font-semibold">
                  <Shield className="w-4 h-4" />
                  altFINS
                </div>
                <div className="flex gap-1">
                  <div className={`w-2 h-2 rounded-full ${status?.connectedToAltfins ? 'bg-green-500' : 'bg-orange-500'}`} />
                  <div className={`w-2 h-2 rounded-full ${status?.apiKeySet ? 'bg-green-500' : 'bg-red-500'}`} />
                </div>
              </div>
              <div className="text-3xl font-light">
                {status?.connectedToAltfins ? 'Connected' : 'Disconnected'}
              </div>
              <p className="text-sm text-white/40 leading-relaxed">
                {status?.apiKeySet ? 'API Key is configured.' : 'API Key is MISSING in environment.'}
              </p>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.01 }}
              className="p-6 bg-[#141414] border border-white/5 rounded-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-white/50 uppercase tracking-wider font-semibold">
                  <Box className="w-4 h-4" />
                  Cached Tools
                </div>
                <div className="text-xs font-mono text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">
                  LIVE
                </div>
              </div>
              <div className="text-3xl font-light">
                {status?.toolsCount ?? 0}
              </div>
              <p className="text-sm text-white/40 leading-relaxed">
                Number of tools currently cached and available via the proxy.
              </p>
            </motion.div>
          </div>

          <div className="p-8 bg-[#141414] border border-white/5 rounded-2xl space-y-6">
            <h2 className="text-xl font-semibold">Connection Details</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-white/30 uppercase tracking-widest font-bold">MCP Endpoint (Streamable HTTP / SSE)</label>
                <div className="flex items-center gap-2 p-3 bg-black/40 rounded-lg border border-white/5 font-mono text-sm text-orange-400">
                  {window.location.origin}/mcp
                </div>
              </div>
              <p className="text-sm text-white/40 leading-relaxed">
                Use this URL in your AI client (Cursor, Perplexity, etc.). This endpoint supports both the modern Streamable HTTP transport and standard SSE.
              </p>
              
              <div className="pt-2 flex flex-col gap-4">
                <button
                  onClick={testConnection}
                  disabled={testing}
                  className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-lg text-xs font-medium text-orange-400 transition-all active:scale-95 disabled:opacity-50 w-fit"
                >
                  <Activity className={`w-3 h-3 ${testing ? 'animate-spin' : ''}`} />
                  {testing ? 'Testing Endpoint...' : 'Test MCP Endpoint'}
                </button>

                {/* Perplexity Specific Guide */}
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 space-y-3"
                >
                  <div className="flex items-center gap-2 text-blue-400">
                    <Info className="w-4 h-4" />
                    <span className="font-bold text-sm">Perplexity Setup Guide</span>
                  </div>
                  <p className="text-xs text-white/60 leading-relaxed">
                    If you see <code className="text-red-400 bg-red-400/10 px-1 rounded">FETCHER_HTML_STATUS_CODE_ERROR</code> in Perplexity, make sure you are using the exact SSE URL below:
                  </p>
                  <div className="flex items-center gap-2 p-2 bg-black/40 rounded border border-white/10 group">
                    <code className="text-[10px] text-blue-300 flex-1 truncate">{window.location.origin}/mcp</code>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/mcp`);
                      }}
                      className="p-1 hover:bg-white/10 rounded transition-colors"
                    >
                      <Copy className="w-3 h-3 text-white/40 group-hover:text-white/80" />
                    </button>
                  </div>
                  <ul className="text-[10px] text-white/40 space-y-1 list-disc pl-4">
                    <li>Ensure the URL ends in <code className="text-white/60">/mcp</code></li>
                    <li>Perplexity requires a publicly accessible URL (this shared URL is public)</li>
                    <li>The server is configured to bypass buffering for Perplexity</li>
                  </ul>
                </motion.div>
              </div>

              {testResult && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="p-4 rounded-xl border border-white/10 bg-white/5 text-sm space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="font-bold text-white/80">Diagnostic Results</span>
                    {testResult.latency && <span className="text-xs font-mono text-white/40">{testResult.latency}ms</span>}
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-white/60">Ping Reachability:</span>
                      <span className={`font-mono text-xs ${testResult.ping === 'ok' ? 'text-green-400' : testResult.ping === 'testing' ? 'text-orange-400' : 'text-red-400'}`}>
                        {testResult.ping === 'ok' ? '✅ SUCCESS' : testResult.ping === 'testing' ? '⏳ TESTING...' : `❌ FAILED (${testResult.pingError})`}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-white/60">MCP Stream (SSE):</span>
                      <span className={`font-mono text-xs ${testResult.sse === 'ok' ? 'text-green-400' : testResult.sse === 'testing' ? 'text-orange-400' : testResult.sse === 'timeout' ? 'text-yellow-400' : 'text-red-400'}`}>
                        {testResult.sse === 'ok' ? '✅ ACTIVE' : testResult.sse === 'testing' ? '⏳ TESTING...' : testResult.sse === 'timeout' ? '⚠️ TIMEOUT' : `❌ ERROR`}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-white/60">Streamable HTTP (POST):</span>
                      <span className={`font-mono text-xs ${testResult.post === 'ok' ? 'text-green-400' : testResult.post === 'testing' ? 'text-orange-400' : 'text-red-400'}`}>
                        {testResult.post === 'ok' ? '✅ SUPPORTED' : testResult.post === 'testing' ? '⏳ TESTING...' : `❌ FAILED`}
                      </span>
                    </div>
                  </div>

                  {testResult.sseError && (
                    <div className={`text-xs p-2 rounded bg-black/20 border ${testResult.sse === 'timeout' ? 'border-yellow-500/20 text-yellow-400/80' : 'border-red-500/20 text-red-400/80'}`}>
                      {testResult.sseError}
                    </div>
                  )}

                  {testResult.isHtml && (
                    <div className="text-[10px] uppercase tracking-wider font-bold text-red-500 bg-red-500/10 p-1 text-center rounded">
                      Critical: Server is returning HTML
                    </div>
                  )}
                </motion.div>
              )}
            </div>
            
            <div className="pt-4 flex items-center gap-4">
              <a 
                href="https://mcp.altfins.com" 
                target="_blank" 
                rel="noreferrer"
                className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
              >
                altFINS Documentation <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
