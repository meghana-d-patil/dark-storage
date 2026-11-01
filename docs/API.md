# Dark Storage WMS API Reference

Summary of endpoints per phase.
Base URL: `/api` (Gateway port 4000)

## Phase 1 Endpoints
- `POST /api/auth/login` - Authenticate with username and password, returns JWT and user profile
- `GET /api/auth/me` - Get current authenticated user profile
- `GET /health` - Gateway liveness probe
- `GET /api/health` - Aggregated health check for Gateway, Engine 1, Engine 2, Engine 3
- `GET /api/products` - List products with search (?search=) and pagination (?page=1&page_size=25)
- `GET /api/products/:sku` - Get single product by SKU
