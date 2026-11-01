# PRD Deviations

This file logs any design choices or minor deviations necessitated by technical constraints or PRD ambiguities, in accordance with Section 0.3.

1. **better-sqlite3 version on Node 24 (Windows x64):**
   - The environment is Node v24.15.0 on Windows x64.
   - `better-sqlite3` 11.x does not provide prebuilt binaries for Node 24, requiring Visual Studio C++ build tools which are not installed on the system.
   - In accordance with Section 3 ("If better-sqlite3 fails to install on Windows, install the newest better-sqlite3 release"), `better-sqlite3` was upgraded to `^13.0.3` which includes official prebuilt binaries for Node 24 on Windows x64.
