import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import apiApp from "./api/index";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Use the API routes from api/index.ts
  app.use(apiApp);

  // API 404 handler - Return JSON instead of falling through to SPA
  app.use("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  }

  // Error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled error:", err);
    if (req.path.startsWith("/api/")) {
      return res.status(err.status || 500).json({ 
        error: err.message || "Internal Server Error",
        details: process.env.NODE_ENV !== "production" ? err.stack : undefined
      });
    }
    next(err);
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
