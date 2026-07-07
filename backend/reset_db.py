"""One-time: wipe a Postgres DB's public schema so the self-migrating backend
can provision it fresh (fixes the "relation already exists" collision when a DB
was previously set up from schema.sql, with no alembic tracking).

Run it against the Render EXTERNAL database URL:

    cd backend
    $env:DATABASE_URL = "postgres://...oregon-postgres.render.com/dbname"
    .venv\\Scripts\\python.exe reset_db.py --yes

Then redeploy the web service on Render. Delete this file when done.
"""

import os
import sys

url = os.environ.get("DATABASE_URL", "").strip()
host = url.split("@")[-1].split("/")[0] if "@" in url else "?"

if not url:
    print("Set DATABASE_URL to the Render EXTERNAL database URL first.")
    sys.exit(1)

if "--yes" not in sys.argv:
    print(f"This will DROP ALL TABLES in the database at: {host}")
    print("Re-run with --yes to proceed.")
    sys.exit(1)

import psycopg2  # noqa: E402

u = url.replace("postgres://", "postgresql://", 1)
if "sslmode=" not in u:  # Render external connections require SSL
    u += ("&" if "?" in u else "?") + "sslmode=require"

conn = psycopg2.connect(u)
conn.autocommit = True
conn.cursor().execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
conn.close()
print(f"Reset done on {host}. Now redeploy the web service on Render.")
