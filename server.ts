import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { 
  CallToolRequestSchema, 
  CallToolResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema
} from "@modelcontextprotocol/sdk/types.js";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());
  
  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });

  // 1. Initialize MCP Client to connect to altFINS
  const altfinsApiKey = process.env.ALTFINS_API_KEY;
  if (!altfinsApiKey) {
    console.warn("WARNING: ALTFINS_API_KEY is not set in environment variables.");
  }

  const altfinsClient = new Client(
    {
      name: "altfins-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  // 2. Initialize MCP Server (the Proxy)
  const proxyServer = new Server(
    {
      name: "altfins-proxy-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  
  // 3. Initialize Streamable HTTP Server Transport for the Proxy
  const transport = new StreamableHTTPServerTransport();

  // Connect the server to the transport immediately
  // This ensures the transport is ready to handle requests even if the bridge is still setting up
  proxyServer.connect(transport).catch(error => {
    console.error("Failed to connect proxy server to transport:", error);
  });

  // 4. MCP Routes
  
  // Simple ping endpoint for testing reachability without starting an SSE stream
  // MUST be before the general mcpHandler
  app.get("/mcp/ping", (req, res) => {
    res.json({ status: "ok", message: "MCP endpoint is reachable" });
  });

  const mcpHandler = async (req: any, res: any) => {
    const acceptHeader = req.headers.accept || "";
    console.log(`[MCP] ${req.method} ${req.url} - Accept: ${acceptHeader}`);
    
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Api-Key');
      res.status(204).end();
      return;
    }

    // Aggressive SSE detection for GET requests
    // If it's a GET request to an MCP endpoint, it's almost certainly an SSE request
    const isSSE = req.method === 'GET';
    
    try {
      if (isSSE) {
        console.log("[MCP] Establishing SSE stream...");
        // Set status and anti-buffering headers
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx proxy buffering
        res.setHeader('X-LiteSpeed-No-Buffering', '1'); // Disable LiteSpeed buffering (common on Hostinger)
        
        // HACK: Override header methods to prevent ERR_HTTP_HEADERS_SENT 
        // when the MCP SDK tries to set headers after we've already flushed them.
        const originalSetHeader = res.setHeader.bind(res);
        res.setHeader = (name: string, value: any) => {
          if (res.headersSent) return res;
          return originalSetHeader(name, value);
        };

        const originalWriteHead = res.writeHead.bind(res);
        res.writeHead = (statusCode: number, ...args: any[]) => {
          if (res.headersSent) return res;
          return originalWriteHead(statusCode, ...args);
        };

        // Flush headers immediately to open the connection and prevent timeouts
        res.flushHeaders();
        
        // Send a single newline to ensure the proxy flushes without confusing the client
        res.write("\n");
      }
      
      // Add error handler to prevent crashes on abrupt disconnects
      res.on('error', (err: any) => {
        console.error("[MCP] Response stream error:", err);
      });
      
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[MCP] Error handling request:", error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Internal Server Error", 
          details: String(error),
          path: req.url
        });
      }
    }
  };

  // Modern endpoint - use exact paths to avoid catching sub-routes
  app.all(/^\/mcp\/?$/, mcpHandler);
  app.all("/api/mcp", mcpHandler);

  // Handle root as MCP if requested via SSE or by an AI agent
  app.get("/", (req, res, next) => {
    const userAgent = req.headers['user-agent'] || "";
    const isAiAgent = /Perplexity|Claude|GPT|Googlebot|Bingbot/i.test(userAgent);
    const isSSE = req.headers.accept?.includes('text/event-stream') || req.query.transport === 'sse';

    if (isSSE || (isAiAgent && !req.headers.accept?.includes('text/html'))) {
      console.log(`[MCP] Root hit by ${isAiAgent ? 'AI Agent' : 'SSE client'}, handling as MCP`);
      return mcpHandler(req, res);
    }
    next();
  });

  // Simple ping endpoint for testing reachability without starting an SSE stream
  // (Moved up)

  // Legacy redirects/aliases to prevent 404 -> HTML fallback
  app.all(["/sse", "/sse/"], (req, res) => {
    console.log("[MCP] Legacy /sse hit, redirecting to /mcp");
    res.redirect(307, "/mcp");
  });
  
  app.all(["/messages", "/messages/"], (req, res) => {
    console.log("[MCP] Legacy /messages hit, redirecting to /mcp");
    res.redirect(307, "/mcp");
  });

  let cachedTools: any[] = [];

  async function refreshTools() {
    try {
      console.log("Fetching tools from altFINS...");
      const result = await altfinsClient.request(
        { method: "tools/list" },
        ListToolsResultSchema
      );
      
      const tools = result.tools || [];
      const validTools = [];
      
      console.log(`Received ${tools.length} tools from altFINS. Validating...`);
      
      for (const tool of tools) {
        try {
          if (!tool.name) {
            throw new Error("Tool definition is missing a 'name' field.");
          }
          // Basic validation: ensure we have a name and it's a string
          if (typeof tool.name !== 'string') {
            throw new Error(`Tool name must be a string, received: ${typeof tool.name}`);
          }
          
          validTools.push(tool);
          console.log(`  [OK] Registered tool: ${tool.name}`);
        } catch (toolError: any) {
          console.error(`  [ERROR] Failed to register tool ${tool?.name || 'unknown'}:`, toolError.message);
          // Continue with the rest of the tools as requested
        }
      }
      
      cachedTools = validTools;
      console.log(`Successfully cached ${cachedTools.length} tools for proxying.`);
      return cachedTools;
    } catch (error) {
      console.error("Critical failure fetching tools from altFINS:", error);
      throw error;
    }
  }

  async function setupBridge() {
    try {
      // Connect to altFINS via Streamable HTTP if not already connected
      try {
        console.log("Connecting to altFINS MCP Server via Streamable HTTP...");
        const transport = new StreamableHTTPClientTransport(new URL("https://mcp.altfins.com/mcp"), {
          requestInit: {
            headers: {
              "X-Api-Key": altfinsApiKey || "",
            },
          },
        });

        await altfinsClient.connect(transport);
        console.log("Connected to altFINS MCP Server successfully.");
      } catch (connError: any) {
        if (connError.message?.includes("already connected")) {
          console.log("Already connected to altFINS.");
        } else {
          throw connError;
        }
      }

      await refreshTools();

      // Register each tool on the proxy server
      proxyServer.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: cachedTools };
      });

      proxyServer.setRequestHandler(CallToolRequestSchema, async (request) => {
        console.log(`Proxying tool call: ${request.params.name}`);
        try {
          const result = await altfinsClient.request(
            {
              method: "tools/call",
              params: {
                name: request.params.name,
                arguments: request.params.arguments,
              },
            },
            CallToolResultSchema
          );
          return result;
        } catch (error) {
          console.error(`Error proxying tool call ${request.params.name}:`, error);
          throw error;
        }
      });

      console.log("Bridge setup complete.");
    } catch (error) {
      console.error("Failed to setup bridge:", error);
    }
  }

  // Routes for external AI clients
  // (Moved to top)

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      connectedToAltfins: !!altfinsClient,
      apiKeySet: !!altfinsApiKey,
      toolsCount: cachedTools.length,
      mcpEndpoint: "/mcp"
    });
  });

  app.post("/api/refresh-tools", async (req, res) => {
    try {
      await refreshTools();
      res.json({ success: true, toolsCount: cachedTools.length });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    
    // CRITICAL: Prevent HTML fallback for anything that looks like an MCP or API request
    // This MUST be before express.static to prevent it from serving index.html for these paths
    app.use((req, res, next) => {
      const isMcpPath = req.url.startsWith('/mcp') || req.url.startsWith('/api') || req.url.startsWith('/sse');
      const isJsonRequest = req.headers.accept?.includes('application/json');
      
      if (isMcpPath || isJsonRequest) {
        // If we are here, it means no previous route handled this MCP/API path
        return res.status(404).json({ 
          error: "Not Found", 
          message: "The requested MCP or API endpoint does not exist.",
          path: req.url 
        });
      }
      next();
    });

    app.use(express.static(distPath));

    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (typeof PORT === 'string' && (PORT.includes('/') || PORT.includes('\\'))) {
    // Unix socket or Windows named pipe
    app.listen(PORT, async () => {
      console.log(`MCP Proxy Server listening on socket: ${PORT}`);
      await setupBridge();
    });
  } else {
    // Network port
    const portNum = Number(PORT);
    app.listen(portNum, "0.0.0.0", async () => {
      console.log(`MCP Proxy Server listening on http://0.0.0.0:${portNum}`);
      await setupBridge();
    });
  }
}

startServer();
